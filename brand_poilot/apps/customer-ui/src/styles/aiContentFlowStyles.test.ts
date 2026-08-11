import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(process.cwd(), "src");

describe("AI content flow visual shell", () => {
  it("ships a separately scoped stylesheet after the existing content styles", () => {
    const main = readFileSync(resolve(sourceRoot, "main.tsx"), "utf8");
    const css = readFileSync(resolve(sourceRoot, "styles/ai-content-flow.css"), "utf8");

    expect(main).toContain('import "./styles/ai-content-flow.css";');
    expect(css).toContain(".ai-content-flow .ai-content-phase-progress");
    expect(css).toContain(".ai-content-flow .ai-content-generation-status");
    expect(css).toContain(".ai-content-flow .ai-content-result-hero");
    expect(css).toContain(".ai-content-flow .ai-content-result-layout");
    expect(css).toContain(".ai-content-flow .ai-content-result-summary");
    expect(css).toContain(".ai-content-flow .ai-content-result-hero.is-success");
    expect(css).toContain(".ai-content-flow .ai-content-result-hero.is-warning");
    expect(css).toContain(".ai-content-flow .ai-content-result-hero.is-error");
    expect(css).toContain('.ai-content-flow .ai-content-review > .tabs [role="tab"]');
    expect(css).toContain('.ai-content-flow .ai-content-review > .tabs [role="tab"][aria-selected="true"]');
    expect(css).toContain("@media (max-width: 760px)");
    expect(css).not.toMatch(/^\s*\.(?:button|panel|tabs)\b/m);
  });

  it("does not include local-preview chrome selectors", () => {
    const css = readFileSync(resolve(sourceRoot, "styles/ai-content-flow.css"), "utf8");

    expect(css).not.toContain("preview-toolbar");
    expect(css).not.toContain("preview-shell");
    expect(css).not.toContain("api-status");
  });
});
