import { loadSettings } from "@/lib/app-settings";

const AUTH_ACCESS_LS_KEY = "ink-aesthetics-ai.auth.access_token.v2";

export type NotificationItem = {
  id: number;
  user_id: string;
  type:
    | "EXPORT_SUCCESS"
    | "EXPORT_FAILED"
    | "MODERATION_TICKET_ASSIGNED"
    | "MODERATION_APPEAL_SUBMITTED"
    | string;
  title: string;
  content: string;
  related_id?: string | null;
  is_read: boolean;
  created_at: string;
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
    // ignore parse error
  }
  return new Error(text);
}

export async function fetchNotifications(page = 1, page_size = 10) {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(page_size),
  });
  const res = await fetch(`${baseUrl()}/api/notifications?${params.toString()}`, {
    method: "GET",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as {
    items: NotificationItem[];
    page: number;
    page_size: number;
    total: number;
  };
}

export async function fetchUnreadNotificationCount() {
  const res = await fetch(`${baseUrl()}/api/notifications/unread-count`, {
    method: "GET",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { unread_count: number };
}

export async function markNotificationRead(notificationId: number) {
  const res = await fetch(`${baseUrl()}/api/notifications/${notificationId}/read`, {
    method: "PUT",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { item: NotificationItem };
}

export async function markAllNotificationsRead() {
  const res = await fetch(`${baseUrl()}/api/notifications/read-all`, {
    method: "PUT",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { updated: number };
}
