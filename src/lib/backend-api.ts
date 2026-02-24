import type { AppSettings } from "@/lib/app-settings";
import type { DeepSeekChatMessage } from "@/lib/deepseek-chat";

const AUTH_ACCESS_LS_KEY = "ink-aesthetics-ai.auth.access_token.v2";

function base(s: AppSettings) {
  return s.backendBaseUrl.replace(/\/$/, "");
}

function currentAccessToken(): string {
  try {
    const raw = localStorage.getItem(AUTH_ACCESS_LS_KEY);
    return (raw || "").trim();
  } catch {
    return "";
  }
}

function authHeaders(s: AppSettings): Record<string, string> {
  const headers: Record<string, string> = {};
  if (s.backendAdminToken?.trim()) headers["X-InkAI-Token"] = s.backendAdminToken.trim();
  const accessToken = currentAccessToken();
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

async function readError(res: Response): Promise<Error> {
  const text = await res.text().catch(() => "");
  if (!text) return new Error(`HTTP ${res.status}`);
  try {
    const data = JSON.parse(text) as { detail?: string };
    if (data?.detail) return new Error(String(data.detail));
  } catch {
    // ignore JSON parse errors
  }
  return new Error(text);
}

function shouldUsePublicFallback(status: number, err: Error): boolean {
  if (status !== 401) return false;
  return /missing bearer token/i.test(String(err.message || ""));
}

export async function backendDeepSeekChat(s: AppSettings, messages: DeepSeekChatMessage[]) {
  const payload = JSON.stringify({ messages });
  const headers = {
    "Content-Type": "application/json",
    ...authHeaders(s),
  };
  let res = await fetch(`${base(s)}/api/deepseek/chat`, {
    method: "POST",
    headers,
    body: payload,
  });
  if (!res.ok) {
    const primaryErr = await readError(res);
    if (shouldUsePublicFallback(res.status, primaryErr)) {
      res = await fetch(`${base(s)}/api/public/deepseek/chat`, {
        method: "POST",
        headers,
        body: payload,
      });
      if (!res.ok) throw await readError(res);
    } else {
      throw primaryErr;
    }
  }
  const data = (await res.json()) as { content: string };
  return data.content;
}

export async function backendPromptOptimize(s: AppSettings, rawPrompt: string) {
  const payload = JSON.stringify({ raw_prompt: rawPrompt });
  const headers = {
    "Content-Type": "application/json",
    ...authHeaders(s),
  };
  let res = await fetch(`${base(s)}/api/prompt/optimize`, {
    method: "POST",
    headers,
    body: payload,
  });
  if (!res.ok) {
    const primaryErr = await readError(res);
    if (shouldUsePublicFallback(res.status, primaryErr)) {
      res = await fetch(`${base(s)}/api/public/prompt/optimize`, {
        method: "POST",
        headers,
        body: payload,
      });
      if (!res.ok) throw await readError(res);
    } else {
      throw primaryErr;
    }
  }
  const data = (await res.json()) as { artistic_prompt: string };
  return data.artistic_prompt;
}

export async function backendLiblibaiGen(s: AppSettings, rawPrompt: string) {
  const res = await fetch(`${base(s)}/api/liblibai/gen-img`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(s),
    },
    body: JSON.stringify({ raw_prompt: rawPrompt }),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as {
    images: string[];
    artistic_prompt: string;
    used_prompt: string;
    generation_task_id?: string;
    candidate_ids?: string[];
    candidate_indexes?: number[];
    meta: Record<string, unknown>;
  };
}
