import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AiContentGeneration, AiGenerationOutput } from "../../features/ai-content/types";
import { AiGenerationOutputList } from "./AiGenerationOutputList";

function generationWith(output: AiGenerationOutput): AiContentGeneration {
  return {
    id: "generation-1",
    brandId: "brand-1",
    title: "결과",
    type: "marketing",
    status: "completed",
    currentStep: 5,
    draft: {
      type: "marketing",
      subjectType: null,
      subjectInput: { sourceUrl: "", name: "", promotion: "", description: "" },
      subjectAnalysisId: null,
      subjectAnalysisVersion: null,
      selectedSubjectImageIds: [],
      selectedTarget: null,
      selectedAppeal: null,
      appealOverridesByTarget: {},
      referenceIds: [],
      brief: null,
      analysisSource: null,
      productUrl: "",
      selectedAnalysisImageIds: [],
      audience: null,
      coreAppeal: null,
      secondaryAppeals: [],
    },
    outputs: [output],
    attachmentsLockedAt: null,
    terminalAt: null,
    retryableUntil: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

const callbacks = {
  onRetry: vi.fn(async () => undefined),
  onRevise: vi.fn(async () => undefined),
  onDownload: vi.fn(async () => undefined),
  onPublish: vi.fn(async () => undefined),
  onToggleSelection: vi.fn(),
};

describe("AiGenerationOutputList v2 capabilities", () => {
  it("keeps v2 reel download visible while hiding read-only and publish actions", () => {
    const output = {
      id: "output-reel",
      generationId: "generation-1",
      title: "릴스",
      status: "completed",
      artifact: {
        queueId: "output-reel",
        kind: "video",
        deliveryFormat: null,
        assets: [{ url: "https://cdn.test/reel.mp4", fileName: "reel.mp4", mimeType: "video/mp4", width: 1080, height: 1920 }],
        posterUrl: "https://cdn.test/scene-01.png",
        html: null,
        text: "릴스",
      },
      outputFormat: "reel",
      manifestVersion: "ai-content.v2",
      publishSupported: false,
      failureReason: null,
      downloadedAt: null,
      revisionCapabilities: [],
      legacyReadOnly: false,
    } as AiGenerationOutput;

    render(<AiGenerationOutputList generation={generationWith(output)} downloadedKeys={new Set()} selectedForZip={new Set()} channels={[]} retryingOutputId={null} revisingOutputId={null} publishingOutputIds={new Set()} publishResults={{}} {...callbacks} />);

    expect(screen.getByRole("button", { name: "릴스 결과 ZIP 다운로드" })).toBeEnabled();
    expect(screen.queryByText("과거 Reel 결과는 읽기 전용입니다.")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "SNS에 바로 게시" })).not.toBeInTheDocument();
  });

  it("shows publish actions for safely mapped v2 marketing_content", () => {
    const output = {
      id: "output-marketing",
      generationId: "generation-1",
      title: "마케팅",
      status: "completed",
      artifact: {
        queueId: "output-marketing",
        kind: "image_gallery",
        deliveryFormat: null,
        assets: [{ url: "https://cdn.test/1.png", fileName: "1.png", mimeType: "image/png", width: 1080, height: 1350 }],
        posterUrl: "https://cdn.test/1.png",
        html: null,
        text: "마케팅",
      },
      outputFormat: "marketing_content",
      manifestVersion: "ai-content.v2",
      publishSupported: true,
      failureReason: null,
      downloadedAt: null,
      revisionCapabilities: [],
      legacyReadOnly: false,
    } as AiGenerationOutput;

    render(<AiGenerationOutputList generation={generationWith(output)} downloadedKeys={new Set()} selectedForZip={new Set()} channels={[]} retryingOutputId={null} revisingOutputId={null} publishingOutputIds={new Set()} publishResults={{}} {...callbacks} />);

    expect(screen.getByRole("region", { name: "SNS에 바로 게시" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "마케팅 결과 ZIP 다운로드" })).toBeEnabled();
  });
});
