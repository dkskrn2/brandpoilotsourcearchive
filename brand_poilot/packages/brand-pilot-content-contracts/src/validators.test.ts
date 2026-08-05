import { describe, expect, it } from "vitest";
import {
  CONTENT_FORMAT_CATALOG,
  CONTENT_IMAGE_PROMPT_VERSIONS,
  CONTENT_OUTPUT_FORMATS,
  CONTENT_PROMPT_DEFINITION_VERSIONS,
  CONTENT_PURPOSES,
  type ContentPurpose,
  type ContentStudioOutputFormat,
} from "./catalog.js";
import type { ContentPromptBinding } from "./binding.js";
import type { ContentGenerationInputV3, ImageGenerationPackageV1 } from "./generation.js";
import type { AiContentManifestV3 } from "./manifest.js";
import type { ContentPlanResultV2 } from "./plans.js";
import {
  assertAssetCountInvariant,
  assertContentPipelineBindings,
  assertEvidenceOwnership,
  assertManifestMatchesInput,
  assertPlannerPromptBinding,
  assertPurposeProductInvariant,
  assertSelectedProposalInvariant,
  parseContentPipelineAuthorityContext,
  parseRenderedAssetInventory,
  type ContentPipelineAuthorityContext,
  type RenderedAssetInventory,
} from "./validators.js";

const ids = {
  generation: "00000000-0000-4000-8000-000000000001",
  brandCore: "00000000-0000-4000-8000-000000000002",
  product: "00000000-0000-4000-8000-000000000003",
  productVersion: "00000000-0000-4000-8000-000000000004",
  evidence: "00000000-0000-4000-8000-000000000005",
  reference: "00000000-0000-4000-8000-000000000006",
  snapshot: "00000000-0000-4000-8000-000000000007",
  proposal: "00000000-0000-4000-8000-000000000008",
  workspace: "00000000-0000-4000-8000-000000000009",
  brand: "00000000-0000-4000-8000-00000000000a",
  batch: "00000000-0000-4000-8000-00000000000b",
} as const;
const OTHER_ID = "00000000-0000-4000-8000-00000000000c";
const ATTACHMENT_ID = "00000000-0000-4000-8000-00000000000d";
const NOW = "2026-08-05T00:00:00Z";
const HASH = "a".repeat(64);

function assetPath(fileName: string): string {
  return `ai-content/${ids.brand}/${ids.generation}/${fileName}`;
}

function assetUrl(fileName: string): string {
  return `https://assets.example.com/${assetPath(fileName)}`;
}

function product() {
  return {
    id: ids.product,
    versionId: ids.productVersion,
    kind: "product" as const,
    name: "상품",
    description: "설명",
    features: [],
    benefits: [],
    cautions: [],
    evergreenPurchaseInfo: "",
    images: [],
  };
}

function inputFor(outputFormat: ContentStudioOutputFormat, purpose: ContentPurpose): ContentGenerationInputV3 {
  const marketing = purpose === "marketing";
  const assetCount = outputFormat === "blog" ? 2 : 3;
  return {
    contractVersion: "content-generation-input.v3",
    generationId: ids.generation,
    brandCore: {
      versionId: ids.brandCore,
      companyOverview: "회사",
      businessDescription: "사업",
      primaryCategory: "카테고리",
      detailedCategory: "상세",
      primaryTarget: "대상",
      differentiator: "차별점",
      coreAppeal: "핵심",
    },
    subject: { kind: "topic_text", title: "주제" },
    contentInstruction: null,
    product: marketing ? product() : null,
    researchEvidence: {
      contractVersion: "research-evidence.v1",
      decision: "searched",
      reason: "정보 검증",
      queries: ["질문"],
      capturedAt: NOW,
      items: [{
        id: ids.evidence,
        title: "근거",
        url: "https://example.com/evidence",
        publisher: null,
        publishedAt: null,
        capturedAt: NOW,
        claimSummary: "요약",
        contentHash: HASH,
      }],
    },
    references: {
      selected: [{
        referenceItemId: ids.reference,
        snapshotId: ids.snapshot,
        roles: ["planning"],
        title: "참조",
        sourceUrl: "https://example.com/reference",
        capturedAt: NOW,
        contentHash: HASH,
        text: "본문",
        image: null,
      }],
      brandStyleImages: [],
      avatarStyleImageId: null,
      attachments: [],
    },
    selectedProposal: {
      id: ids.proposal,
      conceptKey: "concept",
      title: "제안",
      informationalType: marketing ? null : "how_to",
      oneLineIntent: "의도",
      differentiator: "차별점",
      differentiationAxes: ["target"],
      target: "대상",
      customerContext: "맥락",
      keyMessage: "메시지",
      hook: "훅",
      selectionReason: "선택 이유",
      evidenceIds: [ids.evidence],
      referenceIds: [ids.reference],
      outputFormat,
      channelTargets: [outputFormat === "blog" ? "blog_export" : "instagram"],
      assetCount,
      outline: Array.from({ length: outputFormat === "blog" ? 1 : assetCount }, (_, index) => ({
        index: index + 1,
        role: outputFormat === "card_news" ? "slide" : outputFormat === "reel" ? "scene" : "article_section",
        headline: `제목 ${index + 1}`,
        purpose: `목적 ${index + 1}`,
      })),
      purposeDetails: marketing ? {
        kind: "marketing",
        campaignObjective: "목표",
        situationAndNeed: "상황",
        productId: ids.product,
        targetSegment: "대상",
        strengths: [], limitations: [], appeal: "소구", buyingBarriers: [], cta: "구매",
      } : {
        kind: "informational",
        question: "질문",
        value: "가치",
        whyNow: "지금",
        learningPoints: ["학습"],
      },
    },
    userImageInstruction: null,
    outputSettings: {
      outputFormat,
      channelTargets: [outputFormat === "blog" ? "blog_export" : "instagram"],
      aspectRatio: outputFormat === "blog" ? null : outputFormat === "reel" ? "9:16" : "1:1",
      outputCount: 1,
      purpose,
    },
    capturedAt: NOW,
  };
}

function authorityFor(outputFormat: ContentStudioOutputFormat, purpose: ContentPurpose): ContentPipelineAuthorityContext {
  return {
    scope: { workspaceId: ids.workspace, brandId: ids.brand },
    selection: {
      workspaceId: ids.workspace,
      brandId: ids.brand,
      proposalBatchId: ids.batch,
      proposalId: ids.proposal,
      outputFormat,
      purpose,
    },
    evidence: [{ workspaceId: ids.workspace, brandId: ids.brand, proposalBatchId: ids.batch, evidenceId: ids.evidence }],
    references: [{
      workspaceId: ids.workspace,
      brandId: ids.brand,
      proposalBatchId: ids.batch,
      referenceItemId: ids.reference,
      snapshotId: ids.snapshot,
    }],
  };
}

function bindingFor(outputFormat: ContentStudioOutputFormat, purpose: ContentPurpose): ContentPromptBinding {
  return {
    contractVersion: "content-prompt-binding.v1",
    outputFormat,
    purpose,
    proposalRequestVersion: "content-proposal-request.v2",
    proposalBaseInputVersion: "proposal-base-input.v2",
    proposalComposedInputVersion: "proposal-input.v2",
    proposalOutputVersion: "content-proposal.v2",
    proposalPromptVersion: "proposal.writer.v2",
    proposalSchemaSha256: HASH,
    generationInputVersion: "content-generation-input.v3",
    generationSchemaSha256: "b".repeat(64),
    planContractVersion: CONTENT_FORMAT_CATALOG[outputFormat].planContractVersion,
    planSchemaSha256: "c".repeat(64),
    plannerPromptVersion: CONTENT_PROMPT_DEFINITION_VERSIONS[outputFormat][purpose],
    imagePackageVersion: "image-generation-package.v1",
    imagePromptVersion: CONTENT_IMAGE_PROMPT_VERSIONS[outputFormat][purpose],
    manifestVersion: "ai-content.v3",
    contractSourceHash: "d".repeat(64),
    model: "gpt-5.6-terra",
  };
}

function imagePackageFor(input: ContentGenerationInputV3): ImageGenerationPackageV1 {
  const count = input.selectedProposal.assetCount ?? 1;
  return {
    contractVersion: "image-generation-package.v1",
    generationId: input.generationId,
    outputFormat: input.outputSettings.outputFormat,
    purpose: input.outputSettings.purpose,
    assetCount: count,
    aspectRatio: input.outputSettings.aspectRatio ?? "1:1",
    channelTargets: input.outputSettings.channelTargets,
    assets: Array.from({ length: count }, (_, index) => ({
      index: index + 1,
      role: input.outputSettings.outputFormat === "blog"
        ? (index === 0 ? "cover" : "explanation")
        : input.selectedProposal.outline[index]?.role ?? "missing-outline",
      copy: `copy-${index + 1}`,
      visualDirection: `visual-${index + 1}`,
      evidenceIds: [ids.evidence],
      productImageAssetIds: [],
      attachmentIds: [],
    })),
    product: input.product,
    references: input.references.selected,
    brandStyleImages: input.references.brandStyleImages,
    avatarStyleImageId: input.references.avatarStyleImageId,
    attachments: input.references.attachments,
    userImageInstruction: input.userImageInstruction,
    logoPolicy: {
      allowGeneratedLogo: false,
      allowReservedLogoArea: false,
      allowExternalReferenceLogo: false,
      allowExistingProductPackagingLogo: true,
    },
  };
}

function pipelineFor(outputFormat: ContentStudioOutputFormat, purpose: ContentPurpose) {
  const input = inputFor(outputFormat, purpose);
  const imagePackage = imagePackageFor(input);
  let plan: ContentPlanResultV2;
  let manifest: AiContentManifestV3;
  let rendered: RenderedAssetInventory;
  if (outputFormat === "card_news") {
    plan = { contractVersion: "card-news-plan.v2", content: { caption: "캡션", hashtags: [], cta: "CTA" }, imagePackage };
    const assets = imagePackage.assets.map(({ index }) => ({ role: "slide" as const, index, url: assetUrl(`slide-${index}.png`), fileName: `slide-${index}.png`, mimeType: "image/png" as const, width: 1080, height: 1080 }));
    manifest = { version: "ai-content.v3", outputFormat, purpose, title: "제목", assets, content: { caption: "캡션", hashtags: [], cta: "CTA" } };
  } else if (outputFormat === "blog") {
    plan = { contractVersion: "blog-plan.v2", content: { title: "제목", htmlTemplate: "<p>본문</p>", metaTitle: "메타", metaDescription: "설명", usedEvidenceIds: [ids.evidence] }, imagePackage };
    const assets = [{ role: "html" as const, index: 1, url: assetUrl("index.html"), fileName: "index.html", mimeType: "text/html" as const }, ...imagePackage.assets.map(({ index }) => ({ role: "inline" as const, index, url: assetUrl(`inline-${index}.png`), fileName: `inline-${index}.png`, mimeType: "image/png" as const, width: 1080, height: 1080 }))];
    manifest = { version: "ai-content.v3", outputFormat, purpose, title: "제목", assets, content: { title: "제목", summary: "요약", html: "<p>본문</p>", metaTitle: "메타", metaDescription: "설명" } };
  } else {
    plan = { contractVersion: "reel-plan.v2", outputFormat: "reel", content: { caption: "캡션", hashtags: [], cta: "CTA" }, imagePackage };
    const assets = [...imagePackage.assets.map(({ index }) => ({ role: "scene" as const, index, url: assetUrl(`scene-${index}.png`), fileName: `scene-${index}.png`, mimeType: "image/png" as const, width: 1080, height: 1920 })), { role: "video" as const, index: 1, url: assetUrl("video.mp4"), fileName: "video.mp4", mimeType: "video/mp4" as const, width: 1080, height: 1920, durationSeconds: 10, videoCodec: "h264" as const, fps: 30 as const, audioCodec: null }];
    manifest = { version: "ai-content.v3", outputFormat, purpose, title: "제목", assets, content: { caption: "캡션", hashtags: [], cta: "CTA" } };
  }
  rendered = {
    generationId: ids.generation,
    outputFormat,
    purpose,
    assets: manifest.assets.map((asset, index) => ({
      ...asset,
      storagePath: assetPath(asset.fileName),
      checksum: (index + 1).toString(16).padStart(64, "0"),
    })),
  };
  return { input, authority: authorityFor(outputFormat, purpose), binding: bindingFor(outputFormat, purpose), plan, imagePackage, rendered, manifest };
}

describe("content pipeline semantic bindings", () => {
  it.each(CONTENT_OUTPUT_FORMATS.flatMap((format) => CONTENT_PURPOSES.map((purpose) => [format, purpose] as const)))(
    "accepts the complete %s/%s pipeline cell",
    (format, purpose) => {
      const value = pipelineFor(format, purpose);
      expect(() => assertContentPipelineBindings(value.input, value.authority, value.binding, value.plan, value.imagePackage, value.rendered, value.manifest)).not.toThrow();
    },
  );

  it("enforces purpose/product/evidence rules", () => {
    const informational = inputFor("blog", "informational");
    expect(() => assertPurposeProductInvariant({ ...informational, product: product() })).toThrow("informational_product_must_be_null");
    expect(() => assertPurposeProductInvariant({ ...informational, researchEvidence: { ...informational.researchEvidence, items: [] } })).toThrow("informational_evidence_required");
    const marketing = inputFor("reel", "marketing");
    expect(() => assertPurposeProductInvariant({ ...marketing, product: null })).toThrow("marketing_product_required");
  });

  it("rejects authority rows from another scope or batch and unfrozen identities", () => {
    const input = inputFor("card_news", "informational");
    const authority = authorityFor("card_news", "informational");
    expect(() => assertEvidenceOwnership(input, { ...authority, evidence: [{ ...authority.evidence[0], workspaceId: OTHER_ID }] })).toThrow("authority_evidence_scope_mismatch");
    expect(() => assertEvidenceOwnership(input, { ...authority, references: [{ ...authority.references[0], proposalBatchId: OTHER_ID }] })).toThrow("authority_reference_batch_mismatch");
    expect(() => assertEvidenceOwnership({ ...input, researchEvidence: { ...input.researchEvidence, items: [{ ...input.researchEvidence.items[0], id: OTHER_ID }] } }, authority)).toThrow("input_evidence_not_authorized");
    expect(() => assertEvidenceOwnership({ ...input, references: { ...input.references, selected: [{ ...input.references.selected[0], snapshotId: OTHER_ID }] } }, authority)).toThrow("input_reference_not_authorized");
    expect(() => assertEvidenceOwnership({ ...input, selectedProposal: { ...input.selectedProposal, evidenceIds: [OTHER_ID] } }, authority)).toThrow("proposal_evidence_not_frozen");
    expect(() => assertEvidenceOwnership({ ...input, selectedProposal: { ...input.selectedProposal, referenceIds: [OTHER_ID] } }, authority)).toThrow("proposal_reference_not_frozen");
  });

  it("rejects selected proposal identity, format, and purpose drift", () => {
    const input = inputFor("reel", "marketing");
    const authority = authorityFor("reel", "marketing");
    expect(() => assertSelectedProposalInvariant(input, { ...authority, selection: { ...authority.selection, proposalId: OTHER_ID } })).toThrow("selected_proposal_id_mismatch");
    expect(() => assertSelectedProposalInvariant(input, { ...authority, selection: { ...authority.selection, outputFormat: "blog" } })).toThrow("selected_proposal_format_mismatch");
    expect(() => assertSelectedProposalInvariant(input, { ...authority, selection: { ...authority.selection, purpose: "informational" } })).toThrow("selected_proposal_purpose_mismatch");
  });

  it("rejects format, purpose, version, prompt, and model drift in the binding", () => {
    const value = pipelineFor("card_news", "marketing");
    expect(() => assertPlannerPromptBinding(value.input, { ...value.binding, outputFormat: "blog" })).toThrow("binding_output_format_mismatch");
    expect(() => assertPlannerPromptBinding(value.input, { ...value.binding, purpose: "informational" })).toThrow("binding_purpose_mismatch");
    expect(() => assertPlannerPromptBinding(value.input, { ...value.binding, planContractVersion: "blog-plan.v2" })).toThrow("binding_plan_version_mismatch");
    expect(() => assertPlannerPromptBinding(value.input, { ...value.binding, plannerPromptVersion: "planner.blog.marketing.v1" })).toThrow("binding_planner_prompt_mismatch");
    expect(() => assertPlannerPromptBinding(value.input, { ...value.binding, imagePromptVersion: "image.blog.marketing.v1" })).toThrow("binding_image_prompt_mismatch");
    expect(() => assertPlannerPromptBinding(value.input, { ...value.binding, model: "gpt-5.6-sol" as "gpt-5.6-terra" })).toThrow("content_prompt_binding_invalid");
  });

  it("enforces channel/aspect format rules and outputCount as one final content", () => {
    for (const [format, channel, aspect] of [["card_news", "instagram", "1:1"], ["blog", "blog_export", null], ["reel", "instagram", "9:16"]] as const) {
      const input = inputFor(format, "informational");
      expect(input.outputSettings.channelTargets).toEqual([channel]);
      expect(input.outputSettings.aspectRatio).toBe(aspect);
      expect(input.outputSettings.outputCount).toBe(1);
    }
    const value = pipelineFor("reel", "informational");
    expect(value.imagePackage.assetCount).toBe(3);
    expect(() => assertContentPipelineBindings(value.input, value.authority, value.binding, value.plan, value.imagePackage, value.rendered, value.manifest)).not.toThrow();
    expect(() => assertContentPipelineBindings({ ...value.input, selectedProposal: { ...value.input.selectedProposal, channelTargets: ["youtube"] }, outputSettings: { ...value.input.outputSettings, channelTargets: ["youtube"] } }, value.authority, value.binding, value.plan, value.imagePackage, value.rendered, value.manifest)).toThrow("input_channel_mismatch");
    expect(() => assertContentPipelineBindings({ ...value.input, outputSettings: { ...value.input.outputSettings, outputCount: 2 as 1 } }, value.authority, value.binding, value.plan, value.imagePackage, value.rendered, value.manifest)).toThrow("input_output_count_mismatch");
  });

  it("derives and cross-checks card, blog, and reel rendered asset inventories", () => {
    for (const format of CONTENT_OUTPUT_FORMATS) {
      const value = pipelineFor(format, "informational");
      expect(() => assertAssetCountInvariant(value.input, value.authority, value.plan, value.imagePackage, value.rendered, value.manifest)).not.toThrow();
      expect(() => assertAssetCountInvariant(value.input, value.authority, value.plan, value.imagePackage, { ...value.rendered, assets: value.rendered.assets.slice(1) }, value.manifest)).toThrow("rendered_asset_inventory_mismatch");
      const wrongCountPackage = { ...value.imagePackage, assetCount: value.imagePackage.assetCount - 1 };
      const wrongCountPlan = { ...value.plan, imagePackage: wrongCountPackage } as ContentPlanResultV2;
      expect(() => assertAssetCountInvariant(value.input, value.authority, wrongCountPlan, wrongCountPackage, value.rendered, value.manifest)).toThrow("image_asset_count_mismatch");
    }
  });

  it("requires manifest format/purpose/content/assets to match the input", () => {
    const card = pipelineFor("card_news", "marketing");
    expect(() => assertManifestMatchesInput(card.input, card.binding, { ...card.manifest, purpose: "informational" })).toThrow("manifest_purpose_mismatch");
    expect(() => assertManifestMatchesInput(card.input, card.binding, { ...card.manifest, outputFormat: "blog" })).toThrow("manifest_output_format_mismatch");
    expect(() => assertManifestMatchesInput(card.input, card.binding, { ...card.manifest, content: { title: "블로그", summary: "요약", html: "<p>x</p>", metaTitle: "메타", metaDescription: "설명" } })).toThrow("manifest_content_kind_mismatch");
    const reel = pipelineFor("reel", "informational");
    expect(() => assertAssetCountInvariant(reel.input, reel.authority, reel.plan, reel.imagePackage, reel.rendered, { ...reel.manifest, assets: reel.manifest.assets.filter((asset) => asset.role !== "video") })).toThrow("manifest_asset_inventory_mismatch");
  });

  it("treats schema-equivalent objects as equal regardless of property insertion order", () => {
    const value = pipelineFor("card_news", "informational");
    const { contractVersion, ...rest } = value.imagePackage;
    const reorderedPackage = { ...rest, contractVersion } as ImageGenerationPackageV1;
    expect(() => assertContentPipelineBindings(value.input, value.authority, value.binding, value.plan, reorderedPackage, value.rendered, value.manifest)).not.toThrow();
  });

  it("rejects non-sequential planner image identities even when the count is unchanged", () => {
    const value = pipelineFor("blog", "informational");
    const imagePackage = {
      ...value.imagePackage,
      assets: value.imagePackage.assets.map((asset) => ({ ...asset, index: asset.index + 1 })),
    };
    const plan = { ...value.plan, imagePackage } as ContentPlanResultV2;
    expect(() => assertAssetCountInvariant(value.input, value.authority, plan, imagePackage, value.rendered, value.manifest)).toThrow("image_asset_index_mismatch");
  });

  it("parses only closed authority and rendered boundary records", () => {
    const value = pipelineFor("reel", "informational");
    expect(parseContentPipelineAuthorityContext(value.authority)).toEqual(value.authority);
    expect(parseRenderedAssetInventory(value.rendered)).toEqual(value.rendered);
    expect(() => parseContentPipelineAuthorityContext({ ...value.authority, extra: true })).toThrow("content_pipeline_authority_context_invalid");
    expect(() => parseContentPipelineAuthorityContext({ ...value.authority, scope: { ...value.authority.scope, extra: true } })).toThrow("content_pipeline_authority_context_invalid");
    expect(() => parseContentPipelineAuthorityContext({ ...value.authority, selection: { ...value.authority.selection, extra: true } })).toThrow("content_pipeline_authority_context_invalid");
    expect(() => parseContentPipelineAuthorityContext({ ...value.authority, evidence: [{ ...value.authority.evidence[0], extra: true }] })).toThrow("content_pipeline_authority_context_invalid");
    expect(() => parseContentPipelineAuthorityContext({ ...value.authority, references: [{ ...value.authority.references[0], extra: true }] })).toThrow("content_pipeline_authority_context_invalid");
    expect(() => parseContentPipelineAuthorityContext({ ...value.authority, scope: { ...value.authority.scope, brandId: "bad" } })).toThrow("content_pipeline_authority_context_invalid");
    expect(() => parseContentPipelineAuthorityContext({ ...value.authority, selection: { ...value.authority.selection, outputFormat: "video" } })).toThrow("content_pipeline_authority_context_invalid");
    expect(() => parseContentPipelineAuthorityContext({ ...value.authority, selection: { ...value.authority.selection, purpose: "sales" } })).toThrow("content_pipeline_authority_context_invalid");
    expect(() => parseRenderedAssetInventory({ ...value.rendered, extra: true })).toThrow("rendered_asset_inventory_invalid");
    expect(() => parseRenderedAssetInventory({ ...value.rendered, assets: [{ ...value.rendered.assets[0], extra: true }] })).toThrow("rendered_asset_inventory_invalid");
    expect(() => parseRenderedAssetInventory({ ...value.rendered, assets: [{ role: "video", index: 1, url: assetUrl("x.mp4") }] })).toThrow("rendered_asset_inventory_invalid");
    expect(() => parseRenderedAssetInventory({ ...value.rendered, generationId: "bad" })).toThrow("rendered_asset_inventory_invalid");
    expect(() => parseRenderedAssetInventory({ ...value.rendered, outputFormat: "video" })).toThrow("rendered_asset_inventory_invalid");
    expect(() => parseRenderedAssetInventory({ ...value.rendered, purpose: "sales" })).toThrow("rendered_asset_inventory_invalid");
    expect(() => assertContentPipelineBindings(value.input, { ...value.authority, extra: true } as ContentPipelineAuthorityContext, value.binding, value.plan, value.imagePackage, value.rendered, value.manifest)).toThrow("content_pipeline_authority_context_invalid");
    expect(() => assertContentPipelineBindings(value.input, value.authority, value.binding, value.plan, value.imagePackage, { ...value.rendered, extra: true } as RenderedAssetInventory, value.manifest)).toThrow("rendered_asset_inventory_invalid");
  });

  it("rejects duplicate frozen evidence/reference/style identities and unapproved avatars", () => {
    const value = pipelineFor("card_news", "informational");
    expect(() => assertEvidenceOwnership(value.input, { ...value.authority, evidence: [...value.authority.evidence, value.authority.evidence[0]] })).toThrow("authority_evidence_duplicate");
    expect(() => assertEvidenceOwnership({ ...value.input, researchEvidence: { ...value.input.researchEvidence, items: [...value.input.researchEvidence.items, value.input.researchEvidence.items[0]] } }, value.authority)).toThrow("input_evidence_duplicate");
    expect(() => assertEvidenceOwnership(value.input, { ...value.authority, references: [...value.authority.references, value.authority.references[0]] })).toThrow("authority_reference_duplicate");
    expect(() => assertEvidenceOwnership({ ...value.input, references: { ...value.input.references, selected: [...value.input.references.selected, value.input.references.selected[0]] } }, value.authority)).toThrow("input_reference_duplicate");
    const style = { referenceItemId: ids.reference, description: "style", tags: [], storageUrl: "https://example.com/style.png", storagePath: "style.png", mimeType: "image/png" as const, checksum: HASH };
    expect(() => assertEvidenceOwnership({ ...value.input, references: { ...value.input.references, brandStyleImages: [style, style] } }, value.authority)).toThrow("brand_style_image_duplicate");
    expect(() => assertEvidenceOwnership({ ...value.input, references: { ...value.input.references, avatarStyleImageId: OTHER_ID } }, value.authority)).toThrow("avatar_style_image_not_frozen");
    expect(() => assertEvidenceOwnership({ ...value.input, references: { ...value.input.references, brandStyleImages: [style], avatarStyleImageId: ids.reference } }, value.authority)).not.toThrow();
  });

  it("rejects untrusted rendered paths, public drift, and duplicate artifact provenance", () => {
    const value = pipelineFor("reel", "informational");
    const first = value.rendered.assets[0];
    expect(() => parseRenderedAssetInventory({ ...value.rendered, assets: [{ ...first, url: first.url.replace("https://", "http://") }] })).toThrow("rendered_asset_inventory_invalid");
    expect(() => parseRenderedAssetInventory({ ...value.rendered, assets: [{ ...first, checksum: "A".repeat(64) }] })).toThrow("rendered_asset_inventory_invalid");
    for (const [storagePath, error] of [["/absolute.png", "rendered_asset_inventory_invalid"], ["a//b.png", "rendered_asset_inventory_invalid"], ["a/./b.png", "rendered_storage_path_invalid"], ["a/../b.png", "rendered_storage_path_invalid"], ["a\\b.png", "rendered_asset_inventory_invalid"]] as const) {
      expect(() => parseRenderedAssetInventory({ ...value.rendered, assets: [{ ...first, storagePath }] })).toThrow(error);
    }
    expect(() => assertContentPipelineBindings(value.input, value.authority, value.binding, value.plan, value.imagePackage, { ...value.rendered, assets: value.rendered.assets.map((asset, index) => index === 0 ? { ...asset, storagePath: `ai-content/${OTHER_ID}/${ids.generation}/${asset.fileName}`, url: `https://assets.example.com/ai-content/${OTHER_ID}/${ids.generation}/${asset.fileName}` } : asset) }, value.manifest)).toThrow("rendered_storage_prefix_mismatch");
    expect(() => parseRenderedAssetInventory({ ...value.rendered, assets: [{ ...first, url: assetUrl("different.png") }] })).toThrow("rendered_url_path_mismatch");
    for (const mutation of [{ url: assetUrl("different.png") }, { fileName: "different.png" }, { width: 720 }]) {
      expect(() => assertContentPipelineBindings(value.input, value.authority, value.binding, value.plan, value.imagePackage, value.rendered, { ...value.manifest, assets: value.manifest.assets.map((asset, index) => index === 0 ? { ...asset, ...mutation } : asset) } as AiContentManifestV3)).toThrow("manifest_rendered_asset_mismatch");
    }
    const duplicateIdentity = value.rendered.assets.map((asset, index) => index === 1 ? { ...asset, role: first.role, index: first.index } : asset);
    expect(() => assertContentPipelineBindings(value.input, value.authority, value.binding, value.plan, value.imagePackage, { ...value.rendered, assets: duplicateIdentity }, value.manifest)).toThrow("rendered_asset_duplicate");
    for (const field of ["url", "fileName", "storagePath", "checksum"] as const) {
      const duplicate = value.rendered.assets.map((asset, index) => {
        if (index !== 1) return asset;
        if (field === "url" || field === "storagePath") {
          return { ...asset, url: first.url, storagePath: first.storagePath };
        }
        return { ...asset, [field]: first[field] };
      });
      expect(() => assertContentPipelineBindings(value.input, value.authority, value.binding, value.plan, value.imagePackage, { ...value.rendered, assets: duplicate }, value.manifest)).toThrow("rendered_asset_duplicate");
    }
  });

  it("rejects noncanonical raw asset URLs before WHATWG normalization", () => {
    const value = pipelineFor("reel", "informational");
    const first = value.rendered.assets[0];
    const prefix = `https://assets.example.com/ai-content/${ids.brand}/${ids.generation}`;
    const invalidUrls = [
      `${prefix}/dir/../${first.fileName}`,
      `${prefix}/%2e/${first.fileName}`,
      `${prefix}/%2E/${first.fileName}`,
      `${prefix}/dir/%2e%2e/${first.fileName}`,
      `${prefix}/dir/%2E%2e/${first.fileName}`,
      `${prefix}\\${first.fileName}`,
      `${prefix}/scene%2F1.png`,
      `${prefix}/scene%2f1.png`,
      `${prefix}/scene%5C1.png`,
      `${prefix}/scene%5c1.png`,
      `https://user:pass@assets.example.com/${first.storagePath}`,
      `${first.url}?download=1`,
      `${first.url}#fragment`,
    ];
    for (const url of invalidUrls) {
      expect(() => parseRenderedAssetInventory({ ...value.rendered, assets: [{ ...first, url }] })).toThrow("rendered_asset_url_invalid");
    }
  });

  it("rejects encoded separators and dot segments in storage paths case-insensitively", () => {
    const value = pipelineFor("card_news", "informational");
    const first = value.rendered.assets[0];
    for (const suffix of ["dir%2Ffile.png", "dir%2ffile.png", "dir%5Cfile.png", "dir%5cfile.png", "%2e/file.png", "%2E/file.png", "dir/%2e%2e/file.png", "dir/%2E%2e/file.png"]) {
      const storagePath = `ai-content/${ids.brand}/${ids.generation}/${suffix}`;
      const url = `https://assets.example.com/${storagePath}`;
      expect(() => parseRenderedAssetInventory({ ...value.rendered, assets: [{ ...first, storagePath, url }] })).toThrow("rendered_storage_path_invalid");
    }
  });

  it("binds image-package references to frozen V3 identifiers without duplicates", () => {
    const value = pipelineFor("card_news", "informational");
    const assertPackageFails = (assetPatch: Partial<ImageGenerationPackageV1["assets"][number]>, error: string) => {
      const imagePackage = { ...value.imagePackage, assets: value.imagePackage.assets.map((asset, index) => index === 0 ? { ...asset, ...assetPatch } : asset) };
      const plan = { ...value.plan, imagePackage } as ContentPlanResultV2;
      expect(() => assertContentPipelineBindings(value.input, value.authority, value.binding, plan, imagePackage, value.rendered, value.manifest)).toThrow(error);
    };
    assertPackageFails({ evidenceIds: [OTHER_ID] }, "image_asset_evidence_not_frozen");
    assertPackageFails({ evidenceIds: [ids.evidence, ids.evidence] }, "image_asset_evidence_duplicate");
    assertPackageFails({ productImageAssetIds: [OTHER_ID] }, "image_asset_product_image_not_frozen");
    assertPackageFails({ productImageAssetIds: [OTHER_ID, OTHER_ID] }, "image_asset_product_image_duplicate");
    assertPackageFails({ attachmentIds: [OTHER_ID] }, "image_asset_attachment_not_frozen");
    assertPackageFails({ attachmentIds: [OTHER_ID, OTHER_ID] }, "image_asset_attachment_duplicate");
  });

  it("accepts approved product-image and finalized attachment references", () => {
    const value = pipelineFor("card_news", "marketing");
    const productImage = {
      assetId: OTHER_ID,
      role: "hero" as const,
      storageUrl: "https://example.com/product.png",
      storagePath: "product.png",
      mimeType: "image/png",
      checksum: HASH,
    };
    const attachment = {
      id: ATTACHMENT_ID,
      role: "supporting_image" as const,
      fileName: "attachment.png",
      mimeType: "image/png" as const,
      sizeBytes: 100,
      checksum: HASH,
      storageUrl: "https://example.com/attachment.png",
      storagePath: "attachment.png",
    };
    const input = {
      ...value.input,
      product: { ...value.input.product!, images: [productImage] },
      references: { ...value.input.references, attachments: [attachment] },
    };
    const imagePackage = {
      ...value.imagePackage,
      product: input.product,
      attachments: input.references.attachments,
      assets: value.imagePackage.assets.map((asset, index) => index === 0
        ? { ...asset, productImageAssetIds: [OTHER_ID], attachmentIds: [ATTACHMENT_ID] }
        : asset),
    };
    const plan = { ...value.plan, imagePackage } as ContentPlanResultV2;
    expect(() => assertContentPipelineBindings(input, value.authority, value.binding, plan, imagePackage, value.rendered, value.manifest)).not.toThrow();
  });

  it("requires card-news and reel image indices and roles to match a contiguous selected outline", () => {
    for (const format of ["card_news", "reel"] as const) {
      const value = pipelineFor(format, "informational");
      const roleDriftPackage = { ...value.imagePackage, assets: value.imagePackage.assets.map((asset, index) => index === 0 ? { ...asset, role: "drift" } : asset) };
      expect(() => assertContentPipelineBindings(value.input, value.authority, value.binding, { ...value.plan, imagePackage: roleDriftPackage } as ContentPlanResultV2, roleDriftPackage, value.rendered, value.manifest)).toThrow("image_asset_outline_mismatch");
      const badOutlineInput = { ...value.input, selectedProposal: { ...value.input.selectedProposal, outline: value.input.selectedProposal.outline.map((item, index) => index === 1 ? { ...item, index: 1 } : item) } };
      expect(() => assertContentPipelineBindings(badOutlineInput, value.authority, value.binding, value.plan, value.imagePackage, value.rendered, value.manifest)).toThrow("proposal_outline_index_mismatch");
    }
  });

  it("preserves independent nonblank blog image roles", () => {
    const value = pipelineFor("blog", "informational");
    expect(value.imagePackage.assets.map((asset) => asset.role)).toEqual(["cover", "explanation"]);
    expect(() => assertContentPipelineBindings(value.input, value.authority, value.binding, value.plan, value.imagePackage, value.rendered, value.manifest)).not.toThrow();
    for (const role of ["", "   ", "bad\u0000role", "bad\u0085role"]) {
      const imagePackage = { ...value.imagePackage, assets: value.imagePackage.assets.map((asset, index) => index === 0 ? { ...asset, role } : asset) };
      expect(() => assertContentPipelineBindings(value.input, value.authority, value.binding, { ...value.plan, imagePackage } as ContentPlanResultV2, imagePackage, value.rendered, value.manifest)).toThrow("blog_image_asset_role_invalid");
    }
  });

  it.each(["slide", "inline", "scene", "html", "video"])(
    "rejects reserved final manifest role %s in a blog image package",
    (role) => {
      const value = pipelineFor("blog", "informational");
      const imagePackage = {
        ...value.imagePackage,
        assets: value.imagePackage.assets.map((asset, index) => index === 0 ? { ...asset, role } : asset),
      };
      const plan = { ...value.plan, imagePackage } as ContentPlanResultV2;
      expect(() => assertContentPipelineBindings(value.input, value.authority, value.binding, plan, imagePackage, value.rendered, value.manifest)).toThrow("blog_image_asset_role_reserved");
    },
  );

  it("rejects unsafe public file names even when rendered and manifest values agree", () => {
    const value = pipelineFor("blog", "informational");
    const withFileName = (fileName: string) => ({
      rendered: { ...value.rendered, assets: value.rendered.assets.map((asset, index) => index === 0 ? { ...asset, fileName } : asset) },
      manifest: { ...value.manifest, assets: value.manifest.assets.map((asset, index) => index === 0 ? { ...asset, fileName } : asset) } as AiContentManifestV3,
    });
    for (const fileName of ["../../evil.png", "dir/file.png", "dir\\file.png", "bad\u0000name.png", "bad\u0085name.png", ".", "..", " padded.png "]) {
      const changed = withFileName(fileName);
      expect(() => assertContentPipelineBindings(value.input, value.authority, value.binding, value.plan, value.imagePackage, changed.rendered, changed.manifest)).toThrow("rendered_file_name_invalid");
    }
    const distinctPublicName = withFileName("public-index.html");
    expect(() => assertContentPipelineBindings(value.input, value.authority, value.binding, value.plan, value.imagePackage, distinctPublicName.rendered, distinctPublicName.manifest)).not.toThrow();
  });

  it("requires selected proposal channel targets to equal V3 output settings", () => {
    const value = pipelineFor("reel", "informational");
    const input = { ...value.input, selectedProposal: { ...value.input.selectedProposal, channelTargets: ["youtube" as const] } };
    expect(() => assertContentPipelineBindings(input, value.authority, value.binding, value.plan, value.imagePackage, value.rendered, value.manifest)).toThrow("selected_proposal_channel_mismatch");
  });

  it("rejects malformed prompt bindings before reporting semantic drift", () => {
    const value = pipelineFor("card_news", "marketing");
    const { model: _model, ...missing } = value.binding;
    expect(() => assertPlannerPromptBinding(value.input, missing as ContentPromptBinding)).toThrow("content_prompt_binding_invalid");
    expect(() => assertPlannerPromptBinding(value.input, { ...value.binding, outputFormat: "blog", extra: true } as ContentPromptBinding)).toThrow("content_prompt_binding_invalid");
  });

  it("checks the binding boundary before any composite semantic invariant", () => {
    const value = pipelineFor("blog", "informational");
    const { model: _model, ...malformedBinding } = value.binding;
    const semanticDriftInput = { ...value.input, product: product() };
    expect(() => assertContentPipelineBindings(semanticDriftInput, value.authority, malformedBinding as ContentPromptBinding, value.plan, value.imagePackage, value.rendered, value.manifest)).toThrow("content_prompt_binding_invalid");
  });
});
