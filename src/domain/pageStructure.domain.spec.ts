import { describe, it, expect } from 'vitest';
import { PageStructure, PageType, PaginationType } from './pageStructure.domain.js';

describe('PageStructure 도메인', () => {
  describe('생성', () => {
    it('목록 페이지 구조를 생성할 수 있다', () => {
      // Given
      const now = new Date('2025-01-15T10:00:00Z');

      // When
      const structure = PageStructure.createListPage({
        urlPattern: '/booking/jobs',
        selectors: {
          jobList: '.job-list',
          jobItem: '.job-card',
          title: '.job-title',
          location: '.job-location',
          detailLink: '.job-card a',
        },
        pagination: {
          type: 'button',
          nextSelector: '.pagination-next',
        },
        analyzedAt: now,
      });

      // Then
      expect(structure.pageType).toBe('list');
      expect(structure.urlPattern).toBe('/booking/jobs');
      expect(structure.selectors.jobList).toBe('.job-list');
      expect(structure.pagination?.type).toBe('button');
    });

    it('상세 페이지 구조를 생성할 수 있다', () => {
      // Given
      const now = new Date('2025-01-15T10:00:00Z');

      // When
      const structure = PageStructure.createDetailPage({
        urlPattern: '/booking/jobs/:id',
        selectors: {
          title: 'h1.job-title',
          description: '.job-description',
          requirements: '.requirements-list li',
          responsibilities: '.responsibilities-list li',
        },
        analyzedAt: now,
      });

      // Then
      expect(structure.pageType).toBe('detail');
      expect(structure.urlPattern).toBe('/booking/jobs/:id');
      expect(structure.selectors.title).toBe('h1.job-title');
      expect(structure.pagination).toBeUndefined();
    });

    it('목록 페이지에서 jobList 셀렉터는 필수이다', () => {
      // Given
      const now = new Date('2025-01-15T10:00:00Z');

      // When & Then
      expect(() =>
        PageStructure.createListPage({
          urlPattern: '/jobs',
          selectors: {
            jobList: '',
            jobItem: '.job-card',
          },
          analyzedAt: now,
        })
      ).toThrow('jobList 셀렉터는 필수입니다');
    });

    it('목록 페이지에서 jobItem 셀렉터는 필수이다', () => {
      // Given
      const now = new Date('2025-01-15T10:00:00Z');

      // When & Then
      expect(() =>
        PageStructure.createListPage({
          urlPattern: '/jobs',
          selectors: {
            jobList: '.job-list',
            jobItem: '',
          },
          analyzedAt: now,
        })
      ).toThrow('jobItem 셀렉터는 필수입니다');
    });
  });

  describe('캐시 만료', () => {
    it('생성 시 7일 후 만료 시간이 설정된다', () => {
      // Given
      const now = new Date('2025-01-15T10:00:00Z');

      // When
      const structure = PageStructure.createListPage({
        urlPattern: '/jobs',
        selectors: {
          jobList: '.job-list',
          jobItem: '.job-card',
        },
        analyzedAt: now,
      });

      // Then
      expect(structure.expiresAt).toBe('2025-01-22T10:00:00.000Z');
    });

    it('만료되지 않은 구조는 isExpired가 false이다', () => {
      // Given
      const analyzedAt = new Date('2025-01-15T10:00:00Z');
      const currentTime = new Date('2025-01-20T10:00:00Z'); // 5일 후

      const structure = PageStructure.createListPage({
        urlPattern: '/jobs',
        selectors: {
          jobList: '.job-list',
          jobItem: '.job-card',
        },
        analyzedAt,
      });

      // When & Then
      expect(structure.isExpired(currentTime)).toBe(false);
    });

    it('7일이 지난 구조는 isExpired가 true이다', () => {
      // Given
      const analyzedAt = new Date('2025-01-15T10:00:00Z');
      const currentTime = new Date('2025-01-23T10:00:00Z'); // 8일 후

      const structure = PageStructure.createListPage({
        urlPattern: '/jobs',
        selectors: {
          jobList: '.job-list',
          jobItem: '.job-card',
        },
        analyzedAt,
      });

      // When & Then
      expect(structure.isExpired(currentTime)).toBe(true);
    });
  });

  describe('캐시 키 생성', () => {
    it('URL에서 캐시 키를 생성할 수 있다', () => {
      // Given
      const url = 'https://jobs.booking.com/booking/jobs?page=1&filter=tech';

      // When
      const cacheKey = PageStructure.generateCacheKey(url);

      // Then
      expect(cacheKey).toBe('jobs.booking.com/booking/jobs');
    });

    it('URL 경로만 있는 경우도 처리한다', () => {
      // Given
      const url = 'https://careers.tencent.com/en-us/search.html';

      // When
      const cacheKey = PageStructure.generateCacheKey(url);

      // Then
      expect(cacheKey).toBe('careers.tencent.com/en-us/search.html');
    });

    it('trailing slash를 제거한다', () => {
      // Given
      const url = 'https://jobs.booking.com/booking/jobs/';

      // When
      const cacheKey = PageStructure.generateCacheKey(url);

      // Then
      expect(cacheKey).toBe('jobs.booking.com/booking/jobs');
    });
  });

  describe('JSON 직렬화', () => {
    it('toJSON으로 직렬화할 수 있다', () => {
      // Given
      const now = new Date('2025-01-15T10:00:00Z');
      const structure = PageStructure.createListPage({
        urlPattern: '/jobs',
        selectors: {
          jobList: '.job-list',
          jobItem: '.job-card',
          title: '.title',
        },
        pagination: {
          type: 'button',
          nextSelector: '.next',
        },
        analyzedAt: now,
      });

      // When
      const json = structure.toJSON();

      // Then
      expect(json).toEqual({
        pageType: 'list',
        urlPattern: '/jobs',
        selectors: {
          jobList: '.job-list',
          jobItem: '.job-card',
          title: '.title',
        },
        pagination: {
          type: 'button',
          nextSelector: '.next',
        },
        analyzedAt: '2025-01-15T10:00:00.000Z',
        expiresAt: '2025-01-22T10:00:00.000Z',
      });
    });

    it('fromJSON으로 복원할 수 있다', () => {
      // Given
      const json = {
        pageType: 'list' as PageType,
        urlPattern: '/jobs',
        selectors: {
          jobList: '.job-list',
          jobItem: '.job-card',
        },
        pagination: {
          type: 'button' as PaginationType,
          nextSelector: '.next',
        },
        analyzedAt: '2025-01-15T10:00:00.000Z',
        expiresAt: '2025-01-22T10:00:00.000Z',
      };

      // When
      const structure = PageStructure.fromJSON(json);

      // Then
      expect(structure.pageType).toBe('list');
      expect(structure.urlPattern).toBe('/jobs');
      expect(structure.selectors.jobList).toBe('.job-list');
    });
  });
});
