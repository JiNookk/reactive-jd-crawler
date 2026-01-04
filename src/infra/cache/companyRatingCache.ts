// 회사 평점 캐시 관리 (CSV 기반)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { CompanyRating, CompanyRatingJSON } from '../../domain/companyRating.domain.js';

const DEFAULT_CACHE_PATH = '.cache/company-ratings.csv';
const BOM = '\uFEFF'; // 엑셀 한글 호환

interface CsvRow {
  company: string;
  rating: string;
  reviewCount: string;
  lastUpdated: string;
  blindUrl: string;
}

export class CompanyRatingCache {
  private cache: Map<string, CompanyRating>;
  private cachePath: string;

  constructor(cachePath: string = DEFAULT_CACHE_PATH) {
    this.cachePath = cachePath;
    this.cache = new Map();
  }

  /**
   * 캐시 로드 (CSV 파일에서)
   * @param merge true이면 기존 메모리 캐시와 병합 (더 최신 데이터 유지)
   */
  async load(merge: boolean = false): Promise<void> {
    if (!existsSync(this.cachePath)) {
      if (!merge) {
        console.log('[CompanyRatingCache] 캐시 파일이 없습니다. 빈 캐시로 시작합니다.');
      }
      return;
    }

    try {
      const content = await readFile(this.cachePath, 'utf-8');
      const rows = this.parseCsv(content);

      let loadedCount = 0;
      let mergedCount = 0;
      for (const row of rows) {
        try {
          const rating = CompanyRating.create({
            companyName: row.company,
            overallRating: row.rating === '' ? null : parseFloat(row.rating),
            reviewCount: row.reviewCount === '' ? null : parseInt(row.reviewCount, 10),
            sourceUrl: row.blindUrl === '' ? null : row.blindUrl,
            crawledAt: new Date(row.lastUpdated),
          });

          const normalizedKey = CompanyRating.normalizeCompanyName(row.company);

          if (merge) {
            // 병합 모드: 기존 데이터가 없거나, 파일 데이터가 더 최신이면 업데이트
            const existing = this.cache.get(normalizedKey);
            if (!existing) {
              this.cache.set(normalizedKey, rating);
              mergedCount++;
            } else {
              // 더 최신 데이터 유지
              const existingDate = new Date(existing.crawledAt);
              const newDate = new Date(rating.crawledAt);
              if (newDate > existingDate) {
                this.cache.set(normalizedKey, rating);
                mergedCount++;
              }
            }
          } else {
            this.cache.set(normalizedKey, rating);
          }
          loadedCount++;
        } catch (error) {
          console.warn(`[CompanyRatingCache] 잘못된 행 스킵: ${row.company}`, error);
        }
      }

      if (merge) {
        if (mergedCount > 0) {
          console.log(`[CompanyRatingCache] 파일에서 ${mergedCount}개 새 항목 병합됨`);
        }
      } else {
        console.log(`[CompanyRatingCache] ${loadedCount}개 회사 평점 캐시 로드 완료`);
      }
    } catch (error) {
      console.error('[CompanyRatingCache] 캐시 로드 실패:', error);
      if (!merge) {
        this.cache.clear();
      }
    }
  }

  /**
   * 캐시 재로드 (파일에서 최신 데이터를 메모리에 병합)
   * 병렬 실행 시 다른 프로세스가 저장한 데이터를 반영
   */
  async reload(): Promise<void> {
    await this.load(true);
  }

  /**
   * 캐시 저장 (CSV 파일로)
   * 저장 전에 파일에서 최신 데이터를 병합하여 race condition 방지
   */
  async save(): Promise<void> {
    try {
      // 저장 전에 파일에서 최신 데이터 병합 (다른 프로세스가 저장한 것 반영)
      await this.reload();

      // 디렉토리 생성
      const dir = dirname(this.cachePath);
      await mkdir(dir, { recursive: true });

      // CSV 생성
      const header = 'company,rating,reviewCount,lastUpdated,blindUrl';
      const rows = Array.from(this.cache.values()).map((rating) => {
        const json = rating.toJSON();
        return [
          this.escapeCsv(json.companyName),
          json.overallRating !== null ? json.overallRating.toString() : '',
          json.reviewCount !== null ? json.reviewCount.toString() : '',
          json.crawledAt,
          json.sourceUrl !== null ? this.escapeCsv(json.sourceUrl) : '',
        ].join(',');
      });

      const csvContent = BOM + [header, ...rows].join('\n');
      await writeFile(this.cachePath, csvContent, 'utf-8');

      console.log(`[CompanyRatingCache] ${this.cache.size}개 회사 평점 캐시 저장 완료`);
    } catch (error) {
      console.error('[CompanyRatingCache] 캐시 저장 실패:', error);
      throw error;
    }
  }

  /**
   * 회사 평점 조회 (정규화된 이름으로 검색)
   */
  get(companyName: string): CompanyRating | null {
    const normalizedKey = CompanyRating.normalizeCompanyName(companyName);
    return this.cache.get(normalizedKey) || null;
  }

  /**
   * 회사 평점 저장/업데이트
   */
  set(companyName: string, rating: CompanyRating): void {
    const normalizedKey = CompanyRating.normalizeCompanyName(companyName);
    this.cache.set(normalizedKey, rating);
  }

  /**
   * 캐시에 회사가 있는지 확인
   */
  has(companyName: string): boolean {
    const normalizedKey = CompanyRating.normalizeCompanyName(companyName);
    return this.cache.has(normalizedKey);
  }

  /**
   * 만료된 캐시 항목 찾기
   */
  getExpiredEntries(daysThreshold: number = 30): CompanyRating[] {
    return Array.from(this.cache.values()).filter((rating) => rating.isExpired(daysThreshold));
  }

  /**
   * 평점 없는 항목 (조회 실패) 찾기
   */
  getNotFoundEntries(): CompanyRating[] {
    return Array.from(this.cache.values()).filter((rating) => !rating.hasRating());
  }

  /**
   * 전체 캐시 통계
   */
  getStats() {
    const total = this.cache.size;
    const withRating = Array.from(this.cache.values()).filter((r) => r.hasRating()).length;
    const notFound = total - withRating;
    const expired = this.getExpiredEntries().length;

    return {
      total,
      withRating,
      notFound,
      expired,
    };
  }

  /**
   * 캐시 초기화
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * CSV 파싱
   */
  private parseCsv(content: string): CsvRow[] {
    const cleanContent = content.replace(/^\uFEFF/, ''); // BOM 제거
    const lines = cleanContent.split('\n').filter((line) => line.trim());

    if (lines.length < 2) {
      return [];
    }

    const rows: CsvRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCsvLine(lines[i] || '');
      if (values.length >= 5) {
        rows.push({
          company: values[0] || '',
          rating: values[1] || '',
          reviewCount: values[2] || '',
          lastUpdated: values[3] || '',
          blindUrl: values[4] || '',
        });
      }
    }

    return rows;
  }

  /**
   * CSV 라인 파싱 (따옴표 처리)
   */
  private parseCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (inQuotes) {
        if (char === '"' && nextChar === '"') {
          current += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          current += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ',') {
          values.push(current);
          current = '';
        } else {
          current += char;
        }
      }
    }

    values.push(current);
    return values;
  }

  /**
   * CSV 값 이스케이프
   */
  private escapeCsv(value: string): string {
    if (value.includes(',') || value.includes('\n') || value.includes('\r') || value.includes('"')) {
      const escaped = value.replace(/"/g, '""');
      return `"${escaped}"`;
    }
    return value;
  }
}
