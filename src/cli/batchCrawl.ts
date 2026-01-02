#!/usr/bin/env node
// 배치 크롤링 스크립트 - CSV에서 미테스트 URL 상위 N개 크롤링
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { chromium } from 'playwright';
import { CrawlerOrchestrator } from '../app/services/crawlerOrchestrator.js';
import { CrawlerAgent } from '../infra/agent/crawlerAgent.js';

interface CrawlResultEntry {
  company: string;
  url: string;
  mode: 'fast' | 'agent';
  success: boolean;
  jobsCollected: number;
  duration: number;
  error?: string;
  testedAt: string;
}

interface CrawlResultFile {
  lastUpdated: string;
  summary: {
    total: number;
    success: number;
    failed: number;
    rateLimited: number;
    successRate: string;
  };
  results: CrawlResultEntry[];
}

interface CsvRow {
  company: string;
  service: string;
  url: string;
}

const RESULT_FILE = 'output/result/crawl_result.json';
const CSV_FILE = 'input/crawl_origin.csv';

function loadResults(): CrawlResultFile {
  if (!fs.existsSync(RESULT_FILE)) {
    return {
      lastUpdated: new Date().toISOString(),
      summary: { total: 0, success: 0, failed: 0, rateLimited: 0, successRate: '0%' },
      results: [],
    };
  }
  return JSON.parse(fs.readFileSync(RESULT_FILE, 'utf-8'));
}

function saveResults(data: CrawlResultFile): void {
  const dir = path.dirname(RESULT_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // summary 업데이트
  const total = data.results.length;
  const success = data.results.filter(r => r.success).length;
  const failed = data.results.filter(r => !r.success && !r.error?.includes('Rate limit')).length;
  const rateLimited = data.results.filter(r => r.error?.includes('Rate limit')).length;

  data.summary = {
    total,
    success,
    failed,
    rateLimited,
    successRate: total > 0 ? `${Math.round((success / total) * 100)}%` : '0%',
  };
  data.lastUpdated = new Date().toISOString();

  fs.writeFileSync(RESULT_FILE, JSON.stringify(data, null, 2));
}

function parseCsv(): CsvRow[] {
  const content = fs.readFileSync(CSV_FILE, 'utf-8');
  const records = parse(content, {
    skip_empty_lines: true,
    relax_column_count: true,
  });

  const rows: CsvRow[] = [];
  let currentCompany = '';

  // 첫 번째 행은 헤더이므로 건너뜀
  for (let i = 1; i < records.length; i++) {
    const row = records[i];
    const company = row[0]?.trim() || currentCompany;
    const service = row[1]?.trim() || '';
    const url = row[2]?.trim() || '';

    if (company) {
      currentCompany = company;
    }

    if (url && url.startsWith('http')) {
      rows.push({
        company: service || currentCompany,
        service,
        url,
      });
    }
  }

  return rows;
}

function getUntestedUrls(csvRows: CsvRow[], results: CrawlResultFile): CsvRow[] {
  const testedUrls = new Set(results.results.map(r => r.url));
  return csvRows.filter(row => !testedUrls.has(row.url));
}

async function crawlSingle(
  row: CsvRow,
  mode: 'fast' | 'agent',
  headless: boolean
): Promise<CrawlResultEntry> {
  const startTime = Date.now();

  console.log(`\n[${'='.repeat(60)}]`);
  console.log(`[Crawl] ${row.company} - ${mode} 모드`);
  console.log(`[URL] ${row.url}`);
  console.log(`[${'='.repeat(60)}]`);

  try {
    if (mode === 'fast') {
      const crawler = new CrawlerOrchestrator({ headless });
      const result = await crawler.crawl(row.url, {
        company: row.company,
        maxPages: 1,
        includeDetails: false,
      });

      const duration = (Date.now() - startTime) / 1000;
      const success = result.totalCount > 0;

      return {
        company: row.company,
        url: row.url,
        mode: 'fast',
        success,
        jobsCollected: result.totalCount,
        duration,
        error: success ? undefined : result.errors[0] || 'No jobs found',
        testedAt: new Date().toISOString(),
      };
    } else {
      // Agent 모드
      const browser = await chromium.launch({ headless });
      const page = await browser.newPage();

      try {
        const agent = new CrawlerAgent(page, row.company);
        const jobs = await agent.run(row.url);
        const duration = (Date.now() - startTime) / 1000;

        return {
          company: row.company,
          url: row.url,
          mode: 'agent',
          success: jobs.length > 0,
          jobsCollected: jobs.length,
          duration,
          testedAt: new Date().toISOString(),
        };
      } finally {
        await browser.close();
      }
    }
  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    const errorMsg = error instanceof Error ? error.message : String(error);

    return {
      company: row.company,
      url: row.url,
      mode,
      success: false,
      jobsCollected: 0,
      duration,
      error: errorMsg.includes('429') ? 'Rate limit (429)' : errorMsg.substring(0, 100),
      testedAt: new Date().toISOString(),
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  let count = 10;
  let mode: 'fast' | 'agent' = 'fast';
  let headless = true;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-n' || args[i] === '--count') {
      count = parseInt(args[++i] || '10', 10);
    } else if (args[i] === '--mode') {
      const m = args[++i];
      if (m === 'fast' || m === 'agent') mode = m;
    } else if (args[i] === '--no-headless') {
      headless = false;
    } else if (args[i] === '-h' || args[i] === '--help') {
      console.log(`
배치 크롤링 - CSV에서 미테스트 URL 크롤링

사용법:
  pnpm batch [options]

옵션:
  -n, --count <n>   크롤링할 URL 수 (기본: 10)
  --mode <mode>     크롤링 모드: fast | agent (기본: fast)
  --no-headless     브라우저 UI 표시
  -h, --help        도움말 표시

예시:
  pnpm batch -n 5              # 상위 5개 fast 모드로 크롤링
  pnpm batch -n 3 --mode agent # 상위 3개 agent 모드로 크롤링
`);
      process.exit(0);
    }
  }

  console.log(`
╔════════════════════════════════════════════════════════════╗
║                  배치 크롤링 시작                            ║
╚════════════════════════════════════════════════════════════╝

모드: ${mode}
크롤링 수: ${count}
Headless: ${headless}
`);

  // CSV 파싱 및 결과 파일 로드
  const csvRows = parseCsv();
  const results = loadResults();

  console.log(`[Info] CSV에서 ${csvRows.length}개 URL 발견`);
  console.log(`[Info] 이미 테스트된 URL: ${results.results.length}개`);

  // 미테스트 URL 필터링
  const untestedRows = getUntestedUrls(csvRows, results);
  console.log(`[Info] 미테스트 URL: ${untestedRows.length}개`);

  if (untestedRows.length === 0) {
    console.log('\n모든 URL이 이미 테스트되었습니다!');
    return;
  }

  // 상위 N개 선택
  const targets = untestedRows.slice(0, count);
  console.log(`\n[Target] ${targets.length}개 URL 크롤링 예정:`);
  targets.forEach((t, i) => console.log(`  ${i + 1}. ${t.company}: ${t.url.substring(0, 60)}...`));

  // 순차 크롤링
  for (const target of targets) {
    const result = await crawlSingle(target, mode, headless);
    results.results.push(result);

    // 각 크롤링 후 결과 저장 (중간 저장)
    saveResults(results);

    console.log(`\n[Result] ${result.company}: ${result.success ? '✅ 성공' : '❌ 실패'} (${result.jobsCollected}개, ${result.duration.toFixed(2)}s)`);

    // Rate limit 방지를 위한 딜레이
    if (targets.indexOf(target) < targets.length - 1) {
      console.log('[Wait] Rate limit 방지 30초 대기...');
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  }

  // 최종 결과 출력
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                  배치 크롤링 완료                            ║
╚════════════════════════════════════════════════════════════╝

총 테스트: ${results.summary.total}
성공: ${results.summary.success}
실패: ${results.summary.failed}
Rate Limited: ${results.summary.rateLimited}
성공률: ${results.summary.successRate}

결과 파일: ${RESULT_FILE}
`);
}

main().catch(console.error);
