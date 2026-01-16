# LLM Agent Job Crawler

**LLM 기반 자율 에이전트로 어떤 채용 사이트든 크롤링합니다.**

기존 크롤러의 한계(사이트마다 셀렉터 하드코딩, 구조 변경 시 즉시 실패)를 해결하기 위해,
Claude API를 활용한 **자율 추론 에이전트**가 페이지 구조를 스스로 분석하고 데이터를 추출합니다.

## 핵심 아이디어

```
기존 크롤러:  URL → 하드코딩된 셀렉터 → 데이터 추출 (사이트 변경 시 실패)
이 크롤러:    URL → LLM이 구조 분석 → 셀렉터 자동 추출 → 데이터 추출 (적응형)
```

## 주요 기능

### 1. ReAct 패턴 기반 자율 에이전트
에이전트가 **Thought → Action → Observation** 사이클을 반복하며 크롤링을 수행합니다.
```
[Thought] 페이지에 무한 스크롤이 있는 것 같다. 스크롤해서 더 많은 공고를 로드해보자.
[Action]  scroll({ direction: "down" })
[Observation] 새로운 직무 카드 15개 로드됨
```

### 2. Reflexion 패턴 - 실패에서 학습
도구 실행이 실패하면 **자기 반성(Self-Reflection)**을 통해 원인을 분석하고 대안 전략을 도출합니다.
```typescript
// 실패 시 자동으로 반성 수행
const reflection = await this.reflect(toolName, toolInput, error);
// → { analysis: "셀렉터가 변경됨", suggestion: "다른 셀렉터 시도", shouldRetry: true }
```

### 3. Memory Blocks - 효율적인 컨텍스트 관리
MemGPT/Letta 방식의 메모리 블록으로 컨텍스트 윈도우를 효율적으로 관리합니다.
- **persona**: 에이전트 정체성 (압축 불가)
- **current_task**: 현재 작업 정보
- **collected_data**: 수집된 데이터 요약
- **recent_actions**: 최근 행동 기록 (필요시 압축)

### 4. 체크포인트 기반 재개
크롤링 중단 시 체크포인트에서 이어서 진행할 수 있습니다.
```bash
# 이전 세션 재개
pnpm crawl --resume <checkpoint-path>
```

### 5. 다양한 페이지네이션 자동 처리
- 버튼 클릭 방식
- 무한 스크롤
- URL 파라미터 방식

## 아키텍처

```
src/
├── domain/           # 도메인 모델 (DDD)
│   ├── jobPosting.domain.ts      # 채용 공고 값 객체
│   ├── pageStructure.domain.ts   # 페이지 구조 분석 결과
│   ├── checkpoint.domain.ts      # 세션 체크포인트
│   ├── reflection.domain.ts      # Reflexion 패턴
│   ├── memoryBlock.domain.ts     # Memory Blocks 패턴
│   └── failureCase.domain.ts     # 실패 케이스 기록
│
├── infra/            # 인프라 레이어
│   ├── agent/                    # ReAct 에이전트
│   │   ├── crawlerAgent.ts       # 메인 에이전트 로직
│   │   ├── tools.ts              # 에이전트 도구 정의
│   │   └── toolExecutor.ts       # 도구 실행기
│   ├── llm/
│   │   └── pageAnalyzer.ts       # LLM 기반 페이지 구조 분석
│   ├── browser/
│   │   └── pageFetcher.ts        # Playwright 브라우저 제어
│   └── cache/                    # 캐시 레이어
│
├── app/              # 애플리케이션 레이어
│   └── services/
│       └── crawlerOrchestrator.ts  # 크롤링 프로세스 조율
│
└── cli/              # CLI 인터페이스
```

## 기술 스택

| 영역 | 기술 |
|------|------|
| Language | TypeScript |
| LLM | Anthropic Claude API (Haiku/Sonnet) |
| Browser Automation | Playwright |
| Architecture | Domain-Driven Design |
| Agent Pattern | ReAct + Reflexion + Memory Blocks |

## 설치 및 실행

```bash
# 의존성 설치
pnpm install

# 환경 변수 설정
export ANTHROPIC_API_KEY=your_api_key

# 단일 URL 크롤링
pnpm crawl <url>

# 배치 크롤링 (CSV 파일)
pnpm batch <input.csv>

# 캐시 통계 확인
pnpm cache:stats
```

## 에이전트 도구

| 도구 | 설명 |
|------|------|
| `get_page_info` | 현재 페이지 상태 분석 |
| `extract_jobs` | 직무 정보 추출 |
| `scroll` | 페이지 스크롤 |
| `click` | 요소 클릭 |
| `navigate` | URL 이동 |
| `done` | 크롤링 완료 |

## 설계 철학

### 왜 LLM 에이전트인가?

1. **적응성**: 사이트 구조가 변경되어도 LLM이 새로운 구조를 이해하고 적응
2. **범용성**: 하나의 코드로 다양한 채용 사이트 크롤링 가능
3. **자가 복구**: 실패 시 Reflexion 패턴으로 스스로 문제를 분석하고 해결

### 왜 DDD인가?

도메인 로직(채용 공고, 페이지 구조, 체크포인트)을 명확하게 분리하여:
- 비즈니스 규칙이 도메인 객체에 캡슐화
- 인프라 변경(다른 LLM, 다른 브라우저)에 도메인이 영향받지 않음
- 풍부한 도메인 모델로 코드 가독성 향상

## 향후 계획

- [ ] 회사 평점 정보 통합 (블라인드, 잡플래닛)
- [ ] 멀티 에이전트 병렬 크롤링
- [ ] 결과 내보내기 (JSON, CSV)

## License

MIT
