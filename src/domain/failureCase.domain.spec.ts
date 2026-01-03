import { describe, it, expect } from 'vitest';
import { FailureCase } from './failureCase.domain.js';

describe('FailureCase 도메인', () => {
  describe('생성', () => {
    it('새 실패 케이스를 생성할 수 있다', () => {
      // Given
      const now = new Date('2026-01-03T10:00:00Z');

      // When
      const failureCase = FailureCase.create({
        timestamp: now,
        url: 'https://example.com/jobs',
        company: 'Example Corp',
        toolName: 'click',
        toolInput: { selector: '.next-page' },
        error: '요소를 찾을 수 없습니다',
        pageContext: '채용공고 목록 페이지, 10개 항목 표시됨',
      });

      // Then
      expect(failureCase.timestamp).toBe('2026-01-03T10:00:00.000Z');
      expect(failureCase.url).toBe('https://example.com/jobs');
      expect(failureCase.company).toBe('Example Corp');
      expect(failureCase.toolName).toBe('click');
      expect(failureCase.toolInput).toEqual({ selector: '.next-page' });
      expect(failureCase.error).toBe('요소를 찾을 수 없습니다');
      expect(failureCase.pageContext).toBe('채용공고 목록 페이지, 10개 항목 표시됨');
      expect(failureCase.resolution).toBeUndefined();
    });

    it('Reflexion 분석 결과를 포함하여 생성할 수 있다', () => {
      // Given
      const now = new Date('2026-01-03T10:00:00Z');

      // When
      const failureCase = FailureCase.create({
        timestamp: now,
        url: 'https://example.com/jobs',
        company: 'Example Corp',
        toolName: 'click',
        toolInput: { selector: '.next-page' },
        error: '요소를 찾을 수 없습니다',
        pageContext: '채용공고 목록 페이지',
        reflection: {
          analysis: '셀렉터가 변경되었을 수 있음',
          suggestion: '다른 셀렉터 시도',
          shouldRetry: true,
        },
      });

      // Then
      expect(failureCase.reflection).toBeDefined();
      expect(failureCase.reflection?.analysis).toBe('셀렉터가 변경되었을 수 있음');
    });
  });

  describe('해결 방법 추가', () => {
    it('해결 방법을 추가할 수 있다', () => {
      // Given
      const failureCase = FailureCase.create({
        timestamp: new Date('2026-01-03T10:00:00Z'),
        url: 'https://example.com/jobs',
        company: 'Example Corp',
        toolName: 'click',
        toolInput: { selector: '.next-page' },
        error: '요소를 찾을 수 없습니다',
        pageContext: '채용공고 목록 페이지',
      });

      // When
      const resolved = failureCase.addResolution(
        'button[aria-label="다음"] 셀렉터를 사용하여 해결'
      );

      // Then
      expect(resolved.resolution).toBe('button[aria-label="다음"] 셀렉터를 사용하여 해결');
      // 원본은 변경되지 않음 (불변성)
      expect(failureCase.resolution).toBeUndefined();
    });
  });

  describe('Few-shot 변환', () => {
    it('Few-shot 예시 문자열로 변환할 수 있다', () => {
      // Given
      const failureCase = FailureCase.create({
        timestamp: new Date('2026-01-03T10:00:00Z'),
        url: 'https://example.com/jobs',
        company: 'Example Corp',
        toolName: 'click',
        toolInput: { selector: '.next-page' },
        error: '요소를 찾을 수 없습니다',
        pageContext: '채용공고 목록 페이지, 10개 항목',
      });

      // When
      const fewShot = failureCase.toFewShot();

      // Then
      expect(fewShot).toContain('### 실패 사례');
      expect(fewShot).toContain('URL: https://example.com/jobs');
      expect(fewShot).toContain('시도: click');
      expect(fewShot).toContain('.next-page');
      expect(fewShot).toContain('실패 - 요소를 찾을 수 없습니다');
      expect(fewShot).toContain('미해결');
    });

    it('해결된 케이스는 해결 방법을 포함한다', () => {
      // Given
      const failureCase = FailureCase.create({
        timestamp: new Date('2026-01-03T10:00:00Z'),
        url: 'https://example.com/jobs',
        company: 'Example Corp',
        toolName: 'click',
        toolInput: { selector: '.next-page' },
        error: '요소를 찾을 수 없습니다',
        pageContext: '채용공고 목록 페이지',
      }).addResolution('aria-label 셀렉터 사용');

      // When
      const fewShot = failureCase.toFewShot();

      // Then
      expect(fewShot).toContain('해결: aria-label 셀렉터 사용');
      expect(fewShot).not.toContain('미해결');
    });
  });

  describe('JSON 직렬화', () => {
    it('toJSON으로 직렬화할 수 있다', () => {
      // Given
      const failureCase = FailureCase.create({
        timestamp: new Date('2026-01-03T10:00:00Z'),
        url: 'https://example.com/jobs',
        company: 'Example Corp',
        toolName: 'click',
        toolInput: { selector: '.next-page' },
        error: '요소를 찾을 수 없습니다',
        pageContext: '채용공고 목록 페이지',
      });

      // When
      const json = failureCase.toJSON();

      // Then
      expect(json.timestamp).toBe('2026-01-03T10:00:00.000Z');
      expect(json.url).toBe('https://example.com/jobs');
      expect(json.company).toBe('Example Corp');
      expect(json.toolName).toBe('click');
      expect(json.error).toBe('요소를 찾을 수 없습니다');
    });

    it('fromJSON으로 복원할 수 있다', () => {
      // Given
      const json = {
        timestamp: '2026-01-03T10:00:00.000Z',
        url: 'https://example.com/jobs',
        company: 'Example Corp',
        toolName: 'click',
        toolInput: { selector: '.next-page' },
        error: '요소를 찾을 수 없습니다',
        pageContext: '채용공고 목록 페이지',
        resolution: 'aria-label 셀렉터 사용',
      };

      // When
      const failureCase = FailureCase.fromJSON(json);

      // Then
      expect(failureCase.timestamp).toBe('2026-01-03T10:00:00.000Z');
      expect(failureCase.company).toBe('Example Corp');
      expect(failureCase.resolution).toBe('aria-label 셀렉터 사용');
    });
  });

  describe('통계', () => {
    it('도구별 실패 횟수를 계산할 수 있다', () => {
      // Given
      const cases = [
        FailureCase.create({
          timestamp: new Date(),
          url: 'https://a.com',
          company: 'A',
          toolName: 'click',
          toolInput: {},
          error: 'e1',
          pageContext: '',
        }),
        FailureCase.create({
          timestamp: new Date(),
          url: 'https://b.com',
          company: 'B',
          toolName: 'click',
          toolInput: {},
          error: 'e2',
          pageContext: '',
        }),
        FailureCase.create({
          timestamp: new Date(),
          url: 'https://c.com',
          company: 'C',
          toolName: 'navigate',
          toolInput: {},
          error: 'e3',
          pageContext: '',
        }),
      ];

      // When
      const stats = FailureCase.getToolStats(cases);

      // Then
      expect(stats.get('click')).toBe(2);
      expect(stats.get('navigate')).toBe(1);
    });

    it('해결률을 계산할 수 있다', () => {
      // Given
      const cases = [
        FailureCase.create({
          timestamp: new Date(),
          url: 'https://a.com',
          company: 'A',
          toolName: 'click',
          toolInput: {},
          error: 'e1',
          pageContext: '',
        }).addResolution('해결됨'),
        FailureCase.create({
          timestamp: new Date(),
          url: 'https://b.com',
          company: 'B',
          toolName: 'click',
          toolInput: {},
          error: 'e2',
          pageContext: '',
        }),
        FailureCase.create({
          timestamp: new Date(),
          url: 'https://c.com',
          company: 'C',
          toolName: 'navigate',
          toolInput: {},
          error: 'e3',
          pageContext: '',
        }).addResolution('해결됨'),
      ];

      // When
      const rate = FailureCase.getResolutionRate(cases);

      // Then
      expect(rate).toBeCloseTo(0.6667, 2); // 2/3 ≈ 66.67%
    });
  });
});
