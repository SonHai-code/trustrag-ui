import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import * as api from "./api";
import { AUTH_ENABLED, clearSession, refreshSession, renewIfStale, setSessionListener } from "./session";
import type { AuthUser } from "./types";

/** loading: asking the server whether the cookie is still good · anon: show the login page · authed · offline: server not reachable */
export type AuthStatus = "loading" | "anon" | "authed" | "offline";

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (u: AuthUser) => void;
  retry: () => void;
}

const Ctx = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}

const LOCAL_USER: AuthUser = { id: "local", email: "", name: "Khách", role: "user", createdAt: "" };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(AUTH_ENABLED ? "loading" : "authed");
  const [user, setUser] = useState<AuthUser | null>(AUTH_ENABLED ? null : LOCAL_USER);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!AUTH_ENABLED) return;
    setSessionListener({
      onSession: (u) => {
        setUser(u);
        setStatus("authed");
      },
      onEnded: () => {
        setUser(null);
        setStatus("anon");
      },
    });
    let alive = true;
    setStatus("loading");
    // a returning visitor: the refresh cookie (if any) is exchanged for an access token before anything is shown
    refreshSession().then((p) => {
      if (alive && !p) setStatus((s) => (s === "loading" ? "offline" : s));
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") renewIfStale();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      setSessionListener(null);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [attempt]);

  const signIn = useCallback(async (email: string, password: string) => {
    setUser(await api.login(email, password));
    setStatus("authed");
  }, []);
  const signUp = useCallback(async (email: string, password: string, name: string) => {
    setUser(await api.register(email, password, name));
    setStatus("authed");
  }, []);
  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      clearSession();
    }
    setUser(null);
    setStatus("anon");
  }, []);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const value = useMemo(() => ({ status, user, signIn, signUp, signOut, setUser, retry }), [status, user, signIn, signUp, signOut, retry]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
