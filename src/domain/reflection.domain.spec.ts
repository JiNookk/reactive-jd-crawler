import { describe, it, expect } from 'vitest';
import {
  ReflectionContext,
  ReflectionResult,
  ReflectionPromptBuilder,
} from './reflection.domain.js';

describe('Reflection 도메인', () => {
  describe('ReflectionContext 생성', () => {
    it('실패한 도구 정보로 컨텍스트를 생성할 수 있다', () => {
      // Given
      const toolName = 'click';
      const toolInput = { selector: '.job-card' };
      const error = 'Element not found: .job-card';
      const history = [
        { step: 1, toolName: 'get_page_info', result: 'success' },
        { step: 2, toolName: 'click', result: 'failed' },
      ];

      // When
      const context = ReflectionContext.create({
        toolName,
        toolInput,
        error,
        history,
      });

      // Then
      expect(context.toolName).toBe('click');
      expect(context.toolInput).toEqual({ selector: '.job-card' });
      expect(context.error).toBe('Element not found: .job-card');
      expect(context.history).toHaveLength(2);
    });

    it('히스토리가 없어도 컨텍스트를 생성할 수 있다', () => {
      // Given & When
      const context = ReflectionContext.create({
        toolName: 'navigate',
        toolInput: { url: 'https://example.com' },
        error: 'Timeout',
        history: [],
      });

      // Then
      expect(context.history).toHaveLength(0);
    });

    it('최근 N개의 히스토리만 추출할 수 있다', () => {
      // Given
      const history = [
        { step: 1, toolName: 'get_page_info', result: 'success' },
        { step: 2, toolName: 'scroll', result: 'success' },
        { step: 3, toolName: 'extract_jobs', result: 'success' },
        { step: 4, toolName: 'click', result: 'failed' },
        { step: 5, toolName: 'click', result: 'failed' },
      ];
      const context = ReflectionContext.create({
        toolName: 'click',
        toolInput: { selector: '.next' },
        error: 'Element not visible',
        history,
      });

      // When
      const recent = context.getRecentHistory(3);

      // Then
      expect(recent).toHaveLength(3);
      expect(recent[0]!.step).toBe(3);
      expect(recent[2]!.step).toBe(5);
    });

    it('연속 실패 횟수를 계산할 수 있다', () => {
      // Given
      const history = [
        { step: 1, toolName: 'get_page_info', result: 'success' },
        { step: 2, toolName: 'click', result: 'failed' },
        { step: 3, toolName: 'click', result: 'failed' },
        { step: 4, toolName: 'click', result: 'failed' },
      ];
      const context = ReflectionContext.create({
        toolName: 'click',
        toolInput: { selector: '.next' },
        error: 'Element not found',
        history,
      });

      // When
      const count = context.getConsecutiveFailureCount();

      // Then
      expect(count).toBe(3);
    });

    it('성공 후 실패가 있으면 연속 실패는 성공 이후부터 카운트한다', () => {
      // Given
      const history = [
        { step: 1, toolName: 'click', result: 'failed' },
        { step: 2, toolName: 'click', result: 'failed' },
        { step: 3, toolName: 'scroll', result: 'success' },
        { step: 4, toolName: 'click', result: 'failed' },
      ];
      const context = ReflectionContext.create({
        toolName: 'click',
        toolInput: { selector: '.load-more' },
        error: 'Timeout',
        history,
      });

      // When
      const count = context.getConsecutiveFailureCount();

      // Then
      expect(count).toBe(1);
    });
  });

  describe('ReflectionResult 생성', () => {
    it('반성 결과를 생성할 수 있다', () => {
      // Given & When
      const result = ReflectionResult.create({
        analysis: '셀렉터가 페이지에 존재하지 않습니다',
        suggestion: '더 일반적인 셀렉터를 시도하세요',
        shouldRetry: true,
        alternativeAction: {
          toolName: 'click',
          toolInput: { selector: '[class*="job"]' },
        },
      });

      // Then
      expect(result.analysis).toBe('셀렉터가 페이지에 존재하지 않습니다');
      expect(result.suggestion).toBe('더 일반적인 셀렉터를 시도하세요');
      expect(result.shouldRetry).toBe(true);
      expect(result.alternativeAction).toBeDefined();
    });

    it('재시도하지 않을 경우 대안 액션은 없을 수 있다', () => {
      // Given & When
      const result = ReflectionResult.create({
        analysis: '페이지 구조가 완전히 변경되었습니다',
        suggestion: '크롤링을 중단하고 페이지 분석을 다시 수행하세요',
        shouldRetry: false,
      });

      // Then
      expect(result.shouldRetry).toBe(false);
      expect(result.alternativeAction).toBeUndefined();
    });

    it('프롬프트용 문자열로 변환할 수 있다', () => {
      // Given
      const result = ReflectionResult.create({
        analysis: '.next 버튼을 찾을 수 없습니다',
        suggestion: 'URL 파라미터로 페이지네이션을 시도하세요',
        shouldRetry: true,
      });

      // When
      const promptText = result.toPromptText();

      // Then
      expect(promptText).toContain('.next 버튼을 찾을 수 없습니다');
      expect(promptText).toContain('URL 파라미터로 페이지네이션을 시도하세요');
    });
  });

  describe('ReflectionPromptBuilder', () => {
    it('컨텍스트에서 반성 프롬프트를 생성할 수 있다', () => {
      // Given
      const context = ReflectionContext.create({
        toolName: 'click',
        toolInput: { selector: '.pagination-next' },
        error: 'Element not found',
        history: [
          { step: 1, toolName: 'get_page_info', result: 'success' },
          { step: 2, toolName: 'extract_jobs', result: 'success' },
          { step: 3, toolName: 'click', result: 'failed' },
        ],
      });

      // When
      const prompt = ReflectionPromptBuilder.build(context);

      // Then
      expect(prompt).toContain('click');
      expect(prompt).toContain('.pagination-next');
      expect(prompt).toContain('Element not found');
      expect(prompt).toContain('실패 원인을 분석');
    });

    it('연속 실패가 많으면 전략 변경을 강조한다', () => {
      // Given
      const context = ReflectionContext.create({
        toolName: 'click',
        toolInput: { selector: '.next' },
        error: 'Element not found',
        history: [
          { step: 1, toolName: 'click', result: 'failed' },
          { step: 2, toolName: 'click', result: 'failed' },
          { step: 3, toolName: 'click', result: 'failed' },
        ],
      });

      // When
      const prompt = ReflectionPromptBuilder.build(context);

      // Then
      expect(prompt).toContain('연속 3회 실패');
      expect(prompt).toContain('다른 접근 방식');
    });

    it('프롬프트에 히스토리 요약이 포함된다', () => {
      // Given
      const context = ReflectionContext.create({
        toolName: 'scroll',
        toolInput: { direction: 'down' },
        error: 'Page not scrollable',
        history: [
          { step: 1, toolName: 'navigate', result: 'success' },
          { step: 2, toolName: 'get_page_info', result: 'success' },
        ],
      });

      // When
      const prompt = ReflectionPromptBuilder.build(context);

      // Then
      expect(prompt).toContain('이전 작업 히스토리');
      expect(prompt).toContain('navigate');
      expect(prompt).toContain('get_page_info');
    });
  });
});
