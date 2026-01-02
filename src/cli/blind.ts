#!/usr/bin/env node
// 블라인드 회사 평점 조회 CLI

import 'dotenv/config';
import { BlindScraper, BlindSearchResult } from '../infra/scraper/blindScraper.js';
import { JsonWriter } from '../infra/output/jsonWriter.js';
import * as fs from 'fs';

interface CliArgs {
  companies: string[];
  fromFile?: string;
  fromCrawlResult?: string;
  enrichJson?: string; // JSON 파일에 평점 추가
  headless: boolean;
  output: string;
  csv: boolean; // CSV 출력 여부
  limit?: number; // 조회할 회사 수 제한
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  const result: CliArgs = {
    companies: [],
    headless: true,
    output: './output',
    csv: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--company' || arg === '-c') {
      const company = args[++i];
      if (company) result.companies.push(company);
    } else if (arg === '--from-file' || arg === '-f') {
      result.fromFile = args[++i];
    } else if (arg === '--from-crawl' || arg === '-r') {
      result.fromCrawlResult = args[++i];
    } else if (arg === '--enrich' || arg === '-e') {
      result.enrichJson = args[++i];
    } else if (arg === '--no-headless') {
      result.headless = false;
    } else if (arg === '--csv') {
      result.csv = true;
    } else if (arg === '--limit' || arg === '-l') {
      const limitValue = parseInt(args[++i], 10);
      if (!isNaN(limitValue) && limitValue > 0) {
        result.limit = limitValue;
      }
    } else if (arg === '--output' || arg === '-o') {
      result.output = args[++i] || './output';
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (!arg?.startsWith('-')) {
      // 위치 인자로 회사명 처리
      result.companies.push(arg);
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
블라인드 회사 평점 조회 CLI

사용법:
  pnpm blind <company> [company2] [options]
  pnpm blind --company <company> [options]
  pnpm blind --from-crawl <crawl_result.json> [options]
  pnpm blind --enrich <crawl_result.json> [options]

옵션:
  -c, --company <name>      조회할 회사명 (복수 가능)
  -f, --from-file <file>    회사 목록 파일 (한 줄에 하나씩)
  -r, --from-crawl <file>   크롤링 결과 JSON에서 회사 추출
  -e, --enrich <file>       크롤링 결과 JSON에 평점 정보 추가
  -o, --output <dir>        출력 디렉토리 (기본: ./output)
  -l, --limit <n>           조회할 회사 수 제한
  --csv                     CSV 파일도 함께 생성
  --no-headless             브라우저 UI 표시
  -h, --help                도움말 표시

예시:
  # 단일 회사 조회
  pnpm blind Google

  # 여러 회사 조회
  pnpm blind Google "Meta" "Amazon"

  # 크롤링 결과에서 회사 추출 후 평점 조회
  pnpm blind --from-crawl ./output/booking.json

  # 크롤링 결과 JSON에 평점 정보 추가 (원본 파일 수정)
  pnpm blind --enrich ./output/booking.json

출력:
  - 콘솔에 평점 정보 출력
  - output/blind_ratings.json에 결과 저장
  - --enrich 사용 시: 원본 JSON에 companyRatings 섹션 추가
`);
}

async function loadCompaniesFromFile(filePath: string): Promise<string[]> {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

async function loadCompaniesFromCrawlResult(filePath: string): Promise<string[]> {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  const data = JSON.parse(content);

  const companies = new Set<string>();

  // 단일 결과 형식
  if (data.company) {
    companies.add(data.company);
  }

  // jobs 배열에서 회사 추출
  if (Array.isArray(data.jobs)) {
    for (const job of data.jobs) {
      if (job.company) {
        companies.add(job.company);
      }
    }
  }

  // 배열 형식 (여러 크롤링 결과)
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item.company) {
        companies.add(item.company);
      }
    }
  }

  return Array.from(companies);
}

function formatRating(result: BlindSearchResult): string {
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

interface CompanyRatingSummary {
  companyName: string;
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
  queriedAt: string;
}

interface EnrichedJson {
  [key: string]: unknown;
  companyRatings: {
    queriedAt: string;
    summary: {
      totalCompanies: number;
      foundCount: number;
      notFoundCount: number;
      averageRating: number | null;
      averageByCategory: {
        workLifeBalance: number | null;
        careerGrowth: number | null;
        compensation: number | null;
        companyCulture: number | null;
        management: number | null;
      };
    };
    companies: CompanyRatingSummary[];
    notFound: string[];
  };
}

async function enrichJsonWithRatings(
  filePath: string,
  headless: boolean,
  exportCsv: boolean = false,
  limit?: number
): Promise<void> {
  console.log(`\n[Enrich] JSON 파일 로드 중: ${filePath}`);

  const content = await fs.promises.readFile(filePath, 'utf-8');
  const data = JSON.parse(content);

  // 회사명 → 검색용 키 변환
  // 1. 괄호 안에 영문명이 있으면 영문명 사용 (예: "루닛(Lunit)" → "Lunit")
  // 2. 괄호 안에 한글이 있으면 괄호 앞 부분 사용 (예: "페이타랩(패스오더)" → "페이타랩")
  // 3. 괄호 없으면 그대로 사용
  const getSearchKey = (companyName: string): string => {
    // 괄호 안 영문명 추출 시도
    const englishMatch = companyName.match(/\(([A-Za-z][A-Za-z0-9\s]*)\)/);
    if (englishMatch) {
      return englishMatch[1].trim();
    }

    // 괄호가 있으면 괄호 앞 부분만 사용
    const parenIndex = companyName.indexOf('(');
    if (parenIndex > 0) {
      return companyName.substring(0, parenIndex).trim();
    }

    return companyName;
  };

  // 회사 목록 추출 (중복 제거)
  const companyMap = new Map<string, string>(); // searchKey → originalName
  if (Array.isArray(data.jobs)) {
    for (const job of data.jobs) {
      const companyName = job.department || job.company;
      if (companyName && typeof companyName === 'string') {
        const searchKey = getSearchKey(companyName);
        if (!companyMap.has(searchKey)) {
          companyMap.set(searchKey, companyName);
        }
      }
    }
  }
  // jobs가 없으면 최상위 company 사용
  if (companyMap.size === 0 && data.company) {
    const searchKey = getSearchKey(data.company);
    companyMap.set(searchKey, data.company);
  }

  let companyList = Array.from(companyMap.keys());
  if (companyList.length === 0) {
    console.error('에러: JSON에서 회사를 찾을 수 없습니다.');
    process.exit(1);
  }

  // limit 적용
  const totalCompanies = companyList.length;
  if (limit && limit < companyList.length) {
    companyList = companyList.slice(0, limit);
    console.log(`[Enrich] ${totalCompanies}개 회사 중 ${limit}개만 조회합니다.`);
  }

  console.log(`[Enrich] ${companyList.length}개 회사 평점 조회 시작...`);

  const scraper = new BlindScraper({ headless });
  const ratingsMap = new Map<string, CompanyRatingSummary>(); // searchKey → rating
  const notFoundCompanies: string[] = [];

  try {
    for (let i = 0; i < companyList.length; i++) {
      const searchKey = companyList[i];
      if (!searchKey) continue;

      console.log(`\n[${i + 1}/${companyList.length}] ${companyMap.get(searchKey)} 조회 중...`);

      const result = await scraper.searchCompanyRating(searchKey);

      if (result.found && result.rating) {
        const r = result.rating;
        ratingsMap.set(searchKey, {
          companyName: r.companyName,
          overallRating: r.overallRating,
          reviewCount: r.reviewCount,
          ratingLevel: r.getRatingLevel(),
          categoryRatings: r.categoryRatings,
          sourceUrl: r.sourceUrl,
          queriedAt: r.crawledAt,
        });
        console.log(`  ✅ ${r.overallRating}/5 (${r.getRatingLevel()})`);
      } else {
        notFoundCompanies.push(companyMap.get(searchKey) || searchKey);
        console.log(`  ❌ ${result.error || '찾을 수 없음'}`);
      }

      // Rate limiting (5초 대기 - 블라인드 봇 감지 우회)
      if (i < companyList.length - 1) {
        console.log(`  ⏳ 다음 요청까지 5초 대기...`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  } finally {
    await scraper.close();
  }

  // 각 job에 blindRating 필드 추가
  if (Array.isArray(data.jobs)) {
    for (const job of data.jobs) {
      const companyName = job.department || job.company;
      if (companyName && typeof companyName === 'string') {
        const searchKey = getSearchKey(companyName);
        const rating = ratingsMap.get(searchKey);
        if (rating) {
          job.blindRating = {
            overallRating: rating.overallRating,
            reviewCount: rating.reviewCount,
            ratingLevel: rating.ratingLevel,
            categoryRatings: rating.categoryRatings,
            sourceUrl: rating.sourceUrl,
          };
        } else {
          job.blindRating = null;
        }
      }
    }
  }

  // 평균 계산
  const calcAverage = (values: number[]): number | null => {
    if (values.length === 0) return null;
    return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
  };

  const foundRatings = Array.from(ratingsMap.values());
  const overallRatings = foundRatings.map((r) => r.overallRating);
  const wlbRatings = foundRatings
    .map((r) => r.categoryRatings?.workLifeBalance)
    .filter((v): v is number => v !== undefined);
  const cgRatings = foundRatings
    .map((r) => r.categoryRatings?.careerGrowth)
    .filter((v): v is number => v !== undefined);
  const compRatings = foundRatings
    .map((r) => r.categoryRatings?.compensation)
    .filter((v): v is number => v !== undefined);
  const cultureRatings = foundRatings
    .map((r) => r.categoryRatings?.companyCulture)
    .filter((v): v is number => v !== undefined);
  const mgmtRatings = foundRatings
    .map((r) => r.categoryRatings?.management)
    .filter((v): v is number => v !== undefined);

  // JSON에 전체 요약도 추가 (맨 끝에)
  const enrichedData: EnrichedJson = {
    ...data,
    companyRatings: {
      queriedAt: new Date().toISOString(),
      summary: {
        totalCompanies: companyList.length,
        foundCount: foundRatings.length,
        notFoundCount: notFoundCompanies.length,
        averageRating: calcAverage(overallRatings),
        averageByCategory: {
          workLifeBalance: calcAverage(wlbRatings),
          careerGrowth: calcAverage(cgRatings),
          compensation: calcAverage(compRatings),
          companyCulture: calcAverage(cultureRatings),
          management: calcAverage(mgmtRatings),
        },
      },
      companies: foundRatings,
      notFound: notFoundCompanies,
    },
  };

  // 파일 저장
  await fs.promises.writeFile(filePath, JSON.stringify(enrichedData, null, 2));

  // CSV 저장
  let csvPath: string | null = null;
  if (exportCsv) {
    csvPath = filePath.replace(/\.json$/, '.csv');
    const csvContent = generateCsv(enrichedData.jobs || []);
    await fs.promises.writeFile(csvPath, csvContent);
  }

  // 요약 출력
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                    평점 추가 완료                            ║
╚════════════════════════════════════════════════════════════╝

조회 성공: ${foundRatings.length}개
조회 실패: ${notFoundCompanies.length}개

📊 평균 평점 요약:
   전체 평균: ${calcAverage(overallRatings) ?? 'N/A'}/5
   ────────────────────────
   워라밸: ${calcAverage(wlbRatings) ?? 'N/A'}/5
   커리어 성장: ${calcAverage(cgRatings) ?? 'N/A'}/5
   보상/복리후생: ${calcAverage(compRatings) ?? 'N/A'}/5
   회사 문화: ${calcAverage(cultureRatings) ?? 'N/A'}/5
   경영진: ${calcAverage(mgmtRatings) ?? 'N/A'}/5

파일 저장됨: ${filePath}${csvPath ? `\nCSV 저장됨: ${csvPath}` : ''}
※ 각 job 항목에 blindRating 필드가 추가되었습니다.
`);

  if (notFoundCompanies.length > 0) {
    console.log('조회 실패 목록:');
    notFoundCompanies.forEach((c) => console.log(`  - ${c}`));
  }
}

function generateCsv(jobs: any[]): string {
  const headers = [
    '제목',
    '회사',
    '부서',
    '위치',
    '마감일',
    '블라인드평점',
    '리뷰수',
    '평점레벨',
    '워라밸',
    '커리어성장',
    '보상복리후생',
    '회사문화',
    '경영진',
    '상세URL',
  ];

  const escapeCell = (value: any): string => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = jobs.map((job) => {
    const br = job.blindRating;
    return [
      escapeCell(job.title),
      escapeCell(job.company),
      escapeCell(job.department),
      escapeCell(job.location),
      escapeCell(job.closingDate),
      br ? escapeCell(br.overallRating) : '',
      br ? escapeCell(br.reviewCount) : '',
      br ? escapeCell(br.ratingLevel) : '',
      br?.categoryRatings?.workLifeBalance ?? '',
      br?.categoryRatings?.careerGrowth ?? '',
      br?.categoryRatings?.compensation ?? '',
      br?.categoryRatings?.companyCulture ?? '',
      br?.categoryRatings?.management ?? '',
      escapeCell(job.sourceUrl),
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs();

  // --enrich 모드
  if (args.enrichJson) {
    await enrichJsonWithRatings(args.enrichJson, args.headless, args.csv, args.limit);
    return;
  }

  // 회사 목록 수집
  let companies: string[] = [...args.companies];

  if (args.fromFile) {
    const fileCompanies = await loadCompaniesFromFile(args.fromFile);
    companies.push(...fileCompanies);
  }

  if (args.fromCrawlResult) {
    const crawlCompanies = await loadCompaniesFromCrawlResult(args.fromCrawlResult);
    companies.push(...crawlCompanies);
  }

  // 중복 제거
  companies = [...new Set(companies)];

  if (companies.length === 0) {
    console.error('에러: 조회할 회사가 없습니다. --help로 사용법을 확인하세요.');
    process.exit(1);
  }

  console.log(`
╔════════════════════════════════════════════════════════════╗
║              블라인드 회사 평점 조회                          ║
╚════════════════════════════════════════════════════════════╝

조회 대상: ${companies.length}개 회사
${companies.map((c) => `  - ${c}`).join('\n')}
`);

  const scraper = new BlindScraper({ headless: args.headless });

  try {
    const startTime = Date.now();
    const results: BlindSearchResult[] = [];

    for (let i = 0; i < companies.length; i++) {
      const company = companies[i];
      if (!company) continue;

      console.log(`\n[${i + 1}/${companies.length}] ${company} 조회 중...`);

      const result = await scraper.searchCompanyRating(company);
      results.push(result);

      console.log(formatRating(result));

      // Rate limiting (5초 대기 - 블라인드 봇 감지 우회)
      if (i < companies.length - 1) {
        console.log(`  ⏳ 다음 요청까지 5초 대기...`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    // 결과 저장
    const outputData = {
      queriedAt: new Date().toISOString(),
      totalCompanies: companies.length,
      found: results.filter((r) => r.found).length,
      notFound: results.filter((r) => !r.found).length,
      results: results.map((r) => ({
        searchedCompany: r.searchedCompany,
        found: r.found,
        error: r.error,
        rating: r.rating?.toJSON(),
      })),
    };

    const outputPath = `${args.output}/blind_ratings.json`;
    await fs.promises.mkdir(args.output, { recursive: true });
    await fs.promises.writeFile(outputPath, JSON.stringify(outputData, null, 2));

    // 요약 출력
    const successCount = results.filter((r) => r.found).length;
    const failCount = results.filter((r) => !r.found).length;

    console.log(`
╔════════════════════════════════════════════════════════════╗
║                       조회 완료                              ║
╚════════════════════════════════════════════════════════════╝

조회 성공: ${successCount}개
조회 실패: ${failCount}개
소요 시간: ${duration}초
결과 파일: ${outputPath}
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

main().catch((error) => {
  console.error('실행 실패:', error);
  process.exit(1);
});
