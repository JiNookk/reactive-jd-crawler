import { describe, it, expect } from 'vitest';
import { AgentCheckpoint, CheckpointStatus } from './checkpoint.domain.js';

describe('AgentCheckpoint 도메인', () => {
  describe('생성', () => {
    it('새 체크포인트를 생성할 수 있다', () => {
      // Given
      const now = new Date('2025-01-15T10:00:00Z');

      // When
      const checkpoint = AgentCheckpoint.create({
        sessionId: 'session-123',
        url: 'https://example.com/jobs',
        company: 'Example Corp',
        createdAt: now,
      });

      // Then
      expect(checkpoint.sessionId).toBe('session-123');
      expect(checkpoint.url).toBe('https://example.com/jobs');
      expect(checkpoint.company).toBe('Example Corp');
      expect(checkpoint.status).toBe('in_progress');
      expect(checkpoint.extractedJobs).toHaveLength(0);
      expect(checkpoint.history).toHaveLength(0);
    });

    it('수집된 직무를 포함하여 생성할 수 있다', () => {
      // Given
      const now = new Date('2025-01-15T10:00:00Z');
      const jobs = [
        { title: 'Engineer', location: 'Seoul', department: 'Tech' },
        { title: 'Designer', location: 'Busan', department: 'Design' },
      ];

      // When
      const checkpoint = AgentCheckpoint.create({
        sessionId: 'session-123',
        url: 'https://example.com/jobs',
        company: 'Example Corp',
        createdAt: now,
        extractedJobs: jobs,
      });

      // Then
      expect(checkpoint.extractedJobs).toHaveLength(2);
      expect(checkpoint.extractedJobs[0]!.title).toBe('Engineer');
    });
  });

  describe('상태 업데이트', () => {
    it('진행 중 상태를 완료로 변경할 수 있다', () => {
      // Given
      const checkpoint = AgentCheckpoint.create({
        sessionId: 'session-123',
        url: 'https://example.com/jobs',
        company: 'Example Corp',
        createdAt: new Date('2025-01-15T10:00:00Z'),
      });

      // When
      const updated = checkpoint.complete(new Date('2025-01-15T10:30:00Z'));

      // Then
      expect(updated.status).toBe('completed');
      expect(updated.updatedAt).toBe('2025-01-15T10:30:00.000Z');
    });

    it('실패 상태로 변경하고 이유를 기록할 수 있다', () => {
      // Given
      const checkpoint = AgentCheckpoint.create({
        sessionId: 'session-123',
        url: 'https://example.com/jobs',
        company: 'Example Corp',
        createdAt: new Date('2025-01-15T10:00:00Z'),
      });

      // When
      const updated = checkpoint.fail(
        'Timeout: 페이지 로드 실패',
        new Date('2025-01-15T10:15:00Z')
      );

      // Then
      expect(updated.status).toBe('failed');
      expect(updated.failureReason).toBe('Timeout: 페이지 로드 실패');
    });

    it('중단 상태로 변경하고 재개 힌트를 기록할 수 있다', () => {
      // Given
      const checkpoint = AgentCheckpoint.create({
        sessionId: 'session-123',
        url: 'https://example.com/jobs',
        company: 'Example Corp',
        createdAt: new Date('2025-01-15T10:00:00Z'),
      });

      // When
      const updated = checkpoint.suspend(
        '3페이지부터 재개 필요',
        new Date('2025-01-15T10:20:00Z')
      );

      // Then
      expect(updated.status).toBe('suspended');
      expect(updated.resumeHint).toBe('3페이지부터 재개 필요');
    });
  });

  describe('히스토리 관리', () => {
    it('액션 히스토리를 추가할 수 있다', () => {
      // Given
      const checkpoint = AgentCheckpoint.create({
        sessionId: 'session-123',
        url: 'https://example.com/jobs',
        company: 'Example Corp',
        createdAt: new Date('2025-01-15T10:00:00Z'),
      });

      // When
      const updated = checkpoint.addHistoryItem({
        step: 1,
        toolName: 'get_page_info',
        toolInput: {},
        result: 'success',
        observation: 'Page loaded successfully',
      });

      // Then
      expect(updated.history).toHaveLength(1);
      expect(updated.history[0]!.toolName).toBe('get_page_info');
    });

    it('직무 수집을 기록할 수 있다', () => {
      // Given
      const checkpoint = AgentCheckpoint.create({
        sessionId: 'session-123',
        url: 'https://example.com/jobs',
        company: 'Example Corp',
        createdAt: new Date('2025-01-15T10:00:00Z'),
      });

      // When
      const updated = checkpoint.addExtractedJobs([
        { title: 'Engineer', location: 'Seoul' },
        { title: 'Designer', location: 'Busan' },
      ]);

      // Then
      expect(updated.extractedJobs).toHaveLength(2);
    });

    it('직무 수집 시 중복은 제거된다', () => {
      // Given
      const checkpoint = AgentCheckpoint.create({
        sessionId: 'session-123',
        url: 'https://example.com/jobs',
        company: 'Example Corp',
        createdAt: new Date('2025-01-15T10:00:00Z'),
        extractedJobs: [{ title: 'Engineer', location: 'Seoul' }],
      });

      // When
      const updated = checkpoint.addExtractedJobs([
        { title: 'Engineer', location: 'Seoul' }, // 중복
        { title: 'Designer', location: 'Busan' }, // 신규
      ]);

      // Then
      expect(updated.extractedJobs).toHaveLength(2);
    });
  });

  describe('JSON 직렬화', () => {
    it('toJSON으로 직렬화할 수 있다', () => {
      // Given
      const checkpoint = AgentCheckpoint.create({
        sessionId: 'session-123',
        url: 'https://example.com/jobs',
        company: 'Example Corp',
        createdAt: new Date('2025-01-15T10:00:00Z'),
      });

      // When
      const json = checkpoint.toJSON();

      // Then
      expect(json.sessionId).toBe('session-123');
      expect(json.url).toBe('https://example.com/jobs');
      expect(json.company).toBe('Example Corp');
      expect(json.status).toBe('in_progress');
      expect(json.createdAt).toBe('2025-01-15T10:00:00.000Z');
    });

    it('fromJSON으로 복원할 수 있다', () => {
      // Given
      const json = {
        sessionId: 'session-456',
        url: 'https://example.com/careers',
        company: 'Test Inc',
        status: 'suspended' as CheckpointStatus,
        createdAt: '2025-01-15T10:00:00.000Z',
        updatedAt: '2025-01-15T10:30:00.000Z',
        extractedJobs: [{ title: 'Manager', location: 'Tokyo' }],
        history: [
          { step: 1, toolName: 'navigate', toolInput: {}, result: 'success' },
        ],
        resumeHint: '페이지 2부터 재개',
      };

      // When
      const checkpoint = AgentCheckpoint.fromJSON(json);

      // Then
      expect(checkpoint.sessionId).toBe('session-456');
      expect(checkpoint.status).toBe('suspended');
      expect(checkpoint.resumeHint).toBe('페이지 2부터 재개');
      expect(checkpoint.extractedJobs).toHaveLength(1);
      expect(checkpoint.history).toHaveLength(1);
    });
  });

  describe('재개 가능 여부', () => {
    it('suspended 상태는 재개 가능하다', () => {
      // Given
      const checkpoint = AgentCheckpoint.create({
        sessionId: 'session-123',
        url: 'https://example.com/jobs',
        company: 'Example Corp',
        createdAt: new Date('2025-01-15T10:00:00Z'),
      }).suspend('페이지 3부터', new Date('2025-01-15T10:20:00Z'));

      // When & Then
      expect(checkpoint.canResume()).toBe(true);
    });

    it('failed 상태는 재개 가능하다', () => {
      // Given
      const checkpoint = AgentCheckpoint.create({
        sessionId: 'session-123',
        url: 'https://example.com/jobs',
        company: 'Example Corp',
        createdAt: new Date('2025-01-15T10:00:00Z'),
      }).fail('Timeout', new Date('2025-01-15T10:15:00Z'));

      // When & Then
      expect(checkpoint.canResume()).toBe(true);
    });

    it('completed 상태는 재개할 수 없다', () => {
      // Given
      const checkpoint = AgentCheckpoint.create({
        sessionId: 'session-123',
        url: 'https://example.com/jobs',
        company: 'Example Corp',
        createdAt: new Date('2025-01-15T10:00:00Z'),
      }).complete(new Date('2025-01-15T10:30:00Z'));

      // When & Then
      expect(checkpoint.canResume()).toBe(false);
    });

    it('in_progress 상태는 재개할 수 없다 (이미 진행 중)', () => {
      // Given
      const checkpoint = AgentCheckpoint.create({
        sessionId: 'session-123',
        url: 'https://example.com/jobs',
        company: 'Example Corp',
        createdAt: new Date('2025-01-15T10:00:00Z'),
      });

      // When & Then
      expect(checkpoint.canResume()).toBe(false);
    });
  });

  describe('요약 생성', () => {
    it('진행 상황 요약을 생성할 수 있다', () => {
      // Given
      const checkpoint = AgentCheckpoint.create({
        sessionId: 'session-123',
        url: 'https://example.com/jobs',
        company: 'Example Corp',
        createdAt: new Date('2025-01-15T10:00:00Z'),
        extractedJobs: [
          { title: 'Engineer', location: 'Seoul' },
          { title: 'Designer', location: 'Busan' },
        ],
      }).addHistoryItem({
        step: 1,
        toolName: 'get_page_info',
        toolInput: {},
        result: 'success',
      }).addHistoryItem({
        step: 2,
        toolName: 'extract_jobs',
        toolInput: {},
        result: 'success',
      }).addHistoryItem({
        step: 3,
        toolName: 'click',
        toolInput: { selector: '.next' },
        result: 'failed',
      });

      // When
      const summary = checkpoint.generateSummary();

      // Then
      expect(summary).toContain('Example Corp');
      expect(summary).toContain('2개');
      expect(summary).toContain('3');
    });
  });
});
