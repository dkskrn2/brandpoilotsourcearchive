import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const imageExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif"
};

function isBlobConfigured() {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
    (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN)
  );
}

export async function POST(request: Request) {
  if (!await getAdminSession()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isBlobConfigured()) return NextResponse.json({ error: "이미지 저장소가 아직 연결되지 않았습니다." }, { status: 503 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "이미지 파일을 읽지 못했습니다." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "이미지 파일을 선택해 주세요." }, { status: 400 });
  if (!(file.type in imageExtensions)) return NextResponse.json({ error: "JPG, PNG, WebP, GIF, AVIF 파일만 업로드할 수 있습니다." }, { status: 400 });
  if (!file.size || file.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: "이미지 크기는 최대 4MB입니다." }, { status: 413 });

  try {
    const blob = await put(`content/${randomUUID()}.${imageExtensions[file.type]}`, file, {
      access: "private",
      addRandomSuffix: false,
      cacheControlMaxAge: 31_536_000,
      contentType: file.type
    });
    return NextResponse.json({ url: `/api/content-images/${blob.pathname}` });
  } catch {
    return NextResponse.json({ error: "이미지를 저장하지 못했습니다." }, { status: 500 });
  }
}
