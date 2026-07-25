import { describe, expect, it } from "vitest";
import { canonicalLocalDevUrl } from "../lib/localOrigin";

describe("canonicalLocalDevUrl", () => {
  it("normalizes 127.0.0.1 to localhost so the local session cookie stays same-site", () => {
    expect(canonicalLocalDevUrl({
      protocol: "http:",
      hostname: "127.0.0.1",
      port: "5173",
      pathname: "/onboarding",
      search: "?from=kakao",
      hash: "#setup"
    })).toBe("http://localhost:5173/onboarding?from=kakao#setup");
  });

  it("keeps non-loopback locations unchanged", () => {
    expect(canonicalLocalDevUrl({
      protocol: "https:",
      hostname: "www.danbammsg.co.kr",
      port: "",
      pathname: "/brand-pilot",
      search: "",
      hash: ""
    })).toBeNull();
  });
});
