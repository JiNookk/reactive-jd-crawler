// 크롤링 프로세스 전체 조율
import { PageFetcher } from '../../infra/browser/pageFetcher.js';
import { PageAnalyzer } from '../../infra/llm/pageAnalyzer.js';
import { DataExtractor } from '../../infra/extractor/dataExtractor.js';
import { StructureCache } from '../../infra/cache/structureCache.js';
import { PageStructure } from '../../domain/pageStructure.domain.js';
import { JobPosting } from '../../domain/jobPosting.domain.js';
import { ApiCrawler } from '../../infra/crawler/apiCrawler.js';

export interface CrawlOptions {
  sourcePlatform: string; // 크롤링 소스 (예: "사람인", "원티드")
  maxPages?: number;
  includeDetails?: boolean;
  headless?: boolean;
  retryCount?: number;
  retryDelay?: number;
}

export interface CrawlResult {
  sourcePlatform: string; // 크롤링 소스
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
  private apiCrawler: ApiCrawler;

  constructor(options?: { headless?: boolean; cachePath?: string }) {
    this.fetcher = new PageFetcher({ headless: options?.headless ?? true });
    this.analyzer = new PageAnalyzer();
    this.extractor = new DataExtractor();
    this.cache = new StructureCache(options?.cachePath);
    this.apiCrawler = new ApiCrawler();
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

      // URL에서 캐시 키 생성 (Playwright 없이)
      const cacheKey = PageStructure.generateCacheKey(url);

      // 캐시 확인
      let structure = this.cache.get(cacheKey);

      // API 전략이면서 캐시가 있으면 ApiCrawler 사용 (Playwright 불필요)
      if (structure?.strategy === 'api') {
        console.log(`[Strategy] API 전략 감지, ApiCrawler 사용`);
        return await this.crawlWithApi(url, structure, options, crawledAt);
      }

      // DOM 전략 또는 캐시 미스: Playwright 사용
      console.log(`[Fetcher] 페이지 로드 중: ${url}`);
      const page = await this.fetcher.getPage();

      // 페이지 로드 (networkidle이 안되면 domcontentloaded로 폴백)
      let usedFallback = false;
      try {
        await page.goto(url, {
          waitUntil: 'networkidle',
          timeout: 30000,
        });
      } catch (e) {
        if ((e as Error).message?.includes('Timeout')) {
          console.log('[Fetcher] networkidle 타임아웃, domcontentloaded로 재시도...');
          await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });
          usedFallback = true;
        } else {
          throw e;
        }
      }

      // 동적 콘텐츠 로드 대기 (폴백 시 더 오래 대기)
      await page.waitForTimeout(usedFallback ? 5000 : 2000);

      const currentUrl = page.url();

      if (structure) {
        console.log(`[Cache] 캐시된 구조 사용: ${cacheKey}`);

        // 캐시된 셀렉터로 추출 시도
        const canExtract = await this.extractor.tryExtract(page, structure.selectors);

        if (!canExtract) {
          console.log(`[Cache] 셀렉터 추출 실패`);
          // 실패 기록 및 자동 무효화 확인
          const invalidated = this.cache.recordFailure(cacheKey);
          if (invalidated) {
            console.log(`[Cache] 연속 실패로 캐시 무효화, 재분석 필요`);
          } else {
            console.log(`[Cache] 실패 기록됨, 재분석 필요`);
          }
          structure = null;
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
      const jobs = await this.extractor.extractFromListPage(page, structure, options.sourcePlatform);

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

      // 페이지네이션 처리 (maxPages: 0 = 무제한, 1 = 첫 페이지만, 2+ = 해당 수만큼)
      const shouldPaginate = structure.pagination &&
        options.maxPages !== undefined &&
        (options.maxPages === 0 || options.maxPages > 1);

      if (shouldPaginate) {
        // maxPages가 0이면 무제한 (9999로 설정)
        const effectiveMaxPages = options.maxPages === 0 ? 9999 : options.maxPages!;
        const paginationResult = await this.handlePagination(
          page,
          structure,
          options.sourcePlatform,
          effectiveMaxPages - 1,
          seenJobKeys,
          options.retryCount ?? 2,
          options.retryDelay ?? 1000,
          jobs.length // 첫 페이지에서 추출한 아이템 수 (무한 스크롤 스킵용)
        );

        allJobs.push(...paginationResult.jobs);
        pagesProcessed += paginationResult.pagesProcessed;
        duplicatesRemoved += paginationResult.duplicatesRemoved;
      }

      await page.close();

      // 상세 페이지 크롤링 (옵션)
      if (options.includeDetails && allJobs.length > 0) {
        const enrichedJobs = await this.crawlDetailPages(allJobs, options.sourcePlatform, errors);
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
      sourcePlatform: options.sourcePlatform,
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
    sourcePlatform: string,
    maxPages: number,
    seenJobKeys: Set<string>,
    retryCount: number,
    retryDelay: number,
    initialItemCount: number = 0 // 첫 페이지에서 추출한 아이템 수
  ): Promise<{ jobs: JobPosting[]; pagesProcessed: number; duplicatesRemoved: number }> {
    const allJobs: JobPosting[] = [];
    const pagination = structure.pagination;
    let pagesProcessed = 0;
    let duplicatesRemoved = 0;

    if (!pagination || pagination.type === 'none') {
      return { jobs: allJobs, pagesProcessed, duplicatesRemoved };
    }

    // 무한 스크롤용 jobItem 셀렉터
    const jobItemSelector = structure.selectors.jobItem || undefined;
    const isInfiniteScroll = pagination.type === 'infinite-scroll';

    // 무한 스크롤: 이전까지 처리한 DOM 아이템 수 추적
    let lastProcessedIndex = initialItemCount;

    // URL 파라미터 방식: 연속 빈 페이지 카운터 (3회 연속 빈 페이지면 종료)
    let consecutiveEmptyPages = 0;
    const MAX_CONSECUTIVE_EMPTY = 3;

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

          const hasNextPage = await this.navigateToNextPage(page, pagination, currentPageDisplay, jobItemSelector);

          if (!hasNextPage) {
            console.log(`[Pagination] 더 이상 페이지 없음 (페이지 ${currentPageDisplay - 1}에서 종료)`);
            return { jobs: allJobs, pagesProcessed, duplicatesRemoved };
          }

          // 추가 데이터 추출 (무한 스크롤: 새로 로드된 아이템만 추출)
          const startIndex = isInfiniteScroll ? lastProcessedIndex : 0;
          const jobs = await this.extractor.extractFromListPage(page, structure, sourcePlatform, startIndex);

          // 무한 스크롤: 다음 추출을 위해 현재 DOM 아이템 수 업데이트
          if (isInfiniteScroll && jobItemSelector) {
            const currentItemCount = await page.$$eval(
              jobItemSelector,
              (items: Element[]) => items.length
            ).catch(() => lastProcessedIndex + jobs.length);
            lastProcessedIndex = currentItemCount;
          }

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
          console.log(`[Pagination] 페이지 ${currentPageDisplay}: ${jobs.length}개 추출 (신규 추가: ${newJobsCount}개)`);

          // URL 파라미터 방식: 연속 빈 페이지 체크
          if (jobs.length === 0) {
            consecutiveEmptyPages++;
            if (consecutiveEmptyPages >= MAX_CONSECUTIVE_EMPTY) {
              console.log(`[Pagination] ${MAX_CONSECUTIVE_EMPTY}회 연속 빈 페이지 - 종료`);
              return { jobs: allJobs, pagesProcessed, duplicatesRemoved };
            }
          } else {
            consecutiveEmptyPages = 0; // 리셋
          }

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
    targetPage: number,
    jobItemSelector?: string
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
      // 무한 스크롤 - 개선된 로직
      const scrollContainer = pagination.scrollContainer || 'body';

      // 현재 아이템 개수 확인 (있는 경우)
      let previousItemCount = 0;
      if (jobItemSelector) {
        previousItemCount = await page.$$eval(
          jobItemSelector,
          (items: Element[]) => items.length
        ).catch(() => 0);
      }

      const previousHeight = await page.evaluate(
        (selector: string) => {
          const el = selector === 'body' ? document.body : document.querySelector(selector);
          return el?.scrollHeight ?? 0;
        },
        scrollContainer
      );

      // 여러 스크롤 방식 시도
      await page.evaluate(
        (selector: string) => {
          // 방법 1: 컨테이너 스크롤
          const el = selector === 'body' ? document.body : document.querySelector(selector);
          if (el && el !== document.body) {
            el.scrollTo(0, el.scrollHeight);
          }
          // 방법 2: window 스크롤 (항상 실행)
          window.scrollTo(0, document.body.scrollHeight);
          // 방법 3: 마지막 요소로 스크롤
          const lastItem = document.querySelector('[class*="Card"]:last-child, [class*="job"]:last-child, li:last-child');
          if (lastItem) {
            lastItem.scrollIntoView({ behavior: 'instant', block: 'end' });
          }
        },
        scrollContainer
      );

      // 대기 시간 증가 (3초) + 네트워크 안정화 대기
      await page.waitForTimeout(3000);

      // 추가 로딩 대기 (네트워크 idle 체크)
      try {
        await page.waitForLoadState('networkidle', { timeout: 5000 });
      } catch {
        // 타임아웃 무시 - 이미 idle 상태이거나 오래 걸리는 경우
      }

      // 새 아이템 개수 확인
      let newItemCount = 0;
      if (jobItemSelector) {
        newItemCount = await page.$$eval(
          jobItemSelector,
          (items: Element[]) => items.length
        ).catch(() => 0);

        // 아이템이 증가했으면 성공
        if (newItemCount > previousItemCount) {
          console.log(`[Scroll] 아이템 증가: ${previousItemCount} → ${newItemCount}`);
          return true;
        }
      }

      // 높이 비교 (fallback)
      const newHeight = await page.evaluate(
        (selector: string) => {
          const el = selector === 'body' ? document.body : document.querySelector(selector);
          return el?.scrollHeight ?? 0;
        },
        scrollContainer
      );

      if (newHeight > previousHeight) {
        console.log(`[Scroll] 높이 증가: ${previousHeight} → ${newHeight}`);
        return true;
      }

      // 둘 다 변화 없으면 종료
      console.log(`[Scroll] 변화 없음 (아이템: ${previousItemCount}, 높이: ${previousHeight})`);
      return false;
    }

    if (pagination.type === 'url-param' && pagination.paramName) {
      // URL 파라미터 방식
      const currentUrl = new URL(page.url());
      const paramStart = pagination.paramStart ?? 1;
      const increment = (pagination as any).increment ?? 1; // 증분값 (기본: 1)

      // increment가 1이면: paramStart + (targetPage - 1) → 1, 2, 3, ...
      // increment가 40이면: paramStart + (targetPage - 1) * 40 → 0, 40, 80, ...
      const nextPageValue = paramStart + (targetPage - 1) * increment;

      currentUrl.searchParams.set(pagination.paramName, String(nextPageValue));

      // 페이지 로드 (networkidle이 안되면 domcontentloaded로 폴백)
      let usedFallback = false;
      try {
        await page.goto(currentUrl.toString(), {
          waitUntil: 'networkidle',
          timeout: 30000,
        });
      } catch (e) {
        if ((e as Error).message?.includes('Timeout')) {
          console.log('[Pagination] networkidle 타임아웃, domcontentloaded로 재시도...');
          await page.goto(currentUrl.toString(), {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });
          usedFallback = true;
        } else {
          throw e;
        }
      }
      await page.waitForTimeout(usedFallback ? 4000 : 2000);
      return true;
    }

    return false;
  }

  private async crawlDetailPages(
    jobs: JobPosting[],
    sourcePlatform: string,
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

        // 페이지 로드 (networkidle이 안되면 domcontentloaded로 폴백)
        let usedFallback = false;
        try {
          await page.goto(detailUrl, {
            waitUntil: 'networkidle',
            timeout: 30000,
          });
        } catch (e) {
          if ((e as Error).message?.includes('Timeout')) {
            console.log('[Detail] networkidle 타임아웃, domcontentloaded로 재시도...');
            await page.goto(detailUrl, {
              waitUntil: 'domcontentloaded',
              timeout: 30000,
            });
            usedFallback = true;
          } else {
            throw e;
          }
        }

        // 동적 콘텐츠 로드 대기 (폴백 시 더 오래 대기)
        await page.waitForTimeout(usedFallback ? 3000 : 1500);

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
          sourcePlatform,
          { id: job.id, title: job.title, sourcePlatform: job.sourcePlatform, company: job.company, location: job.location, department: job.department }
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

  /**
   * API 전략으로 크롤링 (Playwright 불필요)
   */
  private async crawlWithApi(
    url: string,
    structure: PageStructure,
    options: CrawlOptions,
    crawledAt: string
  ): Promise<CrawlResult> {
    const result = await this.apiCrawler.crawl(url, structure, {
      sourcePlatform: options.sourcePlatform,
      maxPages: options.maxPages ?? 1,
    });

    // 중복 제거
    const seenJobKeys = new Set<string>();
    const uniqueJobs: JobPosting[] = [];
    let duplicatesRemoved = 0;

    for (const job of result.jobs) {
      const jobKey = this.generateJobKey(job);
      if (!seenJobKeys.has(jobKey)) {
        seenJobKeys.add(jobKey);
        uniqueJobs.push(job);
      } else {
        duplicatesRemoved++;
      }
    }

    // 캐시 히트는 이미 cache.get()에서 기록됨

    return {
      sourcePlatform: options.sourcePlatform,
      sourceUrl: url,
      jobs: uniqueJobs,
      totalCount: result.totalCount,
      crawledAt,
      errors: result.errors,
      pagesProcessed: result.pagesProcessed,
      duplicatesRemoved,
    };
  }
}
