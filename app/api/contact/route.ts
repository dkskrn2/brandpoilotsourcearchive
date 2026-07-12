import { NextResponse } from "next/server";

const allowedPlans = new Set(["seed", "series-a", "series-b"]);

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
  const gasUrl = process.env.GAS_WEBAPP_URL;
  if (!gasUrl) return NextResponse.json({ ok: false, error: "Missing GAS_WEBAPP_URL" }, { status: 503 });
  if (Number(request.headers.get("content-length") ?? 0) > 32_000) {
    return NextResponse.json({ ok: false, error: "Payload too large" }, { status: 413 });
  }

  try {
    const payload = await request.json() as Record<string, unknown>;
    if (text(payload.websiteTrap, 200)) return NextResponse.json({ ok: true });
    const data = {
      name: text(payload.name, 100),
      phone: text(payload.phone, 30).replace(/\D/g, ""),
      site: text(payload.site, 500),
      message: text(payload.message, 3000),
      plan: text(payload.plan, 30),
      agree: text(payload.agree, 1)
    };
    if (!data.name || !/^\d{7,20}$/.test(data.phone) || !allowedPlans.has(data.plan) || data.agree !== "Y" || !validHttpUrl(data.site)) {
      return NextResponse.json({ ok: false, error: "Invalid form data" }, { status: 400 });
    }
    const params = new URLSearchParams();
    Object.entries(data).forEach(([key, value]) => params.append(key, value));
    const response = await fetch(gasUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: params.toString(),
      cache: "no-store"
    });

    if (!response.ok) return NextResponse.json({ ok: false, error: "Upstream submission failed" }, { status: 502 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }
}
