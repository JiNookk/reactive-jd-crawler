// 잡플래닛 회사 평점 크롤러 - 인간적 흐름

import { chromium } from 'playwright-extra';
import type { Browser, Page, BrowserContext } from 'playwright';
import stealth from 'puppeteer-extra-plugin-stealth';
import { CompanyRating, CategoryRatings, CompanyRatingProps } from '../../domain/companyRating.domain.js';

// stealth 플러그인 적용 (봇 탐지 우회)
chromium.use(stealth());

const JOBPLANET_HOME = 'https://www.jobplanet.co.kr';
const JOBPLANET_SEARCH = 'https://www.jobplanet.co.kr/search/companies';

export interface JobplanetScraperOptions {
  headless?: boolean;
  timeout?: number;
}

export interface JobplanetSearchResult {
  found: boolean;
  rating?: CompanyRating;
  error?: string;
  searchedCompany: string;
  jobplanetCompanyId?: string;
}

export class JobplanetScraper {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private headless: boolean;
  private timeout: number;
  private isInitialized: boolean = false;

  constructor(options?: JobplanetScraperOptions) {
    this.headless = options?.headless ?? true;
    this.timeout = options?.timeout ?? 30000;
  }

  async init(): Promise<void> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: this.headless,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-dev-shm-usage',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
        ],
      });

      this.context = await this.browser.newContext({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
        extraHTTPHeaders: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
        },
      });

      this.page = await this.context.newPage();
      this.page.setDefaultTimeout(this.timeout);

      // 봇 감지 우회
      await this.page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        (window as any).chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
        Object.defineProperty(navigator, 'plugins', {
          get: () => [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
          ],
        });
        Object.defineProperty(navigator, 'languages', {
          get: () => ['ko-KR', 'ko', 'en-US', 'en'],
        });
      });
    }
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
      this.page = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    this.isInitialized = false;
  }

  /**
   * 잡플래닛 검색 페이지로 이동
   */
  private async goToSearchPage(): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    if (!this.isInitialized) {
      console.log('[Jobplanet] 검색 페이지 이동 중...');
      await this.page.goto(JOBPLANET_SEARCH, { waitUntil: 'domcontentloaded' });
      await this.humanDelay(2000, 3000);

      // 광고/팝업 닫기
      await this.closePopups();

      await this.randomMouseMove();
      await this.randomScroll();
      this.isInitialized = true;
    }
  }

  /**
   * 회사명으로 잡플래닛 평점 조회 (인간적 흐름)
   */
  async searchCompanyRating(companyName: string): Promise<JobplanetSearchResult> {
    try {
      await this.init();
      if (!this.page) throw new Error('Page not initialized');

      const searchQuery = this.toSearchQuery(companyName);
      console.log(`[Jobplanet] 검색 중: ${companyName} → "${searchQuery}"`);

      // 1. 검색 URL로 직접 이동
      const searchUrl = `${JOBPLANET_SEARCH}?query=${encodeURIComponent(searchQuery)}`;
      console.log(`[Jobplanet] 검색 URL: ${searchUrl}`);

      await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
      await this.humanDelay(2000, 3000);

      // 광고/팝업 닫기
      await this.closePopups();
      await this.randomMouseMove();

      // 2. 검색 결과에서 회사 찾기
      const companyLink = await this.findCompanyInResults(searchQuery);
      if (!companyLink) {
        return {
          found: false,
          searchedCompany: companyName,
          error: '검색 결과에서 회사를 찾을 수 없습니다',
        };
      }

      // 3. 회사 페이지로 이동
      await this.humanDelay(500, 1000);
      await companyLink.click();
      await this.humanDelay(2000, 3000);

      // 광고/팝업 닫기
      await this.closePopups();

      // 4. 리뷰 탭으로 이동 (필요시)
      await this.navigateToReviewTab();

      await this.randomMouseMove();
      await this.randomScroll();

      // 5. 평점 데이터 추출
      const ratingData = await this.extractRatingData(this.page);

      if (!ratingData) {
        return {
          found: false,
          searchedCompany: companyName,
          error: '평점 데이터를 추출할 수 없습니다',
        };
      }

      const props: CompanyRatingProps = {
        companyName: ratingData.companyName || companyName,
        overallRating: ratingData.overallRating,
        reviewCount: ratingData.reviewCount,
        sourceUrl: this.page.url(),
        crawledAt: new Date(),
        categoryRatings: ratingData.categoryRatings,
      };

      const rating = CompanyRating.create(props);

      // URL에서 회사 ID 추출
      const companyIdMatch = this.page.url().match(/\/companies\/(\d+)/);
      const jobplanetCompanyId = companyIdMatch?.[1];

      return {
        found: true,
        rating,
        searchedCompany: companyName,
        jobplanetCompanyId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.isInitialized = false;
      return {
        found: false,
        searchedCompany: companyName,
        error: errorMessage,
      };
    }
  }

  /**
   * 리뷰 탭으로 이동
   */
  private async navigateToReviewTab(): Promise<void> {
    if (!this.page) return;

    const reviewTabSelectors = [
      'a[href*="/reviews"]',
      'a:has-text("리뷰")',
      '[class*="review"][class*="tab"]',
      'button:has-text("리뷰")',
    ];

    for (const selector of reviewTabSelectors) {
      try {
        const reviewTab = this.page.locator(selector).first();
        if (await reviewTab.isVisible({ timeout: 2000 }).catch(() => false)) {
          await reviewTab.click({ timeout: 5000 });
          console.log('[Jobplanet] 리뷰 탭 클릭 성공');
          await this.humanDelay(1500, 2500);
          await this.closePopups();
          return;
        }
      } catch {
        continue;
      }
    }
    console.log('[Jobplanet] 리뷰 탭을 찾지 못함 (이미 리뷰 페이지일 수 있음)');
  }

  /**
   * 검색 결과에서 회사 링크 찾기
   */
  private async findCompanyInResults(searchQuery: string): Promise<any> {
    if (!this.page) return null;

    await this.humanDelay(1000, 2000);
    await this.closePopups();

    const normalizeText = (text: string): string => {
      return text
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[^\w가-힣]/g, '');
    };

    const normalizedQuery = normalizeText(searchQuery);
    let bestMatch: { link: any; companyName: string; score: number } | null = null;

    // 잡플래닛 검색 결과 카드 셀렉터
    const resultCardSelectors = [
      '[class*="company_card"]',
      '[class*="CompanyCard"]',
      '[class*="search-result"]',
      '[class*="SearchResult"]',
      '.company_list > li',
      '[data-testid*="company"]',
    ];

    for (const cardSelector of resultCardSelectors) {
      try {
        const cards = this.page.locator(cardSelector);
        const count = await cards.count();

        for (let i = 0; i < count; i++) {
          const card = cards.nth(i);

          // 카드 내에서 회사명 요소 찾기
          const companyNameSelectors = [
            '.company_name',
            '[class*="company_name"]',
            '[class*="companyName"]',
            'h2',
            'h3',
            'a[href*="/companies/"]',
          ];

          for (const nameSelector of companyNameSelectors) {
            try {
              const nameElement = card.locator(nameSelector).first();
              if (await nameElement.isVisible({ timeout: 500 }).catch(() => false)) {
                const companyName = await nameElement.textContent();
                if (!companyName) continue;

                const normalizedName = normalizeText(companyName);
                const link = card.locator('a[href*="/companies/"]').first();

                if (!(await link.isVisible({ timeout: 500 }).catch(() => false))) continue;

                // 정확히 일치
                if (normalizedName === normalizedQuery) {
                  console.log(`[Jobplanet] 정확한 매칭: "${companyName.trim()}"`);
                  return link;
                }

                // 부분 일치 점수 계산
                let score = 0;
                if (normalizedName.includes(normalizedQuery)) {
                  score = normalizedQuery.length / normalizedName.length;
                } else if (normalizedQuery.includes(normalizedName) && normalizedName.length >= 2) {
                  score = normalizedName.length / normalizedQuery.length;
                }

                if (score > 0 && (!bestMatch || score > bestMatch.score)) {
                  bestMatch = { link, companyName: companyName.trim(), score };
                  console.log(`[Jobplanet] 부분 매칭: "${companyName.trim()}" (score: ${score.toFixed(2)})`);
                }
                break;
              }
            } catch {
              continue;
            }
          }
        }
      } catch {
        continue;
      }
    }

    // 방법 2: 직접 회사 링크에서 찾기
    if (!bestMatch) {
      const linkSelectors = ['a[href*="/companies/"]'];

      for (const selector of linkSelectors) {
        try {
          const links = this.page.locator(selector);
          const count = await links.count();

          for (let i = 0; i < Math.min(count, 10); i++) {
            const link = links.nth(i);
            const text = await link.textContent();

            if (!text) continue;

            const normalizedText = normalizeText(text);

            if (normalizedText === normalizedQuery) {
              console.log(`[Jobplanet] 링크에서 정확한 매칭: "${text.trim()}"`);
              return link;
            }

            let score = 0;
            if (normalizedText.includes(normalizedQuery)) {
              score = normalizedQuery.length / normalizedText.length;
            } else if (normalizedQuery.includes(normalizedText) && normalizedText.length >= 2) {
              score = normalizedText.length / normalizedQuery.length;
            }

            if (score > 0 && (!bestMatch || score > bestMatch.score)) {
              bestMatch = { link, companyName: text.trim(), score };
              console.log(`[Jobplanet] 링크에서 부분 매칭: "${text.trim()}" (score: ${score.toFixed(2)})`);
            }
          }
        } catch {
          continue;
        }
      }
    }

    if (bestMatch && bestMatch.score >= 0.5) {
      console.log(`[Jobplanet] 최종 선택: "${bestMatch.companyName}" (score: ${bestMatch.score.toFixed(2)})`);
      return bestMatch.link;
    }

    console.log(`[Jobplanet] "${searchQuery}"와 일치하는 회사를 찾을 수 없습니다.`);
    return null;
  }

  /**
   * 팝업/광고 닫기
   */
  private async closePopups(): Promise<void> {
    if (!this.page) return;

    // 1. JavaScript로 광고 요소 제거
    try {
      await this.page.evaluate(() => {
        const adSelectors = [
          '.adsbygoogle',
          '[data-ad-status]',
          '[data-vignette-loaded]',
          'ins.adsbygoogle',
          'iframe[title="Advertisement"]',
          'iframe[id^="aswift"]',
          'iframe[id^="google_ads"]',
          '[id^="google_ads"]',
          '[class*="google-auto-placed"]',
          '[class*="adsbygoogle"]',
          '[class*="ad-overlay"]',
          '[class*="ad-wrapper"]',
          '[class*="adContainer"]',
          '[id*="adContainer"]',
          // 잡플래닛 특화
          '[class*="popup"]',
          '[class*="modal"]',
          '[class*="banner"]',
        ];

        adSelectors.forEach(selector => {
          document.querySelectorAll(selector).forEach(el => {
            (el as HTMLElement).style.display = 'none';
            (el as HTMLElement).style.visibility = 'hidden';
            (el as HTMLElement).style.pointerEvents = 'none';
            el.remove();
          });
        });

        document.body.style.overflow = 'auto';
        document.documentElement.style.overflow = 'auto';
      });
    } catch {
      // 무시
    }

    // 2. 닫기 버튼 클릭
    for (let attempt = 0; attempt < 3; attempt++) {
      let closed = false;

      const closeButtonSelectors = [
        'button[aria-label*="닫기"]',
        'button[aria-label*="Close"]',
        'button[aria-label*="close"]',
        '[class*="CloseButton"]',
        '[class*="closeButton"]',
        '[class*="close-button"]',
        '[class*="close_button"]',
        '[class*="modal"] button:first-child',
        '[class*="popup"] button',
        'button:has-text("닫기")',
        'button:has-text("Close")',
        // 잡플래닛 특화
        '.jp_popup_close',
        '.close_btn',
        '[class*="btn_close"]',
      ];

      for (const selector of closeButtonSelectors) {
        try {
          const closeBtn = this.page.locator(selector).first();
          if (await closeBtn.isVisible({ timeout: 300 }).catch(() => false)) {
            console.log(`[Jobplanet] 팝업 닫기: ${selector}`);
            await closeBtn.click();
            await this.humanDelay(300, 500);
            closed = true;
          }
        } catch {
          continue;
        }
      }

      try {
        await this.page.keyboard.press('Escape');
        await this.humanDelay(200, 400);
      } catch {
        // 무시
      }

      if (!closed) break;
      await this.humanDelay(300, 500);
    }
  }

  // ===== 인간적 행동 시뮬레이션 =====

  private async humanType(text: string): Promise<void> {
    if (!this.page) return;

    for (const char of text) {
      await this.page.keyboard.type(char, { delay: this.randomInt(50, 150) });
      if (Math.random() < 0.1) {
        await this.humanDelay(200, 500);
      }
    }
  }

  private async randomMouseMove(): Promise<void> {
    if (!this.page) return;

    const moves = this.randomInt(2, 4);
    for (let i = 0; i < moves; i++) {
      const x = this.randomInt(100, 1800);
      const y = this.randomInt(100, 900);
      await this.page.mouse.move(x, y, { steps: this.randomInt(5, 15) });
      await this.humanDelay(100, 300);
    }
  }

  private async randomScroll(): Promise<void> {
    if (!this.page) return;

    const scrolls = this.randomInt(1, 3);
    for (let i = 0; i < scrolls; i++) {
      const deltaY = this.randomInt(100, 400) * (Math.random() > 0.3 ? 1 : -1);
      await this.page.mouse.wheel(0, deltaY);
      await this.humanDelay(300, 600);
    }
  }

  private async humanDelay(min: number, max: number): Promise<void> {
    const delay = this.randomInt(min, max);
    await this.delay(delay);
  }

  private randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // ===== 데이터 추출 =====

  private async extractRatingData(page: Page): Promise<{
    companyName?: string;
    overallRating: number;
    reviewCount: number;
    categoryRatings?: CategoryRatings;
  } | null> {
    try {
      const overallRating = await this.extractOverallRating(page);
      if (overallRating === null) {
        return null;
      }

      const reviewCount = await this.extractReviewCount(page);
      const companyName = await this.extractCompanyName(page);
      const categoryRatings = await this.extractCategoryRatings(page);

      return {
        companyName,
        overallRating,
        reviewCount,
        categoryRatings,
      };
    } catch (error) {
      console.error('[Jobplanet] 데이터 추출 실패:', error);
      return null;
    }
  }

  private async extractOverallRating(page: Page): Promise<number | null> {
    // 잡플래닛 평점 셀렉터
    const selectors = [
      '.rate_point',
      '[class*="rate_point"]',
      '[class*="rating_score"]',
      '[class*="total_rating"]',
      '.company_info .score',
      '[class*="star_score"]',
      '[data-testid="overall-rating"]',
    ];

    for (const selector of selectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text) {
            const match = text.match(/(\d+\.?\d*)/);
            if (match?.[1]) {
              const rating = parseFloat(match[1]);
              if (rating >= 0 && rating <= 5) {
                console.log(`[Jobplanet] 평점 발견: ${rating}`);
                return rating;
              }
            }
          }
        }
      } catch {
        continue;
      }
    }

    // 페이지 텍스트에서 평점 패턴 찾기
    const pageText = await page.textContent('body');
    if (pageText) {
      const patterns = [
        /총점\s*[:\s]*(\d\.?\d*)/,
        /평점\s*[:\s]*(\d\.?\d*)/,
        /(\d\.\d)\s*점/,
        /(\d\.?\d*)\s*\/\s*5/,
      ];
      for (const pattern of patterns) {
        const match = pageText.match(pattern);
        if (match?.[1]) {
          const rating = parseFloat(match[1]);
          if (rating >= 0 && rating <= 5) {
            console.log(`[Jobplanet] 텍스트에서 평점 발견: ${rating}`);
            return rating;
          }
        }
      }
    }

    return null;
  }

  private async extractReviewCount(page: Page): Promise<number> {
    const selectors = [
      '.review_count',
      '[class*="review_count"]',
      '[class*="reviewCount"]',
      '.num_review',
      '[data-testid="review-count"]',
    ];

    for (const selector of selectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text) {
            const match = text.match(/([\d,]+)/);
            if (match?.[1]) {
              return parseInt(match[1].replace(/,/g, ''), 10);
            }
          }
        }
      } catch {
        continue;
      }
    }

    // 페이지 텍스트에서 찾기
    const pageText = await page.textContent('body');
    if (pageText) {
      const patterns = [
        /리뷰\s*([\d,]+)\s*개/,
        /([\d,]+)\s*개의?\s*리뷰/,
        /총\s*([\d,]+)\s*건/,
      ];
      for (const pattern of patterns) {
        const match = pageText.match(pattern);
        if (match?.[1]) {
          return parseInt(match[1].replace(/,/g, ''), 10);
        }
      }
    }

    return 0;
  }

  private async extractCompanyName(page: Page): Promise<string | undefined> {
    const selectors = [
      '.company_name',
      '[class*="company_name"]',
      '[class*="companyName"]',
      'h1.name',
      '.company_info h1',
      '[data-testid="company-name"]',
    ];

    for (const selector of selectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text?.trim()) {
            return text.trim();
          }
        }
      } catch {
        continue;
      }
    }

    return undefined;
  }

  private async extractCategoryRatings(page: Page): Promise<CategoryRatings | undefined> {
    const ratings: CategoryRatings = {};
    let foundAny = false;

    // 잡플래닛 카테고리 매핑
    // 승진 기회 및 가능성 → careerGrowth
    // 복지 및 급여 → compensation
    // 업무와 삶의 균형 → workLifeBalance
    // 사내문화 → companyCulture
    // 경영진 → management

    const pageText = await page.textContent('body');
    if (pageText) {
      const patterns: Array<{ regex: RegExp; key: keyof CategoryRatings }> = [
        { regex: /업무\s*와?\s*삶\s*의?\s*균형[:\s]*(\d\.?\d*)/i, key: 'workLifeBalance' },
        { regex: /워라밸[:\s]*(\d\.?\d*)/i, key: 'workLifeBalance' },
        { regex: /승진\s*기회[:\s]*(\d\.?\d*)/i, key: 'careerGrowth' },
        { regex: /커리어\s*성장[:\s]*(\d\.?\d*)/i, key: 'careerGrowth' },
        { regex: /복지\s*(?:및\s*)?급여[:\s]*(\d\.?\d*)/i, key: 'compensation' },
        { regex: /연봉[:\s]*(\d\.?\d*)/i, key: 'compensation' },
        { regex: /사내\s*문화[:\s]*(\d\.?\d*)/i, key: 'companyCulture' },
        { regex: /회사\s*문화[:\s]*(\d\.?\d*)/i, key: 'companyCulture' },
        { regex: /경영진[:\s]*(\d\.?\d*)/i, key: 'management' },
        { regex: /CEO\s*(?:지지도)?[:\s]*(\d\.?\d*)/i, key: 'management' },
      ];

      for (const { regex, key } of patterns) {
        const match = pageText.match(regex);
        if (match?.[1]) {
          const value = parseFloat(match[1]);
          if (value >= 0 && value <= 5) {
            ratings[key] = value;
            foundAny = true;
          }
        }
      }
    }

    // CSS 셀렉터로 카테고리 평점 추출 시도
    const categorySelectors = [
      { selector: '[class*="work_life"]', key: 'workLifeBalance' as keyof CategoryRatings },
      { selector: '[class*="career"]', key: 'careerGrowth' as keyof CategoryRatings },
      { selector: '[class*="salary"]', key: 'compensation' as keyof CategoryRatings },
      { selector: '[class*="culture"]', key: 'companyCulture' as keyof CategoryRatings },
      { selector: '[class*="management"]', key: 'management' as keyof CategoryRatings },
    ];

    for (const { selector, key } of categorySelectors) {
      if (ratings[key]) continue; // 이미 찾았으면 스킵

      try {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text) {
            const match = text.match(/(\d\.?\d*)/);
            if (match?.[1]) {
              const value = parseFloat(match[1]);
              if (value >= 0 && value <= 5) {
                ratings[key] = value;
                foundAny = true;
              }
            }
          }
        }
      } catch {
        continue;
      }
    }

    return foundAny ? ratings : undefined;
  }

  // ===== 유틸리티 =====

  private toSearchQuery(companyName: string): string {
    return CompanyRating.toSearchQuery(companyName);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
