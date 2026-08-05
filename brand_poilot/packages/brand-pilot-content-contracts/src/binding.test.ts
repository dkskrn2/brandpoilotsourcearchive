import { describe, expect, it } from "vitest";
import {
  CONTENT_FORMAT_CATALOG,
  CONTENT_IMAGE_PROMPT_VERSIONS,
  CONTENT_OUTPUT_FORMATS,
  CONTENT_PROMPT_DEFINITION_VERSIONS,
  CONTENT_PURPOSES,
} from "./catalog.js";
import { parseContentPromptBinding } from "./binding.js";

const HASH = "a".repeat(64);

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

describe("ContentPromptBindingSchema", () => {
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
});
