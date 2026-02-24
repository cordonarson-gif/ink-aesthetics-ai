import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocale } from "@/contexts/LocaleContext";
import { fetchPromptVersions, savePromptVersion, type PromptVersionItem } from "@/lib/workspace-api";
import { useEffect, useMemo, useState } from "react";

const LS_KEY = "ink-aesthetics-ai.workspace.prompt-versions.v1";

type PromptVersionProps = {
  rawPrompt: string;
  artisticPrompt: string;
  onRestore: (rawPrompt: string, artisticPrompt: string) => void;
};

function loadLocalVersions(): PromptVersionItem[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PromptVersionItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalVersions(items: PromptVersionItem[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(items.slice(0, 60)));
  } catch {
    // ignore quota failures
  }
}

function signature(rawPrompt: string, artisticPrompt: string): string {
  return `${rawPrompt.trim()}\n${artisticPrompt.trim()}`;
}

function mergeVersions(localItems: PromptVersionItem[], remoteItems: PromptVersionItem[]): PromptVersionItem[] {
  const seen = new Set<string>();
  const merged = [...remoteItems, ...localItems].filter((item) => {
    const sig = signature(item.raw_prompt, item.artistic_prompt || "");
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
  merged.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return merged.slice(0, 60);
}

export default function PromptVersion({ rawPrompt, artisticPrompt, onRestore }: PromptVersionProps) {
  const { t, locale } = useLocale();
  const [items, setItems] = useState<PromptVersionItem[]>(() => loadLocalVersions());
  const [selected, setSelected] = useState<PromptVersionItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetchPromptVersions(100);
        if (cancelled) return;
        setItems((prev) => {
          const merged = mergeVersions(prev, res.items || []);
          saveLocalVersions(merged);
          return merged;
        });
      } catch {
        // backend may be unavailable in local-only mode
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const raw = rawPrompt.trim();
      const artistic = artisticPrompt.trim();
      if (!raw) return;

      setItems((prev) => {
        if (prev.some((x) => signature(x.raw_prompt, x.artistic_prompt || "") === signature(raw, artistic))) {
          return prev;
        }
        const next: PromptVersionItem[] = [
          {
            id: `local-${Date.now()}`,
            user_id: "local",
            raw_prompt: raw,
            artistic_prompt: artistic,
            content_hash: "",
            created_at: new Date().toISOString(),
          },
          ...prev,
        ].slice(0, 60);
        saveLocalVersions(next);
        return next;
      });

      void savePromptVersion({ raw_prompt: raw, artistic_prompt: artistic }).catch(() => {
        // keep local version when cloud sync fails
      });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [rawPrompt, artisticPrompt]);

  const delta = useMemo(() => {
    if (!selected) return 0;
    return Math.abs((selected.raw_prompt || "").length - (rawPrompt || "").length);
  }, [rawPrompt, selected]);

  return (
    <Card className="border-border/70 bg-card/70">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{t("Prompt 版本管理")}</CardTitle>
          <Button
            size="sm"
            variant="outline"
            className="border-border/70"
            onClick={async () => {
              const raw = rawPrompt.trim();
              const artistic = artisticPrompt.trim();
              if (!raw) return;
              try {
                const res = await savePromptVersion({ raw_prompt: raw, artistic_prompt: artistic });
                setItems((prev) => {
                  const next = mergeVersions(prev, [res.item]);
                  saveLocalVersions(next);
                  return next;
                });
              } catch {
                // local list already auto-saved
              }
            }}
          >
            {t("保存当前版本")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {selected ? (
          <div className="rounded-xl border border-border/70 bg-background/60 p-3 text-xs text-muted-foreground">
            <div>{t("与当前提示词长度差")}：{delta}</div>
            <div className="mt-1 line-clamp-2">{selected.raw_prompt}</div>
          </div>
        ) : null}

        <div className="max-h-48 space-y-2 overflow-auto">
          {items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 bg-background/60 p-3 text-xs text-muted-foreground">
              {t("暂无历史版本")}
            </div>
          ) : (
            items.slice(0, 12).map((item) => (
              <div key={item.id} className="rounded-xl border border-border/70 bg-background/60 p-2">
                <div className="text-[11px] text-muted-foreground">{new Date(item.created_at).toLocaleString(locale)}</div>
                <div className="mt-1 line-clamp-2 text-xs text-foreground/85">{item.raw_prompt}</div>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-border/70"
                    onClick={() => setSelected(item)}
                  >
                    {t("对比")}
                  </Button>
                  <Button
                    size="sm"
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={() => onRestore(item.raw_prompt || "", item.artistic_prompt || "")}
                  >
                    {t("一键复用")}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
