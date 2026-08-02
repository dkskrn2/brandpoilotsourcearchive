import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  AI_CONTENT_SNAPSHOT_MAX_BYTES,
  createAiContentSnapshotBlob,
  type AiContentSnapshotStorage,
} from "./aiContentSnapshotBlob.js";

const bytes = Buffer.from("owned-image-bytes");
const checksum = createHash("sha256").update(bytes).digest("hex");

function storage(overrides: Partial<AiContentSnapshotStorage> = {}): AiContentSnapshotStorage {
  return {
    stat: vi.fn(async () => null),
    read: vi.fn(async () => bytes),
    put: vi.fn(async (path: string) => ({
      storagePath: path,
      storageUrl: `https://blob.example/${path}`,
    })),
    ...overrides,
  };
}

describe("AI content immutable snapshot blob", () => {
  it("hashes exact owned bytes and writes the deterministic MIME-derived path", async () => {
    const adapter = storage();
    const service = createAiContentSnapshotBlob(adapter);

    await expect(service.freezeOwnedImage({
      brandId: "A0000000-0000-4000-8000-000000000001",
      sourceStoragePath: "brands/a/asset-library/source.bin",
      mimeType: "IMAGE/JPEG",
      expectedChecksum: checksum.toUpperCase(),
    })).resolves.toEqual({
      storageUrl: `https://blob.example/ai-content/snapshots/a0000000-0000-4000-8000-000000000001/${checksum}.jpg`,
      storagePath: `ai-content/snapshots/a0000000-0000-4000-8000-000000000001/${checksum}.jpg`,
      mimeType: "image/jpeg",
      checksum,
    });

    expect(adapter.read).toHaveBeenCalledWith(
      "brands/a/asset-library/source.bin",
      { maxBytes: AI_CONTENT_SNAPSHOT_MAX_BYTES },
    );
    expect(adapter.put).toHaveBeenCalledWith(
      `ai-content/snapshots/a0000000-0000-4000-8000-000000000001/${checksum}.jpg`,
      bytes,
      { contentType: "image/jpeg", ifNoneMatch: true },
    );
  });

  it.each([
    ["https://example.com/live.png", "image/png"],
    ["http://example.com/live.png", "image/png"],
    ["brands/a/document.pdf", "application/pdf"],
  ])("rejects external read keys and unsupported MIME without touching storage", async (sourceStoragePath, mimeType) => {
    const adapter = storage();
    const service = createAiContentSnapshotBlob(adapter);

    await expect(service.freezeOwnedImage({
      brandId: "a0000000-0000-4000-8000-000000000001",
      sourceStoragePath,
      mimeType,
    })).rejects.toThrow("RESOURCE_NOT_AVAILABLE");
    expect(adapter.stat).not.toHaveBeenCalled();
    expect(adapter.read).not.toHaveBeenCalled();
    expect(adapter.put).not.toHaveBeenCalled();
  });

  it("rejects a known oversize object before read or upload", async () => {
    const adapter = storage({
      stat: vi.fn(async () => ({
        sizeBytes: AI_CONTENT_SNAPSHOT_MAX_BYTES + 1,
        storagePath: "brands/a/large.png",
        storageUrl: "https://blob.example/brands/a/large.png",
      })),
    });

    await expect(createAiContentSnapshotBlob(adapter).freezeOwnedImage({
      brandId: "a0000000-0000-4000-8000-000000000001",
      sourceStoragePath: "brands/a/large.png",
      mimeType: "image/png",
    })).rejects.toThrow("RESOURCE_NOT_AVAILABLE");
    expect(adapter.read).not.toHaveBeenCalled();
    expect(adapter.put).not.toHaveBeenCalled();
  });

  it("bounds a streamed read and never uploads oversize bytes", async () => {
    async function* oversized() {
      yield new Uint8Array(AI_CONTENT_SNAPSHOT_MAX_BYTES);
      yield new Uint8Array(1);
    }
    const adapter = storage({ read: vi.fn(async () => oversized()) });

    await expect(createAiContentSnapshotBlob(adapter).freezeOwnedImage({
      brandId: "a0000000-0000-4000-8000-000000000001",
      sourceStoragePath: "brands/a/stream.webp",
      mimeType: "image/webp",
    })).rejects.toThrow("RESOURCE_NOT_AVAILABLE");
    expect(adapter.put).not.toHaveBeenCalled();
  });

  it("rejects checksum mismatch before upload", async () => {
    const adapter = storage();
    await expect(createAiContentSnapshotBlob(adapter).freezeOwnedImage({
      brandId: "a0000000-0000-4000-8000-000000000001",
      sourceStoragePath: "brands/a/source.png",
      mimeType: "image/png",
      expectedChecksum: "f".repeat(64),
    })).rejects.toThrow("RESOURCE_NOT_AVAILABLE");
    expect(adapter.put).not.toHaveBeenCalled();
  });

  it("reuses an existing brand/hash object without duplicate upload", async () => {
    const destination = `ai-content/snapshots/a0000000-0000-4000-8000-000000000001/${checksum}.png`;
    const adapter = storage({
      stat: vi.fn(async (path: string) => path === destination ? {
        sizeBytes: bytes.length,
        storagePath: destination,
        storageUrl: `https://blob.example/${destination}`,
      } : null),
    });

    await expect(createAiContentSnapshotBlob(adapter).freezeOwnedImage({
      brandId: "a0000000-0000-4000-8000-000000000001",
      sourceStoragePath: "brands/a/source.png",
      mimeType: "image/png",
    })).resolves.toMatchObject({ storagePath: destination, checksum });
    expect(adapter.put).not.toHaveBeenCalled();
  });

  it("tolerates a concurrent create only when the deterministic object now exists", async () => {
    const destination = `ai-content/snapshots/a0000000-0000-4000-8000-000000000001/${checksum}.webp`;
    let calls = 0;
    const adapter = storage({
      stat: vi.fn(async (path: string) => {
        calls += 1;
        return calls > 1 && path === destination ? {
          sizeBytes: bytes.length,
          storagePath: destination,
          storageUrl: `https://blob.example/${destination}`,
        } : null;
      }),
      put: vi.fn(async () => { throw new Error("already exists"); }),
    });

    await expect(createAiContentSnapshotBlob(adapter).freezeOwnedImage({
      brandId: "a0000000-0000-4000-8000-000000000001",
      sourceStoragePath: "brands/a/source.webp",
      mimeType: "image/webp",
    })).resolves.toMatchObject({ storagePath: destination, checksum });
  });

  it("rejects an adapter result whose path or URL is not the deterministic destination", async () => {
    const adapter = storage({
      put: vi.fn(async () => ({
        storagePath: "mutable/live.png",
        storageUrl: "https://blob.example/mutable/live.png",
      })),
    });
    await expect(createAiContentSnapshotBlob(adapter).freezeOwnedImage({
      brandId: "a0000000-0000-4000-8000-000000000001",
      sourceStoragePath: "brands/a/source.png",
      mimeType: "image/png",
    })).rejects.toThrow("RESOURCE_NOT_AVAILABLE");
  });
});
