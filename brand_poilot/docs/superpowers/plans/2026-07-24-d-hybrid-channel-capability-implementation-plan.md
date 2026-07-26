# D Hybrid Channel Capability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instagram, Threads, X, LinkedIn, YouTube, TikTok의 등록·연결 위치를 `/channels`로 유지하고, 콘텐츠 생성 화면이 채널별 생성·내보내기·실제 게시 가능 범위를 정확히 소비하게 한다.

**Architecture:** 기존 channel catalog와 connection data를 유지하고, 서버가 catalog/connection/generation/export/publish/readiness를 합친 capability aggregate를 제공한다. 콘텐츠 생성은 이 API가 준비된 뒤 구현하며, unsupported 채널을 UI 추측이나 mock fallback으로 활성화하지 않는다.

**Tech Stack:** Fastify, TypeScript, React, Vitest, Testing Library, Playwright.

---

## Task 1: 현재 채널 카탈로그와 연결 회귀 고정

**Files:**

- Modify: `apps/api/src/channelCatalog.test.ts`
- Modify: `apps/api/src/instagramCapabilities.test.ts`
- Modify: `apps/customer-ui/src/__tests__/channels.test.tsx`
- Modify: `apps/customer-ui/src/features/channels/channelConnectionUrls.ts`

- [ ] 여섯 채널 catalog가 유지되는지 테스트한다.
- [ ] Instagram OAuth/permission/account mapping/token expiry를 고정한다.
- [ ] Threads, X, LinkedIn, YouTube, TikTok이 catalog에 존재한다는 사실과 API publish 가능 여부를 분리한다.
- [ ] static Instagram Story를 유지하고 user-facing video/Reel generation action은 없는지 검증한다.
- [ ] 외부 OAuth callback query의 성공·취소·실패 처리를 고정한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/api -- channelCatalog.test.ts instagramCapabilities.test.ts
npm run test --workspace @brand-pilot/customer-ui -- channels.test.tsx
```

예상 결과: 기존 채널 목록과 Instagram 연결 기준선이 통과한다.

## Task 2: 서버 capability aggregate 구현

**Files:**

- Create: `apps/api/src/channelCapabilities.ts`
- Create: `apps/api/src/channelCapabilities.test.ts`
- Modify: `apps/api/src/channelCatalog.ts`
- Modify: `apps/api/src/instagramCapabilities.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/customer-ui/src/types.ts`

- [ ] 단일 계약을 정의한다.

```ts
export interface ChannelCapability {
  channel: "instagram" | "threads" | "x" | "linkedin" | "youtube" | "tiktok";
  catalogStatus: "available" | "planned";
  connectionStatus: ChannelStatus;
  canGenerate: boolean;
  generationFormats: Array<"card_news" | "blog" | "single_image" | "channel_text">;
  exportModes: Array<"image" | "html" | "text">;
  publishModes: DeliveryFormat[];
  readiness: "ready" | "needs_connection" | "needs_permission" | "not_supported";
  reasonCode: string | null;
}
```

- [ ] `GET /brands/:brandId/channels/capabilities`를 추가한다.
- [ ] Instagram은 실제 adapter와 permission 결과로 `publishModes`를 계산한다.
- [ ] Threads는 text generation/export와 실제 API publish를 분리한다.
- [ ] X, LinkedIn, YouTube, TikTok은 구현된 adapter가 없으면 `not_supported`이며 연결됨처럼 표시하지 않는다.
- [ ] YouTube/TikTok은 현재 영상 생성 제외로 `canGenerate=false`, `reasonCode='video_generation_out_of_scope'`를 반환한다.
- [ ] static Story는 Instagram image publish mode로 유지한다.
- [ ] 과거 Reel result 조회는 capability와 무관하게 read compatibility로 유지한다.
- [ ] 테스트에 아래 조합을 포함한다.
  - catalog exists + no connection
  - connected + missing permission
  - connected + export only
  - Instagram ready
  - unsupported adapter
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/api -- channelCatalog.test.ts channelCapabilities.test.ts instagramCapabilities.test.ts
npm run build --workspace @brand-pilot/api
```

예상 결과: 콘텐츠 UI가 추측하지 않고 한 응답으로 enable/disable을 결정한다.

- [ ] 구현 커밋:

```bash
git add apps/api/src/channelCatalog* apps/api/src/channelCapabilities* apps/api/src/instagramCapabilities* apps/api/src/httpServer.ts apps/customer-ui/src/types.ts
git commit -m "feat(channels): expose generation export and publish capabilities"
```

## Task 3: `/channels` 등록·연결 UI 정리

**Files:**

- Create: `apps/customer-ui/src/features/channels/channelCapabilityViewModel.ts`
- Create: `apps/customer-ui/src/features/channels/channelCapabilityViewModel.test.ts`
- Modify: `apps/customer-ui/src/pages/ChannelsPage.tsx`
- Modify: `apps/customer-ui/src/features/channels/channelGuides.ts`
- Modify: `apps/customer-ui/src/features/channels/channelConnectionUrls.ts`
- Modify: `apps/customer-ui/src/components/channels/ChannelConnectionGuideDialog.tsx`
- Modify: `apps/customer-ui/src/__tests__/channels.test.tsx`

- [ ] 채널 등록·연결의 canonical 위치를 `/channels`로 유지한다.
- [ ] card마다 다음 네 행을 독립적으로 표시한다.
  - 계정 연결
  - 콘텐츠 생성/변환
  - 파일·텍스트 export
  - API 실제 게시
- [ ] Instagram의 실제 OAuth, permission, mapping, token 상태와 해결 action을 연결한다.
- [ ] 준비 중 채널은 `연결됨` 또는 `게시 가능`으로 과장하지 않고 connection request/guide만 제공한다.
- [ ] `canGenerate=false`인 채널의 이유를 사람이 이해할 수 있는 문구로 표시한다.
- [ ] dialog focus trap, Escape, trigger focus restore를 테스트한다.
- [ ] API failure 시 catalog를 성공 mock으로 바꾸지 않고 error/retry를 표시한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/customer-ui -- channelCapabilityViewModel.test.ts channels.test.tsx ChannelLogo.test.tsx
npm run build --workspace @brand-pilot/customer-ui
```

예상 결과: 사용자는 여섯 채널을 한곳에서 관리하면서 실제 지원 범위를 구분한다.

- [ ] 구현 커밋:

```bash
git add apps/customer-ui/src/features/channels apps/customer-ui/src/pages/ChannelsPage.tsx apps/customer-ui/src/components/channels apps/customer-ui/src/__tests__/channels.test.tsx
git commit -m "feat(channels): clarify channel registration and readiness"
```

## Task 4: 콘텐츠 생성 소비 계약 고정

**Files:**

- Create: `apps/customer-ui/src/features/channels/channelCapabilityGateway.ts`
- Create: `apps/customer-ui/src/features/channels/channelCapabilityGateway.test.ts`

- [ ] gateway가 abortable request와 stale response 방지를 제공한다.
- [ ] 콘텐츠 setup accordion 3이 사용할 selector를 고정한다.

```ts
export function supportedChannelsForFormat(
  capabilities: ChannelCapability[],
  format: "card_news" | "blog" | "single_image" | "channel_text"
): ChannelCapability[];
```

- [ ] selector는 선택한 format을 지원하지 않는 채널의 disabled reason과 `/channels` 해결 링크 데이터를 반환한다.
- [ ] gateway가 로딩·실패 상태를 명시해 후속 콘텐츠 화면이 채널을 임의로 enable하지 못하게 한다.
- [ ] capability API 실패 시 사용할 정책을 반환한다: retry 가능, 기존 draft 저장 가능, generation start 불가.
- [ ] 아직 존재하지 않는 콘텐츠 accordion을 이 계획의 component/E2E test에 넣지 않는다. 실제 disabled UI와 `/channels` 변경 후 재조회는 콘텐츠 생성 계획 Task 8/11에서 검증한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/customer-ui -- channelCapabilityGateway.test.ts channelCapabilityViewModel.test.ts
```

예상 결과: 후속 콘텐츠 계획이 안정된 channel capability 계약에 의존할 수 있다.

- [ ] 최종 커밋:

```bash
git add apps/customer-ui/src/features/channels
git commit -m "test(channels): lock content capability handoff"
```
