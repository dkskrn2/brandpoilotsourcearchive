import { describe, expect, it } from "vitest";
import { resolveServerHost } from "./runtime";

describe("server runtime", () => {
  it("binds to all interfaces inside Vercel", () => {
    expect(resolveServerHost({ vercel: "1" })).toBe("0.0.0.0");
  });

  it("keeps the loopback default for local development", () => {
    expect(resolveServerHost({})).toBe("127.0.0.1");
  });

  it("honors an explicit host in either environment", () => {
    expect(resolveServerHost({ host: "10.0.0.2", vercel: "1" })).toBe("10.0.0.2");
  });
});
