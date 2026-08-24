import { createHash } from "node:crypto";
import { del, put } from "@vercel/blob";
import type { ProductImageImportUploadInput } from "./productImageImportWorker.js";

function sha256(bytes: Buffer) { return createHash("sha256").update(bytes).digest("hex"); }

export function createProductImageImportStorage({ token, putBlob = put, deleteBlob = del }: {
  token: string;
  putBlob?: typeof put;
  deleteBlob?: typeof del;
}) {
  return {
    async upload(input: ProductImageImportUploadInput) {
      if (sha256(input.bytes) !== input.checksum) throw new Error("product_image_import_checksum_mismatch");
      const extension = input.mimeType === "image/jpeg" ? "jpg" : input.mimeType === "image/webp" ? "webp" : "png";
      const storagePath = `brands/${input.job.brandId}/asset-library/products/${input.job.productServiceId}/imports/${input.job.id}/${input.checksum}.${extension}`;
      const uploaded = await putBlob(storagePath, input.bytes, {
        access: "public", token, contentType: input.mimeType, addRandomSuffix: false, allowOverwrite: true,
      });
      return { storageUrl: uploaded.url, storagePath };
    },
    async remove(storagePaths: string[]) {
      if (storagePaths.length) await deleteBlob(storagePaths, { token });
    },
  };
}
