const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("marketing and legal pages are native React without legacy HTML runtime dependencies", () => {
  for (const route of ["app/brand-pilot-privacy/page.tsx", "app/brand-pilot-terms/page.tsx", "app/brand-pilot-data-deletion/page.tsx"]) {
    const source = read(route);
    assert.match(source, /LegalDocument/);
    assert.doesNotMatch(source, /LegacyContent|\.html/);
  }
  for (const legacy of ["index.html", "service.html", "work.html", "contact.html", "detail.html", "brand-pilot-privacy.html", "brand-pilot-terms.html", "brand-pilot-data-deletion.html"]) {
    assert.equal(fs.existsSync(path.join(root, legacy)), false, `${legacy} must be removed`);
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
  assert.match(serviceRoute, /serviceDetails/);
  assert.match(serviceRoute, /ServiceDetailPage/);
  assert.doesNotMatch(serviceRoute, /LegacyContent|\.html/);

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

test("contact inquiries are stored in PostgreSQL without a Google Apps Script dependency", () => {
  const route = read("app/api/contact/route.ts");
  const database = read("lib/content-db.ts");
  const admin = read("app/admin/page.tsx");

  assert.match(route, /createContactInquiry/);
  assert.match(route, /Missing DATABASE_URL/);
  assert.doesNotMatch(route, /GAS_WEBAPP_URL|google\.com\/macros/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS contact_inquiries/);
  assert.match(database, /listContactInquiries/);
  assert.match(admin, /상담 문의/);
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

test("admin content manager uses PostgreSQL and protects every mutation", () => {
  const admin = read("app/admin/page.tsx");
  const actions = read("app/admin/actions.ts");
  const database = read("lib/content-db.ts");
  assert.match(admin, /listArticles/);
  assert.match(admin, /새 글 작성/);
  assert.match(admin, /type="search"/);
  assert.match(admin, /robots: \{ index: false, follow: false \}/);
  for (const action of ["createArticleAction", "updateArticleAction", "toggleArticleStatusAction", "deleteArticleAction"]) assert.match(actions, new RegExp(action));
  assert.equal((actions.match(/requireAdminSession/g) || []).length, 5);
  assert.match(database, /CREATE TABLE IF NOT EXISTS content_articles/);
  assert.match(database, /DATABASE_URL/);
  assert.match(database, /postgres\(url/);
  assert.doesNotMatch(database, /node:sqlite|growthline\.sqlite/);
  assert.match(read("proxy.ts"), /matcher: \["\/admin\/:path\*"\]/);
  assert.match(read("lib/admin-auth.ts"), /timingSafeEqual/);
  assert.match(read("lib/admin-session.ts"), /httpOnly|HS256|ADMIN_SESSION_SECRET/);
});

test("admin article form uses the local Naver SmartEditor adapter safely", () => {
  const form = read("components/admin-article-form.tsx");
  const imageUpload = read("components/admin-image-upload.tsx");
  const uploadRoute = read("app/api/admin/images/route.ts");
  const submitButton = read("components/admin-pending-submit-button.tsx");
  const editor = read("components/naver-smart-editor.tsx");
  const actions = read("app/admin/actions.ts");
  const detail = read("app/content/[slug]/page.tsx");

  assert.match(form, /NaverSmartEditor/);
  assert.match(form, /AdminPendingSubmitButton/);
  assert.match(form, /AdminImageUpload/);
  assert.doesNotMatch(form, /name="image" required/);
  assert.match(imageUpload, /type="file"/);
  assert.match(imageUpload, /api\/admin\/images/);
  assert.match(uploadRoute, /getAdminSession/);
  assert.match(uploadRoute, /MAX_IMAGE_BYTES/);
  assert.match(uploadRoute, /access: "private"/);
  assert.match(submitButton, /useFormStatus/);
  assert.match(submitButton, /disabled=\{disabled\}/);
  assert.match(editor, /HuskyEZCreator\.js/);
  assert.match(editor, /UPDATE_CONTENTS_FIELD/);
  assert.match(editor, /SmartEditor2Skin\.html/);
  assert.match(actions, /sanitizeArticleHtml/);
  assert.match(detail, /article\.bodyHtml/);
  assert.ok(fs.existsSync(path.join(root, "public/vendor/smarteditor2/LICENSE.md")));
  assert.ok(fs.existsSync(path.join(root, "public/vendor/smarteditor2/js/service/HuskyEZCreator.js")));
});

test("article saves return to the content list after a single pending submission", () => {
  const actions = read("app/admin/actions.ts");
  const submitButton = read("components/admin-pending-submit-button.tsx");

  assert.ok(actions.includes('"콘텐츠를 저장했습니다.")}#content'));
  assert.ok(actions.includes('"수정 사항을 저장했습니다.")}#content'));
  assert.match(submitButton, /저장 중…/);
  assert.match(submitButton, /aria-busy=\{disabled\}/);
  assert.match(submitButton, /isUploading/);
});

test("article images are optional and only accepted from local assets or Vercel Blob", () => {
  const actions = read("app/admin/actions.ts");
  const contentIndex = read("app/content/page.tsx");
  const contentDetail = read("app/content/[slug]/page.tsx");
  const imageRoute = read("app/api/content-images/[...pathname]/route.ts");

  assert.match(actions, /key !== "image" && key !== "imageAlt"/);
  assert.match(actions, /content-images/);
  assert.match(contentIndex, /OptionalImage/);
  assert.match(contentDetail, /article\.image \? \{ images/);
  assert.match(imageRoute, /get\(pathname\.join/);
  assert.match(imageRoute, /access: "private"/);
});

test("public header keeps customer login disabled and separate from administrator login", () => {
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

  assert.match(database, /is_dummy BOOLEAN NOT NULL DEFAULT FALSE/);
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
