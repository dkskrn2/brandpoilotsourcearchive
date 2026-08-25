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

  it("uses only the shared Card/Reel session and Blog image contracts", async () => {
    const skill = await readFile(new URL("../.codex/skills/image-render/SKILL.md", import.meta.url), "utf8");

    expect(skill).toContain("ai-content-visual-session-render.v1");
    expect(skill).toContain("visual-render-policy.d2pp.v4");
    expect(skill).toContain("inputs/visual-session.json");
    expect(skill).toContain("장면당 정확히 한 번");
    expect(skill).toContain("1080×1920");
    expect(skill).toContain("크롭·레터박스·필러박스·여백·흰 띠");
    expect(skill).toContain("짧은 구조 라벨");
    expect(skill).toContain("새 사실·주장·수치·날짜·조건·출처·인용");
    expect(skill).not.toContain("ai-content-card-deck-render-job.v1");
    expect(skill).not.toContain("ai-content-reel-storyboard-render-job.v1");
    expect(skill).toContain("블로그 보조 이미지 전용");
    expect(skill).not.toContain("ai-content-render-job.v3");
  });
});
