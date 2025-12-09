// 페이지 구조 정보를 담는 도메인 객체

export type PageType = 'list' | 'detail';
export type PaginationType = 'button' | 'infinite-scroll' | 'url-param' | 'none';

export interface PaginationConfig {
  type: PaginationType;
  nextSelector?: string;
  scrollContainer?: string;
  paramName?: string;
  paramStart?: number;
}

export interface ListPageSelectors {
  jobList: string;
  jobItem: string;
  title?: string;
  location?: string;
  department?: string;
  detailLink?: string;
  [key: string]: string | undefined;
}

export interface DetailPageSelectors {
  title?: string;
  location?: string;
  department?: string;
  description?: string;
  requirements?: string;
  responsibilities?: string;
  salary?: string;
  employmentType?: string;
  experienceLevel?: string;
  postedDate?: string;
  closingDate?: string;
  [key: string]: string | undefined;
}

export interface ListPageProps {
  urlPattern: string;
  selectors: ListPageSelectors;
  pagination?: PaginationConfig;
  analyzedAt: Date;
}

export interface DetailPageProps {
  urlPattern: string;
  selectors: DetailPageSelectors;
  analyzedAt: Date;
}

export interface PageStructureJSON {
  pageType: PageType;
  urlPattern: string;
  selectors: ListPageSelectors | DetailPageSelectors;
  pagination?: PaginationConfig;
  analyzedAt: string;
  expiresAt: string;
}

const CACHE_EXPIRY_DAYS = 7;

export class PageStructure {
  private constructor(
    public readonly pageType: PageType,
    public readonly urlPattern: string,
    public readonly selectors: ListPageSelectors | DetailPageSelectors,
    public readonly analyzedAt: string,
    public readonly expiresAt: string,
    public readonly pagination?: PaginationConfig
  ) {}

  static createListPage(props: ListPageProps): PageStructure {
    // 유효성 검사
    if (!props.selectors.jobList || props.selectors.jobList.trim() === '') {
      throw new Error('jobList 셀렉터는 필수입니다');
    }

    if (!props.selectors.jobItem || props.selectors.jobItem.trim() === '') {
      throw new Error('jobItem 셀렉터는 필수입니다');
    }

    const expiresAt = new Date(props.analyzedAt);
    expiresAt.setDate(expiresAt.getDate() + CACHE_EXPIRY_DAYS);

    return new PageStructure(
      'list',
      props.urlPattern,
      props.selectors,
      props.analyzedAt.toISOString(),
      expiresAt.toISOString(),
      props.pagination
    );
  }

  static createDetailPage(props: DetailPageProps): PageStructure {
    const expiresAt = new Date(props.analyzedAt);
    expiresAt.setDate(expiresAt.getDate() + CACHE_EXPIRY_DAYS);

    return new PageStructure(
      'detail',
      props.urlPattern,
      props.selectors,
      props.analyzedAt.toISOString(),
      expiresAt.toISOString()
    );
  }

  static generateCacheKey(url: string): string {
    const parsed = new URL(url);
    let path = parsed.pathname;

    // trailing slash 제거
    if (path.endsWith('/') && path.length > 1) {
      path = path.slice(0, -1);
    }

    return `${parsed.host}${path}`;
  }

  static fromJSON(json: PageStructureJSON): PageStructure {
    return new PageStructure(
      json.pageType,
      json.urlPattern,
      json.selectors,
      json.analyzedAt,
      json.expiresAt,
      json.pagination
    );
  }

  isExpired(now: Date): boolean {
    return now.getTime() >= new Date(this.expiresAt).getTime();
  }

  toJSON(): PageStructureJSON {
    const json: PageStructureJSON = {
      pageType: this.pageType,
      urlPattern: this.urlPattern,
      selectors: this.selectors,
      analyzedAt: this.analyzedAt,
      expiresAt: this.expiresAt,
    };

    if (this.pagination) {
      json.pagination = this.pagination;
    }

    return json;
  }
}
