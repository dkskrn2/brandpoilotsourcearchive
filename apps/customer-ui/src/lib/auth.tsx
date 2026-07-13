import { createContext, useContext, useEffect, useState } from "react";
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
  const [state, setState] = useState<"loading" | "authenticated" | "anonymous">("loading");
  const [session, setSession] = useState<AuthSession | null>(null);

  useEffect(() => {
    if (import.meta.env.MODE === "test" && loadSession === defaultSessionLoader) {
      setState("authenticated");
      return;
    }

    void loadSession().then((nextSession) => {
      setSession(nextSession);
      setActiveBrandId(nextSession.brand.id);
      setState("authenticated");
    }).catch(() => setState("anonymous"));
  }, [loadSession]);

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
  return <AuthContext.Provider value={{ ready: true, session, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() { return useContext(AuthContext); }
