import { loadSettings } from "@/lib/app-settings";

const AUTH_ACCESS_LS_KEY = "ink-aesthetics-ai.auth.access_token.v2";
const VISITOR_LS_KEY = "ink-aesthetics-ai.telemetry.visitor.v1";
const SESSION_SS_KEY = "ink-aesthetics-ai.telemetry.session.v1";

function baseUrl() {
  return loadSettings().backendBaseUrl.replace(/\/$/, "");
}

function randomId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function getVisitorId() {
  const existing = localStorage.getItem(VISITOR_LS_KEY);
  if (existing) return existing;
  const next = randomId("visitor");
  localStorage.setItem(VISITOR_LS_KEY, next);
  return next;
}

function getSessionId() {
  const existing = sessionStorage.getItem(SESSION_SS_KEY);
  if (existing) return existing;
  const next = randomId("sess");
  sessionStorage.setItem(SESSION_SS_KEY, next);
  return next;
}

function tokenHeader(): Record<string, string> {
  const token = (localStorage.getItem(AUTH_ACCESS_LS_KEY) || "").trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function detectSourceChannel() {
  const params = new URLSearchParams(window.location.search);
  const utmSource = params.get("utm_source");
  if (utmSource) return utmSource.toLowerCase();
  const ref = (document.referrer || "").toLowerCase();
  if (!ref) return "direct";
  if (ref.includes("google")) return "google";
  if (ref.includes("baidu")) return "baidu";
  if (ref.includes("bing")) return "bing";
  if (ref.includes("wechat")) return "wechat";
  if (ref.includes("qq.com")) return "qq";
  return "referral";
}

function timezoneRegion() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Unknown";
  } catch {
    return "Unknown";
  }
}

export async function sendPageView(path: string) {
  await fetch(`${baseUrl()}/api/telemetry/page-view`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...tokenHeader(),
    },
    body: JSON.stringify({
      visitor_id: getVisitorId(),
      session_id: getSessionId(),
      page_path: path || "/",
      source_channel: detectSourceChannel(),
      referrer: document.referrer || "",
      region: timezoneRegion(),
      timezone: timezoneRegion(),
    }),
  }).catch(() => undefined);
}

export async function sendHeartbeat(path: string) {
  const token = (localStorage.getItem(AUTH_ACCESS_LS_KEY) || "").trim();
  if (!token) return;
  await fetch(`${baseUrl()}/api/telemetry/heartbeat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      session_id: getSessionId(),
      page_path: path || "/",
      region: timezoneRegion(),
      timezone: timezoneRegion(),
    }),
  }).catch(() => undefined);
}
