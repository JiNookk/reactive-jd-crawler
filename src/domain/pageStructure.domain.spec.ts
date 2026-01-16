import { describe, it, expect } from 'vitest';
import { PageStructure, PageType, PaginationType, ListPageSelectors, CrawlStrategy } from './pageStructure.domain.js';

// 테스트용 기본 목록 페이지 셀렉터 (필수 필드 포함)
const createListSelectors = (overrides: Partial<ListPageSelectors> = {}): ListPageSelectors => ({
  jobList: '.job-list',
  jobItem: '.job-card',
  title: '.job-title',
  company: '.job-company',
  department: '.job-department',
  ...overrides,
});

describe('PageStructure 도메인', () => {
  describe('생성', () => {
    it('목록 페이지 구조를 생성할 수 있다', () => {
      // Given
      const now = new Date('2025-01-15T10:00:00Z');

      // When
      const structure = PageStructure.createListPage({
        urlPattern: '/booking/jobs',
        selectors: createListSelectors({
          location: '.job-location',
          detailLink: '.job-card a',
        }),
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
          selectors: createListSelectors({ jobList: '' }),
          analyzedAt: now,
        })
      ).toThrow("'jobList' 셀렉터는 필수입니다");
    });

    it('목록 페이지에서 jobItem 셀렉터는 필수이다', () => {
      // Given
      const now = new Date('2025-01-15T10:00:00Z');

      // When & Then
      expect(() =>
        PageStructure.createListPage({
          urlPattern: '/jobs',
          selectors: createListSelectors({ jobItem: '' }),
          analyzedAt: now,
        })
      ).toThrow("'jobItem' 셀렉터는 필수입니다");
    });

    it('목록 페이지에서 title 셀렉터는 필수이다', () => {
      // Given
      const now = new Date('2025-01-15T10:00:00Z');

      // When & Then
      expect(() =>
        PageStructure.createListPage({
          urlPattern: '/jobs',
          selectors: createListSelectors({ title: '' }),
          analyzedAt: now,
        })
      ).toThrow("'title' 셀렉터는 필수입니다");
    });

    it('목록 페이지에서 company 셀렉터는 필수이다', () => {
      // Given
      const now = new Date('2025-01-15T10:00:00Z');

      // When & Then
      expect(() =>
        PageStructure.createListPage({
          urlPattern: '/jobs',
          selectors: createListSelectors({ company: '' }),
          analyzedAt: now,
        })
      ).toThrow("'company' 셀렉터는 필수입니다");
    });
  });

  describe('캐시 만료', () => {
    it('생성 시 7일 후 만료 시간이 설정된다', () => {
      // Given
      const now = new Date('2025-01-15T10:00:00Z');

      // When
      const structure = PageStructure.createListPage({
        urlPattern: '/jobs',
        selectors: createListSelectors(),
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
        selectors: createListSelectors(),
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
        selectors: createListSelectors(),
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
        selectors: createListSelectors(),
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
        selectors: createListSelectors(),
        pagination: {
          type: 'button',
          nextSelector: '.next',
        },
        analyzedAt: '2025-01-15T10:00:00.000Z',
        expiresAt: '2025-01-22T10:00:00.000Z',
        metadata: {
          version: 1,
          hitCount: 0,
          lastHitAt: null,
          failCount: 0,
        },
        strategy: 'dom',
      });
    });

    it('fromJSON으로 복원할 수 있다', () => {
      // Given
      const json = {
        pageType: 'list' as PageType,
        urlPattern: '/jobs',
        selectors: createListSelectors(),
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

  describe('캐시 메타데이터', () => {
    it('생성 시 버전은 1로 초기화된다', () => {
      // Given
      const now = new Date('2025-01-15T10:00:00Z');

      // When
      const structure = PageStructure.createListPage({
        urlPattern: '/jobs',
        selectors: createListSelectors(),
        analyzedAt: now,
      });

      // Then
      expect(structure.metadata.version).toBe(1);
    });

    it('생성 시 hitCount는 0으로 초기화된다', () => {
      // Given
      const now = new Date('2025-01-15T10:00:00Z');

      // When
      const structure = PageStructure.createListPage({
        urlPattern: '/jobs',
        selectors: createListSelectors(),
        analyzedAt: now,
      });

      // Then
      expect(structure.metadata.hitCount).toBe(0);
      expect(structure.metadata.lastHitAt).toBeNull();
    });

    it('생성 시 failCount는 0으로 초기화된다', () => {
      // Given
      const now = new Date('2025-01-15T10:00:00Z');

      // When
      const structure = PageStructure.createListPage({
        urlPattern: '/jobs',
        selectors: createListSelectors(),
        analyzedAt: now,
      });

      // Then
      expect(structure.metadata.failCount).toBe(0);
    });

    it('recordHit으로 히트를 기록할 수 있다', () => {
      // Given
      const analyzedAt = new Date('2025-01-15T10:00:00Z');
      const hitTime = new Date('2025-01-16T10:00:00Z');
      const structure = PageStructure.createListPage({
        urlPattern: '/jobs',
        selectors: createListSelectors(),
        analyzedAt,
      });

      // When
      const updated = structure.recordHit(hitTime);

      // Then
      expect(updated.metadata.hitCount).toBe(1);
      expect(updated.metadata.lastHitAt).toBe('2025-01-16T10:00:00.000Z');
    });

    it('recordHit을 여러 번 호출하면 카운트가 증가한다', () => {
      // Given
      const analyzedAt = new Date('2025-01-15T10:00:00Z');
      const structure = PageStructure.createListPage({
        urlPattern: '/jobs',
        selectors: createListSelectors(),
        analyzedAt,
      });

      // When
      const hit1 = structure.recordHit(new Date('2025-01-16T10:00:00Z'));
      const hit2 = hit1.recordHit(new Date('2025-01-17T10:00:00Z'));
      const hit3 = hit2.recordHit(new Date('2025-01-18T10:00:00Z'));

      // Then
      expect(hit3.metadata.hitCount).toBe(3);
      expect(hit3.metadata.lastHitAt).toBe('2025-01-18T10:00:00.000Z');
    });

    it('recordFail로 실패를 기록할 수 있다', () => {
      // Given
      const analyzedAt = new Date('2025-01-15T10:00:00Z');
      const structure = PageStructure.createListPage({
        urlPattern: '/jobs',
        selectors: createListSelectors(),
        analyzedAt,
      });

      // When
      const updated = structure.recordFail();

      // Then
      expect(updated.metadata.failCount).toBe(1);
    });

    it('recordFail을 여러 번 호출하면 카운트가 증가한다', () => {
      // Given
      const analyzedAt = new Date('2025-01-15T10:00:00Z');
      const structure = PageStructure.createListPage({
        urlPattern: '/jobs',
        selectors: createListSelectors(),
        analyzedAt,
      });

      // When
      const fail1 = structure.recordFail();
      const fail2 = fail1.recordFail();
      const fail3 = fail2.recordFail();

      // Then
      expect(fail3.metadata.failCount).toBe(3);
    });

    it('shouldInvalidate는 연속 실패가 3회 이상이면 true를 반환한다', () => {
      // Given
      const analyzedAt = new Date('2025-01-15T10:00:00Z');
      const structure = PageStructure.createListPage({
        urlPattern: '/jobs',
        selectors: createListSelectors(),
        analyzedAt,
      });

      // When
      const fail1 = structure.recordFail();
      const fail2 = fail1.recordFail();
      const fail3 = fail2.recordFail();

      // Then
      expect(fail1.shouldInvalidate()).toBe(false);
      expect(fail2.shouldInvalidate()).toBe(false);
      expect(fail3.shouldInvalidate()).toBe(true);
    });

    it('recordHit을 호출하면 failCount가 리셋된다', () => {
      // Given
      const analyzedAt = new Date('2025-01-15T10:00:00Z');
      const structure = PageStructure.createListPage({
        urlPattern: '/jobs',
        selectors: createListSelectors(),
        analyzedAt,
      });

      // When
      const fail1 = structure.recordFail();
      const fail2 = fail1.recordFail();
      const hit = fail2.recordHit(new Date('2025-01-16T10:00:00Z'));

      // Then
      expect(hit.metadata.failCount).toBe(0);
      expect(hit.metadata.hitCount).toBe(1);
    });

    it('incrementVersion으로 버전을 증가시킬 수 있다', () => {
      // Given
      const analyzedAt = new Date('2025-01-15T10:00:00Z');
      const structure = PageStructure.createListPage({
        urlPattern: '/jobs',
        selectors: createListSelectors(),
        analyzedAt,
      });

      // When
      const updated = structure.incrementVersion();

      // Then
      expect(updated.metadata.version).toBe(2);
    });

    it('toJSON에 metadata가 포함된다', () => {
      // Given
      const now = new Date('2025-01-15T10:00:00Z');
      const structure = PageStructure.createListPage({
        urlPattern: '/jobs',
        selectors: createListSelectors(),
        analyzedAt: now,
      });
      const updated = structure.recordHit(new Date('2025-01-16T10:00:00Z'));

      // When
      const json = updated.toJSON();

      // Then
      expect(json.metadata).toEqual({
        version: 1,
        hitCount: 1,
        lastHitAt: '2025-01-16T10:00:00.000Z',
        failCount: 0,
      });
    });

    it('fromJSON에서 metadata가 복원된다', () => {
      // Given
      const json = {
        pageType: 'list' as PageType,
        urlPattern: '/jobs',
        selectors: createListSelectors(),
        analyzedAt: '2025-01-15T10:00:00.000Z',
        expiresAt: '2025-01-22T10:00:00.000Z',
        metadata: {
          version: 3,
          hitCount: 10,
          lastHitAt: '2025-01-20T10:00:00.000Z',
          failCount: 1,
        },
      };

      // When
      const structure = PageStructure.fromJSON(json);

      // Then
      expect(structure.metadata.version).toBe(3);
      expect(structure.metadata.hitCount).toBe(10);
      expect(structure.metadata.lastHitAt).toBe('2025-01-20T10:00:00.000Z');
      expect(structure.metadata.failCount).toBe(1);
    });

    it('fromJSON에서 metadata가 없으면 기본값으로 초기화된다', () => {
      // Given: 기존 캐시 형식 (metadata 없음)
      const json = {
        pageType: 'list' as PageType,
        urlPattern: '/jobs',
        selectors: createListSelectors(),
        analyzedAt: '2025-01-15T10:00:00.000Z',
        expiresAt: '2025-01-22T10:00:00.000Z',
      };

      // When
      const structure = PageStructure.fromJSON(json);

      // Then
      expect(structure.metadata.version).toBe(1);
      expect(structure.metadata.hitCount).toBe(0);
      expect(structure.metadata.lastHitAt).toBeNull();
      expect(structure.metadata.failCount).toBe(0);
    });

    it('fromJSON에서 목록 페이지 필수 셀렉터가 없으면 에러가 발생한다', () => {
      // Given
      const json = {
        pageType: 'list' as PageType,
        urlPattern: '/jobs',
        selectors: {
          jobList: '.job-list',
          jobItem: '.job-card',
          // title과 department 누락
        },
        analyzedAt: '2025-01-15T10:00:00.000Z',
        expiresAt: '2025-01-22T10:00:00.000Z',
      };

      // When & Then
      expect(() => PageStructure.fromJSON(json)).toThrow("'title' 셀렉터가 없습니다");
    });
  });

  describe('크롤링 전략 (strategy)', () => {
    it('기본 전략은 dom이다', () => {
      // Given
      const now = new Date('2025-01-15T10:00:00Z');

      // When
      const structure = PageStructure.createListPage({
        urlPattern: '/jobs',
        selectors: createListSelectors(),
        analyzedAt: now,
      });

      // Then
      expect(structure.strategy).toBe('dom');
    });

    it('API 전략으로 목록 페이지를 생성할 수 있다', () => {
      // Given
      const now = new Date('2025-01-15T10:00:00Z');

      // When
      const structure = PageStructure.createListPage({
        urlPattern: '/recruit/joblist',
        selectors: createListSelectors(),
        analyzedAt: now,
        strategy: 'api',
        apiConfig: {
          endpoint: '/Recruit/Home/_GI_List/',
          method: 'POST',
          params: {
            page: 'page',
            pageSize: 'pagesize',
          },
        },
      });

      // Then
      expect(structure.strategy).toBe('api');
      expect(structure.apiConfig).toBeDefined();
      expect(structure.apiConfig?.endpoint).toBe('/Recruit/Home/_GI_List/');
      expect(structure.apiConfig?.method).toBe('POST');
    });

    it('API 전략일 때 apiConfig가 없으면 에러가 발생한다', () => {
      // Given
      const now = new Date('2025-01-15T10:00:00Z');

      // When & Then
      expect(() =>
        PageStructure.createListPage({
          urlPattern: '/jobs',
          selectors: createListSelectors(),
          analyzedAt: now,
          strategy: 'api',
          // apiConfig 누락
        })
      ).toThrow('API 전략에는 apiConfig가 필수입니다');
    });

    it('toJSON에 strategy가 포함된다', () => {
      // Given
      const now = new Date('2025-01-15T10:00:00Z');
      const structure = PageStructure.createListPage({
        urlPattern: '/jobs',
        selectors: createListSelectors(),
        analyzedAt: now,
        strategy: 'api',
        apiConfig: {
          endpoint: '/api/jobs',
          method: 'GET',
        },
      });

      // When
      const json = structure.toJSON();

      // Then
      expect(json.strategy).toBe('api');
      expect(json.apiConfig).toEqual({
        endpoint: '/api/jobs',
        method: 'GET',
      });
    });

    it('fromJSON에서 strategy가 복원된다', () => {
      // Given
      const json = {
        pageType: 'list' as PageType,
        urlPattern: '/jobs',
        selectors: createListSelectors(),
        analyzedAt: '2025-01-15T10:00:00.000Z',
        expiresAt: '2025-01-22T10:00:00.000Z',
        strategy: 'api' as CrawlStrategy,
        apiConfig: {
          endpoint: '/api/jobs',
          method: 'POST' as const,
          params: { page: 'p' },
        },
      };

      // When
      const structure = PageStructure.fromJSON(json);

      // Then
      expect(structure.strategy).toBe('api');
      expect(structure.apiConfig?.endpoint).toBe('/api/jobs');
    });

    it('fromJSON에서 strategy가 없으면 dom으로 기본값 설정된다', () => {
      // Given: 기존 캐시 형식 (strategy 없음)
      const json = {
        pageType: 'list' as PageType,
        urlPattern: '/jobs',
        selectors: createListSelectors(),
        analyzedAt: '2025-01-15T10:00:00.000Z',
        expiresAt: '2025-01-22T10:00:00.000Z',
      };

      // When
      const structure = PageStructure.fromJSON(json);

      // Then
      expect(structure.strategy).toBe('dom');
      expect(structure.apiConfig).toBeUndefined();
    });
  });
});
