import { loadSettings } from "@/lib/app-settings";
import type { ForumQuestion } from "@/lib/types";

const AUTH_ACCESS_LS_KEY = "ink-aesthetics-ai.auth.access_token.v2";

function baseUrl() {
  return loadSettings().backendBaseUrl.replace(/\/$/, "");
}

function authHeaders(): Record<string, string> {
  const token = (localStorage.getItem(AUTH_ACCESS_LS_KEY) || "").trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readError(res: Response): Promise<Error> {
  const text = await res.text().catch(() => "");
  if (!text) return new Error(`HTTP ${res.status}`);
  try {
    const data = JSON.parse(text) as { detail?: string };
    if (data?.detail) return new Error(String(data.detail));
  } catch {
    // ignore
  }
  return new Error(text);
}

type ForumListResponse = {
  items: ForumQuestion[];
  page: number;
  page_size: number;
  total: number;
};

export type ForumListQuery = {
  page?: number;
  page_size?: number;
  q?: string;
  tag?: string;
  sort?: "hot" | "latest" | "unanswered";
};

export async function fetchForumQuestions(input?: ForumListQuery) {
  const params = new URLSearchParams();
  if (typeof input?.page === "number") params.set("page", String(input.page));
  if (typeof input?.page_size === "number") params.set("page_size", String(input.page_size));
  if ((input?.q || "").trim()) params.set("q", String(input?.q || "").trim());
  if ((input?.tag || "").trim()) params.set("tag", String(input?.tag || "").trim());
  if ((input?.sort || "").trim()) params.set("sort", String(input?.sort || "").trim());
  const query = params.toString();
  const res = await fetch(`${baseUrl()}/api/forum/questions${query ? `?${query}` : ""}`, {
    method: "GET",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as ForumListResponse;
}

export async function askForumQuestion(input: {
  title: string;
  content: string;
  tags?: string[];
  invited_user_ids?: string[];
}) {
  const res = await fetch(`${baseUrl()}/api/forum/questions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { item: ForumQuestion };
}

export async function answerForumQuestion(questionId: string, content: string) {
  const res = await fetch(`${baseUrl()}/api/forum/questions/${encodeURIComponent(questionId)}/answers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { item: ForumQuestion };
}

export async function toggleForumSolved(questionId: string) {
  const res = await fetch(`${baseUrl()}/api/forum/questions/${encodeURIComponent(questionId)}/toggle-solved`, {
    method: "POST",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { item: ForumQuestion };
}

export async function toggleForumLike(questionId: string) {
  const res = await fetch(`${baseUrl()}/api/forum/questions/${encodeURIComponent(questionId)}/toggle-like`, {
    method: "POST",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { item: ForumQuestion };
}

export async function inviteForumAnswer(questionId: string, invited_user_ids: string[]) {
  const res = await fetch(`${baseUrl()}/api/forum/questions/${encodeURIComponent(questionId)}/invite`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ invited_user_ids }),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { item: ForumQuestion };
}
