import "server-only";

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { contentArticles, type ContentArticle, type ContentSection } from "@/lib/content";
import { editorTextToSections, sectionsToEditorText } from "@/lib/content-format.js";
import { articleBodyToHtml, isHtmlBody } from "@/lib/content-html";

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
  is_dummy: number;
  created_at: string;
  updated_at: string;
};

const globalForDb = globalThis as typeof globalThis & { growthlineContentDb?: DatabaseSync };

function normalizeSeedDate(value: string) {
  return value.replaceAll(".", "-");
}

function getDatabase() {
  if (globalForDb.growthlineContentDb) return globalForDb.growthlineContentDb;

  const databasePath = process.env.CONTENT_DB_PATH ?? path.join(process.cwd(), ".runtime", "growthline.sqlite");
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS content_articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      published_at TEXT NOT NULL,
      reading_time TEXT NOT NULL,
      image TEXT NOT NULL,
      image_alt TEXT NOT NULL,
      introduction TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
      is_dummy INTEGER NOT NULL DEFAULT 0 CHECK (is_dummy IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_content_articles_status_date ON content_articles(status, published_at DESC);
  `);

  const columns = database.prepare("PRAGMA table_info(content_articles)").all() as unknown as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "is_dummy")) {
    try {
      database.exec("ALTER TABLE content_articles ADD COLUMN is_dummy INTEGER NOT NULL DEFAULT 0 CHECK (is_dummy IN (0, 1))");
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("duplicate column name")) throw error;
    }
    const markDummy = database.prepare("UPDATE content_articles SET is_dummy = 1 WHERE slug = ?");
    for (const article of contentArticles) markDummy.run(article.slug);
  }

  const count = Number((database.prepare("SELECT COUNT(*) AS count FROM content_articles").get() as { count: number }).count);
  if (count === 0) {
    const insert = database.prepare(`
      INSERT INTO content_articles (
        slug, category, title, summary, published_at, reading_time, image, image_alt,
        introduction, body, status, is_dummy, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 1, ?, ?)
    `);
    const now = new Date().toISOString();
    database.exec("BEGIN");
    try {
      for (const article of contentArticles) {
        insert.run(
          article.slug,
          article.category,
          article.title,
          article.summary,
          normalizeSeedDate(article.publishedAt),
          article.readingTime,
          article.image,
          article.imageAlt,
          article.introduction,
          sectionsToEditorText(article.sections),
          now,
          now
        );
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  globalForDb.growthlineContentDb = database;
  return database;
}

function mapArticle(row: ArticleRow): StoredArticle {
  return {
    id: row.id,
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
    isDummy: row.is_dummy === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const selectColumns = `
  id, slug, category, title, summary, published_at, reading_time, image, image_alt,
  introduction, body, status, is_dummy, created_at, updated_at
`;

export function listArticles(options: { query?: string; status?: ArticleStatus } = {}) {
  const database = getDatabase();
  const clauses: string[] = [];
  const parameters: string[] = [];
  if (options.status) {
    clauses.push("status = ?");
    parameters.push(options.status);
  }
  if (options.query?.trim()) {
    clauses.push("(title LIKE ? OR category LIKE ? OR slug LIKE ?)");
    const query = `%${options.query.trim()}%`;
    parameters.push(query, query, query);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = database.prepare(`SELECT ${selectColumns} FROM content_articles ${where} ORDER BY published_at DESC, id DESC`).all(...parameters) as unknown as ArticleRow[];
  return rows.map(mapArticle);
}

export function listPublishedArticles() {
  return listArticles({ status: "published" });
}

export function listIndexableArticles() {
  return listPublishedArticles().filter((article) => !article.isDummy);
}

export function getArticleBySlug(slug: string, includeDraft = false) {
  const database = getDatabase();
  const sql = `SELECT ${selectColumns} FROM content_articles WHERE slug = ?${includeDraft ? "" : " AND status = 'published'"}`;
  const row = database.prepare(sql).get(slug) as unknown as ArticleRow | undefined;
  return row ? mapArticle(row) : undefined;
}

export function getArticleById(id: number) {
  const row = getDatabase().prepare(`SELECT ${selectColumns} FROM content_articles WHERE id = ?`).get(id) as unknown as ArticleRow | undefined;
  return row ? mapArticle(row) : undefined;
}

export function createArticle(input: ArticleInput) {
  const now = new Date().toISOString();
  const result = getDatabase().prepare(`
    INSERT INTO content_articles (
      slug, category, title, summary, published_at, reading_time, image, image_alt,
      introduction, body, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.slug, input.category, input.title, input.summary, input.publishedAt, input.readingTime,
    input.image, input.imageAlt, input.introduction, input.body, input.status, now, now
  );
  return Number(result.lastInsertRowid);
}

export function updateArticle(id: number, input: ArticleInput) {
  getDatabase().prepare(`
    UPDATE content_articles SET
      slug = ?, category = ?, title = ?, summary = ?, published_at = ?, reading_time = ?,
      image = ?, image_alt = ?, introduction = ?, body = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.slug, input.category, input.title, input.summary, input.publishedAt, input.readingTime,
    input.image, input.imageAlt, input.introduction, input.body, input.status, new Date().toISOString(), id
  );
}

export function updateArticleStatus(id: number, status: ArticleStatus) {
  getDatabase().prepare("UPDATE content_articles SET status = ?, updated_at = ? WHERE id = ?")
    .run(status, new Date().toISOString(), id);
}

export function deleteArticle(id: number) {
  getDatabase().prepare("DELETE FROM content_articles WHERE id = ?").run(id);
}

export function getContentStats() {
  const row = getDatabase().prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
      SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft,
      COUNT(DISTINCT category) AS categories
    FROM content_articles
  `).get() as { total: number; published: number; draft: number; categories: number };
  return { total: Number(row.total), published: Number(row.published), draft: Number(row.draft), categories: Number(row.categories) };
}

export function formatPublishedDate(value: string) {
  return value.replaceAll("-", ".");
}
