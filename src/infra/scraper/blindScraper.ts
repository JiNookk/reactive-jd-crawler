// 블라인드 회사 평점 크롤러 - 인간적 흐름

import { chromium } from 'playwright-extra';
import type { Browser, Page, BrowserContext } from 'playwright';
import stealth from 'puppeteer-extra-plugin-stealth';
import { CompanyRating, CategoryRatings, CompanyRatingProps } from '../../domain/companyRating.domain.js';

// stealth 플러그인 적용 (봇 탐지 우회)
chromium.use(stealth());

const BLIND_HOME = 'https://www.teamblind.com/kr';

export interface BlindScraperOptions {
  headless?: boolean;
  timeout?: number;
}

export interface BlindSearchResult {
  found: boolean;
  rating?: CompanyRating;
  error?: string;
  searchedCompany: string;
  blindCompanySlug?: string;
}

export class BlindScraper {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private headless: boolean;
  private timeout: number;
  private isOnHomepage: boolean = false;

  constructor(options?: BlindScraperOptions) {
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
    this.isOnHomepage = false;
  }

  /**
   * 블라인드 홈페이지로 이동
   */
  private async goToHomepage(): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    if (!this.isOnHomepage) {
      console.log('[Blind] 홈페이지 이동 중...');
      await this.page.goto(BLIND_HOME, { waitUntil: 'domcontentloaded' });
      await this.humanDelay(1500, 2500);

      // 광고/팝업 닫기
      await this.closePopups();

      await this.randomMouseMove();
      await this.randomScroll();
      this.isOnHomepage = true;
    }
  }

  /**
   * 회사명으로 블라인드 평점 조회 (인간적 흐름)
   */
  async searchCompanyRating(companyName: string): Promise<BlindSearchResult> {
    try {
      await this.init();
      if (!this.page) throw new Error('Page not initialized');

      const searchQuery = this.toSearchQuery(companyName);
      console.log(`[Blind] 검색 중: ${companyName} → "${searchQuery}"`);

      // 1. 현재 페이지에서 검색창 찾기 (홈 이동 전에 먼저 시도)
      const searchInputSelectors = [
        'input[placeholder*="검색"]',
        'input[placeholder*="Search"]',
        'input[type="search"]',
        'input[class*="search"]',
        'input[name="query"]',
        'input[class*="Search"]',
      ];

      let searchInputLocator = null;

      // 첫 검색이 아니면 현재 페이지에서 검색창 먼저 시도
      if (!this.isOnHomepage) {
        for (const selector of searchInputSelectors) {
          const locator = this.page.locator(selector).first();
          if (await locator.isVisible({ timeout: 1000 }).catch(() => false)) {
            searchInputLocator = locator;
            break;
          }
        }
      }

      // 검색창 없으면 홈으로 이동
      if (!searchInputLocator) {
        await this.goToHomepage();

        for (const selector of searchInputSelectors) {
          const locator = this.page.locator(selector).first();
          if (await locator.isVisible({ timeout: 2000 }).catch(() => false)) {
            searchInputLocator = locator;
            break;
          }
        }
      }

      if (!searchInputLocator) {
        // 검색창이 없으면 직접 URL로 이동 (fallback)
        console.log('[Blind] 검색창을 찾을 수 없어 직접 URL로 이동합니다.');
        return await this.searchByDirectUrl(companyName, searchQuery);
      }

      // 3. 검색어 입력 (인간처럼 타이핑)
      // 검색바 클릭 전 광고 제거 (첫 로드 시 광고가 검색바를 막을 수 있음)
      await this.closePopups();
      await this.humanDelay(300, 600);

      // 클릭 시도 - 실패하면 광고 제거 후 재시도
      try {
        await searchInputLocator.click({ timeout: 3000 });
      } catch {
        console.log('[Blind] 검색바 클릭 실패, 광고 제거 후 재시도...');
        await this.closePopups();
        await this.humanDelay(500, 1000);
        await searchInputLocator.click({ timeout: 5000 });
      }
      await this.humanDelay(200, 400);

      // 기존 텍스트 지우기 (Mac은 Meta+a)
      await this.page.keyboard.press('Meta+a');
      await this.humanDelay(100, 200);
      await this.page.keyboard.press('Backspace');
      await this.humanDelay(100, 200);

      // 인간처럼 타이핑
      await this.humanType(searchQuery);
      await this.humanDelay(500, 1000);

      // 4. Enter 키로 검색
      await this.page.keyboard.press('Enter');
      await this.humanDelay(2000, 3000);

      // 검색 후 광고 대기 및 닫기 (광고가 2-3초 후 나타남)
      await this.humanDelay(2000, 3000);
      await this.closePopups();

      // 5. 회사 검색 결과에서 회사 찾기
      await this.randomMouseMove();

      // 회사 링크 찾기 (검색 결과에서)
      const companyLinkLocator = await this.findCompanyInResultsLocator(searchQuery);
      if (!companyLinkLocator) {
        return {
          found: false,
          searchedCompany: companyName,
          error: '검색 결과에서 회사를 찾을 수 없습니다',
        };
      }

      // 6. 회사 페이지로 이동
      await this.humanDelay(500, 1000);
      await companyLinkLocator.click();
      await this.humanDelay(1500, 2000); // 짧게 기다리고 빠르게 리뷰 탭 클릭 시도
      this.isOnHomepage = false;

      // 7. 리뷰 탭 클릭 (광고가 뜨기 전에 빠르게 시도!)
      const reviewTabSelectors = ['a[href*="reviews"]', 'button:has-text("리뷰")', '[class*="review"][class*="tab"]'];
      let reviewClicked = false;

      // 첫 번째 시도: 광고 뜨기 전에 빠르게 클릭
      for (const selector of reviewTabSelectors) {
        const reviewTab = this.page.locator(selector).first();
        if (await reviewTab.isVisible({ timeout: 500 }).catch(() => false)) {
          try {
            await reviewTab.click({ timeout: 2000 }); // 짧은 타임아웃
            reviewClicked = true;
            console.log('[Blind] 리뷰 탭 클릭 성공 (광고 전)');
            break;
          } catch {
            // 광고에 막혔을 수 있음 - 광고 제거 후 재시도
            console.log('[Blind] 리뷰 클릭 실패, 광고 제거 후 재시도...');
            break;
          }
        }
      }

      // 클릭 실패 시: 광고 제거 후 재시도
      if (!reviewClicked) {
        await this.closePopups();
        await this.humanDelay(500, 1000);

        for (const selector of reviewTabSelectors) {
          const reviewTab = this.page.locator(selector).first();
          if (await reviewTab.isVisible({ timeout: 1000 }).catch(() => false)) {
            try {
              await reviewTab.click({ timeout: 5000 });
              reviewClicked = true;
              console.log('[Blind] 리뷰 탭 클릭 성공 (광고 제거 후)');
              break;
            } catch {
              console.log('[Blind] 리뷰 탭 클릭 재실패');
            }
          }
        }
      }

      if (reviewClicked) {
        await this.humanDelay(1500, 2500);
      }

      await this.randomMouseMove();
      await this.randomScroll();

      // 8. 평점 데이터 추출
      const ratingData = await this.extractRatingData(this.page);

      if (!ratingData) {
        return {
          found: false,
          searchedCompany: companyName,
          error: '평점 데이터를 추출할 수 없습니다',
        };
      }

      // 9. 추출된 회사명이 검색한 회사명과 일치하는지 검증
      const normalizeForValidation = (text: string): string => {
        return text
          .toLowerCase()
          .replace(/\s+/g, '')
          .replace(/[^\w가-힣]/g, '');
      };

      const extractedCompanyName = ratingData.companyName || '';
      const normalizedExtracted = normalizeForValidation(extractedCompanyName);
      const normalizedSearched = normalizeForValidation(searchQuery);

      if (extractedCompanyName && normalizedExtracted !== normalizedSearched) {
        const similarity = this.calculateSimilarity(normalizedSearched, normalizedExtracted);
        console.log(`[Blind] 회사명 검증: "${searchQuery}" vs "${extractedCompanyName}" (유사도: ${similarity.toFixed(2)})`);

        if (similarity < 0.6) {
          console.log(`[Blind] 회사명 불일치! 검색: "${searchQuery}", 추출: "${extractedCompanyName}"`);
          return {
            found: false,
            searchedCompany: companyName,
            error: `잘못된 페이지로 이동됨 (검색: ${searchQuery}, 실제: ${extractedCompanyName})`,
          };
        }
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

      // 9. 다음 검색을 위해 상태 유지 (홈 이동 불필요 - 현재 페이지에도 검색창 있음)
      // isOnHomepage는 false 유지 - 다음 검색 시 goToHomepage()가 호출되지만
      // 검색창이 있으면 바로 검색 진행

      return {
        found: true,
        rating,
        searchedCompany: companyName,
        blindCompanySlug: searchQuery,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.isOnHomepage = false; // 에러 발생 시 상태 리셋
      return {
        found: false,
        searchedCompany: companyName,
        error: errorMessage,
      };
    }
  }

  /**
   * 직접 URL로 검색 (fallback)
   */
  private async searchByDirectUrl(companyName: string, slug: string): Promise<BlindSearchResult> {
    if (!this.page) throw new Error('Page not initialized');

    const url = `https://www.teamblind.com/kr/company/${slug}/reviews`;
    console.log(`[Blind] 직접 URL 이동: ${url}`);

    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.humanDelay(2000, 3000);
    this.isOnHomepage = false;

    await this.randomMouseMove();
    await this.randomScroll();

    // 404 체크
    const notFound = await this.page.$('text="Page not found"');
    if (notFound) {
      return {
        found: false,
        searchedCompany: companyName,
        error: '블라인드에서 회사를 찾을 수 없습니다',
      };
    }

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
      sourceUrl: url,
      crawledAt: new Date(),
      categoryRatings: ratingData.categoryRatings,
    };

    return {
      found: true,
      rating: CompanyRating.create(props),
      searchedCompany: companyName,
      blindCompanySlug: slug,
    };
  }

  /**
   * Levenshtein Distance 계산 (편집 거리)
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix: number[][] = [];

    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0]![j] = j;
    }

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j]! + 1,      // 삭제
          matrix[i]![j - 1]! + 1,      // 삽입
          matrix[i - 1]![j - 1]! + cost // 대체
        );
      }
    }

    return matrix[len1]![len2]!;
  }

  /**
   * 문자열 유사도 계산 (0~1, 1이 완전 일치)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const distance = this.levenshteinDistance(str1, str2);
    const maxLen = Math.max(str1.length, str2.length);
    return maxLen === 0 ? 1 : 1 - distance / maxLen;
  }

  /**
   * 검색 결과에서 회사 링크 찾기 (Locator 버전)
   */
  private async findCompanyInResultsLocator(searchQuery: string): Promise<any> {
    if (!this.page) return null;

    // 검색 결과 로딩 대기
    await this.humanDelay(1000, 2000);

    // 광고/팝업 닫기 시도
    await this.closePopups();

    // 검색어 정규화 (공백, 특수문자 제거하고 소문자로)
    const normalizeText = (text: string): string => {
      return text
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[^\w가-힣]/g, '');
    };

    const normalizedQuery = normalizeText(searchQuery);
    let bestMatch: { link: any; companyName: string; score: number } | null = null;

    // 방법 1: 검색 결과 카드에서 회사명 요소 추출
    const resultCardSelectors = [
      '[class*="SearchResult"]',
      '[class*="search-result"]',
      '[class*="CompanyCard"]',
      '[class*="company-card"]',
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
            '[class*="company-name"]',
            '[class*="companyName"]',
            '[class*="CompanyName"]',
            'h2',
            'h3',
            '[class*="title"]',
            '[class*="name"]',
          ];

          for (const nameSelector of companyNameSelectors) {
            try {
              const nameElement = card.locator(nameSelector).first();
              if (await nameElement.isVisible({ timeout: 500 }).catch(() => false)) {
                const companyName = await nameElement.textContent();
                if (!companyName) continue;

                // 회사명이 30자 이상이면 리뷰/댓글 내용이므로 스킵
                const trimmedName = companyName.trim();
                if (trimmedName.length > 30) continue;

                const normalizedName = normalizeText(companyName);
                const link = card.locator('a[href*="company"]').first();

                if (!(await link.isVisible({ timeout: 500 }).catch(() => false))) continue;

                // 정확히 일치
                if (normalizedName === normalizedQuery) {
                  console.log(`[Blind] 정확한 매칭: "${trimmedName}"`);
                  return link;
                }

                // Levenshtein Distance 기반 유사도 계산
                const similarity = this.calculateSimilarity(normalizedQuery, normalizedName);

                // 유사도가 0.5 이상인 경우에만 후보로 등록
                if (similarity >= 0.5 && (!bestMatch || similarity > bestMatch.score)) {
                  bestMatch = { link, companyName: trimmedName, score: similarity };
                  console.log(`[Blind] 유사 매칭: "${trimmedName}" (유사도: ${similarity.toFixed(2)})`);
                }
                break; // 이 카드에서 회사명을 찾았으므로 다음 카드로
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

    // 방법 2: 직접 회사 링크에서 회사명 추출 (fallback)
    if (!bestMatch) {
      const linkSelectors = [
        'a[href*="/kr/company/"]',
        'a[href*="/company/"]',
      ];

      for (const selector of linkSelectors) {
        try {
          const links = this.page.locator(selector);
          const count = await links.count();

          for (let i = 0; i < count; i++) {
            const link = links.nth(i);
            const href = await link.getAttribute('href');
            const text = await link.textContent();

            if (!href || !text) continue;

            // 텍스트가 30자 이상이면 리뷰/댓글 내용이므로 스킵
            const trimmedText = text.trim();
            if (trimmedText.length > 30) continue;

            // URL에서 회사 슬러그 추출
            const companySlugMatch = href.match(/\/company\/([^\/]+)/);
            const companySlug = companySlugMatch?.[1] ? decodeURIComponent(companySlugMatch[1]) : '';

            const normalizedText = normalizeText(text);
            const normalizedSlug = normalizeText(companySlug);

            // 정확히 일치 (텍스트 또는 슬러그)
            if (normalizedText === normalizedQuery || normalizedSlug === normalizedQuery) {
              console.log(`[Blind] 링크에서 정확한 매칭: "${trimmedText}"`);
              return link;
            }

            // Levenshtein Distance 기반 유사도 계산
            const textSimilarity = this.calculateSimilarity(normalizedQuery, normalizedText);
            const slugSimilarity = normalizedSlug ? this.calculateSimilarity(normalizedQuery, normalizedSlug) : 0;
            const similarity = Math.max(textSimilarity, slugSimilarity);

            // 유사도가 0.5 이상인 경우에만 후보로 등록
            if (similarity >= 0.5 && (!bestMatch || similarity > bestMatch.score)) {
              bestMatch = { link, companyName: trimmedText, score: similarity };
              console.log(`[Blind] 링크에서 유사 매칭: "${trimmedText}" (유사도: ${similarity.toFixed(2)})`);
            }
          }
        } catch {
          continue;
        }
      }
    }

    // 유사도가 0.8 이상인 경우에만 반환 (더 엄격한 매칭)
    if (bestMatch && bestMatch.score >= 0.8) {
      console.log(`[Blind] 최종 선택: "${bestMatch.companyName}" (score: ${bestMatch.score.toFixed(2)})`);
      return bestMatch.link;
    }

    if (bestMatch) {
      console.log(`[Blind] 낮은 유사도로 매칭 실패: "${bestMatch.companyName}" (score: ${bestMatch.score.toFixed(2)}, 최소 0.8 필요)`);
    } else {
      console.log(`[Blind] "${searchQuery}"와 일치하는 회사를 찾을 수 없습니다.`);
    }
    return null;
  }

  /**
   * 팝업/광고 배너 닫기
   */
  private async closePopups(): Promise<void> {
    if (!this.page) return;

    // 1. Google Ads 등 광고 iframe/요소 제거 (JavaScript 사용)
    try {
      await this.page.evaluate(() => {
        // Google Ads 관련 요소 제거
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
          // 일반 광고/오버레이
          '[class*="ad-overlay"]',
          '[class*="ad-wrapper"]',
          '[class*="adContainer"]',
          '[id*="adContainer"]',
        ];

        adSelectors.forEach(selector => {
          document.querySelectorAll(selector).forEach(el => {
            (el as HTMLElement).style.display = 'none';
            (el as HTMLElement).style.visibility = 'hidden';
            (el as HTMLElement).style.pointerEvents = 'none';
            el.remove();
          });
        });

        // body의 overflow 복원 (광고가 스크롤을 막았을 수 있음)
        document.body.style.overflow = 'auto';
        document.documentElement.style.overflow = 'auto';
      });
      console.log('[Blind] 광고 요소 제거 완료');
    } catch (e) {
      // 무시
    }

    // 2. 버튼 클릭으로 닫기 시도
    for (let attempt = 0; attempt < 3; attempt++) {
      let closed = false;

      const closeButtonSelectors = [
        // 일반적인 닫기 버튼
        'button[aria-label*="닫기"]',
        'button[aria-label*="Close"]',
        'button[aria-label*="close"]',
        // X 아이콘 버튼
        '[class*="CloseButton"]',
        '[class*="closeButton"]',
        '[class*="close-button"]',
        // 모달/팝업 닫기
        '[class*="modal"] button:first-child',
        '[class*="Modal"] button:first-child',
        '[class*="popup"] button',
        '[class*="Popup"] button',
        // 배너 닫기
        '[class*="banner"] button',
        '[class*="Banner"] button',
        // 텍스트로 찾기
        'button:has-text("닫기")',
        'button:has-text("Close")',
        // 오버레이 닫기
        '[class*="overlay"] button',
        '[class*="dismiss"]',
      ];

      for (const selector of closeButtonSelectors) {
        try {
          const closeBtn = this.page.locator(selector).first();
          if (await closeBtn.isVisible({ timeout: 300 }).catch(() => false)) {
            console.log(`[Blind] 팝업 닫기: ${selector}`);
            await closeBtn.click();
            await this.humanDelay(300, 500);
            closed = true;
          }
        } catch {
          continue;
        }
      }

      // ESC 키로 닫기 시도
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

  /**
   * 여러 회사 일괄 조회
   */
  async searchMultiple(companyNames: string[]): Promise<BlindSearchResult[]> {
    const results: BlindSearchResult[] = [];

    for (const company of companyNames) {
      const result = await this.searchCompanyRating(company);
      results.push(result);

      // 랜덤 딜레이 (10~20초)
      const delay = this.randomInt(10000, 20000);
      console.log(`  ⏳ 다음 검색까지 ${Math.round(delay / 1000)}초 대기...`);
      await this.delay(delay);
    }

    return results;
  }

  // ===== 인간적 행동 시뮬레이션 =====

  /**
   * 인간처럼 타이핑 (랜덤 딜레이)
   */
  private async humanType(text: string): Promise<void> {
    if (!this.page) return;

    for (const char of text) {
      await this.page.keyboard.type(char, { delay: this.randomInt(50, 150) });
      // 가끔 더 긴 딜레이 (생각하는 듯)
      if (Math.random() < 0.1) {
        await this.humanDelay(200, 500);
      }
    }
  }

  /**
   * 랜덤 마우스 이동
   */
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

  /**
   * 랜덤 스크롤
   */
  private async randomScroll(): Promise<void> {
    if (!this.page) return;

    const scrolls = this.randomInt(1, 3);
    for (let i = 0; i < scrolls; i++) {
      const deltaY = this.randomInt(100, 400) * (Math.random() > 0.3 ? 1 : -1);
      await this.page.mouse.wheel(0, deltaY);
      await this.humanDelay(300, 600);
    }
  }

  /**
   * 인간적 딜레이 (랜덤 범위)
   */
  private async humanDelay(min: number, max: number): Promise<void> {
    const delay = this.randomInt(min, max);
    await this.delay(delay);
  }

  /**
   * 랜덤 정수
   */
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
      console.error('[Blind] 데이터 추출 실패:', error);
      return null;
    }
  }

  private async extractOverallRating(page: Page): Promise<number | null> {
    // 1. JSON-LD Schema.org 마크업에서 추출
    const jsonLdRating = await this.extractFromJsonLd(page, 'ratingValue');
    if (jsonLdRating !== null) return jsonLdRating;

    // 2. 페이지 텍스트에서 평점 패턴 찾기
    const pageText = await page.textContent('body');
    if (pageText) {
      const patterns = [
        /rating\s+of\s+(\d\.?\d*)\s+out\s+of\s+5/i,
        /(\d\.\d)\s*\/\s*5/,
        /(\d\.?\d*)\s+out\s+of\s+5/i,
      ];
      for (const pattern of patterns) {
        const match = pageText.match(pattern);
        if (match?.[1]) return parseFloat(match[1]);
      }
    }

    // 3. CSS 셀렉터로 시도
    const selectors = ['[data-testid="overall-rating"]', '.overall-rating', '.rating-score'];
    for (const selector of selectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text) {
            const match = text.match(/(\d+\.?\d*)/);
            if (match?.[1]) return parseFloat(match[1]);
          }
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private async extractReviewCount(page: Page): Promise<number> {
    // 1. JSON-LD
    const jsonLdCount = await this.extractFromJsonLd(page, 'ratingCount');
    if (jsonLdCount !== null) return jsonLdCount;

    // 2. 페이지 텍스트
    const pageText = await page.textContent('body');
    if (pageText) {
      const patterns = [
        /\(([\d,]+)\s*Reviews?\)/i,
        /([\d,]+)\s*reviews?/i,
        /([\d,]+)\s*company\s*reviews?/i,
      ];
      for (const pattern of patterns) {
        const match = pageText.match(pattern);
        if (match?.[1]) return parseInt(match[1].replace(/,/g, ''), 10);
      }
    }

    // 3. CSS 셀렉터
    const selectors = ['[data-testid="review-count"]', '.review-count'];
    for (const selector of selectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text) {
            const match = text.match(/([\d,]+)/);
            if (match?.[1]) return parseInt(match[1].replace(/,/g, ''), 10);
          }
        }
      } catch {
        continue;
      }
    }

    return 0;
  }

  private async extractCompanyName(page: Page): Promise<string | undefined> {
    // JSON-LD에서 추출
    try {
      const jsonLdScripts = await page.$$eval(
        'script[type="application/ld+json"]',
        (scripts) => scripts.map((s) => s.textContent)
      );

      for (const script of jsonLdScripts) {
        if (!script) continue;
        try {
          const data = JSON.parse(script);
          if (Array.isArray(data)) {
            for (const item of data) {
              if (item['@type'] === 'EmployerAggregateRating' && item.itemReviewed?.name) {
                return item.itemReviewed.name;
              }
            }
          }
          if (data['@type'] === 'EmployerAggregateRating' && data.itemReviewed?.name) {
            return data.itemReviewed.name;
          }
        } catch {
          continue;
        }
      }
    } catch {
      // 무시
    }

    // CSS 셀렉터
    const selectors = ['.company-name', '[data-testid="company-name"]', 'h1'];
    for (const selector of selectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text?.trim()) return text.trim();
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

    const pageText = await page.textContent('body');
    if (pageText) {
      const patterns: Array<{ regex: RegExp; key: keyof CategoryRatings }> = [
        { regex: /work\s*life\s*balance[:\s]*(\d\.?\d*)/i, key: 'workLifeBalance' },
        { regex: /career\s*growth[:\s]*(\d\.?\d*)/i, key: 'careerGrowth' },
        { regex: /compensation[:\s/]*(?:benefits)?[:\s]*(\d\.?\d*)/i, key: 'compensation' },
        { regex: /company\s*culture[:\s]*(\d\.?\d*)/i, key: 'companyCulture' },
        { regex: /management[:\s]*(\d\.?\d*)/i, key: 'management' },
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

    return foundAny ? ratings : undefined;
  }

  private async extractFromJsonLd(page: Page, field: 'ratingValue' | 'ratingCount'): Promise<number | null> {
    try {
      const jsonLdScripts = await page.$$eval(
        'script[type="application/ld+json"]',
        (scripts) => scripts.map((s) => s.textContent)
      );

      for (const script of jsonLdScripts) {
        if (!script) continue;
        try {
          const data = JSON.parse(script);

          // 배열 형태
          if (Array.isArray(data)) {
            for (const item of data) {
              if (item['@type'] === 'EmployerAggregateRating') {
                const value = item[field];
                if (value !== undefined) {
                  return typeof value === 'string' ? parseFloat(value) : value;
                }
              }
            }
          }

          // 직접 EmployerAggregateRating
          if (data['@type'] === 'EmployerAggregateRating') {
            const value = data[field];
            if (value !== undefined) {
              return typeof value === 'string' ? parseFloat(value) : value;
            }
          }

          // @graph 배열
          if (Array.isArray(data['@graph'])) {
            for (const item of data['@graph']) {
              if (item['@type'] === 'EmployerAggregateRating') {
                const value = item[field];
                if (value !== undefined) {
                  return typeof value === 'string' ? parseFloat(value) : value;
                }
              }
            }
          }

          // aggregateRating 속성
          if (data.aggregateRating?.['@type'] === 'EmployerAggregateRating') {
            const value = data.aggregateRating[field];
            if (value !== undefined) {
              return typeof value === 'string' ? parseFloat(value) : value;
            }
          }
        } catch {
          continue;
        }
      }
    } catch {
      // 무시
    }

    return null;
  }

  // ===== 유틸리티 =====

  /**
   * 회사명을 검색어로 변환 (법인 표기 제거)
   */
  private toSearchQuery(companyName: string): string {
    return CompanyRating.toSearchQuery(companyName);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
