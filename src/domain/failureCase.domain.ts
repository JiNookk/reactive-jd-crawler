// 실패 케이스 도메인 모델
// 에이전트의 도구 실행 실패를 구조화하여 저장하고 Few-shot 예시로 활용

// Reflexion 분석 결과 (선택적)
interface ReflectionInfo {
  analysis: string;
  suggestion: string;
  shouldRetry: boolean;
  alternativeAction?: {
    toolName: string;
    toolInput: unknown;
  };
}

// FailureCase 생성 인자
interface FailureCaseCreateArgs {
  timestamp: Date;
  url: string;
  company: string;
  toolName: string;
  toolInput: unknown;
  error: string;
  pageContext: string;
  reflection?: ReflectionInfo;
}

// JSON 직렬화 형태
interface FailureCaseJSON {
  timestamp: string;
  url: string;
  company: string;
  toolName: string;
  toolInput: unknown;
  error: string;
  pageContext: string;
  reflection?: ReflectionInfo;
  resolution?: string;
}

/**
 * 실패 케이스 도메인 객체
 * - 도구 실행 실패 정보를 구조화하여 저장
 * - Few-shot 예시로 변환 가능
 * - 불변 객체 패턴 적용
 */
export class FailureCase {
  private constructor(
    private readonly _timestamp: string,
    private readonly _url: string,
    private readonly _company: string,
    private readonly _toolName: string,
    private readonly _toolInput: unknown,
    private readonly _error: string,
    private readonly _pageContext: string,
    private readonly _reflection?: ReflectionInfo,
    private readonly _resolution?: string
  ) {}

  /**
   * 새 실패 케이스 생성
   */
  static create(args: FailureCaseCreateArgs): FailureCase {
    return new FailureCase(
      args.timestamp.toISOString(),
      args.url,
      args.company,
      args.toolName,
      args.toolInput,
      args.error,
      args.pageContext,
      args.reflection,
      undefined
    );
  }

  /**
   * JSON에서 복원
   */
  static fromJSON(json: FailureCaseJSON): FailureCase {
    return new FailureCase(
      json.timestamp,
      json.url,
      json.company,
      json.toolName,
      json.toolInput,
      json.error,
      json.pageContext,
      json.reflection,
      json.resolution
    );
  }

  // Getters
  get timestamp(): string {
    return this._timestamp;
  }

  get url(): string {
    return this._url;
  }

  get company(): string {
    return this._company;
  }

  get toolName(): string {
    return this._toolName;
  }

  get toolInput(): unknown {
    return this._toolInput;
  }

  get error(): string {
    return this._error;
  }

  get pageContext(): string {
    return this._pageContext;
  }

  get reflection(): ReflectionInfo | undefined {
    return this._reflection;
  }

  get resolution(): string | undefined {
    return this._resolution;
  }

  /**
   * 해결 방법 추가 (불변성 유지)
   */
  addResolution(resolution: string): FailureCase {
    return new FailureCase(
      this._timestamp,
      this._url,
      this._company,
      this._toolName,
      this._toolInput,
      this._error,
      this._pageContext,
      this._reflection,
      resolution
    );
  }

  /**
   * Few-shot 예시 문자열로 변환
   */
  toFewShot(): string {
    const toolInputStr = JSON.stringify(this._toolInput);

    let result = `### 실패 사례 (${this._timestamp})
URL: ${this._url}
회사: ${this._company}
페이지 상태: ${this._pageContext}
시도: ${this._toolName}(${toolInputStr})
결과: 실패 - ${this._error}`;

    if (this._reflection) {
      result += `
분석: ${this._reflection.analysis}
제안: ${this._reflection.suggestion}`;
    }

    result += `
해결: ${this._resolution || '미해결'}`;

    return result;
  }

  /**
   * JSON으로 직렬화
   */
  toJSON(): FailureCaseJSON {
    const json: FailureCaseJSON = {
      timestamp: this._timestamp,
      url: this._url,
      company: this._company,
      toolName: this._toolName,
      toolInput: this._toolInput,
      error: this._error,
      pageContext: this._pageContext,
    };

    if (this._reflection) {
      json.reflection = this._reflection;
    }

    if (this._resolution) {
      json.resolution = this._resolution;
    }

    return json;
  }

  // === 정적 통계 메서드 ===

  /**
   * 도구별 실패 횟수 통계
   */
  static getToolStats(cases: FailureCase[]): Map<string, number> {
    const stats = new Map<string, number>();

    for (const fc of cases) {
      const current = stats.get(fc.toolName) || 0;
      stats.set(fc.toolName, current + 1);
    }

    return stats;
  }

  /**
   * 해결률 계산 (해결된 케이스 / 전체 케이스)
   */
  static getResolutionRate(cases: FailureCase[]): number {
    if (cases.length === 0) return 0;

    const resolvedCount = cases.filter((fc) => fc.resolution !== undefined).length;
    return resolvedCount / cases.length;
  }
}
