import AppShell from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  exportDashboard,
  fetchApiPermissions,
  fetchSuperDashboard,
  patchThresholds,
  putApiPermission,
  resolveAlert,
  type DashboardRange,
} from "@/lib/admin-api";
import { AlertTriangle, Database, Download, Gauge, Radar, ShieldAlert, Users, Wifi } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type PermissionItem = {
  id: number;
  path: string;
  enabled: boolean;
  note: string;
  updated_at: string;
};

type ThresholdForm = {
  api_fail_rate_threshold: number;
  online_surge_threshold: number;
  online_drop_threshold: number;
  refresh_interval_sec: number;
};

const ranges: DashboardRange[] = ["hour", "day", "week", "month"];

function asPercent(v: number) {
  return `${(v * 100).toFixed(2)}%`;
}

export default function SuperAdminPage() {
  const [rangeKey, setRangeKey] = useState<DashboardRange>("hour");
  const [detailLimit] = useState(200);
  const [refreshSec, setRefreshSec] = useState(5);
  const [loading, setLoading] = useState(false);
  const [dashboard, setDashboard] = useState<any | null>(null);
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [thresholdForm, setThresholdForm] = useState<ThresholdForm>({
    api_fail_rate_threshold: 0.15,
    online_surge_threshold: 0.5,
    online_drop_threshold: 0.4,
    refresh_interval_sec: 5,
  });
  const [thresholdInitialized, setThresholdInitialized] = useState(false);

  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchSuperDashboard(rangeKey, detailLimit);
      setDashboard(data);
      if (!thresholdInitialized && data?.alerts?.thresholds) {
        setThresholdForm({
          api_fail_rate_threshold: Number(data.alerts.thresholds.api_fail_rate_threshold ?? 0.15),
          online_surge_threshold: Number(data.alerts.thresholds.online_surge_threshold ?? 0.5),
          online_drop_threshold: Number(data.alerts.thresholds.online_drop_threshold ?? 0.4),
          refresh_interval_sec: Number(data.alerts.thresholds.refresh_interval_sec ?? 5),
        });
        setRefreshSec(Math.max(1, Number(data.alerts.thresholds.refresh_interval_sec ?? 5)));
        setThresholdInitialized(true);
      }
    } catch (e) {
      toast.error("Failed to load root dashboard", { description: String((e as Error).message || e) });
    } finally {
      setLoading(false);
    }
  }, [detailLimit, rangeKey, thresholdInitialized]);

  const loadPermissions = useCallback(async () => {
    try {
      const data = await fetchApiPermissions();
      setPermissions((data?.items || []) as PermissionItem[]);
    } catch (e) {
      toast.error("Failed to load API permissions", { description: String((e as Error).message || e) });
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
    void loadPermissions();
  }, [loadDashboard, loadPermissions]);

  useEffect(() => {
    const sec = Math.max(1, refreshSec);
    const timer = window.setInterval(() => {
      void loadDashboard();
    }, sec * 1000);
    return () => window.clearInterval(timer);
  }, [loadDashboard, refreshSec]);

  const failureRate = Number(dashboard?.api?.realtime?.failure_rate || 0);
  const apiFailThreshold = Number(dashboard?.alerts?.thresholds?.api_fail_rate_threshold || 0.15);
  const openAlerts = (dashboard?.alerts?.open || []) as any[];
  const recentAlerts = (dashboard?.alerts?.recent || []) as any[];

  const alertsTicker = useMemo(() => {
    if (!recentAlerts.length) return "No recent alerts";
    return recentAlerts
      .slice(0, 12)
      .map((x) => `[${x.severity?.toUpperCase?.() || "INFO"}] ${x.category}: ${x.message}`)
      .join(" | ");
  }, [recentAlerts]);

  return (
    <AppShell>
      <div className="space-y-6">
        <section className="rounded-2xl border border-border/70 bg-card/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-display text-3xl">Root Super Admin Command Center</div>
              <div className="text-xs text-muted-foreground">
                Unique root-only access | generated at {dashboard?.generated_at || "-"}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-full border border-border/70 bg-background/60 p-1">
                {ranges.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={
                      "rounded-full px-3 py-1 text-xs transition " +
                      (rangeKey === r ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:bg-secondary")
                    }
                    onClick={() => setRangeKey(r)}
                  >
                    {r.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/60 px-3 py-1">
                <span className="text-xs text-muted-foreground">Refresh(s)</span>
                <Input
                  type="number"
                  min={1}
                  value={refreshSec}
                  onChange={(e) => setRefreshSec(Math.max(1, Number(e.target.value || 1)))}
                  className="h-8 w-20 border-border/70 bg-background/70"
                />
              </div>
              <Button
                variant="outline"
                className="border-border/70"
                onClick={() => {
                  void loadDashboard();
                  void loadPermissions();
                }}
              >
                Refresh Now
              </Button>
              <Button
                className="bg-accent text-accent-foreground hover:bg-accent/90"
                onClick={() => exportDashboard("all").catch((e) => toast.error(String((e as Error).message || e)))}
              >
                <Download className="mr-2 h-4 w-4" />
                Export Excel
              </Button>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-5">
          <MetricCard icon={Users} label="Users Total" value={dashboard?.overview?.users_total ?? "-"} />
          <MetricCard icon={Wifi} label="Online Now" value={dashboard?.overview?.online_now ?? "-"} />
          <MetricCard icon={Gauge} label="API Calls Today" value={dashboard?.overview?.api_calls_today ?? "-"} />
          <MetricCard icon={Radar} label="PV Today" value={dashboard?.overview?.pv_today ?? "-"} />
          <MetricCard icon={Database} label="UV Today" value={dashboard?.overview?.uv_today ?? "-"} />
        </section>

        <section className="grid gap-6 xl:grid-cols-12">
          <Card className="xl:col-span-7 border-border/70 bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Gauge className="h-5 w-5" />
                API Full-Dimension Monitoring
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <SmallMetric label="Calls / min" value={dashboard?.api?.realtime?.calls_last_minute ?? 0} />
                <SmallMetric label="Success Rate" value={asPercent(Number(dashboard?.api?.realtime?.success_rate || 0))} />
                <SmallMetric
                  label="Failure Rate"
                  value={asPercent(failureRate)}
                  danger={failureRate > apiFailThreshold}
                />
                <SmallMetric label="Avg Latency" value={`${dashboard?.api?.realtime?.avg_latency_ms ?? 0} ms`} />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <ListPanel
                  title="Abnormal TOP5"
                  rows={(dashboard?.api?.realtime?.abnormal_top5 || []).map((x: any) => `${x.path} (${x.failures})`)}
                />
                <ListPanel
                  title="IP Source TOP10"
                  rows={(dashboard?.api?.details?.ip_sources || []).map((x: any) => `${x.ip} (${x.calls})`)}
                />
              </div>

              <DataTable
                title="API Trend"
                headers={["Bucket", "Calls", "Errors", "Avg Latency(ms)"]}
                rows={(dashboard?.api?.trends || []).slice(-12).map((x: any) => [
                  x.bucket,
                  String(x.calls),
                  String(x.errors),
                  String(x.avg_latency_ms),
                ])}
              />

              <DataTable
                title="Call Details"
                headers={["Time", "Method", "Path", "Status", "Latency", "IP", "Error"]}
                rows={(dashboard?.api?.details?.call_logs || []).slice(0, 20).map((x: any) => [
                  x.time,
                  x.method,
                  x.path,
                  String(x.status_code),
                  `${x.latency_ms}ms`,
                  x.ip || "-",
                  x.error || "-",
                ])}
                dangerColumnIndex={3}
              />
            </CardContent>
          </Card>

          <Card className="xl:col-span-5 border-border/70 bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Users className="h-5 w-5" />
                Real-time Online Monitoring
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <SmallMetric label="Online Users" value={dashboard?.online?.realtime?.online_users ?? 0} />
                <SmallMetric label="Peak Today" value={dashboard?.online?.realtime?.peak_online_today ?? 0} />
                <SmallMetric
                  label="Avg Online Duration"
                  value={`${dashboard?.online?.realtime?.avg_online_duration_sec ?? 0}s`}
                />
                <SmallMetric label="New Login Alerts" value={(dashboard?.online?.boards?.new_login_reminders || []).length} />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <ListPanel
                  title="Terminal Distribution"
                  rows={(dashboard?.online?.realtime?.terminal_distribution || []).map(
                    (x: any) => `${x.type}: ${x.count}`
                  )}
                />
                <ListPanel
                  title="Region Distribution"
                  rows={(dashboard?.online?.realtime?.region_distribution || []).map(
                    (x: any) => `${x.region}: ${x.count}`
                  )}
                />
              </div>

              <DataTable
                title="Online Users"
                headers={["User", "Region", "Terminal", "Path", "Duration(s)", "Last Seen"]}
                rows={(dashboard?.online?.boards?.online_users || []).slice(0, 20).map((x: any) => [
                  x.user_name,
                  x.region,
                  x.terminal_type,
                  x.last_path,
                  String(x.duration_sec),
                  x.last_seen,
                ])}
              />
            </CardContent>
          </Card>

          <Card className="xl:col-span-8 border-border/70 bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Radar className="h-5 w-5" />
                Traffic & Browse Monitoring
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-5">
                <SmallMetric label="Today PV" value={dashboard?.traffic?.realtime?.today_pv ?? 0} />
                <SmallMetric label="Today UV" value={dashboard?.traffic?.realtime?.today_uv ?? 0} />
                <SmallMetric
                  label="New Visitor Ratio"
                  value={asPercent(Number(dashboard?.traffic?.realtime?.new_visitor_ratio || 0))}
                />
                <SmallMetric
                  label="Bounce Rate"
                  value={asPercent(Number(dashboard?.traffic?.realtime?.bounce_rate || 0))}
                />
                <SmallMetric
                  label="Avg Stay"
                  value={`${dashboard?.traffic?.realtime?.avg_page_stay_sec ?? 0}s`}
                />
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                <ListPanel
                  title="Source Channels"
                  rows={(dashboard?.traffic?.analysis?.source_distribution || []).map(
                    (x: any) => `${x.source}: ${x.pv}`
                  )}
                />
                <ListPanel
                  title="Top Pages"
                  rows={(dashboard?.traffic?.analysis?.top_pages || []).map((x: any) => `${x.page}: ${x.pv}`)}
                />
                <ListPanel
                  title="Path Funnel"
                  rows={(dashboard?.traffic?.analysis?.path_funnel || []).map(
                    (x: any) => `${x.from} -> ${x.to} (${x.count})`
                  )}
                />
              </div>
              <DataTable
                title="Traffic Trend"
                headers={["Bucket", "PV", "UV"]}
                rows={(dashboard?.traffic?.analysis?.time_trend || []).slice(-12).map((x: any) => [
                  x.bucket,
                  String(x.pv),
                  String(x.uv),
                ])}
              />
            </CardContent>
          </Card>

          <Card className="xl:col-span-4 border-border/70 bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShieldAlert className="h-5 w-5" />
                Root Controls
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <div className="mb-2 text-sm font-semibold">Threshold Config</div>
                <div className="space-y-2">
                  <InlineField
                    label="API Fail Rate (0-1)"
                    value={thresholdForm.api_fail_rate_threshold}
                    onChange={(v) => setThresholdForm((p) => ({ ...p, api_fail_rate_threshold: v }))}
                  />
                  <InlineField
                    label="Online Surge (0-10)"
                    value={thresholdForm.online_surge_threshold}
                    onChange={(v) => setThresholdForm((p) => ({ ...p, online_surge_threshold: v }))}
                  />
                  <InlineField
                    label="Online Drop (0-1)"
                    value={thresholdForm.online_drop_threshold}
                    onChange={(v) => setThresholdForm((p) => ({ ...p, online_drop_threshold: v }))}
                  />
                  <InlineField
                    label="Refresh Min Sec"
                    value={thresholdForm.refresh_interval_sec}
                    onChange={(v) => setThresholdForm((p) => ({ ...p, refresh_interval_sec: Math.max(1, Math.floor(v)) }))}
                  />
                </div>
                <Button
                  className="mt-3 w-full bg-primary text-primary-foreground hover:bg-primary/90"
                  disabled={savingThreshold}
                  onClick={async () => {
                    setSavingThreshold(true);
                    try {
                      const data = await patchThresholds(thresholdForm);
                      toast.success("Thresholds updated");
                      if (data?.thresholds) {
                        setThresholdForm({
                          api_fail_rate_threshold: Number(data.thresholds.api_fail_rate_threshold),
                          online_surge_threshold: Number(data.thresholds.online_surge_threshold),
                          online_drop_threshold: Number(data.thresholds.online_drop_threshold),
                          refresh_interval_sec: Number(data.thresholds.refresh_interval_sec),
                        });
                        setRefreshSec(Math.max(1, Number(data.thresholds.refresh_interval_sec)));
                      }
                      await loadDashboard();
                    } catch (e) {
                      toast.error("Update failed", { description: String((e as Error).message || e) });
                    } finally {
                      setSavingThreshold(false);
                    }
                  }}
                >
                  Save Thresholds
                </Button>
              </div>

              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <div className="mb-2 text-sm font-semibold">API Permission Control</div>
                <div className="max-h-72 space-y-2 overflow-auto pr-1">
                  {permissions.map((item) => (
                    <div key={item.id} className="rounded-lg border border-border/70 bg-background/70 p-2">
                      <div className="text-xs">{item.path}</div>
                      <div className="mt-1 flex items-center justify-between">
                        <Badge className={item.enabled ? "bg-emerald-600 text-white" : "bg-destructive text-white"}>
                          {item.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                        <Button
                          variant="outline"
                          className="h-7 border-border/70 px-2 text-xs"
                          onClick={async () => {
                            try {
                              await putApiPermission({
                                path: item.path,
                                enabled: !item.enabled,
                                note: item.note || "",
                              });
                              toast.success(`${item.path} -> ${!item.enabled ? "enabled" : "disabled"}`);
                              await loadPermissions();
                              await loadDashboard();
                            } catch (e) {
                              toast.error("Permission update failed", {
                                description: String((e as Error).message || e),
                              });
                            }
                          }}
                        >
                          Toggle
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="rounded-2xl border border-border/70 bg-card/70 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Alert Ticker & Trend Strip
            </div>
            <Badge className={openAlerts.length ? "bg-destructive text-white" : "bg-emerald-600 text-white"}>
              Open Alerts: {openAlerts.length}
            </Badge>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border/70 bg-background/70 px-3 py-2 text-sm whitespace-nowrap">
            <span className={openAlerts.length ? "text-destructive font-semibold" : "text-foreground/80"}>{alertsTicker}</span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {(openAlerts.length ? openAlerts : recentAlerts.slice(0, 6)).map((a: any) => (
              <div
                key={a.id}
                className={
                  "rounded-xl border p-3 " +
                  (a.status === "open"
                    ? "border-destructive/60 bg-destructive/10"
                    : "border-border/70 bg-background/60")
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">
                    [{(a.severity || "info").toUpperCase()}] {a.category}
                  </div>
                  <Badge variant="outline" className="border-border/70">
                    {a.status}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{a.message}</div>
                <div className="mt-1 text-xs">
                  value={a.current_value} threshold={a.threshold_value}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">{a.created_at}</div>
                {a.status === "open" && (
                  <Button
                    variant="outline"
                    className="mt-2 h-7 border-border/70 px-2 text-xs"
                    onClick={async () => {
                      try {
                        await resolveAlert(a.id, "Resolved by root dashboard");
                        toast.success("Alert resolved");
                        await loadDashboard();
                      } catch (e) {
                        toast.error("Resolve failed", { description: String((e as Error).message || e) });
                      }
                    }}
                  >
                    Mark Resolved
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>

        {loading && <div className="text-center text-xs text-muted-foreground">Refreshing dashboard data...</div>}
      </div>
    </AppShell>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: any;
  label: string;
  value: string | number;
}) {
  return (
    <Card className="border-border/70 bg-card/70">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">{label}</div>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="mt-2 font-display text-3xl">{value}</div>
      </CardContent>
    </Card>
  );
}

function SmallMetric({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string | number;
  danger?: boolean;
}) {
  return (
    <div className={"rounded-xl border p-3 " + (danger ? "border-destructive/70 bg-destructive/10" : "border-border/70 bg-background/60")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={"mt-1 text-xl font-semibold " + (danger ? "text-destructive" : "")}>{value}</div>
    </div>
  );
}

function ListPanel({ title, rows }: { title: string; rows: string[] }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/60 p-3">
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-2 max-h-40 space-y-1 overflow-auto pr-1">
        {(rows.length ? rows : ["-"]).map((x) => (
          <div key={x} className="text-xs text-foreground/80">
            {x}
          </div>
        ))}
      </div>
    </div>
  );
}

function DataTable({
  title,
  headers,
  rows,
  dangerColumnIndex,
}: {
  title: string;
  headers: string[];
  rows: string[][];
  dangerColumnIndex?: number;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/60 p-3">
      <div className="mb-2 text-sm font-semibold">{title}</div>
      <div className="max-h-64 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-background/90">
            <tr>
              {headers.map((h) => (
                <th key={h} className="border-b border-border/70 px-2 py-1 text-left font-medium text-muted-foreground">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(rows.length ? rows : [["-"]]).map((row, idx) => (
              <tr key={idx}>
                {row.map((cell, ci) => {
                  const isDanger =
                    typeof dangerColumnIndex === "number" && ci === dangerColumnIndex && Number(cell) >= 400;
                  return (
                    <td key={`${idx}-${ci}`} className={"border-b border-border/50 px-2 py-1 " + (isDanger ? "text-destructive font-semibold" : "")}>
                      {cell}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InlineField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value || 0))}
        className="h-8 w-28 border-border/70 bg-background/70 text-right"
      />
    </div>
  );
}
