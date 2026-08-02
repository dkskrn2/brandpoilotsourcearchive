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

  it("renders one V3 asset per job while preserving the planned Reel scene count", async () => {
    const skill = await readFile(new URL("../.codex/skills/image-render/SKILL.md", import.meta.url), "utf8");

    expect(skill).toContain("image_asset` 작업 하나당 정확히 PNG 한 장");
    expect(skill).toContain("레거시 릴스는 계약된 장면 수만큼 각각 별도 PNG");
    expect(skill).toContain("장수, 순서, 사실, 수량, 카피와 제품 정보는 다시 기획하거나 바꾸지 마세요");
  });
});
