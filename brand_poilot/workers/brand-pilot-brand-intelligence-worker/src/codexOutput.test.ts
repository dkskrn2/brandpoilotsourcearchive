import { describe, expect, it } from "vitest";
import {
  codexFailureDiagnostic,
  extractJson,
} from "../scripts/codex-output.mjs";

describe("Codex output handling", () => {
  it("accepts a plain stage object from output-last-message", () => {
    expect(extractJson('{"stageVersion":"owned-facts.v1","output":[]}')).toEqual({
      stageVersion: "owned-facts.v1",
      output: [],
    });
    expect(extractJson('{"offerings":[],"faqSuggestions":[]}')).toEqual({
      offerings: [],
      faqSuggestions: [],
    });
  });

  it("accepts a fenced multiline JSON object", () => {
    expect(extractJson('```json\n{\n  "oneLineDefinition": "브랜드"\n}\n```')).toEqual({
      oneLineDefinition: "브랜드",
    });
  });

  it("keeps only allowlisted fields from structured Codex errors", () => {
    const sensitive = "PRIVATE_CUSTOMER_FACT";
    const stdout = [
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: sensitive } }),
      JSON.stringify({
        type: "error",
        message: JSON.stringify({
          type: "error",
          error: {
            type: "invalid_request_error",
            code: "invalid_json_schema",
            message: `request rejected near ${sensitive}`,
          },
          status: 400,
        }),
      }),
    ].join("\n");

    const diagnostic = codexFailureDiagnostic("", stdout);

    expect(diagnostic).toBe("invalid_request_error:invalid_json_schema:http_400");
    expect(diagnostic).not.toContain(sensitive);
  });

  it("classifies known failures without returning raw streams", () => {
    expect(codexFailureDiagnostic("", JSON.stringify({
      type: "turn.failed",
      error: { message: "You've hit your usage limit for PRIVATE_BRAND" },
    }))).toBe("usage_limit");
    expect(codexFailureDiagnostic("api key sk-private-value", "customer prompt"))
      .toBe("codex_cli_error");
  });
});
