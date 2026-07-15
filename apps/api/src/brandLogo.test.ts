import { describe, expect, it, vi } from "vitest";
import { createBrandLogoService, parseBrandLogoUpload } from "./brandLogo.js";

const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]).toString("base64");

describe("brand logo uploads", () => {
  it("accepts a PNG payload and derives a safe extension", () => {
    expect(parseBrandLogoUpload({ fileName: "my-logo.PNG", mimeType: "image/png", fileBase64: pngBase64 }))
      .toMatchObject({ fileName: "my-logo.PNG", mimeType: "image/png", extension: "png" });
  });

  it("rejects unsupported MIME types and mismatched image bytes", () => {
    expect(() => parseBrandLogoUpload({ fileName: "logo.svg", mimeType: "image/svg+xml", fileBase64: pngBase64 }))
      .toThrow("brand_logo_unsupported_type");
    expect(() => parseBrandLogoUpload({ fileName: "logo.png", mimeType: "image/png", fileBase64: Buffer.from("not-an-image").toString("base64") }))
      .toThrow("brand_logo_invalid_file");
  });

  it("rejects decoded files larger than 2MB", () => {
    const oversized = Buffer.alloc(2 * 1024 * 1024 + 1);
    oversized.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(() => parseBrandLogoUpload({ fileName: "large.png", mimeType: "image/png", fileBase64: oversized.toString("base64") }))
      .toThrow("brand_logo_file_too_large");
  });

  it("uploads the new object, updates the DB, then removes the previous object", async () => {
    const calls: string[] = [];
    const storage = {
      upload: vi.fn(async () => {
        calls.push("upload");
        return { publicUrl: "https://cdn.example.com/new.png" };
      }),
      remove: vi.fn(async (path: string) => {
        calls.push(`remove:${path}`);
      })
    };
    const store = {
      getContext: vi.fn(async () => ({ workspaceId: "workspace-1" })),
      replace: vi.fn(async () => {
        calls.push("replace");
        return {
          previousStoragePath: "workspace-1/brand-1/old.png",
          profile: { brandId: "brand-1", logoUrl: "https://cdn.example.com/new.png" }
        };
      }),
      clear: vi.fn()
    };
    const service = createBrandLogoService({ storage, store: store as never, uuid: () => "logo-id" });

    await expect(service.upload("brand-1", { fileName: "logo.png", mimeType: "image/png", fileBase64: pngBase64 }))
      .resolves.toMatchObject({ logoUrl: "https://cdn.example.com/new.png" });

    expect(storage.upload).toHaveBeenCalledWith(
      "workspace-1/brand-1/logo-logo-id.png",
      expect.any(Buffer),
      "image/png"
    );
    expect(store.replace).toHaveBeenCalledWith("brand-1", {
      logoUrl: "https://cdn.example.com/new.png",
      logoStoragePath: "workspace-1/brand-1/logo-logo-id.png"
    });
    expect(calls).toEqual(["upload", "replace", "remove:workspace-1/brand-1/old.png"]);
  });

  it("keeps the previous logo and removes the new object when the DB update fails", async () => {
    const storage = {
      upload: vi.fn(async () => ({ publicUrl: "https://cdn.example.com/new.png" })),
      remove: vi.fn(async () => undefined)
    };
    const store = {
      getContext: vi.fn(async () => ({ workspaceId: "workspace-1" })),
      replace: vi.fn(async () => { throw new Error("db_failed"); }),
      clear: vi.fn()
    };
    const service = createBrandLogoService({ storage, store: store as never, uuid: () => "logo-id" });

    await expect(service.upload("brand-1", { fileName: "logo.png", mimeType: "image/png", fileBase64: pngBase64 }))
      .rejects.toThrow("db_failed");
    expect(storage.remove).toHaveBeenCalledWith("workspace-1/brand-1/logo-logo-id.png");
  });
});
