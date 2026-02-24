import AppShell from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/contexts/LocaleContext";
import { useForum } from "@/contexts/ForumContext";
import { useAuth } from "@/contexts/AuthContext";
import { Heart, Search, Tags, UserRoundPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

function parseCommaValues(input: string, maxItems: number, maxLength: number): string[] {
  const out: string[] = [];
  for (const part of String(input || "").split(",")) {
    const text = part.trim();
    if (!text) continue;
    const normalized = text.slice(0, maxLength);
    if (out.includes(normalized)) continue;
    out.push(normalized);
    if (out.length >= maxItems) break;
  }
  return out;
}

export default function ForumPage() {
  const { t, locale } = useLocale();
  const { user } = useAuth();
  const { questions, askQuestion, answerQuestion, inviteAnswer, toggleSolved, toggleLike, reloadQuestions } = useForum();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [inviteInput, setInviteInput] = useState("");
  const [searchText, setSearchText] = useState("");
  const [activeTag, setActiveTag] = useState<string>("");
  const [sort, setSort] = useState<"hot" | "latest" | "unanswered">("hot");
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>({});
  const [inviteDrafts, setInviteDrafts] = useState<Record<string, string>>({});

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const q of questions) {
      for (const tag of q.tags || []) tags.add(tag);
    }
    return Array.from(tags).slice(0, 16);
  }, [questions]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reloadQuestions({
        page: 1,
        page_size: 300,
        q: searchText.trim() || undefined,
        tag: activeTag || undefined,
        sort,
      }).catch(() => undefined);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [activeTag, reloadQuestions, searchText, sort]);

  return (
    <AppShell>
      <div className="grid gap-6 xl:grid-cols-12">
        <section className="space-y-4 xl:col-span-4">
          <Card className="border-border/70 bg-card/70">
            <CardHeader>
              <CardTitle>{t("问题求助")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="border-border/70 bg-background/70"
                placeholder={t("问题标题")}
              />
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="min-h-32 border-border/70 bg-background/70"
                placeholder={t("请详细描述遇到的问题、环境与预期结果")}
              />
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                className="border-border/70 bg-background/70"
                placeholder={t("标签（逗号分隔，例如：构图,笔触,水墨）")}
              />
              <Input
                value={inviteInput}
                onChange={(e) => setInviteInput(e.target.value)}
                className="border-border/70 bg-background/70"
                placeholder={t("邀请回答用户ID（逗号分隔，可选）")}
              />
              <Button
                className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
                onClick={async () => {
                  try {
                    await askQuestion(title, content, {
                      tags: parseCommaValues(tagInput, 8, 24),
                      invitedUserIds: parseCommaValues(inviteInput, 20, 64),
                    });
                    setTitle("");
                    setContent("");
                    setTagInput("");
                    setInviteInput("");
                    toast.success(t("问题发布成功"));
                  } catch (e) {
                    toast.error(t("发布失败"), { description: String((e as Error).message || e) });
                  }
                }}
              >
                {t("发布问题")}
              </Button>
              <div className="text-xs text-muted-foreground">{t("回答他人问题可获得墨点奖励，帮助越多，收益越高。")}</div>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4 xl:col-span-8">
          <Card className="border-border/70 bg-card/70">
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex min-w-56 flex-1 items-center gap-2 rounded-md border border-border/70 bg-background/70 px-2">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <Input
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    className="border-0 bg-transparent px-0 focus-visible:ring-0"
                    placeholder={t("搜索问题标题或内容")}
                  />
                </div>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as "hot" | "latest" | "unanswered")}
                  className="h-10 rounded-md border border-border/70 bg-background/70 px-3 text-sm outline-none"
                >
                  <option value="hot">{t("排序：最热")}</option>
                  <option value="latest">{t("排序：最新")}</option>
                  <option value="unanswered">{t("排序：待回答优先")}</option>
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  className={activeTag ? "cursor-pointer bg-secondary text-foreground" : "cursor-pointer bg-primary text-primary-foreground"}
                  onClick={() => setActiveTag("")}
                >
                  <Tags className="mr-1 h-3 w-3" />
                  {t("全部标签")}
                </Badge>
                {allTags.map((tag) => (
                  <Badge
                    key={tag}
                    className={
                      activeTag === tag
                        ? "cursor-pointer bg-accent text-accent-foreground"
                        : "cursor-pointer bg-secondary text-foreground"
                    }
                    onClick={() => setActiveTag(tag)}
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          {questions.length === 0 ? (
            <Card className="border-border/70 bg-card/70">
              <CardContent className="p-10 text-center">
                <div className="font-display text-3xl">{t("论坛暂时还没有问题")}</div>
                <div className="mt-2 text-sm text-muted-foreground">{t("你可以发布第一条求助帖，邀请社区共同答疑。")}</div>
              </CardContent>
            </Card>
          ) : (
            questions.map((q) => {
              const liked = q.likes.includes(user?.id || "");
              const isOwner = user?.id === q.userId;
              return (
                <Card key={q.id} className="border-border/70 bg-card/70">
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="text-lg font-semibold">{q.title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {t("提问者")}：{q.userName} · {new Date(q.createdAt).toLocaleString(locale)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant={liked ? "default" : "outline"}
                          className={liked ? "bg-accent text-accent-foreground hover:bg-accent/90" : "border-border/70"}
                          onClick={async () => {
                            try {
                              await toggleLike(q.id);
                            } catch (e) {
                              toast.error(t("操作失败"), { description: String((e as Error).message || e) });
                            }
                          }}
                        >
                          <Heart className="mr-1 h-4 w-4" />
                          {q.likes.length}
                        </Button>
                        <Badge className={q.solved ? "bg-emerald-600 text-white" : "bg-secondary text-foreground"}>
                          {q.solved ? t("已解决") : t("待解决")}
                        </Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-border/70"
                          onClick={async () => {
                            try {
                              await toggleSolved(q.id);
                            } catch (e) {
                              toast.error(t("操作失败"), { description: String((e as Error).message || e) });
                            }
                          }}
                        >
                          {t("切换状态")}
                        </Button>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      {(q.tags || []).map((tag) => (
                        <Badge key={`${q.id}-${tag}`} className="bg-secondary text-foreground">
                          {tag}
                        </Badge>
                      ))}
                    </div>

                    <div className="mt-3 rounded-lg border border-border/70 bg-background/60 p-3 text-sm">{q.content}</div>

                    {(q.invitedUserIds || []).length > 0 ? (
                      <div className="mt-3 rounded-md border border-border/70 bg-background/50 p-2 text-xs text-muted-foreground">
                        <UserRoundPlus className="mr-1 inline h-3 w-3" />
                        {t("已邀请回答")}：{q.invitedUserIds.join(", ")}
                      </div>
                    ) : null}

                    <div className="mt-4 space-y-2">
                      <div className="text-sm font-semibold">
                        {t("回答")}（{q.answers.length}）
                      </div>
                      <div className="max-h-52 space-y-2 overflow-auto pr-1">
                        {q.answers.length === 0 ? (
                          <div className="text-xs text-muted-foreground">{t("暂时还没有回答")}</div>
                        ) : (
                          q.answers.map((a) => (
                            <div key={a.id} className="rounded-lg border border-border/70 bg-background/70 px-3 py-2">
                              <div className="text-xs text-muted-foreground">
                                {a.userName} · {new Date(a.createdAt).toLocaleString(locale)}
                              </div>
                              <div className="mt-1 text-sm">{a.content}</div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <Input
                        value={draftAnswers[q.id] || ""}
                        onChange={(e) => setDraftAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                        className="border-border/70 bg-background/70"
                        placeholder={t("写下你的回答（回答可获得墨点奖励）")}
                      />
                      <Button
                        className="bg-primary text-primary-foreground hover:bg-primary/90"
                        onClick={async () => {
                          try {
                            await answerQuestion(q.id, draftAnswers[q.id] || "");
                            setDraftAnswers((prev) => ({ ...prev, [q.id]: "" }));
                            toast.success(t("回答已发布，墨点奖励已到账"));
                          } catch (e) {
                            toast.error(t("回答失败"), { description: String((e as Error).message || e) });
                          }
                        }}
                      >
                        {t("回答")}
                      </Button>
                    </div>

                    {isOwner ? (
                      <div className="mt-3 flex items-center gap-2">
                        <Input
                          value={inviteDrafts[q.id] || ""}
                          onChange={(e) => setInviteDrafts((prev) => ({ ...prev, [q.id]: e.target.value }))}
                          className="border-border/70 bg-background/70"
                          placeholder={t("追加邀请回答用户ID（逗号分隔）")}
                        />
                        <Button
                          variant="outline"
                          className="border-border/70"
                          onClick={async () => {
                            try {
                              const list = parseCommaValues(inviteDrafts[q.id] || "", 20, 64);
                              await inviteAnswer(q.id, list);
                              setInviteDrafts((prev) => ({ ...prev, [q.id]: "" }));
                              toast.success(t("邀请已发送"));
                            } catch (e) {
                              toast.error(t("邀请失败"), { description: String((e as Error).message || e) });
                            }
                          }}
                        >
                          {t("邀请回答")}
                        </Button>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })
          )}
        </section>
      </div>
    </AppShell>
  );
}
