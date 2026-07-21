import { describe, expect, it } from "vitest";
import {
  parseCreateSubjectAnalysisInput,
  parseCreateSubjectPipelineInput,
  parseReanalyzeSubjectAnalysisInput,
  parseSubjectAnalysisInputV2,
  parseSubjectAnalysisResultV2,
  parseSubjectAppealInputV2,
  parseSubjectAppealResultV2,
  parseSubjectAnalysisInput,
  parseSubjectAnalysisResult,
  parseSubjectAnalysisSelectionInput,
  parseSubjectWorkerClaimInput,
  parseSubjectWorkerLeaseInput,
} from "./aiContentSubjectContracts.js";

const generationId = "22222222-2222-4222-8222-222222222222";
const attachmentId = "33333333-3333-4333-8333-333333333333";

function validPipelineInput() {
  return {
    generationId,
    subjectType: "product" as const,
    sourceUrl: null,
    attachmentIds: [attachmentId],
    manualInput: { name: "Product", promotionOrTerms: "", description: "" },
    idempotencyKey: "subject-pipeline-1",
  };
}

function validAnalysisResultV2() {
  return {
    contractVersion: "subject-analysis-result.v2" as const,
    phase: "analysis" as const,
    subjectType: "product" as const,
    summary: "A source-backed product analysis.",
    verifiedFacts: [{
      claim: "The product is available in blue.",
      support: "The attached catalog lists blue as an option.",
      sourceUrl: `attachment://${attachmentId}`,
    }],
    voc: [{
      quoteSummary: "Buyers want clear sizing information.",
      context: "Public buyer discussion.",
      sourceUrl: "https://research.example.com/voc",
    }],
    alternatives: [{
      name: "Alternative A",
      strengths: ["Widely available"],
      limitations: ["Fewer colors"],
      sourceUrls: ["https://research.example.com/alternatives"],
    }],
    barriers: [{
      barrier: "Unclear fit",
      evidence: "Buyers ask for exact dimensions.",
      sourceUrls: ["https://research.example.com/barriers"],
    }],
    productProfile: { category: "Apparel", features: ["Blue color option"] },
    serviceProfile: null,
    serviceSubtype: null,
    sourceGaps: ["Long-term durability is not documented."],
  };
}

function validAppealResultV2() {
  const targets = ["target-1", "target-2", "target-3"].map((id) => target(id));
  return {
    contractVersion: "subject-appeal-result.v2" as const,
    phase: "appeal" as const,
    targets,
    appealsByTarget: Object.fromEntries(targets.map(({ id }) => [id, [
      appeal(`${id}-appeal-1`, id),
      appeal(`${id}-appeal-2`, id),
    ]])),
  };
}

const target = (id: string) => ({
  id,
  name: `Target ${id}`,
  traits: ["Plans purchases carefully"],
  painPoints: ["Needs reliable product information"],
  purchaseMotivations: ["Evidence-backed value"],
  uspEvidence: [{
    claim: "Documented benefit",
    support: "The source page documents the benefit.",
    sourceUrl: "https://shop.example.com/product",
  }],
});

const appeal = (id: string, targetId: string) => ({
  id,
  targetId,
  title: `Appeal ${id}`,
  description: "Connect the documented product benefit to this target.",
  evidenceType: "public_research" as const,
  connectionReason: "The research directly describes this target's need.",
  sources: [{ title: "Public research", url: "https://research.example.com/report" }],
});

function validResult() {
  return {
    contractVersion: "subject-analysis-result.v1",
    summary: "A source-backed subject analysis.",
    needs: [{ text: "Clear proof before purchase", sourceUrl: "https://research.example.com/needs" }],
    alternatives: [{
      name: "Alternative A",
      strengths: ["Well known"],
      limitations: ["Higher cost"],
      sourceUrls: ["https://research.example.com/alternatives"],
    }],
    voc: [{
      quoteSummary: "Buyers want clearer proof.",
      context: "A public discussion of purchase criteria.",
      sourceUrl: "https://research.example.com/voc",
    }],
    usps: [{
      claim: "Documented benefit",
      support: "The product page provides supporting details.",
      sourceUrl: "https://shop.example.com/product",
    }],
    targets: [target("target-1"), target("target-2"), target("target-3")],
    appealsByTarget: {
      "target-1": [appeal("appeal-1", "target-1")],
      "target-2": [appeal("appeal-2", "target-2")],
      "target-3": [appeal("appeal-3", "target-3")],
    },
    recommendedImageId: "image-1",
    sourceGaps: ["No long-term outcome data was found."],
  };
}

function validWorkerInput() {
  return {
    contractVersion: "subject-analysis.v1",
    brand: { name: "Brand", primaryCategory: "Retail", subcategories: [], brandColor: "#000000" },
    subject: {
      type: "product",
      sourceUrl: "https://shop.example.com/product",
      manualInput: { name: "Product", promotion: "", description: "Description" },
    },
    extracted: { facts: [], structuredData: {}, imageCandidates: [] as unknown[] },
    researchPolicy: {
      publicWebSearch: true,
      allowedPurposes: ["voc", "alternatives", "market_context"],
      requireSourceUrl: true,
    },
  };
}

describe("subject-analysis customer inputs", () => {
  it("accepts a generation-scoped product pipeline with optional URL and attachments", () => {
    expect(parseCreateSubjectPipelineInput({
      generationId,
      subjectType: "product",
      sourceUrl: null,
      attachmentIds: [attachmentId],
      manualInput: { name: "Product", promotionOrTerms: "", description: "" },
      idempotencyKey: "subject-pipeline-1",
    })).toMatchObject({ subjectType: "product", sourceUrl: null });
  });

  it("rejects a v2 pipeline without URL, attachments, name, or description", () => {
    expect(() => parseCreateSubjectPipelineInput({
      generationId,
      subjectType: "service",
      sourceUrl: null,
      attachmentIds: [],
      manualInput: { name: "", promotionOrTerms: "", description: "" },
      idempotencyKey: "subject-pipeline-empty",
    })).toThrow("subject_analysis_evidence_required");
  });

  it("requires strict, unique UUID attachment inputs for v2", () => {
    expect(() => parseCreateSubjectPipelineInput({ ...validPipelineInput(), unknown: true }))
      .toThrow("subject_analysis_pipeline_input_invalid");
    expect(() => parseCreateSubjectPipelineInput({
      ...validPipelineInput(),
      attachmentIds: [attachmentId, attachmentId],
    })).toThrow("subject_analysis_attachment_ids_invalid");
    expect(() => parseCreateSubjectPipelineInput({
      ...validPipelineInput(),
      attachmentIds: ["not-a-uuid"],
    })).toThrow("subject_analysis_attachment_ids_invalid");
    expect(() => parseCreateSubjectPipelineInput({
      ...validPipelineInput(),
      sourceUrl: "http://example.com/product",
    })).toThrow("subject_analysis_source_url_invalid");
  });

  it("normalizes manual input and defaults force to false", () => {
    expect(parseCreateSubjectAnalysisInput({
      subjectType: "service",
      sourceUrl: "  https://example.com/service#price  ",
      manualInput: { name: "  Managed publishing  ", description: "  Approval before publishing  " },
      idempotencyKey: "  subject-1  ",
    })).toEqual({
      subjectType: "service",
      sourceUrl: "https://example.com/service#price",
      manualInput: { name: "Managed publishing", promotion: "", description: "Approval before publishing" },
      idempotencyKey: "subject-1",
      force: false,
    });
  });

  it("rejects non-HTTPS source URLs and invalid customer fields", () => {
    const base = {
      subjectType: "product",
      sourceUrl: "https://example.com/product",
      manualInput: { name: "Product", promotion: "", description: "Description" },
      idempotencyKey: "subject-1",
    };
    expect(() => parseCreateSubjectAnalysisInput({ ...base, sourceUrl: "http://example.com" }))
      .toThrow("subject_analysis_source_url_invalid");
    expect(() => parseCreateSubjectAnalysisInput({ ...base, subjectType: "other" }))
      .toThrow("subject_analysis_subject_type_invalid");
    expect(() => parseCreateSubjectAnalysisInput({ ...base, idempotencyKey: " " }))
      .toThrow("subject_analysis_idempotency_key_invalid");
  });

  it("rejects unknown customer and manual input keys", () => {
    const base = {
      subjectType: "product",
      sourceUrl: "https://example.com/product",
      manualInput: { name: "Product", promotion: "", description: "Description" },
      idempotencyKey: "subject-1",
    };
    expect(() => parseCreateSubjectAnalysisInput({ ...base, unknown: true }))
      .toThrow("subject_analysis_input_invalid");
    expect(() => parseCreateSubjectAnalysisInput({ ...base, manualInput: { ...base.manualInput, unknown: true } }))
      .toThrow("subject_analysis_manual_input_invalid");
    expect(() => parseSubjectAnalysisSelectionInput({ imageId: "image-1", unknown: true }))
      .toThrow("subject_analysis_selection_invalid");
  });

  it("parses selection, reanalysis, claim, and lease inputs", () => {
    expect(parseSubjectAnalysisSelectionInput({ imageId: " image-1 " })).toEqual({ imageId: "image-1" });
    expect(parseReanalyzeSubjectAnalysisInput({ idempotencyKey: " retry-1 " })).toEqual({ idempotencyKey: "retry-1" });
    expect(parseSubjectWorkerClaimInput({ workerId: " worker-1 " })).toEqual({ workerId: "worker-1", leaseSeconds: 180 });
    expect(parseSubjectWorkerLeaseInput({ workerId: " worker-1 ", leaseToken: " lease-1 ", leaseSeconds: 60 }))
      .toEqual({ workerId: "worker-1", leaseToken: "lease-1", leaseSeconds: 60 });
    expect(() => parseSubjectWorkerLeaseInput({ workerId: "worker-1", leaseToken: "lease-1", leaseSeconds: 10 }))
      .toThrow("subject_analysis_lease_seconds_invalid");
  });
});

describe("subject-analysis.v2 worker contracts", () => {
  const sourcePriority = ["manual_input", "attachments", "source_url", "brand_context", "public_research"] as const;
  const analysisInput = () => ({
    contractVersion: "subject-analysis.v2",
    phase: "analysis",
    brandContext: { brand: { name: "Example Brand" }, audiences: [{ name: "Careful buyers" }] },
    subject: {
      type: "product",
      sourceUrl: null,
      attachmentIds: [attachmentId],
      manualInput: { name: "Product", promotionOrTerms: "", description: "Description" },
    },
    extracted: {
      documents: [{ attachmentId, fileName: "catalog.pdf", mimeType: "application/pdf", text: "Catalog text" }],
      images: [{ attachmentId, sourceUrl: `attachment://${attachmentId}`, storageUrl: "https://blob.example.com/product.png", mimeType: "image/png", altText: "Product" }],
      sourcePage: null,
      sourceGaps: [],
    },
    sourcePriority: [...sourcePriority],
  });

  it("strictly parses analysis and appeal phase inputs", () => {
    expect(parseSubjectAnalysisInputV2(analysisInput())).toMatchObject({
      contractVersion: "subject-analysis.v2",
      phase: "analysis",
      subject: { attachmentIds: [attachmentId] },
    });
    expect(parseSubjectAppealInputV2({
      contractVersion: "subject-analysis.v2",
      phase: "appeal",
      brandContext: analysisInput().brandContext,
      subject: analysisInput().subject,
      analysisResult: validAnalysisResultV2(),
      sourcePriority: [...sourcePriority],
    })).toMatchObject({ phase: "appeal", analysisResult: { subjectType: "product" } });
    expect(() => parseSubjectAnalysisInputV2({ ...analysisInput(), unknown: true }))
      .toThrow("subject_analysis_input_v2_invalid");
  });

  it("requires the matching product or service analysis profile", () => {
    expect(parseSubjectAnalysisResultV2(validAnalysisResultV2())).toMatchObject({
      subjectType: "product",
      productProfile: { category: "Apparel" },
    });
    expect(() => parseSubjectAnalysisResultV2({
      ...validAnalysisResultV2(),
      subjectType: "service",
      productProfile: null,
      serviceProfile: { deliveryModel: "Advisory" },
      serviceSubtype: "not-a-subtype",
    })).toThrow("subject_analysis_service_subtype_invalid");
  });

  it("requires exactly three targets and at least two appeals per target", () => {
    expect(parseSubjectAppealResultV2(validAppealResultV2()).targets).toHaveLength(3);
    const result = validAppealResultV2();
    result.appealsByTarget["target-1"] = [appeal("only-one", "target-1")];
    expect(() => parseSubjectAppealResultV2(result)).toThrow("subject_analysis_appeals_minimum_invalid");
  });

  it("rejects v2 analysis and appeal results over the aggregate payload budget", () => {
    expect(() => parseSubjectAnalysisResultV2({
      ...validAnalysisResultV2(),
      sourceGaps: Array.from({ length: 50 }, () => "x".repeat(2_000)),
    })).toThrow("subject_analysis_v2_payload_limit_exceeded");

    const appealResult = validAppealResultV2();
    appealResult.targets = appealResult.targets.map((entry) => ({
      ...entry,
      traits: Array.from({ length: 50 }, () => "x".repeat(1_000)),
    }));
    expect(() => parseSubjectAppealResultV2(appealResult))
      .toThrow("subject_analysis_v2_payload_limit_exceeded");
  });
});

describe("subject-analysis.v1 worker input", () => {
  it("parses and normalizes the versioned worker input", () => {
    expect(parseSubjectAnalysisInput({
      contractVersion: "subject-analysis.v1",
      brand: {
        name: " Example Brand ",
        primaryCategory: " Retail ",
        subcategories: [" Apparel "],
        brandColor: " #0057B8 ",
      },
      subject: {
        type: "product",
        sourceUrl: "https://shop.example.com/product",
        manualInput: { name: " Product ", promotion: " Summer sale ", description: " Description " },
      },
      extracted: {
        facts: [{ key: " price ", value: " $20 ", sourceUrl: "https://shop.example.com/product" }],
        structuredData: { "@type": "Product" },
        imageCandidates: [{
          id: "image-1",
          sourceUrl: "https://shop.example.com/product.png",
          storageUrl: "https://blob.example.com/product.png",
          width: 1200,
          height: 1200,
          mimeType: "image/png",
          altText: " Product image ",
          role: "product",
        }],
      },
      researchPolicy: {
        publicWebSearch: true,
        allowedPurposes: ["voc", "alternatives", "market_context"],
        requireSourceUrl: true,
      },
    })).toMatchObject({
      brand: { name: "Example Brand", subcategories: ["Apparel"], brandColor: "#0057B8" },
      subject: { manualInput: { name: "Product", promotion: "Summer sale", description: "Description" } },
      extracted: { facts: [{ key: "price", value: "$20", sourceUrl: "https://shop.example.com/product" }] },
    });
  });

  it("rejects an altered research policy", () => {
    const input = {
      contractVersion: "subject-analysis.v1",
      brand: { name: "Brand", primaryCategory: "Retail", subcategories: [], brandColor: "#000000" },
      subject: {
        type: "service",
        sourceUrl: "https://example.com/service",
        manualInput: { name: "Service", promotion: "", description: "Description" },
      },
      extracted: { facts: [], structuredData: {}, imageCandidates: [] },
      researchPolicy: {
        publicWebSearch: false,
        allowedPurposes: ["voc", "alternatives", "market_context"],
        requireSourceUrl: true,
      },
    };
    expect(() => parseSubjectAnalysisInput(input)).toThrow("subject_analysis_research_policy_invalid");
  });

  it("rejects unknown keys in nested worker contract objects", () => {
    const input = validWorkerInput();
    input.subject.manualInput = { ...input.subject.manualInput, unknown: true } as typeof input.subject.manualInput;
    expect(() => parseSubjectAnalysisInput(input)).toThrow("subject_analysis_manual_input_invalid");
  });

  it("recursively bounds structured data depth, arrays, and strings", () => {
    let tooDeep: unknown = "leaf";
    for (let index = 0; index < 7; index += 1) tooDeep = { nested: tooDeep };

    const deepInput = validWorkerInput();
    deepInput.extracted.structuredData = tooDeep as Record<string, unknown>;
    expect(() => parseSubjectAnalysisInput(deepInput)).toThrow("subject_analysis_structured_data_limit_exceeded");

    const arrayInput = validWorkerInput();
    arrayInput.extracted.structuredData = { values: Array.from({ length: 101 }, (_, index) => index) };
    expect(() => parseSubjectAnalysisInput(arrayInput)).toThrow("subject_analysis_structured_data_limit_exceeded");

    const stringInput = validWorkerInput();
    stringInput.extracted.structuredData = { value: "x".repeat(10_001) };
    expect(() => parseSubjectAnalysisInput(stringInput)).toThrow("subject_analysis_structured_data_limit_exceeded");
  });

  it("rejects non-JSON structured data values", () => {
    const input = validWorkerInput();
    input.extracted.structuredData = { missing: undefined };
    expect(() => parseSubjectAnalysisInput(input)).toThrow("subject_analysis_structured_data_invalid");
  });

  it("rejects prototype-polluting structured data keys", () => {
    for (const key of ["__proto__", "prototype", "constructor"]) {
      const input = validWorkerInput();
      input.extracted.structuredData = Object.fromEntries([[key, { polluted: true }]]);
      expect(() => parseSubjectAnalysisInput(input)).toThrow("subject_analysis_structured_data_invalid");
    }
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("enforces shared node, key, and character budgets", () => {
    const nodeInput = validWorkerInput();
    nodeInput.extracted.structuredData = {
      groups: Array.from({ length: 20 }, () => Array.from({ length: 100 }, () => null)),
    };
    expect(() => parseSubjectAnalysisInput(nodeInput)).toThrow("subject_analysis_structured_data_limit_exceeded");

    const keyInput = validWorkerInput();
    keyInput.extracted.structuredData = { ["k".repeat(201)]: "value" };
    expect(() => parseSubjectAnalysisInput(keyInput)).toThrow("subject_analysis_structured_data_limit_exceeded");

    const characterInput = validWorkerInput();
    characterInput.extracted.structuredData = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`key-${index}`, "x".repeat(1_001)]),
    );
    expect(() => parseSubjectAnalysisInput(characterInput)).toThrow("subject_analysis_structured_data_limit_exceeded");
  });

  it("rejects enum-like image roles with custom string coercion", () => {
    const input = validWorkerInput();
    input.extracted.imageCandidates = [{
      id: "image-1",
      sourceUrl: "https://shop.example.com/product.png",
      storageUrl: "https://blob.example.com/product.png",
      width: 100,
      height: 100,
      mimeType: "image/png",
      altText: "Product",
      role: { toString: () => "product" } as unknown as "product",
    }];
    expect(() => parseSubjectAnalysisInput(input)).toThrow("subject_analysis_image_invalid");
  });
});

describe("subject-analysis-result.v1 worker output", () => {
  it("returns a strict, normalized result with exactly three unique targets", () => {
    const parsed = parseSubjectAnalysisResult(validResult());
    expect(parsed.contractVersion).toBe("subject-analysis-result.v1");
    expect(parsed.targets.map(({ id }) => id)).toEqual(["target-1", "target-2", "target-3"]);
    expect(parsed.recommendedImageId).toBe("image-1");
  });

  it("allows a null recommended image", () => {
    expect(parseSubjectAnalysisResult({ ...validResult(), recommendedImageId: null }).recommendedImageId).toBeNull();
  });

  it("rejects malformed or duplicate target and appeal identifiers", () => {
    expect(() => parseSubjectAnalysisResult({ ...validResult(), targets: [target("one")] }))
      .toThrow("subject_analysis_targets_invalid");

    const duplicateTargets = validResult();
    duplicateTargets.targets[2] = target("target-1");
    expect(() => parseSubjectAnalysisResult(duplicateTargets)).toThrow("subject_analysis_target_id_duplicate");

    const unknownTarget = validResult();
    (unknownTarget.appealsByTarget as Record<string, ReturnType<typeof appeal>[]>).unknown = [appeal("appeal-x", "unknown")];
    expect(() => parseSubjectAnalysisResult(unknownTarget)).toThrow("subject_analysis_appeals_target_invalid");

    const duplicateAppeals = validResult();
    duplicateAppeals.appealsByTarget["target-2"] = [appeal("appeal-1", "target-2")];
    expect(() => parseSubjectAnalysisResult(duplicateAppeals)).toThrow("subject_analysis_appeal_id_duplicate");
  });

  it("requires HTTPS URLs for public research", () => {
    const result = validResult();
    result.needs[0].sourceUrl = "http://research.example.com/needs";
    expect(() => parseSubjectAnalysisResult(result)).toThrow("subject_analysis_source_url_invalid");

    const appealResult = validResult();
    appealResult.appealsByTarget["target-1"][0].sources = [];
    expect(() => parseSubjectAnalysisResult(appealResult)).toThrow("subject_analysis_appeal_sources_invalid");

    const alternativeResult = validResult();
    alternativeResult.alternatives[0].sourceUrls = [];
    expect(() => parseSubjectAnalysisResult(alternativeResult)).toThrow("subject_analysis_alternatives_invalid");
  });

  it("rejects unknown result fields and oversized arrays", () => {
    expect(() => parseSubjectAnalysisResult({ ...validResult(), invented: true }))
      .toThrow("subject_analysis_result_invalid");
    expect(() => parseSubjectAnalysisResult({ ...validResult(), sourceGaps: Array.from({ length: 51 }, () => "gap") }))
      .toThrow("subject_analysis_source_gaps_invalid");
  });

  it("rejects enum-like evidence types with custom string coercion", () => {
    const result = validResult();
    result.appealsByTarget["target-1"][0].evidenceType = {
      toString: () => "public_research",
    } as unknown as "public_research";
    expect(() => parseSubjectAnalysisResult(result)).toThrow("subject_analysis_appeal_invalid");
  });
});
