import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  api,
  SUPPORT_REQUESTS_CHANGED_EVENT,
} from "../../lib/apiClient";
import type { SupportRequest, SupportRequestCategory } from "../../types";
import { Badge } from "../ui/Badge";
import { ListSkeleton } from "../ui/LoadingState";

const categoryLabels: Record<SupportRequestCategory, string> = {
  bug: "오류",
  feature: "기능 요청",
  channel: "채널",
  account: "계정",
  other: "기타",
};

const statusLabels: Record<SupportRequest["status"], string> = {
  new: "접수",
  in_progress: "처리중",
  resolved: "답변 완료",
};

function statusVariant(status: SupportRequest["status"]) {
  if (status === "resolved") return "ok";
  if (status === "in_progress") return "info";
  return "warn";
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("ko-KR", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface SupportRequestHistoryProps {
  brandId: string;
  listRequests?: typeof api.listSupportRequests;
  refreshToken?: number;
}

export function SupportRequestHistory({
  brandId,
  listRequests = api.listSupportRequests,
  refreshToken,
}: SupportRequestHistoryProps) {
  const [requests, setRequests] = useState<SupportRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialError, setInitialError] = useState(false);
  const [refreshWarning, setRefreshWarning] = useState(false);
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const loadedOnce = useRef(false);

  useLayoutEffect(() => {
    requestGeneration.current += 1;
    loadedOnce.current = false;
    setRequests([]);
    setLoading(true);
    setInitialError(false);
    setRefreshWarning(false);
    setExpandedRequestId(null);
  }, [brandId]);

  const load = useCallback(async () => {
    const generation = ++requestGeneration.current;
    const refreshing = loadedOnce.current;
    if (!refreshing) setLoading(true);
    setRefreshWarning(false);
    try {
      const nextRequests = await listRequests(brandId);
      if (generation !== requestGeneration.current) return;
      setRequests(nextRequests);
      setInitialError(false);
      loadedOnce.current = true;
    } catch {
      if (generation !== requestGeneration.current) return;
      if (refreshing) {
        setRefreshWarning(true);
      } else {
        setInitialError(true);
      }
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [brandId, listRequests]);

  useEffect(() => {
    void load();
    return () => {
      requestGeneration.current += 1;
    };
  }, [load, refreshToken]);

  useEffect(() => {
    const refresh = () => {
      void load();
    };
    window.addEventListener(SUPPORT_REQUESTS_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener(SUPPORT_REQUESTS_CHANGED_EVENT, refresh);
    };
  }, [load]);

  return (
    <section className="support-request-history panel" aria-label="문의 내역">
      <header className="panel-head">
        <div>
          <p className="brand-center-eyebrow">SUPPORT</p>
          <h2>문의 내역</h2>
        </div>
      </header>
      <div className="panel-body">
        {refreshWarning ? (
          <p className="support-history-warning" role="status">
            최신 문의 내역을 불러오지 못했습니다. 현재 목록을 계속 표시합니다.
          </p>
        ) : null}
        {loading ? (
          <ListSkeleton rows={3} columns={3} label="문의 내역을 불러오는 중입니다." />
        ) : initialError ? (
          <div className="support-history-state" role="alert">
            <strong>문의 내역을 불러오지 못했습니다.</strong>
            <span>다른 브랜드 기능은 계속 사용할 수 있습니다.</span>
            <button className="button" type="button" onClick={() => void load()}>
              다시 시도
            </button>
          </div>
        ) : requests.length === 0 ? (
          <p className="support-history-state">접수한 문의가 없습니다.</p>
        ) : (
          <div className="support-history-list">
            {requests.map((request) => {
              const expanded = request.id === expandedRequestId;
              const detailId = `support-request-${request.id}`;
              return (
                <article className="support-history-item" key={request.id}>
                  <button
                    className="support-history-summary"
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={detailId}
                    onClick={() => setExpandedRequestId(expanded ? null : request.id)}
                  >
                    <span>
                      <strong>{categoryLabels[request.category]}</strong>
                      <span>{request.title}</span>
                      <span className="muted small">접수일 {formatDateTime(request.createdAt)}</span>
                    </span>
                    <Badge variant={statusVariant(request.status)}>{statusLabels[request.status]}</Badge>
                  </button>
                  {expanded ? (
                    <div className="support-history-detail" id={detailId}>
                      <div>
                        <strong>문의 내용</strong>
                        <p>{request.message}</p>
                      </div>
                      <div>
                        <strong>운영자 답변</strong>
                        <p>{request.responseMessage ?? "아직 등록된 답변이 없습니다."}</p>
                        {request.respondedAt ? (
                          <p className="muted small">답변일 {formatDateTime(request.respondedAt)}</p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
