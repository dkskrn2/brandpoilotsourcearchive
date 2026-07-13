import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { formatPublishedDate, hasIndexableArticles, listPublishedArticlePage } from "@/lib/content-db";
import { absoluteUrl, breadcrumbJsonLd, createPageMetadata, serializeJsonLd, webPageJsonLd } from "@/lib/seo";
import { OptionalImage } from "@/components/optional-image";
import { InfiniteContentList } from "@/components/infinite-content-list";
import { CONTENT_PAGE_SIZE, contentPageHref, normalizeContentPage } from "@/lib/content-pagination";

export async function generateMetadata({ searchParams }: PageProps<"/content">): Promise<Metadata> {
  const page = normalizeContentPage((await searchParams).page);
  const hasRealContent = await hasIndexableArticles();
  return createPageMetadata({
    title: page > 1 ? `Content ${page}페이지` : "Content",
    description: "고객, 데이터, 전환과 운영에 관한 GROWTHLINE의 관점과 실무 기준을 공유합니다.",
    path: contentPageHref(page),
    noIndex: !hasRealContent
  });
}

export const dynamic = "force-dynamic";

export default async function ContentPage({ searchParams }: PageProps<"/content">) {
  const page = normalizeContentPage((await searchParams).page);
  const publishedPage = await listPublishedArticlePage(page, CONTENT_PAGE_SIZE);
  if (publishedPage.total > 0 && page > publishedPage.totalPages) notFound();

  const featured = page === 1 ? publishedPage.items[0] : undefined;
  const articles = page === 1 ? publishedPage.items.slice(1) : publishedPage.items;
  const pagePath = contentPageHref(page);
  const breadcrumb = breadcrumbJsonLd([{ name: "홈", path: "/" }, { name: "콘텐츠", path: "/content" }]);
  const pageJsonLd = {
    ...webPageJsonLd({
      name: page > 1 ? `GROWTHLINE Content ${page}페이지` : "GROWTHLINE Content",
      description: "고객, 데이터, 전환과 운영에 관한 GROWTHLINE의 관점과 실무 기준을 공유합니다.",
      path: pagePath,
      type: "CollectionPage",
      hasBreadcrumb: true
    }),
    mainEntity: {
      "@type": "ItemList",
      itemListElement: publishedPage.items.map((article, index) => ({
        "@type": "ListItem",
        position: (page - 1) * publishedPage.pageSize + index + 1,
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
      </section> : publishedPage.total === 0 ? <section className="content-empty content-shell"><h2>아직 게시된 콘텐츠가 없습니다.</h2><p>새로운 글을 준비하고 있습니다.</p></section> : null}

      {publishedPage.total > 0 && <section className="content-list content-shell" aria-labelledby="content-list-title">
        <div className="content-list__heading">
          {page > 1 && <Link className="content-list__previous" href={contentPageHref(page - 1)}><ArrowLeft aria-hidden size={18} /> 이전 페이지</Link>}
          <h2 id="content-list-title">{page > 1 ? `새로운 글 ${page}페이지` : "새로운 글"}</h2>
          <p>고객과 데이터, 전환과 운영에 관한 실무 기준을 순차적으로 업데이트합니다.</p>
        </div>
        <InfiniteContentList
          currentPage={page}
          initialItems={articles}
          total={publishedPage.total}
          totalPages={publishedPage.totalPages}
          featuredCount={featured ? 1 : 0}
        />
      </section>}
    </main>
  );
}
