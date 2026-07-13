# Brand Pilot Customer UI Design System

작성일: 2026-07-05  
상태: Draft  
대상: React + TypeScript + Next.js App Router + Tailwind CSS + shadcn/ui  

## 1. 목적

이 문서는 Brand Pilot 고객용 웹앱의 디자인 시스템 기준을 정의한다.

목표는 예쁜 화면을 따로 만드는 것이 아니라, 콘텐츠 검토, 자동 승인, 게시 큐, 채널 연결 상태를 반복적으로 확인하는 운영툴 UI를 일관되게 만드는 것이다.

## 2. 디자인 원칙

1. 조용하고 밀도 있는 SaaS 운영 화면을 만든다.
2. 대시보드형 장식 화면은 만들지 않는다.
3. 사용자의 반복 업무는 `검토`, `승인`, `게시 상태 확인`, `오류 해결`이다.
4. 상태값은 색상만으로 전달하지 않고 텍스트와 아이콘을 함께 사용한다.
5. 버튼은 액션 우선순위가 명확해야 한다.
6. 카드 안에 카드를 중첩하지 않는다.
7. 테이블, 탭, 배지, 알림, 모달을 기본 업무 컴포넌트로 사용한다.
8. 브랜드 컬러는 제품 UI의 신뢰감을 해치지 않는 범위에서 제한적으로 쓴다.

## 3. 토큰 구조

3-layer token 구조를 사용한다.

```text
Primitive Tokens
  -> Semantic Tokens
  -> Component Tokens
```

원칙:

- 컴포넌트에서 raw hex 값을 직접 쓰지 않는다.
- Tailwind class는 shadcn/ui CSS variable 구조와 맞춘다.
- 상태 색상은 의미가 고정된 semantic token으로 관리한다.
- 라이트 모드를 기본으로 하고, 다크 모드는 후순위지만 토큰 구조는 열어둔다.

## 4. Primitive Tokens

### 4.1 Color

기본 팔레트:

```css
:root {
  --gray-50:  210 20% 98%;
  --gray-100: 220 14% 96%;
  --gray-200: 220 13% 91%;
  --gray-300: 216 12% 84%;
  --gray-400: 218 11% 65%;
  --gray-500: 220 9% 46%;
  --gray-600: 215 14% 34%;
  --gray-700: 217 19% 27%;
  --gray-800: 215 28% 17%;
  --gray-900: 222 47% 11%;

  --blue-50: 214 100% 97%;
  --blue-100: 214 95% 93%;
  --blue-500: 217 91% 60%;
  --blue-600: 221 83% 53%;
  --blue-700: 224 76% 48%;

  --green-50: 138 76% 97%;
  --green-100: 141 84% 93%;
  --green-600: 142 71% 35%;

  --amber-50: 48 100% 96%;
  --amber-100: 48 96% 89%;
  --amber-600: 32 95% 44%;

  --red-50: 0 86% 97%;
  --red-100: 0 93% 94%;
  --red-600: 0 72% 51%;

  --violet-50: 250 100% 98%;
  --violet-100: 251 91% 95%;
  --violet-600: 262 83% 58%;
}
```

사용 원칙:

- 제품 주색은 blue 계열로 둔다.
- 성공은 green, 주의는 amber, 실패/거절은 red, 자동화/AI 성격은 violet으로 제한적으로 쓴다.
- 전체 화면이 blue 계열로만 보이지 않도록 회색 기반 surface를 충분히 사용한다.

### 4.2 Spacing

4px 기반 spacing scale을 사용한다.

```css
:root {
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-10: 2.5rem;
  --space-12: 3rem;
}
```

운영툴 기준:

- 화면 outer padding: 24px
- 섹션 간격: 24px
- 폼 그룹 간격: 16px
- 테이블 셀 padding: 12px 16px
- 탭/필터 간격: 8px

### 4.3 Typography

```css
:root {
  --font-size-xs: 0.75rem;
  --font-size-sm: 0.875rem;
  --font-size-base: 1rem;
  --font-size-lg: 1.125rem;
  --font-size-xl: 1.25rem;
  --font-size-2xl: 1.5rem;

  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  --leading-tight: 1.25;
  --leading-normal: 1.5;
  --leading-relaxed: 1.625;
}
```

사용 원칙:

- 페이지 제목: 24px / semibold
- 섹션 제목: 18px / semibold
- 카드 제목: 16px / semibold
- 본문: 14px 또는 16px
- 보조 설명: 13px 또는 14px
- 테이블/배지: 12px 또는 13px
- letter-spacing은 0을 기본으로 한다.

### 4.4 Radius

```css
:root {
  --radius-sm: 0.25rem;
  --radius-md: 0.375rem;
  --radius-lg: 0.5rem;
  --radius-full: 9999px;
}
```

사용 원칙:

- 카드/패널: 8px 이하
- 버튼/입력: 6px
- 배지: full
- 모달: 8px

## 5. Semantic Tokens

shadcn/ui와 호환되는 CSS variable 구조를 사용한다.

```css
:root {
  --background: 210 20% 98%;
  --foreground: 222 47% 11%;

  --card: 0 0% 100%;
  --card-foreground: 222 47% 11%;

  --popover: 0 0% 100%;
  --popover-foreground: 222 47% 11%;

  --primary: 221 83% 53%;
  --primary-foreground: 0 0% 100%;

  --secondary: 220 14% 96%;
  --secondary-foreground: 222 47% 11%;

  --muted: 220 14% 96%;
  --muted-foreground: 220 9% 46%;

  --accent: 220 14% 96%;
  --accent-foreground: 222 47% 11%;

  --destructive: 0 72% 51%;
  --destructive-foreground: 0 0% 100%;

  --border: 220 13% 91%;
  --input: 220 13% 91%;
  --ring: 217 91% 60%;

  --radius: 0.5rem;
}
```

Brand Pilot 전용 semantic tokens:

```css
:root {
  --status-success: 142 71% 35%;
  --status-success-bg: 138 76% 97%;
  --status-success-border: 141 84% 86%;

  --status-warning: 32 95% 44%;
  --status-warning-bg: 48 100% 96%;
  --status-warning-border: 48 96% 80%;

  --status-danger: 0 72% 51%;
  --status-danger-bg: 0 86% 97%;
  --status-danger-border: 0 93% 86%;

  --status-info: 221 83% 53%;
  --status-info-bg: 214 100% 97%;
  --status-info-border: 214 95% 86%;

  --status-auto: 262 83% 58%;
  --status-auto-bg: 250 100% 98%;
  --status-auto-border: 251 91% 88%;
}
```

## 6. Tailwind / shadcn Integration

기본 구성:

- shadcn/ui 초기화 시 `Default` 또는 `New York` 스타일 중 하나를 선택한다.
- Brand Pilot은 밀도 있는 운영툴이므로 `New York` 스타일을 기본 추천한다.
- Tailwind config는 shadcn/ui CSS variable 구조를 유지한다.

필수 shadcn/ui 컴포넌트:

```bash
npx shadcn@latest add button badge alert card dialog drawer dropdown-menu form input label select separator sheet skeleton switch table tabs textarea toast tooltip
```

추가 가능 컴포넌트:

```bash
npx shadcn@latest add command popover checkbox radio-group progress scroll-area
```

## 7. Core Components

### 7.1 AppShell

목적:

- 고객용 앱의 기본 레이아웃이다.

구성:

- 좌측 사이드바
- 상단 브랜드/상태 바
- 본문 영역

규칙:

- 대시보드 메뉴는 만들지 않는다.
- 기본 메뉴는 온보딩, 콘텐츠, 게시 큐, 소스, 채널, 브랜드 설정이다.
- 모바일에서는 sidebar를 sheet/drawer로 전환한다.

### 7.2 PageHeader

구성:

- 페이지 제목
- 짧은 설명
- 주요 액션 버튼 1개
- 보조 액션은 dropdown 또는 ghost button

규칙:

- 제목은 길어도 한 줄에서 과도하게 커지지 않는다.
- PageHeader 안에 마케팅성 문구를 넣지 않는다.

### 7.3 StatusBadge

목적:

- 검토, 게시, 연결, 주제 상태를 일관되게 표시한다.

변형:

| Variant | 용도 |
|---|---|
| neutral | 기본/대기 |
| info | 예정/진행 |
| success | 승인/게시 완료/연결 정상 |
| warning | 확인 필요/이월 |
| danger | 실패/거절/권한 오류 |
| auto | 자동 승인 |

상태 매핑:

| 상태 | Variant | 표시 |
|---|---|---|
| `pending_review` | warning | 검토 필요 |
| `approved` | success | 승인됨 |
| `auto_approved` | auto | 자동 승인 |
| `auto_approval_blocked` | warning | 자동 승인 차단 |
| `rejected` | danger | 거절됨 |
| `regenerating` | info | 재생성 중 |
| `queued` | neutral | 큐 대기 |
| `scheduled` | info | 게시 예정 |
| `publishing` | info | 게시 중 |
| `published` | success | 게시 완료 |
| `failed` | danger | 실패 |
| `deferred` | warning | 이월 |
| `connected` | success | 연결됨 |
| `expired` | danger | 만료 |
| `insufficient_permissions` | danger | 권한 부족 |
| `mapping_required` | warning | 매핑 필요 |

규칙:

- 색상만으로 상태를 전달하지 않는다.
- 상태 배지에는 텍스트를 반드시 넣는다.
- 실패/차단 상태는 tooltip 또는 상세 링크를 제공한다.

### 7.4 DataTable

용도:

- 콘텐츠 리스트
- 게시 큐
- URL 리스트
- 주제 큐

규칙:

- 행 높이는 48px 기본, 밀도 높은 화면은 40px까지 허용한다.
- 상태 배지는 가운데 정렬 가능하지만 텍스트 컬럼은 왼쪽 정렬한다.
- 행 액션은 우측에 모은다.
- 긴 URL과 제목은 truncate 처리하고 상세에서 전체를 보여준다.

### 7.5 ReviewItem

목적:

- 콘텐츠 검토함의 기본 업무 단위다.

구성:

- 주제 제목
- 채널
- 생성 근거
- 검토 상태
- 자동 승인 검사 결과
- 예정 게시 상태
- 주요 액션: 승인, 재생성, 거절

규칙:

- 직접 편집 버튼은 제공하지 않는다.
- 자동 승인 차단 상태에서는 차단 사유를 액션보다 위에 표시한다.
- 채널별 미리보기는 탭으로 전환한다.

### 7.6 PublishSlot

목적:

- 게시 큐의 시간 슬롯을 표현한다.

구성:

- 기준 슬롯 시간
- 실제 예정 시간
- 채널
- 콘텐츠 제목
- 승인 유형
- 게시 상태

규칙:

- 사용자가 시간을 직접 바꾸는 UI는 없다.
- 빈 슬롯은 오류가 아니라 "승인된 콘텐츠 없음"으로 표시한다.
- 실패 슬롯은 실패 사유와 채널 연결 확인 액션을 제공한다.

### 7.7 ChannelCard

목적:

- Instagram, Threads, Webflow 연결 상태를 표시한다.

구성:

- 채널 아이콘
- 연결 상태 배지
- 계정명 또는 Site/Collection 정보
- 마지막 정상 확인 시간
- 마지막 게시 성공 시간
- 연결/재연결/설정 버튼

규칙:

- 연결 상태가 좋지 않으면 카드 상단에 warning 또는 danger alert를 표시한다.
- Webflow는 필드 매핑 상태를 같은 카드 안에서 명확히 보여준다.

### 7.8 EmptyState

용도:

- 검토할 콘텐츠 없음
- 게시 예정 없음
- URL 없음
- 주제표 없음
- 채널 연결 없음

구성:

- 제목
- 한 문장 설명
- 기본 액션 1개
- 보조 액션 1개 이하

규칙:

- 빈 상태를 실패처럼 보이게 만들지 않는다.
- 다음 액션이 명확해야 한다.

### 7.9 ErrorState

구성:

- 무엇이 실패했는지
- 왜 실패했는지
- 지금 할 수 있는 액션

규칙:

- 오류 메시지는 3줄 이상 길어지지 않게 한다.
- 자세한 오류는 펼침 영역 또는 상세 모달로 보낸다.
- 토큰/권한/매핑 문제는 채널 화면으로 연결한다.

## 8. Button System

shadcn/ui Button variant를 기본으로 사용한다.

| Variant | 용도 |
|---|---|
| default | 저장, 승인, 연결 같은 주요 액션 |
| secondary | 보조 액션 |
| outline | 상세 보기, 새로고침 |
| ghost | 테이블 row action, 메뉴성 액션 |
| destructive | 삭제, 거절, 연결 해제 |
| link | 내부 이동 |

화면별 주요 버튼:

| 화면 | Primary | Secondary |
|---|---|---|
| 온보딩 | 다음 필수 설정 | 건너뛰기 없음 |
| 콘텐츠 검토 | 승인 | 재생성, 거절 |
| 자동 승인 차단 | 수동 승인 | 재생성, 거절 |
| 게시 큐 실패 | 채널 연결 확인 | 수동 재시도 요청 |
| 소스 URL | URL 추가 | 다시 크롤링 |
| 주제표 | 업로드 | 템플릿 다운로드 |
| 채널 | 연결/재연결 | 연결 확인 |
| 브랜드 설정 | 저장 | 변경 취소 |

규칙:

- 한 화면의 primary action은 한 개만 둔다.
- 파괴적 액션은 항상 destructive variant와 확인 모달을 사용한다.
- 아이콘만 있는 버튼은 tooltip을 제공한다.

## 9. Form System

기본:

- React Hook Form
- Zod schema
- shadcn/ui Form, Input, Textarea, Select, Switch

규칙:

- 필수 필드는 label에 명확히 표시한다.
- 오류 메시지는 input 아래에 바로 표시한다.
- 저장 성공은 toast로 표시한다.
- 긴 설명 입력은 Textarea를 사용한다.
- 금지 표현, CTA, URL은 반복 필드 패턴을 사용한다.

주요 폼:

- 브랜드 프로필
- URL 추가
- 주제표 업로드
- 채널 연결 정보
- Webflow 필드 매핑
- 브랜드 전체 자동 승인 설정
- 재생성 사유

## 10. Navigation System

사이드바 메뉴:

```text
온보딩
콘텐츠
게시 큐
소스
채널
브랜드 설정
```

규칙:

- 현재 위치는 active background와 text weight로 표시한다.
- pending review, failed publish, channel error는 메뉴 옆 count badge로 표시한다.
- 모바일에서는 sidebar를 sheet로 표시한다.

## 11. Screen-Level Patterns

### 11.1 온보딩

패턴:

- 체크리스트 중심 화면
- 각 단계는 status badge와 action button을 가진다.
- 오류가 있는 단계는 alert를 보여준다.

### 11.2 콘텐츠

패턴:

- 상단 탭
- 필터 바
- 리스트/카드 혼합
- 상세 패널 또는 상세 페이지

권장:

- Desktop: 리스트 + 우측 상세 패널
- Mobile: 리스트 → 상세 화면 전환

### 11.3 게시 큐

패턴:

- 날짜별 섹션
- 채널별 슬롯 그룹
- 상태 배지 중심

주의:

- 캘린더 편집 UI로 보이게 만들지 않는다.
- 사용자가 시간을 수정할 수 있다는 암시를 주지 않는다.

### 11.4 소스

패턴:

- 자사 URL / 참고 URL / 주제표 업로드 / 주제 큐 탭
- URL 리스트는 테이블
- 주제표 업로드는 stepper 형식

### 11.5 채널

패턴:

- 채널 카드 3개
- 연결 오류/권한 상태는 alert로 강조

### 11.6 브랜드 설정

패턴:

- 좌측 섹션 내비게이션 또는 탭
- 폼 중심
- 브랜드 전체 자동 승인 on/off를 이 화면 안에서 제공
- 저장 버튼은 하단 sticky action bar까지 고려

## 12. Accessibility Rules

- 모든 interactive element는 focus-visible 상태가 있어야 한다.
- 상태 배지는 색상 외에 텍스트를 포함해야 한다.
- 오류 메시지는 `aria-invalid`와 연결한다.
- loading button은 `aria-busy`를 사용한다.
- dialog는 focus trap이 필요하다.
- toast만으로 중요한 오류를 전달하지 않는다.
- 테이블 행 액션은 키보드로 접근 가능해야 한다.

## 13. Implementation Handoff

공통 컴포넌트 분리:

```text
components/ui
  - shadcn/ui generated components

components/app
  - AppShell
  - PageHeader
  - StatusBadge
  - EmptyState
  - ErrorState
  - DataTableShell
  - ReviewItem
  - PublishSlot
  - ChannelCard
  - AutoApprovalSummary
```

권장 route 구조:

```text
app/(app)/onboarding
app/(app)/content
app/(app)/content/[contentId]
app/(app)/publish-queue
app/(app)/sources
app/(app)/channels
app/(app)/brand-settings
```

## 14. 자체 검토

- 대시보드 컴포넌트는 정의하지 않았다.
- 콘텐츠 직접 편집 컴포넌트는 정의하지 않았다.
- 게시 시간 편집 컴포넌트는 정의하지 않았다.
- React, Tailwind, shadcn/ui 기준으로 작성했다.
- 상태 배지와 오류 표현은 색상만 의존하지 않도록 정의했다.
- 운영툴에 맞게 카드 남용을 피하고 테이블/탭/상태 중심으로 설계했다.
