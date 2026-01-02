// 회사 평점 도메인 테스트

import { describe, it, expect } from 'vitest';
import { CompanyRating, CategoryRatings } from './companyRating.domain.js';

describe('CompanyRating', () => {
  describe('생성', () => {
    it('필수 정보로 회사 평점을 생성할 수 있다', () => {
      // Given
      const props = {
        companyName: 'Google',
        overallRating: 4.2,
        reviewCount: 11614,
        sourceUrl: 'https://www.teamblind.com/company/Google/reviews',
        crawledAt: new Date('2025-01-02T10:00:00Z'),
      };

      // When
      const rating = CompanyRating.create(props);

      // Then
      expect(rating.companyName).toBe('Google');
      expect(rating.overallRating).toBe(4.2);
      expect(rating.reviewCount).toBe(11614);
      expect(rating.sourceUrl).toBe('https://www.teamblind.com/company/Google/reviews');
    });

    it('카테고리별 평점과 함께 생성할 수 있다', () => {
      // Given
      const categoryRatings: CategoryRatings = {
        workLifeBalance: 4.4,
        careerGrowth: 3.5,
        compensation: 4.1,
        companyCulture: 4.0,
        management: 3.5,
      };

      const props = {
        companyName: 'Google',
        overallRating: 4.2,
        reviewCount: 11614,
        sourceUrl: 'https://www.teamblind.com/company/Google/reviews',
        crawledAt: new Date('2025-01-02T10:00:00Z'),
        categoryRatings,
      };

      // When
      const rating = CompanyRating.create(props);

      // Then
      expect(rating.categoryRatings).toEqual(categoryRatings);
      expect(rating.categoryRatings?.workLifeBalance).toBe(4.4);
    });

    it('회사명이 없으면 에러가 발생한다', () => {
      // Given
      const props = {
        companyName: '',
        overallRating: 4.2,
        reviewCount: 100,
        sourceUrl: 'https://www.teamblind.com/company/Google/reviews',
        crawledAt: new Date(),
      };

      // When & Then
      expect(() => CompanyRating.create(props)).toThrow('회사명은 필수입니다');
    });

    it('평점이 0~5 범위를 벗어나면 에러가 발생한다', () => {
      // Given
      const baseProps = {
        companyName: 'Test',
        reviewCount: 100,
        sourceUrl: 'https://www.teamblind.com/company/Test/reviews',
        crawledAt: new Date(),
      };

      // When & Then
      expect(() => CompanyRating.create({ ...baseProps, overallRating: -1 })).toThrow(
        '평점은 0~5 사이여야 합니다'
      );
      expect(() => CompanyRating.create({ ...baseProps, overallRating: 6 })).toThrow(
        '평점은 0~5 사이여야 합니다'
      );
    });

    it('리뷰 수가 음수면 에러가 발생한다', () => {
      // Given
      const props = {
        companyName: 'Test',
        overallRating: 4.0,
        reviewCount: -1,
        sourceUrl: 'https://www.teamblind.com/company/Test/reviews',
        crawledAt: new Date(),
      };

      // When & Then
      expect(() => CompanyRating.create(props)).toThrow('리뷰 수는 0 이상이어야 합니다');
    });

    it('유효하지 않은 URL이면 에러가 발생한다', () => {
      // Given
      const props = {
        companyName: 'Test',
        overallRating: 4.0,
        reviewCount: 100,
        sourceUrl: 'invalid-url',
        crawledAt: new Date(),
      };

      // When & Then
      expect(() => CompanyRating.create(props)).toThrow('유효한 URL이 필요합니다');
    });
  });

  describe('JSON 변환', () => {
    it('JSON으로 변환할 수 있다', () => {
      // Given
      const rating = CompanyRating.create({
        companyName: 'Google',
        overallRating: 4.2,
        reviewCount: 11614,
        sourceUrl: 'https://www.teamblind.com/company/Google/reviews',
        crawledAt: new Date('2025-01-02T10:00:00Z'),
        categoryRatings: {
          workLifeBalance: 4.4,
          careerGrowth: 3.5,
          compensation: 4.1,
          companyCulture: 4.0,
          management: 3.5,
        },
      });

      // When
      const json = rating.toJSON();

      // Then
      expect(json.companyName).toBe('Google');
      expect(json.overallRating).toBe(4.2);
      expect(json.reviewCount).toBe(11614);
      expect(json.crawledAt).toBe('2025-01-02T10:00:00.000Z');
      expect(json.categoryRatings?.workLifeBalance).toBe(4.4);
    });

    it('카테고리 평점이 없으면 JSON에 포함되지 않는다', () => {
      // Given
      const rating = CompanyRating.create({
        companyName: 'Test',
        overallRating: 3.5,
        reviewCount: 50,
        sourceUrl: 'https://www.teamblind.com/company/Test/reviews',
        crawledAt: new Date('2025-01-02T10:00:00Z'),
      });

      // When
      const json = rating.toJSON();

      // Then
      expect(json.categoryRatings).toBeUndefined();
    });
  });

  describe('평점 해석', () => {
    it('4.0 이상이면 "좋음"으로 해석된다', () => {
      const rating = CompanyRating.create({
        companyName: 'Good Company',
        overallRating: 4.2,
        reviewCount: 100,
        sourceUrl: 'https://www.teamblind.com/company/Good/reviews',
        crawledAt: new Date(),
      });

      expect(rating.getRatingLevel()).toBe('좋음');
    });

    it('3.0~4.0 미만이면 "보통"으로 해석된다', () => {
      const rating = CompanyRating.create({
        companyName: 'Average Company',
        overallRating: 3.5,
        reviewCount: 100,
        sourceUrl: 'https://www.teamblind.com/company/Average/reviews',
        crawledAt: new Date(),
      });

      expect(rating.getRatingLevel()).toBe('보통');
    });

    it('3.0 미만이면 "나쁨"으로 해석된다', () => {
      const rating = CompanyRating.create({
        companyName: 'Bad Company',
        overallRating: 2.5,
        reviewCount: 100,
        sourceUrl: 'https://www.teamblind.com/company/Bad/reviews',
        crawledAt: new Date(),
      });

      expect(rating.getRatingLevel()).toBe('나쁨');
    });
  });
});
