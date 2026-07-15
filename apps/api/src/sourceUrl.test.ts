import { describe, expect, it } from "vitest";
import { hashSourceUrl } from "./sourceUrl";

describe("hashSourceUrl", () => {
  it("treats scheme and hostname case variants as the same URL", () => {
    expect(hashSourceUrl("HTTPS://WWW.INSTAGRAM.COM/p/AbC?Ref=One#Top"))
      .toBe(hashSourceUrl("https://www.instagram.com/p/AbC?Ref=One#Top"));
  });

  it("preserves Instagram shortcode case", () => {
    expect(hashSourceUrl("https://www.instagram.com/p/AbC"))
      .not.toBe(hashSourceUrl("https://www.instagram.com/p/aBc"));
  });

  it("preserves query and fragment case", () => {
    expect(hashSourceUrl("https://www.instagram.com/p/AbC?Ref=One#Top"))
      .not.toBe(hashSourceUrl("https://www.instagram.com/p/AbC?ref=one#top"));
  });
});
