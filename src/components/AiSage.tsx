import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Loader2, MessageCircle, Send, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { callDeepSeekChatAPI, type DeepSeekChatMessage } from "@/lib/deepseek-chat";
import { useLocale } from "@/contexts/LocaleContext";

type Msg = { role: "user" | "assistant"; content: string; id: string };
export default function AiSage() {
  const { t } = useLocale();
  const [open, setOpen] = useState(true);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>(() => [
    {
      id: "m0",
      role: "assistant",
      content: t("aisage.welcome"),
    },
  ]);

  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: 999999, behavior: "smooth" });
  }, [msgs.length, open]);

  const quick = useMemo(
    () => [
      t("aisage.quick.cunfa"),
      t("aisage.quick.licheng"),
      t("aisage.quick.eval"),
    ],
    [t]
  );

  const [sending, setSending] = useState(false);

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || sending) return;

    setInput("");
    const userMsg: Msg = { id: crypto.randomUUID(), role: "user", content: q };
    setMsgs((prev) => [...prev, userMsg]);

    setSending(true);
    try {
      const payload: DeepSeekChatMessage[] = [
        {
          role: "system",
          content: t("aisage.systemPrompt"),
        },
        ...msgs.map((m) => ({ role: m.role, content: m.content } as DeepSeekChatMessage)),
        { role: "user", content: q },
      ];

      const answer = await callDeepSeekChatAPI(payload);
      setMsgs((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: answer }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-50">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <Card className="w-[360px] overflow-hidden border-border/70 bg-background/85 backdrop-blur">
              <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-accent" />
                  <div className="font-display text-lg">{t("aisage.title")}</div>
                  <div className="text-xs text-muted-foreground">{t("aisage.badge")}</div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => setOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div ref={scrollerRef} className="max-h-[360px] overflow-auto px-4 py-3">
                <div className="space-y-4">
                  {msgs.map((m) => (
                    <div
                      key={m.id}
                      className={cn(
                        "rounded-2xl border border-border/70 px-3 py-2 text-sm",
                        m.role === "assistant" ? "bg-secondary/60" : "bg-background/70"
                      )}
                    >
                      <div className="text-[10px] text-muted-foreground">
                        {m.role === "assistant" ? t("aisage.role.assistant") : t("aisage.role.user")}
                      </div>
                      <div className="mt-1 leading-6 text-foreground/90">
                        <Streamdown>{m.content}</Streamdown>
                      </div>
                    </div>
                  ))}

                  <div className="flex flex-wrap gap-2">
                    {quick.map((q) => (
                      <button
                        key={q}
                        className="rounded-full border border-border/70 bg-background/60 px-3 py-1 text-xs text-muted-foreground hover:bg-secondary"
                        onClick={() => send(q)}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="border-t border-border/70 p-3">
                <div className="flex items-end gap-2">
                  <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    className="min-h-[52px] resize-none border-border/70 bg-background/70"
                    placeholder={t("aisage.inputPlaceholder")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        send();
                      }
                    }}
                  />
                  <Button
                    size="icon"
                    className="bg-accent text-accent-foreground hover:bg-accent/90"
                    onClick={() => send()}
                    disabled={sending}
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
                <div className="mt-2 text-[11px] text-muted-foreground">{t("aisage.sendHint")}</div>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {!open && (
        <Button
          className="h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-[0_18px_45px_-30px_rgba(0,0,0,0.5)]"
          onClick={() => setOpen(true)}
        >
          <MessageCircle className="h-5 w-5" />
        </Button>
      )}
    </div>
  );
}
