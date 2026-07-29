import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrandCenterPreviewPage } from "../../pages/BrandCenterPreviewPage";
import { router } from "../../routes";
import { createMockPreviewAdapter } from "./previewAdapter";
import { createPreviewState } from "./previewFixtures";
import { canEnterStep, previewReducer } from "./previewReducer";
import type { PreviewAction } from "./previewReducer";

vi.mock("./previewAdapter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./previewAdapter")>();
  return {
    ...actual,
    createMockPreviewAdapter: vi.fn(actual.createMockPreviewAdapter),
  };
});

vi.mock("./previewFixtures", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./previewFixtures")>();
  return {
    ...actual,
    createPreviewState: vi.fn(actual.createPreviewState),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("brand center preview state", () => {
  it("returns fresh reset-on-mount fixtures", () => {
    const first = createPreviewState();
    first.sources.url = "https://changed.example";

    expect(createPreviewState().sources.url).toBe("");
  });

  it("isolates nested fixture data and leaves reducer inputs immutable", () => {
    const first = createPreviewState();
    first.brandCore.differentiators.push("changed");
    first.knowledge[0].content = "changed";

    const fresh = createPreviewState();
    expect(fresh.brandCore.differentiators).not.toContain("changed");
    expect(fresh.knowledge[0].content).not.toBe("changed");

    const before = structuredClone(fresh);
    const next = previewReducer(fresh, {
      type: "source/urlChanged",
      url: "https://new.example",
    });
    expect(fresh).toEqual(before);
    expect(next).not.toBe(fresh);
  });

  it("invalidates downstream work after source changes", () => {
    const state = createPreviewState({
      currentStep: "generation",
      analysis: { state: "succeeded", error: null },
      brandCoreApproved: true,
      generation: { state: "succeeded", error: null },
    });

    const next = previewReducer(state, {
      type: "source/urlChanged",
      url: "https://new.example",
    });

    expect(next.analysis.state).toBe("idle");
    expect(next.brandCoreApproved).toBe(false);
    expect(next.generation.state).toBe("idle");
    expect(canEnterStep(next, "approval")).toBe(false);
  });

  it("rejects duplicate analysis and generation requests while loading", () => {
    const analyzing = createPreviewState({
      currentStep: "analysis",
      sources: {
        url: "https://brand.example",
        files: [],
        error: null,
      },
      analysis: { state: "loading", error: null },
    });
    expect(previewReducer(analyzing, {
      type: "analysis/requested",
      requestId: "analysis-a",
    }))
      .toBe(analyzing);

    const knowledge = createPreviewState().knowledge.map((item) => ({
      ...item,
      reviewStatus: "approved" as const,
    }));
    const generating = createPreviewState({
      currentStep: "generation",
      sources: {
        url: "https://brand.example",
        files: [],
        error: null,
      },
      analysis: { state: "succeeded", error: null },
      brandCoreApproved: true,
      knowledge,
      generation: { state: "loading", error: null },
    });
    expect(previewReducer(generating, {
      type: "generation/requested",
      requestId: "generation-a",
    }))
      .toBe(generating);
  });

  it("keeps generation failed until a successful retry completes", () => {
    const knowledge = createPreviewState().knowledge.map((item) => ({
      ...item,
      reviewStatus: "approved" as const,
    }));
    let state = createPreviewState({
      currentStep: "generation",
      sources: { url: "https://brand.example", files: [], error: null },
      analysis: { state: "succeeded", error: null },
      brandCoreApproved: true,
      knowledge,
    });

    state = previewReducer(state, {
      type: "generation/requested",
      requestId: "generation-a",
    });
    state = previewReducer(state, {
      type: "generation/failed",
      requestId: "generation-a",
      error: "generation failed",
    });
    expect(state.currentStep).toBe("generation");
    expect(state.generation).toEqual({
      state: "failed",
      error: "generation failed",
    });

    state = previewReducer(state, {
      type: "generation/requested",
      requestId: "generation-b",
    });
    state = previewReducer(state, {
      type: "generation/succeeded",
      requestId: "generation-b",
    });
    expect(state.generation).toEqual({ state: "succeeded", error: null });
  });

  it("cancels generation on backward navigation and ignores stale completion", () => {
    const knowledge = createPreviewState().knowledge.map((item) => ({
      ...item,
      reviewStatus: "approved" as const,
    }));
    let state = createPreviewState({
      currentStep: "generation",
      sources: { url: "https://brand.example", files: [], error: null },
      analysis: { state: "succeeded", error: null },
      brandCoreApproved: true,
      knowledge,
    });
    state = previewReducer(state, {
      type: "generation/requested",
      requestId: "generation-a",
    });

    state = previewReducer(state, {
      type: "step/selected",
      step: "approval",
    });
    expect(state.currentStep).toBe("approval");
    expect(state.generation).toEqual({ state: "idle", error: null });
    expect(state.activeGenerationRequestId).toBeNull();

    const afterStale = previewReducer(state, {
      type: "generation/succeeded",
      requestId: "generation-a",
    });
    expect(afterStale).toBe(state);
  });

  it("lets a new generation own completion after reset", () => {
    const knowledge = createPreviewState().knowledge.map((item) => ({
      ...item,
      reviewStatus: "approved" as const,
    }));
    let state = createPreviewState({
      currentStep: "generation",
      sources: { url: "https://brand.example", files: [], error: null },
      analysis: { state: "succeeded", error: null },
      brandCoreApproved: true,
      knowledge,
    });
    state = previewReducer(state, {
      type: "generation/requested",
      requestId: "generation-a",
    });
    state = previewReducer(state, {
      type: "step/selected",
      step: "approval",
    });
    state = previewReducer(state, {
      type: "step/selected",
      step: "generation",
    });
    state = previewReducer(state, {
      type: "generation/requested",
      requestId: "generation-b",
    });

    const afterStale = previewReducer(state, {
      type: "generation/succeeded",
      requestId: "generation-a",
    });
    expect(afterStale).toBe(state);
    expect(afterStale.generation.state).toBe("loading");

    const completed = previewReducer(afterStale, {
      type: "generation/succeeded",
      requestId: "generation-b",
    });
    expect(completed.generation.state).toBe("succeeded");
  });

  it("ignores stale analysis completion after a source invalidation and new request", () => {
    let state = createPreviewState({
      sources: {
        url: "https://brand-a.example",
        files: [],
        error: null,
      },
    });
    state = previewReducer(state, {
      type: "analysis/requested",
      requestId: "analysis-a",
    });
    state = previewReducer(state, {
      type: "source/urlChanged",
      url: "https://brand-b.example",
    });
    state = previewReducer(state, {
      type: "analysis/requested",
      requestId: "analysis-b",
    });

    const afterStaleSuccess = previewReducer(state, {
      type: "analysis/succeeded",
      requestId: "analysis-a",
    });
    expect(afterStaleSuccess).toBe(state);
    expect(afterStaleSuccess.analysis.state).toBe("loading");

    const completed = previewReducer(afterStaleSuccess, {
      type: "analysis/succeeded",
      requestId: "analysis-b",
    });
    expect(completed.analysis.state).toBe("succeeded");
  });

  it("unlocks generation only after Brand Core and all AI knowledge are approved", () => {
    let state = createPreviewState({
      currentStep: "approval",
      analysis: { state: "succeeded", error: null },
    });

    state = previewReducer(state, { type: "approval/coreApproved" });
    expect(canEnterStep(state, "generation")).toBe(false);

    state = previewReducer(state, { type: "knowledge/allApproved" });
    expect(canEnterStep(state, "generation")).toBe(true);
  });

  it("ignores nonexistent knowledge targets without changing state or announcements", () => {
    const state = createPreviewState({
      currentStep: "approval",
      analysis: { state: "succeeded", error: null },
      announcement: "unchanged",
    });
    const missingItem = {
      ...state.knowledge[0],
      id: "missing",
      title: "changed",
    };
    const actions: PreviewAction[] = [
      { type: "knowledge/editingOpened", id: "missing" },
      { type: "knowledge/updated", item: missingItem },
      { type: "knowledge/deleted", id: "missing" },
      { type: "knowledge/approved", id: "missing" },
    ];

    for (const action of actions) {
      expect(previewReducer(state, action)).toBe(state);
    }
  });

  it("preserves canonical knowledge identity and owns review status on update", () => {
    const state = createPreviewState({
      currentStep: "approval",
      analysis: { state: "succeeded", error: null },
      generation: { state: "succeeded", error: null },
    });
    const existing = state.knowledge[0];

    const next = previewReducer(state, {
      type: "knowledge/updated",
      item: {
        ...existing,
        kind: "policy",
        origin: "user",
        reviewStatus: "approved",
        title: "Updated title",
        content: "Updated content",
      },
    });

    expect(next.knowledge[0]).toEqual({
      ...existing,
      kind: "policy",
      title: "Updated title",
      content: "Updated content",
      reviewStatus: "ai_draft",
    });
    expect(next.generation.state).toBe("idle");
    expect(state.knowledge[0]).toBe(existing);

    const userItem = {
      ...existing,
      id: "knowledge-user",
      origin: "user" as const,
      reviewStatus: "confirmed" as const,
    };
    const userState = createPreviewState({
      currentStep: "approval",
      analysis: { state: "succeeded", error: null },
      knowledge: [userItem],
    });
    const updatedUserState = previewReducer(userState, {
      type: "knowledge/updated",
      item: {
        ...userItem,
        origin: "ai",
        reviewStatus: "ai_draft",
        title: "User title",
        content: "User content",
      },
    });
    expect(updatedUserState.knowledge[0]).toEqual({
      ...userItem,
      title: "User title",
      content: "User content",
      reviewStatus: "confirmed",
    });
  });

  it("rejects duplicate creations and canonicalizes local trust fields", () => {
    const state = createPreviewState({
      currentStep: "approval",
      analysis: { state: "succeeded", error: null },
    });
    const duplicate = previewReducer(state, {
      type: "knowledge/created",
      item: {
        ...state.knowledge[0],
        title: "duplicate",
      },
    });
    expect(duplicate).toBe(state);

    const created = previewReducer(state, {
      type: "knowledge/created",
      item: {
        id: "user-created",
        kind: "faq",
        title: "사용자 질문",
        content: "사용자 답변",
        origin: "ai",
        reviewStatus: "ai_draft",
      },
    });
    expect(created.knowledge.at(-1)).toEqual({
      id: "user-created",
      kind: "faq",
      title: "사용자 질문",
      content: "사용자 답변",
      origin: "user",
      reviewStatus: "confirmed",
    });
  });

  it("throws for an unknown reducer action", () => {
    const state = createPreviewState();

    expect(() => previewReducer(
      state,
      { type: "unknown/action" } as never,
    )).toThrow(/unknown\/action/);
  });

  it("keeps mock adapter timing and outcome queues deterministic", async () => {
    const timer = vi.spyOn(window, "setTimeout");
    const adapter = createMockPreviewAdapter({
      analysisResult: "failed",
      generationResults: ["failed", "succeeded"],
      delayMs: 0,
    });

    await expect(adapter.analyze()).rejects.toThrow("mock_analysis_failed");
    await expect(adapter.generateCardNews()).rejects
      .toThrow("mock_generation_failed");
    await expect(adapter.generateCardNews()).resolves.toBe("succeeded");
    await expect(adapter.generateCardNews()).resolves.toBe("succeeded");
    expect(timer).toHaveBeenCalledWith(expect.any(Function), 0);
  });

  it("resets page state on remount and creates one default adapter per mount", () => {
    const stateFactory = vi.mocked(createPreviewState);
    const adapterFactory = vi.mocked(createMockPreviewAdapter);
    stateFactory.mockClear();
    adapterFactory.mockClear();

    const first = render(createElement(BrandCenterPreviewPage));
    expect(stateFactory).toHaveBeenCalledTimes(1);
    expect(adapterFactory).toHaveBeenCalledTimes(1);

    first.rerender(createElement(BrandCenterPreviewPage));
    expect(stateFactory).toHaveBeenCalledTimes(1);
    expect(adapterFactory).toHaveBeenCalledTimes(1);

    first.unmount();
    render(createElement(BrandCenterPreviewPage));
    expect(stateFactory).toHaveBeenCalledTimes(2);
    expect(adapterFactory).toHaveBeenCalledTimes(2);
  });

  it("preserves an injected adapter without creating a default", () => {
    const adapterFactory = vi.mocked(createMockPreviewAdapter);
    adapterFactory.mockClear();
    const adapter = {
      analyze: vi.fn(async () => "succeeded" as const),
      generateCardNews: vi.fn(async () => "succeeded" as const),
    };

    const view = render(createElement(BrandCenterPreviewPage, { adapter }));
    view.rerender(createElement(BrandCenterPreviewPage, { adapter }));

    expect(adapterFactory).not.toHaveBeenCalled();
  });

  it("registers brand-center-preview as an authenticated child route", () => {
    const root = router.routes.find((route) => route.path === "/");

    expect(root?.children?.some((route) =>
      route.path === "brand-center-preview")).toBe(true);
  });
});
