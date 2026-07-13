"use client";

import Link from "next/link";
import { ArrowDown, ArrowUpRight, CircleNotch } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { OptionalImage } from "@/components/optional-image";
import { contentPageHref, type ContentListItem, type PublishedArticlePage } from "@/lib/content-pagination";

type ContentChunk = {
  page: number;
  items: ContentListItem[];
};

type InfiniteContentListProps = {
  currentPage: number;
  initialItems: ContentListItem[];
  total: number;
  totalPages: number;
  featuredCount?: number;
};

function ContentListArticle({ article }: { article: ContentListItem }) {
  return (
    <article className={article.image ? undefined : "content-list__item--no-image"}>
      {article.image && (
        <Link className="content-list__image" href={`/content/${article.slug}`} aria-label={`${article.title} 읽기`}>
          <OptionalImage src={article.image} alt={article.imageAlt} width={960} height={640} sizes="(max-width: 700px) 112px, 260px" />
        </Link>
      )}
      <div>
        <div className="content-meta">
          <span>{article.category}</span>
          <time dateTime={article.publishedAt}>{article.publishedAt.replaceAll("-", ".")}</time>
          <span>{article.readingTime} 읽기</span>
        </div>
        <h3><Link href={`/content/${article.slug}`}>{article.title}</Link></h3>
        <p>{article.summary}</p>
      </div>
      <Link className="content-list__arrow" href={`/content/${article.slug}`} aria-label={`${article.title} 읽기`}>
        <ArrowUpRight aria-hidden size={23} />
      </Link>
    </article>
  );
}

export function InfiniteContentList({ currentPage, initialItems, total, totalPages, featuredCount = 0 }: InfiniteContentListProps) {
  const [chunks, setChunks] = useState<ContentChunk[]>([{ page: currentPage, items: initialItems }]);
  const [nextPage, setNextPage] = useState<number | null>(currentPage < totalPages ? currentPage + 1 : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  const loadNextPage = useCallback(async (event?: MouseEvent<HTMLAnchorElement>) => {
    event?.preventDefault();
    if (!nextPage || loadingRef.current) return;

    loadingRef.current = true;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/content?page=${nextPage}`, {
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error("다음 콘텐츠를 불러오지 못했습니다.");
      const result = await response.json() as PublishedArticlePage;
      setChunks((previous) => previous.some((chunk) => chunk.page === result.page)
        ? previous
        : [...previous, { page: result.page, items: result.items }]);
      setNextPage(result.page < result.totalPages ? result.page + 1 : null);
    } catch {
      setError("자동으로 불러오지 못했습니다. 아래 링크를 눌러 다시 시도해 주세요.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [nextPage]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !nextPage || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadNextPage();
    }, { rootMargin: "500px 0px", threshold: 0.01 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadNextPage, nextPage]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !("IntersectionObserver" in window)) return;
    const visiblePages = new Map<number, number>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const page = Number((entry.target as HTMLElement).dataset.page);
        if (entry.isIntersecting) visiblePages.set(page, entry.intersectionRatio);
        else visiblePages.delete(page);
      }
      const primaryPage = [...visiblePages.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (primaryPage) window.history.replaceState(window.history.state, "", contentPageHref(primaryPage));
    }, { rootMargin: "-25% 0px -45%", threshold: [0.01, 0.2, 0.5] });
    list.querySelectorAll<HTMLElement>("[data-content-page]").forEach((chunk) => observer.observe(chunk));
    return () => observer.disconnect();
  }, [chunks]);

  const loadedCount = featuredCount + chunks.reduce((count, chunk) => count + chunk.items.length, 0);

  return (
    <>
      <div className="content-list__items" ref={listRef}>
        {chunks.map((chunk) => (
          <div className="content-list__chunk" data-content-page data-page={chunk.page} key={chunk.page}>
            {chunk.items.map((article) => <ContentListArticle article={article} key={article.slug} />)}
          </div>
        ))}
      </div>

      <div className="content-list__loader" ref={sentinelRef} aria-busy={loading}>
        <p className="content-list__status" aria-live="polite">
          {loading ? "다음 콘텐츠를 불러오는 중입니다." : `${total}개 중 ${Math.min(loadedCount, total)}개를 표시했습니다.`}
        </p>
        {nextPage ? (
          <a href={contentPageHref(nextPage)} onClick={loadNextPage} aria-disabled={loading}>
            {loading ? <CircleNotch className="content-list__spinner" aria-hidden size={20} /> : <ArrowDown aria-hidden size={20} />}
            {loading ? "다음 글을 불러오는 중" : "다음 글 불러오기"}
          </a>
        ) : (
          <p className="content-list__complete">모든 콘텐츠를 확인했습니다.</p>
        )}
        {error && <p className="content-list__error" role="alert">{error}</p>}
      </div>
    </>
  );
}
