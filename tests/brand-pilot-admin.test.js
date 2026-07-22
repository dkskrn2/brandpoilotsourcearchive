const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");

const read = (path) => readFileSync(path, "utf8");

test("Brand Pilot admin client is server-only and sends the service credential", () => {
  const client = read("lib/brand-pilot-admin.ts");
  const env = read(".env.example");

  assert.match(client, /import "server-only"/);
  assert.match(client, /BRAND_PILOT_ADMIN_API_URL/);
  assert.match(client, /BRAND_PILOT_ADMIN_API_TOKEN/);
  assert.match(client, /Authorization: `Bearer/);
  assert.match(client, /X-Admin-Actor-Id/);
  assert.doesNotMatch(client, /NEXT_PUBLIC_BRAND_PILOT_ADMIN/);
  assert.match(env, /BRAND_PILOT_ADMIN_API_URL=/);
  assert.match(env, /BRAND_PILOT_ADMIN_API_TOKEN=/);
});

test("admin login username follows the configured environment value", () => {
  const page = read("app/admin/login/page.tsx");

  assert.match(page, /process\.env\.ADMIN_USERNAME/);
  assert.doesNotMatch(page, /defaultValue="ROOT"/);
});

test("existing admin navigation exposes Brand Pilot operations", () => {
  const sidebar = read("components/admin-sidebar.tsx");

  assert.match(sidebar, /href="\/admin\/content"/);
  assert.match(sidebar, /href="\/admin\/inquiries"/);
  assert.match(sidebar, /href="\/admin\/analytics"/);
  assert.match(sidebar, /href="\/admin\/brand-pilot"/);
  assert.match(sidebar, /Brand Pilot/);
  assert.match(sidebar, /brand-pilot/);
  assert.doesNotMatch(sidebar, /<<<<<<<|=======|>>>>>>>/);
});

test("legacy Brand Pilot admin URL redirects to the canonical route", () => {
  const legacyPath = "app/admin/brandpoilot/page.tsx";

  assert.ok(existsSync(legacyPath), "legacy /admin/brandpoilot route must remain available");
  const legacyRoute = readFileSync(legacyPath, "utf8");
  assert.match(legacyRoute, /redirect\("\/admin\/brand-pilot"\)/);
});

test("Brand Pilot overview renders live API data and an isolated error state", () => {
  const page = read("app/admin/brand-pilot/page.tsx");

  assert.match(page, /getBrandPilotOverview/);
  assert.match(page, /활성 브랜드/);
  assert.match(page, /채널 연결/);
  assert.match(page, /최근 24시간/);
  assert.match(page, /Brand Pilot API/);
});

test("Brand Pilot first admin slice has protected operational list pages", () => {
  for (const [path, contract] of [
    ["app/admin/brand-pilot/brands/page.tsx", /listBrandPilotBrands/],
    ["app/admin/brand-pilot/channels/page.tsx", /listBrandPilotChannels/],
    ["app/admin/brand-pilot/system/page.tsx", /getBrandPilotSystemHealth/],
    ["app/admin/brand-pilot/audit/page.tsx", /listBrandPilotAuditEvents/],
  ]) {
    const page = read(path);
    assert.match(page, /requireAdminSession/);
    assert.match(page, contract);
  }
});

test("brand status changes use a protected server action and idempotency key", () => {
  const action = read("app/admin/brand-pilot/actions.ts");
  const detail = read("app/admin/brand-pilot/brands/[brandId]/page.tsx");
  const client = read("lib/brand-pilot-admin.ts");

  assert.match(action, /"use server"/);
  assert.match(action, /requireAdminSession/);
  assert.match(action, /updateBrandPilotBrandStatus/);
  assert.match(client, /Idempotency-Key/);
  assert.match(detail, /상태 변경 사유/);
  assert.match(detail, /updateBrandStatusAction/);
});

test("Brand Pilot admin navigation exposes publishing operations", () => {
  const shell = read("components/brand-pilot-admin-shell.tsx");

  assert.match(shell, /\/admin\/brand-pilot\/publishing/);
  assert.match(shell, /콘텐츠·게시/);
});

test("publishing list and detail are protected server-rendered screens", () => {
  const list = read("app/admin/brand-pilot/publishing/page.tsx");
  const detail = read("app/admin/brand-pilot/publishing/[queueId]/page.tsx");

  assert.match(list, /requireAdminSession/);
  assert.match(list, /listBrandPilotPublishing/);
  assert.match(list, /게시 상태/);
  assert.match(detail, /requireAdminSession/);
  assert.match(detail, /getBrandPilotPublishing/);
  assert.match(detail, /BrandPilotPublishPreview/);
  assert.match(detail, /게시 시도 이력/);
});

test("publishing preview supports image, video, HTML, and text outputs", () => {
  const preview = read("components/brand-pilot-publish-preview.tsx");

  assert.match(preview, /<img/);
  assert.match(preview, /<video/);
  assert.match(preview, /<iframe/);
  assert.match(preview, /previewBody/);
  assert.match(preview, /sandbox=/);
});

test("publishing mutations are protected and require an operator reason", () => {
  const action = read("app/admin/brand-pilot/actions.ts");
  const detail = read("app/admin/brand-pilot/publishing/[queueId]/page.tsx");
  const client = read("lib/brand-pilot-admin.ts");

  assert.match(action, /updatePublishingStatusAction/);
  assert.match(action, /requireAdminSession/);
  assert.match(action, /updateBrandPilotPublishing/);
  assert.match(action, /변경 사유/);
  assert.match(detail, /name="reason"/);
  assert.match(detail, /canRetry/);
  assert.match(detail, /canCancel/);
  assert.match(client, /Idempotency-Key/);
});
