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

export type AdminFeedbackItem = {
  id: number;
  user_id: string;
  user_name: string;
  category: string;
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

export type OperationCosts = {
  prompt_optimize: number;
  liblibai_gen_img: number;
  deepseek_chat: number;
};

export type OperationCostsPatch = Partial<OperationCosts>;

export type PromptGuardConfig = {
  enabled: boolean;
  blocked_terms: string[];
};

export type DataCenterImageItem = {
  row_no: number;
  candidate_id: string;
  task_id: string;
  user_id: string;
  candidate_index: number;
  data_url: string;
  image_code: string;
  image_bucket: "selected" | "rejected" | string;
  assigned_seq: number | null;
  assigned_at: string | null;
  created_at: string;
};

export type AdminStatsRange = "hour" | "day" | "week" | "month";

export type AdminStatsAllResponse = {
  generated_at: string;
  range_key: AdminStatsRange;
  realtime: {
    generated_at: string;
    cards: {
      today_generation_images: number;
      online_users: number;
      today_api_calls: number;
      today_api_errors: number;
      today_api_failure_rate: number;
      today_new_users: number;
      today_pv: number;
      today_uv: number;
      avg_latency_last_hour_ms: number;
    };
  };
  user_growth: {
    range_key: AdminStatsRange;
    series: Array<{ bucket: string; new_users: number; total_users: number }>;
  };
  generation: {
    range_key: AdminStatsRange;
    series: Array<{ bucket: string; task_total: number; completed_total: number }>;
  };
  api_latency: {
    range_key: AdminStatsRange;
    trend: Array<{ bucket: string; calls: number; avg_latency_ms: number }>;
    histogram: Array<{ bucket: string; count: number }>;
  };
  read_from: string;
};

export type ModerationTicketItem = {
  id: string;
  source: string;
  content_type: "community_post" | "forum_question" | "forum_answer" | "community_comment" | string;
  content_id: string;
  report_id?: string | null;
  status: "pending" | "approved" | "rejected" | "appealed" | "final_judgment" | string;
  machine_result: "pass" | "review" | "reject" | string;
  machine_reason: string;
  assigned_admin_user_id?: string | null;
  assigned_admin_user_name?: string;
  decision_reason?: string;
  appeal_reason?: string;
  final_result?: "approved" | "rejected" | string | null;
  created_by_user_id?: string | null;
  created_at: string;
  claimed_at?: string | null;
  decided_at?: string | null;
  appealed_at?: string | null;
  final_judged_at?: string | null;
  updated_at: string;
  content_meta?: Record<string, unknown>;
  logs?: ModerationTicketLogItem[];
};

export type ModerationTicketLogItem = {
  id: number;
  ticket_id: string;
  action: string;
  actor_user_id?: string | null;
  actor_user_name?: string;
  from_status?: string;
  to_status?: string;
  note?: string;
  meta?: Record<string, unknown>;
  created_at: string;
};

export type AdminExportTaskItem = {
  task_id: string;
  request_user_id: string;
  scope: "all" | "api" | "online" | "traffic" | "users" | "billing" | string;
  file_format: "xlsx" | string;
  status: "pending" | "processing" | "running" | "completed" | "failed" | string;
  progress: number;
  download_token?: string;
  download_url?: string | null;
  error?: string;
  file_size?: number;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
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

export async function fetchAdminStatsAll(rangeKey: AdminStatsRange = "day") {
  const params = new URLSearchParams({ range_key: rangeKey });
  const res = await fetch(`${baseUrl()}/api/admin/stats/all?${params.toString()}`, {
    method: "GET",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as AdminStatsAllResponse;
}

export async function fetchModerationTickets(input?: {
  status?: string;
  content_type?: string;
  page?: number;
  page_size?: number;
}) {
  const params = new URLSearchParams();
  if ((input?.status || "").trim()) params.set("status", String(input?.status || "").trim());
  if ((input?.content_type || "").trim()) params.set("content_type", String(input?.content_type || "").trim());
  if (typeof input?.page === "number") params.set("page", String(input.page));
  if (typeof input?.page_size === "number") params.set("page_size", String(input.page_size));
  const res = await fetch(`${baseUrl()}/api/admin/moderation/tickets?${params.toString()}`, {
    method: "GET",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as {
    items: ModerationTicketItem[];
    page: number;
    page_size: number;
    total: number;
  };
}

export async function fetchModerationTicketDetail(ticketId: string) {
  const res = await fetch(`${baseUrl()}/api/admin/moderation/tickets/${encodeURIComponent(ticketId)}`, {
    method: "GET",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { item: ModerationTicketItem };
}

export async function claimModerationTicket(ticketId: string, force = false) {
  const params = new URLSearchParams();
  if (force) params.set("force", "true");
  const res = await fetch(
    `${baseUrl()}/api/admin/moderation/tickets/${encodeURIComponent(ticketId)}/claim${params.toString() ? `?${params.toString()}` : ""}`,
    {
      method: "POST",
      headers: { ...authHeaders() },
    },
  );
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { item: ModerationTicketItem };
}

export async function decideModerationTicket(ticketId: string, action: "approved" | "rejected", note?: string) {
  const res = await fetch(`${baseUrl()}/api/admin/moderation/tickets/${encodeURIComponent(ticketId)}/decision`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ action, note: note || "" }),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { item: ModerationTicketItem };
}

export async function finalJudgeModerationTicket(
  ticketId: string,
  final_result: "approved" | "rejected",
  note?: string,
) {
  const res = await fetch(`${baseUrl()}/api/admin/moderation/tickets/${encodeURIComponent(ticketId)}/final-judgment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ final_result, note: note || "" }),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { item: ModerationTicketItem };
}

export async function appealModerationTicket(ticketId: string, reason: string) {
  const res = await fetch(`${baseUrl()}/api/moderation/tickets/${encodeURIComponent(ticketId)}/appeal`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ reason: reason || "" }),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { item: ModerationTicketItem };
}

export async function createAdminExportTask(input: {
  scope: "all" | "api" | "online" | "traffic" | "users" | "billing";
  file_format?: "xlsx";
  filters?: Record<string, unknown>;
}) {
  const res = await fetch(`${baseUrl()}/api/admin/export/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({
      scope: input.scope,
      file_format: input.file_format || "xlsx",
      filters: input.filters || {},
    }),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as {
    task_id: string;
    status: string;
    progress: number;
    scope: string;
    file_format: string;
    created_at: string;
  };
}

export async function fetchAdminExportStatus(taskId: string) {
  const res = await fetch(`${baseUrl()}/api/admin/export/status/${encodeURIComponent(taskId)}`, {
    method: "GET",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { item: AdminExportTaskItem };
}

export async function fetchAdminExportTaskDetail(taskId: string) {
  const res = await fetch(`${baseUrl()}/api/admin/export/tasks/${encodeURIComponent(taskId)}`, {
    method: "GET",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { item: AdminExportTaskItem };
}

export async function fetchAdminExportTasks(limit = 20) {
  const params = new URLSearchParams({ limit: String(limit) });
  const res = await fetch(`${baseUrl()}/api/admin/export/tasks?${params.toString()}`, {
    method: "GET",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { items: AdminExportTaskItem[] };
}

export async function downloadAdminExportTask(taskId: string, token?: string) {
  const params = new URLSearchParams();
  if ((token || "").trim()) params.set("token", String(token || "").trim());
  const res = await fetch(
    `${baseUrl()}/api/admin/export/download/${encodeURIComponent(taskId)}${params.toString() ? `?${params.toString()}` : ""}`,
    {
      method: "GET",
      headers: { ...authHeaders() },
    },
  );
  if (!res.ok) throw await readError(res);
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `inkai-export-${taskId}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(href);
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

export async function exportDashboard(scope: "all" | "api" | "online" | "traffic" | "users" | "billing" = "all") {
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

export async function fetchOperationCosts() {
  const res = await fetch(`${baseUrl()}/api/admin/operation-costs`, {
    method: "GET",
    headers: {
      ...authHeaders(),
    },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { items: OperationCosts };
}

export async function patchOperationCosts(payload: OperationCostsPatch) {
  const res = await fetch(`${baseUrl()}/api/admin/operation-costs`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { items: OperationCosts };
}

export async function fetchPromptGuard() {
  const res = await fetch(`${baseUrl()}/api/admin/prompt-guard`, {
    method: "GET",
    headers: {
      ...authHeaders(),
    },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as PromptGuardConfig;
}

export async function patchPromptGuard(payload: { enabled?: boolean; blocked_terms?: string[] }) {
  const res = await fetch(`${baseUrl()}/api/admin/prompt-guard`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as PromptGuardConfig;
}

export async function fetchAdminFeedback(limit = 100, onlyOpen = false) {
  const params = new URLSearchParams({
    limit: String(limit),
    only_open: String(Boolean(onlyOpen)),
  });
  const res = await fetch(`${baseUrl()}/api/admin/feedback?${params.toString()}`, {
    method: "GET",
    headers: {
      ...authHeaders(),
    },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as {
    items: AdminFeedbackItem[];
    open_count: number;
    total_count: number;
  };
}

export async function resolveAdminFeedback(feedbackId: number, note = "") {
  const res = await fetch(`${baseUrl()}/api/admin/feedback/${feedbackId}/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ note }),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { item: AdminFeedbackItem };
}

export async function fetchDataCenterImages(input: {
  bucket: "selected" | "rejected";
  page?: number;
  page_size?: number;
  start_code?: string;
  end_code?: string;
  start_time?: string;
  end_time?: string;
}) {
  const params = new URLSearchParams();
  params.set("page", String(input.page || 1));
  params.set("page_size", String(input.page_size || 20));
  if (input.start_code?.trim()) params.set("start_code", input.start_code.trim());
  if (input.end_code?.trim()) params.set("end_code", input.end_code.trim());
  if (input.start_time?.trim()) params.set("start_time", input.start_time.trim());
  if (input.end_time?.trim()) params.set("end_time", input.end_time.trim());
  const path =
    input.bucket === "selected"
      ? "/api/admin/data-center/selected-images"
      : "/api/admin/data-center/rejected-images";
  const res = await fetch(`${baseUrl()}${path}?${params.toString()}`, {
    method: "GET",
    headers: {
      ...authHeaders(),
    },
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as {
    items: DataCenterImageItem[];
    page: number;
    page_size: number;
    total: number;
  };
}

export async function downloadDataCenterImages(input: {
  bucket: "selected" | "rejected";
  page?: number;
  page_size?: number;
  start_code?: string;
  end_code?: string;
  start_time?: string;
  end_time?: string;
}) {
  const params = new URLSearchParams();
  params.set("page", String(input.page || 1));
  params.set("page_size", String(input.page_size || 20));
  if (input.start_code?.trim()) params.set("start_code", input.start_code.trim());
  if (input.end_code?.trim()) params.set("end_code", input.end_code.trim());
  if (input.start_time?.trim()) params.set("start_time", input.start_time.trim());
  if (input.end_time?.trim()) params.set("end_time", input.end_time.trim());
  const path =
    input.bucket === "selected"
      ? "/api/admin/data-center/selected-images/download"
      : "/api/admin/data-center/rejected-images/download";
  const res = await fetch(`${baseUrl()}${path}?${params.toString()}`, {
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
  a.download =
    input.bucket === "selected"
      ? `selected-images-${Date.now()}.zip`
      : `rejected-images-${Date.now()}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(href);
}
