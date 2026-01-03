#!/usr/bin/env node
// CLI 진입점
import 'dotenv/config';
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

// stealth 플러그인 적용 (봇 탐지 우회)
chromium.use(stealth());
import { CrawlerOrchestrator } from '../app/services/crawlerOrchestrator.js';
import { CrawlerAgent } from '../infra/agent/crawlerAgent.js';
import { JsonWriter } from '../infra/output/jsonWriter.js';
import { CsvWriter } from '../infra/output/csvWriter.js';
import { CrawlResult } from '../app/services/crawlerOrchestrator.js';

type CrawlMode = 'fast' | 'agent';
type OutputFormat = 'json' | 'csv';

interface CliArgs {
  url: string;
  company: string;
  maxPages: number;
  headless: boolean;
  output: string;
  includeDetails: boolean;
  mode: CrawlMode;
  format: OutputFormat;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  const result: CliArgs = {
    url: '',
    company: '',
    maxPages: 1,
    headless: true,
    output: './output',
    includeDetails: false,
    mode: 'fast',
    format: 'json',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--url' || arg === '-u') {
      result.url = args[++i] || '';
    } else if (arg === '--company' || arg === '-c') {
      result.company = args[++i] || '';
    } else if (arg === '--max-pages' || arg === '-m') {
      result.maxPages = parseInt(args[++i] || '1', 10);
    } else if (arg === '--no-headless') {
      result.headless = false;
    } else if (arg === '--details' || arg === '-d') {
      result.includeDetails = true;
    } else if (arg === '--output' || arg === '-o') {
      result.output = args[++i] || './output';
    } else if (arg === '--mode') {
      const modeValue = args[++i] || 'fast';
      if (modeValue === 'fast' || modeValue === 'agent') {
        result.mode = modeValue;
      }
    } else if (arg === '--format' || arg === '-f') {
      const formatValue = args[++i] || 'json';
      if (formatValue === 'json' || formatValue === 'csv') {
        result.format = formatValue;
      }
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (!arg?.startsWith('-') && !result.url) {
      // 첫 번째 비옵션 인자를 URL로 처리
      result.url = arg || '';
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
JD Crawler - 범용 채용 사이트 크롤러

사용법:
  pnpm crawl <url> [options]
  pnpm crawl --url <url> --company <company> [options]

옵션:
  -u, --url <url>         크롤링할 채용 페이지 URL (필수)
  -c, --company <company> 회사명 (필수)
  -m, --max-pages <n>     최대 페이지 수 (기본: 1, fast 모드만)
  -d, --details           상세 페이지도 크롤링 (JD 전문 수집, fast 모드만)
  --mode <mode>           크롤링 모드: fast(기본) | agent(ReAct 패턴)
  -f, --format <format>   출력 형식: json(기본) | csv
  -o, --output <dir>      출력 디렉토리 (기본: ./output)
  --no-headless           브라우저 UI 표시
  -h, --help              도움말 표시

모드 설명:
  fast   : 고정된 셀렉터 기반 빠른 크롤링 (저렴, 단순 사이트용)
  agent  : LLM이 상황 판단하며 크롤링 (유연, SPA/복잡한 사이트용)

예시:
  pnpm crawl --url "https://jobs.booking.com/booking/jobs" --company "Booking.com"
  pnpm crawl -u "https://careers.tencent.com/en-us/search.html" -c "Tencent" -m 3
  pnpm crawl --url "https://example.com/jobs" --company "Example" --mode agent
  pnpm crawl -u "https://example.com/jobs" -c "Example" -f csv  # CSV로 출력

환경 변수:
  ANTHROPIC_API_KEY       Claude API 키 (필수)
`);
}

async function main(): Promise<void> {
  const args = parseArgs();

  // 유효성 검사
  if (!args.url) {
    console.error('에러: URL이 필요합니다. --help로 사용법을 확인하세요.');
    process.exit(1);
  }

  if (!args.company) {
    console.error('에러: 회사명이 필요합니다. --help로 사용법을 확인하세요.');
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('에러: ANTHROPIC_API_KEY 환경 변수가 설정되지 않았습니다.');
    process.exit(1);
  }

  console.log(`
╔════════════════════════════════════════════════════════════╗
║                    JD Crawler POC                          ║
╚════════════════════════════════════════════════════════════╝

대상 URL: ${args.url}
회사명: ${args.company}
모드: ${args.mode}
${args.mode === 'fast' ? `최대 페이지: ${args.maxPages}` : ''}
${args.mode === 'fast' ? `상세 페이지: ${args.includeDetails ? '예' : '아니오'}` : ''}
출력 형식: ${args.format.toUpperCase()}
Headless: ${args.headless}
출력 디렉토리: ${args.output}
`);

  try {
    const startTime = Date.now();
    let result: CrawlResult;

    if (args.mode === 'agent') {
      // Agent 모드 (ReAct 패턴)
      console.log('Agent 모드로 크롤링 시작...\n');

      const browser = await chromium.launch({ headless: args.headless });
      const page = await browser.newPage();

      try {
        const agent = new CrawlerAgent(page, args.company);
        const jobs = await agent.run(args.url);

        result = {
          company: args.company,
          sourceUrl: args.url,
          jobs: jobs,
          totalCount: jobs.length,
          crawledAt: new Date().toISOString(),
          errors: [],
          pagesProcessed: 0, // Agent 모드에서는 페이지 개념이 다름
          duplicatesRemoved: 0,
        };
      } finally {
        await browser.close();
      }
    } else {
      // Fast 모드 (기존 방식)
      console.log('Fast 모드로 크롤링 시작...\n');

      const crawler = new CrawlerOrchestrator({
        headless: args.headless,
      });

      result = await crawler.crawl(args.url, {
        company: args.company,
        maxPages: args.maxPages,
        includeDetails: args.includeDetails,
      });
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    // 결과 저장 (기존 파일과 병합)
    const writeResult = args.format === 'csv'
      ? await new CsvWriter(args.output).writeWithStats(result)
      : await new JsonWriter(args.output).writeWithStats(result);

    // 결과 출력
    const totalDuplicates = result.duplicatesRemoved + writeResult.duplicatesRemoved;
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                      크롤링 완료                            ║
╚════════════════════════════════════════════════════════════╝

수집된 직무 수: ${writeResult.totalJobs}
신규 직무: ${writeResult.newJobs}
${args.mode === 'fast' ? `처리된 페이지: ${result.pagesProcessed}` : ''}
제거된 중복: ${totalDuplicates}
소요 시간: ${duration}초
결과 파일: ${writeResult.filePath}
`);

    if (result.errors.length > 0) {
      console.log('경고/에러:');
      result.errors.forEach((err) => console.log(`  - ${err}`));
    }

    // 샘플 출력 (처음 3개)
    if (result.jobs.length > 0) {
      console.log('\n샘플 직무 (처음 3개):');
      result.jobs.slice(0, 3).forEach((job, i) => {
        console.log(`  ${i + 1}. ${job.title}`);
        if (job.location) console.log(`     위치: ${job.location}`);
        if (job.department) console.log(`     부서: ${job.department}`);
        if (job.description) {
          const shortDesc = job.description.slice(0, 100) + (job.description.length > 100 ? '...' : '');
          console.log(`     설명: ${shortDesc}`);
        }
      });
    }
  } catch (error) {
    console.error('\n크롤링 실패:', error);
    process.exit(1);
  }
}

main();
