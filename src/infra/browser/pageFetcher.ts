// Playwright를 사용한 페이지 로드
import { chromium, Browser, Page, BrowserContext } from 'playwright';

export interface FetchedPage {
  url: string;
  html: string;
  title: string;
}

export interface PageFetcherOptions {
  headless?: boolean;
  timeout?: number;
  waitForSelector?: string;
  userAgent?: string;
}

const DEFAULT_OPTIONS: Required<PageFetcherOptions> = {
  headless: true,
  timeout: 30000,
  waitForSelector: 'body',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

export class PageFetcher {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private options: Required<PageFetcherOptions>;

  constructor(options: PageFetcherOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async init(): Promise<void> {
    if (this.browser) return;

    this.browser = await chromium.launch({
      headless: this.options.headless,
    });

    this.context = await this.browser.newContext({
      userAgent: this.options.userAgent,
      viewport: { width: 1920, height: 1080 },
    });
  }

  async fetch(url: string, waitForSelector?: string): Promise<FetchedPage> {
    if (!this.browser || !this.context) {
      await this.init();
    }

    const page = await this.context!.newPage();

    try {
      // 페이지 로드
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: this.options.timeout,
      });

      // 특정 셀렉터 대기 (옵션)
      const selector = waitForSelector || this.options.waitForSelector;
      if (selector && selector !== 'body') {
        await page.waitForSelector(selector, {
          timeout: this.options.timeout,
        });
      }

      // 동적 콘텐츠 로드 대기 (추가 시간)
      await page.waitForTimeout(1000);

      const html = await page.content();
      const title = await page.title();

      return {
        url: page.url(), // 리다이렉트 후 URL
        html,
        title,
      };
    } finally {
      await page.close();
    }
  }

  async fetchWithScroll(url: string, maxScrolls: number = 5): Promise<FetchedPage> {
    if (!this.browser || !this.context) {
      await this.init();
    }

    const page = await this.context!.newPage();

    try {
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: this.options.timeout,
      });

      // 무한 스크롤 처리
      for (let i = 0; i < maxScrolls; i++) {
        await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });
        await page.waitForTimeout(1500);
      }

      const html = await page.content();
      const title = await page.title();

      return {
        url: page.url(),
        html,
        title,
      };
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  // 페이지 객체 직접 접근이 필요한 경우
  async getPage(): Promise<Page> {
    if (!this.browser || !this.context) {
      await this.init();
    }
    return this.context!.newPage();
  }
}
