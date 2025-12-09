# JD Crawler 기술 명세서

## 1. 프로젝트 개요

다양한 채용 사이트에서 직무(Job Description) 데이터를 자동으로 수집하는 범용 크롤러.
URL을 입력하면 페이지 구조를 분석하여 직무 목록을 추출한다.

## 2. 기술 스택

| 구분            | 기술       | 버전                     | 비고               |
| --------------- | ---------- | ------------------------ | ------------------ |
| Runtime         | Node.js    | >= 20.x                  | LTS                |
| Language        | TypeScript | 5.x                      | strict mode        |
| 브라우저 자동화 | Playwright | 최신                     | 동적 페이지 렌더링 |
| LLM             | Claude API | claude-sonnet-4-5-20250929 | 페이지 구조 분석   |
| 테스트          | Vitest     | 최신                     | -                  |
| 패키지 매니저   | pnpm       | 최신                     | -                  |

## 3. 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                      CLI / Entry Point                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Crawler Orchestrator                      │
│  - URL 입력 받아 크롤링 프로세스 조율                          │
│  - 결과 수집 및 출력                                          │
└─────────────────────────────────────────────────────────────┘
                              │
    ┌─────────────────────────┼─────────────────────────┐
    ▼                         ▼                         ▼
┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ Page Fetcher │    │  Structure Cache │    │  Data Extractor  │
│ (Playwright) │    │  (구조 캐싱)      │    │  (데이터 추출)    │
└──────────────┘    └──────────────────┘    └──────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
              캐시 있음?            캐시 없음
                    │                   │
                    ▼                   ▼
            저장된 셀렉터        ┌──────────────┐
            로 바로 추출        │ Page Analyzer │
                               │ (LLM 분석)    │
                               └──────────────┘
                                      │
                                      ▼
                               구조 분석 후
                               캐시에 저장
```

### 3.1 핵심 컴포넌트

1. **Page Fetcher**: Playwright로 페이지 로드, JavaScript 렌더링 대기
2. **Structure Cache**: 사이트별 페이지 구조(셀렉터) 캐싱 관리
3. **Page Analyzer**: LLM을 사용해 페이지 구조 분석 (캐시 미스 시에만 호출)
4. **Data Extractor**: 캐시된 구조 기반으로 데이터 추출
5. **Pagination Handler**: 페이지네이션 감지 및 순회

### 3.2 적응형 크롤링 흐름

```
1. URL 입력 (예: jobs.booking.com/booking/jobs)
        │
        ▼
2. Page Fetcher: Playwright로 페이지 로드
        │
        ▼
3. Structure Cache 확인
   ├─ 캐시 있음 + 유효함 → 5번으로 점프
   └─ 캐시 없음 or 만료 → 4번으로
        │
        ▼
4. Page Analyzer (LLM 호출)
   - 페이지 유형 판단 (목록/상세)
   - URL 패턴 추출 (예: /booking/jobs/:id)
   - 데이터 셀렉터 파악
   - 페이지네이션 방식 감지
   → 결과를 Structure Cache에 저장
        │
        ▼
5. Data Extractor: 셀렉터로 데이터 추출
   ├─ 성공 → 결과 반환
   └─ 실패 → 4번으로 (구조 변경 감지, LLM 재분석)
        │
        ▼
6. 페이지네이션 처리 → 다음 페이지 반복
```

### 3.3 구조 캐싱 전략

**캐시 키**: URL 패턴 (쿼리 파라미터 제외, 동적 부분은 LLM이 패턴화)

- `jobs.booking.com/booking/jobs` → 목록 페이지
- `jobs.booking.com/booking/jobs/:id` → 상세 페이지

**캐시 만료**: 7일

**재분석 트리거**:

- 캐시 만료 (7일 경과)
- 셀렉터로 추출 실패 (사이트 구조 변경 감지)

**캐시 저장 형식**:

```json
{
  "jobs.booking.com/booking/jobs": {
    "pageType": "list",
    "urlPattern": "/booking/jobs",
    "selectors": {
      "jobList": ".job-card",
      "title": ".job-title",
      "location": ".job-location",
      "department": ".job-department",
      "detailLink": ".job-card a"
    },
    "pagination": {
      "type": "button",
      "nextSelector": ".pagination-next"
    },
    "analyzedAt": "2025-01-15T10:00:00Z",
    "expiresAt": "2025-01-22T10:00:00Z"
  },
  "jobs.booking.com/booking/jobs/:id": {
    "pageType": "detail",
    "urlPattern": "/booking/jobs/:id",
    "selectors": {
      "title": "h1.job-title",
      "description": ".job-description",
      "requirements": ".requirements-list li",
      "responsibilities": ".responsibilities-list li"
    },
    "analyzedAt": "2025-01-15T10:05:00Z",
    "expiresAt": "2025-01-22T10:05:00Z"
  }
}
```

### 3.4 LLM 분석 시 요청 내용

첫 방문 시 LLM에게 물어볼 것:

1. **페이지 유형**: 목록 페이지인지, 상세 페이지인지
2. **URL 패턴**: 동적 부분을 `:id`, `:slug` 등으로 패턴화
3. **데이터 셀렉터**: 각 필드를 추출할 CSS 셀렉터
4. **페이지네이션 방식**: 버튼 클릭, 무한 스크롤, URL 파라미터 등

## 4. 도메인 모델

### 4.1 핵심 엔티티

```typescript
// 크롤링 대상 사이트
interface CrawlTarget {
  url: string;
  companyName: string;
}

// 추출된 직무 정보
interface JobPosting {
  id: string; // 내부 생성 ID
  externalId?: string; // 원본 사이트의 ID
  title: string; // 직무명
  company: string; // 회사명
  location?: string; // 근무지
  department?: string; // 부서/팀
  employmentType?: string; // 고용 형태 (정규직, 계약직 등)
  experienceLevel?: string; // 경력 요구사항
  salary?: string; // 급여 정보
  description?: string; // 직무 설명
  requirements?: string[]; // 자격 요건
  responsibilities?: string[]; // 담당 업무
  benefits?: string[]; // 복리후생
  postedDate?: string; // 게시일
  closingDate?: string; // 마감일
  sourceUrl: string; // 원본 URL
  crawledAt: string; // 크롤링 시각 (ISO 8601)
}

// 크롤링 결과
interface CrawlResult {
  target: CrawlTarget;
  jobs: JobPosting[];
  totalCount: number;
  crawledAt: string;
  errors?: string[];
}
```

### 4.2 페이지 구조 캐싱 타입

```typescript
// 페이지 유형
type PageType = "list" | "detail";

// 페이지네이션 유형
type PaginationType = "button" | "infinite-scroll" | "url-param" | "none";

// 페이지네이션 설정
interface PaginationConfig {
  type: PaginationType;
  nextSelector?: string; // 다음 버튼 셀렉터 (button 타입)
  scrollContainer?: string; // 스크롤 컨테이너 (infinite-scroll 타입)
  paramName?: string; // 페이지 파라미터명 (url-param 타입, 예: "page")
  paramStart?: number; // 시작 값 (기본: 1)
}

// 목록 페이지 셀렉터
interface ListPageSelectors {
  jobList: string; // 직무 목록 컨테이너
  jobItem: string; // 개별 직무 항목
  title?: string; // 직무명
  location?: string; // 근무지
  department?: string; // 부서
  detailLink?: string; // 상세 페이지 링크
  // ... 기타 목록에서 추출 가능한 필드
}

// 상세 페이지 셀렉터
interface DetailPageSelectors {
  title?: string;
  location?: string;
  department?: string;
  description?: string;
  requirements?: string;
  responsibilities?: string;
  salary?: string;
  employmentType?: string;
  experienceLevel?: string;
  postedDate?: string;
  closingDate?: string;
  // ... 기타 상세 페이지 필드
}

// 페이지 구조 정의
interface PageStructure {
  pageType: PageType;
  urlPattern: string; // LLM이 분석한 URL 패턴 (예: /jobs/:id)
  selectors: ListPageSelectors | DetailPageSelectors;
  pagination?: PaginationConfig; // 목록 페이지만 해당
  analyzedAt: string; // ISO 8601
  expiresAt: string; // ISO 8601 (analyzedAt + 7일)
}

// 구조 캐시 전체
interface StructureCache {
  [cacheKey: string]: PageStructure; // 캐시 키: "도메인/경로" 또는 "도메인/경로/:id"
}
```

## 5. 지원 대상 사이트 (Phase 1)

| 사이트               | URL 패턴               | 특징                  |
| -------------------- | ---------------------- | --------------------- |
| Booking.com Careers  | jobs.booking.com       | SPA, 동적 로딩        |
| Indeed (기업 페이지) | indeed.com/cmp/\*/jobs | 로그인 필요할 수 있음 |
| Tencent Careers      | careers.tencent.com    | 필터 파라미터 복잡    |
| Alibaba - ele.me     | talent.ele.me          | 중국어, SPA           |
| Alibaba - Taotian    | talent.taotian.com     | 중국어, SPA           |

## 6. 제약사항

- **Rate Limiting**: 사이트당 요청 간격 최소 2초
- **User-Agent**: 실제 브라우저와 유사하게 설정
- **로그인 필요 사이트**: Phase 1에서는 로그인 없이 접근 가능한 데이터만 수집
- **robots.txt**: 준수 (단, 채용 페이지는 대부분 허용됨)

## 7. 출력 형식

### 7.1 JSON 출력 (POC)

```json
{
  "company": "Booking.com",
  "crawledAt": "2025-01-15T10:30:00Z",
  "totalJobs": 150,
  "jobs": [
    {
      "id": "uuid",
      "title": "Senior Software Engineer",
      "location": "Amsterdam, Netherlands",
      "department": "Engineering",
      ...
    }
  ]
}
```

## 8. 디렉토리 구조

```
jd-crawler/
├── docs/
│   └── TECHSPEC.md
├── src/
│   ├── domain/           # 도메인 모델 (순수 로직)
│   ├── app/              # 애플리케이션 서비스
│   │   ├── services/
│   │   └── ports/        # 인터페이스 정의
│   ├── infra/            # 인프라 구현
│   │   ├── browser/      # Playwright 구현
│   │   ├── llm/          # Claude API 연동
│   │   ├── cache/        # 구조 캐시 구현
│   │   └── output/       # 파일 출력
│   └── cli/              # CLI 진입점
├── tests/
├── .cache/
│   └── structures.json   # 페이지 구조 캐시 저장
├── output/               # 크롤링 결과 저장
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## 9. 환경 변수

```bash
ANTHROPIC_API_KEY=sk-ant-...   # Claude API 키
HEADLESS=true                   # 브라우저 headless 모드
OUTPUT_DIR=./output             # 결과 저장 경로
```
