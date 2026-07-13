import { contentArticles } from "../lib/content.ts";
import { sectionsToArticleHtml } from "../lib/content-html.ts";
import { writeFileSync } from "node:fs";

const rows = contentArticles.map((article) => ({
  slug: article.slug,
  category: article.category,
  title: article.title,
  summary: article.summary,
  publishedAt: article.publishedAt.replaceAll(".", "-"),
  readingTime: article.readingTime,
  image: article.image,
  imageAlt: article.imageAlt,
  introduction: article.introduction,
  body: sectionsToArticleHtml(article.sections)
}));

const delimiter = "$danbam_content_sync$";
const payload = JSON.stringify(rows);

if (payload.includes(delimiter)) {
  throw new Error("The content payload contains the SQL dollar-quote delimiter.");
}

export const contentUpsertSql = `
WITH source AS (
  SELECT *
  FROM jsonb_to_recordset(${delimiter}${payload}${delimiter}::jsonb) AS row(
    slug TEXT,
    category TEXT,
    title TEXT,
    summary TEXT,
    "publishedAt" TEXT,
    "readingTime" TEXT,
    image TEXT,
    "imageAlt" TEXT,
    introduction TEXT,
    body TEXT
  )
), upserted AS (
  INSERT INTO content_articles (
    slug, category, title, summary, published_at, reading_time, image, image_alt,
    introduction, body, status, is_dummy, created_at, updated_at
  )
  SELECT
    slug, category, title, summary, "publishedAt"::date, "readingTime", image, "imageAlt",
    introduction, body, 'published', FALSE, NOW(), NOW()
  FROM source
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
    status = 'published',
    is_dummy = FALSE,
    updated_at = NOW()
  RETURNING slug, reading_time, body, status, published_at
)
SELECT
  slug,
  reading_time,
  length(body) AS body_chars,
  status,
  position('<table>' in body) > 0 AS has_table,
  position('<blockquote>' in body) > 0 AS has_quote
FROM upserted
ORDER BY published_at DESC;
`;

export const contentUpsertRows = rows.map(({ slug, readingTime, body }) => ({
  slug,
  readingTime,
  bodyChars: body.length
}));

const outputIndex = process.argv.indexOf("--out");
if (outputIndex >= 0) {
  const outputPath = process.argv[outputIndex + 1];
  if (!outputPath) throw new Error("--out requires a file path.");
  writeFileSync(outputPath, contentUpsertSql, "utf8");
  console.log(`Wrote ${contentUpsertSql.length} SQL characters for ${rows.length} articles.`);
}
