import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { expect, test, type Page } from "@playwright/test";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { createServer } from "../../api/src/httpServer";
import { createKakaoAuthStore } from "../../api/src/kakaoAuth";
import { createInstagramTrendRepository } from "../../api/src/instagramTrendRepository";
import { createRepository } from "../../api/src/repository";
import { runWikiFinalizeOnce } from "../../../workers/brand-pilot-dm-worker/src/compiledWikiFinalize";
import { runCompiledWikiSourceItemOnce } from "../../../workers/brand-pilot-dm-worker/src/compiledWikiSource";
import { runWikiCompilationItemOnce } from "../../../workers/brand-pilot-dm-worker/src/compiledWikiWorker";
import { createDmWorkerDbFromPool } from "../../../workers/brand-pilot-dm-worker/src/db";

type QueryResult = { rowCount: number; rows: Record<string, unknown>[] };

function pglitePool(database: PGlite): Pool {
  async function query(sql: string, values: unknown[] = []): Promise<QueryResult> {
    const result = await database.query(sql, values as never[]);
    return {
      rowCount: result.rows.length || Number(result.affectedRows ?? 0),
      rows: result.rows as Record<string, unknown>[],
    };
  }
  return {
    query,
    async connect() {
      return { query, release() {} };
    },
  } as unknown as Pool;
}

const ids = {
  workspace: "81000000-0000-4000-8000-000000000001",
  brand: "82000000-0000-4000-8000-000000000002",
  owner: "83000000-0000-4000-8000-000000000003",
  analysis: "84000000-0000-4000-8000-000000000004",
  brandAnalysis: "84000000-0000-4000-8000-000000000005",
  hashtag: "85000000-0000-4000-8000-000000000005",
  media: "86000000-0000-4000-8000-000000000006",
  avatar: "87000000-0000-4000-8000-000000000007",
  avatarSessionOne: "88000000-0000-4000-8000-000000000008",
  avatarSessionTwo: "89000000-0000-4000-8000-000000000009",
};

let database: PGlite;
let api: FastifyInstance;
let apiOrigin: string;
let sessionToken: string;
let stableReferenceId: string;
let workerDatabase: ReturnType<typeof createDmWorkerDbFromPool>;

async function deterministicWikiCompiler({ prompt }: { prompt: string }) {
  const encoded = prompt.match(/입력:\n(.+)\n\n출력 계약:/s)?.[1];
  if (!encoded) throw new Error("deterministic_compiler_input_missing");
  const input = JSON.parse(encoded) as {
    pageType: string;
    stableKey: string;
    requiredLinkedStableKeys: string[];
    sourceUnits: Array<{ id: string; title: string; content: string; hasDestinationUrl: boolean }>;
  };
  return {
    pageType: input.pageType,
    stableKey: input.stableKey,
    title: input.pageType === "brand_overview" ? "브랜드 안내" : input.sourceUnits[0].title,
    summary: input.sourceUnits[0].content,
    sections: [{
      sectionKey: "verified",
      heading: "검증된 안내",
      body: input.sourceUnits[0].content,
      sourceUnitIds: input.sourceUnits.map((source) => source.id),
      destinationUrlId: input.sourceUnits.find((source) => source.hasDestinationUrl)?.id ?? null,
    }],
    links: input.requiredLinkedStableKeys.map((targetStableKey) => ({
      targetStableKey,
      relation: "contains",
    })),
  };
}

async function installRealApi(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("brand-pilot-active-brand", "82000000-0000-4000-8000-000000000002");
  });
  await page.route("http://localhost:4000/**", async (route) => {
    const source = new URL(route.request().url());
    const headers = { ...route.request().headers(), cookie: `bp_session=${sessionToken}` };
    delete headers.host;
    const response = await route.fetch({
      url: `${apiOrigin}${source.pathname}${source.search}`,
      headers,
    });
    await route.fulfill({ response });
  });
}

test.beforeAll(async () => {
  database = await PGlite.create({ extensions: { pgcrypto } });
  const migrations = resolve(process.cwd(), "../../db/migrations");
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = await readFile(resolve(migrations, file), "utf8");
    if (sql.startsWith("-- requires: pgvector") || file === "027_wiki_search_v2.sql") continue;
    await database.exec(sql);
  }
  await database.exec(`
    create domain vector as text;
    alter table wiki_page_chunks add column embedding vector null;
  `);
  const pool = pglitePool(database);
  workerDatabase = createDmWorkerDbFromPool(pool);
  await database.exec(`
    insert into app_users(id,email,display_name)
    values ('${ids.owner}','libraries-e2e@example.com','라이브러리 소유자');
    insert into workspaces(id,name,slug,created_by_user_id)
    values ('${ids.workspace}','Libraries E2E','libraries-e2e','${ids.owner}');
    insert into workspace_members(workspace_id,user_id,role,status)
    values ('${ids.workspace}','${ids.owner}','owner','active');
    insert into brands(id,workspace_id,name,created_by_user_id)
    values ('${ids.brand}','${ids.workspace}','Libraries E2E Brand','${ids.owner}');
    insert into brand_analysis_runs(
      id,workspace_id,brand_id,status,result_json,idempotency_key,is_active,completed_at,confirmed_at
    ) values (
      '${ids.brandAnalysis}','${ids.workspace}','${ids.brand}','confirmed','{}',
      'libraries-e2e-confirmed-analysis',true,now(),now()
    );
    insert into brand_profiles(
      workspace_id,brand_id,primary_customer,description,active_brand_analysis_id
    ) values (
      '${ids.workspace}','${ids.brand}','라이브러리 운영자','재사용 라이브러리 E2E',
      '${ids.brandAnalysis}'
    );
    insert into ai_content_subject_analyses(
      id,workspace_id,brand_id,subject_type,source_url,normalized_url,status,
      facts_json,structured_data_json,targets_json,appeals_json,idempotency_key
    ) values (
      '${ids.analysis}','${ids.workspace}','${ids.brand}','service',
      'https://owned.example/e2e-service','https://owned.example/e2e-service','ready',
      '[{"claim":"승인된 E2E 사실"}]',
      '{"name":"E2E 운영 서비스","description":"실제 repository 초안","features":["예약 발행"],"benefits":["시간 절감"]}',
      '[{"id":"operator","name":"운영자"}]',
      '{"operator":[{"id":"time","text":"시간 절감"}]}',
      'libraries-e2e-analysis'
    );
    insert into instagram_trend_hashtags(id,normalized_tag,display_tag,last_refreshed_at)
    values ('${ids.hashtag}','e2e','e2e',now());
    insert into instagram_trend_media(
      id,instagram_media_id,username,caption,media_type,media_url,permalink,posted_at,last_fetched_at
    ) values (
      '${ids.media}','ig-libraries-e2e','real_e2e_creator',
      'E2E 외부 영감 #e2e','IMAGE',
      'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=',
      'https://www.instagram.com/p/libraries-e2e/',now(),now()
    );
    insert into instagram_trend_hashtag_media(hashtag_id,media_id,meta_rank,first_seen_at,last_seen_at)
    values ('${ids.hashtag}','${ids.media}',1,now(),now());
    insert into brand_trend_searches(workspace_id,brand_id,hashtag_id,last_searched_at)
    values ('${ids.workspace}','${ids.brand}','${ids.hashtag}',now());
    insert into reference_upload_sessions(
      id,nonce,workspace_id,brand_id,storage_path_prefix,file_name,storage_path,
      expected_mime_type,expected_size_bytes,expected_checksum,expires_at,confirmed_at,created_by_user_id
    ) values
      ('${ids.avatarSessionOne}','avatar-session-one-nonce',
       '${ids.workspace}','${ids.brand}',
       'brands/${ids.brand}/asset-library/avatars/${ids.avatar}/${ids.avatarSessionOne}/',
       'one.webp',
       'brands/${ids.brand}/asset-library/avatars/${ids.avatar}/${ids.avatarSessionOne}/one.webp',
       'image/webp',1024,'${"3".repeat(64)}',now()+interval '1 hour',now(),'${ids.owner}'),
      ('${ids.avatarSessionTwo}','avatar-session-two-nonce',
       '${ids.workspace}','${ids.brand}',
       'brands/${ids.brand}/asset-library/avatars/${ids.avatar}/${ids.avatarSessionTwo}/',
       'two.webp',
       'brands/${ids.brand}/asset-library/avatars/${ids.avatar}/${ids.avatarSessionTwo}/two.webp',
       'image/webp',2048,'${"4".repeat(64)}',now()+interval '1 hour',now(),'${ids.owner}');
    insert into storage_artifacts(
      workspace_id,brand_id,artifact_type,bucket,path,public_url,mime_type,byte_size,checksum,created_by_user_id
    ) values
      ('${ids.workspace}','${ids.brand}','brand_asset','e2e',
       'brands/${ids.brand}/asset-library/avatars/${ids.avatar}/${ids.avatarSessionOne}/one.webp',
       'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=',
       'image/webp',1024,'${"3".repeat(64)}','${ids.owner}'),
      ('${ids.workspace}','${ids.brand}','brand_asset','e2e',
       'brands/${ids.brand}/asset-library/avatars/${ids.avatar}/${ids.avatarSessionTwo}/two.webp',
       'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=',
       'image/webp',2048,'${"4".repeat(64)}','${ids.owner}');
  `);
  const trends = createInstagramTrendRepository({
    pool,
    decryptCredential: String,
    fetchTopMedia: async () => ({ items: [] }) as never,
  });
  await trends.saveInstagramTrendSource(ids.brand, ids.media, ids.owner);
  const canonical = await database.query<{ id: string }>(
    "select id from reference_items where brand_id=$1 and saved_trend_id is not null",
    [ids.brand],
  );
  stableReferenceId = canonical.rows[0].id;
  await database.query(
    `insert into reference_patterns(
       workspace_id,brand_id,reference_item_id,observations,interpretation,
       application_ideas,do_not_copy,confidence,analysis_version,created_by_user_id
     ) values($1,$2,$3,'["첫 문장에 핵심 제시"]','구조만 참고',
       '["FAQ 카드에 적용"]','["표현 복제 금지"]',0.9,'reference-pattern.v1',$4)`,
    [ids.workspace, ids.brand, stableReferenceId, ids.owner],
  );

  const auth = createKakaoAuthStore(pool);
  sessionToken = await auth.createSession(ids.owner);
  api = createServer({
    repository: createRepository(pool),
    kakaoAuth: auth,
    runtimePolicy: {
      cookieSecure: false,
      corsAllowedOrigins: ["http://127.0.0.1:5273", "http://localhost:5273"],
      devAuthEnabled: false,
    },
    logger: false,
  });
  await api.listen({ host: "127.0.0.1", port: 0 });
  const address = api.server.address();
  if (!address || typeof address === "string") throw new Error("libraries_e2e_api_address_missing");
  apiOrigin = `http://127.0.0.1:${address.port}`;
  const authProbe = await fetch(`${apiOrigin}/auth/me`, {
    headers: {
      cookie: `bp_session=${sessionToken}`,
      origin: "http://127.0.0.1:5273",
    },
  });
  if (!authProbe.ok || authProbe.headers.get("access-control-allow-origin") !== "http://127.0.0.1:5273") {
    throw new Error(`libraries_e2e_auth_probe_failed:${authProbe.status}:${await authProbe.text()}`);
  }
}, 90_000);

test.afterAll(async () => {
  await api?.close();
  await database?.close();
}, 120_000);

test.beforeEach(async ({ page, context }) => {
  await context.addCookies([{
    name: "bp_session",
    value: sessionToken,
    url: "http://localhost:5273",
    sameSite: "Lax",
  }]);
  await installRealApi(page);
});

test("analysis becomes an approved reusable product with a stable content-selection identity", async ({ page }) => {
  await page.goto(`/brand-center?tab=products&analysis=${ids.analysis}`);
  await expect(page.getByRole("heading", { name: "E2E 운영 서비스" })).toBeVisible();
  await expect(page.getByText("콘텐츠 사용 불가")).toBeVisible();
  const stableId = await page.locator(".stable-item-id").textContent();
  expect(stableId).toMatch(/^[0-9a-f-]{36}$/);

  await page.getByRole("button", { name: "승인", exact: true }).click();
  await expect(page.getByText("콘텐츠 사용 가능")).toBeVisible();
  await expect(page.locator(".stable-item-id")).toHaveText(stableId!);
});

test("manual Wiki item reaches active-version UI through the real Wiki worker", async ({ page }) => {
  await page.goto("/brand-center?tab=wiki");
  await page.getByRole("button", { name: "새 Wiki 항목" }).click();
  await page.getByLabel("Wiki 제목").fill("E2E 배송 안내");
  await page.getByLabel("Wiki 내용").fill("영업일 기준 이틀 안에 시작합니다.");
  const createResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && response.url().endsWith(`/brands/${ids.brand}/wiki/items`),
  );
  await page.getByRole("button", { name: "초안 저장" }).click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  const createdItem = await createResponse.json() as { id: string };
  const itemId = createdItem.id;
  await expect(page.locator(".stable-item-id")).toHaveText(itemId);
  await page.getByRole("button", { name: "활성화" }).click();
  await expect(page.getByText("활성화하고 Wiki 빌드를 요청했습니다.")).toBeVisible();

  while (true) {
    const source = await runCompiledWikiSourceItemOnce({
      workerId: "libraries-e2e-source",
      db: workerDatabase,
      curatorPromptVersion: "libraries-e2e.v1",
      embeddingModel: "deterministic-vector",
      embeddingVersion: "v1",
      runtimeDirectory: process.cwd(),
      runCodex: async () => { throw new Error("direct_sources_must_not_call_codex"); },
    });
    if (source.status === "idle") break;
    expect(source.status).toBe("completed");
  }
  while (true) {
    const compilation = await runWikiCompilationItemOnce({
      workerId: "libraries-e2e-compiler",
      db: workerDatabase,
      runtimeDirectory: process.cwd(),
      timeoutMs: 1_000,
      runCodex: deterministicWikiCompiler,
    });
    if (compilation.status === "idle") break;
    expect(compilation.status).toBe("completed");
  }
  const finalized = await runWikiFinalizeOnce({
    workerId: "libraries-e2e-finalizer",
    db: workerDatabase,
    apiKey: "deterministic",
    embeddingModel: "deterministic-vector",
    embeddingVersion: "v1",
    embed: async () => Array.from({ length: 1536 }, () => 0.01),
  });
  expect(finalized.status).toBe("ready");
  const version = await database.query<{ id: string }>(
    "select id from wiki_versions where workspace_id=$1 and brand_id=$2 and status='active'",
    [ids.workspace, ids.brand],
  );
  expect(version.rows).toHaveLength(1);
  await page.reload();
  await page.getByRole("button", { name: /E2E 배송 안내/ }).click();
  await expect(page.locator(".wiki-build-state")).toContainText(`active · 마지막 성공 ${version.rows[0].id}`);
});

test("two-image avatar becomes default and archives without deleting its snapshot assets", async ({ page }) => {
  await page.goto("http://localhost:5273/brand-center?tab=avatars");
  const registration = await page.evaluate(async (input) => {
    const response = await fetch(`http://localhost:4000/brands/${input.brandId}/avatars`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        avatarId: input.avatarId,
        name: "E2E 모델",
        description: "두 이미지 자산",
        imageSessionIds: [input.firstSessionId, input.secondSessionId],
        representativeSessionId: input.secondSessionId,
      }),
    });
    return { status: response.status, body: await response.json() };
  }, {
    brandId: ids.brand,
    avatarId: ids.avatar,
    firstSessionId: ids.avatarSessionOne,
    secondSessionId: ids.avatarSessionTwo,
  });
  expect(registration.status, JSON.stringify(registration.body)).toBe(201);
  expect(registration.body).toMatchObject({
    id: ids.avatar,
    images: [
      expect.objectContaining({ representative: false }),
      expect.objectContaining({ representative: true }),
    ],
  });
  await page.goto("/brand-center?tab=avatars");
  const card = page.getByRole("article", { name: "E2E 모델" });
  await expect(card.getByText("이미지 2장")).toBeVisible();
  await card.getByRole("button", { name: "E2E 모델를 기본 아바타로 설정" }).click();
  await expect(card.getByText("기본 아바타")).toBeVisible();
  await card.getByRole("button", { name: "보관", exact: true }).click();
  await expect(card).toHaveCount(0);

  const retained = await database.query<{ status: string; image_count: number }>(
    `select avatar.status,count(image.id)::int image_count
       from brand_avatars avatar join brand_avatar_images image on image.avatar_id=avatar.id
      where avatar.id=$1 group by avatar.status`,
    [ids.avatar],
  );
  expect(retained.rows).toEqual([{ status: "archived", image_count: 2 }]);
});

test("saved trend opens one patterned canonical reference under its stable ID", async ({ page }) => {
  const listResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "GET"
    && /\/brands\/[^/]+\/references(?:\?|$)/.test(response.url()),
  );
  await page.goto("http://localhost:5273/references?view=all");
  const listResponse = await listResponsePromise;
  const references = await listResponse.json() as Array<{ id: string; title: string }>;
  expect(listResponse.status(), JSON.stringify(references)).toBe(200);
  expect(references).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: stableReferenceId }),
  ]));
  const reference = references.find((item) => item.id === stableReferenceId);
  expect(reference?.title).toBeTruthy();
  const card = page.locator("article").filter({ hasText: reference!.title });
  await expect(card).toHaveCount(1);
  const detailRequest = page.waitForRequest((request) =>
    request.url().endsWith(`/brands/${ids.brand}/references/${stableReferenceId}`),
  );
  await card.getByRole("button", { name: `${reference!.title} 상세 보기` }).click();
  await detailRequest;
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("첫 문장에 핵심 제시");
  await expect(dialog).toContainText("표현 복제 금지");
  await dialog.getByRole("button", { name: "닫기" }).click();

  await page.goto("/archive");
  await expect(page.getByText("저장한 콘텐츠 1개")).toBeVisible();
  const archived = await page.evaluate(async ({ brandId, referenceId }) => {
    const response = await fetch(
      `http://localhost:4000/brands/${brandId}/references/${referenceId}/archive`,
      { method: "POST", credentials: "include" },
    );
    return response.status;
  }, { brandId: ids.brand, referenceId: stableReferenceId });
  expect(archived).toBe(204);
  await page.reload();
  await expect(page.getByText("저장한 트렌드가 없습니다.")).toBeVisible();

  const resaved = await page.evaluate(async ({ brandId, mediaId }) => {
    const response = await fetch(
      `http://localhost:4000/brands/${brandId}/instagram-trends/${mediaId}/save-source`,
      { method: "POST", credentials: "include" },
    );
    return { status: response.status, body: await response.json() };
  }, { brandId: ids.brand, mediaId: ids.media });
  expect(resaved).toMatchObject({ status: 200, body: { alreadySaved: false } });
  await page.reload();
  await expect(page.getByText("저장한 콘텐츠 1개")).toBeVisible();
  const canonical = await database.query<{ id: string; count: number }>(
    `select min(id::text) id,count(*)::int count
       from reference_items
      where brand_id=$1 and metadata->>'instagramMediaId'='ig-libraries-e2e'
      group by brand_id`,
    [ids.brand],
  );
  expect(canonical.rows).toEqual([{ id: stableReferenceId, count: 1 }]);
});
