import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const gasUrl = process.env.GAS_WEBAPP_URL;
  if (!gasUrl) return NextResponse.json({ ok: false, error: "Missing GAS_WEBAPP_URL" }, { status: 503 });

  try {
    const data = await request.json() as Record<string, string>;
    const params = new URLSearchParams();
    ["name", "phone", "site", "message", "plan", "agree"].forEach((key) => params.append(key, data[key] ?? ""));
    const response = await fetch(gasUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: params.toString(),
      cache: "no-store"
    });

    if (!response.ok) return NextResponse.json({ ok: false, error: await response.text() }, { status: 502 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
