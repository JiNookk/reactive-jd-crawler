#!/usr/bin/env node
// 블라인드 회사 평점 조회 CLI

import 'dotenv/config';
import { BlindScraper, BlindSearchResult } from '../infra/scraper/blindScraper.js';
import { CompanyRatingCache } from '../infra/cache/companyRatingCache.js';
import { CompanyRating } from '../domain/companyRating.domain.js';
import * as fs from 'fs';

interface CliArgs {
  companies: string[];
  fromFile?: string;
  fromCrawlResult?: string;
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
    } else if (arg === '--no-headless') {
      result.headless = false;
    } else if (arg === '--csv') {
      result.csv = true;
    } else if (arg === '--limit' || arg === '-l') {
      const limitValue = parseInt(args[++i] ?? '', 10);
      if (!isNaN(limitValue) && limitValue > 0) {
        result.limit = limitValue;
      }
    } else if (arg === '--output' || arg === '-o') {
      result.output = args[++i] ?? './output';
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg && !arg.startsWith('-')) {
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
  pnpm blind --from-crawl <crawl_result.json> [options]

옵션:
  -c, --company <name>      조회할 회사명 (복수 가능)
  -f, --from-file <file>    회사 목록 파일 (한 줄에 하나씩)
  -r, --from-crawl <file>   크롤링 결과 JSON에서 회사 추출 및 평점 추가
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

  # 크롤링 결과에서 회사 추출 후 블라인드 조회 (원본 JSON에 평점 추가)
  pnpm blind --from-crawl ./output/사람인-백엔드-2026-01-04.json --csv

캐시:
  - 위치: .cache/company-ratings.csv
  - 모든 조회 결과가 자동으로 캐시에 저장됨
  - 이미 조회된 회사는 캐시에서 바로 사용

출력:
  - 콘솔에 평점 정보 출력
  - output/blind_ratings.json에 결과 저장
  - --from-crawl 사용 시: 원본 JSON에 blindRating 필드 추가
  - --csv 사용 시: CSV 파일도 함께 생성
`);
}

/**
 * 회사명 → 검색용 키 변환 (법인 표기 제거)
 */
function getSearchKey(companyName: string): string {
  return CompanyRating.toSearchQuery(companyName);
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
   리뷰 수: ${r.reviewCount !== null ? r.reviewCount.toLocaleString() : '정보 없음'}개`;

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
  overallRating: number | null;
  reviewCount: number | null;
  ratingLevel: string | null;
  categoryRatings?: {
    workLifeBalance?: number;
    careerGrowth?: number;
    compensation?: number;
    companyCulture?: number;
    management?: number;
  };
  sourceUrl: string | null;
  queriedAt: string;
}

interface EnrichedJson {
  [key: string]: unknown;
  jobs?: any[];
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

/**
 * 스트리밍 방식으로 JSON/CSV 파일에 평점 저장
 * - 각 회사 조회 후 바로 파일에 저장하여 크래시에도 데이터 유실 방지
 */
async function saveEnrichedJson(
  filePath: string,
  data: any,
  ratingsMap: Map<string, CompanyRatingSummary>,
  notFoundCompanies: string[],
  companyList: string[],
  exportCsv: boolean = false
): Promise<void> {
  // 회사명 → 검색용 키 변환 (법인 표기 제거)
  const getSearchKey = (companyName: string): string => {
    return CompanyRating.toSearchQuery(companyName);
  };

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
  const overallRatings = foundRatings
    .map((r) => r.overallRating)
    .filter((v): v is number => v !== null);
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

  // JSON에 전체 요약도 추가
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

  // JSON 파일 저장
  await fs.promises.writeFile(filePath, JSON.stringify(enrichedData, null, 2));

  // CSV 파일 저장 (스트리밍)
  if (exportCsv) {
    const csvPath = filePath.replace(/\.json$/, '.csv');
    const csvContent = generateCsv(enrichedData.jobs || []);
    await fs.promises.writeFile(csvPath, csvContent);
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
    '블라인드URL',
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
      br ? escapeCell(br.sourceUrl) : '',
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs();

  // 캐시 로드 (무조건)
  const cache = new CompanyRatingCache();
  await cache.load();
  const cacheStats = cache.getStats();
  console.log(`[캐시] 로드 완료: ${cacheStats.total}개 (평점있음: ${cacheStats.withRating}, 없음: ${cacheStats.notFound})`);

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

  // 캐시에 있는 회사 분리
  const cachedCompanies: string[] = [];
  const pendingCompanies: string[] = [];

  for (const company of companies) {
    if (cache.has(company)) {
      cachedCompanies.push(company);
    } else {
      pendingCompanies.push(company);
    }
  }

  console.log(`
╔════════════════════════════════════════════════════════════╗
║              블라인드 회사 평점 조회                          ║
╚════════════════════════════════════════════════════════════╝

조회 대상: ${companies.length}개 회사
  - 캐시 사용: ${cachedCompanies.length}개 (건너뜀)
  - 새로 조회: ${pendingCompanies.length}개
`);

  if (pendingCompanies.length === 0) {
    console.log('✅ 모든 회사가 캐시에 있습니다. 새로 조회할 회사가 없습니다.');

    // 캐시에서 결과 출력
    const results = companies.map((company) => {
      const cached = cache.get(company);
      if (cached && cached.hasRating()) {
        return { searchedCompany: company, found: true, rating: cached, error: undefined };
      }
      return { searchedCompany: company, found: false, rating: undefined, error: '캐시: 조회 실패' };
    });

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
    console.log(`결과 파일: ${outputPath}`);

    // --from-crawl 사용 시 원본 JSON에도 blindRating 추가
    if (args.fromCrawlResult) {
      const content = await fs.promises.readFile(args.fromCrawlResult, 'utf-8');
      const data = JSON.parse(content);

      const ratingsMap = new Map<string, CompanyRatingSummary>();
      const notFoundCompanies: string[] = [];

      for (const r of results) {
        const searchKey = getSearchKey(r.searchedCompany);
        if (r.found && r.rating) {
          ratingsMap.set(searchKey, {
            companyName: r.rating.companyName,
            overallRating: r.rating.overallRating,
            reviewCount: r.rating.reviewCount,
            ratingLevel: r.rating.getRatingLevel(),
            sourceUrl: r.rating.sourceUrl,
            queriedAt: r.rating.crawledAt,
          });
        } else {
          notFoundCompanies.push(r.searchedCompany);
        }
      }

      await saveEnrichedJson(args.fromCrawlResult, data, ratingsMap, notFoundCompanies, companies, args.csv);
      console.log(`\n✅ 원본 JSON 업데이트 완료: ${args.fromCrawlResult}`);
      if (args.csv) {
        console.log(`✅ CSV 파일 생성 완료: ${args.fromCrawlResult.replace(/\.json$/, '.csv')}`);
      }
    }
    return;
  }

  const scraper = new BlindScraper({ headless: args.headless });

  try {
    const startTime = Date.now();
    const results: BlindSearchResult[] = [];

    // limit 적용
    let toQuery = pendingCompanies;
    if (args.limit && args.limit < pendingCompanies.length) {
      toQuery = pendingCompanies.slice(0, args.limit);
      console.log(`[Limit] ${args.limit}개만 조회합니다.`);
    }

    // 스트리밍을 위한 준비: 원본 JSON 미리 로드
    let originalData: any = null;
    if (args.fromCrawlResult) {
      const content = await fs.promises.readFile(args.fromCrawlResult, 'utf-8');
      originalData = JSON.parse(content);
    }

    // 스트리밍용 ratingsMap, notFoundCompanies (캐시 데이터로 초기화)
    const ratingsMap = new Map<string, CompanyRatingSummary>();
    const notFoundCompanies: string[] = [];

    // 캐시된 회사 결과를 미리 ratingsMap에 추가
    for (const company of cachedCompanies) {
      const cached = cache.get(company);
      const searchKey = getSearchKey(company);
      if (cached && cached.hasRating()) {
        ratingsMap.set(searchKey, {
          companyName: cached.companyName,
          overallRating: cached.overallRating,
          reviewCount: cached.reviewCount,
          ratingLevel: cached.getRatingLevel(),
          categoryRatings: cached.categoryRatings,
          sourceUrl: cached.sourceUrl,
          queriedAt: cached.crawledAt,
        });
      } else {
        notFoundCompanies.push(company);
      }
    }

    // 스트리밍 저장 함수
    const saveStreamingResult = async () => {
      if (args.fromCrawlResult && originalData) {
        // 깊은 복사하여 원본 보존
        const dataCopy = JSON.parse(JSON.stringify(originalData));
        await saveEnrichedJson(args.fromCrawlResult, dataCopy, ratingsMap, notFoundCompanies, companies, args.csv);
      }
    };

    // 초기 저장 (캐시 데이터로)
    await saveStreamingResult();

    for (let i = 0; i < toQuery.length; i++) {
      const company = toQuery[i];
      if (!company) continue;

      // 매 조회 전 캐시 재로드 (병렬 실행 시 다른 프로세스가 저장한 데이터 반영)
      await cache.reload();

      // 다른 프로세스가 이미 조회했는지 확인
      if (cache.has(company)) {
        const cached = cache.get(company);
        const searchKey = getSearchKey(company);

        if (cached && cached.hasRating()) {
          console.log(`\n[${i + 1}/${toQuery.length}] ${company} - 캐시 사용 (평점: ${cached.overallRating})`);
          ratingsMap.set(searchKey, {
            companyName: cached.companyName,
            overallRating: cached.overallRating,
            reviewCount: cached.reviewCount,
            ratingLevel: cached.getRatingLevel(),
            categoryRatings: cached.categoryRatings,
            sourceUrl: cached.sourceUrl,
            queriedAt: cached.crawledAt,
          });
        } else {
          console.log(`\n[${i + 1}/${toQuery.length}] ${company} - 캐시 사용 (조회 실패 기록됨, 건너뜀)`);
          notFoundCompanies.push(company);
        }

        // 스트리밍 저장
        await saveStreamingResult();
        continue;
      }

      console.log(`\n[${i + 1}/${toQuery.length}] ${company} 조회 중...`);

      const result = await scraper.searchCompanyRating(company);
      results.push(result);

      // 캐시에 저장
      if (result.found && result.rating) {
        cache.set(company, result.rating);
      } else {
        cache.set(company, CompanyRating.createNotFound(company));
      }

      // 매 조회마다 캐시 저장 (크래시 대비)
      await cache.save();

      // 스트리밍: ratingsMap/notFoundCompanies 업데이트
      const searchKey = getSearchKey(company);
      if (result.found && result.rating) {
        ratingsMap.set(searchKey, {
          companyName: result.rating.companyName,
          overallRating: result.rating.overallRating,
          reviewCount: result.rating.reviewCount,
          ratingLevel: result.rating.getRatingLevel(),
          categoryRatings: result.rating.categoryRatings,
          sourceUrl: result.rating.sourceUrl,
          queriedAt: new Date(result.rating.crawledAt).toISOString(),
        });
      } else {
        notFoundCompanies.push(company);
      }

      // 스트리밍: 매 조회마다 JSON/CSV 저장
      await saveStreamingResult();

      console.log(formatRating(result));
      console.log(`  💾 결과 저장 완료 (${i + 1}/${toQuery.length})`);

      // Rate limiting (2초 대기)
      if (i < toQuery.length - 1) {
        console.log(`  ⏳ 다음 요청까지 2초 대기...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    // 전체 결과 (캐시 + 새 조회)
    const allResults = companies.map((company) => {
      // 새로 조회한 것 중에 있으면 그걸 사용
      const newResult = results.find((r) => r.searchedCompany === company);
      if (newResult) {
        return {
          searchedCompany: company,
          found: newResult.found,
          error: newResult.error,
          rating: newResult.rating?.toJSON(),
        };
      }
      // 캐시에서 가져오기
      const cached = cache.get(company);
      if (cached && cached.hasRating()) {
        return {
          searchedCompany: company,
          found: true,
          error: undefined,
          rating: cached.toJSON(),
        };
      }
      return {
        searchedCompany: company,
        found: false,
        error: '캐시: 조회 실패',
        rating: undefined,
      };
    });

    // 결과 저장
    const outputData = {
      queriedAt: new Date().toISOString(),
      totalCompanies: companies.length,
      found: allResults.filter((r) => r.found).length,
      notFound: allResults.filter((r) => !r.found).length,
      fromCache: cachedCompanies.length,
      newlyQueried: results.length,
      results: allResults,
    };

    const outputPath = `${args.output}/blind_ratings.json`;
    await fs.promises.mkdir(args.output, { recursive: true });
    await fs.promises.writeFile(outputPath, JSON.stringify(outputData, null, 2));

    // 요약 출력
    const successCount = allResults.filter((r) => r.found).length;
    const failCount = allResults.filter((r) => !r.found).length;

    console.log(`
╔════════════════════════════════════════════════════════════╗
║                       조회 완료                              ║
╚════════════════════════════════════════════════════════════╝

전체 회사: ${companies.length}개
  - 캐시 사용: ${cachedCompanies.length}개
  - 새로 조회: ${results.length}개
조회 성공: ${successCount}개
조회 실패: ${failCount}개
소요 시간: ${duration}초
결과 파일: ${outputPath}
`);

    if (failCount > 0) {
      console.log('조회 실패 목록:');
      allResults
        .filter((r) => !r.found)
        .forEach((r) => console.log(`  - ${r.searchedCompany}: ${r.error}`));
    }

    if (args.fromCrawlResult) {
      console.log(`\n✅ 원본 JSON 업데이트 완료: ${args.fromCrawlResult}`);
      if (args.csv) {
        console.log(`✅ CSV 파일 생성 완료: ${args.fromCrawlResult.replace(/\.json$/, '.csv')}`);
      }
    }
  } finally {
    await scraper.close();
  }
}

main().catch((error) => {
  console.error('실행 실패:', error);
  process.exit(1);
});
