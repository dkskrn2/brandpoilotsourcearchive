import { useReducer, useRef, useState } from "react";
import { AnalysisStep } from "../components/brand-center-preview/AnalysisStep";
import { CardGenerationStep } from "../components/brand-center-preview/CardGenerationStep";
import { PreviewShell } from "../components/brand-center-preview/PreviewShell";
import { SourceIntakeStep } from "../components/brand-center-preview/SourceIntakeStep";
import {
  createMockPreviewAdapter,
  type PreviewAdapter,
} from "../features/brand-center-preview/previewAdapter";
import { createPreviewState } from "../features/brand-center-preview/previewFixtures";
import {
  canEnterStep,
  previewReducer,
} from "../features/brand-center-preview/previewReducer";
import type { PreviewFile } from "../features/brand-center-preview/types";
import type { BrandIntelligenceGateway } from "../features/brand-intelligence/types";
import {
  LiveBrandCenterOnboarding,
  type BrandIntelligenceStorageScope,
} from "./LiveBrandCenterOnboarding";
import "../styles/brand-center-preview.css";

export function BrandCenterPreviewPage({
  adapter,
  mode = "mock",
  gateway,
  brandId,
  storageScope,
}: {
  adapter?: PreviewAdapter;
  mode?: "mock" | "live";
  gateway?: BrandIntelligenceGateway;
  brandId?: string;
  storageScope?: BrandIntelligenceStorageScope;
}) {
  if (mode === "live") {
    return (
      <LiveBrandCenterOnboarding
        gateway={gateway}
        brandId={brandId}
        storageScope={storageScope}
      />
    );
  }
  return <MockBrandCenterPreviewPage adapter={adapter} />;
}

function MockBrandCenterPreviewPage({
  adapter,
}: {
  adapter?: PreviewAdapter;
}) {
  const defaultAdapter = useRef<PreviewAdapter | null>(null);
  if (!adapter && !defaultAdapter.current) {
    defaultAdapter.current = createMockPreviewAdapter();
  }
  const activeAdapter = adapter ?? defaultAdapter.current!;
  const [state, dispatch] = useReducer(
    previewReducer,
    undefined,
    () => createPreviewState(),
  );
  const [companyName, setCompanyName] = useState("");
  const requestSequence = useRef(0);
  const generationSequence = useRef(0);

  function validateSources(): boolean {
    if (!companyName.normalize("NFKC").trim()) {
      dispatch({
        type: "source/errorChanged",
        error: "회사명을 입력해 주세요.",
      });
      return false;
    }
    const url = state.sources.url.trim();
    if (!url && state.sources.files.length === 0) {
      dispatch({
        type: "source/errorChanged",
        error: "웹사이트 URL 또는 문서 파일을 등록해 주세요.",
      });
      return false;
    }
    if (url) {
      try {
        if (new URL(url).protocol !== "https:") throw new Error("not_https");
      } catch {
        dispatch({
          type: "source/errorChanged",
          error: "https://로 시작하는 올바른 URL을 입력해 주세요.",
        });
        return false;
      }
    }
    dispatch({ type: "source/errorChanged", error: null });
    return true;
  }

  async function analyze() {
    if (!validateSources() || state.analysis.state === "loading") return;

    requestSequence.current += 1;
    const requestId = `preview-analysis-${requestSequence.current}`;
    dispatch({ type: "analysis/requested", requestId });
    try {
      await activeAdapter.analyze();
      dispatch({ type: "analysis/succeeded", requestId });
    } catch {
      dispatch({
        type: "analysis/failed",
        requestId,
        error: "잠시 후 다시 시도해 주세요.",
      });
    }
  }

  async function generateCardNews() {
    if (state.generation.state === "loading"
      || state.analysis.state !== "succeeded") return;
    generationSequence.current += 1;
    const requestId = `preview-generation-${generationSequence.current}`;
    dispatch({ type: "generation/requested", requestId });
    try {
      await activeAdapter.generateCardNews();
      dispatch({ type: "generation/succeeded", requestId });
    } catch {
      dispatch({
        type: "generation/failed",
        requestId,
        error: "카드뉴스를 완성하지 못했습니다. 승인된 정보는 유지됩니다.",
      });
    }
  }

  function addFiles(files: PreviewFile[]) {
    dispatch({ type: "source/filesAdded", files });
  }

  return (
    <PreviewShell
      currentStep={state.currentStep}
      sourceUrl={state.sources.url}
      sourceFiles={state.sources.files}
      canEnterStep={(step) => canEnterStep(state, step)}
      onStepSelected={(step) => dispatch({ type: "step/selected", step })}
    >
      <p className="visually-hidden" aria-live="polite">
        {state.announcement}
      </p>
      {state.currentStep === "sources" ? (
        <SourceIntakeStep
          companyName={companyName}
          url={state.sources.url}
          files={state.sources.files}
          error={state.sources.error}
          onCompanyNameChanged={setCompanyName}
          onUrlChanged={(url) => dispatch({ type: "source/urlChanged", url })}
          onFilesAdded={addFiles}
          onFileRemoved={(id) => dispatch({ type: "source/fileRemoved", id })}
          onAnalyze={() => void analyze()}
        />
      ) : null}
      {state.currentStep === "analysis" ? (
        <AnalysisStep
          state={state.analysis.state}
          error={state.analysis.error}
          brandCore={state.brandCore}
          brandCoreApproved={state.brandCoreApproved}
          knowledge={state.knowledge}
          onBrandCoreChange={(brandCore) => dispatch({ type: "core/changed", brandCore })}
          onKnowledgeChange={(item) => dispatch({ type: "knowledge/updated", item })}
          onRetry={() => void analyze()}
          onComplete={() => void generateCardNews()}
        />
      ) : null}
      {state.currentStep === "generation" ? (
        <CardGenerationStep
          state={state.generation.state}
          error={state.generation.error}
          sourceUrl={state.sources.url}
          sourceFiles={state.sources.files}
          brandCore={state.brandCore}
          knowledge={state.knowledge}
          onGenerate={() => void generateCardNews()}
        />
      ) : null}
    </PreviewShell>
  );
}
