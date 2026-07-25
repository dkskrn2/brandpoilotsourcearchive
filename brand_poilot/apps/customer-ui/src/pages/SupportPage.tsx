import { useEffect, useRef, useState } from "react";
import { FeatureSuggestionBanner } from "../components/feedback/FeatureSuggestionBanner";
import { PageHeader } from "../components/layout/PageHeader";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { Field } from "../components/ui/Field";
import { ListSkeleton } from "../components/ui/LoadingState";
import { api, DEMO_BRAND_ID } from "../lib/apiClient";
import type { SupportRequest, SupportRequestCategory } from "../types";

const categories: Array<{ value: SupportRequestCategory | ""; label: string }> = [
  { value: "", label: "문의 유형 선택" },
  { value: "bug", label: "오류" },
  { value: "channel", label: "채널 연결" },
  { value: "account", label: "계정/로그인" },
  { value: "other", label: "기타" }
];

const statusLabels: Record<SupportRequest["status"], string> = {
  new: "접수",
  in_progress: "처리중",
  resolved: "답변 완료"
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
    minute: "2-digit"
  });
}

function formatMobilePhone(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function isValidMobilePhone(value: string) {
  return /^010-\d{4}-\d{4}$/.test(value);
}

export function SupportPage() {
  const [category, setCategory] = useState<SupportRequestCategory | "">("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [createdRequest, setCreatedRequest] = useState<SupportRequest | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [requests, setRequests] = useState<SupportRequest[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(false);
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);
  const historyRequestGeneration = useRef(0);

  useEffect(() => {
    void loadSupportRequests();
  }, []);

  async function loadSupportRequests() {
    const requestGeneration = ++historyRequestGeneration.current;
    setHistoryLoading(true);
    try {
      const nextRequests = await api.listSupportRequests(DEMO_BRAND_ID);
      if (requestGeneration !== historyRequestGeneration.current) return;
      setRequests(nextRequests);
      setHistoryError(false);
    } catch {
      if (requestGeneration !== historyRequestGeneration.current) return;
      setHistoryError(true);
    } finally {
      if (requestGeneration === historyRequestGeneration.current) {
        setHistoryLoading(false);
      }
    }
  }

  async function submitSupportRequest() {
    if (!category || title.trim().length === 0 || contactPhone.trim().length === 0 || message.trim().length === 0) {
      setCreatedRequest(null);
      setNotice("문의 유형, 제목, 휴대전화 번호, 내용을 입력하세요.");
      return;
    }
    if (!isValidMobilePhone(contactPhone)) {
      setCreatedRequest(null);
      setNotice("휴대전화 번호를 010-1234-5678 형식으로 입력하세요.");
      return;
    }
    setSubmitting(true);
    try {
      const created = await api.createSupportRequest(DEMO_BRAND_ID, {
        category,
        title: title.trim(),
        message: message.trim(),
        contactPhone,
        contactEmail: contactEmail.trim() || null
      });
      setCreatedRequest(created);
      setNotice(null);
      setTitle("");
      setMessage("");
      setContactPhone("");
      setContactEmail("");
      setCategory("");
      await loadSupportRequests();
    } catch {
      setCreatedRequest(null);
      setNotice("문의 접수에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="content">
      <PageHeader
        title="고객센터"
        description="오류, 채널 연결, 계정 문제를 접수하고 처리 상태와 답변을 확인합니다."
      />

      {notice ? (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-body">
            <Alert title="문의 상태" variant={notice.includes("실패") ? "bad" : "warn"}>{notice}</Alert>
          </div>
        </section>
      ) : null}

      {createdRequest ? (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-head">
            <h2>접수 결과</h2>
            <Badge variant="ok">접수됨</Badge>
          </div>
          <div className="panel-body">
            <p><strong>{createdRequest.title}</strong></p>
            <p className="muted small">문의가 접수되었습니다. 관리자가 확인 후 상태를 업데이트합니다.</p>
          </div>
        </section>
      ) : null}

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <h2>내 문의 내역</h2>
        </div>
        <div className="panel-body">
          {historyLoading ? (
            <ListSkeleton rows={4} columns={3} label="문의 내역을 불러오는 중입니다." />
          ) : historyError ? (
            <Alert title="문의 내역을 불러오지 못했습니다" variant="warn">잠시 후 다시 시도해 주세요.</Alert>
          ) : requests.length === 0 ? (
            <Alert title="접수한 문의 없음" variant="info">새 문의를 접수하면 이곳에서 처리 상태와 답변을 확인할 수 있습니다.</Alert>
          ) : (
            <div className="support-history-list">
              {requests.map((request) => {
                const expanded = request.id === expandedRequestId;
                return (
                  <article className="support-history-item" key={request.id}>
                    <button
                      className="support-history-summary"
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setExpandedRequestId(expanded ? null : request.id)}
                    >
                      <span>
                        <strong>{request.title}</strong>
                        <span className="muted small">{formatDateTime(request.createdAt)}</span>
                      </span>
                      <Badge variant={statusVariant(request.status)}>{statusLabels[request.status]}</Badge>
                    </button>
                    {expanded ? (
                      <div className="support-history-detail">
                        <div>
                          <strong>문의 내용</strong>
                          <p>{request.message}</p>
                          <p className="muted small">연락처 {request.contactPhone}</p>
                        </div>
                        <div>
                          <strong>고객센터 답변</strong>
                          <p>{request.responseMessage ?? "아직 등록된 답변이 없습니다."}</p>
                          {request.respondedAt ? <p className="muted small">답변일 {formatDateTime(request.respondedAt)}</p> : null}
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

      <section className="panel" id="support-request-form">
        <div className="panel-head">
          <h2>문의 작성</h2>
          <Badge variant="info">필수 4개</Badge>
        </div>
        <div className="panel-body form-grid">
          <Field label="문의 유형" required>
            <select value={category} onChange={(event) => setCategory(event.currentTarget.value as SupportRequestCategory | "")}>
              {categories.map((item) => (
                <option key={item.value || "empty"} value={item.value}>{item.label}</option>
              ))}
            </select>
          </Field>
          <Field label="제목" required>
            <input value={title} onChange={(event) => setTitle(event.currentTarget.value)} placeholder="예: 인스타그램 채널 연결이 실패합니다" />
          </Field>
          <Field label="휴대전화 번호" required>
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              maxLength={13}
              value={contactPhone}
              onChange={(event) => setContactPhone(formatMobilePhone(event.currentTarget.value))}
              placeholder="예: 010-1234-5678"
            />
          </Field>
          <Field label="연락 이메일">
            <input type="email" value={contactEmail} onChange={(event) => setContactEmail(event.currentTarget.value)} placeholder="예: user@example.com" />
          </Field>
          <Field label="내용" full required>
            <textarea
              rows={8}
              value={message}
              onChange={(event) => setMessage(event.currentTarget.value)}
              placeholder="오류가 발생한 화면, 시도한 작업, 기대했던 결과를 함께 적어주세요."
            />
          </Field>
          <div className="actions">
            <button className="button primary" type="button" onClick={submitSupportRequest} disabled={submitting}>
              {submitting ? "접수 중" : "문의 접수"}
            </button>
          </div>
        </div>
      </section>

      <FeatureSuggestionBanner />
    </section>
  );
}
