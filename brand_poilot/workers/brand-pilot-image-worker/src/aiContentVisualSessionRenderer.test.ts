import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { createAiContentVisualSessionRenderer } from "./aiContentVisualSessionRenderer.js";

function batch() {
  const visualSession = {
    contractVersion: "ai-content-visual-session.v1" as const, outputFormat: "card_news" as const,
    source: { contractVersion: "card-manuscript-plan.v1" as const, sha256: "a".repeat(64) }, narrative: "Narrative",
    primaryMediumPolicy: { mode: "free_once" as const, styleReferenceIds: [] as string[] },
    scenes: [1, 2].map((index) => ({ index, editorialContext: { editorialRole: "detail", purpose: `Purpose ${index}`, coreMessage: `Core ${index}` }, lockedDisplay: { headline: `Headline ${index}`, relation: { type: "related_facts", entries: [{ role: "fact", label: "A", value: "80%" }, { role: "fact", label: "B", value: "83.3%" }] }, supportingTexts: [], footnote: null }, referenceBindings: { productImageAssetIds: [], avatarImageAssetIds: [] } })),
  };
  const imagePackage = { outputFormat: "card_news", product: null, brandStyleImages: [], references: [], attachments: [], userImageInstruction: null };
  return { kind: "visual_session" as const, outputId: "output", outputFormat: "card_news" as const, visualSession, jobs: [1, 2].map((assetIndex) => ({ id: `job-${assetIndex}`, generationId: "generation", outputId: "output", workspaceId: "workspace", brandId: "brand", jobKind: "image_asset" as const, assetIndex, leaseToken: `lease-${assetIndex}`, attemptCount: 1, payload: { contractVersion: "ai-content-visual-session-render-job.v1" as const, jobKind: "image_asset" as const, generationId: "generation", outputId: "output", imagePackage, assetIndex, assetKey: `generation:${assetIndex}`, storagePath: `path-${assetIndex}`, rendererPromptVersion: "image-visual-session.v1" as const, visualSessionBinding: { sourceContractVersion: "card-manuscript-plan.v1" as const, sourceSha256: "a".repeat(64), sceneIndex: assetIndex }, contentGenerationInput: {}, contentPlan: {}, visualSession } })) };
}

describe("visual session renderer", () => {
  const workerRoot = fileURLToPath(new URL("..", import.meta.url));
  it("uses one child execution for all ordered scenes and returns no partial result", async () => {
    const runChild = vi.fn(async ({ outputFiles, workspaceDir }: { outputFiles: string[]; workspaceDir: string }) => {
      const hooks = JSON.parse(await readFile(`${workspaceDir}/.codex/hooks.json`, "utf8"));
      expect(hooks.hooks.PreToolUse[0].matcher).toBe(".*");
      expect(hooks.hooks.PostToolUse[0].hooks[0].command).toContain("audit-codex-visual-session-image.mjs");
      for (const output of outputFiles) { await mkdir(output.slice(0, output.lastIndexOf("\\") + 1), { recursive: true }); await writeFile(output, await sharp({ create: { width: 1080, height: 1080, channels: 4, background: "white" } }).png().toBuffer()); }
    });
    const renderer = createAiContentVisualSessionRenderer({ workerRoot, readOwned: vi.fn(), runChild: runChild as never });
    const result = await renderer.renderSession(batch() as never, new AbortController().signal);
    expect(runChild).toHaveBeenCalledTimes(1);
    expect(result.map(({ index }) => index)).toEqual([1, 2]);
    expect(result.timing).toEqual({ stageReferencesMs: expect.any(Number), codexStartupMs: 0, sceneGenerationMs: [0, 0] });
    expect(result.every(({ renderDiagnostic }) => renderDiagnostic.compiledPromptVersion === "image-visual-session.v1")).toBe(true);
    expect(runChild.mock.calls[0]?.[0].prompt).toContain("Call image_generation exactly once per scene");
  });

  it("turns a middle-scene child failure into one terminal session failure", async () => {
    const renderer = createAiContentVisualSessionRenderer({ workerRoot, readOwned: vi.fn(), runChild: vi.fn(async () => { throw new Error("scene_2_failed"); }) });
    await expect(renderer.renderSession(batch() as never, new AbortController().signal)).rejects.toMatchObject({ code: "ai_content_visual_session_failed", retryable: false });
  });
});
