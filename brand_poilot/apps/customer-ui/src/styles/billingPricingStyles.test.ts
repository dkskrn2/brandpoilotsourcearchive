import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("billing pricing style contract", () => {
  it("supports narrow screens, keyboard focus, and reduced motion using D tokens", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/styles/billing-pricing.css"),
      "utf8",
    );

    expect(css).toContain("@media (max-width: 470px)");
    expect(css).toMatch(
      /\.billing-pricing__comparison-scroll\s*\{[^}]*max-width:\s*100%/s,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition:\s*none/,
    );
    expect(css).toMatch(/:focus-visible/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/--bpp-/);
  });
});
