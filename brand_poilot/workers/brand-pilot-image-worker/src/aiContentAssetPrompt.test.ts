import { describe, expect, it } from "vitest";
import { buildAiContentAssetPrompt } from "./aiContentAssetPrompt.js";
import type { ImageGenerationPackageV1 } from "@brand-pilot/content-contracts";

const uid = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function imagePackage(): ImageGenerationPackageV1 {
  return {
    contractVersion: "image-generation-package.v1", generationId: uid(1), outputFormat: "card_news", purpose: "marketing",
    assetCount: 3, aspectRatio: "1:1", channelTargets: ["instagram"],
    assets: [
      { index: 1, role: "hook", copy: "one", visualDirection: "one visual", evidenceIds: [], productImageAssetIds: [], attachmentIds: [] },
      { index: 2, role: "benefit", copy: "두 개를 이 순서로 보여준다", visualDirection: "제품을 중앙에 둔다", evidenceIds: [uid(9)], productImageAssetIds: [uid(4)], attachmentIds: [uid(8)] },
      { index: 3, role: "cta", copy: "three", visualDirection: "three visual", evidenceIds: [], productImageAssetIds: [], attachmentIds: [] },
    ],
    product: { id: uid(2), versionId: uid(3), kind: "product", name: "Tea", description: "Fixed tea", features: ["mild"], benefits: ["calm"], cautions: ["hot"], evergreenPurchaseInfo: "online", images: [{ assetId: uid(4), role: "hero", storageUrl: "https://live.example/product.png", storagePath: "owned/product.png", mimeType: "image/png", checksum: "a".repeat(64) }] },
    references: [{ referenceItemId: uid(5), snapshotId: uid(6), roles: ["visual_composition"], title: "Reference", sourceUrl: "https://external.example/source", capturedAt: "2026-07-31T00:00:00Z", contentHash: "b".repeat(64), text: "Frozen composition", image: { storageUrl: "https://live.example/reference.png", storagePath: "owned/reference.png", mimeType: "image/png", checksum: "c".repeat(64) } }],
    brandStyleImages: [{ referenceItemId: uid(5), description: "Soft editorial", tags: ["warm"], storageUrl: "https://live.example/style.png", storagePath: "owned/style.png", mimeType: "image/png", checksum: "d".repeat(64) }],
    avatarStyleImageId: uid(5),
    attachments: [{ id: uid(8), role: "supporting_image", fileName: "support.png", mimeType: "image/png", sizeBytes: 123, checksum: "e".repeat(64), storageUrl: "https://live.example/attachment.png", storagePath: "owned/attachment.png" }],
    userImageInstruction: "모든 장면에 부드러운 자연광",
    logoPolicy: { allowGeneratedLogo: false, allowReservedLogoArea: false, allowExternalReferenceLogo: false, allowExistingProductPackagingLogo: true },
  };
}

describe("V3 asset prompt", () => {
  it("renders only the exact indexed asset with ordered fixed instructions and staged paths", () => {
    const prompt = buildAiContentAssetPrompt({
      imagePackage: imagePackage(), assetIndex: 2,
      staged: {
        productImages: [{ id: uid(4), path: "inputs/product-01.png" }],
        styleImages: [{ id: uid(5), path: "inputs/style-01.png", avatar: true }],
        references: [{ id: uid(5), path: "inputs/reference-01.png", roles: ["visual_composition"], title: "Reference", text: "Frozen composition" }],
        attachments: [{ id: uid(8), path: "inputs/attachment-01.png", role: "supporting_image" }],
      },
    });

    for (const text of ["gpt-image-2", "index 2", "benefit", "1:1", "모델 원본", "모든 장면에 부드러운 자연광", "Soft editorial", "visual_composition", "제품을 중앙에 둔다", uid(9), "두 개를 이 순서로 보여준다", "inputs/product-01.png", "inputs/attachment-01.png"]) {
      expect(prompt).toContain(text);
    }
    expect(prompt).not.toContain("1080×1080");
    expect(prompt.indexOf("강제 계약")).toBeLessThan(prompt.indexOf("사용자 공통 이미지 지시"));
    expect(prompt.indexOf("사용자 공통 이미지 지시")).toBeLessThan(prompt.indexOf("브랜드 스타일 이미지"));
    expect(prompt).toMatch(/로고.*워드마크.*심볼.*워터마크.*가짜 로고/s);
    expect(prompt).toContain("로고용 빈 공간");
    expect(prompt).toContain("외부 레퍼런스의 로고를 복제");
    expect(prompt).toContain("실제 선택 제품 사진이나 포장에 이미 인쇄된 로고는 유지");
    expect(prompt).not.toMatch(/external\.example|live\.example|storagePath|storageUrl|sourceUrl|wiki|faq|brandColor|font|notes/i);
    expect(prompt).not.toContain("one visual");
    expect(prompt).not.toContain("three visual");
  });
});
