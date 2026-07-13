import "server-only";

import postgres from "postgres";
import { contentArticles, type ContentArticle, type ContentSection } from "@/lib/content";
import { CONTENT_PAGE_SIZE, type ContentListItem, type PublishedArticlePage } from "@/lib/content-pagination";
import { editorTextToSections } from "@/lib/content-format.js";
import { articleBodyToHtml, isHtmlBody, sectionsToArticleHtml } from "@/lib/content-html";

export type ArticleStatus = "draft" | "published";

export type StoredArticle = Omit<ContentArticle, "sections"> & {
  id: number;
  body: string;
  bodyHtml: string;
  sections: ContentSection[];
  status: ArticleStatus;
  isDummy: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ArticleInput = {
  slug: string;
  category: string;
  title: string;
  summary: string;
  publishedAt: string;
  readingTime: string;
  image: string;
  imageAlt: string;
  introduction: string;
  body: string;
  status: ArticleStatus;
};

export type ContactInquiry = {
  id: number;
  name: string;
  phone: string;
  email: string;
  site: string;
  message: string;
  plan: "seed" | "series-a" | "series-b" | null;
  agreed: boolean;
  createdAt: string;
};

export type ContactInquiryInput = Omit<ContactInquiry, "id" | "createdAt" | "plan">;

type ArticleRow = {
  id: number;
  slug: string;
  category: string;
  title: string;
  summary: string;
  published_at: string;
  reading_time: string;
  image: string;
  image_alt: string;
  introduction: string;
  body: string;
  status: ArticleStatus;
  is_dummy: boolean;
  created_at: string | Date;
  updated_at: string | Date;
};

type StatsRow = {
  total: string | number;
  published: string | number | null;
  draft: string | number | null;
  categories: string | number;
};

type ArticleSummaryRow = {
  slug: string;
  category: string;
  title: string;
  summary: string;
  published_at: string;
  reading_time: string;
  image: string;
  image_alt: string;
};

type ContactInquiryRow = {
  id: number;
  name: string;
  phone: string;
  email: string;
  site: string;
  message: string;
  plan: ContactInquiry["plan"];
  agreed: boolean;
  created_at: string | Date;
};

const globalForDb = globalThis as typeof globalThis & {
  growthlinePostgres?: ReturnType<typeof postgres>;
  growthlineSchemaPromise?: Promise<void>;
};

function connectionString() {
  return process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim() || "";
}

export function isDatabaseConfigured() {
  return Boolean(connectionString());
}

function getSql() {
  const url = connectionString();
  if (!url) {
    throw new Error("DATABASE_URL이 설정되지 않았습니다.");
  }
  if (!globalForDb.growthlinePostgres) {
    const isLocal = /(?:localhost|127\.0\.0\.1)/i.test(url);
    globalForDb.growthlinePostgres = postgres(url, {
      max: 3,
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false,
      ssl: isLocal ? false : "require"
    });
  }
  return globalForDb.growthlinePostgres;
}

function normalizeSeedDate(value: string) {
  return value.replaceAll(".", "-");
}

function toIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function seedArticles(): StoredArticle[] {
  return contentArticles.map((article, index) => {
    const publishedAt = normalizeSeedDate(article.publishedAt);
    const body = sectionsToArticleHtml(article.sections);
    const timestamp = `${publishedAt}T00:00:00.000Z`;
    return {
      ...article,
      id: index + 1,
      publishedAt,
      body,
      bodyHtml: body,
      status: "published",
      isDummy: false,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  });
}

async function ensureSchema() {
  if (globalForDb.growthlineSchemaPromise) return globalForDb.growthlineSchemaPromise;
  const sql = getSql();
  globalForDb.growthlineSchemaPromise = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS content_articles (
        id BIGSERIAL PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        published_at DATE NOT NULL,
        reading_time TEXT NOT NULL,
        image TEXT NOT NULL,
        image_alt TEXT NOT NULL,
        introduction TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
        is_dummy BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_content_articles_status_date ON content_articles(status, published_at DESC)`;
    await sql`
      CREATE TABLE IF NOT EXISTS contact_inquiries (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        site TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        plan TEXT CHECK (plan IN ('seed', 'series-a', 'series-b')),
        agreed BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`ALTER TABLE contact_inquiries ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE contact_inquiries ALTER COLUMN plan DROP NOT NULL`;
    await sql`CREATE INDEX IF NOT EXISTS idx_contact_inquiries_created_at ON contact_inquiries(created_at DESC)`;

    for (const article of contentArticles) {
      const now = new Date();
      await sql`
        INSERT INTO content_articles (
          slug, category, title, summary, published_at, reading_time, image, image_alt,
          introduction, body, status, is_dummy, created_at, updated_at
        ) VALUES (
          ${article.slug}, ${article.category}, ${article.title}, ${article.summary},
          ${normalizeSeedDate(article.publishedAt)}, ${article.readingTime}, ${article.image},
          ${article.imageAlt}, ${article.introduction}, ${sectionsToArticleHtml(article.sections)},
          'published', FALSE, ${now}, ${now}
        )
        ON CONFLICT (slug) DO UPDATE SET
          category = EXCLUDED.category,
          title = EXCLUDED.title,
          summary = EXCLUDED.summary,
          published_at = EXCLUDED.published_at,
          reading_time = EXCLUDED.reading_time,
          image = EXCLUDED.image,
          image_alt = EXCLUDED.image_alt,
          introduction = EXCLUDED.introduction,
          body = EXCLUDED.body,
          status = EXCLUDED.status,
          is_dummy = FALSE
        WHERE content_articles.created_at = content_articles.updated_at
      `;
      await sql`UPDATE content_articles SET is_dummy = FALSE WHERE slug = ${article.slug} AND is_dummy = TRUE`;
    }
  })().catch((error) => {
    globalForDb.growthlineSchemaPromise = undefined;
    throw error;
  });
  return globalForDb.growthlineSchemaPromise;
}

function mapArticle(row: ArticleRow): StoredArticle {
  return {
    id: Number(row.id),
    slug: row.slug,
    category: row.category,
    title: row.title,
    summary: row.summary,
    publishedAt: row.published_at,
    readingTime: row.reading_time,
    image: row.image,
    imageAlt: row.image_alt,
    introduction: row.introduction,
    body: row.body,
    bodyHtml: articleBodyToHtml(row.body),
    sections: isHtmlBody(row.body) ? [] : editorTextToSections(row.body) as ContentSection[],
    status: row.status,
    isDummy: row.is_dummy,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

const selectColumns = `
  id, slug, category, title, summary, published_at::text AS published_at, reading_time,
  image, image_alt, introduction, body, status, is_dummy, created_at, updated_at
`;

function fallbackArticles(options: { query?: string; status?: ArticleStatus } = {}) {
  const query = options.query?.trim().toLocaleLowerCase("ko-KR");
  return seedArticles().filter((article) => {
    if (options.status && article.status !== options.status) return false;
    if (!query) return true;
    return [article.title, article.category, article.slug].some((value) => value.toLocaleLowerCase("ko-KR").includes(query));
  }).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export async function listArticles(options: { query?: string; status?: ArticleStatus } = {}) {
  if (!isDatabaseConfigured()) return fallbackArticles(options);
  await ensureSchema();
  const sql = getSql();
  const statusFilter = options.status ? sql`AND status = ${options.status}` : sql``;
  const query = options.query?.trim();
  const queryFilter = query
    ? sql`AND (title ILIKE ${`%${query}%`} OR category ILIKE ${`%${query}%`} OR slug ILIKE ${`%${query}%`})`
    : sql``;
  const rows = await sql<ArticleRow[]>`
    SELECT ${sql.unsafe(selectColumns)} FROM content_articles
    WHERE TRUE ${statusFilter} ${queryFilter}
    ORDER BY published_at DESC, id DESC
  `;
  return rows.map(mapArticle);
}

export async function listPublishedArticles() {
  return listArticles({ status: "published" });
}

function toContentListItem(article: StoredArticle): ContentListItem {
  return {
    slug: article.slug,
    category: article.category,
    title: article.title,
    summary: article.summary,
    publishedAt: article.publishedAt,
    readingTime: article.readingTime,
    image: article.image,
    imageAlt: article.imageAlt
  };
}

function mapArticleSummary(row: ArticleSummaryRow): ContentListItem {
  return {
    slug: row.slug,
    category: row.category,
    title: row.title,
    summary: row.summary,
    publishedAt: row.published_at,
    readingTime: row.reading_time,
    image: row.image,
    imageAlt: row.image_alt
  };
}

export async function listPublishedArticlePage(page = 1, pageSize = CONTENT_PAGE_SIZE): Promise<PublishedArticlePage> {
  const safePage = Math.max(1, Math.floor(page));
  const safePageSize = Math.min(20, Math.max(1, Math.floor(pageSize)));
  const offset = (safePage - 1) * safePageSize;

  if (!isDatabaseConfigured()) {
    const articles = fallbackArticles({ status: "published" });
    const total = articles.length;
    return {
      items: articles.slice(offset, offset + safePageSize).map(toContentListItem),
      page: safePage,
      pageSize: safePageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / safePageSize))
    };
  }

  await ensureSchema();
  const sql = getSql();
  const countRows = await sql<{ total: string | number }[]>`
    SELECT COUNT(*) AS total FROM content_articles WHERE status = 'published'
  `;
  const rows = await sql<ArticleSummaryRow[]>`
    SELECT slug, category, title, summary, published_at::text AS published_at,
      reading_time, image, image_alt
    FROM content_articles
    WHERE status = 'published'
    ORDER BY published_at DESC, id DESC
    LIMIT ${safePageSize} OFFSET ${offset}
  `;
  const total = Number(countRows[0]?.total ?? 0);
  return {
    items: rows.map(mapArticleSummary),
    page: safePage,
    pageSize: safePageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / safePageSize))
  };
}

export async function listIndexableArticles() {
  return (await listPublishedArticles()).filter((article) => !article.isDummy);
}

export async function hasIndexableArticles() {
  if (!isDatabaseConfigured()) {
    return seedArticles().some((article) => article.status === "published" && !article.isDummy);
  }
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS(
      SELECT 1 FROM content_articles
      WHERE status = 'published' AND is_dummy = FALSE
    ) AS exists
  `;
  return Boolean(rows[0]?.exists);
}

export async function getArticleBySlug(slug: string, includeDraft = false) {
  if (!isDatabaseConfigured()) {
    return seedArticles().find((article) => article.slug === slug && (includeDraft || article.status === "published"));
  }
  await ensureSchema();
  const sql = getSql();
  const draftFilter = includeDraft ? sql`` : sql`AND status = 'published'`;
  const rows = await sql<ArticleRow[]>`
    SELECT ${sql.unsafe(selectColumns)} FROM content_articles WHERE slug = ${slug} ${draftFilter} LIMIT 1
  `;
  return rows[0] ? mapArticle(rows[0]) : undefined;
}

export async function getArticleById(id: number) {
  if (!isDatabaseConfigured()) return seedArticles().find((article) => article.id === id);
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<ArticleRow[]>`
    SELECT ${sql.unsafe(selectColumns)} FROM content_articles WHERE id = ${id} LIMIT 1
  `;
  return rows[0] ? mapArticle(rows[0]) : undefined;
}

export async function createArticle(input: ArticleInput) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<{ id: number }[]>`
    INSERT INTO content_articles (
      slug, category, title, summary, published_at, reading_time, image, image_alt,
      introduction, body, status, created_at, updated_at
    ) VALUES (
      ${input.slug}, ${input.category}, ${input.title}, ${input.summary}, ${input.publishedAt},
      ${input.readingTime}, ${input.image}, ${input.imageAlt}, ${input.introduction},
      ${input.body}, ${input.status}, NOW(), NOW()
    ) RETURNING id
  `;
  return Number(rows[0].id);
}

export async function updateArticle(id: number, input: ArticleInput) {
  await ensureSchema();
  const sql = getSql();
  await sql`
    UPDATE content_articles SET
      slug = ${input.slug}, category = ${input.category}, title = ${input.title},
      summary = ${input.summary}, published_at = ${input.publishedAt},
      reading_time = ${input.readingTime}, image = ${input.image}, image_alt = ${input.imageAlt},
      introduction = ${input.introduction}, body = ${input.body}, status = ${input.status},
      is_dummy = FALSE, updated_at = NOW()
    WHERE id = ${id}
  `;
}

export async function updateArticleStatus(id: number, status: ArticleStatus) {
  await ensureSchema();
  const sql = getSql();
  await sql`UPDATE content_articles SET status = ${status}, is_dummy = FALSE, updated_at = NOW() WHERE id = ${id}`;
}

export async function deleteArticle(id: number) {
  await ensureSchema();
  const sql = getSql();
  await sql`DELETE FROM content_articles WHERE id = ${id}`;
}

export async function getContentStats() {
  if (!isDatabaseConfigured()) {
    const articles = seedArticles();
    return {
      total: articles.length,
      published: articles.filter((article) => article.status === "published").length,
      draft: articles.filter((article) => article.status === "draft").length,
      categories: new Set(articles.map((article) => article.category)).size
    };
  }
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<StatsRow[]>`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'published') AS published,
      COUNT(*) FILTER (WHERE status = 'draft') AS draft,
      COUNT(DISTINCT category) AS categories
    FROM content_articles
  `;
  const row = rows[0];
  return {
    total: Number(row.total),
    published: Number(row.published ?? 0),
    draft: Number(row.draft ?? 0),
    categories: Number(row.categories)
  };
}

export async function createContactInquiry(input: ContactInquiryInput) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<{ id: number }[]>`
    INSERT INTO contact_inquiries (name, phone, email, site, message, agreed)
    VALUES (${input.name}, ${input.phone}, ${input.email}, ${input.site}, ${input.message}, ${input.agreed})
    RETURNING id
  `;
  return Number(rows[0].id);
}

export async function listContactInquiries(limit = 50): Promise<ContactInquiry[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<ContactInquiryRow[]>`
    SELECT id, name, phone, email, site, message, plan, agreed, created_at
    FROM contact_inquiries
    ORDER BY created_at DESC
    LIMIT ${Math.min(Math.max(limit, 1), 100)}
  `;
  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    phone: row.phone,
    email: row.email,
    site: row.site,
    message: row.message,
    plan: row.plan,
    agreed: row.agreed,
    createdAt: toIso(row.created_at)
  }));
}

export function formatPublishedDate(value: string) {
  return value.replaceAll("-", ".");
}
