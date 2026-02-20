import type { AppSettings } from "@/lib/app-settings";

export type AuthUser = {
  id: string;
  username: string;
  display_name: string;
  phone?: string | null;
  created_at: string;
};

export type TokenPair = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: AuthUser;
};

function base(s: AppSettings) {
  return s.backendBaseUrl.replace(/\/$/, "");
}

function adminHeaders(s: AppSettings): Record<string, string> {
  return s.backendAdminToken?.trim() ? { "X-InkAI-Token": s.backendAdminToken.trim() } : {};
}

export async function authSendCode(s: AppSettings, payload: { phone: string; purpose: "register" | "login" }) {
  const res = await fetch(`${base(s)}/api/auth/send-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders(s) },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as { ok: boolean; message: string; dev_code?: string | null };
}

export async function authRegister(
  s: AppSettings,
  payload: { username: string; phone: string; code: string; password: string; display_name?: string }
) {
  const res = await fetch(`${base(s)}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders(s) },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as TokenPair;
}

export async function authLoginPassword(s: AppSettings, payload: { account: string; password: string }) {
  const res = await fetch(`${base(s)}/api/auth/login/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders(s) },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as TokenPair;
}

export async function authLoginSms(s: AppSettings, payload: { phone: string; code: string }) {
  const res = await fetch(`${base(s)}/api/auth/login/sms`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders(s) },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as TokenPair;
}

export async function authLoginOAuthMock(s: AppSettings, payload: { provider: "qq" | "wechat" }) {
  const res = await fetch(`${base(s)}/api/auth/login/oauth-mock`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders(s) },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as TokenPair;
}

export async function authRefresh(s: AppSettings, refresh_token: string) {
  const res = await fetch(`${base(s)}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders(s) },
    body: JSON.stringify({ refresh_token }),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as TokenPair;
}

export async function authMe(s: AppSettings, accessToken: string) {
  const res = await fetch(`${base(s)}/api/auth/me`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}`, ...adminHeaders(s) },
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as AuthUser;
}

export async function authUpdateMe(s: AppSettings, accessToken: string, payload: { display_name: string }) {
  const res = await fetch(`${base(s)}/api/auth/me`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...adminHeaders(s),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as AuthUser;
}

export async function authChangePassword(
  s: AppSettings,
  accessToken: string,
  payload: { old_password: string; new_password: string }
) {
  const res = await fetch(`${base(s)}/api/auth/me/password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...adminHeaders(s),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as { ok: boolean };
}

export async function authLogout(s: AppSettings, refresh_token: string | null) {
  if (!refresh_token) return;
  await fetch(`${base(s)}/api/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders(s) },
    body: JSON.stringify({ refresh_token }),
  }).catch(() => undefined);
}
