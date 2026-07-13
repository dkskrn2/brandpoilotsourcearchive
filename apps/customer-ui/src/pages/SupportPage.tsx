import { useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { Field } from "../components/ui/Field";
import { api, DEMO_BRAND_ID } from "../lib/apiClient";
import type { SupportRequest, SupportRequestCategory } from "../types";

const categories: Array<{ value: SupportRequestCategory | ""; label: string }> = [
  { value: "", label: "문의 유형 선택" },
  { value: "bug", label: "오류" },
  { value: "feature", label: "기능 건의" },
  { value: "channel", label: "채널 연결" },
  { value: "account", label: "계정/로그인" },
  { value: "other", label: "기타" }
];

export function SupportPage() {
  const [category, setCategory] = useState<SupportRequestCategory | "">("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [createdRequest, setCreatedRequest] = useState<SupportRequest | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submitSupportRequest() {
    if (!category || title.trim().length === 0 || message.trim().length === 0) {
      setCreatedRequest(null);
      setNotice("문의 유형, 제목, 내용을 입력하세요.");
      return;
    }
    setSubmitting(true);
    try {
      const created = await api.createSupportRequest(DEMO_BRAND_ID, {
        category,
        title: title.trim(),
        message: message.trim(),
        contactEmail: contactEmail.trim() || null
      });
      setCreatedRequest(created);
      setNotice(null);
      setTitle("");
      setMessage("");
      setContactEmail("");
      setCategory("");
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
        description="오류, 기능 건의, 채널 연결, 계정 문제를 접수합니다. 접수된 문의는 관리자 채널에서 상태를 확인합니다."
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

      <section className="panel">
        <div className="panel-head">
          <h2>문의 작성</h2>
          <Badge variant="info">필수 3개</Badge>
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
    </section>
  );
}
