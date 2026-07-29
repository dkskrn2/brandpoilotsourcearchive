import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockPreviewAdapter } from "../../features/brand-center-preview/previewAdapter";
import { createPreviewState } from "../../features/brand-center-preview/previewFixtures";
import type { PreviewAsyncState } from "../../features/brand-center-preview/types";
import { AnalysisStep } from "./AnalysisStep";
import { CardGenerationStep } from "./CardGenerationStep";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderAnalysis(state: PreviewAsyncState) {
  const fixture = createPreviewState();
  return render(
    <AnalysisStep
      state={state}
      error={state === "failed" ? "failed" : null}
      brandCore={fixture.brandCore}
      brandCoreApproved={fixture.brandCoreApproved}
      knowledge={fixture.knowledge}
      onBrandCoreChange={vi.fn()}
      onKnowledgeChange={vi.fn()}
      onRetry={vi.fn()}
      onComplete={vi.fn()}
    />,
  );
}

function renderGeneration(state: PreviewAsyncState) {
  const fixture = createPreviewState();
  return render(
    <CardGenerationStep
      state={state}
      error={state === "failed" ? "failed" : null}
      sourceUrl="https://brand.example"
      sourceFiles={fixture.sources.files}
      brandCore={fixture.brandCore}
      knowledge={fixture.knowledge}
      onGenerate={vi.fn()}
    />,
  );
}

describe("preview loader phases", () => {
  it("shows all three analysis phases and clears timers on terminal states and unmount", () => {
    vi.useFakeTimers();
    const interval = vi.spyOn(window, "setInterval");
    const clear = vi.spyOn(window, "clearInterval");
    const view = renderAnalysis("loading");

    expect(screen.getByText("자료를 읽는 중")).toBeInTheDocument();
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 700);
    act(() => vi.advanceTimersByTime(700));
    expect(screen.getByText("브랜드 핵심을 정리하는 중")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(700));
    expect(screen.getByText("지식 초안을 만드는 중")).toBeInTheDocument();

    const beforeSuccess = clear.mock.calls.length;
    view.rerender(<AnalysisStep
      {...{
        state: "succeeded" as const,
        error: null,
        brandCore: createPreviewState().brandCore,
        brandCoreApproved: false,
        knowledge: createPreviewState().knowledge,
        onBrandCoreChange: vi.fn(),
        onKnowledgeChange: vi.fn(),
        onRetry: vi.fn(),
        onComplete: vi.fn(),
      }}
    />);
    expect(clear.mock.calls.length).toBeGreaterThan(beforeSuccess);

    view.rerender(<AnalysisStep
      {...{
        state: "loading" as const,
        error: null,
        brandCore: createPreviewState().brandCore,
        brandCoreApproved: false,
        knowledge: createPreviewState().knowledge,
        onBrandCoreChange: vi.fn(),
        onKnowledgeChange: vi.fn(),
        onRetry: vi.fn(),
        onComplete: vi.fn(),
      }}
    />);
    const beforeFailure = clear.mock.calls.length;
    view.rerender(<AnalysisStep
      {...{
        state: "failed" as const,
        error: "failed",
        brandCore: createPreviewState().brandCore,
        brandCoreApproved: false,
        knowledge: createPreviewState().knowledge,
        onBrandCoreChange: vi.fn(),
        onKnowledgeChange: vi.fn(),
        onRetry: vi.fn(),
        onComplete: vi.fn(),
      }}
    />);
    expect(clear.mock.calls.length).toBeGreaterThan(beforeFailure);
    view.rerender(<AnalysisStep
      {...{
        state: "loading" as const,
        error: null,
        brandCore: createPreviewState().brandCore,
        brandCoreApproved: false,
        knowledge: createPreviewState().knowledge,
        onBrandCoreChange: vi.fn(),
        onKnowledgeChange: vi.fn(),
        onRetry: vi.fn(),
        onComplete: vi.fn(),
      }}
    />);
    const beforeUnmount = clear.mock.calls.length;
    view.unmount();
    expect(clear.mock.calls.length).toBeGreaterThan(beforeUnmount);
  });

  it("shows all three completion phases and clears timers on terminal states and unmount", () => {
    vi.useFakeTimers();
    const interval = vi.spyOn(window, "setInterval");
    const clear = vi.spyOn(window, "clearInterval");
    const view = renderGeneration("loading");

    expect(screen.getByText("브랜드 정보를 저장하는 중")).toBeInTheDocument();
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 700);
    act(() => vi.advanceTimersByTime(700));
    expect(screen.getByText("카드뉴스 초안을 만드는 중")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(700));
    expect(screen.getByText("결과를 정리하는 중")).toBeInTheDocument();

    const beforeSuccess = clear.mock.calls.length;
    view.rerender(<CardGenerationStep
      state="succeeded"
      error={null}
      sourceUrl="https://brand.example"
      sourceFiles={[]}
      brandCore={createPreviewState().brandCore}
      knowledge={createPreviewState().knowledge}
      onGenerate={vi.fn()}
    />);
    expect(clear.mock.calls.length).toBeGreaterThan(beforeSuccess);
    const beforeFailure = clear.mock.calls.length;
    view.rerender(<CardGenerationStep
      state="loading"
      error={null}
      sourceUrl="https://brand.example"
      sourceFiles={[]}
      brandCore={createPreviewState().brandCore}
      knowledge={createPreviewState().knowledge}
      onGenerate={vi.fn()}
    />);
    view.rerender(<CardGenerationStep
      state="failed"
      error="failed"
      sourceUrl="https://brand.example"
      sourceFiles={[]}
      brandCore={createPreviewState().brandCore}
      knowledge={createPreviewState().knowledge}
      onGenerate={vi.fn()}
    />);
    expect(clear.mock.calls.length).toBeGreaterThan(beforeFailure);
    view.rerender(<CardGenerationStep
      state="loading"
      error={null}
      sourceUrl="https://brand.example"
      sourceFiles={[]}
      brandCore={createPreviewState().brandCore}
      knowledge={createPreviewState().knowledge}
      onGenerate={vi.fn()}
    />);
    const beforeUnmount = clear.mock.calls.length;
    view.unmount();
    expect(clear.mock.calls.length).toBeGreaterThan(beforeUnmount);
  });

  it("keeps the default preview adapter visible for the full three-phase cycle", async () => {
    vi.useFakeTimers();
    const timer = vi.spyOn(window, "setTimeout");
    const pending = createMockPreviewAdapter().analyze();

    expect(timer).toHaveBeenCalledWith(expect.any(Function), 2100);
    await vi.advanceTimersByTimeAsync(2100);
    await expect(pending).resolves.toBe("succeeded");
  });
});
