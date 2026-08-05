import { describe, expect, it } from "vitest";
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
  it("parses the generated catalog and rejects filename, hash, and cross-field drift", async () => {
    const artifacts = await generateArtifactSet();
    const raw = JSON.parse(artifacts.get("content-catalog.json")!);
    expect(parseGeneratedContentCatalog(raw)).toEqual(raw);

    expect(() => parseGeneratedContentCatalog({
      ...raw,
      schemas: { ...raw.schemas, aiContentV3: { ...raw.schemas.aiContentV3, filename: "wrong.json" } },
    })).toThrow("generated_content_catalog_invalid");
    expect(() => parseGeneratedContentCatalog({
      ...raw,
      schemas: { ...raw.schemas, legacyV1: raw.schemas.aiContentV3 },
    })).toThrow("generated_content_catalog_invalid");
    expect(() => parseGeneratedContentCatalog({
      ...raw,
      schemas: { ...raw.schemas, contentProposalV2: { ...raw.schemas.contentProposalV2, sha256: "f".repeat(64) } },
    })).toThrow("generated_content_catalog_invalid");
    expect(() => parseGeneratedContentCatalog({
      ...raw,
      proposalContracts: { ...raw.proposalContracts, outputSchemaSha256: "f".repeat(64) },
    })).toThrow("generated_content_catalog_invalid");
    expect(() => parseGeneratedContentCatalog({
      ...raw,
      planContractVersions: { ...raw.planContractVersions, reel: "card-news-plan.v2" },
    })).toThrow("generated_content_catalog_invalid");
  });
});
