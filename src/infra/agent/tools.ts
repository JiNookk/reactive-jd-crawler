// Agent가 사용할 도구 정의 (Anthropic Tool Use 형식)
import type { Tool } from '@anthropic-ai/sdk/resources/messages.js';

export const agentTools: Tool[] = [
  // 탐색 도구들
  {
    name: 'navigate',
    description:
      '지정한 URL로 페이지를 이동합니다. 잘못된 페이지로 이동했거나, 다른 페이지로 이동해야 할 때 사용합니다.',
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
    description: 'CSS 셀렉터로 지정한 요소를 클릭합니다. 버튼, 링크, 탭 등을 클릭할 때 사용합니다.',
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
    description:
      '페이지를 스크롤합니다. 무한 스크롤 페이지에서 더 많은 콘텐츠를 로드하거나, 보이지 않는 요소로 이동할 때 사용합니다.',
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
    description: '입력 필드에 텍스트를 입력합니다. 검색창이나 필터 입력에 사용합니다.',
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
    description:
      '지정한 시간만큼 대기합니다. 동적 로딩이 완료되기를 기다릴 때 사용합니다.',
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
    description:
      '현재 페이지의 상태를 수집합니다. URL, 제목, 보이는 주요 요소들의 정보를 반환합니다. 상황 파악이 필요할 때 사용하세요.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'extract_jobs',
    description:
      '현재 페이지에서 직무 목록을 추출합니다. 직무 카드들이 보이는 상태에서 호출하세요.',
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
    description:
      '현재 보이는 직무 상세 정보를 추출합니다. 모달이 열렸거나 상세 페이지로 이동한 후 사용합니다.',
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
    description:
      '목표 달성 완료 시 호출합니다. 더 이상 수집할 직무가 없거나, 모든 페이지를 순회했을 때 사용합니다.',
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
