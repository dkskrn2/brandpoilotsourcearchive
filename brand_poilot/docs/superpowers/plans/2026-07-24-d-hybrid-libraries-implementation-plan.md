# Brand Pilot Reusable Libraries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 제품·서비스, 공유 Wiki, 모델·아바타, 브랜드·콘텐츠 레퍼런스를 브랜드별 재사용 자산으로 정리하고 콘텐츠와 Instagram DM이 올바른 권한으로 조회하게 한다.

**Architecture:** 기존 subject analysis, knowledge/Wiki, Instagram trend, reference URL 데이터를 삭제하지 않는다. 제품·서비스와 아바타는 stable entity + version/asset 구조를 추가하고, 레퍼런스는 기존 저장 자료를 canonical `reference_items`로 연결한다. 통합 UI는 각각의 원본 상태를 유지하며 새 gateway를 통해 검색·필터·저장·archive를 제공한다.

**Tech Stack:** PostgreSQL, Fastify, TypeScript, PGlite/Vitest, React, Testing Library, Playwright, Vercel Blob-compatible storage.

---

## Task 1: 기존 제품 분석·Wiki·트렌드 저장 동작 고정

**Files:**

- Modify: `apps/api/src/aiContentSubjectRepository.test.ts`
- Modify: `apps/api/src/repository.dmWiki.test.ts`
- Modify: `apps/api/src/instagramTrendRepository.test.ts`
- Modify: `apps/customer-ui/src/__tests__/instagramTrends.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/archive.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/dmAutomation.test.tsx`

- [ ] 제품·서비스 분석 facts, targets 3안, target별 appeals, image selection을 fixture로 고정한다.
- [ ] Wiki의 brand isolation, active version, FAQ exact match, retrieval priority를 고정한다.
- [ ] trend save가 `brand_trend_saved_media`와 `source_urls(source_type='reference')`를 연결하는 동작을 고정한다.
- [ ] 참고 URL 활성 10개, 최근 7일 고유 hashtag 30개 제한을 테스트한다.
- [ ] `/archive`가 생성 결과가 아닌 저장 trend임을 테스트 명칭에 명확히 적는다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/api -- aiContentSubjectRepository.test.ts repository.dmWiki.test.ts instagramTrendRepository.test.ts
npm run test --workspace @brand-pilot/customer-ui -- instagramTrends.test.tsx archive.test.tsx dmAutomation.test.tsx
```

예상 결과: 기존 기준선이 통과한다.

## Task 2: 제품·서비스 보관함 스키마 추가

**Files:**

- Create: `db/migrations/056_product_service_library.sql`
- Modify: `scripts/migrations.integration.test.mjs`
- Modify: `scripts/repository-contract.test.mjs`
- Create: `apps/api/src/productLibraryRepository.pglite.test.ts`

- [ ] stable identity와 승인 버전을 분리한다.

```sql
create table product_services (
  id uuid primary key,
  workspace_id uuid not null,
  brand_id uuid not null,
  kind text not null check (kind in ('product', 'service')),
  display_name text not null,
  status text not null default 'active'
    check (status in ('active', 'archived')),
  active_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id, brand_id),
  foreign key (brand_id, workspace_id)
    references brands(id, workspace_id) on delete cascade
);

create table product_service_versions (
  id uuid primary key,
  workspace_id uuid not null,
  brand_id uuid not null,
  product_service_id uuid not null,
  source_analysis_id uuid,
  version integer not null check (version > 0),
  status text not null check (status in ('draft', 'approved', 'superseded')),
  profile_json jsonb not null check (jsonb_typeof(profile_json) = 'object'),
  evidence_json jsonb not null default '[]'::jsonb
    check (jsonb_typeof(evidence_json) = 'array'),
  created_by_user_id uuid references app_users(id) on delete set null,
  approved_by_user_id uuid references app_users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id, brand_id),
  unique (workspace_id, brand_id, product_service_id, version)
);
```

- [ ] `product_service_assets`를 추가해 storage URL/path, mime, size, role(`hero|detail|logo|document`), position, source analysis image를 연결한다.
- [ ] version의 `product_service_id`, `source_analysis_id`와 asset의 version/source 관계는 모두 `(id, workspace_id, brand_id)` 복합 FK를 사용한다. `source_analysis_id`에는 같은 분석을 두 제품으로 중복 승격하지 않도록 non-null partial unique를 둔다.
- [ ] 한 item에 approved version은 하나만 허용한다.
- [ ] `active_version_id`는 item row를 잠근 승인 transaction에서 같은 workspace/brand/item의 approved version만 참조하게 한다.
- [ ] 기간성 오퍼, 시작일, 종료일 테이블은 만들지 않는다.
- [ ] 기존 `ai_content_subject_analyses`는 자동 백필하지 않는다. 사용자가 `보관함에 저장`한 분석만 item으로 승격한다.
- [ ] 기존 `knowledge_entries(entry_type='product')`는 누락 없이 승인된 product/service item과 version으로 idempotent backfill하고 provenance mapping을 남긴다. legacy product row는 읽기 전용 projection/inactive source로 표시해 두 군데에서 편집되지 않게 한다.
- [ ] Wiki 직접 입력을 위해 `knowledge_entries.last_import_id`를 nullable로 전환하고 `origin`, `provenance_json`, `status`, `created_by_user_id`, `approved_by_user_id`, `approved_at`을 추가한다. source/document/build unit 제약과 worker union에는 `product_service`, `service`, `guide`를 같은 migration에서 일관되게 추가한다.
- [ ] migration test에 기존 product knowledge backfill과 재실행, 다른 브랜드 asset 연결 거절, archive 보존, version uniqueness, 동시 승인 invariant를 추가한다.
- [ ] 이 task 안에서 repository-contract의 migration 목록과 schema smoke를 056까지 갱신한다.
- [ ] 실행:

```bash
npm run test:migrations
npm run test --workspace @brand-pilot/api -- productLibraryRepository.pglite.test.ts
```

예상 결과: 제품 identity와 승인 버전이 분리되고 기존 subject analysis schema가 유지된다.

## Task 3: 제품·서비스 계약, repository, API 구현

**Files:**

- Create: `apps/api/src/productLibraryContracts.ts`
- Create: `apps/api/src/productLibraryContracts.test.ts`
- Create: `apps/api/src/productLibraryRepository.ts`
- Create: `apps/api/src/productLibraryRepository.test.ts`
- Create: `apps/api/src/server.productLibraryCustomer.test.ts`
- Modify: `apps/api/src/brandCenterHttp.ts`
- Modify: `apps/api/src/server.brandCenterCustomer.test.ts`
- Modify: `apps/api/src/httpServer.ts`

- [ ] profile 계약을 정의한다.

```ts
export interface ProductServiceProfileV1 {
  contractVersion: "product-service.v1";
  name: string;
  kind: "product" | "service";
  description: string;
  features: string[];
  benefits: string[];
  cautions: string[];
  audiences: SubjectTarget[];
  appealsByTarget: Record<string, SubjectAppeal[]>;
  evergreenPurchaseInfo: string;
  sourceUrls: string[];
}
```

- [ ] `promotion`, `offerEndsAt`, 기간성 가격 혜택은 profile에서 제외한다.
- [ ] 아래 API를 추가한다.

| Method | Path |
|---|---|
| GET | `/brands/:brandId/product-services` |
| POST | `/brands/:brandId/product-services/from-analysis/:analysisId` |
| POST | `/brands/:brandId/product-services` |
| GET | `/brands/:brandId/product-services/:itemId` |
| PATCH | `/brands/:brandId/product-services/:itemId/draft` |
| POST | `/brands/:brandId/product-services/:itemId/approve` |
| POST | `/brands/:brandId/product-services/:itemId/archive` |

- [ ] from-analysis는 facts·targets·appeals·selected images를 snapshot으로 복사하고 원래 분석을 참조한다.
- [ ] create/from-analysis/draft/archive는 `actorUserId`와 creator actor를 기록하고, approve/archive는 repository에서 active workspace `owner | admin` 권한을 다시 확인한다.
- [ ] 승인 후 Wiki build request를 enqueue하되 Wiki가 준비되지 않아도 제품 승인은 성공한다.
- [ ] list는 active approved item을 기본으로 반환하고 `include=draft,archived`를 명시해야 추가 상태를 반환한다.
- [ ] 056 적용과 함께 `GET /brand-center`의 `products` 상태를 실제 repository 집계로 확장하고 `wiki`, `avatars`는 아직 `unavailable`로 둔다.
- [ ] 테스트에 idempotent from-analysis, member 승인 거절/admin 허용, 승인 충돌, 다른 브랜드 접근, archive 후 DM/콘텐츠 기본 조회 제외, brand-center aggregate를 포함한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/api -- productLibraryContracts.test.ts productLibraryRepository.test.ts server.productLibraryCustomer.test.ts
npm run build --workspace @brand-pilot/api
```

예상 결과: 승인 제품·서비스를 콘텐츠와 DM이 안정된 ID로 재사용할 수 있다.

- [ ] 구현 커밋:

```bash
git add db/migrations/056_product_service_library.sql apps/api/src/productLibrary* apps/api/src/server.productLibraryCustomer.test.ts apps/api/src/brandCenterHttp.ts apps/api/src/server.brandCenterCustomer.test.ts apps/api/src/httpServer.ts scripts/migrations.integration.test.mjs scripts/repository-contract.test.mjs
git commit -m "feat(libraries): add reusable product and service records"
```

## Task 4: Wiki 관리 API를 기존 저장소 위에 정리

**Files:**

- Create: `apps/api/src/wikiManagementContracts.ts`
- Create: `apps/api/src/wikiManagementContracts.test.ts`
- Create: `apps/api/src/server.wikiManagementCustomer.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/wiki.ts`
- Modify: `apps/api/src/brandCenterHttp.ts`
- Modify: `apps/api/src/server.brandCenterCustomer.test.ts`

- [ ] 기존 `/knowledge-imports`, `/wiki/status`, `/wiki/refresh`를 유지한다.
- [ ] 브랜드 센터용 aggregate API를 추가한다.

| Method | Path | 책임 |
|---|---|---|
| GET | `/brands/:brandId/wiki/items` | FAQ·정책·사용법·가이드 목록 |
| POST | `/brands/:brandId/wiki/items` | 직접 입력 |
| PATCH | `/brands/:brandId/wiki/items/:itemId` | draft 수정·활성 상태 변경 |
| GET | `/brands/:brandId/wiki/issues` | DM 지식 공백·품질 이슈 |
| POST | `/brands/:brandId/wiki/issues/:issueId/resolve` | 보완 항목과 issue 연결 |

- [ ] 정형 제품 정보는 product service library를 canonical source로 사용하고 Wiki item이 복제 저장하지 않게 한다.
- [ ] FAQ exact match는 기존 `knowledge_entries`를 계속 사용한다.
- [ ] 직접 입력 FAQ·정책·사용법·가이드는 `origin='manual'`, actor, provenance와 draft/active 상태를 저장한다. `last_import_id`가 없는 행도 계약상 유효하다.
- [ ] compiled `wiki_pages`는 파생물이므로 직접 PATCH하지 않는다. upstream source 승인 → build enqueue → 성공한 build의 active version 원자 교체만 허용한다.
- [ ] `product_service`, `service`, `guide` source kind를 API 계약, repository/build unit, Wiki worker normalizer/parser 전체에서 같은 union으로 처리한다.
- [ ] 새 관리 응답은 `sourceKind`, `sourceId`, `activeVersionId`, `lastBuiltAt`, `buildStatus`를 포함한다.
- [ ] refresh 실패 시 마지막 active Wiki version을 유지한다.
- [ ] item 작성은 member에게 허용할 수 있지만 approve/비활성화와 knowledge issue resolve는 owner/admin만 가능하며 `actorUserId`와 승인 actor를 기록한다.
- [ ] issue resolve 요청은 보완 source를 연결한 것만으로 완료하지 않는다. 승인된 source가 성공한 active Wiki version에 포함된 뒤에만 `resolved`로 전환하고, 그 전에는 `pending_build`로 둔다.
- [ ] 056 적용과 함께 `GET /brand-center`의 `wiki` 상태를 실제 repository 집계로 확장한다.
- [ ] 테스트에 manual item without import, inactive item 배제, product source 우선순위, member resolve 거절/admin 허용, pending_build→resolved, build failure stale 상태를 포함한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/api -- wikiManagementContracts.test.ts server.wikiManagementCustomer.test.ts wiki.test.ts repository.dmWiki.test.ts
npm run smoke:compiled-wiki
```

예상 결과: 기존 DM retrieval을 깨지 않고 관리 가능한 Wiki 보관함이 생긴다.

- [ ] 구현 커밋:

```bash
git add apps/api/src/wikiManagement* apps/api/src/server.wikiManagementCustomer.test.ts apps/api/src/brandCenterHttp.ts apps/api/src/server.brandCenterCustomer.test.ts apps/api/src/httpServer.ts apps/api/src/repository.ts apps/api/src/wiki.ts
git commit -m "feat(libraries): add managed wiki sources"
```

## Task 5: 아바타와 canonical 레퍼런스 스키마 추가

**Files:**

- Create: `db/migrations/057_avatar_and_reference_libraries.sql`
- Modify: `scripts/migrations.integration.test.mjs`
- Modify: `scripts/repository-contract.test.mjs`
- Create: `apps/api/src/assetLibraryRepository.pglite.test.ts`

- [ ] 아바타 테이블을 추가한다.

```sql
create table brand_avatars (
  id uuid primary key,
  workspace_id uuid not null,
  brand_id uuid not null,
  name text not null,
  description text not null default '',
  is_default boolean not null default false,
  status text not null default 'active'
    check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id, brand_id)
);

create unique index brand_avatars_one_default
  on brand_avatars (workspace_id, brand_id)
  where is_default and status = 'active';
```

- [ ] `brand_avatar_images`는 avatar당 1–5장, 대표 1장, position 1–5, image mime과 5MB 제한을 repository에서 강제한다.
- [ ] avatar/image/upload session에 `UNIQUE(id, workspace_id, brand_id)`와 creator actor를 두고, 기본 avatar와 대표 이미지는 각각 partial unique로 하나만 허용한다.
- [ ] 초상권·동의 여부 컬럼을 추가하지 않는다.
- [ ] canonical `reference_items`를 추가한다.
  - kind: `saved_brand | saved_content | trend | external_url | upload | owned_performance`
  - content purpose: `informational | marketing | both`
  - origin: 기존 table/row pointer 또는 직접 upload
  - title, preview, source URL, format, metadata, favorite, last used, archived
  - 같은 브랜드에서 동일 origin 중복 금지
- [ ] `reference_brands` stable entity를 추가해 platform, 실제 handle/display name, public source URL, permitted profile snapshot, saved/last-refreshed 시각과 actor를 저장한다. 임의 Instagram 계정 검색을 가장하지 않고 기존 hashtag 결과가 제공한 author 또는 사용자가 입력한 공개 profile URL만 저장한다.
- [ ] origin은 자유로운 polymorphic UUID 한 개로 저장하지 않는다. `reference_brand_id`, `source_url_id`, `saved_trend_id`, `channel_output_id`, `storage_artifact_id` nullable 복합 FK를 두고 정확히 하나만 존재하도록 `CHECK`한다.
- [ ] library upload용 nonce/session table은 발급 brand/path prefix, expected MIME/size/checksum, 만료 시각, confirmed 시각을 저장한다.
- [ ] `reference_patterns`는 `observations`, `interpretation`, `applicationIdeas`, `doNotCopy`, `confidence`, `analysisVersion`을 저장한다.
- [ ] 기존 `source_urls`의 reference 자료에 `content_purpose`를 추가한다.
  - 허용값: `informational | marketing | both`
  - 기존 reference URL은 `both`로 백필한다.
  - owned URL은 브랜드 사실 근거이므로 `both`로 해석한다.
  - 정보성과 마케팅성 URL을 별도 테이블로 복제하지 않는다.
- [ ] migration에서 기존 `brand_trend_saved_media`를 먼저 canonical item으로 백필한다. 그 media가 가리키는 `source_url_id`는 같은 item의 source origin/provenance로 병합하고, 저장 trend와 연결되지 않은 활성 reference `source_urls`만 별도 item으로 만든다.
- [ ] `saved trend + linked source URL = reference item 1개`를 migration fixture로 고정한다.
- [ ] 원본 행은 삭제하거나 소유권을 이동하지 않는다.
- [ ] reference archive/enable과 legacy source URL active/quota 상태는 한 transaction에서 동기화한다.
- [ ] 057 migration의 빈 DB, 기존 fixture upgrade, idempotent backfill, cross-tenant FK, concurrent default/avatar count와 repository-contract 목록/schema smoke를 같은 task에서 검증한다.
- [ ] 실행:

```bash
npm run test:migrations
npm run test --workspace @brand-pilot/api -- assetLibraryRepository.pglite.test.ts
```

예상 결과: 기존 저장 trend와 URL이 새 보관함에서 중복 없이 보인다.

## Task 6: 아바타·레퍼런스 API와 업로드 제한 구현

**Files:**

- Create: `apps/api/src/assetLibraryContracts.ts`
- Create: `apps/api/src/assetLibraryContracts.test.ts`
- Create: `apps/api/src/assetLibraryRepository.ts`
- Create: `apps/api/src/assetLibraryRepository.test.ts`
- Create: `apps/api/src/assetLibraryUpload.ts`
- Create: `apps/api/src/assetLibraryUpload.test.ts`
- Create: `apps/api/src/server.assetLibraryCustomer.test.ts`
- Modify: `apps/api/src/brandCenterHttp.ts`
- Modify: `apps/api/src/server.brandCenterCustomer.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/aiContentUpload.ts`

- [ ] 아바타 API를 구현한다.
  - `GET/POST /brands/:brandId/avatars`
  - `GET/PATCH /brands/:brandId/avatars/:avatarId`
  - `POST /brands/:brandId/avatars/:avatarId/images/upload-token`
  - `POST /brands/:brandId/avatars/:avatarId/images/confirm`
  - `DELETE /brands/:brandId/avatars/:avatarId/images/:imageId`
  - `POST /brands/:brandId/avatars/:avatarId/default`
  - `POST /brands/:brandId/avatars/:avatarId/archive`
- [ ] 레퍼런스 API를 구현한다.
  - `GET /brands/:brandId/references`
  - `POST /brands/:brandId/references/url`
  - `POST /brands/:brandId/references/upload-token`
  - `POST /brands/:brandId/references/confirm`
  - `POST /brands/:brandId/references/:referenceId/favorite`
  - `POST /brands/:brandId/references/:referenceId/archive`
  - `GET /brands/:brandId/references/:referenceId/pattern`
- [ ] 저장 브랜드 API를 구현한다.
  - `GET /brands/:brandId/reference-brands`
  - `POST /brands/:brandId/reference-brands` — 공개 profile URL/handle 저장
  - `POST /brands/:brandId/reference-brands/from-trend-media/:mediaId` — 실제 trend 응답에 author가 있을 때만 저장
  - `GET /brands/:brandId/reference-brands/:referenceBrandId/items` — 그 브랜드에서 실제 저장한 콘텐츠
- [ ] list filter는 `kind`, `contentFamily`, `strategy`, `format`, `origin`, `favorite`, `recent`를 지원한다.
- [ ] URL 추가는 기존 활성 reference URL 10개 제한을 공유한다.
- [ ] 업로드는 생성 첨부용 `aiContentUpload` path를 재사용하지 않고 전용 `assetLibraryUpload` namespace를 사용한다. confirm 시 발급 nonce/session, 현재 brand storage prefix, MIME, size, checksum, expiry를 모두 검증한다.
- [ ] 아바타는 PNG/JPEG/WebP 이미지만, 1장당 5MB만 허용한다. 일반 reference upload는 명시한 allowlist만 받으며 실행 파일·HTML을 거절한다.
- [ ] 업로드는 총 생성 첨부 제한과 별도로 library asset 제한을 적용하고 거절 파일 때문에 정상 파일을 삭제하지 않는다.
- [ ] avatar image 추가 transaction은 avatar row를 잠가 동시 업로드에서도 5장을 넘기지 않는다.
- [ ] create/edit는 active member actor를 기록하고 default/archive는 owner/admin 권한을 확인한다. reference origin은 같은 workspace/brand의 row만 연결한다.
- [ ] 057 적용과 함께 `GET /brand-center`의 `avatars` 상태를 실제 repository 집계로 확장한다.
- [ ] 레퍼런스의 pattern은 사실 근거 endpoint에서 반환하지 않는다.
- [ ] Meta/current adapter가 author·profile image를 반환하지 않으면 이름이나 이미지를 추측하지 않고 source link와 `프로필 미리보기 없음` 상태를 반환한다.
- [ ] 테스트에 동시 5장 초과, 2개 default, upload nonce replay/path 위조/MIME 위조, 중복 origin, 10 URL 초과, member archive 거절/admin 허용, 브랜드 격리, archive를 포함한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/api -- assetLibraryContracts.test.ts assetLibraryRepository.test.ts assetLibraryUpload.test.ts server.assetLibraryCustomer.test.ts server.brandCenterCustomer.test.ts aiContentUpload.test.ts
npm run build --workspace @brand-pilot/api
```

예상 결과: 자산 제한과 데이터 격리가 서버에서 강제된다.

- [ ] 구현 커밋:

```bash
git add db/migrations/057_avatar_and_reference_libraries.sql apps/api/src/assetLibrary* apps/api/src/server.assetLibraryCustomer.test.ts apps/api/src/brandCenterHttp.ts apps/api/src/server.brandCenterCustomer.test.ts apps/api/src/httpServer.ts apps/api/src/aiContentUpload.ts scripts/migrations.integration.test.mjs scripts/repository-contract.test.mjs
git commit -m "feat(libraries): add avatar and reference libraries"
```

## Task 7: 제품·서비스와 Wiki 브랜드 센터 UI 구현

**Files:**

- Create: `apps/customer-ui/src/features/libraries/libraryGateway.ts`
- Create: `apps/customer-ui/src/features/libraries/libraryGateway.test.ts`
- Create: `apps/customer-ui/src/components/brand-center/ProductServiceLibraryPanel.tsx`
- Create: `apps/customer-ui/src/components/brand-center/ProductServiceEditor.tsx`
- Create: `apps/customer-ui/src/components/brand-center/WikiLibraryPanel.tsx`
- Create: `apps/customer-ui/src/components/brand-center/WikiItemEditor.tsx`
- Modify: `apps/customer-ui/src/pages/BrandCenterPage.tsx`
- Create: `apps/customer-ui/src/__tests__/productServiceLibrary.test.tsx`
- Create: `apps/customer-ui/src/__tests__/wikiLibrary.test.tsx`

- [ ] 제품·서비스 panel은 list/detail split layout으로 구현한다.
- [ ] Brand Center의 disabled `products`, `wiki` 탭을 이 commit에서 실제 panel로 교체하고 API가 unavailable이면 오류가 아니라 배포 순서 안내 상태를 표시한다.
- [ ] 새 item 흐름은 `URL·문서·이미지 또는 직접 입력 → AI 분석 → 자동 입력된 draft → 사용자 수정 → 승인`이다.
- [ ] 기존 위저드의 subject analysis form과 result component를 재사용한다.
- [ ] `보관함에 저장` 후 stable item ID를 표시하고, content/DM 사용 가능 상태는 approved일 때만 켠다.
- [ ] Wiki panel은 FAQ, 정책, 사용법, 가이드, 지식 개선함을 filter한다.
- [ ] `/brand-center?tab=wiki&issue=<uuid>`를 parse해 같은 brand의 Wiki issue를 조회하고 detail에 focus한다.
  - invalid/다른 brand ID는 일반 Wiki 화면과 오류 안내로 돌아간다.
  - 이미 해결된 issue는 해결 상태와 연결된 보완 item을 보여준다.
  - dialog/drawer를 닫으면 issue를 연 호출 위치 또는 Wiki issue list로 focus를 복원한다.
- [ ] 제품·서비스에서 자동 유입된 Wiki source는 읽기 전용 source link로 보여준다.
- [ ] build 중/실패/stale/active 상태와 마지막 성공 버전을 구분한다.
- [ ] CSV template download와 기존 knowledge import UI를 보존한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/customer-ui -- libraryGateway.test.ts productServiceLibrary.test.tsx wikiLibrary.test.tsx brandCenter.test.tsx dmAutomation.test.tsx
```

예상 결과: 제품과 Wiki가 한 브랜드 센터 안에 있으나 canonical 책임을 섞지 않는다.

## Task 8: 아바타 보관함 UI 구현

**Files:**

- Create: `apps/customer-ui/src/components/brand-center/AvatarLibraryPanel.tsx`
- Create: `apps/customer-ui/src/components/brand-center/AvatarEditorDialog.tsx`
- Create: `apps/customer-ui/src/components/brand-center/AvatarImageUploader.tsx`
- Create: `apps/customer-ui/src/__tests__/avatarLibrary.test.tsx`
- Modify: `apps/customer-ui/src/pages/BrandCenterPage.tsx`

- [ ] card grid에서 대표 이미지, 이름, 기본값, 활성 상태를 표시한다.
- [ ] Brand Center의 disabled `avatars` 탭을 이 commit에서 실제 panel로 교체한다.
- [ ] 등록 dialog는 이름, 설명, 이미지 1–5장만 받는다.
- [ ] 대표 이미지와 기본 avatar는 별도 개념으로 처리한다.
- [ ] 이 단계에는 058의 generation draft reference 계약이 아직 없으므로 존재하지 않는 현재 draft를 추측해 경고하지 않는다. Content Tasks 4/9에서 실제 draft-reference 조회를 추가한 뒤 archive 경고를 활성화한다. 과거 generation snapshot은 항상 보존한다.
- [ ] `AI 아바타 생성`, 얼굴 합성, 음성, 초상권 동의 UI는 만들지 않는다.
- [ ] 이미지 5MB, MIME, 개수, 중복을 클라이언트와 서버 양쪽에서 검증한다.
- [ ] dialog focus trap, Escape, focus restore, upload progress/error retry를 테스트한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/customer-ui -- avatarLibrary.test.tsx FileUploadButton.test.tsx
```

예상 결과: 정적 콘텐츠용 아바타를 안전하게 재사용할 수 있다.

## Task 9: 통합 탐색·레퍼런스 UI 구현

**Files:**

- Create: `apps/customer-ui/src/pages/ReferenceLibraryPage.tsx`
- Create: `apps/customer-ui/src/components/references/ReferenceFilters.tsx`
- Create: `apps/customer-ui/src/components/references/ReferenceCard.tsx`
- Create: `apps/customer-ui/src/components/references/ReferenceDetailDialog.tsx`
- Create: `apps/customer-ui/src/components/references/ReferencePatternPanel.tsx`
- Create: `apps/customer-ui/src/components/references/SavedReferenceBrandsPanel.tsx`
- Create: `apps/customer-ui/src/components/references/ReferenceBrandDetailDialog.tsx`
- Create: `apps/customer-ui/src/components/references/InstagramTrendExplorerPanel.tsx`
- Create: `apps/customer-ui/src/components/references/SavedTrendReferencesPanel.tsx`
- Create: `apps/customer-ui/src/styles/references.css`
- Create: `apps/customer-ui/src/__tests__/referenceLibrary.test.tsx`
- Modify: `apps/customer-ui/src/routes.tsx`
- Modify: `apps/customer-ui/src/features/navigation/navigationModel.ts`
- Modify: `apps/customer-ui/src/features/help/helpGuides.ts`
- Modify: `apps/customer-ui/src/main.tsx`
- Modify: `apps/customer-ui/src/components/brand-center/SourceLibraryPanel.tsx`
- Modify: `apps/customer-ui/src/pages/SourcesPage.tsx`
- Modify: `apps/customer-ui/src/pages/InstagramTrendsPage.tsx`
- Modify: `apps/customer-ui/src/pages/ArchivePage.tsx`
- Modify: `apps/customer-ui/src/__tests__/sources.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/helpGuidance.test.tsx`

- [ ] `/references` view key를 `all | saved-brands | saved-content | trends | saved-trends | external-urls | recent | favorites | add`로 고정하고 화면에는 `전체`, `저장한 브랜드`, `저장한 콘텐츠`, `트렌드 탐색`, `저장한 트렌드`, `외부 URL`, `최근 사용`, `즐겨찾기`, `직접 추가`로 표시한다.
- [ ] 같은 commit에서 sidebar의 기존 `트렌드 탐색`과 `레퍼런스 보관함`을 하나의 `/references` 항목으로 전환한다. `/instagram-trends`와 `/archive`는 redirect로 유지한다.
- [ ] 같은 commit에서 Brand Center source panel의 disabled CTA를 `/references?view=external-urls`로 활성화하고, 기존 `SourcesPage`의 reference URL CRUD는 `ReferenceLibraryPage`의 external URL panel로 옮긴다.
- [ ] `/sources` 전환을 이 task가 소유한다.
  - 기본/owned query는 `/brand-center?tab=understanding&section=sources`로 보내고 충돌하지 않는 기존 query를 보존한다.
  - 기존 query가 reference 영역을 명시하면 `/references?view=external-urls`로 보낸다.
  - 이전 `SourcesPage`는 더 이상 route로 렌더링하지 않되 추출한 `useSourceWorkspace`와 source components는 두 canonical panel이 공유한다.
- [ ] legacy redirect는 OAuth/result/filter query를 보존한다.
  - `/instagram-trends?meta_trends=connected` → `/references?view=trends&meta_trends=connected`
  - `/archive?page=2` → `/references?view=saved-trends&page=2`
- [ ] `/references?view=trends`에 기존 Instagram trends 검색 UI를 embed한다.
- [ ] `/references?view=saved-trends`에 기존 archive UI를 embed한다.
- [ ] `/references?view=saved-brands`는 실제 저장한 public brand/author만 보여주고, brand detail은 그 출처에서 사용자가 저장한 실제 콘텐츠를 묶어 표시한다.
- [ ] 검색은 기존 Meta hashtag 결과와 사용자가 입력한 공개 profile URL/handle 범위만 사용한다. 지원되지 않는 임의 계정 검색·광고 DB·대규모 상시 모니터링을 UI나 API가 지원하는 것처럼 표시하지 않는다.
- [ ] route 전환 전에 `InstagramTrendsPage`와 `ArchivePage`의 본문 로직을 위 두 reusable panel로 추출한다. `ReferenceLibraryPage`는 page component를 중첩 렌더링하지 않으므로 legacy redirect recursion이 생기지 않는다.
- [ ] `/references` help guide, external URL 제한 안내, dynamic `view` mapping을 이 commit에서 추가한다.
- [ ] 각 card는 origin, 저장 시각, format, pattern 유무, favorite와 실제 snapshot 미리보기를 표시한다.
  - 저장 Instagram 콘텐츠: `instagram_trend_media`의 실제 media URL/thumbnail과 caption snapshot
  - reference URL: 마지막 성공 crawl의 title, 본문 요약, OG image
  - 자사 우수 콘텐츠: 실제 `PublishArtifact` preview와 관측 성과
  - 직접 업로드: 실제 thumbnail 또는 파일 metadata
- [ ] D mockup의 HTML placeholder, 예시 caption, 임의 thumbnail과 고정 성과 숫자는 production component에 복사하지 않는다.
- [ ] 원본 미디어를 브라우저에서 직접 읽을 수 없으면 API가 보관한 snapshot을 사용하고, 둘 다 없으면 `미리보기 없음`과 원본 링크를 표시한다.
- [ ] reference URL 등록 시 `정보성`, `마케팅성`, `둘 다` 용도를 필수 선택하고 list/filter에 노출한다.
- [ ] detail은 `관찰 사실`, `AI 해석`, `우리 브랜드 적용`, `모방하지 않을 요소`, 원본 링크를 분리한다.
- [ ] 외부 원본이 삭제되어도 snapshot metadata를 표시하고 새 fetch 실패를 기존 snapshot 삭제로 처리하지 않는다.
- [ ] 이 계획에서는 stable reference ID와 조회 API까지만 제공한다. `콘텐츠로 사용` action과 reload-safe handoff는 후속 콘텐츠 생성 계획에서 연결해 아직 없는 화면에 의존하지 않는다.
- [ ] Reel trend 자료는 레퍼런스로 볼 수 있지만 `Reel 만들기` CTA를 노출하지 않는다.
- [ ] card grid는 최초 페이지 진입 시 thumbnail metadata만 받고, detail/전체 caption/artifact는 viewport 진입 또는 dialog open 시 지연 로드한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/customer-ui -- referenceLibrary.test.tsx instagramTrends.test.tsx archive.test.tsx sources.test.tsx helpGuidance.test.tsx navigation.test.tsx
npm run build --workspace @brand-pilot/customer-ui
```

예상 결과: 기존 trend 검색·저장 기능이 통합 보관함 안에서도 그대로 동작한다.

- [ ] UI 커밋:

```bash
git add apps/customer-ui/src/features/libraries apps/customer-ui/src/features/navigation/navigationModel.ts apps/customer-ui/src/features/help/helpGuides.ts apps/customer-ui/src/components/brand-center apps/customer-ui/src/components/references apps/customer-ui/src/pages/BrandCenterPage.tsx apps/customer-ui/src/pages/ReferenceLibraryPage.tsx apps/customer-ui/src/pages/SourcesPage.tsx apps/customer-ui/src/pages/InstagramTrendsPage.tsx apps/customer-ui/src/pages/ArchivePage.tsx apps/customer-ui/src/styles/references.css apps/customer-ui/src/routes.tsx apps/customer-ui/src/main.tsx apps/customer-ui/src/__tests__
git commit -m "feat(libraries): build reusable asset and reference interfaces"
```

## Task 10: 라이브러리 E2E와 신뢰 경계 검증

**Files:**

- Create: `apps/customer-ui/e2e/brand-libraries.spec.ts`
- Create: `apps/api/src/libraryTrustBoundary.test.ts`
- Modify: `scripts/compiled-wiki-smoke.mjs`

- [ ] 제품 분석 → 보관 → 승인 → 콘텐츠 선택 가능 시나리오를 검증한다.
- [ ] Wiki item 추가 → refresh → active version → DM retrieval 시나리오를 검증한다.
- [ ] 아바타 2장 등록 → 대표/기본 지정 → archive 후 과거 snapshot 보존을 검증한다.
- [ ] trend 저장 → canonical reference 노출 → pattern detail → stable reference ID 조회를 검증한다.
- [ ] linked source URL을 가진 saved trend가 reference item 한 개로만 보이고 archive/quota 상태가 legacy row와 원자적으로 동기화되는지 검증한다.
- [ ] 다른 brand의 origin ID·upload path를 연결할 수 없고 member가 승인/보관/issue resolve 권한을 우회할 수 없는지 검증한다.
- [ ] 외부 reference의 unsupported claim이 product fact나 DM answer source로 들어가지 않는 테스트를 추가한다.
- [ ] 실행:

```bash
npm run test:migrations
npm run test --workspace @brand-pilot/api -- libraryTrustBoundary.test.ts
npm run smoke:compiled-wiki
npm run e2e --workspace @brand-pilot/customer-ui -- brand-libraries.spec.ts
npm run test --workspace @brand-pilot/api
npm run test --workspace @brand-pilot/customer-ui
```

예상 결과: 네 보관함이 재사용 가능하며 사실과 영감의 경계가 깨지지 않는다.

- [ ] 최종 커밋:

```bash
git add apps/customer-ui/e2e/brand-libraries.spec.ts apps/api/src/libraryTrustBoundary.test.ts scripts/compiled-wiki-smoke.mjs
git commit -m "test(libraries): verify reuse and trust boundaries"
```
