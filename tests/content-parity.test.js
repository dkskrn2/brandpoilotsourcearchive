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
  for (const content of ["브랜드 기준으로", "근거를 등록합니다", "사람의 승인을 기본으로", "현재 게시 자동화는 Instagram 중심입니다", "어떤 게시 채널을 지원하나요"]) {
    assert.match(brandPilot, new RegExp(content), `Brand Pilot must preserve ${content}`);
  }
  assert.match(brandPilot, /className="brand-pilot-product"/);
  assert.equal((brandPilot.match(/href="\/contact">도입 상담하기/g) || []).length, 2, "product CTAs must use one clear label");
  assert.doesNotMatch(brandPilot, /[—–]/, "visible product copy must avoid em and en dashes");
  assert.match(serviceRoute, /slug === "brandpilot"/);
});

test("contact migration preserves the six original field names", () => {
  const source = read("components/contact-form.tsx");
  for (const field of ["name_company", "phone", "site_url", "plan", "message", "agree_privacy"]) {
    assert.match(source, new RegExp(`name=\\"${field}\\"`), `${field} must be preserved`);
  }
});

test("Brand Pilot has a first-class product route and navigation entry", () => {
  const header = read("components/site-header.tsx");
  const footer = read("components/site-footer.tsx");
  const product = read("app/product/page.tsx");
  const serviceRoute = read("app/service/[slug]/page.tsx");
  const sitemap = read("app/sitemap.ts");

  assert.equal((header.match(/href="\/product"/g) || []).length, 2, "desktop and mobile menus must expose Product");
  assert.match(footer, /href="\/product"/);
  assert.match(product, /BrandPilotPage/);
  assert.match(product, /SoftwareApplication/);
  assert.match(product, /mainEntity/);
  assert.match(product, /브랜드 콘텐츠 운영 시스템/);
  assert.match(product, /\/images\/product\/brand-pilot-workflow-v1\.webp/);
  assert.equal(fs.existsSync(path.join(root, "public/images/product/brand-pilot-workflow-v1.webp")), true);
  assert.ok(fs.statSync(path.join(root, "public/images/product/brand-pilot-workflow-v1.webp")).size < 150_000, "product visual must stay lightweight");
  assert.match(serviceRoute, /permanentRedirect\("\/product"\)/);
  assert.match(sitemap, /"\/product"/);
  assert.doesNotMatch(sitemap, /"\/service\/brandpilot"/);
  assert.match(read("app/globals.css"), /prefers-reduced-motion: no-preference/);
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

test("work migration keeps 22 projects with exactly one category each", () => {
  const projectCsv = read("data/seed/projects.csv");
  const projectModel = read("lib/projects.ts");
  const projectBrowser = read("components/projects-browser.tsx");
  const rows = projectCsv.trim().split(/\r?\n/);
  assert.equal(rows.length - 1, 22);
  assert.doesNotMatch(projectCsv, /;/, "a project must not belong to multiple categories");
  assert.match(projectCsv, /primary_link_type,domain_key,detail_enabled/);
  assert.match(projectModel, /domainKey: string/);
  assert.doesNotMatch(projectModel, /domainKeys/);
  assert.match(projectModel, /must have exactly one domain category/);
  assert.match(projectBrowser, /project\.domainKey === domain/);
  assert.match(read("app/work/page.tsx"), /getProjects\(\)/);
});

test("content hub reads published database articles as individual pages", () => {
  const contentData = read("lib/content.ts");
  const contentIndex = read("app/content/page.tsx");
  const contentDetail = read("app/content/[slug]/page.tsx");
  const contentFeed = read("components/infinite-content-list.tsx");
  const contentApi = read("app/api/content/route.ts");
  const contentDatabase = read("lib/content-db.ts");
  const header = read("components/site-header.tsx");

  for (const slug of ["brand-positioning-choice-criteria", "customer-lifecycle-retention-system", "brand-marketing-incrementality", "july-midyear-growth-review", "spotify-wrapped-data-to-brand-experience", "duolingo-habit-growth-loop", "dominos-digital-order-operating-system", "where-revenue-flow-stops", "research-before-redesign", "decision-ready-data", "repeatable-content-operations"]) {
    assert.match(contentData, new RegExp(slug));
  }
  assert.match(contentIndex, /listPublishedArticlePage/);
  assert.match(contentIndex, /hasIndexableArticles/);
  assert.match(contentIndex, /InfiniteContentList/);
  assert.match(contentIndex, /contentPageHref/);
  assert.match(contentFeed, /IntersectionObserver/);
  assert.match(contentFeed, /history\.replaceState/);
  assert.match(contentFeed, /aria-live="polite"/);
  assert.match(contentFeed, /href=\{contentPageHref\(nextPage\)\}/);
  assert.match(contentApi, /listPublishedArticlePage/);
  assert.match(contentApi, /Cache-Control.*no-store/);
  assert.match(contentDatabase, /LIMIT \$\{safePageSize\} OFFSET \$\{offset\}/);
  assert.match(contentDetail, /getArticleBySlug/);
  assert.match(contentDetail, /force-dynamic/);
  assert.match(header, /href="\/content"/);
});

test("seed articles provide long-form guidance with linked primary sources", () => {
  const contentData = read("lib/content.ts");
  const contentHtml = read("lib/content-html.ts");
  const database = read("lib/content-db.ts");

  assert.equal((contentData.match(/title: "참고 자료(?:와 해석 범위)?"/g) || []).length, 11);
  assert.ok((contentData.match(/\]\(https:\/\//g) || []).length >= 40, "articles must cite enough external sources");
  assert.equal((contentData.match(/readingTime: "(?:18|20)분"/g) || []).length, 11);
  assert.ok((contentData.match(/table: \{/g) || []).length >= 23, "articles must include worked comparison tables");
  assert.equal((contentData.match(/quote: "/g) || []).length, 11, "every article must establish a clear editorial thesis");
  const articleStarts = [...contentData.matchAll(/    slug: "([^"]+)"/g)];
  for (let index = 0; index < articleStarts.length; index += 1) {
    const start = articleStarts[index].index;
    const end = articleStarts[index + 1]?.index ?? contentData.indexOf("\n];", start);
    const articleSource = contentData.slice(start, end);
    const editorialText = [...articleSource.matchAll(/"([^"]+)"/g)].map((match) => match[1]).join("");
    assert.ok(editorialText.length >= 6000, `${articleStarts[index][1]} must provide long-form editorial depth`);
  }
  for (const phrase of ["목표 지표", "보호 지표", "참고 자료", "인과관계", "체크리스트"]) {
    assert.match(contentData, new RegExp(phrase), `long-form content must include ${phrase}`);
  }
  assert.match(contentHtml, /renderInlineMarkdown/);
  assert.match(contentHtml, /\\\/content\\\//, "inline Markdown must support internal content links");
  assert.match(contentHtml, /sectionsToArticleHtml/);
  assert.match(contentHtml, /<table>/);
  assert.match(contentHtml, /<blockquote>/);
  assert.match(contentHtml, /noopener noreferrer/);
  assert.match(database, /ON CONFLICT \(slug\) DO UPDATE SET/);
  assert.match(database, /created_at = content_articles\.updated_at/);
});

test("every seed article has a dedicated optimized editorial image", () => {
  const contentData = read("lib/content.ts");
  const assets = [
    "july-midyear-review-v1.webp",
    "spotify-wrapped-experience-v1.webp",
    "duolingo-habit-loop-v1.webp",
    "dominos-order-system-v1.webp",
    "revenue-bottleneck-v1.webp",
    "research-before-redesign-v1.webp",
    "decision-ready-data-v1.webp",
    "content-operations-v1.webp",
    "brand-positioning-choice-v1.webp",
    "customer-lifecycle-retention-v1.webp",
    "brand-marketing-incrementality-v1.webp"
  ];

  for (const asset of assets) {
    assert.match(contentData, new RegExp(`/images/content/${asset}`));
    const imagePath = path.join(root, "public", "images", "content", asset);
    assert.ok(fs.existsSync(imagePath), `${asset} must exist`);
    assert.ok(fs.statSync(imagePath).size < 250 * 1024, `${asset} must stay below 250KB`);
  }
});

test("every article ends with a branded contact CTA before related reading", () => {
  const route = read("app/content/[slug]/page.tsx");
  const cta = read("components/article-contact-cta.tsx");
  const styles = read("app/globals.css");

  const ctaPosition = route.indexOf("<ArticleContactCta />");
  const relatedPosition = route.indexOf('className="article-related"');
  assert.ok(ctaPosition > -1, "article route must render the contact CTA");
  assert.ok(relatedPosition > ctaPosition, "contact CTA must follow the article and precede related reading");
  assert.match(cta, /href="\/contact"/);
  assert.match(cta, /15분 사전 진단/);
  assert.match(cta, /무료 사전 진단 신청하기/);
  assert.match(styles, /\.article-contact-cta__button/);
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

test("admin article categories come from one controlled list", () => {
  const form = read("components/admin-article-form.tsx");
  const actions = read("app/admin/actions.ts");
  const categories = read("lib/content-categories.ts");

  assert.match(form, /CONTENT_CATEGORIES\.map/);
  assert.match(form, /<select name="category" required/);
  assert.doesNotMatch(form, /<input name="category"/);
  assert.match(actions, /isContentCategory\(input\.category\)/);

  for (const category of [
    "Brand Strategy",
    "Growth Strategy",
    "Lifecycle Marketing",
    "Marketing Measurement",
    "Brand Case Study",
    "Product Case Study",
    "Digital Transformation",
    "Growth Operations",
    "UX Research",
    "Data Analytics",
    "Content Operations"
  ]) {
    assert.match(categories, new RegExp(`"${category}"`));
  }
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

test("SEO and AEO settings expose authored content and protect private routes", () => {
  const database = read("lib/content-db.ts");
  const sitemap = read("app/sitemap.ts");
  const contentIndex = read("app/content/page.tsx");
  const contentDetail = read("app/content/[slug]/page.tsx");
  const serviceDetail = read("app/service/[slug]/page.tsx");
  const robots = read("app/robots.ts");
  const seo = read("lib/seo.ts");
  const nextConfig = read("next.config.ts");

  assert.match(database, /is_dummy BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(database, /isDummy: false/);
  assert.match(database, /SET is_dummy = FALSE/);
  assert.match(database, /listIndexableArticles/);
  assert.match(sitemap, /listIndexableArticles/);
  assert.doesNotMatch(sitemap, /listPublishedArticles/);
  assert.match(contentDetail, /article\.isDummy \? \{ index: false/);
  assert.match(contentDetail, /BlogPosting/);
  assert.match(contentDetail, /breadcrumbJsonLd/);
  assert.match(contentIndex, /CollectionPage/);
  assert.match(serviceDetail, /serviceJsonLd/);
  assert.match(robots, /OAI-SearchBot/);
  assert.match(robots, /api\/content-images/);
  assert.match(nextConfig, /X-Robots-Tag/);
  assert.match(seo, /alternates: \{ canonical: path \}/);
  assert.match(seo, /BreadcrumbList/);
  assert.match(seo, /"@type": "Service"/);
  assert.match(seo, /summary_large_image/);
  assert.match(seo, /replaceAll\("<", "\\\\u003c"\)/);
});
