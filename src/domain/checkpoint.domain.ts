// 세션 체크포인트 도메인 모델
// 크롤링 세션의 진행 상태를 저장하고 복원하기 위한 도메인 객체

export type CheckpointStatus = 'in_progress' | 'completed' | 'failed' | 'suspended';

// 수집된 직무 정보 (간소화된 형태)
interface ExtractedJobData {
  title: string;
  location?: string;
  department?: string;
  detailUrl?: string;
}

// 히스토리 항목
interface HistoryItem {
  step: number;
  toolName: string;
  toolInput: unknown;
  result: string;
  thought?: string;
  observation?: string;
}

// AgentCheckpoint 생성 인자
interface AgentCheckpointCreateArgs {
  sessionId: string;
  url: string;
  company: string;
  createdAt: Date;
  extractedJobs?: ExtractedJobData[];
  history?: HistoryItem[];
}

// JSON 직렬화 형태
interface AgentCheckpointJSON {
  sessionId: string;
  url: string;
  company: string;
  status: CheckpointStatus;
  createdAt: string;
  updatedAt?: string;
  extractedJobs: ExtractedJobData[];
  history: HistoryItem[];
  failureReason?: string;
  resumeHint?: string;
}

/**
 * 에이전트 체크포인트 - 크롤링 세션의 상태를 저장
 */
export class AgentCheckpoint {
  private constructor(
    private readonly _sessionId: string,
    private readonly _url: string,
    private readonly _company: string,
    private readonly _status: CheckpointStatus,
    private readonly _createdAt: string,
    private readonly _updatedAt: string | undefined,
    private readonly _extractedJobs: ExtractedJobData[],
    private readonly _history: HistoryItem[],
    private readonly _failureReason?: string,
    private readonly _resumeHint?: string
  ) {}

  static create(args: AgentCheckpointCreateArgs): AgentCheckpoint {
    return new AgentCheckpoint(
      args.sessionId,
      args.url,
      args.company,
      'in_progress',
      args.createdAt.toISOString(),
      undefined,
      args.extractedJobs ?? [],
      args.history ?? [],
      undefined,
      undefined
    );
  }

  static fromJSON(json: AgentCheckpointJSON): AgentCheckpoint {
    return new AgentCheckpoint(
      json.sessionId,
      json.url,
      json.company,
      json.status,
      json.createdAt,
      json.updatedAt,
      json.extractedJobs,
      json.history,
      json.failureReason,
      json.resumeHint
    );
  }

  // Getters
  get sessionId(): string {
    return this._sessionId;
  }

  get url(): string {
    return this._url;
  }

  get company(): string {
    return this._company;
  }

  get status(): CheckpointStatus {
    return this._status;
  }

  get createdAt(): string {
    return this._createdAt;
  }

  get updatedAt(): string | undefined {
    return this._updatedAt;
  }

  get extractedJobs(): ExtractedJobData[] {
    return [...this._extractedJobs];
  }

  get history(): HistoryItem[] {
    return [...this._history];
  }

  get failureReason(): string | undefined {
    return this._failureReason;
  }

  get resumeHint(): string | undefined {
    return this._resumeHint;
  }

  // 상태 변경 메서드들 (불변성 유지)

  /**
   * 완료 상태로 변경
   */
  complete(now: Date): AgentCheckpoint {
    return new AgentCheckpoint(
      this._sessionId,
      this._url,
      this._company,
      'completed',
      this._createdAt,
      now.toISOString(),
      this._extractedJobs,
      this._history,
      undefined,
      undefined
    );
  }

  /**
   * 실패 상태로 변경
   */
  fail(reason: string, now: Date): AgentCheckpoint {
    return new AgentCheckpoint(
      this._sessionId,
      this._url,
      this._company,
      'failed',
      this._createdAt,
      now.toISOString(),
      this._extractedJobs,
      this._history,
      reason,
      undefined
    );
  }

  /**
   * 중단 상태로 변경 (재개 가능)
   */
  suspend(resumeHint: string, now: Date): AgentCheckpoint {
    return new AgentCheckpoint(
      this._sessionId,
      this._url,
      this._company,
      'suspended',
      this._createdAt,
      now.toISOString(),
      this._extractedJobs,
      this._history,
      undefined,
      resumeHint
    );
  }

  /**
   * 히스토리 항목 추가
   */
  addHistoryItem(item: HistoryItem): AgentCheckpoint {
    return new AgentCheckpoint(
      this._sessionId,
      this._url,
      this._company,
      this._status,
      this._createdAt,
      this._updatedAt,
      this._extractedJobs,
      [...this._history, item],
      this._failureReason,
      this._resumeHint
    );
  }

  /**
   * 수집된 직무 추가 (중복 제거)
   */
  addExtractedJobs(jobs: ExtractedJobData[]): AgentCheckpoint {
    const existingKeys = new Set(
      this._extractedJobs.map((job) => this.generateJobKey(job))
    );

    const newJobs = jobs.filter(
      (job) => !existingKeys.has(this.generateJobKey(job))
    );

    return new AgentCheckpoint(
      this._sessionId,
      this._url,
      this._company,
      this._status,
      this._createdAt,
      this._updatedAt,
      [...this._extractedJobs, ...newJobs],
      this._history,
      this._failureReason,
      this._resumeHint
    );
  }

  private generateJobKey(job: ExtractedJobData): string {
    return `${job.title.toLowerCase()}:${(job.location || '').toLowerCase()}`;
  }

  /**
   * 재개 가능 여부 확인
   */
  canResume(): boolean {
    return this._status === 'suspended' || this._status === 'failed';
  }

  /**
   * 진행 상황 요약 생성
   */
  generateSummary(): string {
    const successSteps = this._history.filter((h) => h.result === 'success').length;
    const failedSteps = this._history.filter((h) => h.result === 'failed').length;
    const totalSteps = this._history.length;

    let summary = `## 크롤링 세션 요약

**회사**: ${this._company}
**URL**: ${this._url}
**상태**: ${this.getStatusText()}

### 진행 상황
- 수집된 직무: ${this._extractedJobs.length}개
- 실행된 스텝: ${totalSteps}개 (성공: ${successSteps}, 실패: ${failedSteps})
`;

    if (this._failureReason) {
      summary += `\n### 실패 원인\n${this._failureReason}\n`;
    }

    if (this._resumeHint) {
      summary += `\n### 재개 힌트\n${this._resumeHint}\n`;
    }

    if (this._history.length > 0) {
      summary += `\n### 마지막 액션\n`;
      const lastAction = this._history[this._history.length - 1];
      if (lastAction) {
        summary += `- 도구: ${lastAction.toolName}\n`;
        summary += `- 결과: ${lastAction.result}\n`;
      }
    }

    return summary;
  }

  private getStatusText(): string {
    switch (this._status) {
      case 'in_progress':
        return '진행 중';
      case 'completed':
        return '완료';
      case 'failed':
        return '실패';
      case 'suspended':
        return '중단됨 (재개 가능)';
    }
  }

  /**
   * JSON 직렬화
   */
  toJSON(): AgentCheckpointJSON {
    const json: AgentCheckpointJSON = {
      sessionId: this._sessionId,
      url: this._url,
      company: this._company,
      status: this._status,
      createdAt: this._createdAt,
      extractedJobs: this._extractedJobs,
      history: this._history,
    };

    if (this._updatedAt) {
      json.updatedAt = this._updatedAt;
    }

    if (this._failureReason) {
      json.failureReason = this._failureReason;
    }

    if (this._resumeHint) {
      json.resumeHint = this._resumeHint;
    }

    return json;
  }
}
