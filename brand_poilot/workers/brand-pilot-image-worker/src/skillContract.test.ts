import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Threads Codex skill safety contract", () => {
  it("has a dedicated Korean skill that forbids image and external side effects", async () => {
    const skill = await readFile(new URL("../.codex/skills/threads-text/SKILL.md", import.meta.url), "utf8");

    expect(skill).toContain("name: threads-text");
    expect(skill).toContain("image_gen");
    expect(skill).toContain("호출하지 마세요");
    expect(skill).toContain("외부 API");
    expect(skill).toContain("JSON만 반환");
  });

  it("keeps image and text safety rules separate in AGENTS.md", async () => {
    const agents = await readFile(new URL("../AGENTS.md", import.meta.url), "utf8");

    expect(agents).toContain("Threads 텍스트 작업");
    expect(agents).toContain("image_gen을 호출하지 마세요");
    expect(agents).toContain("워커 코드, 설정, 인증 정보");
  });

  it("limits information-style Reel generation to exactly one image", async () => {
    const skill = await readFile(new URL("../.codex/skills/image-render/SKILL.md", import.meta.url), "utf8");

    expect(skill).toContain("릴스는 정확히 1장");
    expect(skill).toContain("레이아웃은 주제와 원문에 맞게 자율적으로 결정");
    expect(skill).not.toContain("릴스는 1장부터 5장");
    expect(skill).not.toContain("릴스는 1장 또는 2장");
  });
});
