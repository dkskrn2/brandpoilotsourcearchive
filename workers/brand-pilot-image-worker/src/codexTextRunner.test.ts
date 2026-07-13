import { describe, expect, it, vi } from "vitest";
import { createCodexTextGenerator } from "./codexTextRunner.js";

const source = {
  sourceMode: "direct_url" as const,
  fetchStatus: "fetched" as const,
  sourceText: "source"
};

describe("Codex Threads text generator", () => {
  it("parses the final agent message returned by the authenticated Codex CLI execution", async () => {
    const execute = vi.fn(async () => JSON.stringify({
      deliveryFormat: "threads_text",
      promptVersion: "worker-threads.v1",
      title: "제목",
      text: "본문",
      sourceMode: "direct_url",
      fetchStatus: "fetched",
      model: "codex-cli"
    }));
    const generator = createCodexTextGenerator({ rootDir: "C:\\worker", model: "codex-cli", execute });

    await expect(generator.generate({ prompt: "한글 프롬프트", source })).resolves.toMatchObject({
      deliveryFormat: "threads_text",
      title: "제목",
      text: "본문"
    });
    expect(execute).toHaveBeenCalledWith({ rootDir: "C:\\worker", prompt: "한글 프롬프트" });
  });

  it("rejects a non-JSON final agent message", async () => {
    const generator = createCodexTextGenerator({
      rootDir: "C:\\worker",
      model: "codex-cli",
      execute: vi.fn(async () => "완성했습니다")
    });

    await expect(generator.generate({ prompt: "prompt", source }))
      .rejects.toThrow("codex_text_output_json_invalid");
  });
});
