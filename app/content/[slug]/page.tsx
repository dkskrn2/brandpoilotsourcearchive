import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { formatPublishedDate, getArticleBySlug, listPublishedArticles } from "@/lib/content-db";
import { serializeJsonLd, SITE_NAME, SITE_URL } from "@/lib/seo";
import { notFound } from "next/navigation";
import { OptionalImage } from "@/components/optional-image";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/content/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);
  if (!article) return {};
  return {
    title: article.title,
    description: article.summary,
    alternates: { canonical: `/content/${article.slug}` },
    robots: article.isDummy ? { index: false, follow: true } : { index: true, follow: true },
    openGraph: {
      title: article.title,
      description: article.summary,
      url: `/content/${article.slug}`,
      siteName: SITE_NAME,
      locale: "ko_KR",
      ...(article.image ? { images: [{ url: article.image, alt: article.imageAlt }] } : {}),
      type: "article",
      publishedTime: article.publishedAt,
      modifiedTime: article.updatedAt
    },
    twitter: article.image
      ? { card: "summary_large_image", title: article.title, description: article.summary, images: [article.image] }
      : { card: "summary", title: article.title, description: article.summary }
  };
}

export default async function ContentArticlePage({ params }: PageProps<"/content/[slug]">) {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);
  if (!article) notFound();
  const related = (await listPublishedArticles()).filter((item) => item.slug !== article.slug).slice(0, 2);
  const articleJsonLd = article.isDummy ? undefined : {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.summary,
    ...(article.image ? { image: new URL(article.image, SITE_URL).toString() } : {}),
    datePublished: article.publishedAt,
    dateModified: article.updatedAt,
    inLanguage: "ko-KR",
    mainEntityOfPage: `${SITE_URL}/content/${article.slug}`,
    author: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
    publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL }
  };

  return (
    <main className="article-page">
      <article>
        {articleJsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(articleJsonLd) }} />}
        <header className="article-header content-shell">
          <Link className="article-back" href="/content"><ArrowLeft aria-hidden size={18} /> 콘텐츠 목록</Link>
          <div className="content-meta"><span>{article.category}</span><time dateTime={article.publishedAt}>{formatPublishedDate(article.publishedAt)}</time><span>{article.readingTime} 읽기</span></div>
          <h1>{article.title}</h1>
          <p>{article.summary}</p>
        </header>

        {article.image && <figure className="article-hero-image content-shell">
          <OptionalImage src={article.image} alt={article.imageAlt} width={1600} height={1024} priority sizes="(max-width: 700px) calc(100vw - 32px), 1240px" />
        </figure>}

        <div className="article-body content-shell">
          <aside aria-label="글 정보"><strong>GROWTHLINE</strong><span>{article.category}</span><span>{formatPublishedDate(article.publishedAt)}</span></aside>
          <div className="article-prose">
            <p className="article-introduction">{article.introduction}</p>
            <div className="article-rich-content" dangerouslySetInnerHTML={{ __html: article.bodyHtml }} />
          </div>
        </div>
      </article>

      <section className="article-related">
        <div className="content-shell">
          <h2>함께 읽을 글</h2>
          <div>
            {related.map((item) => <Link key={item.slug} href={`/content/${item.slug}`}><span>{item.category}</span><strong>{item.title}</strong><ArrowUpRight aria-hidden size={20} /></Link>)}
          </div>
        </div>
      </section>
    </main>
  );
}
