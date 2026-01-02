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
  overallRating: number;
  reviewCount: number;
  sourceUrl: string;
  crawledAt: Date;
  categoryRatings?: CategoryRatings;
}

export interface CompanyRatingJSON {
  companyName: string;
  overallRating: number;
  reviewCount: number;
  sourceUrl: string;
  crawledAt: string;
  categoryRatings?: CategoryRatings;
}

export type RatingLevel = '좋음' | '보통' | '나쁨';

export class CompanyRating {
  private constructor(
    public readonly companyName: string,
    public readonly overallRating: number,
    public readonly reviewCount: number,
    public readonly sourceUrl: string,
    public readonly crawledAt: string,
    public readonly categoryRatings?: CategoryRatings
  ) {}

  static create(props: CompanyRatingProps): CompanyRating {
    if (!props.companyName || props.companyName.trim() === '') {
      throw new Error('회사명은 필수입니다');
    }

    if (props.overallRating < 0 || props.overallRating > 5) {
      throw new Error('평점은 0~5 사이여야 합니다');
    }

    if (props.reviewCount < 0) {
      throw new Error('리뷰 수는 0 이상이어야 합니다');
    }

    if (!this.isValidUrl(props.sourceUrl)) {
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

  private static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  getRatingLevel(): RatingLevel {
    if (this.overallRating >= 4.0) {
      return '좋음';
    }
    if (this.overallRating >= 3.0) {
      return '보통';
    }
    return '나쁨';
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
