import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONTENT_FORMAT_CATALOG,
  CONTENT_OUTPUT_FORMATS,
  CONTENT_PURPOSES,
  parseContentStudioOutputFormat,
  parseContentPurpose,
  parseGeneratedContentCatalog,
} from "./catalog.js";
import { generateArtifactSet } from "./generateArtifacts.js";

describe("canonical content catalog", () => {
  it("owns exactly three formats, two purposes, and direct claim slugs", () => {
    expect(CONTENT_OUTPUT_FORMATS).toEqual(["card_news", "blog", "reel"]);
    expect(CONTENT_PURPOSES).toEqual(["informational", "marketing"]);
    expect(Object.keys(CONTENT_FORMAT_CATALOG)).toEqual(CONTENT_OUTPUT_FORMATS);
    expect(Object.values(CONTENT_FORMAT_CATALOG).map((item) => item.claimSlug))
      .toEqual(["card_news", "blog", "reel"]);
    expect(Object.values(CONTENT_FORMAT_CATALOG).map((item) => item.model))
      .toEqual(["gpt-5.6-terra", "gpt-5.6-terra", "gpt-5.6-terra"]);
  });

  it.each(["marketing", "marketing_content", "single_image", "channel_text", "card-news"])(
    "rejects retired or transport-only value %s",
    (value) => expect(() => parseContentStudioOutputFormat(value)).toThrow("content_output_format_invalid"),
  );

  it("parses only the canonical purposes", () => {
    expect(parseContentPurpose("informational")).toBe("informational");
    expect(parseContentPurpose("marketing")).toBe("marketing");
    expect(() => parseContentPurpose("both")).toThrow("content_purpose_invalid");
  });
});

describe("generated content catalog", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function fixture() {
    const artifacts = await generateArtifactSet();
    const raw = JSON.parse(artifacts.get("content-catalog.json")!);
    const schemaArtifacts = Object.fromEntries([...artifacts].filter(([filename]) => filename !== "content-catalog.json"));
    return { raw, verification: { contractSourceHash: raw.contractSourceHash, schemaArtifacts } };
  }

  it("requires actual schema bytes and the independently supplied source hash", async () => {
    const { raw, verification } = await fixture();
    await expect(parseGeneratedContentCatalog(raw, verification)).resolves.toEqual(raw);
    await expect(parseGeneratedContentCatalog(raw, undefined as never))
      .rejects.toThrow("generated_content_catalog_invalid");
    await expect(parseGeneratedContentCatalog(raw, {
      ...verification,
      contractSourceHash: "f".repeat(64),
    })).rejects.toThrow("generated_content_catalog_invalid");
  });

  it("rejects filename, key, hash, and cross-field drift", async () => {
    const { raw, verification } = await fixture();

    await expect(parseGeneratedContentCatalog({
      ...raw,
      schemas: { ...raw.schemas, aiContentV3: { ...raw.schemas.aiContentV3, filename: "wrong.json" } },
    }, verification)).rejects.toThrow("generated_content_catalog_invalid");
    await expect(parseGeneratedContentCatalog({
      ...raw,
      schemas: { ...raw.schemas, legacyV1: raw.schemas.aiContentV3 },
    }, verification)).rejects.toThrow("generated_content_catalog_invalid");
    await expect(parseGeneratedContentCatalog({
      ...raw,
      schemas: { ...raw.schemas, aiContentV3: { ...raw.schemas.aiContentV3, sha256: "f".repeat(64) } },
    }, verification)).rejects.toThrow("generated_content_catalog_invalid");
    await expect(parseGeneratedContentCatalog({
      ...raw,
      schemas: {
        ...raw.schemas,
        imageGenerationPackageV1: { ...raw.schemas.imageGenerationPackageV1, sha256: "f".repeat(64) },
      },
    }, verification)).rejects.toThrow("generated_content_catalog_invalid");
    await expect(parseGeneratedContentCatalog({
      ...raw,
      schemas: {
        ...raw.schemas,
        plans: { ...raw.schemas.plans, blog: { ...raw.schemas.plans.blog, sha256: "f".repeat(64) } },
      },
    }, verification)).rejects.toThrow("generated_content_catalog_invalid");
    await expect(parseGeneratedContentCatalog({
      ...raw,
      proposalContracts: { ...raw.proposalContracts, outputSchemaSha256: "f".repeat(64) },
    }, verification)).rejects.toThrow("generated_content_catalog_invalid");
    await expect(parseGeneratedContentCatalog({
      ...raw,
      planContractVersions: { ...raw.planContractVersions, reel: "card-news-plan.v2" },
    }, verification)).rejects.toThrow("generated_content_catalog_invalid");
  });

  it("rejects missing, extra, or mutated actual artifact bytes", async () => {
    const { raw, verification } = await fixture();
    const { [raw.schemas.aiContentV3.filename]: _missing, ...missing } = verification.schemaArtifacts;
    await expect(parseGeneratedContentCatalog(raw, { ...verification, schemaArtifacts: missing }))
      .rejects.toThrow("generated_content_catalog_invalid");
    await expect(parseGeneratedContentCatalog(raw, {
      ...verification,
      schemaArtifacts: { ...verification.schemaArtifacts, "legacy.schema.json": "{}\n" },
    })).rejects.toThrow("generated_content_catalog_invalid");
    await expect(parseGeneratedContentCatalog(raw, {
      ...verification,
      schemaArtifacts: {
        ...verification.schemaArtifacts,
        [raw.schemas.plans.blog.filename]: `${verification.schemaArtifacts[raw.schemas.plans.blog.filename]} `,
      },
    })).rejects.toThrow("generated_content_catalog_invalid");
  });

  it("detaches both inputs synchronously and recursively freezes the verified snapshot", async () => {
    const { raw, verification } = await fixture();
    const originalTitleHash = raw.schemas.aiContentV3.sha256;
    const originalArtifact = verification.schemaArtifacts[raw.schemas.aiContentV3.filename];
    const promise = parseGeneratedContentCatalog(raw, verification);

    raw.schemas.aiContentV3.sha256 = "f".repeat(64);
    verification.contractSourceHash = "f".repeat(64);
    verification.schemaArtifacts[raw.schemas.aiContentV3.filename] = `${originalArtifact} `;

    const verified = await promise;
    expect(verified.schemas.aiContentV3.sha256).toBe(originalTitleHash);
    expect(verified.contractSourceHash).not.toBe(verification.contractSourceHash);
    const everyNestedValueIsFrozen = (value: unknown): boolean => {
      if (!value || typeof value !== "object") return true;
      return Object.isFrozen(value) && Object.values(value).every(everyNestedValueIsFrozen);
    };
    expect(everyNestedValueIsFrozen(verified)).toBe(true);
    expect(() => {
      (verified.schemas.plans.blog as { sha256: string }).sha256 = "e".repeat(64);
    }).toThrow();
    expect(verified.schemas.plans.blog.sha256).not.toBe("e".repeat(64));

    raw.schemas.plans.blog.sha256 = "d".repeat(64);
    expect(verified.schemas.plans.blog.sha256).not.toBe(raw.schemas.plans.blog.sha256);
  });

  it.each([
    ["structuredClone", undefined],
    ["crypto", undefined],
    ["crypto.subtle", { subtle: {} }],
    ["TextEncoder", undefined],
  ] as const)("fails closed with a stable error when %s is unavailable", async (_feature, replacement) => {
    const { raw, verification } = await fixture();
    if (_feature === "structuredClone") vi.stubGlobal("structuredClone", replacement);
    else if (_feature === "TextEncoder") vi.stubGlobal("TextEncoder", replacement);
    else vi.stubGlobal("crypto", replacement);
    await expect(parseGeneratedContentCatalog(raw, verification))
      .rejects.toThrow("generated_content_catalog_invalid");
  });
});
