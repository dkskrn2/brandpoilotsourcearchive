import { useState } from "react";
import type { Avatar } from "../../features/libraries/libraryGateway";
import type { AiContentReference } from "../../features/ai-content/types";

export type ReferenceRole = "planning" | "copy_pattern" | "visual_composition";
export interface SelectedReference {
  referenceItemId: string;
  roles: ReferenceRole[];
}

const roleOptions: Array<[ReferenceRole, string]> = [
  ["planning", "기획"],
  ["copy_pattern", "카피 패턴"],
  ["visual_composition", "비주얼 구성"],
];

export function ReferenceAvatarStep({ references, avatars, selectedReferences, selectedAvatarId, loading, submitting, onReferencesChange, onAvatarChange, onAddReference, onAddAvatar, onGenerate }: {
  references: AiContentReference[];
  avatars: Avatar[];
  selectedReferences: SelectedReference[];
  selectedAvatarId: string | null;
  loading: boolean;
  submitting: boolean;
  onReferencesChange(value: SelectedReference[]): void;
  onAvatarChange(value: string | null): void;
  onAddReference?(): void;
  onAddAvatar?(): void;
  onGenerate(): void;
}) {
  const [tab, setTab] = useState("AI 추천");
  const toggleReference = (id: string) => {
    const existing = selectedReferences.find((item) => item.referenceItemId === id);
    if (existing) onReferencesChange(selectedReferences.filter((item) => item.referenceItemId !== id));
    else if (selectedReferences.length < 5) onReferencesChange([...selectedReferences, { referenceItemId: id, roles: ["planning"] }]);
  };
  const toggleRole = (id: string, role: ReferenceRole) => {
    onReferencesChange(selectedReferences.map((item) => {
      if (item.referenceItemId !== id) return item;
      const roles = item.roles.includes(role) ? item.roles.filter((value) => value !== role) : [...item.roles, role];
      return { ...item, roles };
    }));
  };
  const invalidRoles = selectedReferences.some((item) => item.roles.length === 0);

  return <section className="reference-avatar-step">
    <header><p>선택한 구현안에 맞춰 지금 불러왔습니다.</p><h2>레퍼런스와 아바타</h2></header>
    <div className="reference-avatar-layout">
      <div>
        <div className="wizard-tabs" role="tablist" aria-label="레퍼런스 탐색">
          {["AI 추천", "브랜드별", "전략별", "보관함", "최근 사용", "직접 추가"].map((label) =>
            <button key={label} type="button" role="tab" aria-selected={tab === label} onClick={() => setTab(label)}>{label}</button>,
          )}
        </div>
        {tab === "직접 추가" ? <button type="button" className="button" onClick={onAddReference}>레퍼런스 파일 업로드</button> : null}
        {loading ? <p>실제 레퍼런스를 불러오는 중입니다.</p> : <div className="content-reference-grid">
          {references.map((item) => {
            const selected = selectedReferences.find((value) => value.referenceItemId === item.id);
            return <article key={item.id}>
              {item.previewUrl
                ? <img src={item.previewUrl} alt={`${item.title} 미리보기`} />
                : <div className="reference-unavailable"><strong>미리보기 없음</strong><span>저장된 메타데이터로 선택할 수 있습니다.</span></div>}
              <h3>{item.title}</h3>
              <p>{item.source === "owned" ? "자사 콘텐츠" : item.source === "saved_trend" ? "저장 Instagram" : "직접 업로드"} · {item.format}</p>
              {item.comparableMetric ? <small>{item.comparableMetric.label} {item.comparableMetric.value.toLocaleString("ko-KR")}</small> : null}
              <button type="button" className="button" aria-pressed={Boolean(selected)} disabled={!selected && selectedReferences.length >= 5} onClick={() => toggleReference(item.id)}>
                {selected ? "선택 해제" : "레퍼런스 선택"}: {item.title}
              </button>
              {selected ? <div className="reference-role-group" role="group" aria-label={`${item.title} 활용 역할`}>
                {roleOptions.map(([role, label]) => <button key={role} type="button" aria-pressed={selected.roles.includes(role)} onClick={() => toggleRole(item.id, role)}>{label}</button>)}
              </div> : null}
            </article>;
          })}
          {!references.length ? <p>조건에 맞는 활성 레퍼런스가 없습니다. 선택하지 않고 진행할 수 있습니다.</p> : null}
        </div>}
        <p>선택 {selectedReferences.length} / 5</p>
      </div>
      <aside className="avatar-slot" aria-label="아바타 한 개 선택">
        <h3>아바타</h3>
        <label><input type="radio" name="avatar" checked={selectedAvatarId === null} onChange={() => onAvatarChange(null)} />사용 안 함</label>
        <button type="button" className="button" onClick={onAddAvatar}>아바타 업로드 후 저장</button>
        {avatars.filter((item) => item.status === "active").map((item) => {
          const image = item.images.find((candidate) => candidate.representative) ?? item.images[0];
          return <label className="avatar-choice" key={item.id}>
            <input type="radio" name="avatar" checked={selectedAvatarId === item.id} onChange={() => onAvatarChange(item.id)} />
            {image ? <img src={image.storageUrl} alt="" /> : null}
            <span><strong>{item.name}</strong><small>{item.description}</small></span>
          </label>;
        })}
      </aside>
    </div>
    {invalidRoles ? <p role="alert">선택한 각 레퍼런스에 활용 역할을 하나 이상 지정하세요.</p> : null}
    <button type="button" className="button primary" disabled={invalidRoles || submitting} onClick={onGenerate}>
      {submitting ? "생성을 준비하는 중" : "이 구현안으로 생성"}
    </button>
  </section>;
}
