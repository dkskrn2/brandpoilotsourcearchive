import { useEffect, useState } from "react";
import { Copy, Palette, Sparkles } from "lucide-react";
import type { AiContentBrandContext, AiContentDraft, AiContentGateway, GenerationAttachmentUpdate, GenerationBrief, GenerationBriefUpdate } from "../../features/ai-content/types";
import { AiContentAttachmentUploader } from "./AiContentAttachmentUploader";

interface Props { brandId: string; gateway: AiContentGateway; draft: AiContentDraft; onBrief(update: GenerationBriefUpdate): void; generationId: string | null; attachmentControlsDisabled?: boolean; }

export function GenerationPromptStep({ brandId, gateway, draft, onBrief, generationId, attachmentControlsDisabled = false }: Props) {
  const brief = draft.brief!;
  const [brandColor, setBrandColor] = useState("#0057B8");
  useEffect(() => {
    let active = true;
    void gateway.getBrandContext(brandId).then((context: AiContentBrandContext) => {
      if (!active) return;
      const contextBrandColor = context.brandColor;
      const nextBrandColor = contextBrandColor ?? "#0057B8";
      setBrandColor(nextBrandColor);
      if (contextBrandColor) {
        onBrief((current) => current.selectedColor === "#0057B8"
          ? { ...current, selectedColor: contextBrandColor }
          : current);
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [brandId, gateway]);
  const update = (value: Partial<GenerationBrief>) => onBrief((current) => ({ ...current, ...value }));
  const updateDirection = (index: number, value: string) => onBrief((current) => {
    const outputDirections = [...current.outputDirections];
    outputDirections[index] = value;
    return { ...current, outputDirections };
  });
  const applyToAll = () => onBrief((current) => ({
    ...current,
    outputDirections: Array.from({ length: current.outputCount }, () => current.outputDirections[0] ?? ""),
  }));
  const activeAttachmentCount = (draft.subjectAttachments ?? []).length + brief.attachments.length;
  const updateAttachments = (attachmentUpdate: GenerationAttachmentUpdate) => onBrief((current) => ({
    ...current,
    attachments: typeof attachmentUpdate === "function"
      ? attachmentUpdate(current.attachments)
      : attachmentUpdate,
  }));
  return <section className="generation-prompt-step"><header className="wizard-section-heading"><div><p className="eyebrow">STEP 5</p><h2>프롬프트와 생성 설정을 확인하세요</h2><p className="wizard-lead">브랜드 대표 색상을 기본값으로 사용하며, 결과별 지시와 참고 이미지를 생성 워커에 함께 전달합니다.</p></div></header>
    <div className="wizard-prompt-layout"><div className="prompt-main"><label>콘텐츠 목적<select aria-label="콘텐츠 목적" value={brief.purpose} onChange={(event) => update({ purpose: event.target.value as GenerationBrief["purpose"] })}><option value="">선택하세요</option><option value="sales">판매</option><option value="awareness">인지</option><option value="information">정보</option><option value="event">이벤트</option></select></label><label>전체 프롬프트<textarea aria-label="전체 프롬프트" value={brief.additionalInstruction} placeholder="원하는 말투, 반드시 담을 내용, 피할 표현을 적어 주세요." onChange={(event) => update({ additionalInstruction: event.target.value })} /><small>제품·서비스 분석 결과와 선택한 타깃·소구점을 우선하고, 이 입력은 추가 지시로만 사용합니다.</small></label><label>강조할 핵심 메시지<input aria-label="강조할 핵심 메시지" value={brief.emphasis} placeholder="예: 매일 승인만으로 콘텐츠 운영" onChange={(event) => update({ emphasis: event.target.value })} /></label><label>CTA<input aria-label="CTA" value={brief.cta} placeholder="예: 서비스 구성 확인하기" onChange={(event) => update({ cta: event.target.value })} /></label></div><aside className="prompt-settings"><label><span>브랜드 대표 색상</span><span className="color-input"><input aria-label="브랜드 대표 색상" type="color" value={brief.selectedColor || brandColor} onChange={(event) => update({ selectedColor: event.target.value })} /><code>{brief.selectedColor || brandColor}</code></span><small>기본값은 브랜드 설정의 대표 색상이며 필요하면 이 콘텐츠에서만 바꿀 수 있습니다.</small></label><label>화면 비율<select aria-label="화면 비율" value={brief.aspectRatio} onChange={(event) => update({ aspectRatio: event.target.value as GenerationBrief["aspectRatio"] })}><option>1:1</option><option>4:5</option><option>16:9</option><option>9:16</option></select></label><label>생성 결과 수<select aria-label="생성 결과 수" value={brief.outputCount} onChange={(event) => { const outputCount = Number(event.target.value) as 1 | 2 | 3; onBrief((current) => ({ ...current, outputCount, outputDirections: Array.from({ length: outputCount }, (_, index) => current.outputDirections[index] ?? "") })); }}><option value="1">1개</option><option value="2">2개</option><option value="3">3개</option></select></label></aside></div>
    <div className="output-direction-section"><div className="section-heading-inline"><h3>결과별 생성 지시</h3><button type="button" className="button" onClick={applyToAll}><Copy size={15} />첫 지시 전체 적용</button></div>{brief.outputDirections.slice(0, brief.outputCount).map((value, index) => <label key={index}>결과 {index + 1}<input aria-label={`결과 ${index + 1} 지시`} value={value} placeholder="예: 문제 상황을 먼저 보여 주세요" onChange={(event) => updateDirection(index, event.target.value)} /></label>)}</div>
    <div className="generation-attachments"><div className="section-heading-inline"><h3>추가 참고 이미지</h3><span>제품·인물·크기 역할을 선택할 수 있습니다.</span></div><AiContentAttachmentUploader gateway={gateway} brandId={brandId} generationId={generationId} attachments={brief.attachments} totalAttachmentCount={activeAttachmentCount} allowedRoles={["product", "person", "scale", "visual_reference"]} onChange={updateAttachments} disabled={attachmentControlsDisabled} /></div>
    <div className="generation-ready-note"><Sparkles size={18} /><span>분석 결과, 레퍼런스, 색상, 이미지 역할과 위 지시를 합쳐 콘텐츠를 생성합니다.</span><Palette size={18} color={brief.selectedColor || brandColor} /></div>
  </section>;
}
