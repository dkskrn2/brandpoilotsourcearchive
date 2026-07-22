import type { Metadata, Route } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import { updatePublishingStatusAction } from "@/app/admin/brand-pilot/actions";
import { BrandPilotAdminError, BrandPilotAdminShell, formatAdminDate } from "@/components/brand-pilot-admin-shell";
import { BrandPilotPublishPreview } from "@/components/brand-pilot-publish-preview";
import { getBrandPilotPublishing } from "@/lib/brand-pilot-admin";
import { requireAdminSession } from "@/lib/admin-auth";

export const metadata: Metadata = { title: "Brand Pilot 게시 상세", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function bytes(value: number | null) {
  if (value === null) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function BrandPilotPublishingDetailPage({ params, searchParams }: { params: Promise<{ queueId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { queueId } = await params;
  const returnPath = `/admin/brand-pilot/publishing/${queueId}` as Route;
  const session = await requireAdminSession(returnPath);
  const query = await searchParams;
  const notice = typeof query.notice === "string" ? query.notice : "";
  const errorMessage = typeof query.error === "string" ? query.error : "";
  let item;
  let loadError: string | undefined;
  try { item = await getBrandPilotPublishing(session.username, queueId); }
  catch (error) { loadError = error instanceof Error ? error.message : undefined; }

  if (!item) return <BrandPilotAdminShell active="publishing"><Link className="admin-editor__back" href="/admin/brand-pilot/publishing"><ArrowLeft aria-hidden size={18} /> 게시 목록</Link><BrandPilotAdminError message={loadError} /></BrandPilotAdminShell>;

  const action = updatePublishingStatusAction.bind(null, item.id);
  const sourceUrls = [...new Set([item.topic.referenceUrl, ...item.topic.sourceUrls].filter((value): value is string => Boolean(value)))];

  return <BrandPilotAdminShell active="publishing">
    <Link className="admin-editor__back" href="/admin/brand-pilot/publishing"><ArrowLeft aria-hidden size={18} /> 게시 목록</Link>
    <div className="admin-heading brand-pilot-admin__detail-heading"><div><p>{item.brandName} · {item.channel}</p><h1>{item.contentTitle}</h1><span>{item.deliveryFormat ?? "기본 형식"} · 생성 {formatAdminDate(item.createdAt)}</span></div><span className={`brand-pilot-admin__status is-${item.queueStatus}`}>{item.queueStatus}</span></div>
    {notice && <p className="admin-form-message" role="status">{notice}</p>}
    {errorMessage && <p className="admin-form-message is-error" role="alert">{errorMessage}</p>}
    <div className="brand-pilot-admin__publish-layout">
      <div className="brand-pilot-admin__publish-main">
        <section className="admin-content-panel brand-pilot-admin__preview-panel"><div className="admin-panel-head"><div><h2>생성 결과물</h2><p>실제 저장된 이미지, 영상, HTML 또는 텍스트 미리보기입니다.</p></div>{item.externalUrl && <a className="brand-pilot-admin__external" href={item.externalUrl} target="_blank" rel="noreferrer">게시물 열기 <ArrowSquareOut aria-hidden size={16} /></a>}</div><BrandPilotPublishPreview item={item} /></section>
        <section className="admin-content-panel"><div className="admin-panel-head"><div><h2>업로드 정보</h2><p>생성 결과와 게시 큐에 저장된 운영 정보입니다.</p></div></div><dl className="brand-pilot-admin__facts"><div><dt>출력 상태</dt><dd>{item.outputStatus}</dd></div><div><dt>게시 상태</dt><dd>{item.queueStatus}</dd></div><div><dt>승인 방식</dt><dd>{item.approvalType}</dd></div><div><dt>게시 시도</dt><dd>{item.attemptCount}회</dd></div><div><dt>예약 일시</dt><dd>{formatAdminDate(item.scheduledFor)}</dd></div><div><dt>게시 일시</dt><dd>{formatAdminDate(item.publishedAt)}</dd></div><div><dt>아티팩트 형식</dt><dd>{item.artifact?.mimeType ?? item.artifact?.type ?? "—"}</dd></div><div><dt>아티팩트 크기</dt><dd>{bytes(item.artifact?.byteSize ?? null)}</dd></div>{item.lastError && <div className="brand-pilot-admin__facts-wide"><dt>최근 오류</dt><dd className="brand-pilot-admin__danger-text">{item.lastError}</dd></div>}</dl></section>
        <section className="admin-content-panel"><div className="admin-panel-head"><div><h2>생성 근거</h2><p>워커가 콘텐츠 생성 시 참조한 주제와 소스입니다.</p></div></div><dl className="brand-pilot-admin__facts"><div><dt>주제</dt><dd>{item.topic.title ?? "—"}</dd></div><div><dt>관점</dt><dd>{item.topic.angle ?? "—"}</dd></div>{item.sourceSummary && <div className="brand-pilot-admin__facts-wide"><dt>소스 요약</dt><dd>{item.sourceSummary}</dd></div>}</dl>{sourceUrls.length > 0 && <ul className="brand-pilot-admin__source-list">{sourceUrls.map((url) => <li key={url}><a href={url} target="_blank" rel="noreferrer">{url}<ArrowSquareOut aria-hidden size={14} /></a></li>)}</ul>}</section>
        <section className="admin-content-panel"><div className="admin-panel-head"><div><h2>게시 시도 이력</h2><p>외부 채널 호출 결과와 오류 기록입니다.</p></div></div>{item.attempts.length ? <div className="admin-table-wrap"><table><thead><tr><th>시도</th><th>상태</th><th>시작</th><th>완료</th><th>결과</th></tr></thead><tbody>{item.attempts.map((attempt) => <tr key={attempt.id}><td>{attempt.attemptNumber}</td><td><span className={`brand-pilot-admin__status is-${attempt.status}`}>{attempt.status}</span></td><td>{formatAdminDate(attempt.startedAt)}</td><td>{formatAdminDate(attempt.finishedAt)}</td><td className="brand-pilot-admin__wrap">{attempt.errorMessage ?? attempt.errorCode ?? (attempt.externalUrl ? <a href={attempt.externalUrl} target="_blank" rel="noreferrer">게시물 열기</a> : "정상 처리")}</td></tr>)}</tbody></table></div> : <div className="brand-pilot-admin__history-empty">아직 게시 시도 이력이 없습니다.</div>}</section>
        <section className="admin-content-panel"><div className="admin-panel-head"><div><h2>검토 이력</h2><p>승인, 재생성, 거절 등 검토 기록입니다.</p></div></div>{item.reviews.length ? <div className="brand-pilot-admin__timeline">{item.reviews.map((review) => <article key={review.id}><span className={`brand-pilot-admin__status is-${review.eventType}`}>{review.eventType}</span><div><strong>{review.actorType}</strong><p>{review.reason ?? "사유 없음"}</p><small>{formatAdminDate(review.createdAt)}</small></div></article>)}</div> : <div className="brand-pilot-admin__history-empty">검토 이력이 없습니다.</div>}</section>
      </div>
      <aside className="brand-pilot-admin__status-action brand-pilot-admin__publish-action"><h2>게시 작업 관리</h2><p>게시가 시작되기 전에는 취소할 수 있으며, 정책상 재시도 가능한 실패만 다시 대기열에 등록할 수 있습니다.</p>{item.canRetry && <form action={action}><input type="hidden" name="action" value="retry" /><label><span>변경 사유</span><textarea name="reason" required maxLength={500} rows={4} placeholder="재시도 사유를 입력하세요." /></label><button type="submit">게시 재시도</button><small>OAuth 재연결 또는 미구현 공급자 오류처럼 재시도 가능한 실패에만 제공됩니다.</small></form>}{item.canCancel && <form action={action}><input type="hidden" name="action" value="cancel" /><label><span>변경 사유</span><textarea name="reason" required maxLength={500} rows={4} placeholder="취소 사유를 입력하세요." /></label><button type="submit" className="is-danger">게시 취소</button><small>게시 중이거나 게시 완료된 항목은 취소할 수 없습니다.</small></form>}{!item.canRetry && !item.canCancel && <p className="brand-pilot-admin__locked">현재 상태에서는 관리 작업을 실행할 수 없습니다.</p>}</aside>
    </div>
  </BrandPilotAdminShell>;
}
