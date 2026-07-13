import { describe, expect, it } from "vitest";
import { parseThreadsTextResult } from "./threadsResult.js";

const expected = {
  sourceMode: "direct_url" as const,
  fetchStatus: "fetched" as const,
  model: "codex-cli"
};

const result = {
  deliveryFormat: "threads_text",
  promptVersion: "worker-threads.v1",
  title: "여름 두피가 보내는 신호",
  text: "더운 날엔 거창한 관리보다 작은 습관부터 돌아보게 됩니다.",
  ...expected
};

describe("Threads Codex result", () => {
  it("parses and validates the exact final agent JSON contract", () => {
    expect(parseThreadsTextResult(JSON.stringify(result), expected)).toEqual(result);
  });

  it("rejects Markdown fences, empty copy, and unexpected fields", () => {
    expect(() => parseThreadsTextResult(`\`\`\`json\n${JSON.stringify(result)}\n\`\`\``, expected))
      .toThrow("codex_text_output_json_invalid");
    expect(() => parseThreadsTextResult(JSON.stringify({ ...result, text: " " }), expected))
      .toThrow("codex_text_output_invalid");
    expect(() => parseThreadsTextResult(JSON.stringify({ ...result, hashtags: [] }), expected))
      .toThrow("codex_text_output_contract_invalid");
  });

  it("rejects source metadata that disagrees with the worker observation", () => {
    expect(() => parseThreadsTextResult(JSON.stringify({ ...result, fetchStatus: "source_timeout" }), expected))
      .toThrow("codex_text_output_contract_invalid");
  });
});
