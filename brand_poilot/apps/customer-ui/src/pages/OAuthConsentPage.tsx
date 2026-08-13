import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { createClient } from "@supabase/supabase-js";
import "../styles/oauth-consent.css";

type OAuthUser = { id: string };

type OAuthAuthorizationDetails = {
  kind: "consent";
  authorizationId: string;
  clientName: string;
  redirectUri: string;
  scopes: string[];
};

type OAuthRedirect = { kind: "redirect"; redirectUrl: string };

export interface OAuthConsentClient {
  getUser(): Promise<{ user: OAuthUser | null }>;
  sendSignInLink(email: string, redirectTo: string): Promise<void>;
  getAuthorizationDetails(authorizationId: string): Promise<OAuthAuthorizationDetails | OAuthRedirect>;
  approveAuthorization(authorizationId: string): Promise<string>;
  denyAuthorization(authorizationId: string): Promise<string>;
}

type ConsentState =
  | { kind: "loading" }
  | { kind: "anonymous" }
  | { kind: "consent"; details: OAuthAuthorizationDetails }
  | { kind: "error"; message: string };

const scopeLabels: Record<string, string> = {
  email: "계정 식별 이메일",
  profile: "기본 프로필",
  phone: "전화번호",
  openid: "사용자 식별 정보",
};

const authorizationStorageKey = "mojong:oauth-authorization-id";
const authorizationStorageTtlMs = 15 * 60 * 1000;

type StoredAuthorization = { authorizationId: string; savedAt: number };

function storedAuthorizationId() {
  const value = localStorage.getItem(authorizationStorageKey);
  if (!value) return "";
  try {
    const stored = JSON.parse(value) as StoredAuthorization;
    if (
      typeof stored.authorizationId !== "string"
      || typeof stored.savedAt !== "number"
      || Date.now() - stored.savedAt > authorizationStorageTtlMs
    ) {
      localStorage.removeItem(authorizationStorageKey);
      return "";
    }
    return stored.authorizationId.trim();
  } catch {
    localStorage.removeItem(authorizationStorageKey);
    return "";
  }
}

function preserveAuthorizationId(authorizationId: string) {
  localStorage.setItem(authorizationStorageKey, JSON.stringify({
    authorizationId,
    savedAt: Date.now(),
  } satisfies StoredAuthorization));
}

const unavailableClient: OAuthConsentClient = {
  async getUser() { throw new Error("oauth_client_not_configured"); },
  async sendSignInLink() { throw new Error("oauth_client_not_configured"); },
  async getAuthorizationDetails() { throw new Error("oauth_client_not_configured"); },
  async approveAuthorization() { throw new Error("oauth_client_not_configured"); },
  async denyAuthorization() { throw new Error("oauth_client_not_configured"); },
};

function createOAuthConsentClient(): OAuthConsentClient {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!supabaseUrl || !publishableKey) return unavailableClient;
  const supabase = createClient(supabaseUrl, publishableKey);

  return {
    async getUser() {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      return { user: data.user ? { id: data.user.id } : null };
    },
    async sendSignInLink(email, redirectTo) {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
      });
      if (error) throw error;
    },
    async getAuthorizationDetails(authorizationId) {
      const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
      if (error || !data) throw error ?? new Error("oauth_authorization_missing");
      if (!("authorization_id" in data)) return { kind: "redirect", redirectUrl: data.redirect_url };
      return {
        kind: "consent",
        authorizationId: data.authorization_id,
        clientName: data.client.name,
        redirectUri: data.redirect_uri,
        scopes: data.scope.split(/\s+/).filter(Boolean),
      };
    },
    async approveAuthorization(authorizationId) {
      const { data, error } = await supabase.auth.oauth.approveAuthorization(
        authorizationId,
        { skipBrowserRedirect: true },
      );
      if (error || !data) throw error ?? new Error("oauth_approval_failed");
      return data.redirect_url;
    },
    async denyAuthorization(authorizationId) {
      const { data, error } = await supabase.auth.oauth.denyAuthorization(
        authorizationId,
        { skipBrowserRedirect: true },
      );
      if (error || !data) throw error ?? new Error("oauth_denial_failed");
      return data.redirect_url;
    },
  };
}

function defaultRedirect(url: string) {
  window.location.assign(url);
}

export function OAuthConsentPage({
  client,
  redirect = defaultRedirect,
}: {
  client?: OAuthConsentClient;
  redirect?: (url: string) => void;
}) {
  const [searchParams] = useSearchParams();
  const resolvedClient = useMemo(() => client ?? createOAuthConsentClient(), [client]);
  const authorizationId = useMemo(() => (
    searchParams.get("authorization_id")?.trim()
    || storedAuthorizationId()
    || ""
  ), [searchParams]);
  const [state, setState] = useState<ConsentState>(authorizationId
    ? { kind: "loading" }
    : { kind: "error", message: "유효하지 않은 연결 요청입니다." });
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const loginRedirectUrl = useMemo(() => {
    return new URL("/oauth/consent", window.location.origin).toString();
  }, []);

  useEffect(() => {
    if (!authorizationId) return;
    let active = true;
    void (async () => {
      try {
        const { user } = await resolvedClient.getUser();
        if (!active) return;
        if (!user) {
          setState({ kind: "anonymous" });
          return;
        }
        const details = await resolvedClient.getAuthorizationDetails(authorizationId);
        if (!active) return;
        if (details.kind === "redirect") {
          localStorage.removeItem(authorizationStorageKey);
          redirect(details.redirectUrl);
          return;
        }
        setState({ kind: "consent", details });
      } catch {
        if (active) setState({ kind: "error", message: "연결 요청을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요." });
      }
    })();
    return () => { active = false; };
  }, [authorizationId, redirect, resolvedClient]);

  async function sendLink(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setStatus("");
    try {
      preserveAuthorizationId(authorizationId);
      await resolvedClient.sendSignInLink(email.trim(), loginRedirectUrl);
      setStatus("로그인 링크를 보냈습니다. 이메일에서 링크를 연 뒤 연결을 계속해 주세요.");
    } catch {
      setStatus("로그인 링크를 보낼 수 없습니다. 등록된 운영자 이메일인지 확인해 주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  async function decide(decision: "approve" | "deny") {
    if (state.kind !== "consent") return;
    setSubmitting(true);
    setStatus("");
    try {
      const redirectUrl = decision === "approve"
        ? await resolvedClient.approveAuthorization(state.details.authorizationId)
        : await resolvedClient.denyAuthorization(state.details.authorizationId);
      localStorage.removeItem(authorizationStorageKey);
      redirect(redirectUrl);
    } catch {
      setStatus("연결 결정을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      setSubmitting(false);
    }
  }

  return (
    <main className="oauth-consent-page">
      <section className="oauth-consent-card" aria-labelledby="oauth-consent-title">
        {state.kind === "loading" && <p role="status">연결 요청을 확인하고 있습니다.</p>}
        {state.kind === "error" && <p role="alert">{state.message}</p>}
        {state.kind === "anonymous" && (
          <>
            <p className="oauth-consent-eyebrow">모종 AI 콘텐츠</p>
            <h1 id="oauth-consent-title">콘텐츠 자동제안 연결</h1>
            <p>등록된 운영자 계정으로 로그인해야 GPT 예약이 제안 결과를 안전하게 저장할 수 있습니다.</p>
            <form onSubmit={sendLink}>
              <label htmlFor="oauth-operator-email">운영자 이메일</label>
              <input
                id="oauth-operator-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <button type="submit" disabled={submitting}>{submitting ? "전송 중" : "로그인 링크 받기"}</button>
            </form>
            {status && <p role="status">{status}</p>}
          </>
        )}
        {state.kind === "consent" && (
          <>
            <p className="oauth-consent-eyebrow">모종 AI 콘텐츠</p>
            <h1 id="oauth-consent-title">{state.details.clientName} 연결 승인</h1>
            <p>이 연결은 매일 분야별 콘텐츠 주제를 조사하고 모종에 저장하는 데 사용됩니다.</p>
            <dl>
              <div><dt>요청 앱</dt><dd>{state.details.clientName}</dd></div>
              <div><dt>돌아갈 주소</dt><dd>{new URL(state.details.redirectUri).hostname}</dd></div>
            </dl>
            <h2>요청 권한</h2>
            <ul>{state.details.scopes.map((scope) => <li key={scope}>{scopeLabels[scope] ?? scope}</li>)}</ul>
            <div className="oauth-consent-actions">
              <button type="button" disabled={submitting} onClick={() => void decide("deny")}>거부</button>
              <button type="button" disabled={submitting} onClick={() => void decide("approve")}>연결 승인</button>
            </div>
            {status && <p role="alert">{status}</p>}
          </>
        )}
      </section>
    </main>
  );
}
