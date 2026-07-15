# Sidebar Brand Profile And Logo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 브랜드 로고를 등록·교체·삭제하고, 고객 앱 사이드바 하단에서 현재 브랜드명과 함께 표시해 브랜드 설정으로 바로 이동하게 한다.

**Architecture:** `brand_profiles`가 공개 로고 URL과 Supabase Storage 경로를 보관한다. 중앙 API의 별도 로고 서비스와 전용 PostgreSQL 저장소가 파일 검증, Storage I/O, DB 상태 변경을 담당해 기존 `ApiRepository` 계약을 넓히지 않는다. React는 공용 `BrandLogo`를 설정 편집기와 사이드바에서 재사용하며, 로고 변경 후 기존 브랜드 상태 갱신 이벤트로 `ui-status`를 다시 읽는다.

**Tech Stack:** PostgreSQL, Fastify, Node.js `fetch`, React 18, React Router, Vitest, Testing Library, Supabase Storage REST API

---

### Task 1: DB와 API 계약

**Files:**
- Create: `db/migrations/028_brand_profile_logo.sql`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/repository.ts`
- Test: `apps/api/src/repository.logo.test.ts`

- [ ] **Step 1: Repository 매핑 실패 테스트 작성**

`getBrandProfile`과 `getBrandUiStatus`가 `logo_url`을 각각 `logoUrl`로 반환하고, 로고 상태 변경 메서드가 이전 Storage 경로를 반환하는 테스트를 추가한다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test --workspace @brand-pilot/api -- repository.test.ts`

Expected: `logoUrl` 및 로고 상태 변경 메서드 부재로 FAIL.

- [ ] **Step 3: 마이그레이션과 Repository 구현**

```sql
alter table brand_profiles
  add column if not exists logo_url text null,
  add column if not exists logo_storage_path text null;
```

`BrandProfileDto`, `BrandUiStatusDto`에 `logoUrl: string | null`을 추가한다. 로고 변경 DB 계약은 `brandLogo.ts`의 전용 저장소로 분리한다.

```ts
replace(brandId, input): Promise<{ profile: BrandProfileDto; previousStoragePath: string | null }>;
clear(brandId): Promise<{ profile: BrandProfileDto; previousStoragePath: string | null }>;
```

- [ ] **Step 4: Repository 테스트 통과 확인**

Run: `npm test --workspace @brand-pilot/api -- repository.test.ts`

Expected: PASS.

### Task 2: Supabase Storage와 HTTP API

**Files:**
- Create: `apps/api/src/brandLogo.ts`
- Create: `apps/api/src/brandLogo.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/server.test.ts`
- Modify: `apps/api/.env.example`
- Modify: `README.md`

- [ ] **Step 1: 파일 검증과 Storage 동작 실패 테스트 작성**

PNG/JPEG/WebP만 허용하고 디코딩된 파일이 2MB를 넘으면 거부한다. 새 파일 업로드 후 DB를 갱신하고 이전 파일을 삭제하는 순서, DB 갱신 실패 시 새 파일을 정리하는 동작을 테스트한다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test --workspace @brand-pilot/api -- brandLogo.test.ts server.test.ts`

Expected: 로고 서비스와 라우트 부재로 FAIL.

- [ ] **Step 3: Storage 어댑터와 로고 서비스 구현**

환경값 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, 선택값 `SUPABASE_BRAND_ASSETS_BUCKET`을 읽는다. 기본 버킷은 `brand-assets`이며 경로는 `{workspaceId}/{brandId}/logo-{uuid}.{extension}`이다. 설정이 없으면 `brand_logo_storage_not_configured`를 반환한다.

- [ ] **Step 4: 업로드·삭제 라우트 구현**

```text
POST   /brands/:brandId/logo
DELETE /brands/:brandId/logo
```

POST는 `fileName`, `mimeType`, `fileBase64`를 받고 성공 시 갱신된 `BrandProfileDto`를 반환한다. DELETE도 갱신된 프로필을 반환한다. 기존 인증 및 브랜드 소유권 preHandler를 그대로 적용한다.

- [ ] **Step 5: API 테스트 통과 확인**

Run: `npm test --workspace @brand-pilot/api -- brandLogo.test.ts server.test.ts repository.test.ts`

Expected: PASS.

### Task 3: React 공용 로고와 API Client

**Files:**
- Create: `apps/customer-ui/src/components/brand/BrandLogo.tsx`
- Create: `apps/customer-ui/src/components/brand/BrandLogoEditor.tsx`
- Create: `apps/customer-ui/src/__tests__/brandLogo.test.tsx`
- Modify: `apps/customer-ui/src/types.ts`
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Modify: `apps/customer-ui/src/lib/apiClient.test.ts`

- [ ] **Step 1: 로고 대체 표시와 API Client 실패 테스트 작성**

이미지가 없거나 로드에 실패하면 브랜드명 첫 1~2글자를 표시한다. API Client가 POST/DELETE 경로와 JSON 계약을 사용하는지 검증한다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test --workspace @brand-pilot/customer-ui -- brandLogo.test.tsx apiClient.test.ts`

Expected: 컴포넌트와 API 메서드 부재로 FAIL.

- [ ] **Step 3: 공용 컴포넌트와 Client 구현**

`BrandLogoEditor`는 브라우저에서 MIME/2MB를 먼저 검사하고 `FileReader`로 Base64를 만든다. 업로드 실패 시 기존 URL을 유지하고 오류를 표시하며, 성공 시 부모에 갱신된 프로필을 전달한다.

- [ ] **Step 4: 공용 단위 테스트 통과 확인**

Run: `npm test --workspace @brand-pilot/customer-ui -- brandLogo.test.tsx apiClient.test.ts`

Expected: PASS.

### Task 4: 사이드바와 브랜드 설정 통합

**Files:**
- Create: `apps/customer-ui/src/components/layout/SidebarBrandProfile.tsx`
- Modify: `apps/customer-ui/src/components/layout/Sidebar.tsx`
- Modify: `apps/customer-ui/src/pages/BrandSettingsPage.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`
- Modify: `apps/customer-ui/src/__tests__/navigation.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/brandSettings.test.tsx`

- [ ] **Step 1: 직접 이동·편집 통합 실패 테스트 작성**

사이드바 하단 링크가 `/brand-settings`를 가리키고 `brandName`, `logoUrl`을 표시하는지 검증한다. 설정 페이지에서 업로드 성공, 실패 시 기존 로고 유지, 삭제를 검증한다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test --workspace @brand-pilot/customer-ui -- navigation.test.tsx brandSettings.test.tsx`

Expected: 하단 프로필과 로고 편집기 부재로 FAIL.

- [ ] **Step 3: React 통합과 스타일 구현**

사이드바를 세로 flex로 변경하고 내비게이션에 남는 공간을 준다. 하단 프로필은 원형 36px 로고, 말줄임 브랜드명, `브랜드 설정`, 이동 아이콘으로 구성한다. 모바일에서는 내비게이션 아래 자연스럽게 배치한다. 브랜드 프로필 패널은 로고 편집 영역과 기존 폼을 나란히 두되 좁은 화면에서 세로로 전환한다.

- [ ] **Step 4: React 테스트 통과 확인**

Run: `npm test --workspace @brand-pilot/customer-ui -- navigation.test.tsx brandSettings.test.tsx brandLogo.test.tsx`

Expected: PASS.

### Task 5: 전체 검증과 리뷰

**Files:**
- Verify all modified files

- [ ] **Step 1: API 전체 테스트·타입 검사**

Run: `npm test --workspace @brand-pilot/api`

Run: `npm run typecheck --workspace @brand-pilot/api`

- [ ] **Step 2: UI 전체 테스트·빌드**

Run: `npm test --workspace @brand-pilot/customer-ui`

Run: `npm run build --workspace @brand-pilot/customer-ui`

- [ ] **Step 3: 마이그레이션 계약 검사**

Run: `npm run test:migrations`

- [ ] **Step 4: 변경 범위 리뷰**

`git diff --check`, `git status --short`, `git diff --stat`으로 공백 오류, 기존 DM 변경 혼입, 누락 파일을 확인한다.
