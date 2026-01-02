// 블라인드 회사 평점 크롤러

import { chromium, Browser, Page } from 'playwright';
import { CompanyRating, CategoryRatings, CompanyRatingProps } from '../../domain/companyRating.domain.js';

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
  private headless: boolean;
  private timeout: number;

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
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * 회사명으로 블라인드 평점 조회
   */
  async searchCompanyRating(companyName: string): Promise<BlindSearchResult> {
    try {
      await this.init();

      const context = await this.browser!.newContext({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
        extraHTTPHeaders: {
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      });

      const page = await context.newPage();
      page.setDefaultTimeout(this.timeout);

      // 봇 감지 우회를 위한 추가 설정
      await page.addInitScript(() => {
        // webdriver 속성 숨기기
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

        // Chrome 런타임 모킹
        (window as any).chrome = {
          runtime: {},
          loadTimes: () => ({}),
          csi: () => ({}),
        };

        // permissions API 모킹
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters: any) =>
          parameters.name === 'notifications'
            ? Promise.resolve({ state: 'denied' } as PermissionStatus)
            : originalQuery(parameters);

        // plugins 배열 모킹
        Object.defineProperty(navigator, 'plugins', {
          get: () => [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
            { name: 'Native Client', filename: 'internal-nacl-plugin' },
          ],
        });

        // languages 배열
        Object.defineProperty(navigator, 'languages', {
          get: () => ['ko-KR', 'ko', 'en-US', 'en'],
        });
      });

      try {
        // 회사명을 블라인드 URL 슬러그로 변환
        const slug = this.toBlindSlug(companyName);
        // 슬러그에 한글이 포함된 경우 한국 블라인드 경로 사용
        // (영문명이 괄호 안에 있으면 슬러그는 영문이므로 글로벌 경로 사용)
        const isKorean = /[가-힣]/.test(slug);
        const basePath = isKorean ? 'kr/company' : 'company';
        const url = `https://www.teamblind.com/${basePath}/${slug}/reviews`;

        console.log(`[Blind] 검색 중: ${companyName} → ${slug} → ${url}`);

        await page.goto(url, { waitUntil: 'networkidle' });
        await page.waitForTimeout(3000);

        // 회사가 존재하는지 확인 (404 페이지 체크)
        const notFound = await page.$('text="Page not found"');
        if (notFound) {
          return {
            found: false,
            searchedCompany: companyName,
            error: '블라인드에서 회사를 찾을 수 없습니다',
          };
        }

        // 평점 데이터 추출
        const ratingData = await this.extractRatingData(page);

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

        const rating = CompanyRating.create(props);

        return {
          found: true,
          rating,
          searchedCompany: companyName,
          blindCompanySlug: slug,
        };
      } finally {
        await context.close();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        found: false,
        searchedCompany: companyName,
        error: errorMessage,
      };
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

      // Rate limiting
      await this.delay(2000);
    }

    return results;
  }

  private async extractRatingData(page: Page): Promise<{
    companyName?: string;
    overallRating: number;
    reviewCount: number;
    categoryRatings?: CategoryRatings;
  } | null> {
    try {
      // 전체 평점 추출 (여러 셀렉터 시도)
      const overallRating = await this.extractOverallRating(page);
      if (overallRating === null) {
        return null;
      }

      // 리뷰 수 추출
      const reviewCount = await this.extractReviewCount(page);

      // 회사명 추출
      const companyName = await this.extractCompanyName(page);

      // 카테고리별 평점 추출
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
    // 1. JSON-LD Schema.org 마크업에서 추출 (가장 신뢰도 높음)
    const jsonLdRating = await this.extractFromJsonLd(page, 'ratingValue');
    if (jsonLdRating !== null) {
      return jsonLdRating;
    }

    // 2. 페이지 텍스트에서 평점 패턴 찾기
    const pageText = await page.textContent('body');
    if (pageText) {
      // "rating of 4.2 out of 5" 패턴 (블라인드 형식)
      const outOfMatch = pageText.match(/rating\s+of\s+(\d\.?\d*)\s+out\s+of\s+5/i);
      if (outOfMatch?.[1]) {
        return parseFloat(outOfMatch[1]);
      }

      // "4.2/5" 패턴
      const slashMatch = pageText.match(/(\d\.\d)\s*\/\s*5/);
      if (slashMatch?.[1]) {
        return parseFloat(slashMatch[1]);
      }

      // "4.2 out of 5" 패턴
      const simpleOutOfMatch = pageText.match(/(\d\.?\d*)\s+out\s+of\s+5/i);
      if (simpleOutOfMatch?.[1]) {
        return parseFloat(simpleOutOfMatch[1]);
      }
    }

    // CSS 셀렉터로 시도
    const selectors = [
      '[data-testid="overall-rating"]',
      '.overall-rating',
      '.rating-score',
    ];

    for (const selector of selectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text) {
            const match = text.match(/(\d+\.?\d*)/);
            if (match) {
              return parseFloat(match[1]);
            }
          }
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private async extractReviewCount(page: Page): Promise<number> {
    // 1. JSON-LD Schema.org 마크업에서 추출
    const jsonLdCount = await this.extractFromJsonLd(page, 'ratingCount');
    if (jsonLdCount !== null) {
      return jsonLdCount;
    }

    // 2. 페이지 텍스트에서 리뷰 수 패턴 찾기
    const pageText = await page.textContent('body');
    if (pageText) {
      // "(11,614 Reviews)" 패턴
      const parenMatch = pageText.match(/\(([\d,]+)\s*Reviews?\)/i);
      if (parenMatch) {
        return parseInt(parenMatch[1].replace(/,/g, ''), 10);
      }

      // "11,614 reviews" 패턴
      const simpleMatch = pageText.match(/([\d,]+)\s*reviews?/i);
      if (simpleMatch) {
        return parseInt(simpleMatch[1].replace(/,/g, ''), 10);
      }

      // "11,614 company reviews" 패턴
      const companyMatch = pageText.match(/([\d,]+)\s*company\s*reviews?/i);
      if (companyMatch) {
        return parseInt(companyMatch[1].replace(/,/g, ''), 10);
      }
    }

    // CSS 셀렉터로 시도
    const selectors = [
      '[data-testid="review-count"]',
      '.review-count',
    ];

    for (const selector of selectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text) {
            const match = text.match(/([\d,]+)/);
            if (match) {
              return parseInt(match[1].replace(/,/g, ''), 10);
            }
          }
        }
      } catch {
        continue;
      }
    }

    return 0;
  }

  private async extractCompanyName(page: Page): Promise<string | undefined> {
    // 1. JSON-LD에서 회사명 추출 (가장 신뢰도 높음)
    const jsonLdName = await this.extractCompanyNameFromJsonLd(page);
    if (jsonLdName) {
      return jsonLdName;
    }

    // 2. CSS 셀렉터로 시도
    const selectors = ['.company-name', '[data-testid="company-name"]'];

    for (const selector of selectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text && text.trim().length > 0) {
            return text.trim();
          }
        }
      } catch {
        continue;
      }
    }

    return undefined;
  }

  private async extractCompanyNameFromJsonLd(page: Page): Promise<string | undefined> {
    try {
      const jsonLdScripts = await page.$$eval(
        'script[type="application/ld+json"]',
        (scripts) => scripts.map((s) => s.textContent)
      );

      for (const script of jsonLdScripts) {
        if (!script) continue;

        try {
          const data = JSON.parse(script);

          // 배열 형태인 경우
          if (Array.isArray(data)) {
            for (const item of data) {
              if (item['@type'] === 'EmployerAggregateRating' && item.itemReviewed?.name) {
                return item.itemReviewed.name;
              }
            }
          }

          // 직접 EmployerAggregateRating인 경우
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

    return undefined;
  }

  private async extractCategoryRatings(page: Page): Promise<CategoryRatings | undefined> {
    const ratings: CategoryRatings = {};
    let foundAny = false;

    // 페이지 텍스트에서 카테고리별 평점 추출
    const pageText = await page.textContent('body');
    if (pageText) {
      // "Work Life Balance 4.4" 또는 "Work Life Balance: 4.4" 패턴
      const patterns: Array<{ regex: RegExp; key: keyof CategoryRatings }> = [
        { regex: /work\s*life\s*balance[:\s]*(\d\.?\d*)/i, key: 'workLifeBalance' },
        { regex: /career\s*growth[:\s]*(\d\.?\d*)/i, key: 'careerGrowth' },
        { regex: /compensation[:\s/]*(?:benefits)?[:\s]*(\d\.?\d*)/i, key: 'compensation' },
        { regex: /company\s*culture[:\s]*(\d\.?\d*)/i, key: 'companyCulture' },
        { regex: /management[:\s]*(\d\.?\d*)/i, key: 'management' },
      ];

      for (const { regex, key } of patterns) {
        const match = pageText.match(regex);
        if (match && match[1]) {
          const value = parseFloat(match[1]);
          if (value >= 0 && value <= 5) {
            ratings[key] = value;
            foundAny = true;
          }
        }
      }
    }

    // CSS 셀렉터로도 시도
    if (!foundAny) {
      const categoryElements = await page.$$('[class*="category"], [class*="rating-item"], [class*="flex"][class*="gap"]');

      const categoryMapping: Record<string, keyof CategoryRatings> = {
        'work life balance': 'workLifeBalance',
        'work-life balance': 'workLifeBalance',
        'career growth': 'careerGrowth',
        compensation: 'compensation',
        'company culture': 'companyCulture',
        culture: 'companyCulture',
        management: 'management',
      };

      for (const element of categoryElements) {
        try {
          const text = await element.textContent();
          if (!text) continue;

          const lowerText = text.toLowerCase();

          for (const [pattern, key] of Object.entries(categoryMapping)) {
            if (lowerText.includes(pattern)) {
              const match = text.match(/(\d\.?\d*)/);
              if (match) {
                const value = parseFloat(match[1]);
                if (value >= 0 && value <= 5) {
                  ratings[key] = value;
                  foundAny = true;
                }
              }
              break;
            }
          }
        } catch {
          continue;
        }
      }
    }

    return foundAny ? ratings : undefined;
  }

  /**
   * 회사명을 블라인드 URL 슬러그로 변환
   * 1. 괄호 안에 영문명이 있으면 영문명 사용 (예: "루닛(Lunit)" → "Lunit")
   * 2. 괄호 안에 한글이 있으면 괄호 앞 부분 사용 (예: "페이타랩(패스오더)" → "페이타랩")
   * 3. 괄호 없으면 그대로 사용
   */
  private toBlindSlug(companyName: string): string {
    let cleanName = companyName.trim();

    // 괄호 안 영문명 추출 시도 (예: "루닛(Lunit)" → "Lunit")
    const englishMatch = cleanName.match(/\(([A-Za-z][A-Za-z0-9\s]*)\)/);
    if (englishMatch) {
      cleanName = englishMatch[1].trim();
    } else {
      // 괄호가 있으면 괄호 앞 부분만 사용 (예: "페이타랩(패스오더)" → "페이타랩")
      const parenIndex = cleanName.indexOf('(');
      if (parenIndex > 0) {
        cleanName = cleanName.substring(0, parenIndex).trim();
      }
    }

    return cleanName
      .replace(/\s+/g, '-')
      .replace(/[.]/g, '-')
      .replace(/[^a-zA-Z0-9-가-힣]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * JSON-LD Schema.org 마크업에서 EmployerAggregateRating 데이터 추출
   */
  private async extractFromJsonLd(
    page: Page,
    field: 'ratingValue' | 'ratingCount'
  ): Promise<number | null> {
    try {
      const jsonLdScripts = await page.$$eval(
        'script[type="application/ld+json"]',
        (scripts) => scripts.map((s) => s.textContent)
      );

      for (const script of jsonLdScripts) {
        if (!script) continue;

        try {
          const data = JSON.parse(script);

          // 배열 형태인 경우 (한국 블라인드는 이 형태)
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

          // 직접 EmployerAggregateRating인 경우
          if (data['@type'] === 'EmployerAggregateRating') {
            const value = data[field];
            if (value !== undefined) {
              return typeof value === 'string' ? parseFloat(value) : value;
            }
          }

          // @graph 배열 내에 있는 경우
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

          // aggregateRating 속성으로 중첩된 경우
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
      // JSON-LD 추출 실패 시 무시
    }

    return null;
  }
}
