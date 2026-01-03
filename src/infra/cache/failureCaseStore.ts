// 실패 케이스 저장소 - JSONL 파일 기반
import * as fs from 'fs';
import * as path from 'path';
import { FailureCase } from '../../domain/failureCase.domain.js';

const DEFAULT_FAILURE_CASES_FILE = '.cache/failure_cases.jsonl';

export interface FailureCaseStats {
  total: number;
  resolved: number;
  unresolved: number;
  resolutionRate: number;
  byTool: Record<string, number>;
  byCompany: Record<string, number>;
}

export class FailureCaseStore {
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? DEFAULT_FAILURE_CASES_FILE;
  }

  /**
   * 실패 케이스 추가 (JSONL에 한 줄 append)
   */
  async append(failureCase: FailureCase): Promise<void> {
    // 디렉토리 생성
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // JSONL 형식으로 한 줄 추가
    const line = JSON.stringify(failureCase.toJSON()) + '\n';
    await fs.promises.appendFile(this.filePath, line, 'utf-8');
  }

  /**
   * 모든 실패 케이스 로드
   */
  async loadAll(): Promise<FailureCase[]> {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }

    const content = await fs.promises.readFile(this.filePath, 'utf-8');
    const lines = content.trim().split('\n').filter((line) => line.length > 0);

    return lines.map((line) => {
      const json = JSON.parse(line);
      return FailureCase.fromJSON(json);
    });
  }

  /**
   * 회사별 실패 케이스 로드
   */
  async loadByCompany(company: string): Promise<FailureCase[]> {
    const all = await this.loadAll();
    return all.filter((fc) => fc.company === company);
  }

  /**
   * 도구별 실패 케이스 로드
   */
  async loadByTool(toolName: string): Promise<FailureCase[]> {
    const all = await this.loadAll();
    return all.filter((fc) => fc.toolName === toolName);
  }

  /**
   * 미해결 실패 케이스만 로드
   */
  async loadUnresolved(): Promise<FailureCase[]> {
    const all = await this.loadAll();
    return all.filter((fc) => fc.resolution === undefined);
  }

  /**
   * 실패 케이스 통계 조회
   */
  async getStats(): Promise<FailureCaseStats> {
    const cases = await this.loadAll();

    const resolved = cases.filter((fc) => fc.resolution !== undefined).length;
    const unresolved = cases.length - resolved;

    const byTool: Record<string, number> = {};
    const byCompany: Record<string, number> = {};

    for (const fc of cases) {
      byTool[fc.toolName] = (byTool[fc.toolName] || 0) + 1;
      byCompany[fc.company] = (byCompany[fc.company] || 0) + 1;
    }

    return {
      total: cases.length,
      resolved,
      unresolved,
      resolutionRate: cases.length > 0 ? resolved / cases.length : 0,
      byTool,
      byCompany,
    };
  }

  /**
   * 최근 N개 실패 케이스 로드
   */
  async loadRecent(limit: number): Promise<FailureCase[]> {
    const all = await this.loadAll();
    return all.slice(-limit);
  }

  /**
   * 실패 케이스를 Few-shot 예시 목록으로 변환
   */
  async toFewShotExamples(limit?: number): Promise<string> {
    const cases = await this.loadAll();

    // 해결된 케이스 우선, 최근 순
    const sorted = cases
      .filter((fc) => fc.resolution !== undefined)
      .slice(-(limit || 5));

    if (sorted.length === 0) {
      return '# 아직 수집된 실패 사례가 없습니다.';
    }

    const examples = sorted.map((fc) => fc.toFewShot()).join('\n\n');
    return `# 이전 실패 사례 및 해결 방법\n\n${examples}`;
  }

  /**
   * 파일 존재 여부 확인
   */
  exists(): boolean {
    return fs.existsSync(this.filePath);
  }

  /**
   * 파일 경로 반환
   */
  getFilePath(): string {
    return this.filePath;
  }

  /**
   * 파일 삭제 (테스트용)
   */
  async clear(): Promise<void> {
    if (fs.existsSync(this.filePath)) {
      await fs.promises.unlink(this.filePath);
    }
  }
}
