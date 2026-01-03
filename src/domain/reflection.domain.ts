// Reflexion 패턴 도메인 모델
// 도구 실행 실패 시 분석 및 대안 제안을 위한 도메인 객체

// 히스토리 항목 타입
interface HistoryItem {
  step: number;
  toolName: string;
  result: string;
  thought?: string;
  toolInput?: unknown;
  observation?: string;
}

// 대안 액션 타입
interface AlternativeAction {
  toolName: string;
  toolInput: unknown;
}

// ReflectionContext 생성 인자
interface ReflectionContextCreateArgs {
  toolName: string;
  toolInput: unknown;
  error: string;
  history: HistoryItem[];
}

// ReflectionResult 생성 인자
interface ReflectionResultCreateArgs {
  analysis: string;
  suggestion: string;
  shouldRetry: boolean;
  alternativeAction?: AlternativeAction;
}

/**
 * 반성 컨텍스트 - 실패한 도구 실행에 대한 정보를 담는 값 객체
 */
export class ReflectionContext {
  private constructor(
    private readonly _toolName: string,
    private readonly _toolInput: unknown,
    private readonly _error: string,
    private readonly _history: HistoryItem[]
  ) {}

  static create(args: ReflectionContextCreateArgs): ReflectionContext {
    return new ReflectionContext(
      args.toolName,
      args.toolInput,
      args.error,
      args.history
    );
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

  get history(): HistoryItem[] {
    return [...this._history];
  }

  /**
   * 최근 N개의 히스토리 항목을 반환
   */
  getRecentHistory(n: number): HistoryItem[] {
    if (n <= 0) return [];
    return this._history.slice(-n);
  }

  /**
   * 가장 최근 성공 이후의 연속 실패 횟수를 계산
   */
  getConsecutiveFailureCount(): number {
    let count = 0;
    // 히스토리를 역순으로 순회
    for (let i = this._history.length - 1; i >= 0; i--) {
      const item = this._history[i];
      if (item && item.result === 'failed') {
        count++;
      } else {
        // 성공을 만나거나 항목이 없으면 중단
        break;
      }
    }
    return count;
  }
}

/**
 * 반성 결과 - LLM이 생성한 반성 내용을 담는 값 객체
 */
export class ReflectionResult {
  private constructor(
    private readonly _analysis: string,
    private readonly _suggestion: string,
    private readonly _shouldRetry: boolean,
    private readonly _alternativeAction?: AlternativeAction
  ) {}

  static create(args: ReflectionResultCreateArgs): ReflectionResult {
    return new ReflectionResult(
      args.analysis,
      args.suggestion,
      args.shouldRetry,
      args.alternativeAction
    );
  }

  get analysis(): string {
    return this._analysis;
  }

  get suggestion(): string {
    return this._suggestion;
  }

  get shouldRetry(): boolean {
    return this._shouldRetry;
  }

  get alternativeAction(): AlternativeAction | undefined {
    return this._alternativeAction;
  }

  /**
   * LLM 프롬프트에 추가할 형태로 변환
   */
  toPromptText(): string {
    return `## 이전 시도 분석
${this._analysis}

## 제안
${this._suggestion}`;
  }
}

/**
 * 반성 프롬프트 빌더 - ReflectionContext로부터 LLM 프롬프트를 생성
 */
export class ReflectionPromptBuilder {
  /**
   * 컨텍스트로부터 반성 프롬프트 생성
   */
  static build(context: ReflectionContext): string {
    const consecutiveFailures = context.getConsecutiveFailureCount();
    const recentHistory = context.getRecentHistory(5);

    let prompt = `## 도구 실행 실패 분석 요청

**실패한 도구**: ${context.toolName}
**입력 파라미터**: ${JSON.stringify(context.toolInput, null, 2)}
**에러 메시지**: ${context.error}

`;

    // 연속 실패가 많으면 강조
    if (consecutiveFailures >= 3) {
      prompt += `⚠️ **주의**: 연속 ${consecutiveFailures}회 실패했습니다. 다른 접근 방식을 시도해야 합니다.

`;
    }

    // 히스토리 요약
    if (recentHistory.length > 0) {
      prompt += `## 이전 작업 히스토리 (최근 ${recentHistory.length}개)
`;
      for (const item of recentHistory) {
        const status = item.result === 'success' ? '✅' : '❌';
        prompt += `- Step ${item.step}: ${item.toolName} ${status}\n`;
      }
      prompt += '\n';
    }

    prompt += `## 요청사항
위 실패 원인을 분석하고, 다음 질문에 답해주세요:

1. **실패 원인**: 왜 이 도구 실행이 실패했나요?
2. **대안 전략**: 어떤 다른 방법을 시도할 수 있나요?
3. **재시도 여부**: 같은 도구를 다른 파라미터로 재시도해야 하나요, 아니면 다른 도구를 사용해야 하나요?

JSON 형식으로 응답해주세요:
\`\`\`json
{
  "analysis": "실패 원인 분석",
  "suggestion": "대안 전략 설명",
  "shouldRetry": true/false,
  "alternativeAction": {
    "toolName": "도구명",
    "toolInput": { ... }
  }
}
\`\`\``;

    return prompt;
  }
}
