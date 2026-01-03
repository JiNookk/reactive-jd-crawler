#!/usr/bin/env node
// CLI 진입점
import "dotenv/config";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";

// stealth 플러그인 적용 (봇 탐지 우회)
chromium.use(stealth());
import { CrawlerOrchestrator } from "../app/services/crawlerOrchestrator.js";
import { CrawlerAgent } from "../infra/agent/crawlerAgent.js";
import { JsonWriter } from "../infra/output/jsonWriter.js";
import { CsvWriter } from "../infra/output/csvWriter.js";
import { CrawlResult } from "../app/services/crawlerOrchestrator.js";
import { FailureCaseStore } from "../infra/cache/failureCaseStore.js";
import { CheckpointStore } from "../infra/cache/checkpointStore.js";

type CrawlMode = "fast" | "agent";
type OutputFormat = "json" | "csv";

interface CliArgs {
  url: string;
  company: string;
  maxPages: number;
  headless: boolean;
  output: string;
  includeDetails: boolean;
  mode: CrawlMode;
  format: OutputFormat;
  failureStats: boolean;
  resume?: string; // 체크포인트 경로 또는 'auto'
  listCheckpoints: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  const result: CliArgs = {
    url: "",
    company: "",
    maxPages: 1,
    headless: true,
    output: "./output",
    includeDetails: false,
    mode: "fast",
    format: "json",
    failureStats: false,
    resume: undefined,
    listCheckpoints: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--url" || arg === "-u") {
      result.url = args[++i] || "";
    } else if (arg === "--company" || arg === "-c") {
      result.company = args[++i] || "";
    } else if (arg === "--max-pages" || arg === "-m") {
      result.maxPages = parseInt(args[++i] || "1", 10);
    } else if (arg === "--no-headless") {
      result.headless = false;
    } else if (arg === "--details" || arg === "-d") {
      result.includeDetails = true;
    } else if (arg === "--output" || arg === "-o") {
      result.output = args[++i] || "./output";
    } else if (arg === "--mode") {
      const modeValue = args[++i] || "fast";
      if (modeValue === "fast" || modeValue === "agent") {
        result.mode = modeValue;
      }
    } else if (arg === "--format" || arg === "-f") {
      const formatValue = args[++i] || "json";
      if (formatValue === "json" || formatValue === "csv") {
        result.format = formatValue;
      }
    } else if (arg === "--failure-stats") {
      result.failureStats = true;
    } else if (arg === "--resume" || arg === "-r") {
      result.resume = args[++i] || "auto";
    } else if (arg === "--list-checkpoints") {
      result.listCheckpoints = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!arg?.startsWith("-") && !result.url) {
      // 첫 번째 비옵션 인자를 URL로 처리
      result.url = arg || "";
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
  -u, --url <url>         크롤링할 채용 페이지 URL (필수, --resume 사용 시 생략 가능)
  -c, --company <company> 회사명 (필수)
  -m, --max-pages <n>     최대 페이지 수 (기본: 1, 0=무제한, fast 모드만)
  -d, --details           상세 페이지도 크롤링 (JD 전문 수집, fast 모드만)
  --mode <mode>           크롤링 모드: fast(기본) | agent(ReAct 패턴)
  -f, --format <format>   출력 형식: json(기본) | csv
  -o, --output <dir>      출력 디렉토리 (기본: ./output)
  --no-headless           브라우저 UI 표시
  --failure-stats         실패 케이스 통계 표시
  -r, --resume <path>     체크포인트에서 재개 (agent 모드만, 'auto'=최신 자동 선택)
  --list-checkpoints      재개 가능한 체크포인트 목록 표시
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

async function crawl(args: CliArgs) {
  switch (args.mode) {
    case "agent": {
      const browser = await chromium.launch({ headless: args.headless });
      const page = await browser.newPage();

      try {
        const agent = new CrawlerAgent(page, args.company);
        let jobs;

        if (args.resume) {
          console.log("체크포인트에서 세션 재개 중...\n");
          if (args.resume === "auto") {
            const resumedJobs = await agent.resumeByCompany();
            if (!resumedJobs) {
              throw new Error("재개할 체크포인트를 찾을 수 없습니다.");
            }
            jobs = resumedJobs;
          } else {
            jobs = await agent.resume(args.resume);
          }
        } else {
          console.log("Agent 모드로 크롤링 시작...\n");
          jobs = await agent.run(args.url);
        }

        const result = {
          company: args.company,
          sourceUrl: args.url,
          jobs: jobs,
          totalCount: jobs.length,
          crawledAt: new Date().toISOString(),
          errors: [],
          pagesProcessed: 0, // Agent 모드에서는 페이지 개념이 다름
          duplicatesRemoved: 0,
        };

        return result;
      } finally {
        await browser.close();
      }
    }
    case "fast": {
      const crawler = new CrawlerOrchestrator({
        headless: args.headless,
      });

      const result = await crawler.crawl(args.url, {
        company: args.company,
        maxPages: args.maxPages,
        includeDetails: args.includeDetails,
      });

      return result;
    }
    default: {
      throw new Error("모드가 지정되지 않았습니다!");
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const checkpointStore = new CheckpointStore();

  // --failure-stats 명령 처리
  if (args.failureStats) {
    const store = new FailureCaseStore();
    const stats = await store.getStats();

    console.log(`
╔════════════════════════════════════════════════════════════╗
║                  실패 케이스 통계                           ║
╚════════════════════════════════════════════════════════════╝

총 실패 케이스: ${stats.total}개
해결됨: ${stats.resolved}개
미해결: ${stats.unresolved}개
해결률: ${(stats.resolutionRate * 100).toFixed(1)}%

도구별 실패 횟수:`);
    for (const [tool, count] of Object.entries(stats.byTool)) {
      console.log(`  - ${tool}: ${count}회`);
    }

    console.log(`
회사별 실패 횟수:`);
    for (const [company, count] of Object.entries(stats.byCompany)) {
      console.log(`  - ${company}: ${count}회`);
    }

    if (stats.total === 0) {
      console.log("\n아직 기록된 실패 케이스가 없습니다.");
    }

    process.exit(0);
  }

  // 유효성 검사
  if (!args.url) {
    console.error("에러: URL이 필요합니다. --help로 사용법을 확인하세요.");
  }
  // --list-checkpoints 명령 처리
  if (args.listCheckpoints) {
    const checkpoints = await checkpointStore.listResumable();
    if (checkpoints.length === 0) {
      console.log("재개 가능한 체크포인트가 없습니다.");
    } else {
      console.log("재개 가능한 체크포인트:");
      checkpoints.forEach((cp, i) => {
        console.log(
          `  ${i + 1}. ${cp.company} (${cp.status}, ${cp.jobCount}개 수집)`
        );
        console.log(`     경로: ${cp.path}`);
      });
    }
    process.exit(0);
  }

  // --resume 옵션은 agent 모드에서만 사용 가능
  if (args.resume && args.mode !== "agent") {
    console.error("에러: --resume 옵션은 agent 모드에서만 사용 가능합니다.");
    process.exit(1);
  }

  // 유효성 검사 (--resume 사용 시 URL과 회사명은 체크포인트에서 가져옴)
  if (!args.resume) {
    if (!args.url) {
      console.error("에러: URL이 필요합니다. --help로 사용법을 확인하세요.");
      process.exit(1);
    }
    if (!args.company) {
      console.error("에러: 회사명이 필요합니다. --help로 사용법을 확인하세요.");
      process.exit(1);
    }
  }

  if (!args.mode) {
    console.error("에러: 모드가 필요합니다. --help로 사용법을 확인하세요.");
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("에러: ANTHROPIC_API_KEY 환경 변수가 설정되지 않았습니다.");
    process.exit(1);
  }

  // --resume 모드일 경우 체크포인트에서 정보 로드
  if (args.resume) {
    let checkpoint;
    if (args.resume === "auto") {
      // 가장 최근 체크포인트 자동 선택
      const checkpoints = await checkpointStore.listResumable();
      if (checkpoints.length === 0) {
        console.error("에러: 재개 가능한 체크포인트가 없습니다.");
        process.exit(1);
      }
      checkpoint = await checkpointStore.load(checkpoints[0]!.path);
    } else {
      checkpoint = await checkpointStore.load(args.resume);
    }

    if (!checkpoint) {
      console.error("에러: 체크포인트를 로드할 수 없습니다.");
      process.exit(1);
    }

    args.url = checkpoint.url;
    args.company = checkpoint.company;

    console.log(`
╔════════════════════════════════════════════════════════════╗
║              JD Crawler - 세션 재개                         ║
╚════════════════════════════════════════════════════════════╝

${checkpoint.generateSummary()}
`);
  } else {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                    JD Crawler POC                          ║
╚════════════════════════════════════════════════════════════╝

대상 URL: ${args.url}
회사명: ${args.company}
모드: ${args.mode}
${args.mode === "fast" ? `최대 페이지: ${args.maxPages}` : ""}
${
  args.mode === "fast"
    ? `상세 페이지: ${args.includeDetails ? "예" : "아니오"}`
    : ""
}
출력 형식: ${args.format.toUpperCase()}
Headless: ${args.headless}
출력 디렉토리: ${args.output}
`);
  }

  try {
    const startTime = Date.now();
    const result: CrawlResult = await crawl(args);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    // 결과 저장 (기존 파일과 병합)
    const writeResult =
      args.format === "csv"
        ? await new CsvWriter(args.output).writeWithStats(result)
        : await new JsonWriter(args.output).writeWithStats(result);

    // 결과 출력
    const totalDuplicates =
      result.duplicatesRemoved + writeResult.duplicatesRemoved;
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                      크롤링 완료                            ║
╚════════════════════════════════════════════════════════════╝

수집된 직무 수: ${writeResult.totalJobs}
신규 직무: ${writeResult.newJobs}
${args.mode === "fast" ? `처리된 페이지: ${result.pagesProcessed}` : ""}
제거된 중복: ${totalDuplicates}
소요 시간: ${duration}초
결과 파일: ${writeResult.filePath}
`);

    if (result.errors.length > 0) {
      console.log("경고/에러:");
      result.errors.forEach((err) => console.log(`  - ${err}`));
    }

    // 샘플 출력 (처음 3개)
    if (result.jobs.length > 0) {
      console.log("\n샘플 직무 (처음 3개):");
      result.jobs.slice(0, 3).forEach((job, i) => {
        console.log(`  ${i + 1}. ${job.title}`);
        if (job.location) console.log(`     위치: ${job.location}`);
        if (job.department) console.log(`     부서: ${job.department}`);
        if (job.description) {
          const shortDesc =
            job.description.slice(0, 100) +
            (job.description.length > 100 ? "..." : "");
          console.log(`     설명: ${shortDesc}`);
        }
      });
    }
  } catch (error) {
    console.error("\n크롤링 실패:", error);
    process.exit(1);
  }
}

main();
