// JSON 형식 결과 출력
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CrawlResult } from '../../app/services/crawlerOrchestrator.js';

export interface WriteResult {
  filePath: string;
  totalJobs: number;
  newJobs: number;
  duplicatesRemoved: number;
}

export class JsonWriter {
  constructor(private readonly outputDir: string = './output') {}

  async writeWithStats(result: CrawlResult): Promise<WriteResult> {
    // 디렉토리 생성
    await mkdir(this.outputDir, { recursive: true });

    // 파일명 생성 (플랫폼_날짜.json)
    const timestamp = new Date().toISOString().split('T')[0];
    const safePlatform = result.sourcePlatform.replace(/[^a-zA-Z0-9가-힣]/g, '_');
    const fileName = `${safePlatform}_${timestamp}.json`;
    const filePath = join(this.outputDir, fileName);

    // 기존 파일 로드 (있으면)
    let existingJobs: Record<string, unknown>[] = [];
    try {
      const content = await readFile(filePath, 'utf-8');
      const existing = JSON.parse(content);
      existingJobs = existing.jobs || [];
    } catch {
      // 파일이 없으면 빈 배열
    }

    // 새 직무를 JSON으로 변환
    const newJobsJson = result.jobs.map((job) => job.toJSON());

    // 중복 제거 (sourceUrl 기준)
    const existingUrls = new Set(existingJobs.map((j) => j.sourceUrl));
    const uniqueNewJobs = newJobsJson.filter((j) => !existingUrls.has(j.sourceUrl));
    const duplicatesRemoved = newJobsJson.length - uniqueNewJobs.length;

    // 병합
    const mergedJobs = [...existingJobs, ...uniqueNewJobs];

    // 출력 데이터 구성
    const output = {
      sourcePlatform: result.sourcePlatform,
      sourceUrl: result.sourceUrl,
      crawledAt: result.crawledAt,
      totalJobs: mergedJobs.length,
      jobs: mergedJobs,
      errors: result.errors.length > 0 ? result.errors : undefined,
    };

    // 파일 저장
    await writeFile(filePath, JSON.stringify(output, null, 2), 'utf-8');

    return {
      filePath,
      totalJobs: mergedJobs.length,
      newJobs: uniqueNewJobs.length,
      duplicatesRemoved,
    };
  }
}
