import { describe, it, expect } from 'vitest';
import { MemoryBlock, MemoryManager } from './memoryBlock.domain.js';

describe('MemoryBlock 도메인', () => {
  describe('MemoryBlock 생성', () => {
    it('새 메모리 블록을 생성할 수 있다', () => {
      // When
      const block = MemoryBlock.create({
        name: 'persona',
        content: '채용공고 크롤러',
        maxTokens: 200,
        priority: 1,
      });

      // Then
      expect(block.name).toBe('persona');
      expect(block.content).toBe('채용공고 크롤러');
      expect(block.maxTokens).toBe(200);
      expect(block.priority).toBe(1);
    });

    it('토큰 수를 추정할 수 있다 (문자 수 / 4 기준)', () => {
      // Given
      const block = MemoryBlock.create({
        name: 'test',
        content: '이것은 테스트 문자열입니다', // 14자 → 약 3-4 토큰
        maxTokens: 100,
        priority: 1,
      });

      // When
      const tokens = block.estimatedTokens;

      // Then
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThanOrEqual(block.maxTokens);
    });

    it('블록이 용량 초과인지 확인할 수 있다', () => {
      // Given
      const block = MemoryBlock.create({
        name: 'test',
        content: 'A'.repeat(100), // 100자 → 25토큰
        maxTokens: 10, // 10토큰 제한
        priority: 1,
      });

      // Then
      expect(block.isOverCapacity()).toBe(true);
    });
  });

  describe('MemoryBlock 업데이트', () => {
    it('내용을 업데이트하면 새 블록이 반환된다 (불변성)', () => {
      // Given
      const block = MemoryBlock.create({
        name: 'current_task',
        content: '원래 내용',
        maxTokens: 500,
        priority: 2,
      });

      // When
      const updated = block.updateContent('새로운 내용');

      // Then
      expect(updated.content).toBe('새로운 내용');
      expect(block.content).toBe('원래 내용'); // 원본 불변
    });

    it('내용을 추가할 수 있다', () => {
      // Given
      const block = MemoryBlock.create({
        name: 'collected_data',
        content: '토스',
        maxTokens: 2000,
        priority: 3,
      });

      // When
      const updated = block.appendContent(', 카카오, 라인');

      // Then
      expect(updated.content).toBe('토스, 카카오, 라인');
    });
  });
});

describe('MemoryManager', () => {
  describe('블록 관리', () => {
    it('여러 블록을 초기화할 수 있다', () => {
      // When
      const manager = MemoryManager.create([
        { name: 'persona', content: '크롤러', maxTokens: 200, priority: 1 },
        { name: 'task', content: '수집 중', maxTokens: 500, priority: 2 },
      ]);

      // Then
      expect(manager.blockCount).toBe(2);
    });

    it('이름으로 블록을 조회할 수 있다', () => {
      // Given
      const manager = MemoryManager.create([
        { name: 'persona', content: '크롤러', maxTokens: 200, priority: 1 },
      ]);

      // When
      const block = manager.getBlock('persona');

      // Then
      expect(block).toBeDefined();
      expect(block?.content).toBe('크롤러');
    });

    it('블록 내용을 업데이트할 수 있다', () => {
      // Given
      const manager = MemoryManager.create([
        { name: 'task', content: '시작', maxTokens: 500, priority: 2 },
      ]);

      // When
      const updated = manager.updateBlock('task', '진행 중');

      // Then
      expect(updated.getBlock('task')?.content).toBe('진행 중');
      expect(manager.getBlock('task')?.content).toBe('시작'); // 원본 불변
    });

    it('블록에 내용을 추가할 수 있다', () => {
      // Given
      const manager = MemoryManager.create([
        { name: 'data', content: '토스', maxTokens: 2000, priority: 3 },
      ]);

      // When
      const updated = manager.appendToBlock('data', ', 카카오');

      // Then
      expect(updated.getBlock('data')?.content).toBe('토스, 카카오');
    });
  });

  describe('컨텍스트 빌드', () => {
    it('모든 블록을 마크다운 형식으로 조합할 수 있다', () => {
      // Given
      const manager = MemoryManager.create([
        { name: 'persona', content: '크롤러', maxTokens: 200, priority: 1 },
        { name: 'task', content: '수집 중', maxTokens: 500, priority: 2 },
      ]);

      // When
      const context = manager.buildContext();

      // Then
      expect(context).toContain('## persona');
      expect(context).toContain('크롤러');
      expect(context).toContain('## task');
      expect(context).toContain('수집 중');
    });

    it('블록은 우선순위 순서로 정렬된다', () => {
      // Given
      const manager = MemoryManager.create([
        { name: 'low', content: '낮은 우선순위', maxTokens: 100, priority: 3 },
        { name: 'high', content: '높은 우선순위', maxTokens: 100, priority: 1 },
        { name: 'mid', content: '중간 우선순위', maxTokens: 100, priority: 2 },
      ]);

      // When
      const context = manager.buildContext();

      // Then
      const highIndex = context.indexOf('높은 우선순위');
      const midIndex = context.indexOf('중간 우선순위');
      const lowIndex = context.indexOf('낮은 우선순위');
      expect(highIndex).toBeLessThan(midIndex);
      expect(midIndex).toBeLessThan(lowIndex);
    });
  });

  describe('용량 관리', () => {
    it('전체 토큰 사용량을 계산할 수 있다', () => {
      // Given
      const manager = MemoryManager.create([
        { name: 'a', content: 'AAAA', maxTokens: 100, priority: 1 }, // 1토큰
        { name: 'b', content: 'BBBB', maxTokens: 100, priority: 2 }, // 1토큰
      ]);

      // When
      const usage = manager.totalEstimatedTokens;

      // Then
      expect(usage).toBeGreaterThan(0);
    });

    it('최대 허용 토큰을 설정할 수 있다', () => {
      // Given
      const manager = MemoryManager.create(
        [{ name: 'a', content: 'test', maxTokens: 100, priority: 1 }],
        { maxTotalTokens: 4000 }
      );

      // When
      const usage = manager.usagePercentage;

      // Then
      expect(usage).toBeGreaterThanOrEqual(0);
      expect(usage).toBeLessThanOrEqual(100);
    });

    it('용량 임계치 도달 여부를 확인할 수 있다', () => {
      // Given - 작은 maxTotalTokens으로 설정
      const manager = MemoryManager.create(
        [{ name: 'a', content: 'A'.repeat(100), maxTokens: 1000, priority: 1 }],
        { maxTotalTokens: 30, compressionThreshold: 0.9 }
      );

      // Then
      expect(manager.needsCompression()).toBe(true);
    });
  });

  describe('압축', () => {
    it('우선순위가 낮은 블록부터 압축 대상이 된다', () => {
      // Given
      const manager = MemoryManager.create([
        { name: 'critical', content: '중요', maxTokens: 100, priority: 1 },
        { name: 'normal', content: '일반', maxTokens: 100, priority: 2 },
        { name: 'disposable', content: '삭제가능', maxTokens: 100, priority: 4 },
      ]);

      // When
      const candidates = manager.getCompressionCandidates();

      // Then
      expect(candidates[0]?.name).toBe('disposable');
      expect(candidates[candidates.length - 1]?.name).toBe('critical');
    });

    it('블록을 요약된 내용으로 대체할 수 있다', () => {
      // Given
      const manager = MemoryManager.create([
        {
          name: 'actions',
          content: 'navigate → click → extract → wait → click → extract',
          maxTokens: 100,
          priority: 4,
        },
      ]);

      // When
      const compressed = manager.compressBlock('actions', '최근: click → extract (2회)');

      // Then
      expect(compressed.getBlock('actions')?.content).toBe('최근: click → extract (2회)');
    });
  });

  describe('JSON 직렬화', () => {
    it('JSON으로 직렬화할 수 있다', () => {
      // Given
      const manager = MemoryManager.create([
        { name: 'task', content: '진행 중', maxTokens: 500, priority: 2 },
      ]);

      // When
      const json = manager.toJSON();

      // Then
      expect(json.blocks).toHaveLength(1);
      expect(json.blocks[0]?.name).toBe('task');
    });

    it('JSON에서 복원할 수 있다', () => {
      // Given
      const json = {
        blocks: [{ name: 'task', content: '진행 중', maxTokens: 500, priority: 2 }],
        options: { maxTotalTokens: 4000, compressionThreshold: 0.9 },
      };

      // When
      const manager = MemoryManager.fromJSON(json);

      // Then
      expect(manager.getBlock('task')?.content).toBe('진행 중');
    });
  });
});
