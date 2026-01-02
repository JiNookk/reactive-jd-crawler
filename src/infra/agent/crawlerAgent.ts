// ReAct 패턴 기반 크롤러 Agent
import Anthropic from '@anthropic-ai/sdk';
import { Page } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { agentTools } from './tools.js';
import { ToolExecutor, ExtractedJob, PageInfo } from './toolExecutor.js';
import { JobPosting } from '../../domain/jobPosting.domain.js';

// 로거 클래스 - 콘솔과 파일 동시 출력
class AgentLogger {
  private logFile: string;
  private stream: fs.WriteStream;

  constructor(company: string) {
    const logDir = 'output/logs';
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logFile = path.join(logDir, `agent_${company}_${timestamp}.log`);
    this.stream = fs.createWriteStream(this.logFile, { flags: 'a' });

    this.log(`\n${'═'.repeat(70)}`);
    this.log(`Agent 로그 시작: ${new Date().toISOString()}`);
    this.log(`회사: ${company}`);
    this.log(`${'═'.repeat(70)}\n`);
  }

  log(message: string): void {
    console.log(message);
    this.stream.write(message + '\n');
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

const SYSTEM_PROMPT = `당신은 채용 사이트에서 직무 공고를 수집하는 크롤러 에이전트입니다.

## 목표
주어진 채용 사이트에서 모든 직무 공고 정보를 수집합니다.

## 사용 가능한 도구
- get_page_info: 현재 페이지 상태 확인 (먼저 이것으로 상황 파악)
- navigate: URL로 직접 이동 (잘못된 페이지로 이동했을 때 원래 URL로 복귀)
- click: 요소 클릭 (버튼, 링크, 탭 등)
- scroll: 페이지 스크롤 (무한 스크롤 대응)
- input_text: 검색/필터 입력
- wait: 로딩 대기
- extract_jobs: 직무 목록 추출
- extract_job_detail: 상세 정보 추출
- done: 작업 완료

## 작업 전략
1. 먼저 get_page_info로 페이지 상태를 파악하세요
2. 직무 카드가 보이면 extract_jobs로 추출하세요
3. 페이지네이션이 있으면 다음 페이지로 이동하세요
4. 무한 스크롤이면 scroll로 더 로드하세요
5. 필터가 결과를 제한하고 있다면 필터를 해제하세요
6. 더 이상 새 직무가 없으면 done을 호출하세요

## 완료 조건
- 모든 페이지를 순회했을 때
- 연속으로 3번 새 직무가 없을 때
- 더 이상 다음 페이지가 없을 때

## 주의사항
- 셀렉터를 추측할 때는 get_page_info 결과를 참고하세요
- 실패하면 다른 셀렉터나 방법을 시도하세요
- 무한 루프에 빠지지 않도록 주의하세요

## 모달/팝업 처리 주의사항
- 언어/지역 선택 모달이 나타나면 주의하세요
- "dark-bg" 클래스 버튼은 주로 언어 변경(예: 한국어 선택)입니다 - 클릭하면 다른 지역 사이트로 리다이렉트됩니다
- "Continue", "Close", "X" 버튼이나 모달 외부를 클릭해서 모달을 닫으세요
- 만약 잘못된 페이지로 이동했다면, navigate로 원래 URL로 돌아가세요
- 같은 실수를 반복하지 마세요 - 이전에 한국어 페이지로 리다이렉트됐다면 다른 방법을 시도하세요`;

export class CrawlerAgent {
  private client: Anthropic;
  private toolExecutor: ToolExecutor;
  private state: AgentState;
  private logger: AgentLogger;

  constructor(
    private page: Page,
    private company: string,
    apiKey?: string
  ) {
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.toolExecutor = new ToolExecutor(page, company);
    this.logger = new AgentLogger(company);
    this.state = {
      url: '',
      company,
      goal: '모든 직무 공고 수집',
      history: [],
      extractedJobs: [],
      done: false,
      consecutiveNoNewJobs: 0,
    };
  }

  async run(url: string): Promise<JobPosting[]> {
    this.state.url = url;

    // 페이지 로드
    this.logger.log(`[Agent] 페이지 로드 중: ${url}`);
    await this.page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await this.page.waitForTimeout(3000);

    // 대화 메시지 초기화
    const messages: Anthropic.Messages.MessageParam[] = [
      {
        role: 'user',
        content: `채용 사이트 크롤링을 시작합니다.

URL: ${url}
회사명: ${this.company}
목표: 이 사이트의 모든 직무 공고를 수집해주세요.

먼저 get_page_info로 현재 페이지 상태를 확인해주세요.`,
      },
    ];

    // ReAct 루프
    for (let step = 1; step <= MAX_STEPS && !this.state.done; step++) {
      this.logger.log(`\n${'═'.repeat(70)}`);
      this.logger.log(`[Agent] Step ${step}/${MAX_STEPS}`);
      this.logger.log(`${'═'.repeat(70)}`);

      // LLM 호출
      const response = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: agentTools,
        messages,
      });

      // 응답 처리
      if (response.stop_reason === 'tool_use') {
        // 사고 과정 (Thought) 출력 - 텍스트 블록이 있으면 출력
        const textBlock = response.content.find(
          (block): block is Anthropic.Messages.TextBlock => block.type === 'text'
        );
        if (textBlock) {
          this.logger.log(`\n[🧠 Thought]`);
          this.logger.log(`${'-'.repeat(50)}`);
          this.logger.log(textBlock.text);
          this.logger.log(`${'-'.repeat(50)}`);
        }

        // 도구 사용 요청
        const toolUseBlock = response.content.find(
          (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use'
        );

        if (!toolUseBlock) {
          this.logger.log('[Agent] 도구 사용 블록을 찾을 수 없음');
          break;
        }

        const toolName = toolUseBlock.name;
        const toolInput = toolUseBlock.input;

        this.logger.log(`\n[🔧 Action] ${toolName}`);
        this.logger.log(`[📥 Input] ${JSON.stringify(toolInput, null, 2)}`);

        // 도구 실행
        const result = await this.toolExecutor.execute(toolName, toolInput);

        this.logger.log(`\n[📤 Observation] ${result.success ? '✅ 성공' : '❌ 실패'}`);
        if (result.error) {
          this.logger.log(`[Error] ${result.error}`);
        }
        if (result.data) {
          // 데이터가 너무 길면 요약
          const dataStr = JSON.stringify(result.data, null, 2);
          if (dataStr.length > 1000) {
            this.logger.log(`[Data] (길이: ${dataStr.length}자, 요약 출력)`);
            // PageInfo인 경우 주요 정보만 출력
            if (toolName === 'get_page_info') {
              const info = result.data as PageInfo;
              this.logger.log(`  - URL: ${info.url}`);
              this.logger.log(`  - Title: ${info.title}`);
              this.logger.log(`  - 셀렉터 후보: ${info.selectorCandidates.length}개`);
              this.logger.log(`  - 직무 링크: ${info.jobLinks.length}개`);
              this.logger.log(`  - 버튼: ${info.visibleButtons.length}개`);
              this.logger.log(`  - 페이지네이션: ${info.paginationInfo || '없음'}`);
              this.logger.log(`  - 결과 수: ${info.resultCount || '표시 없음'}`);
              if (info.jobLinks.length > 0) {
                this.logger.log(`  - 직무 링크 샘플:`);
                info.jobLinks.slice(0, 3).forEach((link, i) => {
                  this.logger.log(`    ${i + 1}. ${link.text.substring(0, 50)}`);
                });
              }
            } else {
              this.logger.log(dataStr.substring(0, 500) + '...');
            }
          } else {
            this.logger.log(`[Data] ${dataStr}`);
          }
        }

        // 특별 처리: extract_jobs 결과
        if (toolName === 'extract_jobs' && result.success && result.data) {
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
          } else {
            this.state.consecutiveNoNewJobs++;
            this.logger.log(
              `[Agent] 새 직무 없음 (연속 ${this.state.consecutiveNoNewJobs}회)`
            );
          }

          // 연속 실패 체크
          if (this.state.consecutiveNoNewJobs >= MAX_CONSECUTIVE_NO_NEW) {
            this.logger.log('[Agent] 연속 3회 새 직무 없음, 자동 종료');
            this.state.done = true;
          }
        }

        // 특별 처리: done
        if (toolName === 'done') {
          this.state.done = true;
          this.logger.log(`[Agent] 완료: ${(result.data as { reason: string }).reason}`);
        }

        // 스텝 기록 (thought 포함)
        const stepRecord: AgentStep = {
          step,
          observation: JSON.stringify(result.data || result.error),
          thought: textBlock?.text,
          toolName,
          toolInput,
          result: result.success ? 'success' : 'failed',
        };
        this.state.history.push(stepRecord);

        // 메시지에 응답 추가
        messages.push({
          role: 'assistant',
          content: response.content,
        });

        // 도구 결과 추가
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolUseBlock.id,
              content: JSON.stringify(result),
            },
          ],
        });
      } else if (response.stop_reason === 'end_turn') {
        // 텍스트 응답만 있는 경우
        const textBlock = response.content.find(
          (block): block is Anthropic.Messages.TextBlock => block.type === 'text'
        );

        if (textBlock) {
          this.logger.log(`[Agent] 메시지: ${textBlock.text.substring(0, 200)}...`);
        }

        // 대화 계속
        messages.push({
          role: 'assistant',
          content: response.content,
        });

        messages.push({
          role: 'user',
          content: '계속해서 직무를 수집해주세요. 도구를 사용하세요.',
        });
      } else {
        this.logger.log(`[Agent] 예상치 못한 stop_reason: ${response.stop_reason}`);
        break;
      }
    }

    // 결과 변환
    this.logger.log(`\n${'═'.repeat(70)}`);
    this.logger.log(`[Agent] 크롤링 완료. 총 ${this.state.extractedJobs.length}개 직무 수집`);
    this.logger.log(`[Agent] 로그 파일: ${this.logger.getLogFile()}`);
    this.logger.log(`${'═'.repeat(70)}`);
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

  // 상태 반환 (디버깅용)
  getState(): AgentState {
    return { ...this.state };
  }
}
