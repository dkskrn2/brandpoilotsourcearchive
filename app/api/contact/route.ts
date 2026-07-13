import { NextResponse } from "next/server";
import { createContactInquiry, isDatabaseConfigured } from "@/lib/content-db";

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validHttpUrl(value: string) {
  if (!value) return true;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return NextResponse.json({ ok: false, error: "Missing DATABASE_URL" }, { status: 503 });
  if (Number(request.headers.get("content-length") ?? 0) > 32_000) {
    return NextResponse.json({ ok: false, error: "Payload too large" }, { status: 413 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }

  if (text(payload.websiteTrap, 200)) return NextResponse.json({ ok: true });
  const data = {
    name: text(payload.name, 100),
    phone: text(payload.phone, 30).replace(/\D/g, ""),
    site: text(payload.site, 500),
    message: text(payload.message, 3000),
    agree: text(payload.agree, 1)
  };
  if (!data.name || !/^\d{7,20}$/.test(data.phone) || data.agree !== "Y" || !validHttpUrl(data.site)) {
    return NextResponse.json({ ok: false, error: "Invalid form data" }, { status: 400 });
  }

  try {
    await createContactInquiry({
      name: data.name,
      phone: data.phone,
      site: data.site,
      message: data.message,
      agreed: true
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Database submission failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
