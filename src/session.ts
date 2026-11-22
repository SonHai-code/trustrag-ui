// The login session on the browser side.
//  * The access token (15 min) lives only in this variable: not in localStorage, so a script injected into the page cannot read it.
//  * The refresh token is an HttpOnly cookie the browser sends to /api/auth/* by itself; this code never sees it.
//  * authFetch adds the access token, and when the server answers 401 it refreshes once (all callers share ONE refresh) and retries.
import { refreshDelayMs } from "./lib";
import type { AuthPayload, AuthUser } from "./types";

export const BASE: string = import.meta.env.VITE_API_BASE ?? "/api";
/** Build the UI without accounts (local demo against a gateway with AUTH_REQUIRED=false): VITE_AUTH=off */
export const AUTH_ENABLED: boolean = import.meta.env.VITE_AUTH !== "off";

let accessToken = "";
let expiresAt = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let inflight: Promise<AuthPayload | null> | null = null;

type Listener = { onSession: (user: AuthUser) => void; onEnded: () => void };
let listener: Listener | null = null;

/** App registers once: onSession when a token was (re)issued, onEnded when the server says the session is over. */
export const setSessionListener = (l: Listener | null) => {
  listener = l;
};

export class ApiError extends Error {
  status: number;
  retryAfter?: number;
  constructor(message: string, status: number, retryAfter?: number) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export async function fail(res: Response): Promise<never> {
  let detail = `${res.status} ${res.statusText}`;
  try {
    const body = await res.json();
    if (typeof body.detail === "string") detail = body.detail;
    else if (body.detail) detail = JSON.stringify(body.detail);
  } catch {
    /* keep default */
  }
  const ra = Number(res.headers.get("Retry-After"));
  throw new ApiError(detail, res.status, Number.isFinite(ra) && ra > 0 ? ra : undefined);
}

function adopt(p: AuthPayload) {
  accessToken = p.access_token;
  expiresAt = Date.now() + p.expires_in * 1000;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void refreshSession(), refreshDelayMs(p.expires_in));
  listener?.onSession(p.user);
}

/** Forget the token (logout, or the server ended the session). */
export function clearSession() {
  accessToken = "";
  expiresAt = 0;
  if (timer) clearTimeout(timer);
  timer = undefined;
}

export const hasToken = () => accessToken !== "";

/** Called after login / register, with the response of those endpoints. */
export const startSession = (p: AuthPayload) => adopt(p);

async function doRefresh(): Promise<AuthPayload | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${BASE}/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    } catch {
      return null; // offline: keep the session, try again later
    }
    if (res.ok) {
      const p: AuthPayload = await res.json();
      adopt(p);
      return p;
    }
    if (res.status === 409 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 300)); // another tab refreshed at the same moment: its cookie is now valid
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      clearSession();
      listener?.onEnded();
    }
    return null; // 5xx / 429: the session may still be fine
  }
  return null;
}

/** Exchange the cookie for a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<AuthPayload | null> {
  inflight ??= doRefresh().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Come back to a sleeping tab: timers were paused, so check the token and renew it if it is about to expire. */
export function renewIfStale() {
  if (accessToken && expiresAt - Date.now() < 60_000) void refreshSession();
}

// these answer 401 for "wrong password" / "no cookie": renewing the token would not change that
const SIGN_IN_PATHS = new Set(["/auth/login", "/auth/register", "/auth/refresh", "/auth/logout"]);

/** fetch() against the API with the access token; one transparent refresh + retry on 401. */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const send = () => {
    const headers = new Headers(init.headers);
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    return fetch(`${BASE}${path}`, { ...init, headers });
  };
  let res = await send();
  if (res.status === 401 && AUTH_ENABLED && !SIGN_IN_PATHS.has(path)) {
    const renewed = await refreshSession();
    if (renewed) res = await send();
  }
  return res;
}
