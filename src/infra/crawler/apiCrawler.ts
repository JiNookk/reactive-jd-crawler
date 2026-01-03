// API 기반 크롤링 전략
import * as https from 'node:https';
import type { OutgoingHttpHeaders } from 'node:http';
import * as cheerio from 'cheerio';
import { JobPosting } from '../../domain/jobPosting.domain.js';
import { PageStructure, ListPageSelectors, ApiConfig } from '../../domain/pageStructure.domain.js';

export interface ApiCrawlOptions {
  company: string;
  maxPages?: number;
  pageSize?: number;
  startPage?: number;
  extraParams?: Record<string, string>;
}

export interface ApiCrawlResult {
  jobs: JobPosting[];
  totalCount: number;
  pagesProcessed: number;
  errors: string[];
}

/**
 * API 기반 크롤러
 * PageStructure.strategy === 'api'일 때 사용
 */
export class ApiCrawler {
  async crawl(
    url: string,
    structure: PageStructure,
    options: ApiCrawlOptions
  ): Promise<ApiCrawlResult> {
    const { company, maxPages = 1, pageSize = 40, startPage = 1, extraParams = {} } = options;

    if (structure.strategy !== 'api') {
      throw new Error('[ApiCrawler] API 전략이 아닙니다. DOM 크롤러를 사용하세요.');
    }

    if (!structure.apiConfig) {
      throw new Error('[ApiCrawler] apiConfig가 없습니다.');
    }

    const baseUrl = this.extractBaseUrl(url);
    const allJobs: JobPosting[] = [];
    const errors: string[] = [];
    let pagesProcessed = 0;
    let totalCount = 0;

    for (let page = startPage; page < startPage + maxPages; page++) {
      console.log(`[ApiCrawler] 페이지 ${page} 요청 중...`);

      try {
        const html = await this.fetchPage(
          baseUrl,
          structure.apiConfig,
          page,
          pageSize,
          extraParams
        );

        const { jobs, total } = this.parseHtml(
          html,
          baseUrl,
          structure.selectors as ListPageSelectors,
          company
        );

        if (page === startPage && total > 0) {
          totalCount = total;
          console.log(`[ApiCrawler] 총 ${total}건 발견`);
        }

        allJobs.push(...jobs);
        pagesProcessed++;

        console.log(`[ApiCrawler] 페이지 ${page}: ${jobs.length}개 추출`);

        // 더 이상 데이터가 없으면 종료
        if (jobs.length === 0) {
          console.log('[ApiCrawler] 더 이상 데이터 없음, 종료');
          break;
        }

        // Rate limiting
        if (page < startPage + maxPages - 1) {
          await this.delay(1000);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push(`페이지 ${page}: ${errorMessage}`);
        console.error(`[ApiCrawler] 페이지 ${page} 실패:`, errorMessage);
        break;
      }
    }

    return {
      jobs: allJobs,
      totalCount: totalCount || allJobs.length,
      pagesProcessed,
      errors,
    };
  }

  private extractBaseUrl(url: string): string {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  }

  private async fetchPage(
    baseUrl: string,
    apiConfig: ApiConfig,
    page: number,
    pageSize: number,
    extraParams: Record<string, string>
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const fullUrl = new URL(baseUrl + apiConfig.endpoint);

      // 파라미터 설정
      const params = new URLSearchParams();

      // apiConfig.params의 키-값 매핑 처리
      // 예: { page: 'page', pageSize: 'pagesize' } → page=1, pagesize=40
      if (apiConfig.params) {
        for (const [logicalKey, actualKey] of Object.entries(apiConfig.params)) {
          if (logicalKey === 'page') {
            params.set(actualKey, String(page));
          } else if (logicalKey === 'pageSize') {
            params.set(actualKey, String(pageSize));
          } else {
            // 그 외 정적 파라미터
            params.set(logicalKey, actualKey);
          }
        }
      }

      // 추가 파라미터 (직무코드 등)
      for (const [key, value] of Object.entries(extraParams)) {
        params.set(key, value);
      }

      const headers: OutgoingHttpHeaders = {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html, */*; q=0.01',
        ...apiConfig.headers,
      };

      const body = params.toString();
      if (apiConfig.method === 'POST') {
        headers['Content-Length'] = Buffer.byteLength(body);
      }

      const options: https.RequestOptions = {
        hostname: fullUrl.hostname,
        path: fullUrl.pathname,
        method: apiConfig.method,
        headers,
      };

      if (apiConfig.method !== 'POST') {
        // GET 요청일 경우 쿼리스트링으로
        options.path = `${fullUrl.pathname}?${body}`;
      }

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      });

      req.on('error', reject);

      if (apiConfig.method === 'POST') {
        req.write(body);
      }

      req.end();
    });
  }

  private parseHtml(
    html: string,
    baseUrl: string,
    selectors: ListPageSelectors,
    company: string
  ): { jobs: JobPosting[]; total: number } {
    const $ = cheerio.load(html);
    const jobs: JobPosting[] = [];

    // 총 건수 추출 시도 (다양한 패턴)
    let total = 0;

    // 패턴 1: hidden input (잡코리아 스타일)
    const hiddenTotal = $('input[type="hidden"]').filter(function () {
      const val = $(this).val();
      return typeof val === 'string' && /^[\d,]+$/.test(val);
    }).first().val();
    if (hiddenTotal) {
      total = parseInt(String(hiddenTotal).replace(/,/g, ''), 10);
    }

    // 패턴 2: 텍스트에서 추출 (예: "총 1,234건")
    if (total === 0) {
      const totalMatch = html.match(/총\s*([\d,]+)\s*건/);
      if (totalMatch && totalMatch[1]) {
        total = parseInt(totalMatch[1].replace(/,/g, ''), 10);
      }
    }

    // 채용공고 항목 파싱
    const now = new Date();
    $(selectors.jobItem).each((index, element) => {
      const $item = $(element);

      const title = selectors.title
        ? $item.find(selectors.title).text().trim()
        : '';

      const companyName = selectors.department
        ? $item.find(selectors.department).text().trim()
        : company;

      const location = selectors.location
        ? $item.find(selectors.location).text().trim()
        : undefined;

      const href = selectors.detailLink
        ? $item.find(selectors.detailLink).attr('href')
        : undefined;

      if (title && href) {
        const sourceUrl = this.resolveUrl(baseUrl, href);
        const id = `${company.toLowerCase().replace(/\s+/g, '-')}-${index}-${Date.now()}`;

        jobs.push(
          JobPosting.create({
            id,
            title,
            company: companyName || company,
            location,
            sourceUrl,
            crawledAt: now,
          })
        );
      }
    });

    return { jobs, total };
  }

  private resolveUrl(baseUrl: string, href: string): string {
    if (href.startsWith('http')) {
      return href;
    }
    return baseUrl + (href.startsWith('/') ? '' : '/') + href;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
