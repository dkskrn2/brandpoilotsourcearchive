import { describe, expect, it } from "vitest";
import {
  CONTENT_FORMAT_CATALOG,
  CONTENT_IMAGE_PROMPT_VERSIONS,
  CONTENT_OUTPUT_FORMATS,
  CONTENT_PROPOSAL_PROMPT_VERSION,
  CONTENT_PROMPT_DEFINITION_VERSIONS,
  CONTENT_PURPOSES,
} from "./catalog.js";
import { parseContentPromptBinding, promptBindingFor } from "./binding.js";
import { parseGeneratedContentCatalog } from "./catalog.js";
import { generateArtifactSet } from "./generateArtifacts.js";

const HASH = "a".repeat(64);

it("uses the revised marketing-evidence proposal prompt version", () => {
  expect(CONTENT_PROPOSAL_PROMPT_VERSION).toBe("proposal.writer.v3");
});

function bindingFor(
  outputFormat: (typeof CONTENT_OUTPUT_FORMATS)[number],
  purpose: (typeof CONTENT_PURPOSES)[number],
) {
  return {
    contractVersion: "content-prompt-binding.v1",
    outputFormat,
    purpose,
    proposalRequestVersion: "content-proposal-request.v2",
    proposalBaseInputVersion: "proposal-base-input.v2",
    proposalComposedInputVersion: "proposal-input.v2",
    proposalOutputVersion: "content-proposal.v2",
    proposalPromptVersion: CONTENT_PROPOSAL_PROMPT_VERSION,
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

describe("ContentPromptBindingSchema", () => {
  it("prevents post-call catalog mutation from changing a verified proposal hash", async () => {
    const artifacts = await generateArtifactSet();
    const raw = JSON.parse(artifacts.get("content-catalog.json")!);
    const originalHash = raw.schemas.contentProposalV2.sha256;
    const verification = {
      contractSourceHash: raw.contractSourceHash,
      schemaArtifacts: Object.fromEntries([...artifacts].filter(([filename]) => filename !== "content-catalog.json")),
    };
    const promise = parseGeneratedContentCatalog(raw, verification);
    raw.schemas.contentProposalV2.sha256 = "f".repeat(64);
    raw.proposalContracts.outputSchemaSha256 = "f".repeat(64);

    const catalog = await promise;
    expect(promptBindingFor("blog", "marketing", catalog).proposalSchemaSha256).toBe(originalHash);
    expect(catalog.schemas.contentProposalV2.sha256).toBe(originalHash);
  });

  it.each(CONTENT_OUTPUT_FORMATS.flatMap((format) => CONTENT_PURPOSES.map((purpose) => [format, purpose] as const)))(
    "constructs %s/%s only from a verified generated catalog",
    async (format, purpose) => {
      const artifacts = await generateArtifactSet();
      const raw = JSON.parse(artifacts.get("content-catalog.json")!);
      const catalog = await parseGeneratedContentCatalog(raw, {
        contractSourceHash: raw.contractSourceHash,
        schemaArtifacts: Object.fromEntries([...artifacts].filter(([filename]) => filename !== "content-catalog.json")),
      });
      const binding = promptBindingFor(format, purpose, catalog);
      expect(binding.proposalSchemaSha256).toBe(catalog.schemas.contentProposalV2.sha256);
      expect(binding.generationSchemaSha256).toBe(catalog.schemas.contentGenerationInputV3.sha256);
      expect(binding.planSchemaSha256).toBe(catalog.schemas.plans[format].sha256);
      expect(binding.contractSourceHash).toBe(catalog.contractSourceHash);
    },
  );
  it.each(CONTENT_OUTPUT_FORMATS.flatMap((format) => CONTENT_PURPOSES.map((purpose) => [format, purpose] as const)))(
    "parses the literal catalog binding for %s/%s",
    (format, purpose) => {
      expect(parseContentPromptBinding(bindingFor(format, purpose))).toEqual(bindingFor(format, purpose));
    },
  );

  it("requires each named hash instead of accepting a generic schemaHash", () => {
    const value = bindingFor("blog", "informational") as Record<string, unknown>;
    delete value.proposalSchemaSha256;
    delete value.generationSchemaSha256;
    delete value.planSchemaSha256;
    value.schemaHash = HASH;

    expect(() => parseContentPromptBinding(value)).toThrow("content_prompt_binding_invalid");
  });

  it("rejects unknown planner and image prompt IDs before execution", () => {
    expect(() => parseContentPromptBinding({
      ...bindingFor("reel", "marketing"),
      plannerPromptVersion: "planner.reel.marketing.future",
    })).toThrow("content_prompt_binding_invalid");
    expect(() => parseContentPromptBinding({
      ...bindingFor("reel", "marketing"),
      imagePromptVersion: "image.reel.marketing.future",
    })).toThrow("content_prompt_binding_invalid");
  });

  it("rejects a non-Terra planner model and extra properties", () => {
    expect(() => parseContentPromptBinding({
      ...bindingFor("card_news", "informational"),
      model: "gpt-5.6-sol",
    })).toThrow("content_prompt_binding_invalid");
    expect(() => parseContentPromptBinding({
      ...bindingFor("card_news", "informational"),
      legacy: true,
    })).toThrow("content_prompt_binding_invalid");
  });

  it.each(Object.keys(bindingFor("card_news", "informational")))(
    "rejects a binding missing required field %s",
    (field) => {
      const value = bindingFor("card_news", "informational") as Record<string, unknown>;
      delete value[field];
      expect(() => parseContentPromptBinding(value)).toThrow("content_prompt_binding_invalid");
    },
  );
});
