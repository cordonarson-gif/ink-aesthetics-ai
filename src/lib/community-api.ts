import { loadSettings } from "@/lib/app-settings";
import type { PublishedArtwork } from "@/lib/types";

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

type CommunityListResponse = {
  items: PublishedArtwork[];
  page: number;
  page_size: number;
  total: number;
};

export async function fetchFollowingFeed(input?: { page?: number; page_size?: number }) {
  const params = new URLSearchParams();
  if (typeof input?.page === "number") params.set("page", String(input.page));
  if (typeof input?.page_size === "number") params.set("page_size", String(input.page_size));
  const query = params.toString();
  const res = await fetch(`${baseUrl()}/api/community/feed/following${query ? `?${query}` : ""}`, {
    method: "GET",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as CommunityListResponse;
}

export async function fetchFollowingUsers() {
  const res = await fetch(`${baseUrl()}/api/community/following`, {
    method: "GET",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { items: string[] };
}

export async function toggleFollowAuthor(targetUserId: string) {
  const res = await fetch(`${baseUrl()}/api/community/follow/${encodeURIComponent(targetUserId)}`, {
    method: "POST",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { following: boolean; target_user_id: string };
}

export async function fetchCommunityPosts(input?: {
  page?: number;
  page_size?: number;
  owner_only?: boolean;
  include_hidden?: boolean;
}) {
  const params = new URLSearchParams();
  if (typeof input?.page === "number") params.set("page", String(input.page));
  if (typeof input?.page_size === "number") params.set("page_size", String(input.page_size));
  if (typeof input?.owner_only === "boolean") params.set("owner_only", String(input.owner_only));
  if (typeof input?.include_hidden === "boolean") params.set("include_hidden", String(input.include_hidden));
  const query = params.toString();
  const res = await fetch(`${baseUrl()}/api/community/posts${query ? `?${query}` : ""}`, {
    method: "GET",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as CommunityListResponse;
}

export async function publishCommunityPost(payload: {
  archive_id?: string;
  publish_source: "generated" | "upload";
  title: string;
  data_url: string;
  prompt_artistic?: string;
  params?: Record<string, unknown>;
  created_at?: string;
  published_at?: string;
  ai_generated?: boolean;
  ai_label?: string;
  minted?: boolean;
}) {
  const res = await fetch(`${baseUrl()}/api/community/posts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { item: PublishedArtwork };
}

export async function removeCommunityPost(postId: string) {
  const res = await fetch(`${baseUrl()}/api/community/posts/${encodeURIComponent(postId)}`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { ok: boolean };
}

export async function toggleCommunityLike(postId: string) {
  const res = await fetch(`${baseUrl()}/api/community/posts/${encodeURIComponent(postId)}/toggle-like`, {
    method: "POST",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { item: PublishedArtwork };
}

export async function addCommunityComment(postId: string, content: string) {
  const res = await fetch(`${baseUrl()}/api/community/posts/${encodeURIComponent(postId)}/comments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { item: PublishedArtwork };
}

export async function reportCommunityPost(postId: string, reason: string) {
  const res = await fetch(`${baseUrl()}/api/community/posts/${encodeURIComponent(postId)}/reports`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { item: PublishedArtwork };
}
