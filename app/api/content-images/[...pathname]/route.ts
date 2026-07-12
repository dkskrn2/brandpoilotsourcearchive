import { get } from "@vercel/blob";
import { NextResponse } from "next/server";

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

export async function GET(_request: Request, { params }: { params: Promise<{ pathname: string[] }> }) {
  const { pathname } = await params;
  if (pathname[0] !== "content" || pathname.length !== 2) return new NextResponse("Not found", { status: 404 });

  try {
    const result = await get(pathname.join("/"), { access: "private" });
    if (!result?.stream || !imageTypes.has(result.blob.contentType ?? "")) return new NextResponse("Not found", { status: 404 });
    return new NextResponse(result.stream, {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": result.blob.contentType ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
