// ReAct 패턴 기반 크롤러 Agent (Reflexion + Checkpoint 패턴 적용)
import Anthropic from "@anthropic-ai/sdk";
import { Page } from "playwright";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import * as path from "path";
import { agentTools } from "./tools.js";
import { ToolExecutor, ExtractedJob, PageInfo } from "./toolExecutor.js";
import { JobPosting } from "../../domain/jobPosting.domain.js";
import {
  ReflectionContext,
  ReflectionResult,
  ReflectionPromptBuilder,
} from "../../domain/reflection.domain.js";
import { FailureCase } from "../../domain/failureCase.domain.js";
import { FailureCaseStore } from "../cache/failureCaseStore.js";
import { AgentCheckpoint } from "../../domain/checkpoint.domain.js";
import { CheckpointStore } from "../cache/checkpointStore.js";
import { MemoryManager } from "../../domain/memoryBlock.domain.js";

// 로거 클래스 - 콘솔과 파일 동시 출력
class AgentLogger {
  private logFile: string;
  private stream: fs.WriteStream;

  constructor(company: string) {
    const logDir = "output/logs";
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.logFile = path.join(logDir, `agent_${company}_${timestamp}.log`);
    this.stream = fs.createWriteStream(this.logFile, { flags: "a" });

    this.log(`\n${"═".repeat(70)}`);
    this.log(`Agent 로그 시작: ${new Date().toISOString()}`);
    this.log(`회사: ${company}`);
    this.log(`${"═".repeat(70)}\n`);
  }

  log(message: string): void {
    console.log(message);
    this.stream.write(message + "\n");
  }

  close(): void {
    this.stream.end();
  }

  getLogFile(): string {
    return this.logFile;
  }
}

// Agent 상태
interface AgentState {
  url: string;
  company: string;
  goal: string;
  history: AgentStep[];
  extractedJobs: ExtractedJob[];
  done: boolean;
  consecutiveNoNewJobs: number;
  // 무한 루프 감지용
  lastAction: { toolName: string; toolInput: string } | null;
  consecutiveSameAction: number;
  // 스크롤 위치 추적 (무한 스크롤 종료 감지)
  lastScrollPosition: number;
  consecutiveScrollNoProgress: number;
}

// 각 스텝 기록
interface AgentStep {
  step: number;
  observation: string;
  thought?: string;
  toolName: string;
  toolInput: unknown;
  result: string;
}

// 설정
const MAX_STEPS = 30;
const MAX_CONSECUTIVE_NO_NEW = 3;
const MAX_CONSECUTIVE_SAME_ACTION = 3; // 동일 액션 연속 실행 제한
const MAX_NAVIGATE_RETRIES = 3; // 페이지 로딩 재시도 횟수

const SYSTEM_PROMPT = `당신은 채용 사이트에서 직무 공고를 수집하는 크롤러 에이전트입니다.

## 목표
주어진 채용 사이트에서 가능한 모든 직무 공고 정보를 수집합니다.

## 작업 흐름
1. get_page_info로 현재 페이지 상태 파악
2. 직무 카드가 보이면 extract_jobs로 추출
3. 페이지네이션 처리 (버튼 클릭 / 무한 스크롤 / URL 파라미터)
4. 더 이상 새 직무가 없으면 done 호출

## 완료 조건
- 모든 페이지 순회 완료
- 연속 3회 새 직무 없음
- 무한 스크롤에서 atBottom: true

## 핵심 원칙
- 막히면 get_page_info로 상황 재파악
- 실패 시 다른 셀렉터로 재시도
- 같은 액션을 3회 이상 반복하지 않기
- 도구별 상세 사용법은 각 도구의 description 참조

## 모달/팝업 주의
- 언어 선택 모달은 Close/X 버튼으로 닫기 (언어 변경 버튼 클릭 금지)
- 잘못된 페이지로 이동하면 navigate로 원래 URL 복귀`;

export class CrawlerAgent {
  private client: Anthropic;
  private toolExecutor: ToolExecutor;
  private state: AgentState;
  private logger: AgentLogger;
  private failureCaseStore: FailureCaseStore;
  private checkpointStore: CheckpointStore;
  private checkpoint: AgentCheckpoint;
  private sessionId: string;
  private memoryManager: MemoryManager;

  constructor(private page: Page, private company: string, apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.toolExecutor = new ToolExecutor(page, company);
    this.logger = new AgentLogger(company);
    this.failureCaseStore = new FailureCaseStore();
    this.checkpointStore = new CheckpointStore();
    this.sessionId = uuidv4().slice(0, 8);
    this.checkpoint = AgentCheckpoint.create({
      sessionId: this.sessionId,
      url: "",
      company,
      createdAt: new Date(),
    });
    this.state = {
      url: "",
      company,
      goal: "모든 직무 공고 수집",
      history: [],
      extractedJobs: [],
      done: false,
      consecutiveNoNewJobs: 0,
      lastAction: null,
      consecutiveSameAction: 0,
      lastScrollPosition: 0,
      consecutiveScrollNoProgress: 0,
    };

    // Memory Blocks 초기화
    this.memoryManager = MemoryManager.create(
      [
        {
          name: "persona",
          content: "채용공고 크롤러 에이전트. 정확하고 신속하게 직무 정보 수집.",
          maxTokens: 100,
          priority: 1, // 절대 삭제 안 함
        },
        {
          name: "current_task",
          content: `회사: ${company}\n목표: 모든 직무 공고 수집`,
          maxTokens: 300,
          priority: 2,
        },
        {
          name: "collected_data",
          content: "수집된 직무: 없음",
          maxTokens: 1000,
          priority: 3,
        },
        {
          name: "recent_actions",
          content: "최근 행동: 없음",
          maxTokens: 500,
          priority: 4, // 필요시 압축 가능
        },
      ],
      { maxTotalTokens: 4000, compressionThreshold: 0.9 }
    );
  }

  async run(url: string): Promise<JobPosting[]> {
    this.state.url = url;

    // 체크포인트 URL 업데이트
    this.checkpoint = AgentCheckpoint.create({
      sessionId: this.sessionId,
      url,
      company: this.company,
      createdAt: new Date(),
    });

    // Memory Block 업데이트: current_task에 URL 추가
    this.memoryManager = this.memoryManager.updateBlock(
      "current_task",
      `회사: ${this.company}\nURL: ${url}\n목표: 모든 직무 공고 수집`
    );

    // 페이지 로드
    this.logger.log(`[Agent] 페이지 로드 중: ${url}`);
    this.logger.log(`[Agent] 세션 ID: ${this.sessionId}`);
    this.logger.log(
      `[Agent] 메모리 사용량: ${this.memoryManager.usagePercentage.toFixed(1)}%`
    );
    await this.page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await this.page.waitForTimeout(3000);

    // 대화 메시지 초기화
    const messages: Anthropic.Messages.MessageParam[] = [
      {
        role: "user",
        content: `채용 사이트 크롤링을 시작합니다.

URL: ${url}
회사명: ${this.company}
목표: 이 사이트의 모든 직무 공고를 수집해주세요.

먼저 get_page_info로 현재 페이지 상태를 확인해주세요.`,
      },
    ];

    // ReAct 루프
    for (let step = 1; step <= MAX_STEPS && !this.state.done; step++) {
      this.logger.log(`\n${"═".repeat(70)}`);
      this.logger.log(`[Agent] Step ${step}/${MAX_STEPS}`);
      this.logger.log(`${"═".repeat(70)}`);

      // LLM 호출
      const response = await this.client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: agentTools,
        messages,
      });

      // 응답 처리
      if (response.stop_reason === "tool_use") {
        // 사고 과정 (Thought) 출력 - 텍스트 블록이 있으면 출력
        const textBlock = response.content.find(
          (block): block is Anthropic.Messages.TextBlock =>
            block.type === "text"
        );
        if (textBlock) {
          this.logger.log(`\n[🧠 Thought]`);
          this.logger.log(`${"-".repeat(50)}`);
          this.logger.log(textBlock.text);
          this.logger.log(`${"-".repeat(50)}`);
        }

        // 도구 사용 요청
        const toolUseBlock = response.content.find(
          (block): block is Anthropic.Messages.ToolUseBlock =>
            block.type === "tool_use"
        );

        if (!toolUseBlock) {
          this.logger.log("[Agent] 도구 사용 블록을 찾을 수 없음");
          break;
        }

        const toolName = toolUseBlock.name;
        const toolInput = toolUseBlock.input;
        const toolInputStr = JSON.stringify(toolInput);

        this.logger.log(`\n[🔧 Action] ${toolName}`);
        this.logger.log(`[📥 Input] ${JSON.stringify(toolInput, null, 2)}`);

        // 무한 루프 감지
        if (
          this.state.lastAction &&
          this.state.lastAction.toolName === toolName &&
          this.state.lastAction.toolInput === toolInputStr
        ) {
          this.state.consecutiveSameAction++;
          if (this.state.consecutiveSameAction >= MAX_CONSECUTIVE_SAME_ACTION) {
            this.logger.log(
              `[⚠️ 경고] 동일한 액션이 ${this.state.consecutiveSameAction}회 연속 실행됨 - 무한 루프 가능성`
            );
          }
        } else {
          this.state.consecutiveSameAction = 1;
        }
        this.state.lastAction = { toolName, toolInput: toolInputStr };

        // 도구 실행 (navigate는 재시도 로직 포함)
        let result = await this.toolExecutor.execute(toolName, toolInput);

        // navigate 실패 시 재시도
        if (toolName === "navigate" && !result.success) {
          for (let retry = 1; retry <= MAX_NAVIGATE_RETRIES; retry++) {
            this.logger.log(
              `[🔄 재시도] navigate ${retry}/${MAX_NAVIGATE_RETRIES}...`
            );
            await this.page.waitForTimeout(2000); // 재시도 전 대기
            result = await this.toolExecutor.execute(toolName, toolInput);
            if (result.success) {
              this.logger.log(`[✅ 재시도 성공] ${retry}번째 시도에서 성공`);
              break;
            }
          }
        }

        this.logger.log(
          `\n[📤 Observation] ${result.success ? "✅ 성공" : "❌ 실패"}`
        );
        if (result.error) {
          this.logger.log(`[Error] ${result.error}`);
        }
        if (result.data) {
          // 데이터가 너무 길면 요약
          const dataStr = JSON.stringify(result.data, null, 2);
          if (dataStr.length > 1000) {
            this.logger.log(`[Data] (길이: ${dataStr.length}자, 요약 출력)`);
            // PageInfo인 경우 주요 정보만 출력
            if (toolName === "get_page_info") {
              const info = result.data as PageInfo;
              this.logger.log(`  - URL: ${info.url}`);
              this.logger.log(`  - Title: ${info.title}`);
              this.logger.log(
                `  - 셀렉터 후보: ${info.selectorCandidates.length}개`
              );
              this.logger.log(`  - 직무 링크: ${info.jobLinks.length}개`);
              this.logger.log(`  - 버튼: ${info.visibleButtons.length}개`);
              this.logger.log(
                `  - 페이지네이션: ${info.paginationInfo || "없음"}`
              );
              this.logger.log(
                `  - 페이지네이션 타입: ${info.paginationType.type}`
              );
              if (info.paginationType.nextSelector) {
                this.logger.log(
                  `    └ Next 셀렉터: ${info.paginationType.nextSelector}`
                );
              }
              if (info.paginationType.loadMoreSelector) {
                this.logger.log(
                  `    └ Load More 셀렉터: ${info.paginationType.loadMoreSelector}`
                );
              }
              if (info.paginationType.urlPattern) {
                this.logger.log(
                  `    └ URL 패턴: ${info.paginationType.urlPattern}`
                );
              }
              this.logger.log(
                `  - 결과 수: ${info.resultCount || "표시 없음"}`
              );
              if (info.jobLinks.length > 0) {
                this.logger.log(`  - 직무 링크 샘플:`);
                info.jobLinks.slice(0, 3).forEach((link, i) => {
                  this.logger.log(
                    `    ${i + 1}. ${link.text.substring(0, 50)}`
                  );
                });
              }
            } else {
              this.logger.log(dataStr.substring(0, 500) + "...");
            }
          } else {
            this.logger.log(`[Data] ${dataStr}`);
          }
        }

        // 특별 처리: scroll 결과 (무한 스크롤 종료 감지)
        if (toolName === "scroll" && result.success && result.data) {
          const scrollData = result.data as {
            currentPosition: number;
            maxPosition: number;
            atBottom: boolean;
          };

          // 스크롤 위치 진전 확인
          if (scrollData.currentPosition === this.state.lastScrollPosition) {
            this.state.consecutiveScrollNoProgress++;
            this.logger.log(
              `[📜 스크롤] 위치 변화 없음 (연속 ${this.state.consecutiveScrollNoProgress}회)`
            );
          } else {
            this.state.consecutiveScrollNoProgress = 0;
          }
          this.state.lastScrollPosition = scrollData.currentPosition;

          // 페이지 끝 도달 감지
          if (scrollData.atBottom) {
            this.logger.log("[📜 스크롤] 페이지 끝에 도달함");
          }

          // 연속 3회 스크롤해도 진전 없으면 경고
          if (this.state.consecutiveScrollNoProgress >= 3) {
            this.logger.log(
              "[⚠️ 경고] 스크롤 3회 연속 진전 없음 - 무한 스크롤 종료 또는 로딩 지연 가능성"
            );
          }
        }

        // 특별 처리: extract_jobs 결과
        if (toolName === "extract_jobs" && result.success && result.data) {
          const data = result.data as { count: number; jobs: ExtractedJob[] };
          const newJobs = data.jobs.filter(
            (j) =>
              !this.state.extractedJobs.some(
                (ej) => ej.title === j.title && ej.location === j.location
              )
          );

          if (newJobs.length > 0) {
            this.state.extractedJobs.push(...newJobs);
            this.state.consecutiveNoNewJobs = 0;
            this.logger.log(
              `[Agent] 새 직무 ${newJobs.length}개 추가 (총 ${this.state.extractedJobs.length}개)`
            );

            // Memory Block 업데이트: collected_data
            const jobSummary = this.state.extractedJobs
              .slice(-10) // 최근 10개만
              .map((j) => j.title)
              .join(", ");
            this.memoryManager = this.memoryManager.updateBlock(
              "collected_data",
              `수집된 직무: ${this.state.extractedJobs.length}개\n최근: ${jobSummary}`
            );
          } else {
            this.state.consecutiveNoNewJobs++;
            this.logger.log(
              `[Agent] 새 직무 없음 (연속 ${this.state.consecutiveNoNewJobs}회)`
            );
          }

          // 연속 실패 체크
          if (this.state.consecutiveNoNewJobs >= MAX_CONSECUTIVE_NO_NEW) {
            this.logger.log("[Agent] 연속 3회 새 직무 없음, 자동 종료");
            this.state.done = true;
          }
        }

        // 특별 처리: done
        if (toolName === "done") {
          this.state.done = true;
          this.logger.log(
            `[Agent] 완료: ${(result.data as { reason: string }).reason}`
          );
        }

        // 스텝 기록 (thought 포함)
        const stepRecord: AgentStep = {
          step,
          observation: JSON.stringify(result.data || result.error),
          thought: textBlock?.text,
          toolName,
          toolInput,
          result: result.success ? "success" : "failed",
        };
        this.state.history.push(stepRecord);

        // Memory Block 업데이트: recent_actions
        const recentActions = this.state.history
          .slice(-5) // 최근 5개만
          .map((h) => `${h.toolName}(${h.result})`)
          .join(" → ");
        this.memoryManager = this.memoryManager.updateBlock(
          "recent_actions",
          `최근 행동: ${recentActions}`
        );

        // 메모리 압축 체크
        if (this.memoryManager.needsCompression()) {
          this.logger.log(
            `[🧠 Memory] 압축 필요 (사용량: ${this.memoryManager.usagePercentage.toFixed(1)}%)`
          );
          // 우선순위 낮은 블록부터 압축 (recent_actions)
          const candidates = this.memoryManager.getCompressionCandidates();
          if (candidates.length > 0 && candidates[0]) {
            const target = candidates[0];
            // 간단히 최근 3개 행동만 유지
            const compressedActions = this.state.history
              .slice(-3)
              .map((h) => `${h.toolName}(${h.result})`)
              .join(" → ");
            this.memoryManager = this.memoryManager.compressBlock(
              target.name,
              `최근: ${compressedActions}`
            );
            this.logger.log(
              `[🧠 Memory] ${target.name} 블록 압축 완료 (사용량: ${this.memoryManager.usagePercentage.toFixed(1)}%)`
            );
          }
        }

        // 메시지에 응답 추가
        messages.push({
          role: "assistant",
          content: response.content,
        });

        // 도구 결과 추가 (실패 시 Reflexion 포함)
        let toolResultContent = JSON.stringify(result);

        if (!result.success && result.error) {
          // Reflexion 패턴: 도구 실패 시 반성 수행
          const reflection = await this.reflect(
            toolName,
            toolInput,
            result.error
          );

          // 실패 케이스 자동 기록
          const failureCase = FailureCase.create({
            timestamp: new Date(),
            url: this.page.url(),
            company: this.company,
            toolName,
            toolInput,
            error: result.error,
            pageContext: `Step ${step}, 수집된 직무: ${this.state.extractedJobs.length}개`,
            reflection: {
              analysis: reflection.analysis,
              suggestion: reflection.suggestion,
              shouldRetry: reflection.shouldRetry,
              alternativeAction: reflection.alternativeAction,
            },
          });
          await this.failureCaseStore.append(failureCase);
          this.logger.log(`[📝 실패 기록] ${toolName} 실패 케이스 저장됨`);

          // 반성 결과를 도구 결과에 추가
          toolResultContent = JSON.stringify({
            ...result,
            reflection: {
              analysis: reflection.analysis,
              suggestion: reflection.suggestion,
              shouldRetry: reflection.shouldRetry,
              alternativeAction: reflection.alternativeAction,
            },
          });
        }

        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolUseBlock.id,
              content: toolResultContent,
            },
          ],
        });
      } else if (response.stop_reason === "end_turn") {
        // 텍스트 응답만 있는 경우
        const textBlock = response.content.find(
          (block): block is Anthropic.Messages.TextBlock =>
            block.type === "text"
        );

        if (textBlock) {
          this.logger.log(
            `[Agent] 메시지: ${textBlock.text.substring(0, 200)}...`
          );
        }

        // 대화 계속
        messages.push({
          role: "assistant",
          content: response.content,
        });

        messages.push({
          role: "user",
          content: "계속해서 직무를 수집해주세요. 도구를 사용하세요.",
        });
      } else {
        this.logger.log(
          `[Agent] 예상치 못한 stop_reason: ${response.stop_reason}`
        );
        break;
      }
    }

    // 체크포인트 업데이트 및 저장
    this.checkpoint = this.checkpoint
      .addExtractedJobs(this.state.extractedJobs)
      .complete(new Date());

    // 체크포인트에 히스토리 추가
    for (const step of this.state.history) {
      this.checkpoint = this.checkpoint.addHistoryItem({
        step: step.step,
        toolName: step.toolName,
        toolInput: step.toolInput,
        result: step.result,
        thought: step.thought,
        observation: step.observation,
      });
    }

    const checkpointPath = await this.checkpointStore.save(this.checkpoint);

    // 결과 변환 및 요약 출력
    this.logger.log(`\n${"═".repeat(70)}`);
    this.logger.log(`[Agent] 크롤링 완료!`);
    this.logger.log(`${"═".repeat(70)}`);
    this.logger.log(this.checkpoint.generateSummary());
    this.logger.log(`\n체크포인트 저장: ${checkpointPath}`);
    this.logger.log(`로그 파일: ${this.logger.getLogFile()}`);
    this.logger.log(`${"═".repeat(70)}`);
    this.logger.close();

    return this.state.extractedJobs.map((job) =>
      JobPosting.create({
        id: uuidv4(),
        title: job.title,
        company: this.company,
        sourceUrl: job.detailUrl || url,
        crawledAt: new Date(),
        location: job.location,
        department: job.department,
      })
    );
  }

  /**
   * Reflexion 패턴: 도구 실행 실패 시 반성을 수행하여 대안 전략 도출
   */
  private async reflect(
    toolName: string,
    toolInput: unknown,
    error: string
  ): Promise<ReflectionResult> {
    this.logger.log(`\n[🔍 Reflection] 실패 분석 시작...`);

    // 반성 컨텍스트 생성
    const context = ReflectionContext.create({
      toolName,
      toolInput,
      error,
      history: this.state.history.map((h) => ({
        step: h.step,
        toolName: h.toolName,
        result: h.result,
        thought: h.thought,
        toolInput: h.toolInput,
        observation: h.observation,
      })),
    });

    // 반성 프롬프트 생성
    const reflectionPrompt = ReflectionPromptBuilder.build(context);

    try {
      // LLM 호출하여 반성 수행
      const response = await this.client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: `당신은 웹 크롤링 전문가입니다. 도구 실행 실패를 분석하고 대안 전략을 제시해주세요.
반드시 JSON 형식으로만 응답하세요.`,
        messages: [{ role: "user", content: reflectionPrompt }],
      });

      // 응답 파싱
      const textBlock = response.content.find(
        (block): block is Anthropic.Messages.TextBlock => block.type === "text"
      );

      if (!textBlock) {
        throw new Error("반성 응답에 텍스트가 없습니다");
      }

      // JSON 추출 (코드블록 내부 또는 전체 텍스트)
      let jsonStr = textBlock.text;
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch && jsonMatch[1]) {
        jsonStr = jsonMatch[1].trim();
      }

      const parsed = JSON.parse(jsonStr);

      const result = ReflectionResult.create({
        analysis: parsed.analysis || "분석 실패",
        suggestion: parsed.suggestion || "기본 재시도",
        shouldRetry: parsed.shouldRetry ?? true,
        alternativeAction: parsed.alternativeAction,
      });

      this.logger.log(`[🔍 Reflection] 분석 완료`);
      this.logger.log(`  - 원인: ${result.analysis}`);
      this.logger.log(`  - 제안: ${result.suggestion}`);
      this.logger.log(`  - 재시도: ${result.shouldRetry ? "예" : "아니오"}`);
      if (result.alternativeAction) {
        this.logger.log(`  - 대안 도구: ${result.alternativeAction.toolName}`);
      }

      return result;
    } catch (parseError) {
      this.logger.log(`[🔍 Reflection] 파싱 실패: ${parseError}`);

      // 파싱 실패 시 기본 결과 반환
      return ReflectionResult.create({
        analysis: `${toolName} 도구 실행 실패: ${error}`,
        suggestion: "다른 셀렉터나 방법을 시도하세요",
        shouldRetry: true,
      });
    }
  }

  /**
   * 체크포인트에서 세션 재개
   */
  async resume(checkpointPath: string): Promise<JobPosting[]> {
    const checkpoint = await this.checkpointStore.load(checkpointPath);

    if (!checkpoint) {
      throw new Error(`체크포인트를 찾을 수 없습니다: ${checkpointPath}`);
    }

    if (!checkpoint.canResume()) {
      throw new Error(
        `이 체크포인트는 재개할 수 없습니다. 상태: ${checkpoint.status}`
      );
    }

    this.logger.log(`[Agent] 체크포인트에서 재개: ${checkpointPath}`);
    this.logger.log(`[Agent] 이전 세션 ID: ${checkpoint.sessionId}`);
    this.logger.log(
      `[Agent] 이전에 수집된 직무: ${checkpoint.extractedJobs.length}개`
    );

    if (checkpoint.resumeHint) {
      this.logger.log(`[Agent] 재개 힌트: ${checkpoint.resumeHint}`);
    }

    // 이전 상태 복원
    this.state.extractedJobs = checkpoint.extractedJobs.map((j) => ({
      title: j.title,
      location: j.location,
      department: j.department,
      detailUrl: j.detailUrl,
    }));

    // 새 세션으로 시작하되, 이전 직무는 유지
    return this.run(checkpoint.url);
  }

  /**
   * 회사명으로 최신 체크포인트 찾아서 재개
   */
  async resumeByCompany(): Promise<JobPosting[] | null> {
    const checkpoint = await this.checkpointStore.findLatestByCompany(
      this.company
    );

    if (!checkpoint || !checkpoint.canResume()) {
      this.logger.log(`[Agent] 재개 가능한 체크포인트가 없습니다.`);
      return null;
    }

    this.logger.log(`[Agent] 최신 체크포인트 발견: ${checkpoint.sessionId}`);
    return this.resume(
      `.cache/checkpoints/${this.company
        .toLowerCase()
        .replace(/[^a-z0-9가-힣]/g, "_")}_${checkpoint.sessionId}.json`
    );
  }

  /**
   * 현재 체크포인트 반환
   */
  getCheckpoint(): AgentCheckpoint {
    return this.checkpoint;
  }

  // 상태 반환 (디버깅용)
  getState(): AgentState {
    return { ...this.state };
  }
}
