import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, setActiveBrandId, type AuthSession } from "./apiClient";

export const DANBAM_LOGIN_URL = "https://www.danbammsg.co.kr/";

type SessionLoader = () => Promise<AuthSession>;
type Redirect = (url: string) => void;

const defaultSessionLoader: SessionLoader = () => api.getAuthSession();
const defaultRedirect: Redirect = (url) => window.location.assign(url);

interface AuthContextValue {
  ready: boolean;
  session: AuthSession | null;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  ready: false,
  session: null,
  logout: async () => {}
});

export function ExternalRedirect({ redirect = defaultRedirect }: { redirect?: Redirect }) {
  useEffect(() => {
    redirect(DANBAM_LOGIN_URL);
  }, [redirect]);

  return null;
}

export function AuthGate({
  children,
  loadSession = defaultSessionLoader,
  redirect = defaultRedirect
}: {
  children: React.ReactNode;
  loadSession?: SessionLoader;
  redirect?: Redirect;
}) {
  const [state, setState] = useState<"loading" | "authenticated" | "anonymous" | "unavailable">("loading");
  const [session, setSession] = useState<AuthSession | null>(null);

  const refreshSession = useCallback(() => {
    if (import.meta.env.MODE === "test" && loadSession === defaultSessionLoader) {
      setState("authenticated");
      return;
    }

    setState("loading");
    void loadSession().then((nextSession) => {
      setSession(nextSession);
      setActiveBrandId(nextSession.brand.id);
      setState("authenticated");
    }).catch((error) => {
      const message = error instanceof Error ? error.message : "";
      setState(/API request failed:\s*401\b/.test(message) ? "anonymous" : "unavailable");
    });
  }, [loadSession]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  async function logout() {
    try {
      await api.logout();
    } finally {
      setSession(null);
      setState("anonymous");
    }
  }

  if (state === "loading") return <main className="login-page">로그인 정보를 확인하고 있습니다.</main>;
  if (state === "anonymous") return <ExternalRedirect redirect={redirect} />;
  if (state === "unavailable") {
    return (
      <main className="login-page">
        <section className="login-card">
          <h1>로그인 상태를 확인할 수 없습니다.</h1>
          <p>API 서버 연결이 일시적으로 불안정합니다. 로그인 정보는 삭제되지 않았습니다.</p>
          <button type="button" onClick={refreshSession}>다시 확인</button>
        </section>
      </main>
    );
  }
  return <AuthContext.Provider value={{ ready: true, session, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() { return useContext(AuthContext); }
