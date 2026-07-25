import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { assertCustomerBuildEnv, productionApiBaseUrl } from "./buildEnv";

type HeaderRule = {
  source: string;
  headers: Array<{ key: string; value: string }>;
};

const vercelConfig = JSON.parse(
  readFileSync(resolve(process.cwd(), "../../vercel.json"), "utf8")
) as { headers: HeaderRule[] };

function cacheControlFor(pathname: string): string | undefined {
  let cacheControl: string | undefined;

  for (const rule of vercelConfig.headers) {
    if (!new RegExp(`^${rule.source}$`).test(pathname)) {
      continue;
    }

    const header = rule.headers.find(
      ({ key }) => key.toLowerCase() === "cache-control"
    );
    if (header) {
      cacheControl = header.value;
    }
  }

  return cacheControl;
}

describe("assertCustomerBuildEnv", () => {
  it("returns a trimmed API URL for local development", () => {
    expect(
      assertCustomerBuildEnv({
        VITE_API_BASE_URL: "  http://localhost:4000  "
      })
    ).toBe("http://localhost:4000");
  });

  it("requires VITE_API_BASE_URL during a Vercel build", () => {
    expect(() => assertCustomerBuildEnv({ VERCEL: "1" })).toThrowError(
      "VITE_API_BASE_URL_required"
    );
  });

  it.each([
    "http://api.danbammsg.co.kr",
    "https://localhost:4000",
    "https://api.danbammsg.co.kr/",
    "https://other.example"
  ])("rejects an unstable production API URL: %s", (value) => {
    expect(() =>
      assertCustomerBuildEnv({
        VERCEL_ENV: "production",
        VITE_API_BASE_URL: value
      })
    ).toThrowError("VITE_API_BASE_URL_invalid");
  });

  it("allows the exact production API URL on Vercel", () => {
    expect(
      assertCustomerBuildEnv({
        VERCEL: "1",
        VITE_API_BASE_URL: productionApiBaseUrl
      })
    ).toBe(productionApiBaseUrl);
  });
});

describe("Vercel customer asset caching", () => {
  it.each([
    "/assets/index-AbCd1234.js",
    "/assets/SubjectDetailPage-CvPGJlPN.js"
  ])("caches hashed Vite bundles immutably: %s", (pathname) => {
    expect(cacheControlFor(pathname)).toBe(
      "public, max-age=31536000, immutable"
    );
  });

  it.each([
    "/assets/brand/mojong-ad-logo.png",
    "/assets/channels/instagram.svg"
  ])("revalidates fixed-name public assets: %s", (pathname) => {
    expect(cacheControlFor(pathname)).toBe(
      "public, max-age=0, must-revalidate"
    );
  });
});
