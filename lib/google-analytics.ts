import { importPKCS8, SignJWT } from "jose";

type GaRow = {
  dimensionValues?: Array<{ value?: string }>;
  metricValues?: Array<{ value?: string }>;
};

type GaResponse = {
  rows?: GaRow[];
};

export type AnalyticsOverview = {
  activeUsers: number;
  sessions: number;
  pageViews: number;
  leads: number;
};

export type AnalyticsRow = {
  label: string;
  detail?: string;
  activeUsers: number;
  sessions: number;
  pageViews?: number;
};

export type AnalyticsDashboard =
  | { status: "ready"; periodLabel: string; overview: AnalyticsOverview; topPages: AnalyticsRow[]; sources: AnalyticsRow[] }
  | { status: "unconfigured" | "unavailable"; message: string };

const oauthTokenUrl = "https://oauth2.googleapis.com/token";
const analyticsScope = "https://www.googleapis.com/auth/analytics.readonly";

function configured() {
  const propertyId = process.env.GA4_PROPERTY_ID?.trim() ?? "";
  const clientEmail = process.env.GA4_SERVICE_ACCOUNT_EMAIL?.trim() ?? "";
  const privateKey = process.env.GA4_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n").trim() ?? "";
  return propertyId && clientEmail && privateKey ? { propertyId, clientEmail, privateKey } : null;
}

function metricValue(row: GaRow | undefined, index: number) {
  return Number(row?.metricValues?.[index]?.value ?? 0);
}

function dimensionValue(row: GaRow | undefined, index: number) {
  return row?.dimensionValues?.[index]?.value?.trim() || "직접 방문";
}

async function accessToken(clientEmail: string, privateKey: string) {
  const key = await importPKCS8(privateKey, "RS256");
  const assertion = await new SignJWT({ scope: analyticsScope })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(clientEmail)
    .setSubject(clientEmail)
    .setAudience(oauthTokenUrl)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
  const response = await fetch(oauthTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    }),
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Google OAuth token request failed");
  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) throw new Error("Google OAuth token response was incomplete");
  return payload.access_token;
}

async function report(propertyId: string, token: string, body: Record<string, unknown>) {
  const response = await fetch("https://analyticsdata.googleapis.com/v1beta/properties/" + encodeURIComponent(propertyId) + ":runReport", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Google Analytics Data API report failed");
  return response.json() as Promise<GaResponse>;
}

export async function getAnalyticsDashboard(): Promise<AnalyticsDashboard> {
  const settings = configured();
  if (!settings) {
    return {
      status: "unconfigured",
      message: "GA4 Property ID와 읽기 전용 서비스 계정을 등록하면 최근 28일의 분석 데이터를 표시합니다."
    };
  }

  try {
    const token = await accessToken(settings.clientEmail, settings.privateKey);
    const dateRange = [{ startDate: "28daysAgo", endDate: "today" }];
    const [overviewReport, leadReport, pagesReport, sourcesReport] = await Promise.all([
      report(settings.propertyId, token, {
        dateRanges: dateRange,
        metrics: [{ name: "activeUsers" }, { name: "sessions" }, { name: "screenPageViews" }]
      }),
      report(settings.propertyId, token, {
        dateRanges: dateRange,
        metrics: [{ name: "eventCount" }],
        dimensionFilter: { filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: "generate_lead" } } }
      }),
      report(settings.propertyId, token, {
        dateRanges: dateRange,
        dimensions: [{ name: "pageTitle" }, { name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: 8
      }),
      report(settings.propertyId, token, {
        dateRanges: dateRange,
        dimensions: [{ name: "sessionSourceMedium" }],
        metrics: [{ name: "sessions" }, { name: "activeUsers" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 8
      })
    ]);
    const overview = overviewReport.rows?.[0];
    return {
      status: "ready",
      periodLabel: "최근 28일",
      overview: {
        activeUsers: metricValue(overview, 0),
        sessions: metricValue(overview, 1),
        pageViews: metricValue(overview, 2),
        leads: metricValue(leadReport.rows?.[0], 0)
      },
      topPages: (pagesReport.rows ?? []).map((row) => ({
        label: dimensionValue(row, 0),
        detail: dimensionValue(row, 1),
        pageViews: metricValue(row, 0),
        activeUsers: metricValue(row, 1),
        sessions: 0
      })),
      sources: (sourcesReport.rows ?? []).map((row) => ({
        label: dimensionValue(row, 0),
        sessions: metricValue(row, 0),
        activeUsers: metricValue(row, 1)
      }))
    };
  } catch {
    return {
      status: "unavailable",
      message: "GA4 데이터를 불러오지 못했습니다. Property ID, 서비스 계정 권한, Google Analytics Data API 활성화 상태를 확인해 주세요."
    };
  }
}
