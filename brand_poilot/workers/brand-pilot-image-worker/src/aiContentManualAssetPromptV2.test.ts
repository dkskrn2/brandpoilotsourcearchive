import { describe, expect, it } from "vitest";
import { buildAiContentManualAssetPromptV2 } from "./aiContentManualAssetPromptV2.js";
import type { AiContentManualRenderContractV2 } from "./aiContentManualRenderContract.js";

const uid = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("blog supporting-image prompt v2", () => {
  it("keeps final HTML immutable and renders only the bound supporting image", () => {
    const renderContract: AiContentManualRenderContractV2 = {
      contractVersion: "ai-content-manual-render.v2", rendererPromptVersion: "image-final-pixels.v2",
      generationId: uid(1), outputId: uid(2), workspaceId: uid(3), brandId: uid(4), assetIndex: 2,
      assetKey: `${uid(1)}:2`, storagePath: `ai-content/${uid(4)}/${uid(1)}/${uid(2)}/assets/02.png`,
      outputFormat: "blog", purpose: "informational", aspectRatio: "16:9",
      currentAsset: { index: 2, role: "diagram", copy: "보조 이미지", visualDirection: "비교 도표" },
      blogInsertionContext: {
        placeholder: "asset://02", altText: "선택 기준", nearestHeading: "선택 기준",
        previousParagraph: "기준을 확인합니다.", nextParagraph: "다음 기준입니다.", role: "diagram",
      },
    };
    const prompt = buildAiContentManualAssetPromptV2({
      renderContract,
      staged: { productImages: [], styleImages: [], references: [], attachments: [] },
    });
    expect(prompt).toMatch(/블로그.*HTML.*최종/s);
    expect(prompt).toContain("inputs/blog-insertion-context.json");
    expect(prompt).toContain("asset://02");
    expect(prompt).toMatch(/보조 이미지.*한 장/s);
    expect(prompt).toContain('"contractVersion":"ai-content-asset-render.v2"');
  });
});
