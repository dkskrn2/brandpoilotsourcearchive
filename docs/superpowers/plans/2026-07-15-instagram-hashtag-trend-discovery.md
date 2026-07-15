# Instagram Hashtag Trend Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broad brand industry field with a fixed category taxonomy and add an authenticated Instagram hashtag trend explorer that reads Meta `top_media`, shares a 24-hour cache, and saves selected media as brand reference sources.

**Architecture:** PostgreSQL stores the shared category catalog, global Instagram trend cache, tenant-scoped search/favorite history, Meta quota usage, and saved-source links. A focused API domain module validates hashtags and maps Meta payloads; a focused repository module owns cache, locking, quota, and source-save transactions. Fastify exposes authenticated brand routes. React adds category controls to brand settings and a new trend explorer page. The central API calls Meta directly; no cron or new worker is introduced.

**Tech Stack:** PostgreSQL/Supabase, TypeScript, Fastify 5, `pg`, React 18, React Router 6, Vitest, Testing Library, Playwright, Meta Instagram Graph API with Facebook Login.

**Approved design:** `docs/superpowers/specs/2026-07-15-instagram-hashtag-trend-discovery-design.md`

---

## Execution Order

Tasks are sequential unless a task explicitly says otherwise. Category tables and profile contracts must land before trend UI work because the trend page uses category hashtag recommendations. The Meta client and PostgreSQL repository may be developed independently after Task 2, but they must be integrated only after both pass their focused tests.

### Task 1: Add Category And Instagram Trend Schema

**Files:**
- Create: `db/migrations/029_instagram_hashtag_trends.sql`
- Modify: `db/smoke/001_schema_smoke.sql`
- Modify: `scripts/migrations.integration.test.mjs`

- [ ] Write a failing migration integration test that applies all migrations and asserts:
  - exactly 15 active categories;
  - exactly 105 active system subcategories;
  - exactly 45 active category hashtag recommendations;
  - `brand_profiles.primary_category_id` exists while `industry` still exists;
  - all six trend tables and their tenant/global unique indexes exist;
  - custom/system subcategory exclusivity is enforced;
  - duplicate Meta media IDs and duplicate `(hashtag_id, meta_rank)` rows are rejected.

Add a focused test near the end of `scripts/migrations.integration.test.mjs`:

```js
test("029 creates the category catalog and Instagram trend cache", async () => {
  await withDatabase(async (database) => {
    const migrations = await loadMigrations();
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "029_instagram_hashtag_trends.sql",
    );

    const counts = await database.query(`
      select
        (select count(*)::int from content_categories where active) as categories,
        (select count(*)::int from content_subcategories where active) as subcategories,
        (select count(*)::int from content_category_hashtags where active) as hashtags
    `);
    assert.deepEqual(counts.rows[0], {
      categories: 15,
      subcategories: 105,
      hashtags: 45,
    });

    const columns = await database.query(`
      select column_name
      from information_schema.columns
      where table_name = 'brand_profiles'
        and column_name in ('industry', 'primary_category_id')
      order by column_name
    `);
    assert.deepEqual(columns.rows.map((row) => row.column_name), ["industry", "primary_category_id"]);
  });
});
```

- [ ] Run the focused test and confirm it fails because migration `029` does not exist.

```powershell
node --test scripts/migrations.integration.test.mjs
```

Expected: failure mentioning `content_categories` or missing migration `029`.

- [ ] Create migration `029_instagram_hashtag_trends.sql` with the exact schema from design sections 7 and 9.

Use these table and constraint names so later repository SQL and tests remain stable:

```sql
create table content_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order integer not null check (sort_order > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table content_subcategories (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references content_categories(id),
  code text not null,
  name text not null,
  sort_order integer not null check (sort_order > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, code)
);

create table content_category_hashtags (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references content_categories(id),
  subcategory_id uuid null references content_subcategories(id),
  normalized_tag text not null,
  display_tag text not null,
  sort_order integer not null check (sort_order > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index content_category_hashtags_unique
  on content_category_hashtags (
    category_id,
    coalesce(subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid),
    normalized_tag
  );

alter table brand_profiles
  add column primary_category_id uuid null references content_categories(id);

create table brand_profile_subcategories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  brand_id uuid not null references brands(id) on delete cascade,
  brand_profile_id uuid not null references brand_profiles(id) on delete cascade,
  subcategory_id uuid null references content_subcategories(id),
  custom_name text null,
  custom_key text null,
  created_at timestamptz not null default now(),
  constraint brand_profile_subcategories_mode_check check (
    (subcategory_id is not null and custom_name is null and custom_key is null)
    or
    (subcategory_id is null and custom_name is not null and custom_key is not null)
  ),
  constraint brand_profile_subcategories_custom_name_check check (
    custom_name is null or char_length(btrim(custom_name)) between 1 and 30
  )
);

create unique index brand_profile_subcategories_system_unique
  on brand_profile_subcategories (brand_profile_id, subcategory_id)
  where subcategory_id is not null;
create unique index brand_profile_subcategories_custom_unique
  on brand_profile_subcategories (brand_profile_id, custom_key)
  where custom_key is not null;

create table instagram_trend_hashtags (
  id uuid primary key default gen_random_uuid(),
  normalized_tag text not null unique,
  display_tag text not null,
  meta_hashtag_id text null,
  last_refreshed_at timestamptz null,
  last_error_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table instagram_trend_media (
  id uuid primary key default gen_random_uuid(),
  instagram_media_id text not null unique,
  username text null,
  caption text null,
  media_type text not null check (media_type in ('IMAGE', 'VIDEO', 'CAROUSEL_ALBUM')),
  media_url text null,
  permalink text not null,
  posted_at timestamptz null,
  like_count bigint null check (like_count is null or like_count >= 0),
  comments_count bigint null check (comments_count is null or comments_count >= 0),
  last_fetched_at timestamptz not null,
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table instagram_trend_hashtag_media (
  hashtag_id uuid not null references instagram_trend_hashtags(id) on delete cascade,
  media_id uuid not null references instagram_trend_media(id) on delete cascade,
  meta_rank integer not null check (meta_rank between 1 and 50),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  primary key (hashtag_id, media_id),
  unique (hashtag_id, meta_rank)
);

create table brand_trend_searches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  brand_id uuid not null references brands(id) on delete cascade,
  hashtag_id uuid not null references instagram_trend_hashtags(id) on delete cascade,
  is_favorite boolean not null default false,
  last_searched_at timestamptz not null,
  search_count integer not null default 1 check (search_count > 0),
  unique (brand_id, hashtag_id)
);

create table instagram_trend_account_hashtags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  brand_id uuid not null references brands(id) on delete cascade,
  brand_channel_id uuid not null references brand_channels(id) on delete cascade,
  hashtag_id uuid not null references instagram_trend_hashtags(id) on delete cascade,
  quota_window_started_at timestamptz not null,
  last_meta_queried_at timestamptz not null,
  unique (brand_channel_id, hashtag_id)
);

create table brand_trend_saved_media (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  brand_id uuid not null references brands(id) on delete cascade,
  trend_media_id uuid not null references instagram_trend_media(id) on delete cascade,
  source_url_id uuid not null references source_urls(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (brand_id, trend_media_id),
  unique (source_url_id)
);
```

Add tenant lookup indexes for `brand_profile_subcategories(brand_id)`, `brand_trend_searches(brand_id, last_searched_at desc)`, `instagram_trend_account_hashtags(brand_channel_id, quota_window_started_at)`, and `brand_trend_saved_media(brand_id)`. Attach the existing `set_updated_at()` trigger to mutable tables.

- [ ] Seed the exact 15 categories, 105 system subcategories, and 45 recommended hashtags listed in approved design section 6. Use stable lowercase snake-case codes. Never derive codes from Korean display names at runtime.

- [ ] Backfill only unambiguous legacy values. Use an explicit `values (legacy_value, category_code)` table, not fuzzy matching. Leave unknown values such as `서비스` and `여행 서비스` unmapped so the UI requires selection.

- [ ] Extend `db/smoke/001_schema_smoke.sql` with existence checks for the ten new tables and the `primary_category_id` column.

- [ ] Run migration and smoke tests.

```powershell
npm run test:migrations
```

Expected: all migration tests pass; seed counts are `15/105/45`.

- [ ] Commit.

```powershell
git add db/migrations/029_instagram_hashtag_trends.sql db/smoke/001_schema_smoke.sql scripts/migrations.integration.test.mjs
git commit -m "feat: add brand categories and Instagram trend schema"
```

### Task 2: Define Category And Trend Contracts

**Files:**
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/server.test.ts`
- Modify: `apps/customer-ui/src/types.ts`

- [ ] Update the server test repository fixture first so TypeScript exposes every required new repository method and new profile shape.

The profile contract becomes:

```ts
export interface BrandSubcategoryDto {
  type: "system" | "custom";
  code: string | null;
  name: string;
}

export interface BrandProfileDto {
  id: string;
  brandId: string;
  name: string;
  primaryCategory: { code: string; name: string } | null;
  subcategories: BrandSubcategoryDto[];
  primaryCustomer: string;
  description: string;
  tone: string;
  defaultCta: string;
  mainLink: string;
  autoApprovalEnabled: boolean;
  logoUrl: string | null;
}

export interface BrandProfileInput {
  name?: string;
  primaryCategoryCode?: string | null;
  subcategories?: Array<
    | { type: "system"; code: string }
    | { type: "custom"; name: string }
  >;
  primaryCustomer?: string;
  description?: string;
  tone?: string;
  defaultCta?: string;
  mainLink?: string;
  autoApprovalEnabled?: boolean;
}
```

Do not expose or accept `industry` in the HTTP DTO after this task. The physical DB column remains only for rollback compatibility.

- [ ] Add these shared API contracts to `apps/api/src/types.ts` and matching UI contracts to `apps/customer-ui/src/types.ts`:

```ts
export type InstagramTrendMediaKind = "reel" | "video" | "image" | "carousel";
export type InstagramTrendSort = "meta" | "likes" | "comments";

export interface ContentCategoryDto {
  code: string;
  name: string;
  recommendedHashtags: string[];
  subcategories: Array<{ code: string; name: string }>;
}

export interface InstagramTrendMediaDto {
  id: string;
  instagramMediaId: string;
  username: string | null;
  caption: string | null;
  kind: InstagramTrendMediaKind;
  mediaUrl: string | null;
  previewUrl: string | null;
  permalink: string;
  postedAt: string | null;
  likeCount: number | null;
  commentsCount: number | null;
  metaRank: number;
  refreshedAt: string;
  isSaved: boolean;
}

export interface InstagramTrendPageDto {
  hashtag: { id: string; displayTag: string; normalizedTag: string };
  source: "cache" | "meta";
  refreshed: boolean;
  refreshedAt: string | null;
  lastErrorCode: string | null;
  page: number;
  pageSize: 20;
  total: number;
  items: InstagramTrendMediaDto[];
}

export interface InstagramTrendSearchHistoryDto {
  hashtagId: string;
  displayTag: string;
  isFavorite: boolean;
  lastSearchedAt: string;
  searchCount: number;
}
```

- [ ] Extend `ApiRepository` with category/profile and trend operations:

```ts
listContentCategories(): Promise<ContentCategoryDto[]>;
listInstagramTrends(brandId: string, input: InstagramTrendListInput): Promise<InstagramTrendPageDto>;
searchInstagramTrends(brandId: string, hashtag: string): Promise<InstagramTrendPageDto>;
listInstagramTrendSearches(brandId: string): Promise<InstagramTrendSearchHistoryDto[]>;
setInstagramTrendFavorite(brandId: string, hashtagId: string, isFavorite: boolean): Promise<InstagramTrendSearchHistoryDto>;
saveInstagramTrendSource(brandId: string, mediaId: string): Promise<{ source: SourceDto; alreadySaved: boolean }>;
```

- [ ] Run API and UI type checks. Expect failures in implementations because contracts changed; that is the intended RED state.

```powershell
npm run typecheck --workspace @brand-pilot/api
npm run build --workspace @brand-pilot/customer-ui
```

Expected: failures identify every old `industry` fixture/consumer and missing repository method. Keep the list for Tasks 5, 7, and 8.

- [ ] Commit only after all later tasks in this contract migration compile. Do not commit an intentionally broken branch here.

### Task 3: Implement Hashtag Validation And Meta Payload Mapping

**Files:**
- Create: `apps/api/src/instagramTrend.ts`
- Create: `apps/api/src/instagramTrend.test.ts`

- [ ] Write failing unit tests for NFKC normalization, leading `#` removal, lowercase comparison key, internal whitespace rejection, emoji rejection, empty input, cache boundary, nullable likes, duplicate IDs, rank truncation, and reel classification.

```ts
import { describe, expect, it } from "vitest";
import {
  classifyInstagramTrendKind,
  isFreshInstagramTrendCache,
  mapMetaTopMedia,
  normalizeInstagramHashtag
} from "./instagramTrend";

describe("normalizeInstagramHashtag", () => {
  it("normalizes a visible tag and comparison key", () => {
    expect(normalizeInstagramHashtag("  #콘텐츠ＭＡＲＫＥＴＩＮＧ  ")).toEqual({
      displayTag: "콘텐츠MARKETING",
      normalizedTag: "콘텐츠marketing"
    });
  });

  it.each(["", "#", "여행 정보", "여행✈️"])("rejects %j", (value) => {
    expect(() => normalizeInstagramHashtag(value)).toThrow("invalid_hashtag");
  });
});

describe("trend mapping", () => {
  it("recognizes only canonical reel permalinks as reels", () => {
    expect(classifyInstagramTrendKind("VIDEO", "https://www.instagram.com/reel/abc/")).toBe("reel");
    expect(classifyInstagramTrendKind("VIDEO", "https://www.instagram.com/p/abc/")).toBe("video");
  });

  it("deduplicates IDs, preserves null likes, and returns at most 50 ranked rows", () => {
    const rows = mapMetaTopMedia({ data: [/* include duplicate and null-like fixtures */] });
    expect(rows).toHaveLength(50);
    expect(rows[0].metaRank).toBe(1);
    expect(rows.find((row) => row.instagramMediaId === "hidden-like")?.likeCount).toBeNull();
  });
});
```

- [ ] Run the focused test and confirm the module is missing.

```powershell
npm test --workspace @brand-pilot/api -- instagramTrend.test.ts
```

- [ ] Implement pure functions only. Do not call PostgreSQL or Meta from this file.

Core signatures:

```ts
export function normalizeInstagramHashtag(input: string): {
  displayTag: string;
  normalizedTag: string;
};

export function isFreshInstagramTrendCache(
  refreshedAt: Date | string | null,
  now = new Date(),
  ttlMs = 24 * 60 * 60 * 1000
): boolean;

export function classifyInstagramTrendKind(
  mediaType: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM",
  permalink: string
): InstagramTrendMediaKind;

export function mapMetaTopMedia(payload: unknown): NormalizedInstagramTrendMedia[];
```

Validation must use explicit Unicode property checks. Permit Korean, Latin letters, decimal digits, and underscore; reject `\p{White_Space}`, emoji/symbols, slash, and punctuation. Limit the normalized tag to 100 Unicode code points.

- [ ] Make focused tests pass.

```powershell
npm test --workspace @brand-pilot/api -- instagramTrend.test.ts
```

Expected: all tests pass without network access.

- [ ] Commit.

```powershell
git add apps/api/src/instagramTrend.ts apps/api/src/instagramTrend.test.ts
git commit -m "feat: validate and normalize Instagram trend media"
```

### Task 4: Implement The Meta Hashtag Client

**Files:**
- Create: `apps/api/src/instagramTrendMeta.ts`
- Create: `apps/api/src/instagramTrendMeta.test.ts`
- Modify: `apps/api/src/metaGraph.ts`

- [ ] Add failing tests with an injected `fetchImpl`. Verify two calls in order, exact fields, `limit=50`, no pagination follow-up, and safe error classification.

```ts
it("resolves a hashtag and requests one top_media page", async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "tag-1" }] }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "media-1", media_type: "IMAGE", permalink: "https://www.instagram.com/p/1/" }] }), { status: 200 }));

  const result = await fetchInstagramHashtagTopMedia({
    accessToken: "secret",
    instagramBusinessAccountId: "ig-1",
    hashtag: "마케팅",
    fetchImpl,
    graphVersion: "v20.0"
  });

  expect(result.metaHashtagId).toBe("tag-1");
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(String(fetchImpl.mock.calls[1][0])).toContain("limit=50");
  expect(String(fetchImpl.mock.calls[1][0])).toContain("access_token=secret");
});
```

- [ ] Expose or reuse `getMetaGraphJson` from `metaGraph.ts`; never duplicate Graph response parsing or include access tokens in thrown messages.

- [ ] Implement:

```ts
export async function fetchInstagramHashtagTopMedia(input: {
  accessToken: string;
  instagramBusinessAccountId: string;
  hashtag: string;
  fetchImpl?: typeof fetch;
  graphVersion?: string;
}): Promise<{ metaHashtagId: string; media: NormalizedInstagramTrendMedia[] }>;
```

First request:

```text
GET /ig_hashtag_search?user_id={ig-user-id}&q={tag}&access_token={token}
```

Second request:

```text
GET /{hashtag-id}/top_media?user_id={ig-user-id}&fields=id,caption,comments_count,like_count,media_type,media_url,permalink,timestamp,username,children{id,media_type,media_url,thumbnail_url,permalink}&limit=50&access_token={token}
```

Return `instagram_hashtag_not_found` for an empty hashtag lookup. Map Graph 401/code 102/190 to `instagram_reconnect_required`, Graph 403/code 10/200 to `instagram_permission_required`, and all retryable Graph failures to `instagram_trend_fetch_failed`. Preserve only stable error codes, never Meta text that may contain request details.

- [ ] Run tests.

```powershell
npm test --workspace @brand-pilot/api -- instagramTrendMeta.test.ts metaGraph.test.ts
```

Expected: exactly two mock calls on success and no request for `paging.next`.

- [ ] Commit.

```powershell
git add apps/api/src/instagramTrendMeta.ts apps/api/src/instagramTrendMeta.test.ts apps/api/src/metaGraph.ts
git commit -m "feat: add Meta hashtag top media client"
```

### Task 5: Implement Category And Trend Repository Transactions

**Files:**
- Create: `apps/api/src/instagramTrendRepository.ts`
- Create: `apps/api/src/instagramTrendRepository.test.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.test.ts`

- [ ] Write repository tests first using the existing mocked `Pool` style. Cover:
  - category list ordering and inactive-row exclusion;
  - profile update transaction with one category and at most five combined subcategories;
  - rejecting a system subcategory from a different category;
  - shared 24-hour cache across two brands without a second Meta call;
  - connected Instagram channel and active credential enforcement;
  - 30 unique hashtag quota in a rolling seven-day window;
  - stale concurrent searches yielding one Meta call;
  - successful media upsert plus current-rank replacement in one transaction;
  - Meta failure preserving previous rows and `last_refreshed_at`;
  - brand search/favorite isolation;
  - reference-source save idempotency and snapshot creation.

- [ ] Create `createInstagramTrendRepository()` instead of placing SQL directly into the already large `repository.ts`.

```ts
export function createInstagramTrendRepository(input: {
  pool: Pool;
  decryptCredential: (encrypted: string) => string;
  fetchTopMedia: typeof fetchInstagramHashtagTopMedia;
  now?: () => Date;
}) {
  return {
    listContentCategories,
    listInstagramTrends,
    searchInstagramTrends,
    listInstagramTrendSearches,
    setInstagramTrendFavorite,
    saveInstagramTrendSource
  };
}
```

- [ ] Add a transaction-scoped advisory lock before a stale Meta refresh:

```sql
select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as locked
```

Use the key `instagram-trend:{normalizedTag}`. If not acquired, poll the DB at 250 ms intervals for at most 3 seconds. Return the newly refreshed cache if it appears; otherwise return the existing stale result with `refreshed=false`. Do not make a second Meta call.

- [ ] Enforce the quota only when a Meta call will actually occur. Within the same transaction:

```sql
select count(*)::int
from instagram_trend_account_hashtags
where brand_channel_id = $1
  and quota_window_started_at > $2
```

If the count is 30 and the requested hashtag has no active row for that channel, throw `hashtag_search_limit_reached`. Existing rows within seven days do not increase the count. Rows older than seven days are updated with a new `quota_window_started_at` after a successful Meta call.

- [ ] Resolve the Instagram connection from `brand_channels` and encrypted `channel_credentials` entirely server-side. Require channel `status='connected'` and credential `status='active'`. Return only stable domain errors.

- [ ] In the success transaction:
  1. upsert `instagram_trend_hashtags`;
  2. upsert each `instagram_trend_media` by `instagram_media_id`;
  3. delete current `instagram_trend_hashtag_media` rows for this hashtag;
  4. insert new rows with ranks 1-50;
  5. set `last_refreshed_at=now()` and clear `last_error_code`;
  6. upsert the channel quota row;
  7. upsert the tenant `brand_trend_searches` row.

If the Meta call fails, update only `last_error_code`; do not change `last_refreshed_at`, current media relations, or quota rows.

- [ ] Implement list pagination in SQL with `limit 20 offset (page - 1) * 20`. `sort=meta` uses `meta_rank asc`; likes/comments use `nulls last, meta_rank asc` as the deterministic tie-breaker.

- [ ] Implement `saveInstagramTrendSource` as one transaction:
  - lock the media row;
  - hash permalink using the same source URL hashing helper as `createSource`;
  - find or insert `source_urls(source_type='reference')`;
  - find or insert `brand_trend_saved_media`;
  - create one successful `source_snapshots` row only when the saved link is newly created;
  - store caption as extracted text and username/counts/posted date/hashtags in `metadata`;
  - return the existing source on duplicate save.

- [ ] Instantiate the focused repository once in `createRepository()` and delegate the six methods. Add test-only injection fields to `RepositoryOptions`:

```ts
fetchInstagramHashtagTopMedia?: typeof fetchInstagramHashtagTopMedia;
trendNow?: () => Date;
```

- [ ] Run focused repository tests.

```powershell
npm test --workspace @brand-pilot/api -- instagramTrendRepository.test.ts repository.test.ts
```

Expected: one Meta fetch in the concurrency test and idempotent source/snapshot counts.

- [ ] Commit.

```powershell
git add apps/api/src/instagramTrendRepository.ts apps/api/src/instagramTrendRepository.test.ts apps/api/src/repository.ts apps/api/src/repository.test.ts
git commit -m "feat: persist and cache Instagram hashtag trends"
```

### Task 6: Migrate Brand Profile Repository And Generation Consumers

**Files:**
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/instagramImageGenerator.ts`
- Modify: `apps/api/src/imageRenderJobs.ts`
- Modify: `apps/api/src/textRenderJobs.ts`
- Modify: tests adjacent to each modified generator/job module
- Modify: `apps/customer-ui/src/lib/brandSetup.ts`
- Modify: `apps/customer-ui/src/lib/brandSetup.test.ts`

- [ ] Add failing tests proving `getBrandProfile` returns category/subcategories, `updateBrandProfile` never writes `industry`, and generation prompts receive category names rather than legacy industry text.

- [ ] Update `getBrandProfile` with category and subcategory joins. Map system and custom selections deterministically by creation order, then name.

- [ ] Update `updateBrandProfile` to use one transaction and lock the profile row. If `primaryCategoryCode` is supplied:
  - resolve one active category;
  - resolve every system subcategory under that category;
  - normalize custom names with NFKC, trim, lowercase `custom_key`;
  - reject duplicates across system/custom display names;
  - reject more than five total selections;
  - replace relationship rows atomically.

Stable errors:

```text
invalid_primary_category
invalid_subcategory
subcategory_category_mismatch
too_many_subcategories
duplicate_subcategory
brand_subcategory_too_long
```

- [ ] Replace all runtime `industry` reads. Use one shared formatter:

```ts
export function formatBrandCategoryContext(profile: BrandProfileDto) {
  const primary = profile.primaryCategory?.name ?? "미설정";
  const details = profile.subcategories.map((item) => item.name);
  return details.length > 0 ? `${primary} / ${details.join(", ")}` : primary;
}
```

Use it in image, text, and content generation context. Do not fall back to `industry`; unmapped profiles must remain incomplete until the user selects a category.

- [ ] Change brand readiness/completeness checks in API and UI from non-empty `industry` to non-null `primaryCategory`.

- [ ] Search for remaining production references:

```powershell
rg -n "\bindustry\b" apps db --glob "!db/migrations/001_initial_schema.sql" --glob "!db/migrations/029_instagram_hashtag_trends.sql"
```

Expected: only migration compatibility code and deliberately named legacy test fixtures remain. No runtime DTO, prompt, or UI field reads `industry`.

- [ ] Run focused and workspace tests.

```powershell
npm run typecheck --workspace @brand-pilot/api
npm test --workspace @brand-pilot/api
npm test --workspace @brand-pilot/customer-ui -- brandSetup.test.ts
```

- [ ] Commit the contract migration from Task 2 together with this compilable implementation.

```powershell
git add apps/api/src/types.ts apps/customer-ui/src/types.ts apps/api/src/repository.ts apps/api/src/repository.test.ts apps/api/src/httpServer.ts apps/api/src/instagramImageGenerator.ts apps/api/src/imageRenderJobs.ts apps/api/src/textRenderJobs.ts apps/customer-ui/src/lib/brandSetup.ts apps/customer-ui/src/lib/brandSetup.test.ts
git commit -m "feat: replace brand industry with content categories"
```

### Task 7: Add Authenticated HTTP Routes And Error Mapping

**Files:**
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/server.test.ts`

- [ ] Add failing Fastify injection tests for all routes. Assert unauthenticated requests are rejected by existing auth hooks and cross-workspace brands are rejected by existing brand access checks.

Required success/error cases:

```text
GET  /content-categories
GET  /brands/:brandId/instagram-trends
POST /brands/:brandId/instagram-trends/search
GET  /brands/:brandId/instagram-trend-searches
PUT  /brands/:brandId/instagram-trend-searches/:hashtagId/favorite
POST /brands/:brandId/instagram-trends/:mediaId/save-source
```

- [ ] Validate query/body input at the HTTP boundary:
  - `hashtag`: required string;
  - `type`: one of `all,reel,video,image,carousel`;
  - `sort`: one of `meta,likes,comments`;
  - `page`: positive integer, default 1;
  - `isFavorite`: boolean.

- [ ] Map stable errors exactly:

```ts
const instagramTrendHttpErrors: Record<string, [number, string]> = {
  invalid_hashtag: [400, "invalid_hashtag"],
  instagram_connection_required: [409, "instagram_connection_required"],
  instagram_reconnect_required: [409, "instagram_reconnect_required"],
  instagram_permission_required: [409, "instagram_permission_required"],
  hashtag_search_limit_reached: [429, "hashtag_search_limit_reached"],
  instagram_trend_fetch_failed: [502, "instagram_trend_fetch_failed"],
  instagram_hashtag_not_found: [200, "instagram_hashtag_not_found"]
};
```

For `instagram_hashtag_not_found`, return a normal empty `InstagramTrendPageDto`; do not emit an HTTP error body. All other unknown errors remain 500 and are logged through the existing server logger without credentials.

- [ ] Ensure `GET /content-categories` is authenticated but does not require a complete brand profile. Users must be able to load it while completing setup.

- [ ] Run server tests.

```powershell
npm test --workspace @brand-pilot/api -- server.test.ts
```

Expected: every new route passes auth, validation, success, and domain-error tests.

- [ ] Commit.

```powershell
git add apps/api/src/httpServer.ts apps/api/src/server.test.ts
git commit -m "feat: expose Instagram trend discovery API"
```

### Task 8: Add UI API Client Contracts

**Files:**
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Modify: `apps/customer-ui/src/lib/apiClient.test.ts`
- Modify: `apps/customer-ui/src/types.ts`

- [ ] Add failing API client tests for exact methods, URLs, query encoding, JSON bodies, and credentials.

```ts
it("searches and lists Instagram trends", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(trendPage), { status: 200 }));
  const client = apiClient({ baseUrl: "http://api.test", fetcher });

  await client.searchInstagramTrends("brand-1", "콘텐츠 마케팅");
  expect(fetcher).toHaveBeenCalledWith(
    "http://api.test/brands/brand-1/instagram-trends/search",
    expect.objectContaining({ method: "POST", body: JSON.stringify({ hashtag: "콘텐츠 마케팅" }) })
  );
});
```

- [ ] Implement:

```ts
listContentCategories()
getInstagramTrends(brandId, { hashtag, type, sort, page })
searchInstagramTrends(brandId, hashtag)
listInstagramTrendSearches(brandId)
setInstagramTrendFavorite(brandId, hashtagId, isFavorite)
saveInstagramTrendSource(brandId, mediaId)
```

Use `URLSearchParams` for the GET query. Keep `hashtag` unmodified in the UI client; server normalization is authoritative.

- [ ] Extend client error parsing only if needed so pages can inspect the stable error suffix already produced by `request()`.

- [ ] Run tests.

```powershell
npm test --workspace @brand-pilot/customer-ui -- apiClient.test.ts
```

- [ ] Commit.

```powershell
git add apps/customer-ui/src/lib/apiClient.ts apps/customer-ui/src/lib/apiClient.test.ts apps/customer-ui/src/types.ts
git commit -m "feat: add Instagram trends UI API client"
```

### Task 9: Replace Industry UI With Category And Subcategory Controls

**Files:**
- Modify: `apps/customer-ui/src/pages/BrandSettingsPage.tsx`
- Modify: `apps/customer-ui/src/__tests__/brandSettings.test.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`

- [ ] Replace industry tests with failing category behavior tests:
  - catalog loads independently from profile;
  - exactly one primary category is selected;
  - only system subcategories from that category are shown;
  - system plus custom selections cannot exceed five;
  - a 31-character custom name is rejected;
  - duplicate custom names are rejected after trim/NFKC/case normalization;
  - changing the category prompts before removing incompatible system selections;
  - custom selections remain after confirmed category change;
  - save payload contains `primaryCategoryCode` and `subcategories`, never `industry`.

- [ ] Remove `industryOptions`, `industryEntryMode`, `selectIndustry`, and all industry-specific copy.

- [ ] Add state derived from `ContentCategory[]`:

```ts
const [categories, setCategories] = useState<ContentCategory[]>([]);
const selectedCategory = categories.find(
  (category) => category.code === draftProfile?.primaryCategory?.code
);
const selectedCount = draftProfile?.subcategories.length ?? 0;
```

- [ ] Use a normal select for representative category and compact checkbox/chip controls for system subcategories. Use one text input plus add icon button for custom values. Show `선택 n/5` beside the section heading. Disable unchecked/add controls at five while leaving selected controls removable.

- [ ] On primary category change:
  - calculate incompatible system selections;
  - if none, update immediately;
  - otherwise use `window.confirm` with the exact count;
  - on confirm, remove only incompatible system selections and retain custom selections;
  - on cancel, retain the old category and selections.

- [ ] Update validation and error messages:

```text
대표 분야를 선택하세요.
세부 분야는 최대 5개까지 선택할 수 있습니다.
직접 입력한 세부 분야는 30자 이내로 입력하세요.
이미 선택한 세부 분야입니다.
```

- [ ] Add restrained styles for the selection grid and chips. Preserve the existing form hierarchy; do not introduce nested cards or a new color theme.

- [ ] Run tests and build.

```powershell
npm test --workspace @brand-pilot/customer-ui -- brandSettings.test.tsx
npm run build --workspace @brand-pilot/customer-ui
```

- [ ] Commit.

```powershell
git add apps/customer-ui/src/pages/BrandSettingsPage.tsx apps/customer-ui/src/__tests__/brandSettings.test.tsx apps/customer-ui/src/styles/prototype.css
git commit -m "feat: add representative and detailed brand categories"
```

### Task 10: Build The Instagram Trend Explorer Page

**Files:**
- Create: `apps/customer-ui/src/pages/InstagramTrendsPage.tsx`
- Create: `apps/customer-ui/src/components/trends/TrendMediaCard.tsx`
- Create: `apps/customer-ui/src/components/trends/TrendMediaDetailDialog.tsx`
- Create: `apps/customer-ui/src/__tests__/instagramTrends.test.tsx`
- Modify: `apps/customer-ui/src/routes.tsx`
- Modify: `apps/customer-ui/src/components/layout/Sidebar.tsx`
- Modify: `apps/customer-ui/src/__tests__/navigation.test.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`

- [ ] Write failing component tests for:
  - sidebar route `/instagram-trends`;
  - disconnected Instagram state with `/channels` action;
  - category recommendation click fills the input but does not search;
  - search loading and cached result rendering;
  - stale GET result remains visible while POST refresh is pending;
  - all five format filters and three sorts;
  - 20-item client page and DB-only next page;
  - detail dialog content and original-link target;
  - save source idempotent state;
  - null likes hidden;
  - failed/expired media preview fallback;
  - empty and each stable error state.

- [ ] Add `트렌드 탐색` after `소스` in the sidebar and route it to `InstagramTrendsPage`.

- [ ] Implement page state without a global store:

```ts
type ViewState = {
  hashtag: string;
  submittedHashtag: string;
  type: "all" | InstagramTrendMediaKind;
  sort: InstagramTrendSort;
  page: number;
  result: InstagramTrendPage | null;
  histories: InstagramTrendSearchHistory[];
  isSearching: boolean;
  error: string | null;
};
```

Search flow:
1. trim input and set submitted hashtag;
2. request `GET` first and keep any rows returned;
3. issue `POST search`;
4. replace rows only when POST succeeds;
5. keep prior rows and show a non-blocking alert when POST fails;
6. refresh recent/favorite history after POST.

- [ ] Render a quiet operational layout:
  - page header and one-line description;
  - single hashtag input, search button, and last refreshed time;
  - recent/favorite hashtags as compact text actions;
  - segmented media filter and sort select;
  - four-column desktop grid, two-column tablet, one-column narrow mobile;
  - cards at maximum 8 px radius;
  - stable aspect ratio media frame so image/video loading does not shift layout.

- [ ] `TrendMediaCard` rules:
  - use `<img loading="lazy">` for images and first carousel preview;
  - use `<video preload="metadata" muted playsInline>` for video/reel;
  - never autoplay grid videos;
  - show username, kind, posting date, likes when present, comments;
  - clicking the card opens detail, not Instagram directly.

- [ ] `TrendMediaDetailDialog` rules:
  - accessible dialog label and focusable close button;
  - scrollable media/caption body with a fixed action footer;
  - `Instagram에서 보기` uses `target="_blank" rel="noreferrer"`;
  - `참고 소스로 저장` disables during request and changes to `저장됨` on success;
  - context menu blocking is not a security boundary and is not added here.

- [ ] Map errors to customer copy:

```ts
const trendErrorCopy = {
  instagram_connection_required: "Instagram 채널을 먼저 연결하세요.",
  instagram_reconnect_required: "Instagram 연결이 만료되었습니다. 채널에서 다시 연결하세요.",
  instagram_permission_required: "공개 해시태그 검색 권한이 필요합니다. 채널 연결을 확인하세요.",
  hashtag_search_limit_reached: "이 Instagram 계정은 최근 7일 동안 검색 가능한 고유 해시태그 30개를 모두 사용했습니다.",
  invalid_hashtag: "공백과 이모지 없이 해시태그를 입력하세요.",
  instagram_trend_fetch_failed: "Instagram 최신 데이터를 가져오지 못했습니다. 저장된 결과가 있으면 그대로 표시합니다."
} as const;
```

- [ ] Run component tests and build.

```powershell
npm test --workspace @brand-pilot/customer-ui -- instagramTrends.test.tsx navigation.test.tsx
npm run build --workspace @brand-pilot/customer-ui
```

- [ ] Commit.

```powershell
git add apps/customer-ui/src/pages/InstagramTrendsPage.tsx apps/customer-ui/src/components/trends apps/customer-ui/src/__tests__/instagramTrends.test.tsx apps/customer-ui/src/routes.tsx apps/customer-ui/src/components/layout/Sidebar.tsx apps/customer-ui/src/__tests__/navigation.test.tsx apps/customer-ui/src/styles/prototype.css
git commit -m "feat: add Instagram hashtag trend explorer"
```

### Task 11: Add Browser Journey Coverage

**Files:**
- Create: `apps/customer-ui/e2e/instagram-trends.spec.ts`
- Modify: existing Playwright mock/server fixture files used by `apps/customer-ui/e2e`

- [ ] Add a deterministic Playwright test with mocked API data. Do not consume a real Meta quota in CI.

```ts
test("searches a hashtag, opens media details, and saves a reference source", async ({ page }) => {
  await installAuthenticatedSession(page);
  await installInstagramTrendApiMocks(page);
  await page.goto("/instagram-trends");
  await page.getByLabel("해시태그").fill("콘텐츠마케팅");
  await page.getByRole("button", { name: "검색" }).click();
  await expect(page.getByText("@growthline352")).toBeVisible();
  await page.getByText("@growthline352").click();
  await page.getByRole("button", { name: "참고 소스로 저장" }).click();
  await expect(page.getByRole("button", { name: "저장됨" })).toBeDisabled();
});
```

- [ ] Add a mobile viewport assertion that the grid is one column and dialog content scrolls without action overlap.

- [ ] Run the focused journey.

```powershell
npm run e2e --workspace @brand-pilot/customer-ui -- instagram-trends.spec.ts
```

Expected: desktop and mobile scenarios pass with no console errors.

- [ ] Commit.

```powershell
git add apps/customer-ui/e2e/instagram-trends.spec.ts apps/customer-ui/e2e
git commit -m "test: cover Instagram trend discovery journey"
```

### Task 12: Document Meta Release Preconditions And Live Smoke Test

**Files:**
- Create: `docs/operations/INSTAGRAM_HASHTAG_TRENDS.md`
- Create: `scripts/instagram-trend-smoke.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `scripts/repository-contract.test.mjs`

- [ ] Add a contract test that requires the operations document to contain:
  - Instagram Public Content Access;
  - Advanced Access;
  - connected Professional Instagram account;
  - rolling seven-day 30 unique hashtag limit;
  - no access token in browser/network responses;
  - rollback instructions that disable only the sidebar/route, not category data.

- [ ] Add `scripts/instagram-trend-smoke.mjs` that calls the local/selected Brand Pilot API through an authenticated cookie supplied as an environment variable. It must never print the cookie or Meta access token.

Required variables:

```text
BRAND_PILOT_API_URL
BRAND_PILOT_SESSION_COOKIE
BRAND_PILOT_SMOKE_BRAND_ID
BRAND_PILOT_SMOKE_HASHTAG
```

The script must:
1. POST one hashtag search;
2. assert `items.length <= 50`;
3. immediately POST the same hashtag again;
4. assert second response `source="cache"` and `refreshed=false`;
5. GET page 1 and open-check the first permalink with a HEAD/GET request only if it is public;
6. save the first media as a source twice;
7. assert the second save returns `alreadySaved=true`;
8. scan all JSON output recursively and fail if a key contains `token`, `secret`, or `credential`.

- [ ] Add the root command:

```json
"smoke:instagram-trends": "node scripts/instagram-trend-smoke.mjs"
```

- [ ] Run documentation/contract tests.

```powershell
npm run test:contract
```

- [ ] Only when the Meta app has Public Content Access and Advanced Access, run one live smoke test with a low-risk hashtag not used in the current seven-day window.

```powershell
$env:BRAND_PILOT_API_URL='http://localhost:4000'
$env:BRAND_PILOT_SESSION_COOKIE='bp_session=REDACTED'
$env:BRAND_PILOT_SMOKE_BRAND_ID='REDACTED'
$env:BRAND_PILOT_SMOKE_HASHTAG='콘텐츠마케팅'
npm run smoke:instagram-trends
```

Expected: first response may be `meta` or an existing cache, immediate second response is `cache`; no secret text is printed.

- [ ] Commit.

```powershell
git add docs/operations/INSTAGRAM_HASHTAG_TRENDS.md scripts/instagram-trend-smoke.mjs package.json README.md scripts/repository-contract.test.mjs
git commit -m "docs: add Instagram trend release and smoke checks"
```

### Task 13: Full Verification And Review

**Files:**
- Review all files changed in Tasks 1-12

- [ ] Run schema, contract, API, UI, and browser verification once. Do not repeat passing suites unless a later edit affects them.

```powershell
npm run test:migrations
npm run test:contract
npm run typecheck --workspace @brand-pilot/api
npm test --workspace @brand-pilot/api
npm test --workspace @brand-pilot/customer-ui
npm run build
npm run test:e2e
```

Expected: all commands exit `0`.

- [ ] Search for security and migration regressions.

```powershell
rg -n "access[_-]?token|META_ACCESS_TOKEN|credential_payload" apps/customer-ui/src
rg -n "\bindustry\b" apps --glob "!**/*.test.*"
rg -n "recent_media|paging\.next|views_count|rank_change" apps db
```

Expected:
- no Meta credential references in customer UI;
- no runtime `industry` dependency;
- no excluded trend features implemented.

- [ ] Perform one focused code review using `superpowers:requesting-code-review`. Fix only actionable correctness, security, or maintainability findings introduced by this feature.

- [ ] Check final diff and working tree.

```powershell
git status --short
git diff --check
git log --oneline -12
```

Expected: no whitespace errors and no uncommitted implementation changes.

## Completion Criteria

- A brand cannot search until its Instagram Professional account is connected.
- Valid hashtag search returns at most 50 Meta Top Media items and reuses a 24-hour global cache.
- The same stale hashtag receives at most one concurrent Meta refresh.
- Seven-day unique hashtag quota is counted per connected `brand_channel_id` only when Meta is called.
- Media rows are global; searches, favorites, and saved sources remain tenant-scoped.
- Saving a trend media creates one reference source and one successful snapshot without triggering Instagram web crawling.
- Brand settings and every generation prompt use representative/detailed category data, not `industry`.
- React shows image, carousel, video, and reel media with accessible empty/error/disconnected states.
- CI uses mocks; live Meta smoke is manual and consumes at most one new hashtag quota entry.
