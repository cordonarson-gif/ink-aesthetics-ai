import AppShell from "@/components/AppShell";
import SettingsPanel from "@/components/SettingsPanel";
import PresetTemplate from "@/components/Workspace/PresetTemplate";
import PromptVersion from "@/components/Workspace/PromptVersion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { useArchive } from "@/contexts/ArchiveContext";
import { useCredits } from "@/contexts/CreditsContext";
import { useLocale } from "@/contexts/LocaleContext";
import { useSettings } from "@/contexts/SettingsContext";
import { selectGenerationImage } from "@/lib/generation-api";
import { callDeepSeekAPI, generateFiveImages } from "@/lib/mock-ai";
import { assertPromptAllowed } from "@/lib/prompt-guard";
import type { GeneratedImage } from "@/lib/types";
import {
  cancelGenerationTask,
  connectGenerationProgress,
  fetchGenerationTaskState,
  pauseGenerationTask,
  resumeGenerationTask,
  type GenerationTaskState,
} from "@/lib/workspace-api";
import { cn } from "@/lib/utils";
import { Download, PauseCircle, PlayCircle, Sparkles, Stamp, StopCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const GEN_COST = 60;

function asNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export default function Workspace() {
  const { t, locale } = useLocale();
  const { addItem } = useArchive();
  const { credits, spend } = useCredits();
  const { settings, patchSettings } = useSettings();

  const [optimizedKeywords, setOptimizedKeywords] = useState<string[]>([]);
  const [optimizedNegative, setOptimizedNegative] = useState<string[]>([]);
  const [optimizing, setOptimizing] = useState(false);

  const [rawPrompt, setRawPrompt] = useState<string>(
    t("晨雾山谷中的一叶扁舟，远山如黛，近处松石苍润，留白处似云气流动。")
  );
  const [artisticPrompt, setArtisticPrompt] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [taskState, setTaskState] = useState<GenerationTaskState | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const selected = useMemo(() => images.find((x) => x.id === selectedId) ?? null, [images, selectedId]);
  const activeTaskIds = useMemo(
    () => [...new Set(images.map((x) => x.generationTaskId).filter((x): x is string => Boolean(x)))],
    [images]
  );

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  function connectTaskWs(taskId: string) {
    wsRef.current?.close();
    wsRef.current = connectGenerationProgress(taskId, (next) => {
      setTaskState(next);
    });
  }

  async function refreshTaskState(taskId: string) {
    try {
      const res = await fetchGenerationTaskState(taskId);
      setTaskState(res.item);
    } catch {
      // ignore transient errors
    }
  }

  async function onOptimize() {
    if (!rawPrompt.trim()) {
      toast.error(t("请先输入提示词"));
      return;
    }
    try {
      assertPromptAllowed(rawPrompt);
    } catch (e) {
      toast.error(t("提示词违规"), { description: String((e as Error).message || e) });
      return;
    }

    setOptimizing(true);
    try {
      const artistic = await callDeepSeekAPI(rawPrompt);
      setArtisticPrompt(artistic);
      setOptimizedKeywords(extractList(artistic, ["关键词", "Keywords"]));
      setOptimizedNegative(extractList(artistic, ["负面词", "Negative"]));
      toast.success(t("提示词已优化"));
    } catch (e) {
      toast.error(t("优化失败"), { description: String(e) });
    } finally {
      setOptimizing(false);
    }
  }

  async function onGenerate() {
    if (!rawPrompt.trim()) {
      toast.error(t("请先描述你想要的画面"));
      return;
    }

    try {
      assertPromptAllowed(rawPrompt);
    } catch (e) {
      toast.error(t("提示词违规"), { description: String((e as Error).message || e) });
      return;
    }

    const useBackendBilling = Boolean(settings?.backendBaseUrl?.trim()) && (settings.useBackendProxy || settings.sdBackend === "mock");
    if (!useBackendBilling && !spend(GEN_COST)) {
      toast.error(t("墨点不足"));
      return;
    }

    setLoading(true);
    setSelectedId(null);
    setImages([]);
    setTaskState(null);

    try {
      const resImages = await generateFiveImages(rawPrompt, settings);
      setImages(resImages);
      const firstPrompt = resImages[0]?.promptArtistic ?? "";
      setArtisticPrompt(firstPrompt);
      setOptimizedKeywords(extractList(firstPrompt, ["关键词", "Keywords"]));
      setOptimizedNegative(extractList(firstPrompt, ["负面词", "Negative"]));

      const taskId = resImages[0]?.generationTaskId;
      if (taskId) {
        await refreshTaskState(taskId);
        connectTaskWs(taskId);
      }

      toast.success(t("生成完成"));
    } catch (e) {
      toast.error(t("生成失败"), { description: String(e) });
    } finally {
      setLoading(false);
    }
  }

  async function ensureSelectionTracked(image: GeneratedImage) {
    if (!image.generationTaskId || !image.candidateId) return;
    await selectGenerationImage({
      generation_task_id: image.generationTaskId,
      selected_candidate_id: image.candidateId,
    });
  }

  async function downloadSelected() {
    if (!selected) return;
    try {
      await ensureSelectionTracked(selected);
    } catch (e) {
      toast.error(t("提交选图结果失败"), { description: String((e as Error).message || e) });
      return;
    }

    const a = document.createElement("a");
    a.href = selected.dataUrl;
    a.download = `${t("墨韵AI")}_${selected.id}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    addItem({
      ...selected,
      title: `${t("定稿")} · ${new Date().toLocaleString(locale)}`,
      minted: false,
    });

    toast.success(t("已下载并归档"));
  }

  async function mintSelected() {
    if (!selected) return;
    try {
      await ensureSelectionTracked(selected);
    } catch (e) {
      toast.error(t("提交选图结果失败"), { description: String((e as Error).message || e) });
      return;
    }

    addItem({
      ...selected,
      title: `${t("铸造候选")} · ${new Date().toLocaleString(locale)}`,
      minted: true,
    });
    toast.success(t("已加入铸造候选"));
  }

  async function onBatchPause() {
    if (!activeTaskIds.length) return;
    await Promise.all(activeTaskIds.map((taskId) => pauseGenerationTask(taskId)));
    toast.success(t("已暂停批量任务"));
    await refreshTaskState(activeTaskIds[0]);
  }

  async function onBatchResume() {
    if (!activeTaskIds.length) return;
    await Promise.all(activeTaskIds.map((taskId) => resumeGenerationTask(taskId)));
    toast.success(t("已恢复批量任务"));
    await refreshTaskState(activeTaskIds[0]);
  }

  async function onBatchCancel() {
    if (!activeTaskIds.length) return;
    await Promise.all(activeTaskIds.map((taskId) => cancelGenerationTask(taskId)));
    toast.success(t("已取消批量任务"));
    await refreshTaskState(activeTaskIds[0]);
  }

  return (
    <AppShell>
      <div className="grid gap-8 lg:grid-cols-12">
        <section className="space-y-6 lg:col-span-5">
          <SettingsPanel />

          <PresetTemplate
            currentParams={{
              sdBackend: settings.sdBackend,
              sdWebuiSteps: settings.sdWebuiSteps,
              sdWebuiCfgScale: settings.sdWebuiCfgScale,
              sdWebuiWidth: settings.sdWebuiWidth,
              sdWebuiHeight: settings.sdWebuiHeight,
              sdWebuiBatchSize: settings.sdWebuiBatchSize,
              loraTag: settings.loraTag,
            }}
            onApply={(preset) => {
              if ((preset.promptHint || "").trim()) {
                setRawPrompt(String(preset.promptHint || ""));
              }
              const params = preset.params || {};
              patchSettings({
                sdBackend: String(params.sdBackend || settings.sdBackend) as "mock" | "sd-webui",
                sdWebuiSteps: asNumber(params.sdWebuiSteps, settings.sdWebuiSteps),
                sdWebuiCfgScale: asNumber(params.sdWebuiCfgScale, settings.sdWebuiCfgScale),
                sdWebuiWidth: asNumber(params.sdWebuiWidth, settings.sdWebuiWidth),
                sdWebuiHeight: asNumber(params.sdWebuiHeight, settings.sdWebuiHeight),
                sdWebuiBatchSize: asNumber(params.sdWebuiBatchSize, settings.sdWebuiBatchSize),
                loraTag: String(params.loraTag || settings.loraTag),
              });
              toast.success(t("模板已应用"));
            }}
          />

          <Card className="border-border/70 bg-card/70 backdrop-blur">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">{t("AI 工作台（生成）")}</CardTitle>
              <div className="mt-1 text-sm text-muted-foreground">
                {t("墨点余额")}：{credits} · {t("本次消耗")}：{GEN_COST}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm font-semibold">{t("你的提示词（Raw Prompt）")}</div>
              <Textarea
                value={rawPrompt}
                onChange={(e) => setRawPrompt(e.target.value)}
                className="min-h-36 resize-none border-border/70 bg-background/70"
                placeholder={t("描述你想要的画面：题材、构图、情绪、技法…")}
              />

              <PromptVersion
                rawPrompt={rawPrompt}
                artisticPrompt={artisticPrompt}
                onRestore={(raw, artistic) => {
                  setRawPrompt(raw);
                  setArtisticPrompt(artistic);
                }}
              />

              <div className="grid gap-2 sm:grid-cols-2">
                <Button onClick={onOptimize} disabled={optimizing || loading} variant="outline" className="border-border/70">
                  <Sparkles className="mr-2 h-4 w-4" />
                  {optimizing ? t("优化中…") : t("DeepSeek 一键优化")}
                </Button>
                <Button
                  onClick={onGenerate}
                  disabled={loading}
                  className={cn("bg-accent text-accent-foreground hover:bg-accent/90", loading && "opacity-90")}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  {loading ? t("生成中…") : t("生成 4 张")}
                </Button>
              </div>

              {taskState ? (
                <div className="rounded-xl border border-border/70 bg-background/70 p-3">
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{t("任务状态")}：{taskState.status}</span>
                    <span>{Math.max(0, Math.min(100, taskState.progress || 0))}%</span>
                  </div>
                  <Progress value={Math.max(0, Math.min(100, taskState.progress || 0))} />
                  {taskState.failure_reason ? (
                    <div className="mt-2 text-xs text-destructive">{taskState.failure_reason}</div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" className="border-border/70" onClick={() => void onBatchPause()}>
                      <PauseCircle className="mr-1 h-3 w-3" />
                      {t("暂停批量")}
                    </Button>
                    <Button size="sm" variant="outline" className="border-border/70" onClick={() => void onBatchResume()}>
                      <PlayCircle className="mr-1 h-3 w-3" />
                      {t("继续批量")}
                    </Button>
                    <Button size="sm" variant="outline" className="border-border/70" onClick={() => void onBatchCancel()}>
                      <StopCircle className="mr-1 h-3 w-3" />
                      {t("取消批量")}
                    </Button>
                  </div>
                </div>
              ) : null}

              {!!artisticPrompt && !loading ? (
                <div className="rounded-xl border border-border/70 bg-background/70 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-sm font-semibold">{t("艺术化提示词（Artistic Prompt）")}</div>
                    <div className="text-xs text-muted-foreground">{t("可复用 · 可评估")}</div>
                  </div>

                  <pre className="mt-3 whitespace-pre-wrap text-xs leading-5 text-foreground/80">{artisticPrompt}</pre>

                  {optimizedKeywords.length > 0 || optimizedNegative.length > 0 ? (
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-border/70 bg-background/60 p-3">
                        <div className="text-[11px] font-semibold text-foreground">{t("关键词（Keywords）")}</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {optimizedKeywords.map((k) => (
                            <span key={k} className="rounded-full border border-border/70 bg-secondary/60 px-2 py-1 text-[11px] text-foreground/80">
                              {k}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-xl border border-border/70 bg-background/60 p-3">
                        <div className="text-[11px] font-semibold text-foreground">{t("负面词（Negative）")}</div>
                        <div className="mt-2 text-[11px] leading-5 text-muted-foreground">{optimizedNegative.join(", ")}</div>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </section>

        <section className="lg:col-span-7">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="font-display text-2xl tracking-wide">{t("4-Grid 候选画廊")}</div>
              <div className="mt-1 text-sm text-muted-foreground">{t("点击选择 1 张作为定稿")}</div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="border-border/70" disabled={!selected} onClick={() => void downloadSelected()}>
                <Download className="mr-2 h-4 w-4" /> {t("下载定稿")}
              </Button>
              <Button disabled={!selected} onClick={() => void mintSelected()} className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Stamp className="mr-2 h-4 w-4" /> {t("铸造为数字资产")}
              </Button>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {images.length === 0 && !loading ? (
              <EmptyGrid />
            ) : (
              images.map((img, i) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => setSelectedId(img.id)}
                  className={cn(
                    "group relative overflow-hidden rounded-2xl border border-border/70 bg-card/50 text-left transition",
                    "hover:-translate-y-0.5 hover:shadow-[0_18px_45px_-30px_rgba(0,0,0,0.35)]",
                    selectedId === img.id && "ring-cinnabar"
                  )}
                >
                  <img src={img.dataUrl} alt={`${t("候选作品")} ${i + 1}`} className="aspect-[4/3] w-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 bg-background/80 px-4 py-3 backdrop-blur">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold">{t("作品")} {i + 1}</div>
                      <div className="text-xs text-muted-foreground">{t("点击选择")}</div>
                    </div>
                    <div className="mt-2 grid grid-cols-5 gap-1 text-[10px] text-muted-foreground">
                      <Param label={t("水墨")} v={img.params.styleInkWash} />
                      <Param label={t("气韵")} v={img.params.structureRhythm} />
                      <Param label={t("皴法")} v={img.params.textureCun} />
                      <Param label={t("墨晕")} v={img.params.edgeBleed} />
                      <Param label={t("融合")} v={img.params.multimodalFusion} />
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function extractList(text: string, keys: string[]): string[] {
  if (!text.trim()) return [];
  const lines = text.split(/\r?\n/).map((x) => x.trim());
  const hit = lines.find((line) => keys.some((k) => line.toLowerCase().startsWith(k.toLowerCase())));
  if (!hit) return [];
  const raw = hit.replace(/^.+?[：:]/, "");
  return raw
    .split(/[，,]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 16);
}

function Param({ label, v }: { label: string; v: number }) {
  const pct = Math.round(v * 100);
  return (
    <div className="flex items-center gap-1">
      <span className="opacity-70">{label}</span>
      <span className="text-foreground/80">{pct}</span>
    </div>
  );
}

function EmptyGrid() {
  const { t } = useLocale();
  return (
    <div className="col-span-full rounded-2xl border border-dashed border-border/70 bg-background/60 p-10 text-center">
      <div className="font-display text-3xl">{t("留白")}</div>
      <div className="mt-2 text-sm text-muted-foreground">{t("在左侧输入描述，然后点击“生成 4 张”。")}</div>
    </div>
  );
}
