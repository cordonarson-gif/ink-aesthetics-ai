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

export async function backendDeepSeekChat(s: AppSettings, messages: DeepSeekChatMessage[]) {
  const res = await fetch(`${base(s)}/api/deepseek/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(s),
    },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { content: string };
  return data.content;
}

export async function backendPromptOptimize(s: AppSettings, rawPrompt: string) {
  const res = await fetch(`${base(s)}/api/prompt/optimize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(s),
    },
    body: JSON.stringify({ raw_prompt: rawPrompt }),
  });
  if (!res.ok) throw new Error(await res.text());
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
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as {
    images: string[];
    artistic_prompt: string;
    used_prompt: string;
    meta: Record<string, unknown>;
  };
}
