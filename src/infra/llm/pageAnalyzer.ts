// LLM을 사용한 페이지 구조 분석
import Anthropic from '@anthropic-ai/sdk';
import {
  PageStructure,
  PageType,
  PaginationType,
  ListPageSelectors,
  DetailPageSelectors,
  PaginationConfig,
  CrawlStrategy,
  ApiConfig,
} from '../../domain/pageStructure.domain.js';

export interface AnalysisResult {
  pageType: PageType;
  urlPattern: string;
  selectors: ListPageSelectors | DetailPageSelectors;
  pagination?: PaginationConfig;
  strategy?: CrawlStrategy;
  apiConfig?: ApiConfig;
}

const SYSTEM_PROMPT = `당신은 웹 페이지 HTML 구조를 분석하는 전문가입니다.
채용 사이트의 HTML을 분석하여 직무 목록이나 직무 상세 정보를 추출할 수 있는 CSS 셀렉터를 찾아주세요.

응답은 반드시 유효한 JSON 형식으로만 해주세요. 다른 설명 없이 JSON만 반환하세요.`;

const LIST_PAGE_PROMPT = `이 HTML은 채용 사이트의 직무 목록 페이지입니다.
다음 정보를 찾아 JSON으로 반환해주세요:

1. pageType: "list" (고정)
2. urlPattern: 현재 URL의 패턴 (동적 ID 부분은 :id로 표시)
3. strategy: 데이터 추출 전략
   - "dom": 현재 HTML에 채용공고 데이터가 이미 포함되어 있음 (기본값)
   - "api": HTML에 데이터가 없거나 비어있고, JavaScript로 별도 API를 호출해서 데이터를 로드함

   API 전략 판단 기준:
   - 목록 영역이 비어있거나 로딩 스피너만 있음
   - "Loading", "데이터를 불러오는 중" 같은 로딩 텍스트가 있음
   - data-* 속성이나 JavaScript 변수에 API 엔드포인트 힌트가 있음
   - 실제 채용공고 항목이 0개임

4. apiConfig: (strategy가 "api"일 때만)
   - endpoint: API 엔드포인트 경로 (HTML에서 찾을 수 있다면)
   - method: "GET" 또는 "POST"

5. selectors:
   - jobList: 직무 목록 전체를 감싸는 컨테이너 셀렉터 (필수)
   - jobItem: 개별 직무 항목 셀렉터 (필수)
   - title: 직무명 셀렉터 (jobItem 내부 기준, 필수)
   - company: 회사명 셀렉터 (필수) - 예: "네이버", "카카오", "삼성전자"
   - location: 근무지 셀렉터
   - department: 부서/팀 셀렉터 (선택) - 예: "프론트엔드팀", "백엔드개발팀"
   - detailLink: 상세 페이지 링크 셀렉터

6. pagination:
   - type: "button" | "infinite-scroll" | "url-param" | "none"
   - nextSelector: 다음 페이지 버튼 셀렉터 (button 타입일 때)
   - paramName: 페이지 파라미터명 (url-param 타입일 때)

예시 응답 (DOM 전략):
{
  "pageType": "list",
  "urlPattern": "/careers/jobs",
  "strategy": "dom",
  "selectors": {
    "jobList": ".jobs-container",
    "jobItem": ".job-card",
    "title": ".job-title",
    "company": ".company-name",
    "location": ".job-location",
    "department": ".department-name",
    "detailLink": "a.job-link"
  },
  "pagination": {
    "type": "button",
    "nextSelector": ".pagination-next"
  }
}

예시 응답 (API 전략 - 데이터가 비어있는 경우):
{
  "pageType": "list",
  "urlPattern": "/recruit/joblist",
  "strategy": "api",
  "apiConfig": {
    "endpoint": "/api/jobs/list",
    "method": "POST"
  },
  "selectors": {
    "jobList": ".job-list-container",
    "jobItem": ".job-item",
    "title": ".job-title",
    "company": ".company-name"
  },
  "pagination": {
    "type": "none"
  }
}

URL: {url}

HTML:
{html}`;

const DETAIL_PAGE_PROMPT = `이 HTML은 채용 사이트의 직무 상세 페이지입니다.
다음 정보를 찾아 JSON으로 반환해주세요:

1. pageType: "detail" (고정)
2. urlPattern: URL 패턴 (동적 ID 부분은 :id로 표시)
3. selectors:
   - title: 직무명 셀렉터
   - company: 회사명 셀렉터
   - location: 근무지 셀렉터
   - department: 부서/팀 셀렉터 (선택)
   - description: 직무 설명 셀렉터
   - requirements: 자격 요건 셀렉터
   - responsibilities: 담당 업무 셀렉터
   - salary: 급여 정보 셀렉터
   - employmentType: 고용 형태 셀렉터
   - postedDate: 게시일 셀렉터
   - closingDate: 마감일 셀렉터

예시 응답:
{
  "pageType": "detail",
  "urlPattern": "/careers/jobs/:id",
  "selectors": {
    "title": "h1.job-title",
    "location": ".job-meta .location",
    "description": ".job-description",
    "requirements": ".requirements-section ul li"
  }
}

URL: {url}

HTML:
{html}`;

export class PageAnalyzer {
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  async analyze(
    html: string,
    url: string,
    pageType: 'list' | 'detail' | 'auto' = 'auto'
  ): Promise<PageStructure> {
    // HTML이 너무 크면 축소
    const truncatedHtml = this.truncateHtml(html, 100000);

    // 페이지 타입 자동 감지 또는 지정된 타입 사용
    const detectedType = pageType === 'auto' ? await this.detectPageType(truncatedHtml, url) : pageType;

    const prompt =
      detectedType === 'list'
        ? LIST_PAGE_PROMPT.replace('{url}', url).replace('{html}', truncatedHtml)
        : DETAIL_PAGE_PROMPT.replace('{url}', url).replace('{html}', truncatedHtml);

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const content = response.content[0];
    if (!content || content.type !== 'text') {
      throw new Error('LLM 응답이 텍스트가 아닙니다');
    }

    const result = this.parseResponse((content as { type: 'text'; text: string }).text);
    const now = new Date();

    if (result.pageType === 'list') {
      return PageStructure.createListPage({
        urlPattern: result.urlPattern,
        selectors: result.selectors as ListPageSelectors,
        pagination: result.pagination,
        analyzedAt: now,
        strategy: result.strategy,
        apiConfig: result.apiConfig,
      });
    } else {
      return PageStructure.createDetailPage({
        urlPattern: result.urlPattern,
        selectors: result.selectors as DetailPageSelectors,
        analyzedAt: now,
      });
    }
  }

  private async detectPageType(html: string, url: string): Promise<'list' | 'detail'> {
    // 간단한 휴리스틱으로 페이지 타입 감지
    // 목록 페이지 특징: 여러 개의 비슷한 구조 반복
    // 상세 페이지 특징: 단일 직무에 대한 상세 정보

    const listIndicators = [
      /<ul[^>]*class="[^"]*job/i,
      /<div[^>]*class="[^"]*list/i,
      /job-card/i,
      /job-item/i,
      /search-result/i,
    ];

    const detailIndicators = [
      /job-detail/i,
      /job-description/i,
      /apply-now/i,
      /apply-button/i,
      /<h1[^>]*>/i,
    ];

    let listScore = 0;
    let detailScore = 0;

    for (const indicator of listIndicators) {
      if (indicator.test(html)) listScore++;
    }

    for (const indicator of detailIndicators) {
      if (indicator.test(html)) detailScore++;
    }

    // URL 패턴도 고려
    if (/\/\d+$/.test(url) || /\/[a-f0-9-]{36}$/i.test(url)) {
      detailScore += 2; // UUID나 숫자 ID가 있으면 상세 페이지일 가능성 높음
    }

    if (/search|list|jobs\/?$/i.test(url)) {
      listScore += 2;
    }

    return listScore >= detailScore ? 'list' : 'detail';
  }

  private truncateHtml(html: string, maxLength: number): string {
    if (html.length <= maxLength) return html;

    // <script>와 <style> 태그 제거
    let cleaned = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\s+/g, ' ');

    if (cleaned.length <= maxLength) return cleaned;

    // 여전히 크면 자르기
    return cleaned.slice(0, maxLength) + '... (truncated)';
  }

  private parseResponse(text: string): AnalysisResult {
    // JSON 블록 추출 시도
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error('LLM 응답에서 JSON을 찾을 수 없습니다');
    }

    const jsonStr = jsonMatch[1] || jsonMatch[0];

    try {
      const parsed = JSON.parse(jsonStr);

      // 필수 필드 검증
      if (!parsed.pageType || !parsed.selectors) {
        throw new Error('필수 필드가 누락되었습니다');
      }

      return parsed as AnalysisResult;
    } catch (error) {
      throw new Error(`JSON 파싱 실패: ${error}`);
    }
  }
}
