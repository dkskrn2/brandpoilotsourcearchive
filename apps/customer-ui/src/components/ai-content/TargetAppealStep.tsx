import { useEffect, useMemo, useRef, useState } from "react";
import { Check, LoaderCircle, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { AiContentDraft, AiContentGateway, SubjectAnalysis, SubjectAppeal, SubjectTarget } from "../../features/ai-content/types";

interface Props {
  analysis: SubjectAnalysis | null;
  draft: AiContentDraft;
  gateway: AiContentGateway;
  brandId: string;
  onTarget(value: SubjectTarget | null): void;
  onAppeal(value: SubjectAppeal | null): void;
  onAppealsChange(targetId: string, appeals: SubjectAppeal[]): void;
  onResetAppeals(targetId: string): void;
  onAnalysis(value: SubjectAnalysis | null): void;
}

function customTarget(value: { name: string; situation: string; problem: string; motivation: string }): SubjectTarget {
  return { id: `custom-target-${Date.now()}`, name: value.name.trim(), traits: [value.situation.trim()].filter(Boolean), painPoints: [value.problem.trim()].filter(Boolean), purchaseMotivations: [value.motivation.trim()].filter(Boolean), uspEvidence: [] };
}

const terminalStatuses = new Set<SubjectAnalysis["status"]>(["ready", "partial", "failed"]);

export function TargetAppealStep({ analysis, draft, gateway, brandId, onTarget, onAppeal, onAppealsChange, onResetAppeals, onAnalysis }: Props) {
  const [targetForm, setTargetForm] = useState({ name: "", situation: "", problem: "", motivation: "" });
  const [appealForm, setAppealForm] = useState({ title: "", description: "" });
  const [editingAppeal, setEditingAppeal] = useState<SubjectAppeal | null>(null);
  const [optimisticAppeals, setOptimisticAppeals] = useState<Record<string, SubjectAppeal[]>>({});
  const [regenerating, setRegenerating] = useState(false);
  const [regenerationError, setRegenerationError] = useState<string | null>(null);
  const regeneratingRef = useRef(false);
  const targets = useMemo(() => (analysis?.targets ?? []).slice(0, 3), [analysis]);
  const selectedTargetId = draft.selectedTarget?.id;
  const sourceAppeals = selectedTargetId ? analysis?.appealsByTarget[selectedTargetId] ?? [] : [];
  const overrideAppeals = selectedTargetId && Object.prototype.hasOwnProperty.call(draft.appealOverridesByTarget, selectedTargetId)
    ? draft.appealOverridesByTarget[selectedTargetId]
    : sourceAppeals;
  const appeals = selectedTargetId ? optimisticAppeals[selectedTargetId] ?? overrideAppeals : [];
  const targetReady = targetForm.name.trim() && targetForm.problem.trim();
  const appealReady = appealForm.title.trim() && appealForm.description.trim();

  useEffect(() => {
    setOptimisticAppeals({});
  }, [analysis]);

  const chooseTarget = (target: SubjectTarget) => { onTarget(target); onAppeal(null); setEditingAppeal(null); };
  const addTarget = () => { if (!targetReady) return; chooseTarget(customTarget(targetForm)); };
  const commitAppeals = (nextAppeals: SubjectAppeal[]) => {
    if (!selectedTargetId) return;
    setOptimisticAppeals((current) => ({ ...current, [selectedTargetId]: nextAppeals }));
    onAppealsChange(selectedTargetId, nextAppeals);
  };
  const addAppeal = () => {
    if (!selectedTargetId || !appealReady) return;
    const added: SubjectAppeal = { id: `custom-appeal-${Date.now()}`, targetId: selectedTargetId, title: appealForm.title.trim(), description: appealForm.description.trim(), evidenceType: "manual_input", connectionReason: "사용자가 직접 입력한 소구점", sources: [] };
    commitAppeals([...appeals, added]);
    onAppeal(added);
    setAppealForm({ title: "", description: "" });
  };
  const updateEditingAppeal = (field: "title" | "description", value: string) => {
    if (!editingAppeal) return;
    const updated = { ...editingAppeal, [field]: value };
    setEditingAppeal(updated);
    commitAppeals(appeals.map((appeal) => appeal.id === updated.id ? updated : appeal));
  };
  const deleteAppeal = (appealId: string) => {
    commitAppeals(appeals.filter((appeal) => appeal.id !== appealId));
    if (draft.selectedAppeal?.id === appealId) onAppeal(null);
    if (editingAppeal?.id === appealId) setEditingAppeal(null);
  };
  const regenerateAppeals = async () => {
    if (!analysis || !selectedTargetId || regeneratingRef.current) return;
    regeneratingRef.current = true;
    setRegenerating(true);
    setRegenerationError(null);
    try {
      let current = await gateway.regenerateSubjectAppeals(brandId, analysis.id, crypto.randomUUID());
      for (let attempt = 0; attempt < 600 && !terminalStatuses.has(current.status); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        current = await gateway.getSubjectAnalysis(brandId, analysis.id);
      }
      if (current.status !== "ready" && current.status !== "partial") throw new Error(current.errorMessage ?? "subject_appeal_regeneration_failed");
      const nextAnalysis: SubjectAnalysis = {
        ...analysis,
        status: current.status,
        appealsByTarget: current.appealsByTarget,
        sourceGaps: current.sourceGaps,
        updatedAt: current.updatedAt,
        completedAt: current.completedAt,
        errorCode: current.errorCode,
        errorMessage: current.errorMessage,
      };
      onResetAppeals(selectedTargetId);
      onAppeal(null);
      setEditingAppeal(null);
      setOptimisticAppeals((existing) => ({ ...existing, [selectedTargetId]: current.appealsByTarget[selectedTargetId] ?? [] }));
      onAnalysis(nextAnalysis);
    } catch {
      setRegenerationError("소구점을 다시 만들지 못했습니다. 다시 시도해 주세요.");
    } finally {
      regeneratingRef.current = false;
      setRegenerating(false);
    }
  };

  return <section className="target-appeal-step"><header className="wizard-section-heading"><div><p className="eyebrow">STEP 3</p><h2>타깃과 소구점을 선택하세요</h2><p className="wizard-lead">추천 타깃은 3개만 보여줍니다. 타깃 1개와 그 타깃에 맞는 소구점 1개를 선택해야 다음 단계로 이동할 수 있습니다.</p></div></header>
    <div className="target-recommendations"><div className="section-heading-inline"><h3>AI 추천 타깃</h3><span>{targets.length} / 3개</span></div>{targets.length === 3 ? <div className="target-card-grid">{targets.map((target) => <label key={target.id} className={draft.selectedTarget?.id === target.id ? "target-card selected" : "target-card"}><input type="radio" name="subject-target" aria-label={target.name} checked={draft.selectedTarget?.id === target.id} onChange={() => chooseTarget(target)} /><span><strong>{target.name}</strong><small>{target.painPoints[0] ?? "고객의 주요 문제"}</small><small>{target.purchaseMotivations[0] ?? "선택 동기"}</small></span>{draft.selectedTarget?.id === target.id ? <Check size={18} /> : null}</label>)}</div> : <div className="alert">분석 결과에서 추천 타깃 3개를 아직 받지 못했습니다. 분석을 다시 실행해 주세요.</div>}</div>
    <div className="wizard-form-grid custom-target-form"><h3>타깃 직접 추가</h3><label>타깃 이름<input aria-label="직접 입력 타깃 이름" value={targetForm.name} placeholder="예: 주말에만 운동하는 초보자" onChange={(event) => setTargetForm((current) => ({ ...current, name: event.target.value }))} /></label><label>상황<input aria-label="직접 입력 타깃 상황" value={targetForm.situation} placeholder="고객이 놓인 상황" onChange={(event) => setTargetForm((current) => ({ ...current, situation: event.target.value }))} /></label><label>문제<input aria-label="직접 입력 타깃 문제" value={targetForm.problem} placeholder="가장 큰 문제" onChange={(event) => setTargetForm((current) => ({ ...current, problem: event.target.value }))} /></label><label>동기<input aria-label="직접 입력 타깃 동기" value={targetForm.motivation} placeholder="구매·신청 동기" onChange={(event) => setTargetForm((current) => ({ ...current, motivation: event.target.value }))} /></label><button type="button" className="button" disabled={!targetReady} onClick={addTarget}><Plus size={16} />이 타깃 선택</button></div>
    <div className="appeal-selection"><div className="section-heading-inline"><h3>{draft.selectedTarget ? `${draft.selectedTarget.name}의 소구점` : "소구점"}</h3><div className="appeal-heading-actions"><span>1개만 선택</span>{draft.selectedTarget ? <button type="button" className="button" aria-label="소구점 다시 만들기" title="소구점 다시 만들기" disabled={regenerating} onClick={() => void regenerateAppeals()}>{regenerating ? <LoaderCircle className="inline-spinner" size={16} /> : <RotateCcw size={16} />}{regenerating ? "만드는 중" : "소구점 다시 만들기"}</button> : null}</div></div>{draft.selectedTarget ? <>{appeals.length ? <div className="appeal-list">{appeals.map((appeal) => {
      const editing = editingAppeal?.id === appeal.id;
      const editLabel = `${editing ? "소구점 편집 완료" : "소구점 편집"}: ${appeal.title}`;
      const inputId = `subject-appeal-${appeal.id}`;
      return <div key={appeal.id} className={draft.selectedAppeal?.id === appeal.id ? "appeal-row selected" : "appeal-row"}><div className="appeal-choice"><input id={inputId} type="radio" name="subject-appeal" aria-label={appeal.title} checked={draft.selectedAppeal?.id === appeal.id} onChange={() => onAppeal(appeal)} />{editing ? <span className="appeal-edit-fields"><input aria-label="소구점 제목 편집" value={editingAppeal.title} onChange={(event) => updateEditingAppeal("title", event.target.value)} /><textarea aria-label="소구점 설명 편집" value={editingAppeal.description} onChange={(event) => updateEditingAppeal("description", event.target.value)} /></span> : <label htmlFor={inputId}><span><strong>{appeal.title}</strong><small>{appeal.description}</small></span></label>}</div><div className="appeal-row-actions"><button type="button" className="icon-button" aria-label={editLabel} title={editLabel} onClick={() => setEditingAppeal(editing ? null : { ...appeal })}>{editing ? <Check size={16} /> : <Pencil size={16} />}</button><button type="button" className="icon-button danger" aria-label={`소구점 삭제: ${appeal.title}`} title={`소구점 삭제: ${appeal.title}`} onClick={() => deleteAppeal(appeal.id)}><Trash2 size={16} /></button></div></div>;
    })}</div> : <p className="wizard-muted">이 타깃에 연결된 추천 소구점이 없습니다. 직접 입력해 주세요.</p>}<div className="wizard-form-grid"><label>소구점 제목<input aria-label="직접 입력 소구점 제목" value={appealForm.title} placeholder="예: 승인만으로 매일 운영" onChange={(event) => setAppealForm((current) => ({ ...current, title: event.target.value }))} /></label><label>소구점 설명<textarea aria-label="직접 입력 소구점 설명" value={appealForm.description} placeholder="고객 문제와 연결되는 이유" onChange={(event) => setAppealForm((current) => ({ ...current, description: event.target.value }))} /></label></div><button type="button" className="button" disabled={!appealReady} onClick={addAppeal}><Plus size={16} />이 소구점 선택</button>{regenerationError ? <p className="wizard-error" role="alert">{regenerationError}</p> : null}</> : <div className="wizard-empty-state">먼저 타깃 1개를 선택하세요.</div>}</div>
    <div className="selection-summary" aria-live="polite"><strong>현재 선택</strong><span>{draft.selectedTarget?.name ?? "타깃 없음"}</span><span>{draft.selectedAppeal?.title ?? "소구점 없음"}</span></div>
  </section>;
}
