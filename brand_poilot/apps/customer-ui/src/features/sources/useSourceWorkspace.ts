import { useCallback, useEffect, useState } from "react";
import { api, DEMO_BRAND_ID } from "../../lib/apiClient";
import type { SourceCrawlRun, SourceSnapshot, SourceUrl } from "../../types";

type SourceApi = Pick<typeof api,
  "listSources" | "listSourceSnapshots" | "listSourceCrawlRuns" |
  "createSource" | "updateSource" | "retrySource" | "deleteSource" | "crawlSources"
>;

export interface SourceWorkspace {
  sources: SourceUrl[];
  snapshots: SourceSnapshot[];
  crawlRuns: SourceCrawlRun[];
  loading: boolean;
  notice: string | null;
  clearNotice(): void;
  reload(): Promise<void>;
  add(sourceType: SourceUrl["sourceType"], url: string): Promise<boolean>;
  update(sourceId: string, payload: { sourceType?: SourceUrl["sourceType"]; url?: string; enabled?: boolean }): Promise<boolean>;
  remove(source: SourceUrl): Promise<boolean>;
  retry(source: SourceUrl): Promise<boolean>;
  crawlAll(): Promise<boolean>;
}

function sourceError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("source_reference_limit_exceeded")) return "참고 URL은 최대 10개까지 등록할 수 있습니다.";
  if (message.includes("source_url_duplicate")) return "같은 유형에 이미 등록된 URL입니다.";
  if (message.includes("source_url_invalid") || message.includes("invalid_url")) return "http:// 또는 https://로 시작하는 올바른 URL을 입력하세요.";
  return "API 저장에 실패했습니다. URL을 다시 확인하세요.";
}

export function useSourceWorkspace(client: SourceApi = api, brandId = DEMO_BRAND_ID): SourceWorkspace {
  const [sources, setSources] = useState<SourceUrl[]>([]);
  const [snapshots, setSnapshots] = useState<SourceSnapshot[]>([]);
  const [crawlRuns, setCrawlRuns] = useState<SourceCrawlRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const [sourceResult, snapshotResult, runResult] = await Promise.allSettled([
      client.listSources(brandId),
      client.listSourceSnapshots(brandId),
      client.listSourceCrawlRuns(brandId),
    ]);
    if (sourceResult.status === "fulfilled") {
      setSources(sourceResult.value);
    } else {
      setSources([]);
      setNotice("API 서버가 응답하지 않아 URL 목록을 불러오지 못했습니다.");
    }
    setSnapshots(snapshotResult.status === "fulfilled" ? snapshotResult.value : []);
    setCrawlRuns(runResult.status === "fulfilled" ? runResult.value : []);
    setLoading(false);
  }, [brandId, client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function add(sourceType: SourceUrl["sourceType"], url: string) {
    const normalized = url.trim();
    if (!normalized) return false;
    try {
      const created = await client.createSource(brandId, { sourceType, url: normalized });
      setSources((current) => [created.source, ...current]);
      setCrawlRuns((current) => [created.initialCrawl, ...current]);
      setNotice(created.initialCrawl.status === "succeeded"
        ? `초기 크롤링 완료: 새 콘텐츠 ${created.initialCrawl.created}개`
        : "URL은 저장했지만 초기 크롤링에 실패했습니다. 재시도할 수 있습니다.");
      return true;
    } catch (error) {
      setNotice(sourceError(error));
      return false;
    }
  }

  async function update(sourceId: string, payload: { sourceType?: SourceUrl["sourceType"]; url?: string; enabled?: boolean }) {
    try {
      const updated = await client.updateSource(sourceId, payload);
      setSources((current) => current.map((source) => source.id === updated.id ? updated : source));
      setNotice(null);
      return true;
    } catch (error) {
      setNotice(sourceError(error));
      return false;
    }
  }

  async function remove(source: SourceUrl) {
    try {
      await client.deleteSource(source.id);
      setSources((current) => current.filter((item) => item.id !== source.id));
      setNotice(null);
      return true;
    } catch {
      setNotice("API 삭제에 실패했습니다. API 상태를 확인하세요.");
      return false;
    }
  }

  async function retry(source: SourceUrl) {
    try {
      const run = await client.retrySource(brandId, source.id);
      setCrawlRuns((current) => [run, ...current]);
      await reload();
      setNotice(run.status === "succeeded" ? `재크롤링 완료: 새 콘텐츠 ${run.created}개` : "재크롤링 중 일부 URL을 처리하지 못했습니다.");
      return true;
    } catch {
      setNotice("재크롤링을 시작하지 못했습니다.");
      return false;
    }
  }

  async function crawlAll() {
    try {
      const result = await client.crawlSources(brandId);
      await reload();
      setNotice(`크롤링 완료: 처리 ${result.processed}개, 성공 ${result.created}개, 실패 ${result.failed}개`);
      return true;
    } catch {
      setNotice("크롤링 실행에 실패했습니다.");
      return false;
    }
  }

  return {
    sources,
    snapshots,
    crawlRuns,
    loading,
    notice,
    clearNotice: () => setNotice(null),
    reload,
    add,
    update,
    remove,
    retry,
    crawlAll,
  };
}
