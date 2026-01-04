// 회사 평점으로 직무 정보를 보강하는 서비스

import { JobPostingJSON } from '../../domain/jobPosting.domain.js';
import { CompanyRatingJSON } from '../../domain/companyRating.domain.js';
import { CompanyRatingCache } from '../../infra/cache/companyRatingCache.js';
import { BlindScraper } from '../../infra/scraper/blindScraper.js';
import { CompanyRating } from '../../domain/companyRating.domain.js';

export interface EnrichedJobPostingJSON extends JobPostingJSON {
  companyRating?: CompanyRatingJSON;
}

export interface EnrichmentStats {
  totalCompanies: number;
  cacheHits: number;
  cacheMisses: number;
  newRatingsFound: number;
  notFoundRatings: number;
  duration: number;
}

/**
 * 회사 평점으로 직무 정보를 보강하는 서비스
 * - 캐시 우선 조회로 중복 스크래핑 방지
 * - Blind 스크래핑으로 캐시 미스 처리
 * - 평점 캐시 자동 업데이트
 */
export class CompanyRatingEnricher {
  private cache: CompanyRatingCache;
  private scraper: BlindScraper;

  constructor() {
    this.cache = new CompanyRatingCache();
    this.scraper = new BlindScraper();
  }

  /**
   * 직무 목록에 회사 평점 정보를 보강
   * @param jobs 직무 목록
   * @returns 평점이 추가된 직무 목록 및 통계
   */
  async enrichJobs(jobs: JobPostingJSON[]): Promise<{
    enrichedJobs: EnrichedJobPostingJSON[];
    stats: EnrichmentStats;
  }> {
    const startTime = Date.now();

    // 1. 캐시 로드
    console.log('[평점 조회] 캐시 로드 중...');
    await this.cache.load();

    // 2. 고유 회사명 추출
    const uniqueCompanies = this.extractUniqueCompanies(jobs);
    console.log(`[평점 조회] ${uniqueCompanies.length}개 회사 발견`);

    // 3. 평점 수집 (캐시 우선, 미스 시 스크래핑)
    const ratings = await this.collectRatings(uniqueCompanies);

    // 4. 직무에 평점 정보 추가
    const enrichedJobs = this.attachRatings(jobs, ratings);

    // 5. 캐시 저장
    await this.cache.save();

    const duration = (Date.now() - startTime) / 1000;

    const stats: EnrichmentStats = {
      totalCompanies: uniqueCompanies.length,
      cacheHits: ratings.hits,
      cacheMisses: ratings.misses,
      newRatingsFound: ratings.newFound,
      notFoundRatings: ratings.notFound,
      duration,
    };

    return { enrichedJobs, stats };
  }

  /**
   * 직무 목록에서 고유 회사명 추출
   */
  private extractUniqueCompanies(jobs: JobPostingJSON[]): string[] {
    const companies = new Set<string>();
    jobs.forEach((job) => {
      if (job.company) {
        companies.add(job.company);
      }
    });
    return Array.from(companies);
  }

  /**
   * 회사 평점 수집 (캐시 우선, 미스 시 스크래핑)
   */
  private async collectRatings(companies: string[]): Promise<{
    ratings: Map<string, CompanyRating>;
    hits: number;
    misses: number;
    newFound: number;
    notFound: number;
  }> {
    const ratings = new Map<string, CompanyRating>();
    let hits = 0;
    let misses = 0;
    let newFound = 0;
    let notFound = 0;

    const missingCompanies: string[] = [];

    // 캐시 조회
    for (const company of companies) {
      const cached = this.cache.get(company);
      if (cached) {
        hits++;
        ratings.set(CompanyRating.normalizeCompanyName(company), cached);
        console.log(`[캐시 HIT] ${company}: ${cached.hasRating() ? `${cached.overallRating}점` : '평점 없음'}`);
      } else {
        misses++;
        missingCompanies.push(company);
        console.log(`[캐시 MISS] ${company} - 스크래핑 예정`);
      }
    }

    // 캐시 미스 처리: Blind 스크래핑
    if (missingCompanies.length > 0) {
      console.log(`\n[Blind 스크래핑] ${missingCompanies.length}개 회사 조회 중...`);

      for (const company of missingCompanies) {
        try {
          const result = await this.scraper.searchCompanyRating(company);

          let rating: CompanyRating;
          if (result.rating) {
            rating = CompanyRating.create({
              companyName: company,
              overallRating: result.rating.overallRating,
              reviewCount: result.rating.reviewCount,
              sourceUrl: result.rating.sourceUrl,
              crawledAt: new Date(),
              categoryRatings: result.rating.categoryRatings,
            });
            newFound++;
            console.log(`[Blind 성공] ${company}: ${rating.overallRating}점`);
          } else {
            rating = CompanyRating.createNotFound(company);
            notFound++;
            console.log(`[Blind 실패] ${company}: 평점 없음`);
          }

          // 캐시에 저장
          this.cache.set(company, rating);
          ratings.set(CompanyRating.normalizeCompanyName(company), rating);

          // Rate limit 방지 (30초 대기)
          if (missingCompanies.indexOf(company) < missingCompanies.length - 1) {
            console.log('[대기] Rate limit 방지 30초 대기...');
            await new Promise((resolve) => setTimeout(resolve, 30000));
          }
        } catch (error) {
          console.error(`[Blind 에러] ${company}: ${error instanceof Error ? error.message : String(error)}`);
          // 에러 발생 시 "not found"로 캐싱
          const rating = CompanyRating.createNotFound(company);
          this.cache.set(company, rating);
          ratings.set(CompanyRating.normalizeCompanyName(company), rating);
          notFound++;
        }
      }
    }

    return { ratings, hits, misses, newFound, notFound };
  }

  /**
   * 직무에 평점 정보 추가
   */
  private attachRatings(
    jobs: JobPostingJSON[],
    ratingsResult: { ratings: Map<string, CompanyRating> }
  ): EnrichedJobPostingJSON[] {
    return jobs.map((job) => {
      const normalizedCompany = CompanyRating.normalizeCompanyName(job.company);
      const rating = ratingsResult.ratings.get(normalizedCompany);

      const enriched: EnrichedJobPostingJSON = { ...job };

      if (rating && rating.hasRating()) {
        enriched.companyRating = rating.toJSON();
      }

      return enriched;
    });
  }

  /**
   * 캐시 통계 조회
   */
  async getCacheStats() {
    await this.cache.load();
    return this.cache.getStats();
  }
}
