import { loadSettings } from "@/lib/app-settings";

const AUTH_ACCESS_LS_KEY = "ink-aesthetics-ai.auth.access_token.v2";

export type DashboardRange = "hour" | "day" | "week" | "month";

type ThresholdPayload = {
  api_fail_rate_threshold?: number;
  online_surge_threshold?: number;
  online_drop_threshold?: number;
  refresh_interval_sec?: number;
};

type ApiPermissionPayload = {
  path: string;
  enabled: boolean;
  note?: string;
};

function baseUrl() {
  return loadSettings().backendBaseUrl.replace(/\/$/, "");
}

function authHeaders(): Record<string, string> {
  const token = (localStorage.getItem(AUTH_ACCESS_LS_KEY) || "").trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readError(res: Response): Promise<Error> {
  const text = await res.text();
  return new Error(text || `HTTP ${res.status}`);
}

export async function fetchSuperDashboard(rangeKey: DashboardRange, detailLimit = 200) {
  const params = new URLSearchParams({
    range_key: rangeKey,
    detail_limit: String(detailLimit),
  });
  const res = await fetch(`${baseUrl()}/api/admin/super-dashboard?${params.toString()}`, {
    method: "GET",
    headers: {
      ...authHeaders(),
    },
  });
  if (!res.ok) throw await readError(res);
  return await res.json();
}

export async function patchThresholds(payload: ThresholdPayload) {
  const res = await fetch(`${baseUrl()}/api/admin/thresholds`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res);
  return await res.json();
}

export async function fetchApiPermissions() {
  const res = await fetch(`${baseUrl()}/api/admin/api-permissions`, {
    method: "GET",
    headers: {
      ...authHeaders(),
    },
  });
  if (!res.ok) throw await readError(res);
  return await res.json();
}

export async function putApiPermission(payload: ApiPermissionPayload) {
  const res = await fetch(`${baseUrl()}/api/admin/api-permissions`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res);
  return await res.json();
}

export async function resolveAlert(alertId: number, note?: string) {
  const res = await fetch(`${baseUrl()}/api/admin/alerts/${alertId}/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ note: note || "" }),
  });
  if (!res.ok) throw await readError(res);
  return await res.json();
}

export async function exportDashboard(scope: "all" | "api" | "online" | "traffic" | "users" = "all") {
  const params = new URLSearchParams({ scope });
  const res = await fetch(`${baseUrl()}/api/admin/export.xlsx?${params.toString()}`, {
    method: "GET",
    headers: {
      ...authHeaders(),
    },
  });
  if (!res.ok) throw await readError(res);
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `inkai-super-dashboard-${scope}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(href);
}
