import type { ReferencePattern } from "../../types";
import { InlineSpinner } from "../ui/LoadingState";

export function ReferencePatternPanel({
  pattern,
  loading,
  unavailable,
}: {
  pattern: ReferencePattern | null;
  loading: boolean;
  unavailable: boolean;
}) {
  if (loading) return <InlineSpinner label="저장된 패턴 분석을 불러오는 중입니다." />;
  const empty = "저장된 분석이 없습니다.";
  return (
    <div className="reference-pattern-panel">
      {unavailable ? <p className="muted">패턴 분석 생성 기능은 아직 제공되지 않습니다. 저장된 분석이 있을 때만 표시합니다.</p> : null}
      <section><h3>관찰 사실</h3>{pattern?.observations.length ? <ul>{pattern.observations.map((value) => <li key={value}>{value}</li>)}</ul> : <p>{empty}</p>}</section>
      <section><h3>AI 해석</h3><p>{pattern?.interpretation || empty}</p></section>
      <section><h3>우리 브랜드 적용</h3>{pattern?.applicationIdeas.length ? <ul>{pattern.applicationIdeas.map((value) => <li key={value}>{value}</li>)}</ul> : <p>{empty}</p>}</section>
      <section><h3>모방하지 않을 요소</h3>{pattern?.doNotCopy.length ? <ul>{pattern.doNotCopy.map((value) => <li key={value}>{value}</li>)}</ul> : <p>{empty}</p>}</section>
    </div>
  );
}
