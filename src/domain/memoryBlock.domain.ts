// Memory Blocks 패턴 도메인 모델
// MemGPT/Letta 방식의 컨텍스트 윈도우 관리

// 블록 생성 인자
interface MemoryBlockCreateArgs {
  name: string;
  content: string;
  maxTokens: number;
  priority: number; // 낮을수록 중요 (1 = 절대 삭제 안 함)
}

// JSON 직렬화 형태
interface MemoryBlockJSON {
  name: string;
  content: string;
  maxTokens: number;
  priority: number;
}

/**
 * 메모리 블록 도메인 객체
 * - 이름, 내용, 최대 토큰, 우선순위로 구성
 * - 불변 객체 패턴 적용
 */
export class MemoryBlock {
  private constructor(
    private readonly _name: string,
    private readonly _content: string,
    private readonly _maxTokens: number,
    private readonly _priority: number
  ) {}

  /**
   * 새 메모리 블록 생성
   */
  static create(args: MemoryBlockCreateArgs): MemoryBlock {
    return new MemoryBlock(args.name, args.content, args.maxTokens, args.priority);
  }

  /**
   * JSON에서 복원
   */
  static fromJSON(json: MemoryBlockJSON): MemoryBlock {
    return new MemoryBlock(json.name, json.content, json.maxTokens, json.priority);
  }

  // Getters
  get name(): string {
    return this._name;
  }

  get content(): string {
    return this._content;
  }

  get maxTokens(): number {
    return this._maxTokens;
  }

  get priority(): number {
    return this._priority;
  }

  /**
   * 예상 토큰 수 (문자 수 / 4 기준, 한글은 더 많을 수 있음)
   */
  get estimatedTokens(): number {
    // 한글은 대략 1.5~2배, 영어는 4문자당 1토큰
    // 간단하게 문자 수 / 3으로 추정 (한글 고려)
    return Math.ceil(this._content.length / 3);
  }

  /**
   * 용량 초과 여부
   */
  isOverCapacity(): boolean {
    return this.estimatedTokens > this._maxTokens;
  }

  /**
   * 내용 업데이트 (불변성 유지)
   */
  updateContent(newContent: string): MemoryBlock {
    return new MemoryBlock(this._name, newContent, this._maxTokens, this._priority);
  }

  /**
   * 내용 추가 (불변성 유지)
   */
  appendContent(additionalContent: string): MemoryBlock {
    return new MemoryBlock(
      this._name,
      this._content + additionalContent,
      this._maxTokens,
      this._priority
    );
  }

  /**
   * JSON으로 직렬화
   */
  toJSON(): MemoryBlockJSON {
    return {
      name: this._name,
      content: this._content,
      maxTokens: this._maxTokens,
      priority: this._priority,
    };
  }
}

// MemoryManager 옵션
interface MemoryManagerOptions {
  maxTotalTokens: number; // 전체 최대 토큰
  compressionThreshold: number; // 압축 시작 임계치 (0.0 ~ 1.0)
}

// MemoryManager JSON 직렬화 형태
interface MemoryManagerJSON {
  blocks: MemoryBlockJSON[];
  options: MemoryManagerOptions;
}

const DEFAULT_OPTIONS: MemoryManagerOptions = {
  maxTotalTokens: 8000,
  compressionThreshold: 0.9,
};

/**
 * 메모리 관리자
 * - 여러 메모리 블록을 관리
 * - 컨텍스트 빌드 및 압축 담당
 * - 불변 객체 패턴 적용
 */
export class MemoryManager {
  private constructor(
    private readonly _blocks: MemoryBlock[],
    private readonly _options: MemoryManagerOptions
  ) {}

  /**
   * 블록 배열로 생성
   */
  static create(
    blockArgs: MemoryBlockCreateArgs[],
    options?: Partial<MemoryManagerOptions>
  ): MemoryManager {
    const blocks = blockArgs.map((args) => MemoryBlock.create(args));
    return new MemoryManager(blocks, { ...DEFAULT_OPTIONS, ...options });
  }

  /**
   * JSON에서 복원
   */
  static fromJSON(json: MemoryManagerJSON): MemoryManager {
    const blocks = json.blocks.map((b) => MemoryBlock.fromJSON(b));
    return new MemoryManager(blocks, json.options);
  }

  // Getters
  get blockCount(): number {
    return this._blocks.length;
  }

  /**
   * 전체 예상 토큰 수
   */
  get totalEstimatedTokens(): number {
    return this._blocks.reduce((sum, block) => sum + block.estimatedTokens, 0);
  }

  /**
   * 사용률 (0 ~ 100)
   */
  get usagePercentage(): number {
    return (this.totalEstimatedTokens / this._options.maxTotalTokens) * 100;
  }

  /**
   * 이름으로 블록 조회
   */
  getBlock(name: string): MemoryBlock | undefined {
    return this._blocks.find((b) => b.name === name);
  }

  /**
   * 블록 내용 업데이트 (불변성 유지)
   */
  updateBlock(name: string, newContent: string): MemoryManager {
    const newBlocks = this._blocks.map((block) =>
      block.name === name ? block.updateContent(newContent) : block
    );
    return new MemoryManager(newBlocks, this._options);
  }

  /**
   * 블록에 내용 추가 (불변성 유지)
   */
  appendToBlock(name: string, additionalContent: string): MemoryManager {
    const newBlocks = this._blocks.map((block) =>
      block.name === name ? block.appendContent(additionalContent) : block
    );
    return new MemoryManager(newBlocks, this._options);
  }

  /**
   * 전체 컨텍스트를 마크다운 형식으로 빌드
   * - 우선순위 순으로 정렬 (낮은 숫자가 먼저)
   */
  buildContext(): string {
    const sortedBlocks = [...this._blocks].sort((a, b) => a.priority - b.priority);

    return sortedBlocks.map((block) => `## ${block.name}\n${block.content}`).join('\n\n');
  }

  /**
   * 압축이 필요한지 확인
   */
  needsCompression(): boolean {
    const usageRatio = this.totalEstimatedTokens / this._options.maxTotalTokens;
    return usageRatio >= this._options.compressionThreshold;
  }

  /**
   * 압축 대상 블록 목록 반환 (우선순위 높은 것부터, 즉 priority 숫자 큰 것)
   */
  getCompressionCandidates(): MemoryBlock[] {
    return [...this._blocks].sort((a, b) => b.priority - a.priority);
  }

  /**
   * 특정 블록을 압축된 내용으로 대체 (불변성 유지)
   */
  compressBlock(name: string, compressedContent: string): MemoryManager {
    return this.updateBlock(name, compressedContent);
  }

  /**
   * JSON으로 직렬화
   */
  toJSON(): MemoryManagerJSON {
    return {
      blocks: this._blocks.map((b) => b.toJSON()),
      options: this._options,
    };
  }
}
