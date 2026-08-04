import { describe, expect, it } from "vitest";
import {
  CONTENT_FORMAT_CATALOG,
  CONTENT_OUTPUT_FORMATS,
  CONTENT_PURPOSES,
  parseContentStudioOutputFormat,
  parseContentPurpose,
} from "./catalog.js";

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
