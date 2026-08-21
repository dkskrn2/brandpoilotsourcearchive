import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  parseGeneratedContentCatalog,
  type VerifiedGeneratedContentCatalog,
} from "@brand-pilot/content-contracts";
import { proposalSha256 } from "./aiContentProposalV2Service.js";
import { assembleAiContentFixedInput } from "./aiContentFixedInputAssembler.js";

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  brand: "10000000-0000-4000-8000-000000000002",
  actor: "10000000-0000-4000-8000-000000000003",
  generation: "10000000-0000-4000-8000-000000000004",
  batch: "10000000-0000-4000-8000-000000000005",
  proposal: "10000000-0000-4000-8000-000000000006",
  job: "10000000-0000-4000-8000-000000000007",
  contract: "10000000-0000-4000-8000-00000000000f",
  composition: "10000000-0000-4000-8000-000000000010",
  modelAttempt: "10000000-0000-4000-8000-000000000011",
  core: "10000000-0000-4000-8000-000000000008",
  rules: "10000000-0000-4000-8000-000000000009",
  evidence: "10000000-0000-4000-8000-00000000000a",
  reference: "10000000-0000-4000-8000-00000000000b",
  referenceSnapshot: "10000000-0000-4000-8000-00000000000c",
  style: "10000000-0000-4000-8000-00000000000d",
  attachment: "10000000-0000-4000-8000-00000000000e",
} as const;

const NOW = "2026-08-06T00:00:00Z";
const HASH = "a".repeat(64);
let catalog: VerifiedGeneratedContentCatalog;
let catalogSha256: string;

beforeAll(async () => {
  const catalogPath = fileURLToPath(import.meta.resolve("@brand-pilot/content-contracts/generated/content-catalog.json"));
  const bytes = readFileSync(catalogPath);
  const raw = JSON.parse(bytes.toString("utf8"));
  const generatedDirectory = dirname(catalogPath);
  const schemaArtifacts = Object.fromEntries(
    readdirSync(generatedDirectory)
      .filter((filename) => filename.endsWith(".schema.json"))
      .map((filename) => [filename, readFileSync(join(generatedDirectory, filename), "utf8")]),
  );
  catalog = await parseGeneratedContentCatalog(raw, {
    contractSourceHash: raw.contractSourceHash,
    schemaArtifacts,
  });
  catalogSha256 = createHash("sha256").update(bytes).digest("hex");
});

function proposal() {
  return {
    conceptKey: "tea-guide",
    title: "차를 고르는 법",
    informationalType: "how_to",
    oneLineIntent: "좋은 차를 고르게 돕는다",
    differentiator: "근거 중심",
    differentiationAxes: ["question"],
    target: "차 입문자",
    customerContext: "선택 기준이 필요함",
    keyMessage: "향과 산지를 확인한다",
    hook: "차 포장지에서 먼저 볼 것",
    selectionReason: "실용적",
    evidenceIds: [ids.evidence],
    referenceIds: [ids.reference],
    outputFormat: "card_news",
    channelTargets: ["instagram"],
    assetCount: 1,
    outline: [{ index: 1, role: "slide", headline: "확인법", purpose: "기준 설명" }],
    purposeDetails: {
      kind: "informational",
      question: "무엇을 확인하나",
      value: "선택 실패를 줄인다",
      whyNow: "선택지가 많다",
      learningPoints: ["산지 확인"],
    },
  };
}

function referenceSnapshot() {
  return {
    referenceItemId: ids.reference,
    snapshotId: ids.referenceSnapshot,
    roles: ["planning"],
    title: "차 참고 자료",
    sourceUrl: "https://example.com/reference",
    capturedAt: NOW,
    contentHash: HASH,
    text: "차를 고르는 기준",
    image: null,
  };
}

function evidenceSnapshot() {
  return {
    contractVersion: "research-evidence.v1",
    decision: "searched",
    reason: "사실 확인",
    queries: ["차 고르는 법"],
    capturedAt: NOW,
    items: [{
      id: ids.evidence,
      title: "차 근거",
      url: "https://example.com/evidence",
      publisher: null,
      publishedAt: null,
      capturedAt: NOW,
      claimSummary: "산지와 향을 확인한다",
      contentHash: HASH,
    }],
  };
}

function baseInput() {
  return {
    contractVersion: "proposal-base-input.v2",
    brandCore: {
      versionId: ids.core,
      companyOverview: "차 회사",
      businessDescription: "차 판매",
      primaryCategory: "식품",
      detailedCategory: "차",
      primaryTarget: "입문자",
      differentiator: "산지 공개",
      coreAppeal: "신뢰",
    },
    subject: { kind: "topic_text", title: "차 고르는 법" },
    contentInstruction: "쉽게 설명",
    product: null,
    references: [referenceSnapshot()],
    outputSettings: {
      outputFormat: "card_news",
      channelTargets: ["instagram"],
      aspectRatio: "1:1",
      outputCount: 1,
      purpose: "informational",
    },
    capturedAt: NOW,
  };
}

function brandRulesContent() {
  return {
    contractVersion: "brand-rules.v1",
    requiredPhrases: ["정확한 정보"],
    forbiddenPhrases: ["무조건"],
    exaggerationRules: ["검증되지 않은 최상급 금지"],
    ctaRules: { defaultCta: "더 알아보기", allowed: ["더 알아보기"] },
    channelRules: { instagram: ["짧은 문장"] },
    designRules: {
      colors: ["#ffffff"],
      fonts: ["Pretendard"],
      notes: ["충분한 여백"],
      referenceImages: [{ referenceItemId: ids.style, description: "밝은 스타일", tags: ["clean"] }],
    },
    autoApprovalRules: { enabled: false, conditions: [] },
  };
}

function source() {
  const request = {
    contractVersion: "content-proposal-request.v2",
    purpose: "informational",
    outputFormat: "card_news",
    channelTargets: ["instagram"],
    requestFingerprint: "b".repeat(64),
  };
  const base = baseInput();
  const composed = {
    ...base,
    contractVersion: "proposal-input.v2",
    researchEvidence: evidenceSnapshot(),
  };
  const commandDescriptorSha256 = proposalSha256({
    runner: "codex-exec",
    model: "gpt-5.6-terra",
    promptVersion: catalog.proposalContracts.promptVersion,
    outputSchemaSha256: catalog.proposalContracts.outputSchemaSha256,
    requestContractVersion: catalog.proposalContracts.requestVersion,
    baseInputContractVersion: catalog.proposalContracts.baseInputVersion,
    researchContractVersion: catalog.researchEvidence.version,
    proposalContractVersion: catalog.proposalContracts.outputVersion,
  });
  const enqueueContractSha256 = proposalSha256({
    jobId: ids.job,
    batchId: ids.batch,
    workspaceId: ids.workspace,
    brandId: ids.brand,
    requestSha256: proposalSha256(request),
    baseInputSha256: proposalSha256(base),
    commandDescriptorSha256,
    contractSourceSha256: catalog.contractSourceHash,
    catalogSha256,
  });
  const evidenceSetSha256 = proposalSha256([evidenceSnapshot()]);
  const composedInputSha256 = proposalSha256(composed);
  const finalInvocationAggregateSha256 = proposalSha256({
    enqueueContractSha256,
    modelId: "gpt-5.6-terra",
    commandDescriptorSha256,
    proposalOutputSchemaSha256: catalog.proposalContracts.outputSchemaSha256,
    evidenceSetSha256,
    composedInputSha256,
  });
  const modelSha256 = proposalSha256({ modelId: "gpt-5.6-terra" });
  return {
    catalog,
    catalogSha256,
    startedAt: NOW,
    scope: { workspaceId: ids.workspace, brandId: ids.brand, actorUserId: ids.actor },
    draft: {
      workspaceId: ids.workspace,
      brandId: ids.brand,
      generationId: ids.generation,
      status: "draft",
      deletedAt: null,
      origin: "proposal-v2",
      proposalBatchId: ids.batch,
      proposalId: ids.proposal,
      outputFormat: "card_news",
      purpose: "informational",
      userImageInstruction: "밝은 배경",
      brandStyleImageIds: [ids.style],
      avatarStyleImageId: ids.style,
      attachmentIds: [ids.attachment],
    },
    batch: {
      id: ids.batch,
      workspaceId: ids.workspace,
      brandId: ids.brand,
      status: "ready",
      deletedAt: null,
      baseInput: base,
    },
    selection: {
      id: ids.proposal,
      batchId: ids.batch,
      workspaceId: ids.workspace,
      brandId: ids.brand,
      generationId: ids.generation,
      status: "selected",
      deletedAt: null,
      proposal: proposal(),
      successfulModelAttemptId: ids.modelAttempt,
      successfulProposalJobId: ids.job,
      finalInvocationOrdinal: 1,
    },
    proposalJob: {
      id: ids.job,
      contractId: ids.contract,
      batchId: ids.batch,
      workspaceId: ids.workspace,
      brandId: ids.brand,
      status: "completed",
      request,
      requestContractVersion: catalog.proposalContracts.requestVersion,
      baseInputContractVersion: catalog.proposalContracts.baseInputVersion,
      researchContractVersion: catalog.researchEvidence.version,
      proposalContractVersion: catalog.proposalContracts.outputVersion,
      proposalPromptVersion: catalog.proposalContracts.promptVersion,
      proposalOutputSchemaSha256: catalog.proposalContracts.outputSchemaSha256,
      proposalModelId: "gpt-5.6-terra",
      commandDescriptorSha256,
      requestSha256: proposalSha256(request),
      baseInputSha256: proposalSha256(base),
      contractSourceSha256: catalog.contractSourceHash,
      catalogSha256,
      enqueueContractSha256,
    },
    composition: {
      id: ids.composition,
      jobId: ids.job,
      contractId: ids.contract,
      batchId: ids.batch,
      workspaceId: ids.workspace,
      brandId: ids.brand,
      composedInput: composed,
      researchEvidenceSetSha256: evidenceSetSha256,
      researchEvidenceSetHashMatches: true,
      composedInputSha256,
      composedInputHashMatches: true,
      finalInvocationAggregateSha256,
    },
    successfulAttempt: {
      id: ids.modelAttempt,
      jobId: ids.job,
      contractId: ids.contract,
      compositionId: ids.composition,
      workspaceId: ids.workspace,
      brandId: ids.brand,
      aggregateContractSha256: finalInvocationAggregateSha256,
      modelId: "gpt-5.6-terra",
      modelSha256,
      commandDescriptorSha256,
      proposalOutputSchemaSha256: catalog.proposalContracts.outputSchemaSha256,
      composedInputSha256,
    },
    successEvent: {
      modelAttemptId: ids.modelAttempt,
      jobId: ids.job,
      workspaceId: ids.workspace,
      brandId: ids.brand,
      eventType: "attempt_succeeded",
      invocationOrdinal: 1,
      aggregateContractSha256: finalInvocationAggregateSha256,
      modelSha256,
      commandDescriptorSha256,
      proposalOutputSchemaSha256: catalog.proposalContracts.outputSchemaSha256,
      composedInputSha256,
      outputSha256: "1".repeat(64),
      parserSha256: "2".repeat(64),
      parserValid: true,
    },
    brandContextAuthority: null,
    onboardingContent: null,
    approvedBrandCore: {
      workspaceId: ids.workspace,
      brandId: ids.brand,
      status: "approved",
      deletedAt: null,
      snapshot: base.brandCore,
    },
    approvedBrandRules: {
      workspaceId: ids.workspace,
      brandId: ids.brand,
      versionId: ids.rules,
      version: 1,
      status: "approved",
      deletedAt: null,
      content: brandRulesContent(),
      contentSha256: proposalSha256(brandRulesContent()),
    },
    approvedProduct: null,
    evidence: [{
      workspaceId: ids.workspace,
      brandId: ids.brand,
      proposalBatchId: ids.batch,
      status: "frozen",
      deletedAt: null,
      snapshot: evidenceSnapshot().items[0],
    }],
    references: [{
      workspaceId: ids.workspace,
      brandId: ids.brand,
      proposalBatchId: ids.batch,
      status: "approved",
      deletedAt: null,
      snapshot: referenceSnapshot(),
    }],
    brandStyleImages: [{
      workspaceId: ids.workspace,
      brandId: ids.brand,
      ruleSetVersionId: ids.rules,
      status: "approved",
      deletedAt: null,
      snapshot: {
        referenceItemId: ids.style,
        description: "밝은 스타일",
        tags: ["clean"],
        storageUrl: "https://example.com/style.png",
        storagePath: "style/style.png",
        mimeType: "image/png",
        checksum: "d".repeat(64),
      },
    }],
    attachments: [{
      workspaceId: ids.workspace,
      brandId: ids.brand,
      generationId: ids.generation,
      status: "finalized",
      deletedAt: null,
      snapshot: {
        id: ids.attachment,
        role: "supporting_image",
        fileName: "tea.png",
        mimeType: "image/png",
        sizeBytes: 100,
        checksum: "e".repeat(64),
        storageUrl: "https://example.com/tea.png",
        storagePath: "attachments/tea.png",
      },
    }],
  };
}

describe("assembleAiContentFixedInput", () => {
  it("accepts provisional Core and Rules only when they match the owning onboarding snapshot", () => {
    const value: any = source();
    const authority = {
      kind: "onboarding_provisional",
      analysisId: ids.core,
      ownedUrl: "https://brand.example/",
      categoryCode: "food",
      subcategoryCodes: ["tea"],
      suggestionId: ids.rules,
      sourceUrls: ["https://example.com/evidence"],
      brandRules: {
        versionId: ids.rules,
        version: 1,
        content: brandRulesContent(),
        contentSha256: proposalSha256(brandRulesContent()),
      },
    };
    value.brandContextAuthority = authority;
    value.onboardingContent = {
      categoryCode: "food",
      subcategoryCodes: ["tea"],
      suggestion: {
        id: ids.rules,
        subcategoryCode: "tea",
        subcategoryName: "차",
        intent: "trend",
        title: "차 고르는 법",
        whyNow: "선택지가 많습니다.",
        contentBrief: "선택 기준을 설명합니다.",
        sources: [{
          url: "https://example.com/evidence",
          title: "차 근거",
          publisher: "Example",
          publishedAt: null,
        }],
      },
      contentInstruction: "쉽게 설명",
      requestFingerprint: "a".repeat(64),
      proposalBatchId: ids.batch,
      generationId: ids.generation,
      requestedAt: NOW,
    };
    value.approvedBrandCore.status = "provisional";
    value.approvedBrandRules.status = "provisional";

    expect(assembleAiContentFixedInput(value).input.brandRules)
      .toEqual(authority.brandRules);

    value.onboardingContent.suggestion.id = ids.evidence;
    expect(() => assembleAiContentFixedInput(value))
      .toThrow("fixed_input_onboarding_authority_mismatch");
  });

  it("assembles canonical V3 and a catalog-owned prompt binding from locked immutable sources", () => {
    const result = assembleAiContentFixedInput(source() as never);

    expect(JSON.parse(result.canonicalJson)).toEqual(result.input);
    expect(result.contentHash).toBe(proposalSha256(result.input));
    expect(result.input.references.attachments[0]?.id).toBe(ids.attachment);
    expect(result.input.brandRules).toEqual({
      versionId: ids.rules,
      version: 1,
      content: brandRulesContent(),
      contentSha256: proposalSha256(brandRulesContent()),
    });
    expect(result.binding).toMatchObject({
      outputFormat: "card_news",
      purpose: "informational",
      proposalSchemaSha256: catalog.schemas.contentProposalV2.sha256,
      generationSchemaSha256: catalog.schemas.contentGenerationInputV3.sha256,
      planSchemaSha256: catalog.schemas.plans.card_news.sha256,
      contractSourceHash: catalog.contractSourceHash,
      model: "gpt-5.6-terra",
    });
    expect(result.provenance).toEqual({
      selectedProposalId: ids.proposal,
      proposalJobId: ids.job,
      proposalContractId: ids.contract,
      successfulModelAttemptId: ids.modelAttempt,
      finalInvocationOrdinal: 1,
    });
  });

  it.each([
    ["cross-scope proposal", (value: any) => { value.selection.brandId = "20000000-0000-4000-8000-000000000001"; }],
    ["stale batch", (value: any) => { value.batch.status = "superseded"; }],
    ["purpose mismatch", (value: any) => { value.draft.purpose = "marketing"; }],
    ["format mismatch", (value: any) => { value.selection.proposal.outputFormat = "blog"; }],
    ["evidence mismatch", (value: any) => { value.evidence[0].snapshot.id = "20000000-0000-4000-8000-000000000002"; }],
    ["reference mismatch", (value: any) => { value.references[0].snapshot.snapshotId = "20000000-0000-4000-8000-000000000003"; }],
    ["attachment mismatch", (value: any) => { value.attachments[0].status = "uploaded"; }],
    ["proposal contract mismatch", (value: any) => { value.proposalJob.proposalPromptVersion = "proposal.writer.v1"; }],
    ["research evidence DB hash mismatch", (value: any) => { value.composition.researchEvidenceSetHashMatches = false; }],
    ["composed input DB hash mismatch", (value: any) => { value.composition.composedInputHashMatches = false; }],
    ["composed hash mismatch", (value: any) => { value.composition.composedInputSha256 = "f".repeat(64); }],
    ["brand rules content mutation", (value: any) => { value.approvedBrandRules.content.requiredPhrases[0] = "부정확한 정보"; }],
    ["brand rules hash mutation", (value: any) => { value.approvedBrandRules.contentSha256 = "f".repeat(64); }],
    ["unapproved brand rules", (value: any) => { value.approvedBrandRules.status = "draft"; }],
    ["style image from another rule set", (value: any) => { value.brandStyleImages[0].ruleSetVersionId = "20000000-0000-4000-8000-000000000004"; }],
    ["missing selected lineage", (value: any) => { value.selection.successfulModelAttemptId = null; }],
    ["job contract lineage mismatch", (value: any) => { value.successfulAttempt.contractId = "20000000-0000-4000-8000-000000000005"; }],
    ["successful ordinal mismatch", (value: any) => { value.successEvent.invocationOrdinal = 2; }],
    ["command descriptor mismatch", (value: any) => { value.proposalJob.commandDescriptorSha256 = "3".repeat(64); }],
    ["enqueue contract mismatch", (value: any) => { value.proposalJob.enqueueContractSha256 = "4".repeat(64); }],
    ["aggregate contract mismatch", (value: any) => { value.composition.finalInvocationAggregateSha256 = "5".repeat(64); }],
    ["avatar outside selected styles", (value: any) => { value.draft.avatarStyleImageId = "20000000-0000-4000-8000-000000000006"; }],
  ])("rejects %s", (_label, mutate) => {
    const value = source();
    mutate(value);
    expect(() => assembleAiContentFixedInput(value as never)).toThrow();
  });

  it("rejects missing format and legacy aliases instead of defaulting to blog", () => {
    const value: any = source();
    delete value.draft.outputFormat;
    value.draft.format = "blog";

    expect(() => assembleAiContentFixedInput(value)).toThrow("fixed_input_source_invalid");
  });
});
