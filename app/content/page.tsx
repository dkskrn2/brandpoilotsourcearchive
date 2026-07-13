import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { formatPublishedDate, listIndexableArticles, listPublishedArticles } from "@/lib/content-db";
import { absoluteUrl, breadcrumbJsonLd, createPageMetadata, serializeJsonLd, webPageJsonLd } from "@/lib/seo";
import { OptionalImage } from "@/components/optional-image";

export async function generateMetadata(): Promise<Metadata> {
  const hasRealContent = (await listIndexableArticles()).length > 0;
  return createPageMetadata({
    title: "Content",
    description: "고객, 데이터, 전환과 운영에 관한 GROWTHLINE의 관점과 실무 기준을 공유합니다.",
    path: "/content",
    noIndex: !hasRealContent
  });
}

export const dynamic = "force-dynamic";

export default async function ContentPage() {
  const publishedArticles = await listPublishedArticles();
  const [featured, ...articles] = publishedArticles;
  const breadcrumb = breadcrumbJsonLd([{ name: "홈", path: "/" }, { name: "콘텐츠", path: "/content" }]);
  const pageJsonLd = {
    ...webPageJsonLd({
      name: "GROWTHLINE Content",
      description: "고객, 데이터, 전환과 운영에 관한 GROWTHLINE의 관점과 실무 기준을 공유합니다.",
      path: "/content",
      type: "CollectionPage",
      hasBreadcrumb: true
    }),
    mainEntity: {
      "@type": "ItemList",
      itemListElement: publishedArticles.map((article, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: article.title,
        url: absoluteUrl(`/content/${article.slug}`)
      }))
    }
  };

  return (
    <main className="content-index">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(pageJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumb) }} />
      {featured ? <section className={`content-featured content-shell${featured.image ? "" : " content-featured--no-image"}`}>
        {featured.image && <Link href={`/content/${featured.slug}`} className="content-featured__image" aria-label={`${featured.title} 읽기`}>
          <OptionalImage src={featured.image} alt={featured.imageAlt} width={1600} height={1024} priority sizes="(max-width: 800px) calc(100vw - 32px), 60vw" />
        </Link>}
        <div className="content-featured__copy">
          <div className="content-meta"><span>{featured.category}</span><time dateTime={featured.publishedAt}>{formatPublishedDate(featured.publishedAt)}</time><span>{featured.readingTime} 읽기</span></div>
          <h2><Link href={`/content/${featured.slug}`}>{featured.title}</Link></h2>
          <p>{featured.summary}</p>
          <Link className="content-read-link" href={`/content/${featured.slug}`}>글 읽기 <ArrowUpRight aria-hidden size={18} weight="bold" /></Link>
        </div>
      </section> : <section className="content-empty content-shell"><h2>아직 게시된 콘텐츠가 없습니다.</h2><p>새로운 글을 준비하고 있습니다.</p></section>}

      <section className="content-list content-shell" aria-labelledby="content-list-title">
        <div className="content-list__heading">
          <h2 id="content-list-title">새로운 글</h2>
          <p>고객과 데이터, 전환과 운영에 관한 실무 기준을 순차적으로 업데이트합니다.</p>
        </div>
        <div className="content-list__items">
          {articles.map((article) => (
            <article key={article.slug} className={article.image ? undefined : "content-list__item--no-image"}>
              {article.image && <Link className="content-list__image" href={`/content/${article.slug}`} aria-label={`${article.title} 읽기`}>
                <OptionalImage src={article.image} alt={article.imageAlt} width={960} height={640} sizes="(max-width: 700px) 112px, 260px" />
              </Link>}
              <div>
                <div className="content-meta"><span>{article.category}</span><time dateTime={article.publishedAt}>{formatPublishedDate(article.publishedAt)}</time><span>{article.readingTime} 읽기</span></div>
                <h3><Link href={`/content/${article.slug}`}>{article.title}</Link></h3>
                <p>{article.summary}</p>
              </div>
              <Link className="content-list__arrow" href={`/content/${article.slug}`} aria-label={`${article.title} 읽기`}><ArrowUpRight aria-hidden size={23} /></Link>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
