import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useMemo, useState } from "react";
import { callDeepSeekAPI, generateFiveImages } from "@/lib/mock-ai";
import type { GeneratedImage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Download, Sparkles, Stamp } from "lucide-react";
import { useArchive } from "@/contexts/ArchiveContext";
import { useCredits } from "@/contexts/CreditsContext";
import { useSettings } from "@/contexts/SettingsContext";
import SettingsPanel from "@/components/SettingsPanel";

const GEN_COST = 60;

export default function Workspace() {
  const { addItem } = useArchive();
  const { credits, spend } = useCredits();
  const { settings } = useSettings();

  const [optimizedKeywords, setOptimizedKeywords] = useState<string[]>([]);
  const [optimizedNegative, setOptimizedNegative] = useState<string[]>([]);
  const [optimizing, setOptimizing] = useState(false);

  const [rawPrompt, setRawPrompt] = useState<string>(
    "晨雾山谷中一叶扁舟，远山如黛，近处松石苍润，留白处似云气流动。"
  );
  const [artisticPrompt, setArtisticPrompt] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(
    () => images.find((x) => x.id === selectedId) ?? null,
    [images, selectedId]
  );

  async function onOptimize() {
    if (!rawPrompt.trim()) {
      toast.error("请先输入提示词。", { description: "然后点击“DeepSeek 一键优化”。" });
      return;
    }
    setOptimizing(true);
    try {
      const artistic = await callDeepSeekAPI(rawPrompt);
      setArtisticPrompt(artistic);
      setOptimizedKeywords(extractList(artistic, ["关键词", "Keywords"]));
      setOptimizedNegative(extractList(artistic, ["负面词", "Negative"]));
      toast.success("已优化提示词", { description: "可直接用于生成。" });
    } catch (e) {
      toast.error("优化失败", { description: String(e) });
    } finally {
      setOptimizing(false);
    }
  }

  async function onGenerate() {
    if (!rawPrompt.trim()) {
      toast.error("请先描述你想要的画面。", { description: "例如：李成风格的山水，云烟氤氲，气韵生动。" });
      return;
    }

    if (!spend(GEN_COST)) {
      toast.error("墨点不足", { description: "当前额度不足以发起生成，请升级订阅或充值。" });
      return;
    }

    setLoading(true);
    setSelectedId(null);
    setImages([]);

    try {
      const resImages = await generateFiveImages(rawPrompt, settings);
      setImages(resImages);
      const firstPrompt = resImages[0]?.promptArtistic ?? "";
      setArtisticPrompt(firstPrompt);
      setOptimizedKeywords(extractList(firstPrompt, ["关键词", "Keywords"]));
      setOptimizedNegative(extractList(firstPrompt, ["负面词", "Negative"]));
      toast.success("生成完成", { description: "请从 4 张中选 1 张定稿。" });
    } catch (e) {
      toast.error("生成失败", { description: String(e) });
    } finally {
      setLoading(false);
    }
  }

  function downloadSelected() {
    if (!selected) return;

    const a = document.createElement("a");
    a.href = selected.dataUrl;
    a.download = `墨韵AI_${selected.id}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    addItem({
      ...selected,
      title: `定稿｜${new Date().toLocaleString("zh-CN")}`,
      minted: false,
    });

    toast.success("已下载并归档", { description: "作品已进入“可计算画廊”。" });
  }

  function mintSelected() {
    if (!selected) return;
    addItem({
      ...selected,
      title: `铸造候选｜${new Date().toLocaleString("zh-CN")}`,
      minted: true,
    });
    toast.success("已提交铸造（概念）", { description: "这里是 mock 按钮：后续可接入链上/版权登记服务。" });
  }

  return (
    <AppShell>
      <div className="grid gap-8 lg:grid-cols-12">
        <section className="lg:col-span-5 space-y-6">
          <SettingsPanel />

          <Card className="border-border/70 bg-card/70 backdrop-blur">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">AI 工作台（生成）</CardTitle>
              <div className="mt-1 text-sm text-muted-foreground">墨点余额：{credits} · 本次消耗：{GEN_COST}</div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm font-semibold">你的提示词（Raw Prompt）</div>
              <Textarea
                value={rawPrompt}
                onChange={(e) => setRawPrompt(e.target.value)}
                className="min-h-36 resize-none border-border/70 bg-background/70"
                placeholder="描述你想要的画面：题材、构图、情绪、技法……"
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  onClick={onOptimize}
                  disabled={optimizing || loading}
                  variant="outline"
                  className="border-border/70"
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  {optimizing ? "优化中…" : "DeepSeek 一键优化"}
                </Button>
                <Button
                  onClick={onGenerate}
                  disabled={loading}
                  className={cn(
                    "bg-accent text-accent-foreground hover:bg-accent/90",
                    loading && "opacity-90"
                  )}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  {loading ? "墨晕生成中…" : "生成 4 张"}
                </Button>
              </div>

              {loading && (
                <div className="rounded-xl border border-border/70 bg-background/70 p-4">
                  <div className="text-sm font-semibold">正在编排生成流程…</div>
                  <div className="mt-3 h-12 rounded-lg bg-secondary ink-wash" />
                  <div className="mt-3 h-24 rounded-lg bg-secondary ink-wash" />
                </div>
              )}

              {!!artisticPrompt && !loading && (
                <div className="rounded-xl border border-border/70 bg-background/70 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-sm font-semibold">艺术化提示词（Artistic Prompt）</div>
                    <div className="text-xs text-muted-foreground">可复制 · 可复现 · 可评估</div>
                  </div>

                  <pre className="mt-3 whitespace-pre-wrap text-xs leading-5 text-foreground/80">
                    {artisticPrompt}
                  </pre>

                  {(optimizedKeywords.length > 0 || optimizedNegative.length > 0) && (
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-border/70 bg-background/60 p-3">
                        <div className="text-[11px] font-semibold text-foreground">关键词（Keywords）</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {optimizedKeywords.map((k) => (
                            <span
                              key={k}
                              className="rounded-full border border-border/70 bg-secondary/60 px-2 py-1 text-[11px] text-foreground/80"
                            >
                              {k}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-xl border border-border/70 bg-background/60 p-3">
                        <div className="text-[11px] font-semibold text-foreground">负面词（Negative）</div>
                        <div className="mt-2 text-[11px] leading-5 text-muted-foreground">
                          {optimizedNegative.join(", ")}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="rounded-xl border border-border/70 bg-background/70 p-4">
                <div className="text-sm font-semibold">操作说明</div>
                <ul className="mt-2 list-disc pl-5 text-sm leading-6 text-muted-foreground">
                  <li>生成后会出现 4 张候选作品。</li>
                  <li>你必须点击选中其中 1 张，才能下载或铸造。</li>
                  <li>选中态将以“朱砂红”描边标记。</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="lg:col-span-7">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="font-display text-2xl tracking-wide">4-Grid 候选画廊</div>
              <div className="mt-1 text-sm text-muted-foreground">点击选择 1 张作为定稿</div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="border-border/70"
                disabled={!selected}
                onClick={downloadSelected}
              >
                <Download className="mr-2 h-4 w-4" /> 下载定稿
              </Button>
              <Button
                disabled={!selected}
                onClick={mintSelected}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Stamp className="mr-2 h-4 w-4" /> 铸造为数字资产
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
                  <img src={img.dataUrl} alt={`候选作品 ${i + 1}`} className="aspect-[4/3] w-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 bg-background/80 backdrop-blur px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold">作品 {i + 1}</div>
                      <div className="text-xs text-muted-foreground">点击选择</div>
                    </div>
                    <div className="mt-2 grid grid-cols-5 gap-1 text-[10px] text-muted-foreground">
                      <Param label="水墨" v={img.params.styleInkWash} />
                      <Param label="气韵" v={img.params.structureRhythm} />
                      <Param label="皴" v={img.params.textureCun} />
                      <Param label="墨晕" v={img.params.edgeBleed} />
                      <Param label="融合" v={img.params.multimodalFusion} />
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
  return (
    <div className="col-span-full rounded-2xl border border-dashed border-border/70 bg-background/60 p-10 text-center">
      <div className="font-display text-3xl">留白</div>
      <div className="mt-2 text-sm text-muted-foreground">在左侧输入描述，然后点击“生成 4 张”。</div>
    </div>
  );
}
