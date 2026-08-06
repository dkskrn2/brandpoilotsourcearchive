import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AiContentGeneration, AiGenerationOutput } from "../../features/ai-content/types";
import { AiGenerationOutputList } from "./AiGenerationOutputList";

function generationWith(output: AiGenerationOutput): AiContentGeneration {
  return {
    id: "generation-1",
    brandId: "brand-1",
    title: "결과",
    outputFormat: output.outputFormat,
    purpose: "marketing",
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
  onDownload: vi.fn(async () => undefined),
  onPublish: vi.fn(async () => undefined),
  onToggleSelection: vi.fn(),
};

describe("AiGenerationOutputList V3 capabilities", () => {
  it("keeps V3 reel download visible while hiding publish actions", () => {
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
      manifestVersion: "ai-content.v3",
      publishSupported: false,
      failureReason: null,
      downloadedAt: null,
    } satisfies AiGenerationOutput;

    render(<AiGenerationOutputList generation={generationWith(output)} downloadedKeys={new Set()} selectedForZip={new Set()} channels={[]} retryingOutputId={null} publishingOutputIds={new Set()} publishResults={{}} {...callbacks} />);

    expect(screen.getByRole("button", { name: "릴스 결과 ZIP 다운로드" })).toBeEnabled();
    expect(screen.queryByRole("region", { name: "SNS에 바로 게시" })).not.toBeInTheDocument();
  });

  it("shows publish actions only for a V3 card-news result", () => {
    const output = {
      id: "output-marketing",
      generationId: "generation-1",
      title: "카드뉴스",
      status: "completed",
      artifact: {
        queueId: "output-marketing",
        kind: "image_gallery",
        deliveryFormat: null,
        assets: [{ url: "https://cdn.test/1.png", fileName: "1.png", mimeType: "image/png", width: 1080, height: 1350 }],
        posterUrl: "https://cdn.test/1.png",
        html: null,
        text: "카드뉴스",
      },
      outputFormat: "card_news",
      manifestVersion: "ai-content.v3",
      publishSupported: true,
      failureReason: null,
      downloadedAt: null,
    } satisfies AiGenerationOutput;

    render(<AiGenerationOutputList generation={generationWith(output)} downloadedKeys={new Set()} selectedForZip={new Set()} channels={[]} retryingOutputId={null} publishingOutputIds={new Set()} publishResults={{}} {...callbacks} />);

    expect(screen.getByRole("region", { name: "SNS에 바로 게시" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "카드뉴스 결과 ZIP 다운로드" })).toBeEnabled();
  });
});
