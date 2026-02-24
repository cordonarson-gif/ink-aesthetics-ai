import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/contexts/LocaleContext";
import {
  createPromptPreset,
  deletePromptPreset,
  fetchPromptPresets,
  type PromptPresetItem,
} from "@/lib/workspace-api";
import { useEffect, useState } from "react";

const LS_KEY = "ink-aesthetics-ai.workspace.presets.v1";

type PresetTemplateProps = {
  currentParams: Record<string, unknown>;
  onApply: (preset: { promptHint?: string; params: Record<string, unknown> }) => void;
};

function loadLocalPresets(): PromptPresetItem[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PromptPresetItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalPresets(items: PromptPresetItem[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(items.slice(0, 80)));
  } catch {
    // ignore
  }
}

function mergePresets(localItems: PromptPresetItem[], remoteItems: PromptPresetItem[]): PromptPresetItem[] {
  const map = new Map<string, PromptPresetItem>();
  [...localItems, ...remoteItems].forEach((item) => {
    map.set(item.id, item);
  });
  return [...map.values()].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
}

export default function PresetTemplate({ currentParams, onApply }: PresetTemplateProps) {
  const { t } = useLocale();
  const [items, setItems] = useState<PromptPresetItem[]>(() => loadLocalPresets());
  const [name, setName] = useState("");
  const [category, setCategory] = useState("general");
  const [promptHint, setPromptHint] = useState("");

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetchPromptPresets();
        if (cancelled) return;
        setItems((prev) => {
          const merged = mergePresets(prev, res.items || []);
          saveLocalPresets(merged);
          return merged;
        });
      } catch {
        // keep local presets only
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card className="border-border/70 bg-card/70">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t("绘图参数模板")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 md:grid-cols-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border-border/70 bg-background/70"
            placeholder={t("模板名称")}
          />
          <Input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="border-border/70 bg-background/70"
            placeholder={t("分类")}
          />
          <Button
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={async () => {
              const trimmed = name.trim();
              if (!trimmed) return;
              const localItem: PromptPresetItem = {
                id: `local-${Date.now()}`,
                user_id: "local",
                name: trimmed,
                category: (category || "general").trim() || "general",
                prompt_hint: (promptHint || "").trim(),
                params: currentParams,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              };
              setItems((prev) => {
                const next = [localItem, ...prev].slice(0, 80);
                saveLocalPresets(next);
                return next;
              });
              try {
                const res = await createPromptPreset({
                  name: trimmed,
                  category,
                  prompt_hint: promptHint,
                  params: currentParams,
                });
                setItems((prev) => {
                  const merged = mergePresets(prev, [res.item]);
                  saveLocalPresets(merged);
                  return merged;
                });
              } catch {
                // local preset already available
              }
              setName("");
            }}
          >
            {t("保存模板")}
          </Button>
        </div>

        <Input
          value={promptHint}
          onChange={(e) => setPromptHint(e.target.value)}
          className="border-border/70 bg-background/70"
          placeholder={t("模板提示词（可选）")}
        />

        <div className="max-h-56 space-y-2 overflow-auto">
          {items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 bg-background/60 p-3 text-xs text-muted-foreground">
              {t("暂无模板")}
            </div>
          ) : (
            items.slice(0, 20).map((item) => (
              <div key={item.id} className="rounded-xl border border-border/70 bg-background/60 p-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{item.name}</div>
                    <div className="text-[11px] text-muted-foreground">{item.category}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-border/70"
                      onClick={() => onApply({ promptHint: item.prompt_hint, params: item.params || {} })}
                    >
                      {t("应用")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-border/70"
                      onClick={async () => {
                        try {
                          await deletePromptPreset(item.id);
                        } catch {
                          // ignore cloud delete failures for local items
                        }
                        setItems((prev) => {
                          const next = prev.filter((x) => x.id !== item.id);
                          saveLocalPresets(next);
                          return next;
                        });
                      }}
                    >
                      {t("删除")}
                    </Button>
                  </div>
                </div>
                {item.prompt_hint ? <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">{item.prompt_hint}</div> : null}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
