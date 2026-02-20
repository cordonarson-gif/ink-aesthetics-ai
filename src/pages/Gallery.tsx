import AppShell from "@/components/AppShell";
import { useArchive } from "@/contexts/ArchiveContext";
import { useCommunity } from "@/contexts/CommunityContext";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Globe2, Heart, MessageCircle, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

export default function Gallery() {
  const { user } = useAuth();
  const { items, clear } = useArchive();
  const { posts, publish, unpublish, isPublished, toggleLike, addComment } = useCommunity();
  const [draft, setDraft] = useState<Record<string, string>>({});

  const myPosts = useMemo(() => posts.filter((x) => x.ownerUserId === user?.id), [posts, user?.id]);

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div>
          <div className="font-display text-4xl tracking-wide">可计算画廊</div>
          <div className="mt-2 text-sm text-muted-foreground">
            你的作品默认仅自己可见。你可手动发布到公开画廊，发布后所有用户可见，并支持点赞与评论。
          </div>
        </div>

        <Tabs defaultValue="mine">
          <TabsList className="border border-border/70 bg-background/60">
            <TabsTrigger value="mine">我的作品（{items.length}）</TabsTrigger>
            <TabsTrigger value="public">公开画廊（{posts.length}）</TabsTrigger>
          </TabsList>

          <TabsContent value="mine" className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">已发布 {myPosts.length} / {items.length}</div>
              <Button
                variant="outline"
                className="border-border/70"
                onClick={() => {
                  clear();
                  toast.success("已清空我的归档作品");
                }}
                disabled={items.length === 0}
              >
                <Trash2 className="mr-2 h-4 w-4" /> 清空
              </Button>
            </div>

            {items.length === 0 ? (
              <Card className="border-border/70 bg-card/60">
                <CardContent className="p-10 text-center">
                  <div className="font-display text-3xl">尚无归档作品</div>
                  <div className="mt-2 text-sm text-muted-foreground">去 AI 工作台生成并定稿后再来发布。</div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {items.map((it) => {
                  const published = isPublished(it.id);
                  return (
                    <Card key={it.id} className="overflow-hidden border-border/70 bg-card/60">
                      <img src={it.dataUrl} alt={it.title} className="aspect-[4/3] w-full object-cover" />
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold leading-5">{it.title}</div>
                          {published ? (
                            <Badge className="bg-accent text-accent-foreground">已公开</Badge>
                          ) : (
                            <Badge variant="outline" className="border-border/70 text-muted-foreground">
                              私有
                            </Badge>
                          )}
                        </div>

                        <Separator className="my-3 bg-border/70" />
                        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                          <KV k="水墨" v={pct(it.params.styleInkWash)} />
                          <KV k="气韵" v={pct(it.params.structureRhythm)} />
                          <KV k="皴法" v={pct(it.params.textureCun)} />
                          <KV k="墨晕" v={pct(it.params.edgeBleed)} />
                        </div>

                        <Button
                          className="mt-4 w-full bg-primary text-primary-foreground hover:bg-primary/90"
                          variant={published ? "outline" : "default"}
                          onClick={() => {
                            try {
                              if (published) {
                                unpublish(it.id);
                                toast.success("已取消公开发布");
                              } else {
                                publish(it);
                                toast.success("已发布到公开画廊");
                              }
                            } catch (e) {
                              toast.error("操作失败", { description: String((e as Error).message || e) });
                            }
                          }}
                        >
                          <Globe2 className="mr-2 h-4 w-4" />
                          {published ? "取消公开" : "发布到公开画廊"}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="public" className="mt-4">
            {posts.length === 0 ? (
              <Card className="border-border/70 bg-card/60">
                <CardContent className="p-10 text-center">
                  <div className="font-display text-3xl">公开画廊为空</div>
                  <div className="mt-2 text-sm text-muted-foreground">发布你的第一幅作品，让所有用户都能看到。</div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {posts.map((p) => {
                  const liked = p.likes.includes(user?.id || "");
                  return (
                    <Card key={p.id} className="overflow-hidden border-border/70 bg-card/60">
                      <img src={p.dataUrl} alt={p.title} className="aspect-[4/3] w-full object-cover" />
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold">{p.title}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              作者：{p.ownerUserName} · 发布于 {new Date(p.publishedAt).toLocaleString("zh-CN")}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant={liked ? "default" : "outline"}
                              className={liked ? "bg-accent text-accent-foreground hover:bg-accent/90" : "border-border/70"}
                              onClick={() => {
                                try {
                                  toggleLike(p.id);
                                } catch (e) {
                                  toast.error("点赞失败", { description: String((e as Error).message || e) });
                                }
                              }}
                            >
                              <Heart className="mr-1 h-4 w-4" /> {p.likes.length}
                            </Button>
                            <Badge variant="outline" className="border-border/70 text-muted-foreground">
                              <MessageCircle className="mr-1 h-3 w-3" /> {p.comments.length}
                            </Badge>
                          </div>
                        </div>

                        <Separator className="my-3 bg-border/70" />

                        <div className="max-h-36 space-y-2 overflow-auto rounded-xl border border-border/70 bg-background/60 p-2 text-xs">
                          {p.comments.length === 0 ? (
                            <div className="text-muted-foreground">暂无评论</div>
                          ) : (
                            p.comments.map((c) => (
                              <div key={c.id} className="rounded-lg bg-background/70 px-2 py-1.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold">{c.userName}</span>
                                  <span className="text-[10px] text-muted-foreground">
                                    {new Date(c.createdAt).toLocaleString("zh-CN")}
                                  </span>
                                </div>
                                <div className="mt-1 text-foreground/80">{c.content}</div>
                              </div>
                            ))
                          )}
                        </div>

                        <div className="mt-3 flex items-center gap-2">
                          <Input
                            value={draft[p.id] ?? ""}
                            onChange={(e) => setDraft((prev) => ({ ...prev, [p.id]: e.target.value }))}
                            className="border-border/70 bg-background/70"
                            placeholder="写下你的评论…"
                          />
                          <Button
                            className="bg-primary text-primary-foreground hover:bg-primary/90"
                            onClick={() => {
                              try {
                                addComment(p.id, draft[p.id] ?? "");
                                setDraft((prev) => ({ ...prev, [p.id]: "" }));
                                toast.success("评论已发布");
                              } catch (e) {
                                toast.error("评论失败", { description: String((e as Error).message || e) });
                              }
                            }}
                          >
                            发送
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/60 px-3 py-2">
      <div className="text-[10px] opacity-70">{k}</div>
      <div className="mt-1 text-xs text-foreground/80">{v}</div>
    </div>
  );
}
