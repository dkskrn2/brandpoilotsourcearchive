import { useEffect, useState } from "react";
import { BookmarkPlus } from "lucide-react";
import type { AiContentGateway, AppealPreset, AppealSnapshot, AudiencePreset, AudienceSnapshot } from "../../features/ai-content/types";

interface Props {
  gateway: AiContentGateway;
  brandId: string;
  audience: AudienceSnapshot | null;
  coreAppeal: AppealSnapshot | null;
  secondaryAppeals: AppealSnapshot[];
  onAudienceChange(value: AudienceSnapshot): void;
  onAppealChange(value: AppealSnapshot): void;
  onSecondaryAppealsChange(value: AppealSnapshot[]): void;
}

export function SavedAudienceAppealLibrary({ gateway, brandId, audience, coreAppeal, secondaryAppeals, onAudienceChange, onAppealChange, onSecondaryAppealsChange }: Props) {
  const [audienceTab, setAudienceTab] = useState<"recommended" | "saved">("recommended");
  const [audiences, setAudiences] = useState<AudiencePreset[]>([]);
  const [appeals, setAppeals] = useState<AppealPreset[]>([]);
  const [audienceForm, setAudienceForm] = useState({ name: audience?.name ?? "", situation: audience?.situation ?? "", problem: audience?.problem ?? "", motivation: audience?.motivation ?? "" });
  const [appealForm, setAppealForm] = useState({ title: coreAppeal?.title ?? "", description: coreAppeal?.description ?? "", evidenceType: "benefit" as AppealPreset["evidenceType"] });

  useEffect(() => { void gateway.listAudiencePresets(brandId).then(setAudiences); void gateway.listAppealPresets(brandId).then(setAppeals); }, [brandId, gateway]);
  const audienceReady = Object.values(audienceForm).every((value) => value.trim());
  const appealReady = appealForm.title.trim() && appealForm.description.trim();
  const selectAudience = (item: AudienceSnapshot) => { onAudienceChange({ ...item }); setAudienceForm({ name: item.name, situation: item.situation, problem: item.problem, motivation: item.motivation }); };
  const selectAppeal = (item: AppealSnapshot) => { onAppealChange({ ...item }); setAppealForm({ title: item.title, description: item.description, evidenceType: item.evidenceType }); };
  const toggleSecondaryAppeal = (item: AppealSnapshot) => {
    if (item.id === coreAppeal?.id) return;
    const exists = secondaryAppeals.some((appeal) => appeal.id === item.id);
    onSecondaryAppealsChange(exists ? secondaryAppeals.filter((appeal) => appeal.id !== item.id) : [...secondaryAppeals, { ...item }].slice(0, 2));
  };
  const draftAppeal: AppealSnapshot = { id: "appeal-draft", ...appealForm };

  return <div className="wizard-library">
    <section aria-labelledby="audience-title">
      <h3 id="audience-title">타깃</h3>
      <div className="wizard-tabs" role="tablist" aria-label="타깃 라이브러리">
        <button type="button" role="tab" aria-selected={audienceTab === "recommended"} onClick={() => setAudienceTab("recommended")}>AI 추천</button>
        <button type="button" role="tab" aria-selected={audienceTab === "saved"} onClick={() => setAudienceTab("saved")}>저장한 타깃</button>
      </div>
      {audienceTab === "saved" ? <div className="wizard-preset-list">{audiences.length ? audiences.map((item) => <button type="button" key={item.id} aria-pressed={audience?.id === item.id} onClick={() => selectAudience(item)}><strong>{item.name}</strong><span>{item.problem}</span></button>) : <p className="wizard-muted">저장한 타깃이 없습니다.</p>}</div> : null}
      <div className="wizard-form-grid">
        <label>타깃 이름<input aria-label="타깃 이름" placeholder="예: 콘텐츠 운영이 어려운 1인 사업자" value={audienceForm.name} onChange={(e) => setAudienceForm((current) => ({ ...current, name: e.target.value }))} /><small>저장한 타깃을 다시 찾을 때 사용하는 이름입니다.</small></label>
        <label>상황<input aria-label="상황" placeholder="예: 매주 게시해야 하지만 시간이 부족함" value={audienceForm.situation} onChange={(e) => setAudienceForm((current) => ({ ...current, situation: e.target.value }))} /><small>고객이 콘텐츠를 접하는 실제 맥락을 적습니다.</small></label>
        <label>문제<input aria-label="문제" placeholder="예: 아이디어와 제작 시간이 모두 부족함" value={audienceForm.problem} onChange={(e) => setAudienceForm((current) => ({ ...current, problem: e.target.value }))} /><small>첫 문장과 문제 제기의 기준으로 사용합니다.</small></label>
        <label>동기<input aria-label="동기" placeholder="예: 꾸준히 알리고 문의를 늘리고 싶음" value={audienceForm.motivation} onChange={(e) => setAudienceForm((current) => ({ ...current, motivation: e.target.value }))} /><small>혜택과 CTA가 고객의 실제 목표를 향하도록 사용합니다.</small></label>
      </div>
      <div className="wizard-inline-actions">
        <button type="button" className="button" disabled={!audienceReady} onClick={() => selectAudience({ id: audience?.id ?? "audience-draft", ...audienceForm })}>타깃 선택</button>
        <button type="button" className="button" disabled={!audienceReady} onClick={async () => { const saved = await gateway.saveAudiencePreset(brandId, audienceForm); setAudiences(await gateway.listAudiencePresets(brandId)); selectAudience(saved); }}><BookmarkPlus size={16} />선택한 타깃 저장</button>
      </div>
    </section>
    <section aria-labelledby="appeal-title">
      <h3 id="appeal-title">소구점</h3>
      {appeals.length ? <div className="wizard-preset-list">{appeals.map((item) => <article key={item.id}><strong>{item.title}</strong><span>{item.description}</span><div className="wizard-inline-actions"><button type="button" className="button" aria-pressed={coreAppeal?.id === item.id} onClick={() => selectAppeal(item)}>핵심으로 선택</button><button type="button" className="button" aria-pressed={secondaryAppeals.some((appeal) => appeal.id === item.id)} disabled={coreAppeal?.id === item.id || (!secondaryAppeals.some((appeal) => appeal.id === item.id) && secondaryAppeals.length >= 2)} onClick={() => toggleSecondaryAppeal(item)}>보조로 선택</button></div></article>)}</div> : null}
      <div className="wizard-form-grid">
        <label>소구점 제목<input aria-label="소구점 제목" placeholder="예: 승인만으로 운영 시간 절약" value={appealForm.title} onChange={(e) => setAppealForm((current) => ({ ...current, title: e.target.value }))} /><small>헤드라인과 핵심 메시지의 중심이 되는 짧은 표현입니다.</small></label>
        <label>소구점 설명<textarea aria-label="소구점 설명" placeholder="고객이 얻는 변화와 그 이유를 구체적으로 입력" value={appealForm.description} onChange={(e) => setAppealForm((current) => ({ ...current, description: e.target.value }))} /><small>자사 Wiki나 제품 페이지에서 확인할 수 있는 근거와 연결해 사용합니다.</small></label>
        <label>근거 유형<select aria-label="근거 유형" value={appealForm.evidenceType} onChange={(e) => setAppealForm((current) => ({ ...current, evidenceType: e.target.value as AppealPreset["evidenceType"] }))}><option value="benefit">효익</option><option value="fact">사실</option><option value="price">가격</option><option value="trust">신뢰</option><option value="emotion">감성</option></select><small>워커가 소구점을 사실, 효익, 가격, 신뢰 또는 감성 메시지로 해석하는 기준입니다.</small></label>
      </div>
      <div className="wizard-inline-actions">
        <button type="button" className="button" disabled={!appealReady} onClick={() => selectAppeal({ id: coreAppeal?.id ?? "appeal-draft", ...appealForm })}>핵심 소구점으로 선택</button>
        <button type="button" className="button" disabled={!appealReady || coreAppeal?.id === draftAppeal.id || secondaryAppeals.length >= 2} onClick={() => toggleSecondaryAppeal(draftAppeal)}>보조 소구점으로 추가</button>
        <button type="button" className="button" disabled={!appealReady} onClick={async () => { const saved = await gateway.saveAppealPreset(brandId, appealForm); setAppeals(await gateway.listAppealPresets(brandId)); selectAppeal(saved); }}><BookmarkPlus size={16} />선택한 소구점 저장</button>
      </div>
      <p className="wizard-muted">보조 소구점 {secondaryAppeals.length} / 2{secondaryAppeals.length ? ` · ${secondaryAppeals.map((item) => item.title).join(", ")}` : ""}</p>
    </section>
  </div>;
}
