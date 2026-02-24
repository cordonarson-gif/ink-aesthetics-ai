import { loadSettings } from "@/lib/app-settings";

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

export async function selectGenerationImage(input: {
  generation_task_id: string;
  selected_candidate_id: string;
}) {
  const res = await fetch(`${baseUrl()}/api/generation/select`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as {
    task_id: string;
    selected_candidate_id: string;
    sequence: number;
    selected_code: string;
    items: Array<{
      candidate_id: string;
      image_code?: string | null;
      image_bucket?: string | null;
      candidate_index: number;
    }>;
  };
}
