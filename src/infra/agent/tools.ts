// Agent가 사용할 도구 정의 (Anthropic Tool Use 형식)
// 각 도구의 description에 사용 시점, 예시, 주의사항을 포함 (Few-shot 통합)
import type { Tool } from '@anthropic-ai/sdk/resources/messages.js';

export const agentTools: Tool[] = [
  // 탐색 도구들
  {
    name: 'navigate',
    description: `지정한 URL로 페이지를 이동합니다.

**사용 시점**:
- 특정 페이지로 직접 이동할 때
- 잘못된 페이지에서 원래 URL로 복귀할 때
- URL 파라미터로 페이지네이션할 때 (예: ?page=2)

**예시**:
- 원티드 백엔드 목록: {"url": "https://www.wanted.co.kr/wdlist/518/872"}
- 페이지네이션: {"url": "https://saramin.co.kr/jobs?page=2"}
- 필터 적용: {"url": "https://example.com/jobs?location=seoul"}

**주의**:
- 404 발생 시 URL을 확인하고 다른 URL로 시도
- 네트워크 오류 시 wait 후 재시도`,
    input_schema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: '이동할 URL',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'click',
    description: `CSS 셀렉터로 지정한 요소를 클릭합니다.

**사용 시점**:
- 버튼, 링크, 탭 클릭
- 페이지네이션 다음 버튼 클릭
- 필터/드롭다운 선택
- 모달 닫기 버튼 클릭

**예시**:
- 다음 페이지 버튼: {"selector": "button.next-page"}
- 링크 클릭: {"selector": "a[href*='/jobs/']"}
- aria-label 활용: {"selector": "button[aria-label='다음']"}
- 모달 닫기: {"selector": ".modal-close, button.close, [aria-label='Close']"}

**주의**:
- 요소가 보이지 않으면 먼저 scroll로 화면에 보이게 이동
- 클릭 실패 시 다른 셀렉터로 재시도 (예: .next → [class*="next"] → button:has-text("다음"))
- 동적 로딩 후에는 wait으로 대기`,
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: {
          type: 'string',
          description: '클릭할 요소의 CSS 셀렉터',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'scroll',
    description: `페이지를 스크롤합니다.

**사용 시점**:
- 무한 스크롤 페이지에서 더 많은 콘텐츠 로드
- 보이지 않는 요소로 이동
- 페이지 끝 확인 (atBottom 체크)

**예시**:
- 아래로 스크롤: {"direction": "down", "amount": 800}
- 위로 스크롤: {"direction": "up", "amount": 500}
- 기본 스크롤 (down 500px): {}

**주의**:
- 스크롤 후 반드시 wait으로 1-2초 대기 (콘텐츠 로딩 필요)
- 결과의 atBottom: true이면 페이지 끝
- 연속 3회 스크롤해도 새 직무가 없으면 종료`,
    input_schema: {
      type: 'object' as const,
      properties: {
        direction: {
          type: 'string',
          enum: ['down', 'up'],
          description: '스크롤 방향 (기본: down)',
        },
        amount: {
          type: 'number',
          description: '스크롤할 픽셀 수 (기본: 500)',
        },
      },
    },
  },
  {
    name: 'input_text',
    description: `입력 필드에 텍스트를 입력합니다.

**사용 시점**:
- 검색창에 키워드 입력
- 필터 조건 입력
- 로그인 정보 입력

**예시**:
- 검색: {"selector": "input[type='search']", "text": "backend developer"}
- 필터: {"selector": "#location-filter", "text": "Seoul"}

**주의**:
- 입력 후 Enter 키가 필요하면 별도 click으로 검색 버튼 클릭
- 기존 텍스트가 있을 수 있으니 입력 전 클리어 고려`,
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: {
          type: 'string',
          description: '입력 필드의 CSS 셀렉터',
        },
        text: {
          type: 'string',
          description: '입력할 텍스트',
        },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: 'wait',
    description: `지정한 시간만큼 대기합니다.

**사용 시점**:
- 동적 콘텐츠 로딩 대기
- 스크롤 후 새 콘텐츠 로딩 대기
- 클릭 후 페이지 전환 대기

**예시**:
- 짧은 대기: {"ms": 1000}
- 긴 대기 (무거운 페이지): {"ms": 3000}
- 기본 대기 (1초): {}

**주의**:
- 너무 짧으면 로딩 완료 전 다음 액션 실행
- 너무 길면 시간 낭비
- 일반적으로 1-2초면 충분`,
    input_schema: {
      type: 'object' as const,
      properties: {
        ms: {
          type: 'number',
          description: '대기 시간 (밀리초, 기본: 1000)',
        },
      },
    },
  },

  // 정보 수집 도구들
  {
    name: 'get_page_info',
    description: `현재 페이지의 상태를 수집합니다.

**사용 시점**:
- 작업 시작 시 상황 파악 (항상 먼저 호출)
- 클릭/스크롤 후 페이지 변화 확인
- 에러 발생 시 현재 상태 재확인

**예시**:
- 상황 파악: {} (입력 없음)

**반환 정보**:
- url: 현재 URL
- title: 페이지 제목
- visibleElements: 보이는 주요 요소들
- pageInfo: 페이지 구조 요약

**주의**:
- 작업 시작 시 반드시 먼저 호출
- 막히면 get_page_info로 상황 재파악`,
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'extract_jobs',
    description: `현재 페이지에서 직무 목록을 추출합니다.

**사용 시점**:
- 직무 카드들이 보이는 상태에서 호출
- get_page_info 결과에서 직무 카드 셀렉터 파악 후 사용

**예시**:
- 일반적인 카드: {"jobCardSelector": ".job-card"}
- 리스트 아이템: {"jobCardSelector": "li.job-item"}
- 범용 셀렉터: {"jobCardSelector": "[class*='job']"}
- article 태그: {"jobCardSelector": "article"}

**주의**:
- 셀렉터가 맞지 않으면 빈 배열 반환
- 실패 시 더 일반적인 셀렉터로 재시도
- 추출 후 중복 제거는 자동 처리됨`,
    input_schema: {
      type: 'object' as const,
      properties: {
        jobCardSelector: {
          type: 'string',
          description: '직무 카드(개별 직무 항목)의 CSS 셀렉터',
        },
      },
      required: ['jobCardSelector'],
    },
  },
  {
    name: 'extract_job_detail',
    description: `현재 보이는 직무 상세 정보를 추출합니다.

**사용 시점**:
- 모달이 열렸을 때
- 상세 페이지로 이동한 후
- 직무 카드 클릭 후 상세 정보가 표시될 때

**예시**:
- 모달 내 상세: {"containerSelector": ".job-modal"}
- 상세 페이지: {"containerSelector": ".job-detail"}
- 전체 페이지에서 추출: {} (containerSelector 생략)

**주의**:
- 상세 정보가 로드될 때까지 wait 후 호출
- containerSelector 없으면 페이지 전체에서 추출 시도`,
    input_schema: {
      type: 'object' as const,
      properties: {
        containerSelector: {
          type: 'string',
          description: '상세 정보가 담긴 컨테이너의 CSS 셀렉터 (선택사항)',
        },
      },
    },
  },

  // 완료 도구
  {
    name: 'done',
    description: `목표 달성 완료 시 호출합니다.

**사용 시점**:
- 모든 페이지를 순회했을 때
- 더 이상 수집할 직무가 없을 때
- 연속 3회 새 직무가 없을 때
- 무한 스크롤에서 페이지 끝에 도달했을 때 (atBottom: true)

**예시**:
- 정상 완료: {"reason": "모든 페이지 순회 완료, 총 150개 직무 수집"}
- 더 이상 없음: {"reason": "연속 3회 새 직무 없음, 페이지 끝 도달"}
- 에러로 인한 종료: {"reason": "페이지 접근 불가, 50개 직무까지 수집"}

**주의**:
- 조기 종료하지 말고 가능한 모든 직무 수집 후 호출
- reason에 수집 현황 포함하면 추적에 도움`,
    input_schema: {
      type: 'object' as const,
      properties: {
        reason: {
          type: 'string',
          description: '완료 이유 (예: "모든 페이지 순회 완료", "더 이상 새 직무 없음")',
        },
      },
      required: ['reason'],
    },
  },
];

// 도구 실행 결과 타입
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// 도구 입력 타입들
export interface NavigateInput {
  url: string;
}

export interface ClickInput {
  selector: string;
}

export interface ScrollInput {
  direction?: 'down' | 'up';
  amount?: number;
}

export interface InputTextInput {
  selector: string;
  text: string;
}

export interface WaitInput {
  ms?: number;
}

export interface ExtractJobsInput {
  jobCardSelector: string;
}

export interface ExtractJobDetailInput {
  containerSelector?: string;
}

export interface DoneInput {
  reason: string;
}

export type ToolInput =
  | NavigateInput
  | ClickInput
  | ScrollInput
  | InputTextInput
  | WaitInput
  | ExtractJobsInput
  | ExtractJobDetailInput
  | DoneInput
  | Record<string, never>; // get_page_info는 입력 없음
