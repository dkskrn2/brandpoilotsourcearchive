import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(process.cwd(), "src");
const brandCenterCssPath = resolve(sourceRoot, "styles/brand-center.css");
const brandCorePanelPath = resolve(
  sourceRoot,
  "components/brand-center/BrandCoreReviewPanel.tsx",
);
const autoResponsePanelPath = resolve(
  sourceRoot,
  "components/brand-center/AutoResponseKnowledgePanel.tsx",
);
const styleReferencePanelPath = resolve(
  sourceRoot,
  "components/brand-center/StyleReferenceImageBoard.tsx",
);

describe("brand center visual contracts", () => {
  it("uses the shared padded panel header on brand core and style tabs", async () => {
    const [brandCorePanel, styleReferencePanel] = await Promise.all([
      readFile(brandCorePanelPath, "utf8"),
      readFile(styleReferencePanelPath, "utf8"),
    ]);

    expect(brandCorePanel).toContain('className="panel-head"');
    expect(styleReferencePanel).toContain(
      'className="panel-head style-reference-header"',
    );
  });

  it("gives brand core fields the same full-width bordered treatment as onboarding fields", async () => {
    const css = await readFile(brandCenterCssPath, "utf8");

    expect(css).toMatch(
      /\.brand-core-form\s+:is\(input,\s*textarea\)\s*\{(?=[^}]*width:\s*100%)(?=[^}]*border:)(?=[^}]*border-radius:)(?=[^}]*padding:)(?=[^}]*font-weight:\s*400)[^}]*\}/s,
    );
    expect(css).toMatch(
      /\.brand-core-form\s+:is\(input,\s*textarea\):disabled\s*\{[^}]*opacity:\s*1[^}]*background:/s,
    );
  });

  it("renders automatic-response knowledge as spaced read-only cards", async () => {
    const [panel, css] = await Promise.all([
      readFile(autoResponsePanelPath, "utf8"),
      readFile(brandCenterCssPath, "utf8"),
    ]);

    expect(panel).toContain("auto-response-knowledge-panel");
    expect(panel).toContain("auto-response-knowledge-body");
    expect(css).toMatch(
      /\.auto-response-knowledge-body\s*\{[^}]*display:\s*grid[^}]*gap:/s,
    );
    expect(css).toMatch(
      /\.auto-response-knowledge-body\s*>\s*section\s*\{(?=[^}]*padding:)(?=[^}]*border:)(?=[^}]*border-radius:)[^}]*\}/s,
    );
    expect(css).toMatch(
      /\.auto-response-knowledge-panel\s+\.brand-core-grid\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:/s,
    );
  });

  it("styles the native file chooser inside the style-image dropzone", async () => {
    const css = await readFile(brandCenterCssPath, "utf8");

    expect(css).toMatch(
      /\.style-reference-dropzone\s+input::file-selector-button\s*\{(?=[^}]*border:)(?=[^}]*border-radius:)(?=[^}]*background:)(?=[^}]*padding:)[^}]*\}/s,
    );
  });
});
