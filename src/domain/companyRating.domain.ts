// 회사 평점 정보를 담는 값 객체

export interface CategoryRatings {
  workLifeBalance?: number;
  careerGrowth?: number;
  compensation?: number;
  companyCulture?: number;
  management?: number;
}

export interface CompanyRatingProps {
  companyName: string;
  overallRating: number | null; // null이면 평점 없음 (조회 실패)
  reviewCount: number | null;
  sourceUrl: string | null; // null이면 조회 실패
  crawledAt: Date;
  categoryRatings?: CategoryRatings;
}

export interface CompanyRatingJSON {
  companyName: string;
  overallRating: number | null;
  reviewCount: number | null;
  sourceUrl: string | null;
  crawledAt: string;
  categoryRatings?: CategoryRatings;
}

export type RatingLevel = '좋음' | '보통' | '나쁨';

export class CompanyRating {
  private constructor(
    public readonly companyName: string,
    public readonly overallRating: number | null,
    public readonly reviewCount: number | null,
    public readonly sourceUrl: string | null,
    public readonly crawledAt: string,
    public readonly categoryRatings?: CategoryRatings
  ) {}

  static create(props: CompanyRatingProps): CompanyRating {
    if (!props.companyName || props.companyName.trim() === '') {
      throw new Error('회사명은 필수입니다');
    }

    if (props.overallRating !== null && (props.overallRating < 0 || props.overallRating > 5)) {
      throw new Error('평점은 0~5 사이여야 합니다');
    }

    if (props.reviewCount !== null && props.reviewCount < 0) {
      throw new Error('리뷰 수는 0 이상이어야 합니다');
    }

    if (props.sourceUrl !== null && !this.isValidUrl(props.sourceUrl)) {
      throw new Error('유효한 URL이 필요합니다');
    }

    return new CompanyRating(
      props.companyName,
      props.overallRating,
      props.reviewCount,
      props.sourceUrl,
      props.crawledAt.toISOString(),
      props.categoryRatings
    );
  }

  static createNotFound(companyName: string): CompanyRating {
    return new CompanyRating(
      companyName,
      null,
      null,
      null,
      new Date().toISOString(),
      undefined
    );
  }

  /**
   * 캐시 키용 정규화 (공백 제거, 소문자 변환)
   */
  static normalizeCompanyName(name: string): string {
    return this.toSearchQuery(name)
      .replace(/\s+/g, '')
      .toLowerCase();
  }

  /**
   * 검색 쿼리용 정규화 (법인 표기 제거, 공백 정리)
   * - 괄호 안 내용: (주), (유), (사) 등
   * - 특수문자 법인 표기: ㈜
   * - 한글 법인 표기: 주식회사, 유한회사, 유한책임회사
   * - 영문 법인 표기: Inc., Corp., Co., Ltd., LLC 등
   */
  static toSearchQuery(name: string): string {
    return name
      .replace(/\([^)]*\)/g, '')           // 괄호 안 내용 제거
      .replace(/㈜/g, '')                  // 특수문자 법인 표기
      .replace(/주식회사|유한회사|유한책임회사/g, '')  // 한글 법인 표기
      .replace(/\b(Inc\.?|Corp\.?|Co\.?,?\s*Ltd\.?|Ltd\.?|LLC)\b/gi, '')  // 영문 법인 표기
      .replace(/\s+/g, ' ')                // 연속 공백 → 단일 공백
      .trim();
  }

  private static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  getRatingLevel(): RatingLevel | null {
    if (this.overallRating === null) {
      return null;
    }
    if (this.overallRating >= 4.0) {
      return '좋음';
    }
    if (this.overallRating >= 3.0) {
      return '보통';
    }
    return '나쁨';
  }

  hasRating(): boolean {
    return this.overallRating !== null;
  }

  isExpired(daysThreshold: number = 30): boolean {
    const lastUpdate = new Date(this.crawledAt);
    const now = new Date();
    const diffDays = (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays > daysThreshold;
  }

  toJSON(): CompanyRatingJSON {
    const json: CompanyRatingJSON = {
      companyName: this.companyName,
      overallRating: this.overallRating,
      reviewCount: this.reviewCount,
      sourceUrl: this.sourceUrl,
      crawledAt: this.crawledAt,
    };

    if (this.categoryRatings !== undefined) {
      json.categoryRatings = this.categoryRatings;
    }

    return json;
  }
}
