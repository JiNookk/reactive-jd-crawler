// 크롤링 프로세스 전체 조율
import { PageFetcher } from '../../infra/browser/pageFetcher.js';
import { PageAnalyzer } from '../../infra/llm/pageAnalyzer.js';
import { DataExtractor } from '../../infra/extractor/dataExtractor.js';
import { StructureCache } from '../../infra/cache/structureCache.js';
import { PageStructure } from '../../domain/pageStructure.domain.js';
import { JobPosting } from '../../domain/jobPosting.domain.js';

export interface CrawlOptions {
  company: string;
  maxPages?: number;
  includeDetails?: boolean;
  headless?: boolean;
  retryCount?: number;
  retryDelay?: number;
}

export interface CrawlResult {
  company: string;
  sourceUrl: string;
  jobs: JobPosting[];
  totalCount: number;
  crawledAt: string;
  errors: string[];
  pagesProcessed: number;
  duplicatesRemoved: number;
}

export class CrawlerOrchestrator {
  private fetcher: PageFetcher;
  private analyzer: PageAnalyzer;
  private extractor: DataExtractor;
  private cache: StructureCache;

  constructor(options?: { headless?: boolean; cachePath?: string }) {
    this.fetcher = new PageFetcher({ headless: options?.headless ?? true });
    this.analyzer = new PageAnalyzer();
    this.extractor = new DataExtractor();
    this.cache = new StructureCache(options?.cachePath);
  }

  async crawl(url: string, options: CrawlOptions): Promise<CrawlResult> {
    const errors: string[] = [];
    const allJobs: JobPosting[] = [];
    const crawledAt = new Date().toISOString();
    const seenJobKeys = new Set<string>();
    let pagesProcessed = 0;
    let duplicatesRemoved = 0;

    try {
      // 캐시 로드
      await this.cache.load();

      // 페이지 가져오기
      console.log(`[Fetcher] 페이지 로드 중: ${url}`);
      const page = await this.fetcher.getPage();

      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      // 동적 콘텐츠 로드 대기
      await page.waitForTimeout(2000);

      const currentUrl = page.url();
      const cacheKey = PageStructure.generateCacheKey(currentUrl);

      // 캐시 확인
      let structure = this.cache.get(cacheKey);

      if (structure) {
        console.log(`[Cache] 캐시된 구조 사용: ${cacheKey}`);

        // 캐시된 셀렉터로 추출 시도
        const canExtract = await this.extractor.tryExtract(page, structure.selectors);

        if (!canExtract) {
          console.log(`[Cache] 셀렉터 추출 실패, 재분석 필요`);
          structure = null;
          this.cache.delete(cacheKey);
        }
      }

      // 캐시 미스 또는 셀렉터 실패 시 LLM 분석
      if (!structure) {
        console.log(`[Analyzer] LLM으로 페이지 구조 분석 중...`);
        const html = await page.content();
        structure = await this.analyzer.analyze(html, currentUrl, 'list');

        // 캐시 저장
        this.cache.set(cacheKey, structure);
        await this.cache.save();
        console.log(`[Cache] 구조 캐시 저장: ${cacheKey}`);
      }

      // 데이터 추출 (첫 페이지)
      console.log(`[Extractor] 직무 데이터 추출 중...`);
      const jobs = await this.extractor.extractFromListPage(page, structure, options.company);

      // 중복 제거하며 추가
      for (const job of jobs) {
        const jobKey = this.generateJobKey(job);
        if (!seenJobKeys.has(jobKey)) {
          seenJobKeys.add(jobKey);
          allJobs.push(job);
        } else {
          duplicatesRemoved++;
        }
      }
      pagesProcessed = 1;
      console.log(`[Extractor] 페이지 1: ${jobs.length}개 직무 추출 (신규: ${jobs.length - duplicatesRemoved}개)`);

      // 페이지네이션 처리
      if (structure.pagination && options.maxPages && options.maxPages > 1) {
        const paginationResult = await this.handlePagination(
          page,
          structure,
          options.company,
          options.maxPages - 1,
          seenJobKeys,
          options.retryCount ?? 2,
          options.retryDelay ?? 1000
        );

        allJobs.push(...paginationResult.jobs);
        pagesProcessed += paginationResult.pagesProcessed;
        duplicatesRemoved += paginationResult.duplicatesRemoved;
      }

      await page.close();

      // 상세 페이지 크롤링 (옵션)
      if (options.includeDetails && allJobs.length > 0) {
        const enrichedJobs = await this.crawlDetailPages(allJobs, options.company, errors);
        // 기존 jobs를 enriched jobs로 교체
        allJobs.length = 0;
        allJobs.push(...enrichedJobs);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(errorMessage);
      console.error(`[Error] 크롤링 실패:`, errorMessage);
    } finally {
      await this.fetcher.close();
    }

    return {
      company: options.company,
      sourceUrl: url,
      jobs: allJobs,
      totalCount: allJobs.length,
      crawledAt,
      errors,
      pagesProcessed,
      duplicatesRemoved,
    };
  }

  private async handlePagination(
    page: any,
    structure: PageStructure,
    company: string,
    maxPages: number,
    seenJobKeys: Set<string>,
    retryCount: number,
    retryDelay: number
  ): Promise<{ jobs: JobPosting[]; pagesProcessed: number; duplicatesRemoved: number }> {
    const allJobs: JobPosting[] = [];
    const pagination = structure.pagination;
    let pagesProcessed = 0;
    let duplicatesRemoved = 0;

    if (!pagination || pagination.type === 'none') {
      return { jobs: allJobs, pagesProcessed, duplicatesRemoved };
    }

    for (let pageNum = 0; pageNum < maxPages; pageNum++) {
      const currentPageDisplay = pageNum + 2; // 첫 페이지가 1이므로 2부터 시작
      let success = false;
      let lastError: Error | null = null;

      // 재시도 로직
      for (let attempt = 0; attempt <= retryCount; attempt++) {
        try {
          if (attempt > 0) {
            console.log(`[Pagination] 페이지 ${currentPageDisplay} 재시도 (${attempt}/${retryCount})...`);
            await this.delay(retryDelay * attempt); // 지수 백오프
          }

          const hasNextPage = await this.navigateToNextPage(page, pagination, currentPageDisplay);

          if (!hasNextPage) {
            console.log(`[Pagination] 더 이상 페이지 없음 (페이지 ${currentPageDisplay - 1}에서 종료)`);
            return { jobs: allJobs, pagesProcessed, duplicatesRemoved };
          }

          // 추가 데이터 추출
          const jobs = await this.extractor.extractFromListPage(page, structure, company);
          let newJobsCount = 0;

          // 중복 제거하며 추가
          for (const job of jobs) {
            const jobKey = this.generateJobKey(job);
            if (!seenJobKeys.has(jobKey)) {
              seenJobKeys.add(jobKey);
              allJobs.push(job);
              newJobsCount++;
            } else {
              duplicatesRemoved++;
            }
          }

          pagesProcessed++;
          console.log(`[Pagination] 페이지 ${currentPageDisplay}: ${jobs.length}개 추출 (신규: ${newJobsCount}개, 중복: ${jobs.length - newJobsCount}개)`);

          // Rate limiting
          await this.delay(1000);
          success = true;
          break;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (attempt === retryCount) {
            console.warn(`[Pagination] 페이지 ${currentPageDisplay} 처리 실패 (${retryCount}회 재시도 후): ${lastError.message}`);
          }
        }
      }

      if (!success) {
        console.log(`[Pagination] 페이지 ${currentPageDisplay}에서 중단`);
        break;
      }
    }

    return { jobs: allJobs, pagesProcessed, duplicatesRemoved };
  }

  private async navigateToNextPage(
    page: any,
    pagination: NonNullable<PageStructure['pagination']>,
    targetPage: number
  ): Promise<boolean> {
    if (pagination.type === 'button' && pagination.nextSelector) {
      // 다음 버튼 클릭
      const nextButton = await page.$(pagination.nextSelector);
      if (nextButton) {
        const isDisabled = await nextButton.getAttribute('disabled');
        const ariaDisabled = await nextButton.getAttribute('aria-disabled');
        const classList = await nextButton.getAttribute('class');
        const isVisuallyDisabled = classList?.includes('disabled') || classList?.includes('inactive');

        if (!isDisabled && ariaDisabled !== 'true' && !isVisuallyDisabled) {
          await nextButton.click();
          await page.waitForTimeout(2000);
          return true;
        }
      }
      return false;
    }

    if (pagination.type === 'infinite-scroll') {
      // 무한 스크롤
      const scrollContainer = pagination.scrollContainer || 'body';
      const previousHeight = await page.evaluate(
        (selector: string) => {
          const el = selector === 'body' ? document.body : document.querySelector(selector);
          return el?.scrollHeight ?? 0;
        },
        scrollContainer
      );

      await page.evaluate(
        (selector: string) => {
          const el = selector === 'body' ? document.body : document.querySelector(selector);
          if (el) {
            el.scrollTo(0, el.scrollHeight);
          } else {
            window.scrollTo(0, document.body.scrollHeight);
          }
        },
        scrollContainer
      );

      await page.waitForTimeout(2000);

      const newHeight = await page.evaluate(
        (selector: string) => {
          const el = selector === 'body' ? document.body : document.querySelector(selector);
          return el?.scrollHeight ?? 0;
        },
        scrollContainer
      );

      return newHeight > previousHeight;
    }

    if (pagination.type === 'url-param' && pagination.paramName) {
      // URL 파라미터 방식
      const currentUrl = new URL(page.url());
      const paramStart = pagination.paramStart ?? 1;
      const nextPageValue = paramStart + targetPage - 1;

      currentUrl.searchParams.set(pagination.paramName, String(nextPageValue));

      await page.goto(currentUrl.toString(), {
        waitUntil: 'networkidle',
        timeout: 30000,
      });
      await page.waitForTimeout(2000);
      return true;
    }

    return false;
  }

  private async crawlDetailPages(
    jobs: JobPosting[],
    company: string,
    errors: string[]
  ): Promise<JobPosting[]> {
    const enrichedJobs: JobPosting[] = [];
    const totalJobs = jobs.length;

    console.log(`[Detail] 상세 페이지 크롤링 시작... (총 ${totalJobs}개)`);

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      if (!job) continue;

      const detailUrl = job.sourceUrl;

      // 상세 URL이 없거나 이미 상세 페이지처럼 보이지 않으면 스킵
      if (!detailUrl) {
        enrichedJobs.push(job);
        continue;
      }

      try {
        console.log(`[Detail] (${i + 1}/${totalJobs}) ${job.title}`);

        const page = await this.fetcher.getPage();

        await page.goto(detailUrl, {
          waitUntil: 'networkidle',
          timeout: 30000,
        });

        await page.waitForTimeout(1500);

        const currentUrl = page.url();
        const cacheKey = this.getDetailCacheKey(currentUrl);

        // 캐시 확인
        let structure = this.cache.get(cacheKey);

        if (!structure) {
          console.log(`[Detail] LLM으로 상세 페이지 구조 분석 중...`);
          const html = await page.content();
          structure = await this.analyzer.analyze(html, currentUrl, 'detail');

          // 캐시 저장
          this.cache.set(cacheKey, structure);
          await this.cache.save();
        }

        // 상세 데이터 추출
        const enrichedJob = await this.extractor.extractFromDetailPage(
          page,
          structure,
          company,
          { id: job.id, title: job.title, location: job.location, department: job.department }
        );

        enrichedJobs.push(enrichedJob);

        await page.close();

        // Rate limiting - 요청 간격
        await this.delay(1000);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push(`상세 페이지 크롤링 실패 (${job.title}): ${errorMessage}`);
        console.warn(`[Detail] 실패: ${job.title} - ${errorMessage}`);
        // 실패해도 기존 job 정보는 유지
        enrichedJobs.push(job);
      }
    }

    console.log(`[Detail] 상세 페이지 크롤링 완료: ${enrichedJobs.length}개`);
    return enrichedJobs;
  }

  private getDetailCacheKey(url: string): string {
    // URL에서 ID 부분을 패턴화하여 캐시 키 생성
    // 예: jobs.booking.com/booking/jobs/12345 -> jobs.booking.com/booking/jobs/:id
    const baseKey = PageStructure.generateCacheKey(url);

    // 숫자 ID 패턴 치환
    const patternizedKey = baseKey.replace(/\/\d+$/, '/:id');

    // UUID 패턴 치환
    return patternizedKey.replace(/\/[a-f0-9-]{36}$/i, '/:id');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private generateJobKey(job: JobPosting): string {
    // 제목 + 위치 + 회사로 고유 키 생성
    const normalizedTitle = job.title.toLowerCase().trim();
    const normalizedLocation = (job.location || '').toLowerCase().trim();
    const normalizedCompany = job.company.toLowerCase().trim();
    return `${normalizedCompany}:${normalizedTitle}:${normalizedLocation}`;
  }
}
