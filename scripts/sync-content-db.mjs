import postgres from "postgres";
import { contentArticles } from "../lib/content.ts";
import { sectionsToArticleHtml } from "../lib/content-html.ts";

const shouldApply = process.argv.includes("--apply");
const databaseUrl = process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim();

if (!databaseUrl) {
  console.error("DATABASE_URL 또는 POSTGRES_URL이 필요합니다.");
  process.exit(1);
}

const sql = postgres(databaseUrl, {
  max: 1,
  idle_timeout: 5,
  connect_timeout: 15,
  prepare: false
});

const slugs = contentArticles.map((article) => article.slug);

try {
  const existing = await sql`
    SELECT slug, reading_time, length(body) AS body_chars, status, updated_at
    FROM content_articles
    WHERE slug = ANY(${slugs})
  `;
  const existingBySlug = new Map(existing.map((row) => [row.slug, row]));
  const preview = contentArticles.map((article) => {
    const previous = existingBySlug.get(article.slug);
    return {
      action: previous ? "update" : "insert",
      slug: article.slug,
      before: previous ? `${previous.reading_time} / ${previous.body_chars}자` : "없음",
      after: `${article.readingTime} / ${sectionsToArticleHtml(article.sections).length}자`
    };
  });

  console.table(preview);

  if (!shouldApply) {
    console.log("미리보기만 완료했습니다. 실제 반영은 --apply 옵션이 필요합니다.");
    process.exit(0);
  }

  await sql.begin(async (transaction) => {
    for (const article of contentArticles) {
      const body = sectionsToArticleHtml(article.sections);
      await transaction`
        INSERT INTO content_articles (
          slug, category, title, summary, published_at, reading_time, image, image_alt,
          introduction, body, status, is_dummy, created_at, updated_at
        ) VALUES (
          ${article.slug}, ${article.category}, ${article.title}, ${article.summary},
          ${article.publishedAt.replaceAll(".", "-")}, ${article.readingTime}, ${article.image},
          ${article.imageAlt}, ${article.introduction}, ${body},
          'published', FALSE, NOW(), NOW()
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
          status = 'published',
          is_dummy = FALSE,
          updated_at = NOW()
      `;
    }
  });

  const verified = await sql`
    SELECT slug, reading_time, length(body) AS body_chars, status,
      position('<table>' in body) > 0 AS has_table,
      position('<blockquote>' in body) > 0 AS has_quote
    FROM content_articles
    WHERE slug = ANY(${slugs})
    ORDER BY published_at DESC
  `;
  console.table(verified);
  console.log(`${verified.length}개 콘텐츠를 운영 DB에 반영했습니다.`);
} finally {
  await sql.end();
}
