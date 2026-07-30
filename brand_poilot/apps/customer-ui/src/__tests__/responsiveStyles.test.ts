import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const cssPath = resolve(process.cwd(), "src/styles/prototype.css");
const tokensPath = resolve(process.cwd(), "src/styles/tokens.css");
const shellPath = resolve(process.cwd(), "src/styles/shell.css");
const dashboardPath = resolve(process.cwd(), "src/styles/dashboard.css");
const performancePath = resolve(process.cwd(), "src/styles/performance.css");
const mainPath = resolve(process.cwd(), "src/main.tsx");

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

  it("loads D hybrid style layers in their stable cascade order", async () => {
    const main = await readFile(mainPath, "utf8");

    const imports = [
      "./styles/tokens.css",
      "./styles/prototype.css",
      "./styles/shell.css",
      "./styles/dashboard.css"
      ,"./styles/performance.css"
    ].map((path) => main.indexOf(`import "${path}"`));

    expect(imports.every((index) => index >= 0)).toBe(true);
    expect(imports).toEqual([...imports].sort((a, b) => a - b));
  });

  it("keeps performance insights responsive and motion-safe", async () => {
    const css = await readFile(performancePath, "utf8");

    expect(css).toMatch(/\.performance-summary-metrics,[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
    expect(css).toMatch(/@media \(max-width:\s*1080px\)[\s\S]*?\.performance-summary-metrics,[\s\S]*?repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.performance-summary-metrics,[\s\S]*?grid-template-columns:\s*1fr/s);
    expect(css).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)/);
  });

  it("defines the approved D hybrid shell tokens and responsive accessibility contracts", async () => {
    const [tokens, shell, dashboard] = await Promise.all([
      readFile(tokensPath, "utf8"),
      readFile(shellPath, "utf8"),
      readFile(dashboardPath, "utf8")
    ]);

    expect(tokens).toMatch(/--bp-color-sidebar:\s*#102822/);
    expect(tokens).toMatch(/--bp-color-primary:\s*#2f6b55/);
    expect(tokens).toMatch(/--bp-color-canvas:\s*#f7f4ed/);
    expect(tokens).toMatch(/--bp-sidebar-width:\s*238px/);
    expect(tokens).toMatch(/--bp-sidebar-collapsed-width:\s*78px/);
    expect(tokens).toMatch(/--bp-topbar-height:\s*64px/);

    expect(shell).toMatch(/\.app\s*\{[^}]*var\(--bp-sidebar-width\)/s);
    expect(shell).toMatch(/\.app--sidebar-collapsed\s*\{[^}]*var\(--bp-sidebar-collapsed-width\)/s);
    expect(shell).toMatch(/\.topbar\s*\{[^}]*display:\s*none/s);
    expect(shell).toMatch(
      /@media \(max-width:\s*1080px\)[\s\S]*?\.sidebar--desktop\s*\{[^}]*display:\s*none[^}]*\}[\s\S]*?\.topbar\s*\{[^}]*display:\s*flex[^}]*min-height:\s*var\(--bp-topbar-height\)/s
    );
    const mobileShell = shell.slice(
      shell.indexOf("@media (max-width: 1080px)"),
      shell.indexOf("@media (max-width: 760px)"),
    );
    expect(mobileShell).toMatch(
      /\.mobile-menu-trigger,\s*\.mobile-menu-close\s*\{[^}]*display:\s*grid/s,
    );
    expect(mobileShell).toMatch(
      /\.sidebar--mobile\s*\{[^}]*position:\s*static[^}]*width:\s*100%[^}]*height:\s*100dvh/s,
    );
    expect(mobileShell).toMatch(
      /\.sidebar--mobile \.nav\s*\{[^}]*overflow-y:\s*auto/s,
    );
    expect(shell).toMatch(/\.sidebar \.nav\s*\{[^}]*overflow-y:\s*auto/s);
    expect(shell).toMatch(/\.nav a[\s\S]*?min-height:\s*44px/s);
    expect(shell).toMatch(/\.sidebar \.nav a,[\s\S]*?color:\s*#d8e5df/s);
    expect(shell).toMatch(/\.sidebar \.sidebar-brand-profile\s*\{[^}]*background:\s*transparent/s);
    expect(shell).toMatch(/@media \(max-width:\s*1080px\)/);
    expect(shell).toMatch(/@media \(max-width:\s*760px\)/);
    expect(shell).toMatch(/@media \(max-width:\s*470px\)/);
    expect(shell).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?scroll-behavior:\s*auto\s*!important/s);
    expect(shell).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?transition:\s*none\s*!important/s);
    expect(shell).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?animation:\s*none\s*!important/s);

    expect(dashboard).toMatch(/\.dashboard-columns\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.08fr\)\s*minmax\(0,\s*\.92fr\)/s);
    expect(dashboard).toMatch(/@media \(max-width:\s*1080px\)[\s\S]*?\.dashboard-columns\s*\{[^}]*grid-template-columns:\s*1fr/s);
  });
});
