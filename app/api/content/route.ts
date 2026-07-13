import { NextRequest, NextResponse } from "next/server";
import { listPublishedArticlePage } from "@/lib/content-db";
import { CONTENT_PAGE_SIZE, normalizeContentPage } from "@/lib/content-pagination";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const page = normalizeContentPage(request.nextUrl.searchParams.get("page") ?? undefined);
  const result = await listPublishedArticlePage(page, CONTENT_PAGE_SIZE);

  if (result.total > 0 && page > result.totalPages) {
    return NextResponse.json({ error: "요청한 콘텐츠 페이지가 없습니다." }, { status: 404 });
  }

  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" }
  });
}
