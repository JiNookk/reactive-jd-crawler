// CSV 형식 결과 출력
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CrawlResult } from '../../app/services/crawlerOrchestrator.js';

export interface WriteResult {
  filePath: string;
  totalJobs: number;
  newJobs: number;
  duplicatesRemoved: number;
}

export class CsvWriter {
  constructor(private readonly outputDir: string = './output') {}

  async writeWithStats(result: CrawlResult): Promise<WriteResult> {
    // 디렉토리 생성
    await mkdir(this.outputDir, { recursive: true });

    // 파일명 생성 (플랫폼_날짜.csv)
    const timestamp = new Date().toISOString().split('T')[0];
    const safePlatform = result.sourcePlatform.replace(/[^a-zA-Z0-9가-힣]/g, '_');
    const fileName = `${safePlatform}_${timestamp}.csv`;
    const filePath = join(this.outputDir, fileName);

    // 기존 파일 로드 (있으면)
    let existingRows: string[] = [];
    let existingUrls = new Set<string>();
    try {
      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());
      if (lines.length > 1) {
        existingRows = lines.slice(1); // 헤더 제외
        // URL 컬럼 추출 (sourceUrl은 보통 4번째 컬럼)
        existingUrls = new Set(
          existingRows.map((row) => {
            const cols = this.parseCSVRow(row);
            return cols[3] || ''; // sourceUrl 위치
          })
        );
      }
    } catch {
      // 파일이 없으면 빈 배열
    }

    // CSV 헤더
    const headers = [
      'id',
      'title',
      'company',
      'sourceUrl',
      'sourcePlatform',
      'location',
      'department',
      'salary',
      'crawledAt',
    ];

    // 새 직무를 CSV 행으로 변환
    const newRows: string[] = [];
    let duplicatesRemoved = 0;

    for (const job of result.jobs) {
      const json = job.toJSON();
      if (existingUrls.has(json.sourceUrl)) {
        duplicatesRemoved++;
        continue;
      }

      const row = [
        this.escapeCSV(json.id),
        this.escapeCSV(json.title),
        this.escapeCSV(json.company),
        this.escapeCSV(json.sourceUrl),
        this.escapeCSV(json.sourcePlatform),
        this.escapeCSV(json.location || ''),
        this.escapeCSV(json.department || ''),
        this.escapeCSV(json.salary || ''),
        this.escapeCSV(json.crawledAt),
      ].join(',');

      newRows.push(row);
    }

    // 병합
    const allRows = [...existingRows, ...newRows];

    // CSV 파일 생성
    const csvContent = [headers.join(','), ...allRows].join('\n');
    await writeFile(filePath, csvContent, 'utf-8');

    return {
      filePath,
      totalJobs: allRows.length,
      newJobs: newRows.length,
      duplicatesRemoved,
    };
  }

  private escapeCSV(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  private parseCSVRow(row: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < row.length; i++) {
      const char = row[i];

      if (char === '"') {
        if (inQuotes && row[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current);
    return result;
  }
}
