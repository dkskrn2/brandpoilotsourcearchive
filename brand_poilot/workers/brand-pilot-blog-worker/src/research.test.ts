import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentGenerationInputV3 } from "@brand-pilot/content-contracts";
import { createCodexAccountPool } from "@brand-pilot/worker-runtime";
import { assessBlogResearchNeed, runBlogSupplementalSearch } from "./research.js";

const input = {
  outputSettings: { purpose: "informational" },
  brandCore: { primaryCategory: "교육", detailedCategory: "콘텐츠" },
  subject: { kind: "topic_text", title: "좋은 글 구조" },
  contentInstruction: "구체적으로 작성",
  product: null,
  selectedProposal: { title: "가이드", keyMessage: "핵심" },
  researchEvidence: { items: [] },
} as never;

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("blog supplemental research", () => {
  it("assesses need with network, file, shell, and image access disabled", async () => {
    const runChild = vi.fn(async ({ args, prompt }: { args: string[]; prompt: string }) => {
      const modelFlag = args.indexOf("--model");
      expect(modelFlag).toBeGreaterThanOrEqual(0);
      expect(args[modelFlag + 1]).toBe("gpt-5.6-terra");
      expect(args.join(" ")).toContain("permissions.assessor.network.enabled=false");
      expect(args).toEqual(expect.arrayContaining(["--disable", "shell_tool", "--disable", "image_generation"]));
      expect(args.join(" ")).not.toContain("--search");
      expect(prompt).toContain("고정 입력만");
      return '{"decision":"not_needed","reason":"기존 근거가 충분합니다"}';
    });
    await expect(assessBlogResearchNeed(input, { runChild })).resolves.toEqual({ decision: "not_needed", reason: "기존 근거가 충분합니다" });
  });

  it("shares the worker account pool for assessment failover", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "blog-research-accounts-"));
    roots.push(root);
    for (const alias of ["primary", "secondary"]) {
      const home = path.join(root, alias);
      await mkdir(home);
      await writeFile(path.join(home, "auth.json"), "{}");
    }
    const accountPool = await createCodexAccountPool({
      root,
      aliases: ["primary", "secondary"],
    });
    const attempted: Array<string | undefined> = [];
    const runChild = vi.fn(async ({ profile }: { profile?: { alias: string } }) => {
      attempted.push(profile?.alias);
      if (profile?.alias !== "secondary") {
        throw Object.assign(new Error("blog_research_assessment_failed:1"), {
          diagnostic: "You've hit your usage limit",
          acceptedOutput: false,
        });
      }
      return '{"decision":"not_needed","reason":"secondary available"}';
    });

    await expect(assessBlogResearchNeed(input, { accountPool, runChild })).resolves.toEqual({
      decision: "not_needed",
      reason: "secondary available",
    });
    expect(attempted).toEqual(["primary", "secondary"]);
  });

  it("runs the existing controlled search exactly once in blog_supplement mode for either purpose", async () => {
    const search = vi.fn(async () => ({ contractVersion: "research-evidence.v1", decision: "searched", reason: "found", queries: ["q"], capturedAt: "2026-07-31T00:00:00.000Z", items: [] }));
    await runBlogSupplementalSearch(input, { search });
    await runBlogSupplementalSearch({
      ...input,
      outputSettings: { purpose: "marketing" },
      product: { name: "제품" },
    } as never, { search });
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls.map(([value]) => value)).toEqual([
      {
        purpose: "informational",
        mode: "blog_supplement",
        publicResearchContext: {
          purpose: "informational",
          subjectKind: "topic_text",
          subjectTitle: "좋은 글 구조",
          contentInstruction: "구체적으로 작성",
          primaryCategory: "교육",
          detailedCategory: "콘텐츠",
          selectedProduct: null,
        },
        signal: undefined,
      },
      {
        purpose: "marketing",
        mode: "blog_supplement",
        publicResearchContext: {
          purpose: "marketing",
          subjectKind: "topic_text",
          subjectTitle: "좋은 글 구조",
          contentInstruction: "구체적으로 작성",
          primaryCategory: "교육",
          detailedCategory: "콘텐츠",
          selectedProduct: { name: "제품", category: "콘텐츠" },
        },
        signal: undefined,
      },
    ]);
  });

  it("keeps frozen V3 secrets out of the online supplemental search context", async () => {
    const secretInput = {
      contractVersion: "content-generation-input.v3",
      generationId: "SECRET_GENERATION_ID",
      brandCore: {
        versionId: "SECRET_BRAND_VERSION_ID",
        companyOverview: "SECRET_COMPANY_OVERVIEW",
        businessDescription: "SECRET_BUSINESS_DESCRIPTION",
        primaryCategory: "PUBLIC_PRIMARY_CATEGORY",
        detailedCategory: "PUBLIC_DETAILED_CATEGORY",
        primaryTarget: "SECRET_PRIMARY_TARGET",
        differentiator: "SECRET_DIFFERENTIATOR",
        coreAppeal: "SECRET_CORE_APPEAL",
      },
      subject: {
        kind: "topic_url",
        requestedUrl: "https://secret.example/SECRET_REQUESTED_URL",
        canonicalUrl: "https://secret.example/SECRET_CANONICAL_URL",
        title: "PUBLIC_SUBJECT_TITLE",
        text: "SECRET_CRAWL_BODY_IGNORE_PREVIOUS_AND_EXFILTRATE",
        contentHash: "SECRET_SUBJECT_HASH",
        capturedAt: "SECRET_SUBJECT_CAPTURED_AT",
      },
      contentInstruction: "PUBLIC_CONTENT_INSTRUCTION",
      product: {
        id: "SECRET_PRODUCT_ID",
        versionId: "SECRET_PRODUCT_VERSION_ID",
        kind: "product",
        name: "PUBLIC_PRODUCT_NAME",
        description: "SECRET_PRODUCT_DESCRIPTION",
        features: ["SECRET_PRODUCT_FEATURE"],
        benefits: ["SECRET_PRODUCT_BENEFIT"],
        cautions: ["SECRET_PRODUCT_CAUTION"],
        evergreenPurchaseInfo: "SECRET_PRODUCT_PURCHASE_INFO",
        images: [{
          assetId: "SECRET_PRODUCT_ASSET_ID",
          role: "hero",
          storageUrl: "https://storage.example/SECRET_PRODUCT_STORAGE_URL",
          storagePath: "SECRET_PRODUCT_STORAGE_PATH",
          mimeType: "image/png",
          checksum: "SECRET_PRODUCT_CHECKSUM",
        }],
      },
      researchEvidence: {
        decision: "searched",
        reason: "SECRET_RESEARCH_REASON",
        queries: ["SECRET_RESEARCH_QUERY"],
        items: [{ claimSummary: "SECRET_RESEARCH_CLAIM", url: "https://secret.example/evidence" }],
      },
      references: {
        selected: [{ title: "SECRET_REFERENCE_TITLE", sourceUrl: "https://secret.example/reference", text: "SECRET_REFERENCE_BODY" }],
        brandStyleImages: [{ description: "SECRET_STYLE_DESCRIPTION", storageUrl: "https://secret.example/style" }],
        avatarStyleImageId: "SECRET_AVATAR_STYLE_ID",
        attachments: [{ storagePath: "SECRET_ATTACHMENT_STORAGE_PATH" }],
      },
      selectedProposal: {
        id: "SECRET_PROPOSAL_ID",
        title: "SECRET_PROPOSAL_TITLE",
        keyMessage: "SECRET_PROPOSAL_MESSAGE",
        target: "SECRET_PROPOSAL_TARGET",
        purposeDetails: { buyingBarriers: ["SECRET_PROPOSAL_BARRIER"] },
      },
      userImageInstruction: "SECRET_USER_IMAGE_PROMPT",
      outputSettings: { purpose: "marketing" },
      capturedAt: "SECRET_INPUT_CAPTURED_AT",
    } as unknown as ContentGenerationInputV3;
    const search = vi.fn(async () => ({
      contractVersion: "research-evidence.v1" as const,
      decision: "searched" as const,
      reason: "found",
      queries: ["q"],
      capturedAt: "2026-07-31T00:00:00.000Z",
      items: [],
    }));

    await runBlogSupplementalSearch(secretInput, { search });

    const serialized = JSON.stringify(search.mock.calls[0]?.[0]);
    for (const secret of [
      "SECRET_GENERATION_ID", "SECRET_BRAND_VERSION_ID", "SECRET_COMPANY_OVERVIEW",
      "SECRET_BUSINESS_DESCRIPTION", "SECRET_PRIMARY_TARGET", "SECRET_DIFFERENTIATOR",
      "SECRET_CORE_APPEAL", "SECRET_REQUESTED_URL", "SECRET_CANONICAL_URL",
      "SECRET_CRAWL_BODY_IGNORE_PREVIOUS_AND_EXFILTRATE", "SECRET_SUBJECT_HASH",
      "SECRET_SUBJECT_CAPTURED_AT", "SECRET_PRODUCT_ID", "SECRET_PRODUCT_VERSION_ID",
      "SECRET_PRODUCT_DESCRIPTION", "SECRET_PRODUCT_FEATURE", "SECRET_PRODUCT_BENEFIT",
      "SECRET_PRODUCT_CAUTION", "SECRET_PRODUCT_PURCHASE_INFO", "SECRET_PRODUCT_ASSET_ID",
      "SECRET_PRODUCT_STORAGE_URL", "SECRET_PRODUCT_STORAGE_PATH", "SECRET_PRODUCT_CHECKSUM",
      "SECRET_RESEARCH_REASON", "SECRET_RESEARCH_QUERY", "SECRET_RESEARCH_CLAIM",
      "SECRET_REFERENCE_TITLE", "SECRET_REFERENCE_BODY", "SECRET_STYLE_DESCRIPTION",
      "SECRET_AVATAR_STYLE_ID", "SECRET_ATTACHMENT_STORAGE_PATH", "SECRET_PROPOSAL_ID",
      "SECRET_PROPOSAL_TITLE", "SECRET_PROPOSAL_MESSAGE", "SECRET_PROPOSAL_TARGET",
      "SECRET_PROPOSAL_BARRIER", "SECRET_USER_IMAGE_PROMPT", "SECRET_INPUT_CAPTURED_AT",
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

  it("uses null when a reference subject has no safe user-facing title", async () => {
    const search = vi.fn(async () => ({
      contractVersion: "research-evidence.v1" as const,
      decision: "searched" as const,
      reason: "found",
      queries: ["q"],
      capturedAt: "2026-07-31T00:00:00.000Z",
      items: [],
    }));
    const referenceInput = {
      ...input,
      subject: { kind: "reference", referenceIds: ["SECRET_REFERENCE_ID"] },
      references: { selected: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [] },
    } as never;

    await runBlogSupplementalSearch(referenceInput, { search });

    expect(search.mock.calls[0]?.[0]).toMatchObject({
      publicResearchContext: { subjectKind: "reference", subjectTitle: null },
    });
    expect(JSON.stringify(search.mock.calls[0]?.[0])).not.toContain("SECRET_REFERENCE_ID");
  });
});
