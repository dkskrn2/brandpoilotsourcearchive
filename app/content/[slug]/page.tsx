import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { formatPublishedDate, getArticleBySlug, listPublishedArticles } from "@/lib/content-db";
import { absoluteUrl, breadcrumbJsonLd, ORGANIZATION_ID, serializeJsonLd, SITE_NAME, SITE_URL, webPageJsonLd, WEBSITE_ID } from "@/lib/seo";
import { notFound } from "next/navigation";
import { OptionalImage } from "@/components/optional-image";
import { ArticleContactCta } from "@/components/article-contact-cta";

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
  const articlePath = `/content/${article.slug}`;
  const articleUrl = absoluteUrl(articlePath);
  const publishedAt = article.publishedAt.includes("T") ? article.publishedAt : `${article.publishedAt}T09:00:00+09:00`;
  const breadcrumb = breadcrumbJsonLd([
    { name: "홈", path: "/" },
    { name: "콘텐츠", path: "/content" },
    { name: article.title, path: articlePath }
  ]);
  const pageJsonLd = webPageJsonLd({ name: article.title, description: article.summary, path: articlePath, hasBreadcrumb: true });
  const articleJsonLd = article.isDummy ? undefined : {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": `${articleUrl}#article`,
    url: articleUrl,
    headline: article.title,
    description: article.summary,
    ...(article.image ? { image: { "@type": "ImageObject", url: absoluteUrl(article.image), width: 1600, height: 1024, caption: article.imageAlt } } : {}),
    datePublished: publishedAt,
    dateModified: article.updatedAt,
    inLanguage: "ko-KR",
    articleSection: article.category,
    isPartOf: { "@id": WEBSITE_ID },
    mainEntityOfPage: { "@id": `${articleUrl}#webpage` },
    author: { "@id": ORGANIZATION_ID, "@type": "Organization", name: SITE_NAME, url: SITE_URL },
    publisher: { "@id": ORGANIZATION_ID }
  };

  return (
    <main className="article-page">
      <article>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(pageJsonLd) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumb) }} />
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

      <ArticleContactCta />

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
