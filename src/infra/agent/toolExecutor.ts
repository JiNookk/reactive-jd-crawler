// 도구 실행기 - Playwright 페이지에서 도구 실행
import { Page } from 'playwright';
import {
  ToolResult,
  NavigateInput,
  ClickInput,
  ScrollInput,
  InputTextInput,
  WaitInput,
  ExtractJobsInput,
  ExtractJobDetailInput,
  DoneInput,
} from './tools.js';

export interface ExtractedJob {
  title: string;
  company?: string; // 실제 회사명
  location?: string;
  department?: string; // 부서/팀 (optional)
  detailUrl?: string;
}

export interface PageInfo {
  url: string;
  title: string;
  // 셀렉터 후보들 (Agent가 어떤 셀렉터를 시도할지 결정하는 데 사용)
  selectorCandidates: { selector: string; count: number; sample: string }[];
  // 직무 관련 링크들 (Engineer, Manager 등 직함이 포함된 링크)
  jobLinks: { text: string; href: string; parentClass: string }[];
  // 버튼들
  visibleButtons: { text: string; selector: string; tagName: string }[];
  // 페이지네이션 정보
  paginationInfo: string | null;
  // 페이지네이션 타입 감지
  paginationType: {
    type: 'button' | 'load-more' | 'infinite-scroll' | 'url-param' | 'none' | 'unknown';
    nextSelector?: string;
    loadMoreSelector?: string;
    currentPage?: number;
    totalPages?: number;
    urlPattern?: string;
  };
  // 필터/드롭다운 정보
  filterInfo: { text: string; tagName: string; className: string }[];
  // 모달 여부
  hasModal: boolean;
  // 결과 수 표시 (예: "123 jobs")
  resultCount: string | null;
}

export class ToolExecutor {
  constructor(
    private page: Page,
    private company: string
  ) {}

  async execute(toolName: string, input: unknown): Promise<ToolResult> {
    try {
      switch (toolName) {
        case 'navigate':
          return await this.navigate(input as NavigateInput);
        case 'click':
          return await this.click(input as ClickInput);
        case 'scroll':
          return await this.scroll(input as ScrollInput);
        case 'input_text':
          return await this.inputText(input as InputTextInput);
        case 'wait':
          return await this.wait(input as WaitInput);
        case 'get_page_info':
          return await this.getPageInfo();
        case 'extract_jobs':
          return await this.extractJobs(input as ExtractJobsInput);
        case 'extract_job_detail':
          return await this.extractJobDetail(input as ExtractJobDetailInput);
        case 'done':
          return this.done(input as DoneInput);
        default:
          return { success: false, error: `알 수 없는 도구: ${toolName}` };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async navigate(input: NavigateInput): Promise<ToolResult> {
    const { url } = input;

    try {
      await this.page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
      await this.page.waitForTimeout(2000); // 페이지 로드 후 안정화 대기

      return {
        success: true,
        data: {
          message: `${url}로 이동 완료`,
          currentUrl: this.page.url(),
        },
      };
    } catch {
      return {
        success: false,
        error: `페이지 이동 실패: ${url}`,
      };
    }
  }

  private async click(input: ClickInput): Promise<ToolResult> {
    const { selector } = input;

    try {
      // 요소가 존재하고 보이는지 확인
      await this.page.waitForSelector(selector, { timeout: 5000, state: 'visible' });
      await this.page.click(selector);
      await this.page.waitForTimeout(1500); // 클릭 후 페이지 변화 대기

      return {
        success: true,
        data: { message: `${selector} 클릭 완료` },
      };
    } catch {
      return {
        success: false,
        error: `요소를 찾을 수 없거나 클릭할 수 없음: ${selector}`,
      };
    }
  }

  private async scroll(input: ScrollInput): Promise<ToolResult> {
    const direction = input.direction || 'down';
    const amount = input.amount || 500;

    const scrollAmount = direction === 'down' ? amount : -amount;

    await this.page.evaluate((pixels) => {
      window.scrollBy(0, pixels);
    }, scrollAmount);

    await this.page.waitForTimeout(1000); // 스크롤 후 로딩 대기

    // 현재 스크롤 위치 반환
    const scrollPosition = await this.page.evaluate(() => ({
      y: window.scrollY,
      maxY: document.documentElement.scrollHeight - window.innerHeight,
    }));

    return {
      success: true,
      data: {
        message: `${direction}으로 ${amount}px 스크롤`,
        currentPosition: scrollPosition.y,
        maxPosition: scrollPosition.maxY,
        atBottom: scrollPosition.y >= scrollPosition.maxY - 10,
      },
    };
  }

  private async inputText(input: InputTextInput): Promise<ToolResult> {
    const { selector, text } = input;

    try {
      await this.page.waitForSelector(selector, { timeout: 5000 });
      await this.page.fill(selector, text);
      await this.page.waitForTimeout(500);

      return {
        success: true,
        data: { message: `${selector}에 "${text}" 입력 완료` },
      };
    } catch {
      return {
        success: false,
        error: `입력 필드를 찾을 수 없음: ${selector}`,
      };
    }
  }

  private async wait(input: WaitInput): Promise<ToolResult> {
    const ms = input.ms || 1000;
    await this.page.waitForTimeout(ms);

    return {
      success: true,
      data: { message: `${ms}ms 대기 완료` },
    };
  }

  private async getPageInfo(): Promise<ToolResult> {
    const info = await this.page.evaluate(() => {
      // 직무 관련 요소들의 셀렉터 후보 수집
      const selectorCandidates: { selector: string; count: number; sample: string }[] = [];

      const patterns = [
        '[class*="job"]',
        '[class*="career"]',
        '[class*="position"]',
        '[class*="opening"]',
        '[class*="listing"]',
        '[class*="vacancy"]',
        '[class*="card"]',
        '[class*="item"]',
        '[class*="result"]',
        'li',
        'article',
        '[role="listitem"]',
      ];

      for (const pattern of patterns) {
        const elements = document.querySelectorAll(pattern);
        if (elements.length > 0 && elements.length < 500) {
          const firstEl = elements[0];
          if (firstEl) {
            const text = firstEl.textContent?.trim().substring(0, 100) || '';
            // 직무 관련 키워드가 포함된 것만
            if (text.length > 10) {
              selectorCandidates.push({
                selector: pattern,
                count: elements.length,
                sample: text,
              });
            }
          }
        }
      }

      // 직무 관련 링크들 (Engineer, Manager 등 직함 포함)
      const jobLinks = Array.from(document.querySelectorAll('a'))
        .filter((a) => {
          const text = a.textContent?.trim().toLowerCase() || '';
          const href = a.href || '';
          return (
            text.match(/engineer|manager|designer|analyst|developer|architect|scientist|lead|director|specialist/i) ||
            href.includes('job') ||
            href.includes('career') ||
            href.includes('position')
          );
        })
        .slice(0, 15)
        .map((a) => ({
          text: a.textContent?.trim().substring(0, 80) || '',
          href: a.href,
          parentClass: a.parentElement?.className || '',
        }));

      // 버튼들 수집 (더 정확한 셀렉터)
      const buttons = Array.from(
        document.querySelectorAll('button, [role="button"], a.btn, .button, [class*="btn"]')
      )
        .filter((el) => {
          const text = el.textContent?.trim();
          const style = window.getComputedStyle(el);
          return text && text.length < 50 && style.display !== 'none';
        })
        .slice(0, 15)
        .map((el) => {
          // 더 정확한 셀렉터 생성
          let selector = '';
          if (el.id) {
            selector = `#${el.id}`;
          } else if (el.className && typeof el.className === 'string') {
            const classes = el.className.split(' ').filter(c => c.length > 0).slice(0, 2).join('.');
            selector = classes ? `.${classes}` : el.tagName.toLowerCase();
          } else {
            selector = el.tagName.toLowerCase();
          }
          return {
            text: el.textContent?.trim() || '',
            selector,
            tagName: el.tagName,
          };
        });

      // 페이지네이션 정보
      const paginationEl = document.querySelector(
        '[class*="pagination"], [class*="pager"], [class*="page-nav"], [class*="page-number"]'
      );
      const paginationInfo = paginationEl ? paginationEl.textContent?.trim().substring(0, 100) || null : null;

      // 필터/드롭다운 정보
      const filterEls = document.querySelectorAll(
        '[class*="filter"], select, [class*="dropdown"], [class*="select"]'
      );
      const filterInfo = Array.from(filterEls)
        .slice(0, 5)
        .map((el) => ({
          text: el.textContent?.trim().substring(0, 50) || '',
          tagName: el.tagName,
          className: (el as HTMLElement).className || '',
        }));

      // 모달 확인
      const hasModal = !!(
        document.querySelector('[class*="modal"]:not([style*="display: none"])') ||
        document.querySelector('[role="dialog"]')
      );

      // 결과 수 표시 찾기
      const bodyText = document.body.innerText;
      const resultMatch = bodyText.match(/(\d+)\s*(results?|jobs?|positions?|openings?)/i);
      const resultCount = resultMatch ? resultMatch[0] : null;

      // 페이지네이션 타입 감지
      const paginationType: {
        type: 'button' | 'load-more' | 'infinite-scroll' | 'url-param' | 'none' | 'unknown';
        nextSelector?: string;
        loadMoreSelector?: string;
        currentPage?: number;
        totalPages?: number;
        urlPattern?: string;
      } = { type: 'unknown' };

      // 1. Load More 버튼 탐지
      const loadMorePatterns = [
        '[class*="load-more"]',
        '[class*="loadmore"]',
        '[class*="show-more"]',
        '[class*="view-more"]',
        'button:has-text("Load More")',
        'button:has-text("더 보기")',
        'button:has-text("View More")',
        'button:has-text("Show More")',
        'a:has-text("Load More")',
        'a:has-text("더 보기")',
      ];

      for (const pattern of loadMorePatterns) {
        try {
          const el = document.querySelector(pattern);
          if (el) {
            paginationType.type = 'load-more';
            paginationType.loadMoreSelector = pattern;
            break;
          }
        } catch {
          // :has-text 같은 비표준 셀렉터는 무시
        }
      }

      // Load More 버튼 텍스트로 탐지
      if (paginationType.type === 'unknown') {
        const allButtons = Array.from(document.querySelectorAll('button, a.btn, [role="button"]'));
        const loadMoreBtn = allButtons.find((btn) => {
          const text = btn.textContent?.trim().toLowerCase() || '';
          return (
            text.includes('load more') ||
            text.includes('더 보기') ||
            text.includes('view more') ||
            text.includes('show more') ||
            text === 'more'
          );
        });
        if (loadMoreBtn) {
          paginationType.type = 'load-more';
          const id = loadMoreBtn.id ? `#${loadMoreBtn.id}` : null;
          const classes =
            loadMoreBtn.className && typeof loadMoreBtn.className === 'string'
              ? '.' + loadMoreBtn.className.split(' ').filter((c) => c).slice(0, 2).join('.')
              : null;
          paginationType.loadMoreSelector = id || classes || loadMoreBtn.tagName.toLowerCase();
        }
      }

      // 2. Next 버튼 탐지 (숫자 페이지네이션)
      if (paginationType.type === 'unknown') {
        const nextPatterns = [
          '[class*="next"]',
          '[aria-label*="next"]',
          '[aria-label*="Next"]',
          'a:has-text("Next")',
          'a:has-text("다음")',
          'button:has-text("Next")',
          'button:has-text("다음")',
          '[class*="pagination"] a:last-child',
          '[class*="pager"] a:last-child',
        ];

        for (const pattern of nextPatterns) {
          try {
            const el = document.querySelector(pattern);
            if (el) {
              const text = el.textContent?.trim().toLowerCase() || '';
              const isDisabled = el.hasAttribute('disabled') || el.classList.contains('disabled');
              if (!isDisabled && (text.includes('next') || text.includes('다음') || text === '>' || text === '›')) {
                paginationType.type = 'button';
                paginationType.nextSelector = pattern;
                break;
              }
            }
          } catch {
            // 비표준 셀렉터 무시
          }
        }

        // Next 버튼 텍스트로 탐지
        if (paginationType.type === 'unknown') {
          const allLinks = Array.from(document.querySelectorAll('a, button'));
          const nextBtn = allLinks.find((link) => {
            const text = link.textContent?.trim().toLowerCase() || '';
            const isDisabled =
              link.hasAttribute('disabled') || link.classList.contains('disabled');
            return (
              !isDisabled &&
              (text === 'next' ||
                text === '다음' ||
                text === '>' ||
                text === '›' ||
                text === '>>' ||
                text === '»')
            );
          });
          if (nextBtn) {
            paginationType.type = 'button';
            const id = nextBtn.id ? `#${nextBtn.id}` : null;
            const classes =
              nextBtn.className && typeof nextBtn.className === 'string'
                ? '.' + nextBtn.className.split(' ').filter((c) => c).slice(0, 2).join('.')
                : null;
            paginationType.nextSelector = id || classes || 'a';
          }
        }
      }

      // 3. URL 파라미터 페이지네이션 탐지
      if (paginationType.type === 'unknown') {
        const urlParams = new URLSearchParams(window.location.search);

        // 일반적인 페이지네이션 파라미터 확인
        const pageParams = ['page', 'p', 'pg', 'offset', 'start', 'from'];
        for (const param of pageParams) {
          const value = urlParams.get(param);
          if (value !== null) {
            paginationType.type = 'url-param';
            paginationType.currentPage = parseInt(value, 10) || 0;
            paginationType.urlPattern = `${param}=${value}`;
            break;
          }
        }
      }

      // 4. 페이지네이션 요소는 있지만 타입 불명확
      if (paginationType.type === 'unknown' && paginationEl) {
        // 페이지 번호가 있는지 확인
        const pageNumbers = paginationEl.querySelectorAll('a, button');
        const hasNumbers = Array.from(pageNumbers).some((el) => /^\d+$/.test(el.textContent?.trim() || ''));
        if (hasNumbers) {
          paginationType.type = 'button';
        }
      }

      // 5. 무한 스크롤 감지 (스크롤 가능한 높이가 뷰포트보다 훨씬 큼)
      if (paginationType.type === 'unknown') {
        const scrollHeight = document.documentElement.scrollHeight;
        const viewportHeight = window.innerHeight;
        if (scrollHeight > viewportHeight * 2) {
          // 페이지네이션 요소가 없고 스크롤 가능하면 무한 스크롤 가능성
          paginationType.type = 'infinite-scroll';
        }
      }

      // 페이지네이션 요소도 없고 스크롤도 짧으면 단일 페이지
      if (paginationType.type === 'unknown') {
        paginationType.type = 'none';
      }

      return {
        url: window.location.href,
        title: document.title,
        selectorCandidates,
        jobLinks,
        visibleButtons: buttons,
        paginationInfo,
        paginationType,
        filterInfo,
        hasModal,
        resultCount,
      };
    });

    return {
      success: true,
      data: info as PageInfo,
    };
  }

  private async extractJobs(input: ExtractJobsInput): Promise<ToolResult> {
    const { jobCardSelector } = input;

    const jobs = await this.page.evaluate((selector) => {
      const cards = document.querySelectorAll(selector);
      return Array.from(cards).map((card) => {
        // 제목 찾기
        const titleEl =
          card.querySelector('h1, h2, h3, h4, [class*="title"], a') ||
          card.querySelector('strong, b');
        const title = titleEl?.textContent?.trim() || '';

        // 위치 찾기
        const locationEl = card.querySelector('[class*="location"], [class*="place"]');
        const location = locationEl?.textContent?.trim();

        // 부서 찾기
        const deptEl = card.querySelector(
          '[class*="department"], [class*="team"], [class*="category"]'
        );
        const department = deptEl?.textContent?.trim();

        // 상세 링크 찾기
        const linkEl = card.querySelector('a[href]') as HTMLAnchorElement | null;
        const detailUrl = linkEl?.href;

        return { title, location, department, detailUrl };
      });
    }, jobCardSelector);

    // 제목이 있는 것만 필터링
    const validJobs = jobs.filter((j) => j.title && j.title.length > 0);

    return {
      success: true,
      data: {
        count: validJobs.length,
        jobs: validJobs as ExtractedJob[],
      },
    };
  }

  private async extractJobDetail(input: ExtractJobDetailInput): Promise<ToolResult> {
    const containerSelector = input.containerSelector || 'body';

    const detail = await this.page.evaluate((selector) => {
      const container = document.querySelector(selector) || document.body;
      const text = (container as HTMLElement).innerText || container.textContent || '';

      // 제목 추출
      const titleEl = container.querySelector('h1, h2, [class*="title"]');
      const title = titleEl?.textContent?.trim() || '';

      // 위치 추출
      const locationMatch = text.match(
        /location[:\s]+([^\n]+)/i
      );
      const location = locationMatch?.[1]?.trim();

      // 설명 추출 (전체 텍스트의 일부)
      const description = text.substring(0, 2000);

      return { title, location, description };
    }, containerSelector);

    return {
      success: true,
      data: detail,
    };
  }

  private done(input: DoneInput): ToolResult {
    return {
      success: true,
      data: {
        completed: true,
        reason: input.reason,
      },
    };
  }
}
