import { loadSettings } from "@/lib/app-settings";

const AUTH_ACCESS_LS_KEY = "ink-aesthetics-ai.auth.access_token.v2";

export type FeedbackCategory = "general" | "bug" | "feature" | "abuse" | "other";

export type FeedbackItem = {
  id: number;
  user_id: string;
  user_name: string;
  category: FeedbackCategory | string;
  title: string;
  content: string;
  contact: string;
  status: "open" | "resolved" | string;
  admin_note: string;
  created_at: string;
  replied_at: string | null;
  user_read_at: string | null;
  has_unread_reply: boolean;
  resolved_at: string | null;
};

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

export async function submitFeedback(input: {
  category: FeedbackCategory;
  title: string;
  content: string;
  contact?: string;
}) {
  const res = await fetch(`${baseUrl()}/api/feedback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { item: FeedbackItem };
}

export async function fetchMyFeedback(limit = 100) {
  const params = new URLSearchParams({ limit: String(limit) });
  const res = await fetch(`${baseUrl()}/api/feedback/mine?${params.toString()}`, {
    method: "GET",
    headers: {
      ...authHeaders(),
    },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { items: FeedbackItem[]; unread_reply_count: number };
}

export async function markFeedbackRead(feedbackId: number) {
  const res = await fetch(`${baseUrl()}/api/feedback/${feedbackId}/read`, {
    method: "POST",
    headers: {
      ...authHeaders(),
    },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { item: FeedbackItem };
}
