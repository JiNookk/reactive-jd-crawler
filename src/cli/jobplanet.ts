#!/usr/bin/env node
// 잡플래닛 회사 평점 조회 CLI (CSV 전용)

import 'dotenv/config';
import { JobplanetScraper, JobplanetSearchResult } from '../infra/scraper/jobplanetScraper.js';
import * as fs from 'fs';

interface CliArgs {
  csvFile?: string;
  companies: string[];
  headless: boolean;
  limit?: number;
}

interface CsvRow {
  [key: string]: string;
}

interface JobplanetRating {
  overallRating: number;
  reviewCount: number;
  ratingLevel: string;
  categoryRatings?: {
    workLifeBalance?: number;
    careerGrowth?: number;
    compensation?: number;
    companyCulture?: number;
    management?: number;
  };
  sourceUrl: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  const result: CliArgs = {
    companies: [],
    headless: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--csv' || arg === '-c') {
      result.csvFile = args[++i];
    } else if (arg === '--no-headless') {
      result.headless = false;
    } else if (arg === '--limit' || arg === '-l') {
      const limitValue = parseInt(args[++i] ?? '', 10);
      if (!isNaN(limitValue) && limitValue > 0) {
        result.limit = limitValue;
      }
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg && !arg.startsWith('-')) {
      // 위치 인자로 CSV 파일 또는 회사명 처리
      if (arg.endsWith('.csv')) {
        result.csvFile = arg;
      } else {
        result.companies.push(arg);
      }
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
잡플래닛 회사 평점 조회 CLI (CSV 전용)

사용법:
  pnpm jobplanet <file.csv> [options]
  pnpm jobplanet <company> [company2] [options]

옵션:
  -c, --csv <file>        CSV 파일 경로
  -l, --limit <n>         조회할 회사 수 제한
  --no-headless           브라우저 UI 표시
  -h, --help              도움말 표시

예시:
  # CSV 파일의 회사들 평점 조회 (CSV 업데이트)
  pnpm jobplanet ./output/원티드-서버개발-2026-01-03.csv

  # 특정 회사 평점 조회 (콘솔 출력만)
  pnpm jobplanet Google "네이버"

  # 조회 수 제한
  pnpm jobplanet ./output/jobs.csv --limit 10

출력:
  - CSV 모드: 원본 CSV에 잡플래닛 평점 컬럼 추가
    (잡플래닛평점, 잡플래닛리뷰수, 잡플래닛평점레벨 등)
  - 회사명 모드: 콘솔에 평점 정보 출력
`);
}

// CSV 파싱 (간단 버전)
function parseCsv(content: string): CsvRow[] {
  const lines = content.split('\n');
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0] || '');
  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line?.trim()) continue;

    const values = parseCsvLine(line);
    const row: CsvRow = {};

    for (let j = 0; j < headers.length; j++) {
      row[headers[j] || `col${j}`] = values[j] || '';
    }

    rows.push(row);
  }

  return rows;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
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

function escapeCell(value: any): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function generateCsv(rows: CsvRow[]): string {
  if (rows.length === 0) return '';

  // 헤더 순서 유지 + 잡플래닛 컬럼 추가
  const firstRow = rows[0];
  if (!firstRow) return '';

  const originalHeaders = Object.keys(firstRow);

  // 잡플래닛 컬럼들 (없으면 추가)
  const jobplanetHeaders = [
    '잡플래닛평점',
    '잡플래닛리뷰수',
    '잡플래닛평점레벨',
    '잡플래닛워라밸',
    '잡플래닛커리어성장',
    '잡플래닛보상복리후생',
    '잡플래닛회사문화',
    '잡플래닛경영진',
    '잡플래닛URL',
  ];

  const headers = [...originalHeaders];
  for (const header of jobplanetHeaders) {
    if (!headers.includes(header)) {
      headers.push(header);
    }
  }

  const headerLine = headers.map(escapeCell).join(',');

  const dataLines = rows.map((row) => {
    return headers.map((header) => escapeCell(row[header])).join(',');
  });

  return [headerLine, ...dataLines].join('\n');
}

// 회사명 → 검색용 키 변환
function getSearchKey(companyName: string): string {
  return companyName
    .replace(/\([^)]*\)/g, '')
    .replace(/주식회사|유한회사|유한책임회사/g, '')
    .replace(/\b(Inc\.?|Corp\.?|Co\.?,?\s*Ltd\.?|Ltd\.?|LLC)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function processCsvFile(
  csvPath: string,
  headless: boolean,
  limit?: number
): Promise<void> {
  console.log(`\n[Jobplanet] CSV 파일 로드 중: ${csvPath}`);

  const content = await fs.promises.readFile(csvPath, 'utf-8');
  const rows = parseCsv(content);

  if (rows.length === 0) {
    console.error('에러: CSV 파일이 비어있거나 파싱할 수 없습니다.');
    process.exit(1);
  }

  console.log(`[Jobplanet] ${rows.length}개 행 로드 완료`);

  // 회사 목록 추출 (중복 제거)
  const companyMap = new Map<string, string>(); // searchKey → originalName
  const rowIndices = new Map<string, number[]>(); // searchKey → row indices

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const companyName = row['부서'] || row['회사'] || row['company'] || row['department'];
    if (companyName && typeof companyName === 'string') {
      const searchKey = getSearchKey(companyName);
      if (!companyMap.has(searchKey)) {
        companyMap.set(searchKey, companyName);
        rowIndices.set(searchKey, []);
      }
      rowIndices.get(searchKey)!.push(i);
    }
  }

  // 이미 조회된 회사들 (메모리 캐시)
  const ratingsMap = new Map<string, JobplanetRating>();
  const notFoundSet = new Set<string>();
  const alreadyProcessed = new Set<string>();

  // 기존 CSV에서 잡플래닛 평점이 있는 회사들 복원
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const companyName = row['부서'] || row['회사'] || row['company'] || row['department'];
    if (!companyName) continue;

    const searchKey = getSearchKey(companyName);
    const existingRating = row['잡플래닛평점'];

    if (existingRating && existingRating.trim() !== '') {
      alreadyProcessed.add(searchKey);

      // 기존 데이터 복원
      if (!ratingsMap.has(searchKey)) {
        const rating = parseFloat(existingRating);
        if (!isNaN(rating)) {
          ratingsMap.set(searchKey, {
            overallRating: rating,
            reviewCount: parseInt(row['잡플래닛리뷰수'] || '0', 10),
            ratingLevel: row['잡플래닛평점레벨'] || '',
            categoryRatings: {
              workLifeBalance: parseFloat(row['잡플래닛워라밸'] || '') || undefined,
              careerGrowth: parseFloat(row['잡플래닛커리어성장'] || '') || undefined,
              compensation: parseFloat(row['잡플래닛보상복리후생'] || '') || undefined,
              companyCulture: parseFloat(row['잡플래닛회사문화'] || '') || undefined,
              management: parseFloat(row['잡플래닛경영진'] || '') || undefined,
            },
            sourceUrl: row['잡플래닛URL'] || '',
          });
        }
      }
    }
  }

  // 아직 조회 안 된 회사만 필터링
  const companyList = Array.from(companyMap.keys());
  let pendingCompanies = companyList.filter((key) => !alreadyProcessed.has(key));
  const skippedCount = companyList.length - pendingCompanies.length;

  if (skippedCount > 0) {
    console.log(`[Jobplanet] ⏭️  이미 조회된 ${skippedCount}개 회사 건너뜀`);
  }

  // limit 적용
  if (limit && limit < pendingCompanies.length) {
    pendingCompanies = pendingCompanies.slice(0, limit);
    console.log(`[Jobplanet] 남은 회사 중 ${limit}개만 조회합니다.`);
  }

  if (pendingCompanies.length === 0) {
    console.log(`[Jobplanet] ✅ 모든 회사가 이미 조회되었습니다.`);
    return;
  }

  console.log(`[Jobplanet] ${pendingCompanies.length}개 회사 평점 조회 시작...`);
  console.log(`[Jobplanet] 📁 스트리밍 저장 활성화 - 각 회사 조회 후 즉시 저장`);

  const scraper = new JobplanetScraper({ headless });

  try {
    for (let i = 0; i < pendingCompanies.length; i++) {
      const searchKey = pendingCompanies[i];
      if (!searchKey) continue;

      // 메모리 캐시 확인
      if (ratingsMap.has(searchKey) || notFoundSet.has(searchKey)) {
        console.log(`\n[${i + 1}/${pendingCompanies.length}] ${companyMap.get(searchKey)} - 캐시 사용 (건너뜀)`);
        continue;
      }

      console.log(`\n[${i + 1}/${pendingCompanies.length}] ${companyMap.get(searchKey)} 조회 중...`);

      const result = await scraper.searchCompanyRating(searchKey);

      if (result.found && result.rating) {
        const r = result.rating;
        const rating: JobplanetRating = {
          overallRating: r.overallRating,
          reviewCount: r.reviewCount,
          ratingLevel: r.getRatingLevel(),
          categoryRatings: r.categoryRatings,
          sourceUrl: r.sourceUrl,
        };
        ratingsMap.set(searchKey, rating);
        console.log(`  ✅ ${r.overallRating}/5 (${r.getRatingLevel()})`);
      } else {
        notFoundSet.add(searchKey);
        console.log(`  ❌ ${result.error || '찾을 수 없음'}`);
      }

      // CSV 업데이트 및 저장
      updateRowsWithRatings(rows, rowIndices, ratingsMap, notFoundSet);
      const csvContent = generateCsv(rows);
      await fs.promises.writeFile(csvPath, csvContent);
      console.log(`  💾 CSV 저장 완료 (${ratingsMap.size}/${companyList.length})`);

      // Rate limiting
      if (i < pendingCompanies.length - 1) {
        console.log(`  ⏳ 다음 요청까지 2초 대기...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  } finally {
    await scraper.close();
  }

  // 요약 출력
  const foundCount = ratingsMap.size;
  const notFoundCount = notFoundSet.size;

  console.log(`
╔════════════════════════════════════════════════════════════╗
║                    잡플래닛 평점 조회 완료                    ║
╚════════════════════════════════════════════════════════════╝

조회 성공: ${foundCount}개
조회 실패: ${notFoundCount}개

CSV 파일 저장됨: ${csvPath}
`);

  if (notFoundCount > 0) {
    console.log('조회 실패 목록:');
    Array.from(notFoundSet).forEach((key) => {
      console.log(`  - ${companyMap.get(key) || key}`);
    });
  }
}

function updateRowsWithRatings(
  rows: CsvRow[],
  rowIndices: Map<string, number[]>,
  ratingsMap: Map<string, JobplanetRating>,
  notFoundSet: Set<string>
): void {
  for (const [searchKey, indices] of rowIndices) {
    const rating = ratingsMap.get(searchKey);

    for (const idx of indices) {
      const row = rows[idx];
      if (!row) continue;

      if (rating) {
        row['잡플래닛평점'] = String(rating.overallRating);
        row['잡플래닛리뷰수'] = String(rating.reviewCount);
        row['잡플래닛평점레벨'] = rating.ratingLevel;
        row['잡플래닛워라밸'] = rating.categoryRatings?.workLifeBalance?.toString() || '';
        row['잡플래닛커리어성장'] = rating.categoryRatings?.careerGrowth?.toString() || '';
        row['잡플래닛보상복리후생'] = rating.categoryRatings?.compensation?.toString() || '';
        row['잡플래닛회사문화'] = rating.categoryRatings?.companyCulture?.toString() || '';
        row['잡플래닛경영진'] = rating.categoryRatings?.management?.toString() || '';
        row['잡플래닛URL'] = rating.sourceUrl;
      } else if (notFoundSet.has(searchKey)) {
        row['잡플래닛평점'] = 'N/A';
        row['잡플래닛리뷰수'] = '';
        row['잡플래닛평점레벨'] = '';
        row['잡플래닛워라밸'] = '';
        row['잡플래닛커리어성장'] = '';
        row['잡플래닛보상복리후생'] = '';
        row['잡플래닛회사문화'] = '';
        row['잡플래닛경영진'] = '';
        row['잡플래닛URL'] = '';
      }
    }
  }
}

function formatRating(result: JobplanetSearchResult): string {
  if (!result.found || !result.rating) {
    return `❌ ${result.searchedCompany}: ${result.error || '찾을 수 없음'}`;
  }

  const r = result.rating;
  const level = r.getRatingLevel();
  const levelEmoji = level === '좋음' ? '🟢' : level === '보통' ? '🟡' : '🔴';

  let output = `
${levelEmoji} ${r.companyName}
   전체 평점: ${r.overallRating}/5 (${level})
   리뷰 수: ${r.reviewCount.toLocaleString()}개`;

  if (r.categoryRatings) {
    const cats = r.categoryRatings;
    output += `
   ────────────────────────`;
    if (cats.workLifeBalance !== undefined) {
      output += `\n   워라밸: ${cats.workLifeBalance}/5`;
    }
    if (cats.careerGrowth !== undefined) {
      output += `\n   커리어 성장: ${cats.careerGrowth}/5`;
    }
    if (cats.compensation !== undefined) {
      output += `\n   보상/복리후생: ${cats.compensation}/5`;
    }
    if (cats.companyCulture !== undefined) {
      output += `\n   회사 문화: ${cats.companyCulture}/5`;
    }
    if (cats.management !== undefined) {
      output += `\n   경영진: ${cats.management}/5`;
    }
  }

  return output;
}

async function processCompanyNames(
  companies: string[],
  headless: boolean
): Promise<void> {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║              잡플래닛 회사 평점 조회                          ║
╚════════════════════════════════════════════════════════════╝

조회 대상: ${companies.length}개 회사
${companies.map((c) => `  - ${c}`).join('\n')}
`);

  const scraper = new JobplanetScraper({ headless });

  try {
    const startTime = Date.now();
    const results: JobplanetSearchResult[] = [];

    for (let i = 0; i < companies.length; i++) {
      const company = companies[i];
      if (!company) continue;

      console.log(`\n[${i + 1}/${companies.length}] ${company} 조회 중...`);

      const result = await scraper.searchCompanyRating(company);
      results.push(result);

      console.log(formatRating(result));

      // Rate limiting
      if (i < companies.length - 1) {
        console.log(`  ⏳ 다음 요청까지 2초 대기...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    const successCount = results.filter((r) => r.found).length;
    const failCount = results.filter((r) => !r.found).length;

    console.log(`
╔════════════════════════════════════════════════════════════╗
║                       조회 완료                              ║
╚════════════════════════════════════════════════════════════╝

조회 성공: ${successCount}개
조회 실패: ${failCount}개
소요 시간: ${duration}초
`);

    if (failCount > 0) {
      console.log('조회 실패 목록:');
      results
        .filter((r) => !r.found)
        .forEach((r) => console.log(`  - ${r.searchedCompany}: ${r.error}`));
    }
  } finally {
    await scraper.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs();

  // CSV 파일 모드
  if (args.csvFile) {
    await processCsvFile(args.csvFile, args.headless, args.limit);
    return;
  }

  // 회사명 직접 조회 모드
  if (args.companies.length > 0) {
    await processCompanyNames(args.companies, args.headless);
    return;
  }

  // 인자 없음
  console.error('에러: CSV 파일 또는 회사명을 지정하세요. --help로 사용법을 확인하세요.');
  process.exit(1);
}

main().catch((error) => {
  console.error('실행 실패:', error);
  process.exit(1);
});
