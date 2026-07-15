import { describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer.js";

const brandId = "11111111-1111-1111-1111-111111111111";

describe("brand logo HTTP API", () => {
  it("uploads a logo through the dedicated service", async () => {
    const upload = vi.fn(async () => ({
      id: "profile-1", brandId, name: "브랜드", industry: "서비스", primaryCustomer: "사업자",
      description: "설명", tone: "", defaultCta: "", mainLink: "", autoApprovalEnabled: true,
      logoUrl: "https://cdn.example.com/logo.png"
    }));
    const app = createServer({
      repository: { health: vi.fn() } as never,
      brandLogoService: { upload, remove: vi.fn() },
      logger: false
    });

    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/logo`,
      payload: { fileName: "logo.png", mimeType: "image/png", fileBase64: "base64" }
    });

    expect(response.statusCode).toBe(200);
    expect(upload).toHaveBeenCalledWith(brandId, {
      fileName: "logo.png", mimeType: "image/png", fileBase64: "base64"
    });
    await app.close();
  });

  it("returns a stable 400 error for an invalid logo", async () => {
    const app = createServer({
      repository: { health: vi.fn() } as never,
      brandLogoService: {
        upload: vi.fn(async () => { throw new Error("brand_logo_unsupported_type"); }),
        remove: vi.fn()
      },
      logger: false
    });

    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/logo`,
      payload: { fileName: "logo.svg", mimeType: "image/svg+xml", fileBase64: "base64" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "brand_logo_unsupported_type" });
    await app.close();
  });

  it("accepts the base64 request size needed for a logo larger than Fastify's default limit", async () => {
    const upload = vi.fn(async () => ({
      id: "profile-1", brandId, name: "브랜드", industry: "서비스", primaryCustomer: "사업자",
      description: "설명", tone: "", defaultCta: "", mainLink: "", autoApprovalEnabled: true,
      logoUrl: "https://cdn.example.com/logo.png"
    }));
    const app = createServer({
      repository: { health: vi.fn() } as never,
      brandLogoService: { upload, remove: vi.fn() },
      logger: false
    });

    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/logo`,
      payload: {
        fileName: "large.png",
        mimeType: "image/png",
        fileBase64: "A".repeat(1_100_000)
      }
    });

    expect(response.statusCode).toBe(200);
    expect(upload).toHaveBeenCalledOnce();
    await app.close();
  });

  it("returns 413 without calling storage when the logo request exceeds the route limit", async () => {
    const upload = vi.fn();
    const app = createServer({
      repository: { health: vi.fn() } as never,
      brandLogoService: { upload, remove: vi.fn() },
      logger: false
    });

    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/logo`,
      payload: {
        fileName: "too-large.png",
        mimeType: "image/png",
        fileBase64: "A".repeat(3 * 1024 * 1024)
      }
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({ error: "brand_logo_request_too_large" });
    expect(upload).not.toHaveBeenCalled();
    await app.close();
  });
});
