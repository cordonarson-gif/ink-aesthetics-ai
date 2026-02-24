import PortalShell from "@/components/PortalShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  appealModerationTicket,
  claimModerationTicket,
  createAdminExportTask,
  decideModerationTicket,
  downloadDataCenterImages,
  downloadAdminExportTask,
  exportDashboard,
  fetchAdminExportStatus,
  fetchAdminExportTasks,
  fetchAdminStatsAll,
  fetchDataCenterImages,
  fetchModerationTicketDetail,
  fetchModerationTickets,
  resolveAdminFeedback,
  finalJudgeModerationTicket,
  fetchOperationCosts,
  fetchPromptGuard,
  fetchApiPermissions,
  fetchSuperDashboard,
  patchOperationCosts,
  patchPromptGuard,
  patchThresholds,
  putApiPermission,
  resolveAlert,
  type DataCenterImageItem,
  type DashboardRange,
  type AdminStatsRange,
  type AdminStatsAllResponse,
  type ModerationTicketItem,
  type AdminExportTaskItem,
  type OperationCosts,
  type PromptGuardConfig,
} from "@/lib/admin-api";
import { AlertTriangle, Database, Download, Gauge, Radar, ShieldAlert, Users, Wifi, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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

type AsyncTaskItem = {
  task_id: string;
  status: "running" | "completed" | "failed";
  context: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number;
  error: string;
};

type AsyncTaskState = {
  running: number;
  started_total: number;
  completed_total: number;
  failed_total: number;
  last_duration_ms: number;
  recent: AsyncTaskItem[];
};

const ranges: DashboardRange[] = ["hour", "day", "week", "month"];

function asPercent(v: number) {
  return `${(v * 100).toFixed(2)}%`;
}

export default function SuperAdminPage() {
  const [location, setLocation] = useLocation();
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
  const [operationCosts, setOperationCosts] = useState<OperationCosts>({
    prompt_optimize: 0,
    liblibai_gen_img: 60,
    deepseek_chat: 0,
  });
  const [operationCostSaving, setOperationCostSaving] = useState(false);
  const [promptGuard, setPromptGuard] = useState<PromptGuardConfig>({
    enabled: true,
    blocked_terms: [],
  });
  const [promptGuardInput, setPromptGuardInput] = useState("");
  const [promptGuardSaving, setPromptGuardSaving] = useState(false);
  const [dataCenterTab, setDataCenterTab] = useState<"selected" | "rejected">("selected");
  const [dataCenterPage, setDataCenterPage] = useState(1);
  const [dataCenterPageSize] = useState(20);
  const [dataCenterStartCode, setDataCenterStartCode] = useState("");
  const [dataCenterEndCode, setDataCenterEndCode] = useState("");
  const [dataCenterStartTime, setDataCenterStartTime] = useState("");
  const [dataCenterEndTime, setDataCenterEndTime] = useState("");
  const [dataCenterLoading, setDataCenterLoading] = useState(false);
  const [dataCenterItems, setDataCenterItems] = useState<DataCenterImageItem[]>([]);
  const [dataCenterTotal, setDataCenterTotal] = useState(0);
  const [statsRange, setStatsRange] = useState<AdminStatsRange>("day");
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsData, setStatsData] = useState<AdminStatsAllResponse | null>(null);
  const [ticketStatus, setTicketStatus] = useState<string>("pending");
  const [ticketType, setTicketType] = useState<string>("");
  const [ticketPage, setTicketPage] = useState(1);
  const [ticketPageSize] = useState(12);
  const [ticketLoading, setTicketLoading] = useState(false);
  const [tickets, setTickets] = useState<ModerationTicketItem[]>([]);
  const [ticketTotal, setTicketTotal] = useState(0);
  const [selectedTicketId, setSelectedTicketId] = useState<string>("");
  const [selectedTicket, setSelectedTicket] = useState<ModerationTicketItem | null>(null);
  const [ticketActionNote, setTicketActionNote] = useState("");
  const [ticketActionLoading, setTicketActionLoading] = useState(false);
  const [exportScope, setExportScope] = useState<"all" | "api" | "online" | "traffic" | "users" | "billing">("all");
  const [exportCreating, setExportCreating] = useState(false);
  const [exportTasks, setExportTasks] = useState<AdminExportTaskItem[]>([]);
  const [exportLoading, setExportLoading] = useState(false);

  const adminSubRoute = useMemo<"ops" | "dashboard" | "moderation" | "export">(() => {
    if (location.startsWith("/super-admin/dashboard")) return "dashboard";
    if (location.startsWith("/super-admin/moderation")) return "moderation";
    if (location.startsWith("/super-admin/export")) return "export";
    return "ops";
  }, [location]);

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
      toast.error("加载管理看板失败", { description: String((e as Error).message || e) });
    } finally {
      setLoading(false);
    }
  }, [detailLimit, rangeKey, thresholdInitialized]);

  const loadPermissions = useCallback(async () => {
    try {
      const data = await fetchApiPermissions();
      setPermissions((data?.items || []) as PermissionItem[]);
    } catch (e) {
      toast.error("加载 API 权限失败", { description: String((e as Error).message || e) });
    }
  }, []);

  const loadOperationCosts = useCallback(async () => {
    try {
      const data = await fetchOperationCosts();
      setOperationCosts(data.items);
    } catch (e) {
      toast.error("加载操作计费失败", { description: String((e as Error).message || e) });
    }
  }, []);

  const loadPromptGuard = useCallback(async () => {
    try {
      const data = await fetchPromptGuard();
      setPromptGuard(data);
      setPromptGuardInput((data.blocked_terms || []).join(", "));
    } catch (e) {
      toast.error("加载提示词守卫配置失败", { description: String((e as Error).message || e) });
    }
  }, []);

  const loadDataCenter = useCallback(async () => {
    try {
      setDataCenterLoading(true);
      const res = await fetchDataCenterImages({
        bucket: dataCenterTab,
        page: dataCenterPage,
        page_size: dataCenterPageSize,
        start_code: dataCenterStartCode,
        end_code: dataCenterEndCode,
        start_time: dataCenterStartTime,
        end_time: dataCenterEndTime,
      });
      setDataCenterItems(res.items || []);
      setDataCenterTotal(Number(res.total || 0));
    } catch (e) {
      toast.error("加载数据中心失败", { description: String((e as Error).message || e) });
    } finally {
      setDataCenterLoading(false);
    }
  }, [
    dataCenterEndCode,
    dataCenterEndTime,
    dataCenterPage,
    dataCenterPageSize,
    dataCenterStartCode,
    dataCenterStartTime,
    dataCenterTab,
  ]);

  const loadStats = useCallback(async () => {
    try {
      setStatsLoading(true);
      const data = await fetchAdminStatsAll(statsRange);
      setStatsData(data);
    } catch (e) {
      toast.error("加载数据驾驶舱失败", { description: String((e as Error).message || e) });
    } finally {
      setStatsLoading(false);
    }
  }, [statsRange]);

  const loadTickets = useCallback(async () => {
    try {
      setTicketLoading(true);
      const res = await fetchModerationTickets({
        status: ticketStatus || undefined,
        content_type: ticketType || undefined,
        page: ticketPage,
        page_size: ticketPageSize,
      });
      setTickets(res.items || []);
      setTicketTotal(Number(res.total || 0));
      if (!selectedTicketId && (res.items || []).length > 0) {
        setSelectedTicketId(String(res.items[0]?.id || ""));
      }
    } catch (e) {
      toast.error("加载审核工单失败", { description: String((e as Error).message || e) });
    } finally {
      setTicketLoading(false);
    }
  }, [selectedTicketId, ticketPage, ticketPageSize, ticketStatus, ticketType]);

  const loadTicketDetail = useCallback(async () => {
    if (!selectedTicketId) {
      setSelectedTicket(null);
      return;
    }
    try {
      const res = await fetchModerationTicketDetail(selectedTicketId);
      setSelectedTicket(res.item || null);
    } catch (e) {
      toast.error("加载工单详情失败", { description: String((e as Error).message || e) });
      setSelectedTicket(null);
    }
  }, [selectedTicketId]);

  const loadExportTasks = useCallback(async () => {
    try {
      setExportLoading(true);
      const res = await fetchAdminExportTasks(30);
      const list = res.items || [];
      setExportTasks(list);
      const running = list.filter((x) =>
        ["pending", "processing", "running"].includes(String(x.status || "").toLowerCase()),
      );
      if (running.length) {
        await Promise.all(
          running.map(async (item) => {
            const st = await fetchAdminExportStatus(item.task_id);
            return st.item;
          }),
        ).then((items) => {
          const map = new Map(items.map((x) => [x.task_id, x]));
          setExportTasks((prev) => prev.map((x) => map.get(x.task_id) || x));
        });
      }
    } catch (e) {
      toast.error("加载导出任务失败", { description: String((e as Error).message || e) });
    } finally {
      setExportLoading(false);
    }
  }, []);

  useEffect(() => {
    if (adminSubRoute === "ops") {
      void loadDashboard();
      void loadPermissions();
      void loadOperationCosts();
      void loadPromptGuard();
      void loadDataCenter();
      return;
    }
    if (adminSubRoute === "dashboard") {
      void loadStats();
      return;
    }
    if (adminSubRoute === "moderation") {
      void loadTickets();
      return;
    }
    if (adminSubRoute === "export") {
      void loadExportTasks();
    }
  }, [
    adminSubRoute,
    loadDashboard,
    loadPermissions,
    loadOperationCosts,
    loadPromptGuard,
    loadDataCenter,
    loadStats,
    loadTickets,
    loadExportTasks,
  ]);

  useEffect(() => {
    if (adminSubRoute !== "ops") return;
    const sec = Math.max(1, refreshSec);
    const timer = window.setInterval(() => {
      void loadDashboard();
    }, sec * 1000);
    return () => window.clearInterval(timer);
  }, [adminSubRoute, loadDashboard, refreshSec]);

  useEffect(() => {
    if (adminSubRoute !== "dashboard") return;
    const timer = window.setInterval(() => {
      void loadStats();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [adminSubRoute, loadStats]);

  useEffect(() => {
    if (adminSubRoute !== "moderation") return;
    void loadTickets();
  }, [adminSubRoute, ticketPage, ticketStatus, ticketType, loadTickets]);

  useEffect(() => {
    if (adminSubRoute !== "moderation") return;
    void loadTicketDetail();
  }, [adminSubRoute, loadTicketDetail]);

  useEffect(() => {
    if (adminSubRoute !== "export") return;
    const timer = window.setInterval(() => {
      void loadExportTasks();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [adminSubRoute, loadExportTasks]);

  const failureRate = Number(dashboard?.api?.realtime?.failure_rate || 0);
  const apiFailThreshold = Number(dashboard?.alerts?.thresholds?.api_fail_rate_threshold || 0.15);
  const openAlerts = (dashboard?.alerts?.open || []) as any[];
  const recentAlerts = (dashboard?.alerts?.recent || []) as any[];

  const alertsTicker = useMemo(() => {
    if (!recentAlerts.length) return "暂无告警记录";
    return recentAlerts
      .slice(0, 12)
      .map((x) => `[${x.severity?.toUpperCase?.() || "INFO"}] ${x.category}: ${x.message}`)
      .join(" | ");
  }, [recentAlerts]);
  const asyncTaskState = (dashboard?.async_tasks?.liblibai_gen || null) as AsyncTaskState | null;
  const billingRealtime = (dashboard?.billing?.realtime || {}) as {
    total_balance?: number;
    today_topup?: number;
    today_spend?: number;
    root_balance?: number;
  };
  const balanceRichList = (dashboard?.billing?.analysis?.rich_list || []) as Array<{
    user_id: string;
    display_name: string;
    credits_balance: number;
  }>;
  const feedbackItems = (dashboard?.feedback?.recent || []) as Array<{
    id: number;
    user_id: string;
    user_name: string;
    category: string;
    title: string;
    content: string;
    contact: string;
    status: string;
    admin_note: string;
    created_at: string;
    resolved_at: string | null;
  }>;
  const feedbackOpenCount = Number(dashboard?.feedback?.open_count || 0);
  const feedbackTotalCount = Number(dashboard?.feedback?.total_count || 0);

  const adminNav = (
    <section className="rounded-2xl border border-border/70 bg-card/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {[
          { key: "ops", path: "/super-admin", label: "运营总览" },
          { key: "dashboard", path: "/super-admin/dashboard", label: "数据驾驶舱" },
          { key: "moderation", path: "/super-admin/moderation", label: "审核工单" },
          { key: "export", path: "/super-admin/export", label: "异步导出" },
        ].map((item) => (
          <Button
            key={item.key}
            variant={adminSubRoute === item.key ? "default" : "outline"}
            className={adminSubRoute === item.key ? "bg-primary text-primary-foreground" : "border-border/70"}
            onClick={() => setLocation(item.path)}
          >
            {item.label}
          </Button>
        ))}
      </div>
    </section>
  );

  if (adminSubRoute === "dashboard") {
    const cards = statsData?.realtime?.cards;
    const userGrowthSeries = (statsData?.user_growth?.series || []).map((x) => ({
      ...x,
      bucket_label: String(x.bucket || "").slice(5, 16).replace("T", " "),
    }));
    const generationSeries = (statsData?.generation?.series || []).map((x) => ({
      ...x,
      bucket_label: String(x.bucket || "").slice(5, 16).replace("T", " "),
    }));
    const latencyTrend = (statsData?.api_latency?.trend || []).map((x) => ({
      ...x,
      bucket_label: String(x.bucket || "").slice(5, 16).replace("T", " "),
    }));
    const latencyHistogram = statsData?.api_latency?.histogram || [];
    const sourceDb = statsData?.read_from || "-";

    return (
      <PortalShell
        title="管理后台"
        subtitle="Dashboard 子路由：核心指标 + 趋势 + 分布"
        backHref="/workspace"
        backLabel="返回工作台"
      >
        <div className="space-y-6">
          {adminNav}
          <section className="rounded-2xl border border-border/70 bg-card/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-display text-3xl">数据驾驶舱</div>
                <div className="text-xs text-muted-foreground">
                  读库来源: {sourceDb} | 更新时间 {statsData?.generated_at || "-"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={statsRange}
                  onChange={(e) => setStatsRange(e.target.value as AdminStatsRange)}
                  className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-xs"
                >
                  <option value="hour">HOUR</option>
                  <option value="day">DAY</option>
                  <option value="week">WEEK</option>
                  <option value="month">MONTH</option>
                </select>
                <Button variant="outline" className="border-border/70" onClick={() => void loadStats()}>
                  刷新数据
                </Button>
              </div>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            <MetricCard icon={Gauge} label="今日出图量" value={cards?.today_generation_images ?? 0} />
            <MetricCard icon={Wifi} label="在线用户数" value={cards?.online_users ?? 0} />
            <MetricCard icon={Gauge} label="今日 API 调用" value={cards?.today_api_calls ?? 0} />
            <MetricCard icon={AlertTriangle} label="今日 API 错误" value={cards?.today_api_errors ?? 0} />
            <MetricCard icon={Users} label="今日新增用户" value={cards?.today_new_users ?? 0} />
            <MetricCard icon={Database} label="近一小时平均耗时(ms)" value={cards?.avg_latency_last_hour_ms ?? 0} />
          </section>

          <section className="grid gap-6 xl:grid-cols-12">
            <Card className="xl:col-span-7 border-border/70 bg-card/70">
              <CardHeader className="pb-3">
                <CardTitle>用户增长趋势</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={userGrowthSeries}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="bucket_label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="new_users" stroke="#2563eb" strokeWidth={2} name="新增用户" dot={false} />
                    <Line type="monotone" dataKey="total_users" stroke="#16a34a" strokeWidth={2} name="累计用户" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="xl:col-span-5 border-border/70 bg-card/70">
              <CardHeader className="pb-3">
                <CardTitle>API 耗时分布</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={latencyHistogram} dataKey="count" nameKey="bucket" outerRadius={90} label>
                      {latencyHistogram.map((_, idx) => (
                        <Cell key={`latency-cell-${idx}`} fill={["#2563eb", "#0ea5e9", "#14b8a6", "#22c55e", "#f59e0b", "#f97316", "#ef4444"][idx % 7]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="xl:col-span-6 border-border/70 bg-card/70">
              <CardHeader className="pb-3">
                <CardTitle>出图任务趋势</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={generationSeries}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="bucket_label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="task_total" fill="#0ea5e9" name="任务数" />
                    <Bar dataKey="completed_total" fill="#22c55e" name="完成数" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="xl:col-span-6 border-border/70 bg-card/70">
              <CardHeader className="pb-3">
                <CardTitle>API 平均耗时趋势</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={latencyTrend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="bucket_label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="avg_latency_ms" stroke="#ef4444" strokeWidth={2} name="平均耗时(ms)" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </section>

          {statsLoading ? <div className="text-center text-xs text-muted-foreground">正在刷新驾驶舱...</div> : null}
        </div>
      </PortalShell>
    );
  }

  if (adminSubRoute === "moderation") {
    return (
      <PortalShell
        title="管理后台"
        subtitle="审核工单闭环：pending -> approved/rejected -> appealed -> final_judgment"
        backHref="/workspace"
        backLabel="返回工作台"
      >
        <div className="space-y-6">
          {adminNav}
          <section className="rounded-2xl border border-border/70 bg-card/70 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={ticketStatus}
                onChange={(e) => {
                  setTicketStatus(e.target.value);
                  setTicketPage(1);
                }}
                className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-xs"
              >
                <option value="pending">pending</option>
                <option value="approved">approved</option>
                <option value="rejected">rejected</option>
                <option value="appealed">appealed</option>
                <option value="final_judgment">final_judgment</option>
                <option value="">all</option>
              </select>
              <select
                value={ticketType}
                onChange={(e) => {
                  setTicketType(e.target.value);
                  setTicketPage(1);
                }}
                className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-xs"
              >
                <option value="">全部内容类型</option>
                <option value="community_post">community_post</option>
                <option value="forum_question">forum_question</option>
                <option value="forum_answer">forum_answer</option>
                <option value="community_comment">community_comment</option>
              </select>
              <Badge variant="outline" className="border-border/70">总工单: {ticketTotal}</Badge>
              <Button variant="outline" className="border-border/70" onClick={() => void loadTickets()}>
                刷新工单
              </Button>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-12">
            <Card className="xl:col-span-4 border-border/70 bg-card/70">
              <CardHeader className="pb-3">
                <CardTitle>工单列表</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="max-h-[620px] space-y-2 overflow-auto pr-1">
                  {(tickets.length ? tickets : []).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={
                        "w-full rounded-lg border p-3 text-left " +
                        (selectedTicketId === item.id
                          ? "border-primary bg-primary/10"
                          : "border-border/70 bg-background/60 hover:bg-background/80")
                      }
                      onClick={() => setSelectedTicketId(item.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold">#{item.id.slice(0, 8)}</div>
                        <Badge className="bg-secondary text-foreground">{item.status}</Badge>
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">{item.content_type} / {item.source}</div>
                      <div className="mt-1 line-clamp-2 text-xs text-foreground/80">
                        {String((item.content_meta?.title as string) || (item.content_meta?.text_preview as string) || item.machine_reason || "-")}
                      </div>
                    </button>
                  ))}
                  {tickets.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/70 bg-background/60 p-3 text-xs text-muted-foreground">
                      暂无工单
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center justify-between">
                  <Button
                    variant="outline"
                    className="border-border/70"
                    disabled={ticketPage <= 1}
                    onClick={() => setTicketPage((p) => Math.max(1, p - 1))}
                  >
                    上一页
                  </Button>
                  <div className="text-xs text-muted-foreground">第 {ticketPage} 页</div>
                  <Button
                    variant="outline"
                    className="border-border/70"
                    disabled={ticketPage * ticketPageSize >= ticketTotal}
                    onClick={() => setTicketPage((p) => p + 1)}
                  >
                    下一页
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="xl:col-span-8 border-border/70 bg-card/70">
              <CardHeader className="pb-3">
                <CardTitle>工单详情</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {!selectedTicket ? (
                  <div className="rounded-lg border border-dashed border-border/70 bg-background/60 p-4 text-sm text-muted-foreground">
                    请选择左侧工单查看详情
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="bg-secondary text-foreground">{selectedTicket.status}</Badge>
                      <Badge variant="outline" className="border-border/70">{selectedTicket.content_type}</Badge>
                      <Badge variant="outline" className="border-border/70">source: {selectedTicket.source}</Badge>
                      <Badge variant="outline" className="border-border/70">machine: {selectedTicket.machine_result}</Badge>
                    </div>
                    <div className="rounded-lg border border-border/70 bg-background/60 p-3 text-xs">
                      <div>工单ID: {selectedTicket.id}</div>
                      <div>内容ID: {selectedTicket.content_id}</div>
                      <div>创建时间: {selectedTicket.created_at}</div>
                      <div>机审原因: {selectedTicket.machine_reason || "-"}</div>
                      <div>处理备注: {selectedTicket.decision_reason || "-"}</div>
                      <div>申诉原因: {selectedTicket.appeal_reason || "-"}</div>
                    </div>
                    {String(selectedTicket.content_meta?.image_url || "").trim() ? (
                      <div className="rounded-lg border border-border/70 bg-background/60 p-3">
                        <img
                          src={String(selectedTicket.content_meta?.image_url || "")}
                          alt="ticket-content"
                          className="max-h-72 w-full rounded-md object-contain"
                        />
                      </div>
                    ) : null}
                    <div className="rounded-lg border border-border/70 bg-background/60 p-3 text-sm whitespace-pre-wrap">
                      {String(selectedTicket.content_meta?.text_preview || selectedTicket.content_meta?.title || "-")}
                    </div>
                    <Input
                      value={ticketActionNote}
                      onChange={(e) => setTicketActionNote(e.target.value)}
                      className="border-border/70 bg-background/70"
                      placeholder="审核备注 / 驳回原因 / 复核结论"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        className="border-border/70"
                        disabled={ticketActionLoading}
                        onClick={async () => {
                          setTicketActionLoading(true);
                          try {
                            await claimModerationTicket(selectedTicket.id, false);
                            await loadTickets();
                            await loadTicketDetail();
                            toast.success("工单已认领");
                          } catch (e) {
                            toast.error("认领失败", { description: String((e as Error).message || e) });
                          } finally {
                            setTicketActionLoading(false);
                          }
                        }}
                      >
                        人工认领
                      </Button>
                      <Button
                        className="bg-emerald-600 text-white hover:bg-emerald-700"
                        disabled={ticketActionLoading || selectedTicket.status !== "pending"}
                        onClick={async () => {
                          setTicketActionLoading(true);
                          try {
                            await decideModerationTicket(selectedTicket.id, "approved", ticketActionNote);
                            await loadTickets();
                            await loadTicketDetail();
                            toast.success("审核通过");
                          } catch (e) {
                            toast.error("操作失败", { description: String((e as Error).message || e) });
                          } finally {
                            setTicketActionLoading(false);
                          }
                        }}
                      >
                        通过
                      </Button>
                      <Button
                        className="bg-destructive text-white hover:bg-destructive/90"
                        disabled={ticketActionLoading || selectedTicket.status !== "pending"}
                        onClick={async () => {
                          setTicketActionLoading(true);
                          try {
                            await decideModerationTicket(selectedTicket.id, "rejected", ticketActionNote);
                            await loadTickets();
                            await loadTicketDetail();
                            toast.success("已驳回");
                          } catch (e) {
                            toast.error("操作失败", { description: String((e as Error).message || e) });
                          } finally {
                            setTicketActionLoading(false);
                          }
                        }}
                      >
                        驳回
                      </Button>
                      <Button
                        variant="outline"
                        className="border-border/70"
                        disabled={
                          ticketActionLoading ||
                          !["approved", "rejected"].includes(String(selectedTicket.status || "").toLowerCase())
                        }
                        onClick={async () => {
                          setTicketActionLoading(true);
                          try {
                            await appealModerationTicket(selectedTicket.id, ticketActionNote || "管理员代提交申诉");
                            await loadTickets();
                            await loadTicketDetail();
                            toast.success("已提交申诉");
                          } catch (e) {
                            toast.error("申诉失败", { description: String((e as Error).message || e) });
                          } finally {
                            setTicketActionLoading(false);
                          }
                        }}
                      >
                        申诉
                      </Button>
                      <Button
                        variant="outline"
                        className="border-border/70"
                        disabled={ticketActionLoading || selectedTicket.status !== "appealed"}
                        onClick={async () => {
                          setTicketActionLoading(true);
                          try {
                            await finalJudgeModerationTicket(selectedTicket.id, "approved", ticketActionNote);
                            await loadTickets();
                            await loadTicketDetail();
                            toast.success("复核通过");
                          } catch (e) {
                            toast.error("复核失败", { description: String((e as Error).message || e) });
                          } finally {
                            setTicketActionLoading(false);
                          }
                        }}
                      >
                        复核通过
                      </Button>
                      <Button
                        variant="outline"
                        className="border-border/70"
                        disabled={ticketActionLoading || selectedTicket.status !== "appealed"}
                        onClick={async () => {
                          setTicketActionLoading(true);
                          try {
                            await finalJudgeModerationTicket(selectedTicket.id, "rejected", ticketActionNote);
                            await loadTickets();
                            await loadTicketDetail();
                            toast.success("复核驳回");
                          } catch (e) {
                            toast.error("复核失败", { description: String((e as Error).message || e) });
                          } finally {
                            setTicketActionLoading(false);
                          }
                        }}
                      >
                        复核驳回
                      </Button>
                    </div>
                    <div className="rounded-lg border border-border/70 bg-background/60 p-3">
                      <div className="mb-2 text-sm font-semibold">历史操作记录</div>
                      <div className="max-h-48 space-y-2 overflow-auto pr-1">
                        {(selectedTicket.logs || []).map((log) => (
                          <div key={log.id} className="rounded-md border border-border/70 bg-background/70 p-2 text-xs">
                            <div className="font-semibold">
                              {log.action} | {log.from_status}
                              {" -> "}
                              {log.to_status}
                            </div>
                            <div className="text-muted-foreground">{log.actor_user_name || log.actor_user_id || "-"}</div>
                            <div className="text-muted-foreground">{log.created_at}</div>
                            <div className="mt-1 whitespace-pre-wrap">{log.note || "-"}</div>
                          </div>
                        ))}
                        {!(selectedTicket.logs || []).length ? (
                          <div className="text-xs text-muted-foreground">暂无操作记录</div>
                        ) : null}
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </section>
          {ticketLoading ? <div className="text-center text-xs text-muted-foreground">工单加载中...</div> : null}
        </div>
      </PortalShell>
    );
  }

  if (adminSubRoute === "export") {
    return (
      <PortalShell
        title="管理后台"
        subtitle="异步导出：任务入队 -> 轮询状态 -> 完成下载"
        backHref="/workspace"
        backLabel="返回工作台"
      >
        <div className="space-y-6">
          {adminNav}
          <Card className="border-border/70 bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle>创建导出任务</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={exportScope}
                  onChange={(e) => setExportScope(e.target.value as "all" | "api" | "online" | "traffic" | "users" | "billing")}
                  className="h-10 rounded-md border border-border/70 bg-background/70 px-3 text-sm"
                >
                  <option value="all">all</option>
                  <option value="api">api</option>
                  <option value="online">online</option>
                  <option value="traffic">traffic</option>
                  <option value="users">users</option>
                  <option value="billing">billing</option>
                </select>
                <Button
                  className="bg-accent text-accent-foreground hover:bg-accent/90"
                  disabled={exportCreating}
                  onClick={async () => {
                    setExportCreating(true);
                    try {
                      const res = await createAdminExportTask({ scope: exportScope, file_format: "xlsx", filters: {} });
                      toast.success(`导出任务已创建: ${res.task_id.slice(0, 8)}`);
                      await loadExportTasks();
                    } catch (e) {
                      toast.error("创建任务失败", { description: String((e as Error).message || e) });
                    } finally {
                      setExportCreating(false);
                    }
                  }}
                >
                  创建异步导出
                </Button>
                <Button variant="outline" className="border-border/70" onClick={() => void loadExportTasks()}>
                  刷新任务
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle>导出任务队列</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(exportTasks.length ? exportTasks : []).map((item) => (
                <div key={item.task_id} className="rounded-lg border border-border/70 bg-background/60 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold">
                      #{item.task_id.slice(0, 12)} · {item.scope} · {item.status}
                    </div>
                    <div className="text-xs text-muted-foreground">{item.created_at}</div>
                  </div>
                  <div className="mt-2">
                    <Progress value={Math.max(0, Math.min(100, Number(item.progress || 0)))} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>进度: {Math.max(0, Math.min(100, Number(item.progress || 0)))}%</span>
                    <span>大小: {Number(item.file_size || 0)} bytes</span>
                    {item.error ? <span className="text-destructive">错误: {item.error}</span> : null}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-border/70"
                      disabled={item.status !== "completed"}
                      onClick={() => void downloadAdminExportTask(item.task_id, item.download_token)}
                    >
                      下载
                    </Button>
                  </div>
                </div>
              ))}
              {!exportTasks.length && !exportLoading ? (
                <div className="rounded-lg border border-dashed border-border/70 bg-background/60 p-3 text-xs text-muted-foreground">
                  暂无导出任务
                </div>
              ) : null}
            </CardContent>
          </Card>
          {exportLoading ? <div className="text-center text-xs text-muted-foreground">导出队列刷新中...</div> : null}
        </div>
      </PortalShell>
    );
  }

  return (
    <PortalShell
      title="管理后台"
      subtitle="独立数据管理界面：核心看板、运营图表、异步任务、计费策略与权限控制"
      backHref="/workspace"
      backLabel="返回工作台"
    >
      <div className="space-y-6">
        {adminNav}
        <section className="rounded-2xl border border-border/70 bg-card/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-display text-3xl">管理员指挥中心</div>
              <div className="text-xs text-muted-foreground">
                仅管理员可访问 | 生成时间 {dashboard?.generated_at || "-"}
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
                <span className="text-xs text-muted-foreground">刷新间隔(秒)</span>
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
                  void loadOperationCosts();
                  void loadPromptGuard();
                  void loadDataCenter();
                }}
              >
                立即刷新
              </Button>
              <Button
                className="bg-accent text-accent-foreground hover:bg-accent/90"
                onClick={() => exportDashboard("all").catch((e) => toast.error(String((e as Error).message || e)))}
              >
                <Download className="mr-2 h-4 w-4" />
                导出 Excel
              </Button>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-7">
          <MetricCard icon={Users} label="用户总数" value={dashboard?.overview?.users_total ?? "-"} />
          <MetricCard icon={Wifi} label="当前在线" value={dashboard?.overview?.online_now ?? "-"} />
          <MetricCard icon={Gauge} label="今日 API 调用" value={dashboard?.overview?.api_calls_today ?? "-"} />
          <MetricCard icon={Radar} label="今日 PV" value={dashboard?.overview?.pv_today ?? "-"} />
          <MetricCard icon={Database} label="今日 UV" value={dashboard?.overview?.uv_today ?? "-"} />
          <MetricCard icon={Database} label="墨点总量" value={dashboard?.overview?.credits_total ?? "-"} />
          <MetricCard icon={Gauge} label="今日墨点消耗" value={dashboard?.overview?.credits_spend_today ?? "-"} />
        </section>

        <section className="grid gap-6 xl:grid-cols-12">
          <Card className="xl:col-span-7 border-border/70 bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Gauge className="h-5 w-5" />
                API 全维监控
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <SmallMetric label="调用数 / min" value={dashboard?.api?.realtime?.calls_last_minute ?? 0} />
                <SmallMetric label="成功率" value={asPercent(Number(dashboard?.api?.realtime?.success_rate || 0))} />
                <SmallMetric
                  label="失败率"
                  value={asPercent(failureRate)}
                  danger={failureRate > apiFailThreshold}
                />
                <SmallMetric label="平均延迟" value={`${dashboard?.api?.realtime?.avg_latency_ms ?? 0} ms`} />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <ListPanel
                  title="异常 TOP5"
                  rows={(dashboard?.api?.realtime?.abnormal_top5 || []).map((x: any) => `${x.path} (${x.failures})`)}
                />
                <ListPanel
                  title="IP 来源 TOP10"
                  rows={(dashboard?.api?.details?.ip_sources || []).map((x: any) => `${x.ip} (${x.calls})`)}
                />
              </div>

              <DataTable
                title="API 趋势"
                headers={["时间桶", "调用数", "错误数", "平均延迟(ms)"]}
                rows={(dashboard?.api?.trends || []).slice(-12).map((x: any) => [
                  x.bucket,
                  String(x.calls),
                  String(x.errors),
                  String(x.avg_latency_ms),
                ])}
              />

              <DataTable
                title="调用明细"
                headers={["时间", "方法", "路径", "状态", "延迟", "IP", "错误"]}
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
                实时在线监控
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <SmallMetric label="在线用户" value={dashboard?.online?.realtime?.online_users ?? 0} />
                <SmallMetric label="今日峰值" value={dashboard?.online?.realtime?.peak_online_today ?? 0} />
                <SmallMetric
                  label="平均在线时长"
                  value={`${dashboard?.online?.realtime?.avg_online_duration_sec ?? 0}s`}
                />
                <SmallMetric label="新增登录提醒" value={(dashboard?.online?.boards?.new_login_reminders || []).length} />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <ListPanel
                  title="终端分布"
                  rows={(dashboard?.online?.realtime?.terminal_distribution || []).map(
                    (x: any) => `${x.type}: ${x.count}`
                  )}
                />
                <ListPanel
                  title="地区分布"
                  rows={(dashboard?.online?.realtime?.region_distribution || []).map(
                    (x: any) => `${x.region}: ${x.count}`
                  )}
                />
              </div>

              <DataTable
                title="在线用户"
                headers={["用户", "地区", "终端", "路径", "在线时长(秒)", "最后活跃"]}
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
                流量与浏览监控
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-5">
                <SmallMetric label="今日 PV" value={dashboard?.traffic?.realtime?.today_pv ?? 0} />
                <SmallMetric label="今日 UV" value={dashboard?.traffic?.realtime?.today_uv ?? 0} />
                <SmallMetric
                  label="新访客占比"
                  value={asPercent(Number(dashboard?.traffic?.realtime?.new_visitor_ratio || 0))}
                />
                <SmallMetric
                  label="跳出率"
                  value={asPercent(Number(dashboard?.traffic?.realtime?.bounce_rate || 0))}
                />
                <SmallMetric
                  label="平均停留"
                  value={`${dashboard?.traffic?.realtime?.avg_page_stay_sec ?? 0}s`}
                />
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                <ListPanel
                  title="来源渠道"
                  rows={(dashboard?.traffic?.analysis?.source_distribution || []).map(
                    (x: any) => `${x.source}: ${x.pv}`
                  )}
                />
                <ListPanel
                  title="热门页面"
                  rows={(dashboard?.traffic?.analysis?.top_pages || []).map((x: any) => `${x.page}: ${x.pv}`)}
                />
                <ListPanel
                  title="路径漏斗"
                  rows={(dashboard?.traffic?.analysis?.path_funnel || []).map(
                    (x: any) => `${x.from} -> ${x.to} (${x.count})`
                  )}
                />
              </div>
              <DataTable
                title="流量趋势"
                headers={["时间桶", "PV", "UV"]}
                rows={(dashboard?.traffic?.analysis?.time_trend || []).slice(-12).map((x: any) => [
                  x.bucket,
                  String(x.pv),
                  String(x.uv),
                ])}
              />
            </CardContent>
          </Card>

          <Card className="xl:col-span-6 border-border/70 bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Database className="h-5 w-5" />
                墨点与用量追踪
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <SmallMetric label="墨点总池" value={billingRealtime.total_balance ?? 0} />
                <SmallMetric label="今日入账" value={billingRealtime.today_topup ?? 0} />
                <SmallMetric label="今日消耗" value={billingRealtime.today_spend ?? 0} />
                <SmallMetric label="管理员余额" value={billingRealtime.root_balance ?? 0} />
              </div>

              <div className="rounded-xl border border-border/70 bg-background/60 p-3">
                <div className="mb-2 text-sm font-semibold">实时余额榜</div>
                <div className="max-h-44 space-y-2 overflow-auto pr-1">
                  {(balanceRichList.length ? balanceRichList : [{ user_id: "-", display_name: "-", credits_balance: 0 }]).map(
                    (item) => (
                      <div
                        key={item.user_id}
                        className="flex items-center justify-between rounded-lg border border-border/70 bg-background/70 px-3 py-2 text-xs"
                      >
                        <span>{item.display_name}</span>
                        <span className="font-semibold">{item.credits_balance}</span>
                      </div>
                    )
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="xl:col-span-6 border-border/70 bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Gauge className="h-5 w-5" />
                异步任务监控
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-5">
                <SmallMetric label="运行中" value={asyncTaskState?.running ?? 0} />
                <SmallMetric label="已启动" value={asyncTaskState?.started_total ?? 0} />
                <SmallMetric label="已完成" value={asyncTaskState?.completed_total ?? 0} />
                <SmallMetric label="失败" value={asyncTaskState?.failed_total ?? 0} danger={(asyncTaskState?.failed_total ?? 0) > 0} />
                <SmallMetric label="最近耗时" value={`${asyncTaskState?.last_duration_ms ?? 0}ms`} />
              </div>
              <DataTable
                title="最近异步任务"
                headers={["任务ID", "状态", "上下文", "开始时间", "耗时(ms)", "错误"]}
                rows={(asyncTaskState?.recent || []).slice(0, 20).map((x) => [
                  x.task_id,
                  x.status,
                  x.context || "-",
                  x.started_at,
                  String(x.duration_ms || 0),
                  x.error || "-",
                ])}
              />
            </CardContent>
          </Card>

          <Card className="xl:col-span-12 border-border/70 bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Users className="h-5 w-5" />
                用户反馈中心
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge className={feedbackOpenCount > 0 ? "bg-destructive text-white" : "bg-emerald-600 text-white"}>
                  待处理: {feedbackOpenCount}
                </Badge>
                <Badge variant="outline" className="border-border/70">
                  总反馈: {feedbackTotalCount}
                </Badge>
              </div>
              <div className="max-h-80 space-y-2 overflow-auto pr-1">
                {(feedbackItems.length ? feedbackItems : []).map((item) => (
                  <div key={item.id} className="rounded-xl border border-border/70 bg-background/60 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="text-sm font-semibold">
                        #{item.id} [{item.category}] {item.title}
                      </div>
                      <Badge className={item.status === "open" ? "bg-destructive text-white" : "bg-emerald-600 text-white"}>
                        {item.status === "open" ? "待处理" : "已处理"}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      用户: {item.user_name || item.user_id} | 时间: {item.created_at}
                    </div>
                    <div className="mt-2 whitespace-pre-wrap text-sm text-foreground/85">{item.content}</div>
                    {item.contact ? (
                      <div className="mt-2 text-xs text-muted-foreground">联系方式: {item.contact}</div>
                    ) : null}
                    {item.admin_note ? (
                      <div className="mt-2 text-xs text-muted-foreground">管理员回复: {item.admin_note}</div>
                    ) : null}
                    {item.status === "open" ? (
                      <div className="mt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-border/70"
                          onClick={async () => {
                            try {
                              const note = window.prompt("填写管理员回复（将通知用户）", "已在后台处理");
                              await resolveAdminFeedback(item.id, note || "");
                              toast.success("反馈已回复并标记为处理完成");
                              await loadDashboard();
                            } catch (e) {
                              toast.error("处理失败", { description: String((e as Error).message || e) });
                            }
                          }}
                        >
                          标记已处理
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
                {feedbackItems.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/70 bg-background/60 p-4 text-xs text-muted-foreground">
                    暂无用户反馈。
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card className="xl:col-span-12 border-border/70 bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Database className="h-5 w-5" />
                数据中心
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant={dataCenterTab === "selected" ? "default" : "outline"}
                  className={dataCenterTab === "selected" ? "bg-primary text-primary-foreground" : "border-border/70"}
                  onClick={() => {
                    setDataCenterTab("selected");
                    setDataCenterPage(1);
                  }}
                >
                  已选择图片
                </Button>
                <Button
                  variant={dataCenterTab === "rejected" ? "default" : "outline"}
                  className={dataCenterTab === "rejected" ? "bg-primary text-primary-foreground" : "border-border/70"}
                  onClick={() => {
                    setDataCenterTab("rejected");
                    setDataCenterPage(1);
                  }}
                >
                  未选择图片
                </Button>
                <Badge variant="outline" className="border-border/70">
                  总数: {dataCenterTotal}
                </Badge>
              </div>

              <div className="grid gap-2 md:grid-cols-4">
                <Input
                  value={dataCenterStartCode}
                  onChange={(e) => setDataCenterStartCode(e.target.value)}
                  className="border-border/70 bg-background/70"
                  placeholder="起始编号（如 a00000001）"
                />
                <Input
                  value={dataCenterEndCode}
                  onChange={(e) => setDataCenterEndCode(e.target.value)}
                  className="border-border/70 bg-background/70"
                  placeholder="结束编号（如 a00000100）"
                />
                <Input
                  type="datetime-local"
                  value={dataCenterStartTime}
                  onChange={(e) => setDataCenterStartTime(e.target.value)}
                  className="border-border/70 bg-background/70"
                />
                <Input
                  type="datetime-local"
                  value={dataCenterEndTime}
                  onChange={(e) => setDataCenterEndTime(e.target.value)}
                  className="border-border/70 bg-background/70"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  className="border-border/70"
                  onClick={() => {
                    void loadDataCenter();
                  }}
                >
                  查询
                </Button>
                <Button
                  className="bg-accent text-accent-foreground hover:bg-accent/90"
                  onClick={() => {
                    void downloadDataCenterImages({
                      bucket: dataCenterTab,
                      page: dataCenterPage,
                      page_size: dataCenterPageSize,
                      start_code: dataCenterStartCode,
                      end_code: dataCenterEndCode,
                      start_time: dataCenterStartTime,
                      end_time: dataCenterEndTime,
                    }).catch((e) => toast.error("下载失败", { description: String((e as Error).message || e) }));
                  }}
                >
                  一键下载当前页
                </Button>
                <Badge variant="outline" className="border-border/70">
                  第 {dataCenterPage} 页
                </Badge>
                <Button
                  variant="outline"
                  className="border-border/70"
                  disabled={dataCenterPage <= 1}
                  onClick={() => setDataCenterPage((p) => Math.max(1, p - 1))}
                >
                  上一页
                </Button>
                <Button
                  variant="outline"
                  className="border-border/70"
                  disabled={dataCenterPage * dataCenterPageSize >= dataCenterTotal}
                  onClick={() => setDataCenterPage((p) => p + 1)}
                >
                  下一页
                </Button>
              </div>

              <div className="max-h-80 overflow-auto rounded-lg border border-border/70">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-background/90">
                    <tr>
                      <th className="border-b border-border/70 px-2 py-1 text-left text-muted-foreground">序号</th>
                      <th className="border-b border-border/70 px-2 py-1 text-left text-muted-foreground">编号</th>
                      <th className="border-b border-border/70 px-2 py-1 text-left text-muted-foreground">缩略图</th>
                      <th className="border-b border-border/70 px-2 py-1 text-left text-muted-foreground">用户ID</th>
                      <th className="border-b border-border/70 px-2 py-1 text-left text-muted-foreground">生成时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dataCenterItems.map((item) => (
                      <tr key={item.candidate_id}>
                        <td className="border-b border-border/50 px-2 py-1">{item.row_no}</td>
                        <td className="border-b border-border/50 px-2 py-1">{item.image_code}</td>
                        <td className="border-b border-border/50 px-2 py-1">
                          <img src={item.data_url} alt={item.image_code} className="h-12 w-16 rounded object-cover" />
                        </td>
                        <td className="border-b border-border/50 px-2 py-1">{item.user_id}</td>
                        <td className="border-b border-border/50 px-2 py-1">{item.assigned_at || item.created_at}</td>
                      </tr>
                    ))}
                    {!dataCenterItems.length && !dataCenterLoading ? (
                      <tr>
                        <td className="px-2 py-3 text-muted-foreground" colSpan={5}>
                          暂无数据
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card className="xl:col-span-12 border-border/70 bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShieldAlert className="h-5 w-5" />
                管理员控制
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <div className="mb-2 text-sm font-semibold">阈值配置</div>
                <div className="space-y-2">
                  <InlineField
                    label="API 失败率阈值(0-1)"
                    value={thresholdForm.api_fail_rate_threshold}
                    onChange={(v) => setThresholdForm((p) => ({ ...p, api_fail_rate_threshold: v }))}
                  />
                  <InlineField
                    label="在线激增阈值(0-10)"
                    value={thresholdForm.online_surge_threshold}
                    onChange={(v) => setThresholdForm((p) => ({ ...p, online_surge_threshold: v }))}
                  />
                  <InlineField
                    label="在线下跌阈值(0-1)"
                    value={thresholdForm.online_drop_threshold}
                    onChange={(v) => setThresholdForm((p) => ({ ...p, online_drop_threshold: v }))}
                  />
                  <InlineField
                    label="最小刷新秒数"
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
                      toast.success("阈值已更新");
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
                      toast.error("更新失败", { description: String((e as Error).message || e) });
                    } finally {
                      setSavingThreshold(false);
                    }
                  }}
                >
                  保存阈值
                </Button>
              </div>

              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <div className="mb-2 text-sm font-semibold">API 权限控制</div>
                <div className="max-h-72 space-y-2 overflow-auto pr-1">
                  {permissions.map((item) => (
                    <div key={item.id} className="rounded-lg border border-border/70 bg-background/70 p-2">
                      <div className="text-xs">{item.path}</div>
                      <div className="mt-1 flex items-center justify-between">
                        <Badge className={item.enabled ? "bg-emerald-600 text-white" : "bg-destructive text-white"}>
                          {item.enabled ? "已启用" : "已禁用"}
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
                              toast.success(`${item.path} -> ${!item.enabled ? "已启用" : "已禁用"}`);
                              await loadPermissions();
                              await loadDashboard();
                            } catch (e) {
                              toast.error("权限更新失败", {
                                description: String((e as Error).message || e),
                              });
                            }
                          }}
                        >
                          切换
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <div className="mb-2 text-sm font-semibold">操作计费规则</div>
                <div className="grid gap-2 md:grid-cols-3">
                  <InlineField
                    label="提示词优化"
                    value={operationCosts.prompt_optimize}
                    onChange={(v) =>
                      setOperationCosts((p) => ({ ...p, prompt_optimize: Math.max(0, Math.floor(v)) }))
                    }
                  />
                  <InlineField
                    label="图片生成"
                    value={operationCosts.liblibai_gen_img}
                    onChange={(v) =>
                      setOperationCosts((p) => ({ ...p, liblibai_gen_img: Math.max(0, Math.floor(v)) }))
                    }
                  />
                  <InlineField
                    label="DeepSeek 对话"
                    value={operationCosts.deepseek_chat}
                    onChange={(v) =>
                      setOperationCosts((p) => ({ ...p, deepseek_chat: Math.max(0, Math.floor(v)) }))
                    }
                  />
                </div>
                <Button
                  className="mt-3 w-full bg-primary text-primary-foreground hover:bg-primary/90"
                  disabled={operationCostSaving}
                  onClick={async () => {
                    setOperationCostSaving(true);
                    try {
                      const res = await patchOperationCosts(operationCosts);
                      setOperationCosts(res.items);
                      toast.success("操作计费规则已更新");
                      await loadDashboard();
                    } catch (e) {
                      toast.error("计费规则更新失败", { description: String((e as Error).message || e) });
                    } finally {
                      setOperationCostSaving(false);
                    }
                  }}
                >
                  保存计费规则
                </Button>
              </div>

              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <div className="mb-2 text-sm font-semibold">提示词安全守卫</div>
                <div className="space-y-2">
                  <label className="flex items-center justify-between rounded-lg border border-border/70 bg-background/70 px-3 py-2 text-xs">
                    <span>启用提示词守卫</span>
                    <input
                      type="checkbox"
                      checked={promptGuard.enabled}
                      onChange={(e) => setPromptGuard((p) => ({ ...p, enabled: e.target.checked }))}
                    />
                  </label>
                  <Input
                    value={promptGuardInput}
                    onChange={(e) => setPromptGuardInput(e.target.value)}
                    placeholder="逗号分隔的禁用词"
                    className="border-border/70 bg-background/70"
                  />
                  <div className="text-[11px] text-muted-foreground">
                    词条数量: {promptGuard.blocked_terms.length} | All image-generation prompts containing banned
                    terms are blocked.
                  </div>
                </div>
                <Button
                  className="mt-3 w-full bg-primary text-primary-foreground hover:bg-primary/90"
                  disabled={promptGuardSaving}
                  onClick={async () => {
                    setPromptGuardSaving(true);
                    try {
                      const nextTerms = promptGuardInput
                        .split(",")
                        .map((x) => x.trim())
                        .filter(Boolean);
                      const res = await patchPromptGuard({
                        enabled: promptGuard.enabled,
                        blocked_terms: nextTerms,
                      });
                      setPromptGuard(res);
                      setPromptGuardInput((res.blocked_terms || []).join(", "));
                      toast.success("提示词守卫已更新");
                      await loadDashboard();
                    } catch (e) {
                      toast.error("提示词守卫更新失败", { description: String((e as Error).message || e) });
                    } finally {
                      setPromptGuardSaving(false);
                    }
                  }}
                >
                  保存守卫配置
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="rounded-2xl border border-border/70 bg-card/70 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              告警滚动与趋势
            </div>
            <Badge className={openAlerts.length ? "bg-destructive text-white" : "bg-emerald-600 text-white"}>
              未关闭告警: {openAlerts.length}
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
                        await resolveAlert(a.id, "由管理后台标记处理");
                        toast.success("告警已处理");
                        await loadDashboard();
                      } catch (e) {
                        toast.error("处理失败", { description: String((e as Error).message || e) });
                      }
                    }}
                  >
                    标记已处理
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>

        {loading && <div className="text-center text-xs text-muted-foreground">正在刷新看板数据...</div>}
      </div>
    </PortalShell>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
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

