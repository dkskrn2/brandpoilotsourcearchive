# Brand Pilot Regression and Ubuntu Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** D 하이브리드 대규모 개편에서 기존 소기능을 모두 보존하고, Vercel 프론트와 Ubuntu Docker 서버를 단계적으로 배포·검증·롤백할 수 있게 한다.

**Architecture:** 기능 보존표를 executable regression matrix로 바꾸고 unit/integration/E2E/deployment test에 각각 연결한다. 프론트는 GitHub `dkskrn2/main`의 기존 Vercel 배포를 유지하고, 서버는 GitHub Actions가 SHA 기반 GHCR 이미지를 만든 뒤 Ubuntu가 digest로 pull한다. Tailscale은 관리 SSH에만 사용하고 공개 OAuth/webhook 트래픽은 DNS+Caddy HTTPS로 받는다. 환경값은 컨테이너 밖 `/opt/brand-pilot/shared/env`에 유지한다.

**Tech Stack:** Vitest, Node test, Playwright, axe-core, PostgreSQL migration tests, GitHub Actions, GHCR, Docker Compose, Caddy, Ubuntu 24.04, Tailscale, SSH.

---

## Task 1: 기능 보존표를 실행 가능한 regression matrix로 변환

**Files:**

- Create: `docs/quality/d-hybrid-regression-matrix.md`
- Modify: `docs/prd/brand-pilot-feature-preservation-ledger.md`
- Create: `scripts/verify-regression-matrix.mjs`
- Create: `scripts/verify-regression-matrix.test.mjs`
- Modify: `package.json`

- [ ] 기능 보존표의 모든 행에 안정된 ID를 부여한다.

```text
AUTH-LOGIN-001
BRAND-SOURCE-001
USAGE-GENERATE-001
USAGE-DOWNLOAD-001
CONTENT-REFERENCE-001
PUBLISH-UNKNOWN-001
DM-DEDUPE-001
SUPPORT-FEEDBACK-001
A11Y-FOCUS-001
OPS-ROLLBACK-001
```

- [ ] regression matrix의 각 ID에 다음 필드를 작성한다.
  - 제품 요구사항
  - 단위/통합 테스트 파일과 test name
  - E2E 또는 smoke 시나리오
  - 운영 활성화 상태
  - 명시적 제외 여부
  - 증빙 명령
- [ ] 각 active ID가 최소 한 테스트 파일에 등장하는지 검사하는 script를 만든다.
- [ ] `사용자 화면 제외` ID는 negative UI/API test가 없으면 실패하게 한다.
- [ ] 새 기능이 기존 ID를 대체할 경우 기존 ID를 삭제하지 않고 superseded link를 남긴다.
- [ ] package script를 추가한다.

```json
{
  "scripts": {
    "test:regression-matrix": "node --test scripts/verify-regression-matrix.test.mjs && node scripts/verify-regression-matrix.mjs"
  }
}
```

- [ ] 실행:

```bash
npm run test:regression-matrix
```

예상 결과: 기능 보존표의 구현 대상이 테스트 증빙 없이 남아 있으면 실패하고, 전부 연결되면 exit code 0이다.

- [ ] 구현 커밋:

```bash
git add docs/quality/d-hybrid-regression-matrix.md docs/prd/brand-pilot-feature-preservation-ledger.md scripts/verify-regression-matrix* package.json
git commit -m "test(regression): map preserved features to executable checks"
```

## Task 2: 사용량·제한·다운로드 회귀 묶음

**Files:**

- Modify: `apps/api/src/aiContentRepository.test.ts`
- Modify: `apps/api/src/aiContentDownload.test.ts`
- Modify: `apps/api/src/topicQuota.pglite.test.ts`
- Modify: `apps/api/src/instagramTrendRepository.test.ts`
- Modify: `apps/api/src/brandAnalysisUpload.test.ts`
- Modify: `apps/api/src/aiContentUpload.test.ts`
- Modify: `apps/customer-ui/src/features/ai-content/AiContentUsageContext.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/aiContentGeneration.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/sources.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/instagramTrends.test.tsx`

- [ ] 서버와 UI에서 다음 수치를 같은 fixture로 검증한다.
  - AI generation 10/day
  - new download 20/day
  - 동일 결과 재다운로드 비차감
  - auto topic 4/day/brand
  - active reference URL 10
  - unique hashtag 30/7 days
  - brand analysis documents 5, each 10MB
  - generation attachments total 5, image 5MB
- [ ] quota는 KST reset boundary 전후를 fake clock으로 테스트한다.
- [ ] concurrent generation/download 요청에서도 한도를 초과하지 않는지 transaction test를 추가한다.
- [ ] ZIP 실패가 usage ledger나 output downloaded state를 부분 변경하지 않는지 검증한다.
- [ ] UI는 server error code를 한국어 제한 안내로 매핑하고 입력/기존 자료를 보존한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/api -- aiContentRepository.test.ts aiContentDownload.test.ts topicQuota.pglite.test.ts instagramTrendRepository.test.ts brandAnalysisUpload.test.ts aiContentUpload.test.ts
npm run test --workspace @brand-pilot/customer-ui -- AiContentUsageContext.test.tsx aiContentGeneration.test.tsx sources.test.tsx instagramTrends.test.tsx
```

예상 결과: 제한 수치와 차감 규칙이 UI/서버에서 일치한다.

- [ ] 회귀 커밋:

```bash
git add apps/api/src/aiContentRepository.test.ts apps/api/src/aiContentDownload.test.ts apps/api/src/topicQuota.pglite.test.ts apps/api/src/instagramTrendRepository.test.ts apps/api/src/brandAnalysisUpload.test.ts apps/api/src/aiContentUpload.test.ts apps/customer-ui/src/features/ai-content/AiContentUsageContext.test.tsx apps/customer-ui/src/__tests__/aiContentGeneration.test.tsx apps/customer-ui/src/__tests__/sources.test.tsx apps/customer-ui/src/__tests__/instagramTrends.test.tsx
git commit -m "test(regression): preserve usage and download limits"
```

## Task 3: 피드백·고객센터·도움말·공통 상태 회귀

**Files:**

- Modify: `apps/api/src/server.test.ts`
- Modify: `apps/api/src/adminServer.test.ts`
- Modify: `apps/customer-ui/src/components/feedback/FeedbackDialog.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/support.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/helpGuidance.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/loadingState.test.tsx`
- Create: `apps/customer-ui/src/__tests__/commonStates.regression.test.tsx`

- [ ] 피드백 1–2000자, success dedupe, failure input preservation, `new|reviewed|archived`, admin filter를 검증한다.
- [ ] sidebar/dashboard/support 하단이 같은 feedback provider/dialog/API를 쓰는지 검증한다.
- [ ] 고객센터 category UI는 `bug|channel|account|other`만 노출하고 legacy `feature` row는 읽을 수 있게 한다.
- [ ] 전화번호 010 format, required title/content/phone, optional email, 접수·처리 중·답변 완료와 답변 펼침을 검증한다.
- [ ] 새로고침 button이 고객센터 DOM에 없는지 검증한다.
- [ ] help drawer가 모든 canonical·legacy·dynamic route에서 올바른 guide를 찾는지 검증한다.
- [ ] common page에 loading/skeleton/empty/error/retry/stale 상태가 있고 API 실패를 sample success로 바꾸지 않는지 검증한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/api -- server.test.ts adminServer.test.ts
npm run test --workspace @brand-pilot/customer-ui -- FeedbackDialog.test.tsx support.test.tsx helpGuidance.test.tsx loadingState.test.tsx commonStates.regression.test.tsx
```

예상 결과: 큰 화면 리팩터링과 무관한 지원 기능이 모두 보존된다.

- [ ] 회귀 커밋:

```bash
git add apps/api/src/server.test.ts apps/api/src/adminServer.test.ts apps/customer-ui/src/components/feedback/FeedbackDialog.test.tsx apps/customer-ui/src/__tests__/support.test.tsx apps/customer-ui/src/__tests__/helpGuidance.test.tsx apps/customer-ui/src/__tests__/loadingState.test.tsx apps/customer-ui/src/__tests__/commonStates.regression.test.tsx
git commit -m "test(regression): preserve support feedback and common states"
```

## Task 4: 접근성·반응형 자동화

**Files:**

- Modify: `apps/customer-ui/package.json`
- Modify: `package-lock.json`
- Create: `apps/customer-ui/e2e/d-hybrid-accessibility.spec.ts`
- Modify: `apps/customer-ui/src/__tests__/responsiveStyles.test.ts`
- Modify: `apps/customer-ui/src/__tests__/navigation.test.tsx`

- [ ] `@axe-core/playwright`를 dev dependency로 추가한다.
- [ ] 아래 화면에서 serious/critical violation 0을 검증한다.
  - dashboard
  - brand center와 각 tab
  - reference library
  - content setup/proposal/generating/review
  - channels
  - publish queue
  - DM
  - performance
  - support
- [ ] keyboard-only 시나리오를 추가한다.
  - sidebar collapse/mobile drawer
  - accordion open/complete/back edit
  - proposal card select
  - reference role toggle와 avatar single select
  - dialog/drawer focus trap, Escape, trigger focus restore
  - tabs arrow navigation
- [ ] 1440, 1080, 760, 470, 390px에서 page horizontal overflow가 없는지 검증한다.
- [ ] `prefers-reduced-motion`에서 animation/transition과 smooth scroll이 제거되는지 검증한다.
- [ ] hidden video/Reel control이 accessibility tree에도 없는지 검증한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/customer-ui -- responsiveStyles.test.ts navigation.test.tsx
npm run e2e --workspace @brand-pilot/customer-ui -- d-hybrid-accessibility.spec.ts
```

예상 결과: 마우스 없이 핵심 흐름을 완료하고 모든 지정 화면이 axe gate를 통과한다.

- [ ] 구현 커밋:

```bash
git add apps/customer-ui/package.json package-lock.json apps/customer-ui/e2e/d-hybrid-accessibility.spec.ts apps/customer-ui/src/__tests__
git commit -m "test(a11y): verify d-hybrid keyboard and responsive behavior"
```

## Task 5: legacy route·과거 데이터·제외 기능 회귀

**Files:**

- Create: `apps/customer-ui/src/__tests__/legacyRoutes.regression.test.tsx`
- Create: `apps/api/src/legacyDataCompatibility.test.ts`
- Modify: `apps/customer-ui/e2e/customer-ui.spec.ts`

- [ ] canonical/legacy mapping을 검증한다.

| Legacy | Canonical |
|---|---|
| `/brand-settings` | `/brand-center?tab=understanding&section=core` |
| `/sources` | `/brand-center?tab=understanding&section=sources` |
| `/archive` | `/references?view=saved-trends` |
| `/instagram-trends` | `/references?view=trends` |
| `/content` | `/publish-queue?status=needs_review` |
| `/onboarding` | `/onboarding/brand-intelligence` |

- [ ] 비로그인 home/login, auth 장애 시 session 재확인, support gate 예외를 유지한다.
- [ ] 이 regression task는 route 구현을 다시 수정하지 않고 Brand Center/Reference feature commit이 만든 redirect를 assertion으로만 고정한다.
- [ ] 과거 generation, Reel result, publish attempt, support `feature` row, legacy draft를 read-only로 읽을 수 있게 한다.
- [ ] 아래 기능은 새 create/update API에서 거절하고 메뉴/제안/format에서 숨긴다.
  - video/Reel/Shorts/TikTok generation
  - video Story
  - AI avatar generation
  - face swap/voice clone
  - period offer library
  - influencer marketplace
  - global ad DB/realtime mass monitoring
  - comment-triggered DM
- [ ] static Instagram Story는 negative 목록에 넣지 않고 유지한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/customer-ui -- legacyRoutes.regression.test.tsx auth.test.tsx brandSetupGate.test.tsx
npm run test --workspace @brand-pilot/api -- legacyDataCompatibility.test.ts
npm run e2e --workspace @brand-pilot/customer-ui -- customer-ui.spec.ts
```

예상 결과: 과거 데이터는 보존되고 새 unsupported 작업만 차단된다.

- [ ] 회귀 커밋:

```bash
git add apps/customer-ui/src/__tests__/legacyRoutes.regression.test.tsx apps/api/src/legacyDataCompatibility.test.ts apps/customer-ui/e2e/customer-ui.spec.ts
git commit -m "test(regression): preserve legacy routes and data"
```

## Task 6: 관리자와 readiness 회귀

**Files:**

- Modify: `apps/api/src/adminRepository.test.ts`
- Modify: `apps/api/src/adminServer.test.ts`
- Modify: `apps/api/src/runtime.test.ts`
- Modify: `apps/api/src/runtimeConfig.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `scripts/deployment-contract.test.mjs`

- [ ] `/admin/brand-pilot`와 legacy 오타 경로 redirect를 유지한다.
- [ ] admin에서 brand pause/resume 사유·감사, 오늘 usage, feedback status, publish retry/cancel, worker status를 검증한다.
- [ ] worker status 기준을 `online|stale|offline`으로 고정하고 heartbeat가 없을 때 online으로 과장하지 않는다.
- [ ] `/health`는 process liveness, `/ready`는 DB와 필수 dependency readiness를 구분한다.
- [ ] first deploy safe mode에서 scheduler/publish/DM/Wiki가 disabled임을 readiness가 명시한다.
- [ ] active DM이 켜졌다면 DM/Wiki worker가 빠진 상태에서 `/ready`가 안전하게 degraded/failed를 반환한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/api -- adminRepository.test.ts adminServer.test.ts runtime.test.ts runtimeConfig.test.ts
npm run test:deployment
```

예상 결과: 관리자와 운영 준비도가 기능을 실제보다 좋게 표시하지 않는다.

- [ ] 회귀 커밋:

```bash
git add apps/api/src/adminRepository.test.ts apps/api/src/adminServer.test.ts apps/api/src/runtime.test.ts apps/api/src/runtimeConfig.test.ts apps/api/src/httpServer.ts scripts/deployment-contract.test.mjs
git commit -m "test(operations): verify admin and readiness truthfulness"
```

## Task 7: worker Docker image와 Compose 완성

**Files:**

- Create: `workers/brand-pilot-dm-worker/Dockerfile`
- Create: `workers/brand-pilot-content-proposal-worker/Dockerfile`
- Create: `deploy/env/dm-worker.env.example`
- Create: `deploy/env/wiki-worker.env.example`
- Create: `deploy/env/content-proposal-worker.env.example`
- Modify: `deploy/compose.production.yml`
- Modify: `../.github/workflows/publish-brand-pilot-server-images.yml`
- Modify: `scripts/deployment-contract.test.mjs`
- Modify: `deploy/scripts/preflight.sh`

- [ ] API image 외에 동일 SHA의 DM/Wiki/content-proposal worker image를 GHCR에 publish한다.
- [ ] worker 이미지는 non-root, read-only rootfs, tmpfs, cap drop, no-new-privileges, log rotation을 사용한다.
- [ ] compose에 `dm-worker-1`, `dm-worker-2`, `wiki-worker-1`, `content-proposal-worker-1` profile을 추가한다.
- [ ] worker마다 고유 `WORKER_ID`와 전용 env file을 사용한다.
- [ ] DB credential은 필요한 최소 권한으로 분리하고 API service token을 공용으로 재사용하지 않는다.
- [ ] first deploy에서는 worker profile을 올리지 않는다.
- [ ] D 콘텐츠 기능을 활성화할 때는 manual proposal worker heartbeat/readiness를 먼저 확인한다. `AUTOMATED_CONTENT_ENABLED=false`는 scheduled proposal만 끄며, 사용자가 요청한 manual proposal은 별도 `CONTENT_PROPOSALS_ENABLED` gate와 proposal worker가 준비된 경우에만 연다.
- [ ] API `/ready`와 worker heartbeat를 확인한 뒤 Wiki → DM 1 → DM 2 순서가 아니라, 설계 기준에 맞춰 충돌이 없는 실제 activation order를 test에 고정한다.
  - Wiki build가 필요하면 Wiki worker를 먼저 올려 active version을 확인한다.
  - 그 다음 DM worker 1을 올리고 lease/heartbeat 확인 후 DM worker 2를 올린다.
- [ ] 기존 remote worker heartbeat/lease가 만료되기 전 새 worker를 켜지 않는다.
- [ ] automated content workers는 첫 Ubuntu stack에 포함하지 않는다.
- [ ] 실행:

```bash
npm run test:deployment
docker compose -f deploy/compose.production.yml --env-file deploy/release.env.example config
```

예상 결과: safe default compose에는 API/Caddy만, 명시적 profile에는 DM/Wiki worker가 정확히 포함된다.

- [ ] 구현 커밋:

```bash
git add workers/brand-pilot-dm-worker/Dockerfile workers/brand-pilot-content-proposal-worker/Dockerfile deploy/env deploy/compose.production.yml ../.github/workflows/publish-brand-pilot-server-images.yml scripts/deployment-contract.test.mjs deploy/scripts/preflight.sh
git commit -m "chore(deploy): package api dm and wiki services"
```

## Task 8: 환경값 정책과 OAuth 주소 전환 runbook

**Files:**

- Modify: `docs/operations/UBUNTU_DEPLOYMENT.md`
- Create: `docs/operations/OAUTH_CUTOVER.md`
- Modify: `deploy/env/api.env.example`
- Modify: `deploy/scripts/preflight.sh`
- Modify: `scripts/deployment-contract.test.mjs`

- [ ] 실제 env 위치를 고정한다.

```text
/opt/brand-pilot/shared/env/api.env
/opt/brand-pilot/shared/env/dm-worker-1.env
/opt/brand-pilot/shared/env/dm-worker-2.env
/opt/brand-pilot/shared/env/wiki-worker-1.env
/opt/brand-pilot/shared/env/content-proposal-worker-1.env
```

- [ ] mode 600, owner `bpdeploy`, directory mode 700을 preflight에서 검증한다.
- [ ] container/image 교체가 위 env 파일을 생성·수정·삭제하지 않는지 test한다.
- [ ] 재발급 정책을 runbook에 명시한다.
  - 그대로 재사용: Kakao REST key/client secret, Meta app ID/secret, webhook verify token, Supabase key, Blob token — 노출·정책 변경이 없으면 재발급 불필요
  - 반드시 유지: `CREDENTIAL_ENCRYPTION_KEY` — 변경하면 기존 저장 credential 복호화가 실패하므로 임의 재발급 금지
  - 계획적으로 교체 가능: worker/admin/cron token — 양쪽 동시 전환과 rollback 값 보관
  - 노출 의심 시 즉시 회전: 모든 secret
- [ ] 운영 callback을 고정한다.

```text
Kakao: https://api.danbammsg.co.kr/auth/kakao/callback
Meta login: https://api.danbammsg.co.kr/auth/meta/callback
Meta trends: https://api.danbammsg.co.kr/auth/meta/trends/callback
Meta webhook: https://api.danbammsg.co.kr/webhooks/meta/instagram
Frontend: https://app.danbammsg.co.kr
```

- [ ] 공급자 콘솔에는 기존 callback을 제거하기 전에 새 callback을 먼저 추가한다.
- [ ] `AUTH_FRONTEND_URL`과 CORS는 `https://app.danbammsg.co.kr`을 허용하고 arbitrary origin은 거절한다.
- [ ] Kakao/Meta는 실제 로그인·취소·state mismatch·token decryption을 canary에서 검증하되 secret을 log하지 않는다.
- [ ] 실행:

```bash
npm run test:deployment
deploy/scripts/preflight.sh /opt/brand-pilot/releases/<sha>/release.env
```

예상 결과: 누락·권한 오류·unsafe flag·redirect mismatch를 배포 전에 발견한다.

- [ ] runbook 커밋:

```bash
git add docs/operations/UBUNTU_DEPLOYMENT.md docs/operations/OAUTH_CUTOVER.md deploy/env/api.env.example deploy/scripts/preflight.sh scripts/deployment-contract.test.mjs
git commit -m "docs(deploy): define env and oauth cutover"
```

## Task 9: DNS, HTTPS, Tailscale 관리 경계 runbook

**Files:**

- Modify: `docs/operations/UBUNTU_DEPLOYMENT.md`
- Modify: `deploy/Caddyfile`
- Modify: `deploy/Caddyfile.canary`
- Modify: `scripts/deployment-contract.test.mjs`

- [ ] Tailscale은 관리 plane으로만 사용한다.
  - Windows dev: `100.90.110.88`
  - Ubuntu: `100.106.196.48`
  - SSH: `ssh chu1@100.106.196.48`
  - 운영 문서와 자동화는 IP를 영구 상수로 박지 않고 `brand-pilot-dev-windows`, `brand-pilot-ubuntu` 장치명과 `tailscale status`의 현재 값을 확인한다.
  - public OAuth/webhook DNS를 Tailscale IP로 설정하지 않는다.
- [ ] `api.danbammsg.co.kr`과 `canary-api.danbammsg.co.kr`의 DNS A/AAAA를 Ubuntu public reachability에 맞게 설정하는 절차를 작성한다.
- [ ] NAT/router 뒤이면 TCP 80/443만 Ubuntu로 전달하고 22/4000/5432는 public open하지 않는다.
- [ ] Ubuntu UFW는 `OpenSSH`를 Tailscale interface에서만 허용하는 정책을 우선하고 public 80/443만 연다.
- [ ] Caddy가 ACME 인증서를 발급하고 HTTP→HTTPS, HSTS, reverse proxy, request size/timeouts를 적용한다.
- [ ] API port 4000은 Docker internal `expose`만 사용한다.
- [ ] frontend `app.danbammsg.co.kr`은 Vercel custom domain에 연결하고 API와 분리한다.
- [ ] DNS propagation 전 canary를 hosts override로 검증하는 절차와 propagation 후 실제 public 검증을 구분한다.
- [ ] 실행:

```bash
docker compose -f deploy/compose.production.yml --env-file /opt/brand-pilot/releases/<sha>/release.env config
curl -fsS https://canary-api.danbammsg.co.kr/health
curl -fsS https://canary-api.danbammsg.co.kr/ready
```

예상 결과: 공개 HTTPS는 Caddy만 받고 관리 SSH는 Tailscale로만 접근한다.

- [ ] 네트워크 경계 커밋:

```bash
git add docs/operations/UBUNTU_DEPLOYMENT.md deploy/Caddyfile deploy/Caddyfile.canary scripts/deployment-contract.test.mjs
git commit -m "chore(deploy): define dns https and tailscale boundary"
```

## Task 10: canary·promote·rollback·backup/restore 리허설

**Files:**

- Modify: `deploy/scripts/deploy.sh`
- Modify: `deploy/scripts/verify-canary.sh`
- Modify: `deploy/scripts/promote.sh`
- Modify: `deploy/scripts/rollback.sh`
- Create: `deploy/scripts/backup-state.sh`
- Create: `deploy/scripts/restore-state.sh`
- Modify: `scripts/deployment-contract.test.mjs`
- Modify: `docs/operations/UBUNTU_DEPLOYMENT.md`

- [ ] GitHub release artifact의 SHA256, image digest, release SHA를 검증한다.
- [ ] deploy lock과 interrupted transition reconciliation을 유지한다.
- [ ] canary는 read-only로 다음을 검증한다.
  - `/health`, `/ready`
  - allowed/denied CORS
  - secure cookie
  - auth dev route 404
  - DB read
  - Brand Core/product/Wiki read
  - generation usage read
  - channel capability read
  - publish/DM safe flags false
- [ ] canary에서 유료 AI 생성, 실제 DM 전송, 실제 SNS 게시를 자동 실행하지 않는다.
- [ ] promote 직전 DB migration backup metadata와 current release state를 기록한다.
- [ ] rollback은 이전 digest와 동일 external env를 사용한다.
- [ ] backup/restore는 DB provider backup 식별자, Caddy data, release manifests, env checksum을 기록하되 secret 원문을 archive에 복사하지 않는다.
- [ ] 별도 test database에서 실제 restore 후 schema/version/row count를 검증한다.
- [ ] 즉시 rollback 조건을 고정한다.
  - OAuth 반복 실패
  - credential decryption 실패
  - DM/게시 중복
  - API 5분 초과 중단
  - migration 불일치
- [ ] 실행:

```bash
npm run test:deployment
shellcheck deploy/scripts/*.sh
deploy/scripts/deploy.sh /opt/brand-pilot/releases/<sha>/release.env
deploy/scripts/verify-canary.sh https://canary-api.danbammsg.co.kr https://app.danbammsg.co.kr
deploy/scripts/promote.sh /opt/brand-pilot/releases/<sha>/release.env
deploy/scripts/rollback.sh
```

예상 결과: canary 실패는 primary를 건드리지 않고, promote 후에도 이전 SHA로 되돌릴 수 있다.

- [ ] 구현 커밋:

```bash
git add deploy/scripts scripts/deployment-contract.test.mjs docs/operations/UBUNTU_DEPLOYMENT.md
git commit -m "chore(deploy): verify canary rollback and restore"
```

## Task 11: Git·Vercel·Ubuntu 반복 개발 흐름 문서화

**Files:**

- Create: `docs/operations/DEVELOPMENT_AND_RELEASE_FLOW.md`
- Modify: `README.md`

- [ ] source of truth를 GitHub `dkskrn2/main`으로 고정한다.
- [ ] Windows에서 feature branch/worktree로 개발하고 테스트 후 PR/merge한다.
- [ ] frontend 변경은 Vercel이 repository commit을 build/deploy한다.
- [ ] server 변경은 GitHub Actions가 GHCR에 `sha-<commit>` 이미지를 publish한다.
- [ ] Ubuntu는 source를 직접 수정하거나 build하지 않고 release manifest와 image digest를 pull한다.
- [ ] Tailscale은 SSH로 deploy command·log·health를 관리하는 통로이며 code sync 도구로 사용하지 않는다.
- [ ] `/opt/brand-pilot/shared/env`는 Git pull/image pull의 영향을 받지 않는다.
- [ ] rollback 가능한 immutable SHA를 사용하고 `latest` 단독 배포를 금지한다.
- [ ] frontend-only, server-only, migration 포함 release의 검증 명령을 각각 작성한다.
- [ ] 문서 검토 후 커밋:

```bash
git add docs/operations/DEVELOPMENT_AND_RELEASE_FLOW.md README.md
git commit -m "docs: define continuous development and release flow"
```

## Task 12: 최종 pre-production gate

**Files:**

- Modify: `docs/quality/d-hybrid-regression-matrix.md`
- Modify: `docs/prd/brand-pilot-feature-preservation-ledger.md`

- [ ] 아래 명령을 깨끗한 checkout과 Ubuntu-compatible CI에서 실행한다.

```bash
npm ci
npm run test:regression-matrix
npm run test:contract
npm run test:migrations
npm run test:deployment
npm test
npm run build
npm run test:e2e
git diff --check
git status --short
```

- [ ] API, DM, Wiki, content-proposal worker image를 build하고 digest를 기록한다.
- [ ] Vercel preview에서 desktop/mobile/accessibility/smoke를 실행한다.
- [ ] Ubuntu canary에 safe flags false로 배포한다.
- [ ] OAuth callback·CORS·cookie·read-only API를 수동 확인한다.
- [ ] backup과 rollback 리허설을 통과한다.
- [ ] regression matrix의 모든 active ID에 pass evidence와 commit SHA를 기록한다.
- [ ] 의도한 evidence commit 후 `git status --short`가 비어 있는지 확인한다. 남은 파일이 있으면 배포하지 않고 소유 task/commit을 먼저 정리한다.
- [ ] 외부 고객·실시간 webhook traffic이 없는 내부 pilot임을 다시 확인하고, 있다면 dual receiver cutover 계획으로 승격한다.
- [ ] 승인 후에만 scheduler, publish, DM worker를 각각 독립적으로 활성화한다.

예상 결과: 기능 보존표, 보안 경계, 배포·복구가 모두 증빙된 release만 production으로 승격된다.

- [ ] 최종 커밋:

```bash
git add docs/quality/d-hybrid-regression-matrix.md docs/prd/brand-pilot-feature-preservation-ledger.md
git commit -m "test(release): record d-hybrid preproduction evidence"
```

## Brand Center live integration checkpoint (2026-07-30)

The following executable checks are required before the separate Ubuntu and
production browser-QA workflow. This checkpoint records development evidence
only; it does not mark deployment or production QA complete.

| Preserved behavior | Executable evidence |
| --- | --- |
| Bounded, abortable onboarding polling | `boundedAnalysisPoller.test.ts`, `brandCenterLiveOnboarding.test.tsx`, `brand-center-live-integration.spec.ts` |
| Hidden legacy analysis payload survives visible category edits | `brandCenterLiveOnboarding.test.tsx`, `brand-center-live-integration.spec.ts` |
| Exactly six Brand Center tabs and secondary policy/issues controls | `brandCenter.test.tsx`, `brandCenterRouting.test.tsx`, `brand-center-live-integration.spec.ts` |
| Style accepts confirmed same-brand image references only | `StyleReferenceImageBoard.test.tsx`, `brandCoreContracts.test.ts`, `brandCoreRepository.test.ts`, `server.brandCenterCustomer.test.ts` |
| First Wiki is provisioned by Instagram enable, not onboarding | `dmAutomation.test.tsx`, `channels.test.tsx`, `repository.dmWiki.test.ts`, `repository.dmWiki.pglite.test.ts`, `server.dmOperations.test.ts` |
| Product changes coalesce at the next 03:00 KST boundary | `productLibraryRepository.test.ts`, `db.transaction.test.ts` |
| Avatar backend remains available while the canonical panel stays unmounted | `brandCenter.test.tsx`, `avatarLibrary.test.tsx`, `libraryGateway.test.ts`, `server.assetLibraryCustomer.test.ts` |

Run the customer checkpoint:

```bash
npm run test --workspace @brand-pilot/customer-ui -- brandCenterLiveOnboarding.test.tsx boundedAnalysisPoller.test.ts brandCenter.test.tsx brandCenterRouting.test.tsx BrandCoreReviewPanel.test.tsx wikiLibrary.test.tsx productServiceLibrary.test.tsx StyleReferenceImageBoard.test.tsx referenceLibrary.test.tsx dmAutomation.test.tsx channels.test.tsx avatarLibrary.test.tsx
npm run build --workspace @brand-pilot/customer-ui
npm run e2e --workspace @brand-pilot/customer-ui -- brand-center-live-integration.spec.ts
```

Run the server/worker checkpoint with local Docker PostgreSQL only:

```bash
npm run test --workspace @brand-pilot/api -- brandCoreContracts.test.ts brandCoreRepository.test.ts server.brandCenterCustomer.test.ts repository.dmWiki.test.ts repository.dmWiki.pglite.test.ts server.dmOperations.test.ts productLibraryRepository.test.ts server.assetLibraryCustomer.test.ts
npm run test --workspace @brand-pilot/dm-worker -- db.transaction.test.ts
npm run test:contract
npm run test:migrations
```
