import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ProductVisualSourceSnapshotV1 } from "@brand-pilot/content-contracts/product-visual-references";
import { acquireProductUrlReferences } from "./productVisualReferenceAcquisition.js";
import type {
  ProductImageImportClient,
  ProductImageImportJob,
  ProductImageImportUploadedAsset,
} from "./productImageImportClient.js";

export interface ProductImageImportUploadInput {
  job: ProductImageImportJob;
  bytes: Buffer;
  mimeType: ProductImageImportUploadedAsset["mimeType"];
  checksum: string;
}

function auditUrl(value: string): string {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function runProductImageImportOnce(input: {
  workerId: string;
  client: ProductImageImportClient;
  acquire?: typeof acquireProductUrlReferences;
  upload(input: ProductImageImportUploadInput): Promise<Pick<ProductImageImportUploadedAsset, "storageUrl" | "storagePath">>;
  remove?(storagePaths: string[]): Promise<void>;
  leaseSeconds?: number;
  heartbeatIntervalMs?: number;
}): Promise<{ status: "idle" } | { status: "completed" | "failed"; jobId: string }> {
  const leaseSeconds = Math.max(30, Math.min(600, Math.floor(input.leaseSeconds ?? 180)));
  const claim = await input.client.claim(input.workerId, leaseSeconds);
  if (!claim) return { status: "idle" };
  const inputDir = await mkdtemp(path.join(os.tmpdir(), "brand-pilot-product-import-"));
  let stopped = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const uploadedPaths: string[] = [];
  let completionStarted = false;
  try {
    heartbeat = setInterval(() => {
      if (!stopped) void input.client.heartbeat(claim, input.workerId, leaseSeconds).catch(() => undefined);
    }, Math.max(1_000, input.heartbeatIntervalMs ?? 60_000));
    const snapshot: ProductVisualSourceSnapshotV1 = {
      contractVersion: "product-visual-source-snapshot.v1",
      productServiceId: claim.productServiceId,
      versionId: claim.versionId,
      kind: "product",
      sourceUrls: claim.sourceUrls,
    };
    const acquired = await (input.acquire ?? acquireProductUrlReferences)({ snapshot, slots: claim.remainingSlots, inputDir });
    const images: ProductImageImportUploadedAsset[] = [];
    for (const reference of acquired.references) {
      const bytes = await readFile(reference.absolutePath);
      const uploaded = await input.upload({
        job: claim, bytes, mimeType: reference.candidate.mimeType, checksum: reference.candidate.contentSha256,
      });
      images.push({
        ...uploaded,
        mimeType: reference.candidate.mimeType,
        sizeBytes: bytes.byteLength,
        checksum: reference.candidate.contentSha256,
        sourceUrl: reference.candidate.imageUrl,
      });
      uploadedPaths.push(uploaded.storagePath);
    }
    completionStarted = true;
    const completion = await input.client.complete(claim, input.workerId, {
      images,
      selectionAudit: {
        contractVersion: "product-image-import-audit.v1",
        sourceUrls: claim.sourceUrls.map(auditUrl),
        candidates: acquired.candidates.map((candidate) => ({
          ...candidate,
          sourcePageUrl: auditUrl(candidate.sourcePageUrl),
          imageUrl: auditUrl(candidate.imageUrl),
        })),
        events: acquired.events.map((event) => ({
          ...event,
          sourcePageUrl: auditUrl(event.sourcePageUrl),
          imageUrl: event.imageUrl ? auditUrl(event.imageUrl) : null,
        })),
        selected: images.length,
      },
    });
    const retained = new Set(completion.retainedStoragePaths);
    await input.remove?.(uploadedPaths.filter((storagePath) => !retained.has(storagePath))).catch(() => undefined);
    return { status: "completed", jobId: claim.id };
  } catch {
    await input.client.fail(claim, input.workerId, "product_image_import_failed").catch(() => undefined);
    if (!completionStarted) await input.remove?.(uploadedPaths).catch(() => undefined);
    return { status: "failed", jobId: claim.id };
  } finally {
    stopped = true;
    if (heartbeat) clearInterval(heartbeat);
    await rm(inputDir, { recursive: true, force: true });
  }
}
