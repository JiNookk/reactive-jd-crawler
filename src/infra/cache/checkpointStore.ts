// 체크포인트 저장소 - 파일 시스템 기반
import * as fs from 'fs';
import * as path from 'path';
import { AgentCheckpoint } from '../../domain/checkpoint.domain.js';

const DEFAULT_CHECKPOINT_DIR = '.cache/checkpoints';

export class CheckpointStore {
  private readonly checkpointDir: string;

  constructor(checkpointDir?: string) {
    this.checkpointDir = checkpointDir ?? DEFAULT_CHECKPOINT_DIR;
  }

  /**
   * 체크포인트 저장
   */
  async save(checkpoint: AgentCheckpoint): Promise<string> {
    // 디렉토리 생성
    if (!fs.existsSync(this.checkpointDir)) {
      fs.mkdirSync(this.checkpointDir, { recursive: true });
    }

    // 파일 경로 생성 (회사명_세션ID.json)
    const sanitizedCompany = this.sanitizeFilename(checkpoint.company);
    const filename = `${sanitizedCompany}_${checkpoint.sessionId}.json`;
    const filePath = path.join(this.checkpointDir, filename);

    // JSON 저장
    await fs.promises.writeFile(
      filePath,
      JSON.stringify(checkpoint.toJSON(), null, 2),
      'utf-8'
    );

    return filePath;
  }

  /**
   * 체크포인트 로드
   */
  async load(filePath: string): Promise<AgentCheckpoint | null> {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const content = await fs.promises.readFile(filePath, 'utf-8');
      const json = JSON.parse(content);
      return AgentCheckpoint.fromJSON(json);
    } catch (error) {
      console.error(`체크포인트 로드 실패: ${error}`);
      return null;
    }
  }

  /**
   * 회사명으로 최신 체크포인트 찾기
   */
  async findLatestByCompany(company: string): Promise<AgentCheckpoint | null> {
    if (!fs.existsSync(this.checkpointDir)) {
      return null;
    }

    const sanitizedCompany = this.sanitizeFilename(company);
    const files = fs.readdirSync(this.checkpointDir);

    // 해당 회사의 체크포인트 파일들 필터링
    const companyFiles = files
      .filter((f) => f.startsWith(sanitizedCompany + '_') && f.endsWith('.json'))
      .map((f) => ({
        filename: f,
        fullPath: path.join(this.checkpointDir, f),
        mtime: fs.statSync(path.join(this.checkpointDir, f)).mtime,
      }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    if (companyFiles.length === 0) {
      return null;
    }

    // 가장 최신 파일 로드
    return this.load(companyFiles[0]!.fullPath);
  }

  /**
   * 재개 가능한 체크포인트 목록 조회
   */
  async listResumable(): Promise<Array<{ company: string; path: string; status: string; jobCount: number }>> {
    if (!fs.existsSync(this.checkpointDir)) {
      return [];
    }

    const files = fs.readdirSync(this.checkpointDir);
    const results: Array<{ company: string; path: string; status: string; jobCount: number }> = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const fullPath = path.join(this.checkpointDir, file);
      const checkpoint = await this.load(fullPath);

      if (checkpoint && checkpoint.canResume()) {
        results.push({
          company: checkpoint.company,
          path: fullPath,
          status: checkpoint.status,
          jobCount: checkpoint.extractedJobs.length,
        });
      }
    }

    return results;
  }

  /**
   * 체크포인트 삭제
   */
  async delete(filePath: string): Promise<boolean> {
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private sanitizeFilename(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }
}
