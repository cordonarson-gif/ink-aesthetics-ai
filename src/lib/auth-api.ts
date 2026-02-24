import type { AppSettings } from "@/lib/app-settings";

export type AuthUser = {
  id: string;
  username: string;
  display_name: string;
  email?: string | null;
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
  return s.backendAdminToken?.trim()
    ? { "X-InkAI-Token": s.backendAdminToken.trim() }
    : {};
}

async function readError(res: Response): Promise<Error> {
  const text = await res.text().catch(() => "");
  if (!text) return new Error(`HTTP ${res.status}`);
  try {
    const data = JSON.parse(text) as { detail?: string };
    if (data?.detail) return new Error(String(data.detail));
  } catch {
    // ignore parse error
  }
  return new Error(text);
}

export async function authSendCode(
  s: AppSettings,
  payload: {
    email: string;
    purpose: "register" | "login";
    captcha_token?: string;
  },
) {
  const res = await fetch(`${base(s)}/api/auth/send-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders(s) },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as {
    ok: boolean;
    message: string;
    dev_code?: string | null;
  };
}

export async function authRegister(
  s: AppSettings,
  payload: {
    username: string;
    email: string;
    code: string;
    password: string;
    display_name?: string;
    captcha_token?: string;
  },
) {
  const res = await fetch(`${base(s)}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders(s) },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as TokenPair;
}

export async function authLoginPassword(
  s: AppSettings,
  payload: { account: string; password: string; captcha_token?: string },
) {
  const res = await fetch(`${base(s)}/api/auth/login/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders(s) },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as TokenPair;
}

export async function authLoginEmail(
  s: AppSettings,
  payload: { email: string; code: string; captcha_token?: string },
) {
  const res = await fetch(`${base(s)}/api/auth/login/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders(s) },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as TokenPair;
}

export async function authLoginOAuthMock(
  s: AppSettings,
  payload: { provider: "qq" | "wechat" },
) {
  const res = await fetch(`${base(s)}/api/auth/login/oauth-mock`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders(s) },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as TokenPair;
}

export async function authRefresh(s: AppSettings, refresh_token: string) {
  const res = await fetch(`${base(s)}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders(s) },
    body: JSON.stringify({ refresh_token }),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as TokenPair;
}

export async function authMe(s: AppSettings, accessToken: string) {
  const res = await fetch(`${base(s)}/api/auth/me`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}`, ...adminHeaders(s) },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as AuthUser;
}

export async function authUpdateMe(
  s: AppSettings,
  accessToken: string,
  payload: { display_name: string },
) {
  const res = await fetch(`${base(s)}/api/auth/me`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...adminHeaders(s),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as AuthUser;
}

export async function authChangePassword(
  s: AppSettings,
  accessToken: string,
  payload: { old_password: string; new_password: string },
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
  if (!res.ok) throw await readError(res);
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
