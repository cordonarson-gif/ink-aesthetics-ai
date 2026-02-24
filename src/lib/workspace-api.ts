import { loadSettings } from "@/lib/app-settings";

const AUTH_ACCESS_LS_KEY = "ink-aesthetics-ai.auth.access_token.v2";

function baseUrl() {
  return loadSettings().backendBaseUrl.replace(/\/$/, "");
}

function accessToken(): string {
  return (localStorage.getItem(AUTH_ACCESS_LS_KEY) || "").trim();
}

function authHeaders(): Record<string, string> {
  const token = accessToken();
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

export type PromptVersionItem = {
  id: string;
  user_id: string;
  raw_prompt: string;
  artistic_prompt: string;
  content_hash: string;
  created_at: string;
};

export type PromptPresetItem = {
  id: string;
  user_id: string;
  name: string;
  category: string;
  prompt_hint: string;
  params: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export async function fetchPromptVersions(limit = 50) {
  const params = new URLSearchParams({ limit: String(limit) });
  const res = await fetch(`${baseUrl()}/api/workspace/prompt-versions?${params.toString()}`, {
    method: "GET",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { items: PromptVersionItem[] };
}

export async function savePromptVersion(input: { raw_prompt: string; artistic_prompt?: string }) {
  const res = await fetch(`${baseUrl()}/api/workspace/prompt-versions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { item: PromptVersionItem };
}

export async function fetchPromptPresets(category?: string) {
  const params = new URLSearchParams();
  if ((category || "").trim()) params.set("category", String(category));
  const query = params.toString();
  const res = await fetch(`${baseUrl()}/api/workspace/presets${query ? `?${query}` : ""}`, {
    method: "GET",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { items: PromptPresetItem[] };
}

export async function createPromptPreset(input: {
  name: string;
  category?: string;
  prompt_hint?: string;
  params: Record<string, unknown>;
}) {
  const res = await fetch(`${baseUrl()}/api/workspace/presets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { item: PromptPresetItem };
}

export async function updatePromptPreset(
  presetId: string,
  input: {
    name: string;
    category?: string;
    prompt_hint?: string;
    params: Record<string, unknown>;
  }
) {
  const res = await fetch(`${baseUrl()}/api/workspace/presets/${encodeURIComponent(presetId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { item: PromptPresetItem };
}

export async function deletePromptPreset(presetId: string) {
  const res = await fetch(`${baseUrl()}/api/workspace/presets/${encodeURIComponent(presetId)}`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { ok: boolean };
}

export type GenerationTaskState = {
  task_id: string;
  status: string;
  progress: number;
  failure_reason?: string;
  paused?: boolean;
  cancelled?: boolean;
  queue_message_id?: string | null;
  updated_at?: string;
};

export async function fetchGenerationTaskState(taskId: string) {
  const res = await fetch(`${baseUrl()}/api/generation/tasks/${encodeURIComponent(taskId)}`, {
    method: "GET",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { item: GenerationTaskState };
}

async function postTaskAction(taskId: string, action: "pause" | "resume" | "cancel") {
  const res = await fetch(`${baseUrl()}/api/generation/tasks/${encodeURIComponent(taskId)}/${action}`, {
    method: "POST",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { item: GenerationTaskState };
}

export function pauseGenerationTask(taskId: string) {
  return postTaskAction(taskId, "pause");
}

export function resumeGenerationTask(taskId: string) {
  return postTaskAction(taskId, "resume");
}

export function cancelGenerationTask(taskId: string) {
  return postTaskAction(taskId, "cancel");
}

export function connectGenerationProgress(taskId: string, onMessage: (state: GenerationTaskState) => void): WebSocket {
  const base = baseUrl();
  const url = new URL(base);
  const scheme = url.protocol === "https:" ? "wss:" : "ws:";
  const token = encodeURIComponent(accessToken());
  const wsUrl = `${scheme}//${url.host}/api/ws/generation/${encodeURIComponent(taskId)}?token=${token}`;
  const ws = new WebSocket(wsUrl);
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(String(event.data || "{}")) as GenerationTaskState;
      if (data?.task_id) onMessage(data);
    } catch {
      // ignore malformed ws payload
    }
  };
  return ws;
}
