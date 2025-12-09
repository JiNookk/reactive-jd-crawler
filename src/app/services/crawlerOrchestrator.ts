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
}

export interface CrawlResult {
  company: string;
  sourceUrl: string;
  jobs: JobPosting[];
  totalCount: number;
  crawledAt: string;
  errors: string[];
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

      // 데이터 추출
      console.log(`[Extractor] 직무 데이터 추출 중...`);
      const jobs = await this.extractor.extractFromListPage(page, structure, options.company);
      allJobs.push(...jobs);
      console.log(`[Extractor] ${jobs.length}개 직무 추출 완료`);

      // 페이지네이션 처리
      if (structure.pagination && options.maxPages && options.maxPages > 1) {
        const additionalJobs = await this.handlePagination(
          page,
          structure,
          options.company,
          options.maxPages - 1
        );
        allJobs.push(...additionalJobs);
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
    };
  }

  private async handlePagination(
    page: any,
    structure: PageStructure,
    company: string,
    maxPages: number
  ): Promise<JobPosting[]> {
    const allJobs: JobPosting[] = [];
    const pagination = structure.pagination;

    if (!pagination || pagination.type === 'none') {
      return allJobs;
    }

    for (let i = 0; i < maxPages; i++) {
      try {
        let hasNextPage = false;

        if (pagination.type === 'button' && pagination.nextSelector) {
          // 다음 버튼 클릭
          const nextButton = await page.$(pagination.nextSelector);
          if (nextButton) {
            const isDisabled = await nextButton.getAttribute('disabled');
            if (!isDisabled) {
              await nextButton.click();
              await page.waitForTimeout(2000);
              hasNextPage = true;
            }
          }
        } else if (pagination.type === 'infinite-scroll') {
          // 무한 스크롤
          const previousHeight = await page.evaluate(() => document.body.scrollHeight);
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(2000);
          const newHeight = await page.evaluate(() => document.body.scrollHeight);
          hasNextPage = newHeight > previousHeight;
        }

        if (!hasNextPage) {
          console.log(`[Pagination] 더 이상 페이지 없음`);
          break;
        }

        // 추가 데이터 추출
        const jobs = await this.extractor.extractFromListPage(page, structure, company);
        allJobs.push(...jobs);
        console.log(`[Pagination] 페이지 ${i + 2}: ${jobs.length}개 직무 추출`);
      } catch (error) {
        console.warn(`[Pagination] 페이지 ${i + 2} 처리 실패:`, error);
        break;
      }
    }

    return allJobs;
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
}
