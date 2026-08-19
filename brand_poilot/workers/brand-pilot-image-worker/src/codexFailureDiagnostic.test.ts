import { describe, expect, it } from "vitest";
import { codexFailureDiagnostic } from "./codexFailureDiagnostic.js";

describe("Codex failure diagnostics", () => {
  it("keeps only allowlisted fields from a structured provider failure", () => {
    const sensitive = "PRIVATE_CUSTOMER_FACT";
    const stdout = JSON.stringify({
      type: "turn.failed",
      error: {
        message: JSON.stringify({
          type: "error",
          error: {
            type: "server_error",
            code: "internal_error",
            message: `provider failed near ${sensitive}`,
          },
          status: 500,
        }),
      },
    });

    const diagnostic = codexFailureDiagnostic("", stdout);

    expect(diagnostic).toBe("codex_failure_server_error_internal_error_http_500");
    expect(diagnostic).not.toContain(sensitive);
  });

  it("classifies plain known failures without preserving raw streams", () => {
    expect(codexFailureDiagnostic("Internal server error for image generation", ""))
      .toBe("codex_image_generation_internal_error");
    expect(codexFailureDiagnostic("", JSON.stringify({
      type: "turn.failed",
      error: { message: "You've hit your usage limit for PRIVATE_BRAND" },
    }))).toBe("codex_usage_limit");
    expect(codexFailureDiagnostic("api key sk-private-value", "customer prompt"))
      .toBe("codex_cli_error");
  });
});
