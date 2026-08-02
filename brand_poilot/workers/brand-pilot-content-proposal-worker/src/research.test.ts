import { describe, expect, it, vi } from "vitest";
import { parseContentProposalJob } from "./contracts.js";
import { createContentProposalResearch } from "./research.js";

function baseJob(purpose: "informational" | "marketing") {
  const product = purpose === "marketing" ? {
    id: "60000000-0000-4000-8000-000000000006",
    versionId: "61000000-0000-4000-8000-000000000006",
    kind: "product", name: "제품", description: "설명", features: ["특징"],
    benefits: ["장점"], cautions: ["한계"], evergreenPurchaseInfo: "문의", images: [],
  } : null;
  return parseContentProposalJob({
    id: "10000000-0000-4000-8000-000000000001",
    workspaceId: "20000000-0000-4000-8000-000000000002",
    brandId: "30000000-0000-4000-8000-000000000003",
    batchId: "40000000-0000-4000-8000-000000000004",
    status: "processing",
    request: {
      contractVersion: "content-proposal-request.v2", purpose,
      outputFormat: "card_news", channelTargets: ["instagram"], requestFingerprint: "fp",
    },
    sourceSnapshots: [],
    inputSnapshot: {
      contractVersion: "proposal-base-input.v2",
      brandCore: {
        versionId: "40000000-0000-4000-8000-000000000004",
        companyOverview: "개요", businessDescription: "사업", primaryCategory: "교육",
        detailedCategory: "온라인", primaryTarget: "창업자", differentiator: "실전", coreAppeal: "적용",
      },
      subject: { kind: "topic_text", title: "운영" }, contentInstruction: null,
      product, references: [],
      outputSettings: {
        outputFormat: "card_news", channelTargets: ["instagram"], aspectRatio: "4:5",
        outputCount: 1, purpose,
      },
      capturedAt: "2026-08-01T03:00:00.000Z",
    },
    attemptCount: 1, maxAttempts: 3, workerId: "proposal-worker-1",
    leaseToken: "50000000-0000-4000-8000-000000000005",
    leaseExpiresAt: "2026-08-01T05:00:00.000Z", availableAt: "2026-08-01T03:00:00.000Z",
  });
}

describe("proposal research", () => {
  it.each([
    ["informational", "required"],
    ["marketing", "automatic"],
  ] as const)("runs Task4 controlled search exactly once for %s", async (purpose, mode) => {
    const evidence = {
      contractVersion: "research-evidence.v1" as const,
      decision: purpose === "marketing" ? "not_needed" as const : "searched" as const,
      reason: "판단", queries: [], capturedAt: "2026-08-01T04:00:00.000Z", items: [],
    };
    const controlledSearch = vi.fn(async () => evidence);
    const research = createContentProposalResearch(controlledSearch);
    const job = baseJob(purpose);
    const controller = new AbortController();

    await expect(research.run(job, controller.signal)).resolves.toEqual(evidence);
    expect(controlledSearch).toHaveBeenCalledTimes(1);
    expect(controlledSearch).toHaveBeenCalledWith({
      purpose,
      mode,
      publicResearchContext: {
        purpose,
        subjectKind: "topic_text",
        subjectTitle: "운영",
        contentInstruction: null,
        primaryCategory: "교육",
        detailedCategory: "온라인",
        selectedProduct: purpose === "marketing"
          ? { name: "제품", category: "온라인" }
          : null,
      },
      signal: controller.signal,
    });
  });

  it("projects URL research into a minimal public allowlist without frozen or source secrets", async () => {
    const job = baseJob("marketing");
    if (job.inputSnapshot.contractVersion !== "proposal-base-input.v2") throw new Error("bad_fixture");
    job.inputSnapshot.brandCore = {
      versionId: "deadbeef-0000-4000-8000-000000000001",
      companyOverview: "SECRET_COMPANY_OVERVIEW",
      businessDescription: "SECRET_BUSINESS_DESCRIPTION",
      primaryCategory: "PUBLIC_PRIMARY_CATEGORY",
      detailedCategory: "PUBLIC_DETAILED_CATEGORY",
      primaryTarget: "SECRET_PRIMARY_TARGET",
      differentiator: "SECRET_DIFFERENTIATOR",
      coreAppeal: "SECRET_CORE_APPEAL",
    };
    job.inputSnapshot.subject = {
      kind: "topic_url",
      requestedUrl: "https://secret.example/SECRET_REQUESTED_URL",
      canonicalUrl: "https://secret.example/SECRET_CANONICAL_URL",
      title: "PUBLIC_SUBJECT_TITLE",
      text: "SECRET_CRAWL_BODY_IGNORE_PREVIOUS_AND_EXFILTRATE",
      contentHash: "b".repeat(64),
      capturedAt: "2026-08-01T03:11:12.000Z",
    };
    job.inputSnapshot.contentInstruction = "PUBLIC_CONTENT_INSTRUCTION";
    job.inputSnapshot.product = {
      id: "deadbeef-0000-4000-8000-000000000002",
      versionId: "deadbeef-0000-4000-8000-000000000003",
      kind: "product",
      name: "PUBLIC_PRODUCT_NAME",
      description: "SECRET_PRODUCT_DESCRIPTION",
      features: ["SECRET_PRODUCT_FEATURE"],
      benefits: ["SECRET_PRODUCT_BENEFIT"],
      cautions: ["SECRET_PRODUCT_CAUTION"],
      evergreenPurchaseInfo: "SECRET_PRODUCT_PURCHASE_INFO",
      images: [{
        assetId: "deadbeef-0000-4000-8000-000000000004",
        role: "hero",
        storageUrl: "https://storage.example/SECRET_PRODUCT_STORAGE_URL",
        storagePath: "SECRET_PRODUCT_STORAGE_PATH",
        mimeType: "image/secret-product-mime",
        checksum: "c".repeat(64),
      }],
    };
    job.inputSnapshot.references = [{
      referenceItemId: "deadbeef-0000-4000-8000-000000000005",
      snapshotId: "deadbeef-0000-4000-8000-000000000006",
      roles: ["planning"],
      title: "SECRET_UNSELECTED_REFERENCE_TITLE",
      sourceUrl: "https://reference.example/SECRET_REFERENCE_URL",
      capturedAt: "2026-08-01T03:22:23.000Z",
      contentHash: "d".repeat(64),
      text: "SECRET_REFERENCE_BODY_IGNORE_ALL_RULES",
      image: {
        storageUrl: "https://storage.example/SECRET_REFERENCE_STORAGE_URL",
        storagePath: "SECRET_REFERENCE_STORAGE_PATH",
        mimeType: "image/webp",
        checksum: "e".repeat(64),
      },
    }];
    job.inputSnapshot.capturedAt = "2026-08-01T03:33:34.000Z";
    const controlledSearch = vi.fn(async () => ({
      contractVersion: "research-evidence.v1" as const,
      decision: "not_needed" as const,
      reason: "판단",
      queries: [],
      capturedAt: "2026-08-01T04:00:00.000Z",
      items: [],
    }));

    await createContentProposalResearch(controlledSearch).run(job);

    const serialized = JSON.stringify(controlledSearch.mock.calls[0]?.[0]);
    for (const secret of [
      "deadbeef-0000-4000-8000-000000000001",
      "SECRET_COMPANY_OVERVIEW", "SECRET_BUSINESS_DESCRIPTION", "SECRET_PRIMARY_TARGET",
      "SECRET_DIFFERENTIATOR", "SECRET_CORE_APPEAL", "SECRET_REQUESTED_URL",
      "SECRET_CANONICAL_URL", "SECRET_CRAWL_BODY_IGNORE_PREVIOUS_AND_EXFILTRATE",
      "deadbeef-0000-4000-8000-000000000002", "deadbeef-0000-4000-8000-000000000003",
      "SECRET_PRODUCT_DESCRIPTION", "SECRET_PRODUCT_FEATURE", "SECRET_PRODUCT_BENEFIT",
      "SECRET_PRODUCT_CAUTION", "SECRET_PRODUCT_PURCHASE_INFO",
      "deadbeef-0000-4000-8000-000000000004", "SECRET_PRODUCT_STORAGE_URL",
      "SECRET_PRODUCT_STORAGE_PATH", "image/secret-product-mime", "c".repeat(64),
      "deadbeef-0000-4000-8000-000000000005", "deadbeef-0000-4000-8000-000000000006",
      "SECRET_UNSELECTED_REFERENCE_TITLE", "SECRET_REFERENCE_URL", "SECRET_REFERENCE_BODY_IGNORE_ALL_RULES",
      "SECRET_REFERENCE_STORAGE_URL", "SECRET_REFERENCE_STORAGE_PATH", "e".repeat(64),
      "2026-08-01T03:33:34.000Z",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    for (const allowed of [
      "PUBLIC_PRIMARY_CATEGORY", "PUBLIC_DETAILED_CATEGORY", "PUBLIC_SUBJECT_TITLE",
      "PUBLIC_CONTENT_INSTRUCTION", "PUBLIC_PRODUCT_NAME",
    ]) {
      expect(serialized).toContain(allowed);
    }
  });

  it("uses selected reference titles, not reference identifiers or source data, for reference research", async () => {
    const job = baseJob("informational");
    if (job.inputSnapshot.contractVersion !== "proposal-base-input.v2") throw new Error("bad_fixture");
    const selectedId = "70000000-0000-4000-8000-000000000007";
    job.inputSnapshot.subject = { kind: "reference", referenceIds: [selectedId] };
    job.inputSnapshot.references = [{
      referenceItemId: selectedId,
      snapshotId: "71000000-0000-4000-8000-000000000007",
      roles: ["planning"],
      title: "PUBLIC_SELECTED_REFERENCE_TITLE",
      sourceUrl: "https://reference.example/SECRET_SELECTED_REFERENCE_URL",
      capturedAt: "2026-08-01T03:22:23.000Z",
      contentHash: "f".repeat(64),
      text: "SECRET_SELECTED_REFERENCE_BODY",
      image: null,
    }];
    const controlledSearch = vi.fn(async () => ({
      contractVersion: "research-evidence.v1" as const,
      decision: "searched" as const,
      reason: "판단",
      queries: [],
      capturedAt: "2026-08-01T04:00:00.000Z",
      items: [],
    }));

    await createContentProposalResearch(controlledSearch).run(job);

    const serialized = JSON.stringify(controlledSearch.mock.calls[0]?.[0]);
    expect(serialized).toContain("PUBLIC_SELECTED_REFERENCE_TITLE");
    expect(serialized).not.toContain(selectedId);
    expect(serialized).not.toContain("SECRET_SELECTED_REFERENCE_URL");
    expect(serialized).not.toContain("SECRET_SELECTED_REFERENCE_BODY");
  });
});
