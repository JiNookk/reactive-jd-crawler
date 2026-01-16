// 페이지 정보 관련 타입 정의

/**
 * 셀렉터 후보 - 페이지에서 발견된 잠재적 직무 목록 셀렉터
 */
export interface SelectorCandidate {
  selector: string;
  count: number;
  sample: string;
}

/**
 * 직무 링크 정보 - 페이지에서 발견된 직무 관련 링크
 */
export interface JobLink {
  text: string;
  href: string;
  parentClass: string;
}

/**
 * 버튼 정보 - 페이지에서 발견된 버튼 요소
 */
export interface ButtonInfo {
  text: string;
  selector: string;
  tagName: string;
}

/**
 * 필터 정보 - 페이지의 필터/드롭다운 요소
 */
export interface FilterInfo {
  text: string;
  tagName: string;
  className: string;
}

/**
 * 페이지네이션 타입
 */
export type PaginationTypeValue =
  | 'button'
  | 'load-more'
  | 'infinite-scroll'
  | 'url-param'
  | 'none'
  | 'unknown';

/**
 * 감지된 페이지네이션 정보
 */
export interface DetectedPagination {
  type: PaginationTypeValue;
  nextSelector?: string;
  loadMoreSelector?: string;
  currentPage?: number;
  totalPages?: number;
  urlPattern?: string;
}

/**
 * 페이지 정보 - 에이전트가 분석한 페이지 상태
 */
export interface PageInfo {
  url: string;
  title: string;
  selectorCandidates: SelectorCandidate[];
  jobLinks: JobLink[];
  visibleButtons: ButtonInfo[];
  paginationInfo: string | null;
  paginationType: DetectedPagination;
  filterInfo: FilterInfo[];
  hasModal: boolean;
  resultCount: string | null;
}
