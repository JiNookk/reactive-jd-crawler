// 페이지 구조 정보를 담는 도메인 객체

export type PageType = 'list' | 'detail';
export type PaginationType = 'button' | 'infinite-scroll' | 'url-param' | 'none';
export type CrawlStrategy = 'dom' | 'api';

export interface PaginationConfig {
  type: PaginationType;
  nextSelector?: string;
  scrollContainer?: string;
  paramName?: string;
  paramStart?: number;
}

export interface ApiConfig {
  endpoint: string;
  method: 'GET' | 'POST';
  params?: Record<string, string>;
  headers?: Record<string, string>;
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
  strategy?: CrawlStrategy;
  apiConfig?: ApiConfig;
}

export interface DetailPageProps {
  urlPattern: string;
  selectors: DetailPageSelectors;
  analyzedAt: Date;
}

// 캐시 메타데이터
export interface CacheMetadata {
  version: number;
  hitCount: number;
  lastHitAt: string | null;
  failCount: number;
}

const DEFAULT_METADATA: CacheMetadata = {
  version: 1,
  hitCount: 0,
  lastHitAt: null,
  failCount: 0,
};

const INVALIDATE_FAIL_THRESHOLD = 3;

export interface PageStructureJSON {
  pageType: PageType;
  urlPattern: string;
  selectors: ListPageSelectors | DetailPageSelectors;
  pagination?: PaginationConfig;
  analyzedAt: string;
  expiresAt: string;
  metadata?: CacheMetadata;
  strategy?: CrawlStrategy;
  apiConfig?: ApiConfig;
}

const CACHE_EXPIRY_DAYS = 7;

export class PageStructure {
  private constructor(
    public readonly pageType: PageType,
    public readonly urlPattern: string,
    public readonly selectors: ListPageSelectors | DetailPageSelectors,
    public readonly analyzedAt: string,
    public readonly expiresAt: string,
    public readonly pagination: PaginationConfig | undefined,
    public readonly metadata: CacheMetadata,
    public readonly strategy: CrawlStrategy = 'dom',
    public readonly apiConfig: ApiConfig | undefined = undefined
  ) {}

  recordHit(hitTime: Date): PageStructure {
    return new PageStructure(
      this.pageType,
      this.urlPattern,
      this.selectors,
      this.analyzedAt,
      this.expiresAt,
      this.pagination,
      {
        ...this.metadata,
        hitCount: this.metadata.hitCount + 1,
        lastHitAt: hitTime.toISOString(),
        failCount: 0, // 성공 시 실패 카운트 리셋
      },
      this.strategy,
      this.apiConfig
    );
  }

  recordFail(): PageStructure {
    return new PageStructure(
      this.pageType,
      this.urlPattern,
      this.selectors,
      this.analyzedAt,
      this.expiresAt,
      this.pagination,
      {
        ...this.metadata,
        failCount: this.metadata.failCount + 1,
      },
      this.strategy,
      this.apiConfig
    );
  }

  shouldInvalidate(): boolean {
    return this.metadata.failCount >= INVALIDATE_FAIL_THRESHOLD;
  }

  incrementVersion(): PageStructure {
    return new PageStructure(
      this.pageType,
      this.urlPattern,
      this.selectors,
      this.analyzedAt,
      this.expiresAt,
      this.pagination,
      {
        ...this.metadata,
        version: this.metadata.version + 1,
      },
      this.strategy,
      this.apiConfig
    );
  }

  static createListPage(props: ListPageProps): PageStructure {
    // 필수 셀렉터 검증
    const requiredSelectors = ['jobList', 'jobItem', 'title', 'department'] as const;
    for (const field of requiredSelectors) {
      const value = props.selectors[field];
      if (!value || value.trim() === '') {
        throw new Error(`[PageStructure] 목록 페이지에서 '${field}' 셀렉터는 필수입니다`);
      }
    }

    // API 전략일 때 apiConfig 필수 검증
    const strategy = props.strategy ?? 'dom';
    if (strategy === 'api' && !props.apiConfig) {
      throw new Error('[PageStructure] API 전략에는 apiConfig가 필수입니다');
    }

    const expiresAt = new Date(props.analyzedAt);
    expiresAt.setDate(expiresAt.getDate() + CACHE_EXPIRY_DAYS);

    return new PageStructure(
      'list',
      props.urlPattern,
      props.selectors,
      props.analyzedAt.toISOString(),
      expiresAt.toISOString(),
      props.pagination,
      DEFAULT_METADATA,
      strategy,
      props.apiConfig
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
      expiresAt.toISOString(),
      undefined,
      DEFAULT_METADATA
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
    // 목록 페이지 필수 셀렉터 검증
    if (json.pageType === 'list') {
      const requiredSelectors = ['jobList', 'jobItem', 'title', 'department'] as const;
      for (const field of requiredSelectors) {
        const value = (json.selectors as ListPageSelectors)[field];
        if (!value || value.trim() === '') {
          throw new Error(`[PageStructure] 캐시된 목록 페이지에 '${field}' 셀렉터가 없습니다. 캐시를 삭제하고 다시 크롤링하세요.`);
        }
      }
    }

    return new PageStructure(
      json.pageType,
      json.urlPattern,
      json.selectors,
      json.analyzedAt,
      json.expiresAt,
      json.pagination,
      json.metadata ?? DEFAULT_METADATA,
      json.strategy ?? 'dom',
      json.apiConfig
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
      metadata: this.metadata,
      strategy: this.strategy,
    };

    if (this.pagination) {
      json.pagination = this.pagination;
    }

    if (this.apiConfig) {
      json.apiConfig = this.apiConfig;
    }

    return json;
  }
}
