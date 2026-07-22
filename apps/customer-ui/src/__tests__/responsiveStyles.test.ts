import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const cssPath = resolve(process.cwd(), "src/styles/prototype.css");

describe("responsive UI style contracts", () => {
  it("keeps publish management cards square across responsive layouts", async () => {
    const css = await readFile(cssPath, "utf8");

    expect(css).toMatch(/\.publish-management-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
    expect(css).toMatch(/\.publish-management-card\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/s);
    expect(css).toMatch(/@media \(max-width:\s*980px\)[\s\S]*?\.publish-management-grid\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
    expect(css).toMatch(/@media \(max-width:\s*720px\)[\s\S]*?\.publish-management-grid\s*\{[^}]*grid-template-columns:\s*1fr/s);
    expect(css).toMatch(/\.publish-card__media-object\s*\{[^}]*object-fit:\s*contain/s);
    expect(css).toMatch(/\.publish-management-card__body\s*\{[^}]*overflow:\s*hidden/s);
    expect(css).not.toMatch(/\.publish-management-card__body\s*\{[^}]*max-height/s);
  });

  it("renders subcategory choices in one readable column without splitting Korean words", async () => {
    const css = await readFile(cssPath, "utf8");

    expect(css).toMatch(/\.subcategory-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    expect(css).toMatch(/\.subcategory-option span\s*\{[^}]*word-break:\s*keep-all/s);
  });

  it("styles native single selects and focus and disabled states consistently", async () => {
    const css = await readFile(cssPath, "utf8");

    const selectContractIndex = css.lastIndexOf("select:not([multiple])");

    expect(css).toMatch(/select:not\(\[multiple\]\)\s*\{[^}]*appearance:\s*none[^}]*min-height:\s*44px[^}]*background-image:/s);
    expect(selectContractIndex).toBeGreaterThan(css.lastIndexOf(".trend-sort select"));
    expect(selectContractIndex).toBeGreaterThan(css.lastIndexOf(".field select"));
    expect(selectContractIndex).toBeGreaterThan(css.lastIndexOf(".wizard-form-grid select"));
    expect(css).toMatch(/:where\(input,\s*textarea,\s*select\):focus-visible\s*\{[^}]*outline:/s);
    expect(css).toMatch(/:where\(input,\s*textarea,\s*select\):disabled\s*\{[^}]*cursor:\s*not-allowed/s);
  });

  it("uses thin scrollbars and disables progress animation for reduced motion", async () => {
    const css = await readFile(cssPath, "utf8");

    expect(css).toMatch(/html\s*\{[^}]*scrollbar-width:\s*thin/s);
    expect(css).toMatch(/\*::?-webkit-scrollbar\s*\{[^}]*width:\s*8px/s);
    expect(css).toMatch(/\*::?-webkit-scrollbar-thumb\s*\{[^}]*background:/s);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.upload-progress__bar\s*\{[^}]*transition:\s*none/s);
  });
});
