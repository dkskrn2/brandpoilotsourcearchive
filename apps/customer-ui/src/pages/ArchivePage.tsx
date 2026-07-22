import { useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { TrendMediaCard } from "../components/trends/TrendMediaCard";
import { TrendMediaDetailDialog } from "../components/trends/TrendMediaDetailDialog";
import { Alert } from "../components/ui/Alert";
import { EmptyState } from "../components/ui/EmptyState";
import { PageSkeleton } from "../components/ui/LoadingState";
import { api, DEMO_BRAND_ID } from "../lib/apiClient";
import type { InstagramTrendArchivePage, InstagramTrendMedia } from "../types";

const archivePageSize = 30;

export function ArchivePage() {
  const [pageNumber, setPageNumber] = useState(1);
  const [archive, setArchive] = useState<InstagramTrendArchivePage | null>(null);
  const [selectedMedia, setSelectedMedia] = useState<InstagramTrendMedia | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    void api.listInstagramTrendArchive(DEMO_BRAND_ID, { page: pageNumber, limit: archivePageSize })
      .then((result) => { if (active) setArchive(result); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [pageNumber]);

  const hasNextPage = Boolean(archive && archive.page * archive.limit < archive.total);

  async function removeMedia(media: InstagramTrendMedia) {
    const snapshot = archive;
    if (!snapshot) return;
    setError(false);
    setArchive({ ...snapshot, items: snapshot.items.filter((item) => item.id !== media.id), total: Math.max(0, snapshot.total - 1) });
    if (selectedMedia?.id === media.id) setSelectedMedia(null);
    try {
      await api.removeInstagramTrendSource(DEMO_BRAND_ID, media.id);
      if (snapshot.page > 1 && snapshot.items.length === 1) setPageNumber(snapshot.page - 1);
    } catch {
      setArchive(snapshot);
      setError(true);
    }
  }

  return <section className="content archive-page">
    <PageHeader title="아카이브" description="트렌드 탐색에서 북마크한 Instagram 콘텐츠를 모아 봅니다." />
    {loading && !archive ? <PageSkeleton label="아카이브를 불러오는 중입니다." /> : null}
    {!loading && error ? <Alert title="아카이브를 불러오지 못했습니다" variant="warn">잠시 후 다시 시도해 주세요.</Alert> : null}
    {!loading && !error && archive?.items.length === 0 ? <EmptyState title="저장한 트렌드가 없습니다." description="트렌드 탐색에서 북마크하면 이곳에 표시됩니다." /> : null}
    {archive?.items.length ? <>
      <div className="archive-summary"><strong>저장한 콘텐츠 {archive.total.toLocaleString("ko-KR")}개</strong></div>
      <div className="trend-media-grid archive-media-grid">
        {archive.items.map((media) => <TrendMediaCard key={media.id} media={media} onSelect={setSelectedMedia} onUnbookmark={removeMedia} />)}
      </div>
      <div className="trend-pagination">
        {archive.page > 1 ? <button className="button" type="button" disabled={loading} onClick={() => setPageNumber((current) => Math.max(1, current - 1))}>이전 30개</button> : null}
        {hasNextPage ? <button className="button" type="button" disabled={loading} onClick={() => setPageNumber((current) => current + 1)}>다음 30개</button> : null}
      </div>
    </> : null}
    {selectedMedia ? <TrendMediaDetailDialog media={selectedMedia} onClose={() => setSelectedMedia(null)} onSave={() => api.saveInstagramTrendSource(DEMO_BRAND_ID, selectedMedia.id)} /> : null}
  </section>;
}
