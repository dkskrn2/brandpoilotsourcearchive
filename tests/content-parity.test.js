const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("legacy documents and redesigned marketing pages preserve their source content", () => {
  const routeMap = {
    "app/brand-pilot-privacy/page.tsx": "brand-pilot-privacy.html",
    "app/brand-pilot-terms/page.tsx": "brand-pilot-terms.html",
    "app/brand-pilot-data-deletion/page.tsx": "brand-pilot-data-deletion.html"
  };

  for (const [route, legacy] of Object.entries(routeMap)) {
    const source = read(route);
    assert.match(source, new RegExp(legacy.replaceAll(".", "\\.")), `${route} must render ${legacy}`);
    assert.doesNotMatch(source, /MigrationPage|React migration/, `${route} must not use a placeholder`);
  }

  const homeRoute = read("app/page.tsx");
  for (const content of ["2.4배", "38% 감소", "3배", "2,000만원 이상", "500만원부터", "현황 구조 점검", "개선과 확장"]) {
    assert.match(homeRoute, new RegExp(content), `home must preserve ${content}`);
  }

  const serviceIndex = read("app/service/page.tsx");
  for (const href of ["service-research", "service-analytics", "service-design", "service-consulting", "service-writing", "service-startup", "brandpilot"]) {
    assert.match(serviceIndex, new RegExp(href), `service index must preserve ${href}`);
  }

  const detailRoute = read("app/detail/page.tsx");
  assert.match(detailRoute, /TV Voice 활용/);
  assert.match(detailRoute, /TV 환경에서 음성 인터랙션/);
  assert.doesNotMatch(detailRoute, /상세 내용을 불러오는 중|MigrationPage|React migration/);

  const serviceRoute = read("app/service/[slug]/page.tsx");
  for (const file of fs.readdirSync(path.join(root, "service")).filter((name) => name.endsWith(".html"))) {
    assert.match(serviceRoute, new RegExp(file.replaceAll(".", "\\.")), `${file} must have a React route`);
  }

  const brandPilot = read("app/service/[slug]/brand-pilot-page.tsx");
  for (const content of ["글감보다 운영 기준이 먼저입니다", "말할 근거를 모읍니다", "사람의 판단을 지우지 않도록", "현재는 Instagram 중심으로", "이미지는 항상 5장으로 생성되나요"]) {
    assert.match(brandPilot, new RegExp(content), `Brand Pilot must preserve ${content}`);
  }
  assert.match(serviceRoute, /slug === "brandpilot"/);
});

test("contact migration preserves the six original field names", () => {
  const source = read("components/contact-form.tsx");
  for (const field of ["name_company", "phone", "site_url", "plan", "message", "agree_privacy"]) {
    assert.match(source, new RegExp(`name=\\"${field}\\"`), `${field} must be preserved`);
  }
});

test("work migration keeps all 22 project rows", () => {
  const rows = read("data/seed/projects.csv").trim().split(/\r?\n/);
  assert.equal(rows.length - 1, 22);
  assert.match(read("app/work/page.tsx"), /getProjects\(\)/);
});

test("content hub reads published database articles as individual pages", () => {
  const contentData = read("lib/content.ts");
  const contentIndex = read("app/content/page.tsx");
  const contentDetail = read("app/content/[slug]/page.tsx");
  const header = read("components/site-header.tsx");

  for (const slug of ["where-revenue-flow-stops", "research-before-redesign", "decision-ready-data", "repeatable-content-operations"]) {
    assert.match(contentData, new RegExp(slug));
  }
  assert.match(contentIndex, /listPublishedArticles/);
  assert.match(contentDetail, /getArticleBySlug/);
  assert.match(contentDetail, /force-dynamic/);
  assert.match(header, /href="\/content"/);
});

test("admin content manager exposes local CRUD actions", () => {
  const admin = read("app/admin/page.tsx");
  const actions = read("app/admin/actions.ts");
  const database = read("lib/content-db.ts");
  assert.match(admin, /listArticles/);
  assert.match(admin, /새 글 작성/);
  assert.match(admin, /type="search"/);
  assert.match(admin, /robots: \{ index: false, follow: false \}/);
  for (const action of ["createArticleAction", "updateArticleAction", "toggleArticleStatusAction", "deleteArticleAction"]) assert.match(actions, new RegExp(action));
  assert.match(database, /CREATE TABLE IF NOT EXISTS content_articles/);
  assert.match(database, /\.runtime.*growthline\.sqlite/);
});

test("admin article form uses the local Naver SmartEditor adapter safely", () => {
  const form = read("components/admin-article-form.tsx");
  const editor = read("components/naver-smart-editor.tsx");
  const actions = read("app/admin/actions.ts");
  const detail = read("app/content/[slug]/page.tsx");

  assert.match(form, /NaverSmartEditor/);
  assert.match(editor, /HuskyEZCreator\.js/);
  assert.match(editor, /UPDATE_CONTENTS_FIELD/);
  assert.match(editor, /SmartEditor2Skin\.html/);
  assert.match(actions, /sanitizeArticleHtml/);
  assert.match(detail, /article\.bodyHtml/);
  assert.ok(fs.existsSync(path.join(root, "public/vendor/smarteditor2/LICENSE.md")));
  assert.ok(fs.existsSync(path.join(root, "public/vendor/smarteditor2/js/service/HuskyEZCreator.js")));
});

test("public header shows disabled login controls without a login route", () => {
  const header = read("components/site-header.tsx");
  const styles = read("app/globals.css");
  assert.equal((header.match(/className="site-login"/g) || []).length, 2);
  assert.equal((header.match(/disabled>로그인/g) || []).length, 2);
  assert.doesNotMatch(header, /href="\/login"/);
  assert.match(styles, /\.mobile-menu nav \.site-login/, "mobile login must use the same menu-row layout as mobile links");
});

test("SEO metadata excludes seeded dummy content without changing public rendering", () => {
  const database = read("lib/content-db.ts");
  const sitemap = read("app/sitemap.ts");
  const contentDetail = read("app/content/[slug]/page.tsx");
  const robots = read("app/robots.ts");
  const seo = read("lib/seo.ts");

  assert.match(database, /is_dummy INTEGER NOT NULL DEFAULT 0/);
  assert.match(database, /listIndexableArticles/);
  assert.match(sitemap, /listIndexableArticles/);
  assert.doesNotMatch(sitemap, /listPublishedArticles/);
  assert.match(contentDetail, /article\.isDummy \? \{ index: false/);
  assert.match(contentDetail, /application\/ld\+json/);
  assert.match(robots, /disallow: \["\/admin", "\/api\/"\]/);
  assert.match(seo, /alternates: \{ canonical: path \}/);
  assert.match(seo, /summary_large_image/);
  assert.match(seo, /replaceAll\("<", "\\\\u003c"\)/);
});
