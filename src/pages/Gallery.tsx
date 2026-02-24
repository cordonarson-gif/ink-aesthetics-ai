import AppShell from "@/components/AppShell";
import ImageCard from "@/components/Gallery/ImageCard";
import { useArchive } from "@/contexts/ArchiveContext";
import { useCommunity } from "@/contexts/CommunityContext";
import { useAuth } from "@/contexts/AuthContext";
import { useLocale } from "@/contexts/LocaleContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Globe2, Heart, MessageCircle, Share2, ShieldAlert, Trash2, UploadCloud, UserMinus, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { isAdminUser } from "@/lib/authz";

export default function Gallery() {
  const { t, locale } = useLocale();
  const { user } = useAuth();
  const { items, clear } = useArchive();
  const {
    posts,
    followingFeed,
    followingUserIds,
    publish,
    publishUpload,
    unpublish,
    removePost,
    reportPost,
    isPublished,
    toggleFollow,
    toggleLike,
    addComment,
  } = useCommunity();

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadPrompt, setUploadPrompt] = useState("");
  const [uploadDataUrl, setUploadDataUrl] = useState("");

  const myPosts = useMemo(() => posts.filter((x) => x.ownerUserId === user?.id), [posts, user?.id]);
  const publicPosts = useMemo(() => posts.filter((x) => x.moderationStatus === "approved"), [posts]);
  const followPosts = useMemo(() => followingFeed.filter((x) => x.moderationStatus === "approved"), [followingFeed]);

  useEffect(() => {
    const postId = getPostIdFromHash();
    if (!postId) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`post-${postId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [publicPosts.length]);

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div>
          <div className="font-display text-4xl tracking-wide">绘画社区</div>
          <div className="mt-2 text-sm text-muted-foreground">
            {t("平台支持两种发布方式：AI 生成作品直接发布，或用户自行上传后发布。")}
          </div>
          <div className="mt-3 rounded-xl border border-border/70 bg-background/60 p-3 text-xs text-muted-foreground">
            <div className="mb-1 flex items-center gap-2 font-semibold text-foreground/80">
              <ShieldAlert className="h-4 w-4" />
              {t("社区审核与应急处置")}
            </div>
            {t("发帖与评论均执行审核，禁止违法、色情、暴力、侵权与敏感内容。所有已发布作品均支持点赞、评论、转发、举报；")}
            {t("举报达到阈值会触发自动下线并等待复核。")}
          </div>
        </div>

        <Tabs defaultValue="mine">
          <TabsList className="border border-border/70 bg-background/60">
            <TabsTrigger value="mine">{t("我的作品")}（{items.length}）</TabsTrigger>
            <TabsTrigger value="public">{t("公开画廊")}（{publicPosts.length}）</TabsTrigger>
            <TabsTrigger value="following">{t("关注动态")}（{followPosts.length}）</TabsTrigger>
          </TabsList>

          <TabsContent value="mine" className="mt-4 space-y-4">
            <Card className="border-border/70 bg-card/60">
              <CardContent className="grid gap-3 p-4 md:grid-cols-12">
                <div className="md:col-span-4">
                  <div className="text-sm font-semibold">{t("上传后发布")}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{t("上传 JPG/PNG/WebP 后可直接发布到公开画廊。")}</div>
                </div>
                <div className="md:col-span-3">
                  <Input
                    value={uploadTitle}
                    onChange={(e) => setUploadTitle(e.target.value)}
                    className="border-border/70 bg-background/70"
                    placeholder={t("上传作品标题")}
                  />
                </div>
                <div className="md:col-span-3">
                  <Input
                    value={uploadPrompt}
                    onChange={(e) => setUploadPrompt(e.target.value)}
                    className="border-border/70 bg-background/70"
                    placeholder={t("补充描述（可选）")}
                  />
                </div>
                <div className="md:col-span-2 flex gap-2">
                  <label className="flex-1">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => {
                          setUploadDataUrl(String(reader.result || ""));
                          if (!uploadTitle.trim()) {
                            setUploadTitle(file.name.replace(/\.[^.]+$/, ""));
                          }
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                    <Button variant="outline" className="w-full border-border/70" asChild>
                      <span>
                        <UploadCloud className="mr-2 h-4 w-4" />
                        {t("选择图片")}
                      </span>
                    </Button>
                  </label>
                  <Button
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={async () => {
                      try {
                        await publishUpload({
                          title: uploadTitle,
                          dataUrl: uploadDataUrl,
                          promptArtistic: uploadPrompt,
                        });
                        setUploadTitle("");
                        setUploadPrompt("");
                        setUploadDataUrl("");
                        toast.success(t("上传作品已发布，墨点奖励已到账"));
                      } catch (e) {
                        toast.error(t("发布失败"), { description: String((e as Error).message || e) });
                      }
                    }}
                  >
                    {t("发布")}
                  </Button>
                </div>
                {uploadDataUrl && (
                  <div className="md:col-span-12">
                    <img src={uploadDataUrl} alt="upload-preview" className="max-h-48 rounded-lg border border-border/70" />
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">{t("已发布")} {myPosts.length} / {t("归档")} {items.length}</div>
              <Button
                variant="outline"
                className="border-border/70"
                onClick={() => {
                  clear();
                  toast.success(t("已清空我的归档作品"));
                }}
                disabled={items.length === 0}
              >
                <Trash2 className="mr-2 h-4 w-4" /> {t("清空归档")}
              </Button>
            </div>

            {items.length === 0 ? (
              <Card className="border-border/70 bg-card/60">
                <CardContent className="p-10 text-center">
                  <div className="font-display text-3xl">{t("暂无归档作品")}</div>
                  <div className="mt-2 text-sm text-muted-foreground">{t("先去 AI 工作台生成作品，再回来发布到社区。")}</div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {items.map((it) => {
                  const published = isPublished(it.id);
                  return (
                    <Card key={it.id} className="overflow-hidden border-border/70 bg-card/60">
                      <ImageCard src={it.dataUrl} alt={it.title} className="aspect-[4/3]" widthHint={960} />
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold leading-5">{it.title}</div>
                          {published ? (
                            <Badge className="bg-accent text-accent-foreground">{t("已公开")}</Badge>
                          ) : (
                            <Badge variant="outline" className="border-border/70 text-muted-foreground">
                              {t("私有")}
                            </Badge>
                          )}
                        </div>

                        <Separator className="my-3 bg-border/70" />
                        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                          <KV k={t("水墨")} v={pct(it.params.styleInkWash)} />
                          <KV k={t("气韵")} v={pct(it.params.structureRhythm)} />
                          <KV k={t("皴法")} v={pct(it.params.textureCun)} />
                          <KV k={t("墨晕")} v={pct(it.params.edgeBleed)} />
                        </div>

                        <Button
                          className="mt-4 w-full bg-primary text-primary-foreground hover:bg-primary/90"
                          variant={published ? "outline" : "default"}
                          onClick={async () => {
                            try {
                              if (published) {
                                await unpublish(it.id);
                                toast.success(t("已取消公开发布"));
                              } else {
                                await publish(it);
                                toast.success(t("已发布到公开画廊，墨点奖励已到账"));
                              }
                            } catch (e) {
                              toast.error(t("操作失败"), { description: String((e as Error).message || e) });
                            }
                          }}
                        >
                          <Globe2 className="mr-2 h-4 w-4" />
                          {published ? t("取消公开") : t("发布到公开画廊")}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="public" className="mt-4">
            {publicPosts.length === 0 ? (
              <Card className="border-border/70 bg-card/60">
                <CardContent className="p-10 text-center">
                  <div className="font-display text-3xl">{t("公开画廊为空")}</div>
                  <div className="mt-2 text-sm text-muted-foreground">{t("发布你的第一幅作品，让社区看到你的创作。")}</div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {publicPosts.map((p) => {
                  const liked = p.likes.includes(user?.id || "");
                  const canDelete = isAdminUser(user) || user?.id === p.ownerUserId;
                  const followed = followingUserIds.includes(p.ownerUserId);
                  const shareLink = buildShareLink(p.id);
                  return (
                    <Card key={p.id} id={`post-${p.id}`} className="overflow-hidden border-border/70 bg-card/60">
                      <ImageCard src={p.dataUrl} alt={p.title} className="aspect-[4/3]" widthHint={1200} />
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <div className="text-sm font-semibold">{p.title}</div>
                              <Badge variant="outline" className="border-border/70 text-muted-foreground">
                                {p.aiGenerated ? p.aiLabel || t("AI生成") : p.aiLabel || t("用户上传")}
                              </Badge>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {t("作者")}：{p.ownerUserName} · {t("发布于")} {new Date(p.publishedAt).toLocaleString(locale)}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {p.ownerUserId !== user?.id && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-border/70"
                                onClick={async () => {
                                  try {
                                    await toggleFollow(p.ownerUserId);
                                    toast.success(followed ? t("已取消关注") : t("已关注作者"));
                                  } catch (e) {
                                    toast.error(t("操作失败"), { description: String((e as Error).message || e) });
                                  }
                                }}
                              >
                                {followed ? <UserMinus className="mr-1 h-3 w-3" /> : <UserPlus className="mr-1 h-3 w-3" />}
                                {followed ? t("取消关注") : t("关注")}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant={liked ? "default" : "outline"}
                              className={liked ? "bg-accent text-accent-foreground hover:bg-accent/90" : "border-border/70"}
                              onClick={async () => {
                                try {
                                  await toggleLike(p.id);
                                } catch (e) {
                                  toast.error(t("点赞失败"), { description: String((e as Error).message || e) });
                                }
                              }}
                            >
                              <Heart className="mr-1 h-4 w-4" /> {p.likes.length}
                            </Button>
                            <Badge variant="outline" className="border-border/70 text-muted-foreground">
                              <MessageCircle className="mr-1 h-3 w-3" /> {p.comments.length}
                            </Badge>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-border/70"
                              onClick={async () => {
                                try {
                                  if (navigator.share) {
                                    await navigator.share({
                                      title: p.title,
                                      text: `${t("来看看这幅作品")}：${p.title}`,
                                      url: shareLink,
                                    });
                                  } else {
                                    await navigator.clipboard.writeText(shareLink);
                                    toast.success(t("转发链接已复制"));
                                  }
                                } catch {
                                  try {
                                    await navigator.clipboard.writeText(shareLink);
                                    toast.success(t("转发链接已复制"));
                                  } catch (e) {
                                    toast.error(t("转发失败"), { description: String((e as Error).message || e) });
                                  }
                                }
                              }}
                            >
                              <Share2 className="mr-1 h-3 w-3" />
                              {t("转发")}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-border/70"
                              onClick={async () => {
                                try {
                                  const reason = window.prompt(t("请输入举报原因（必填）"), t("疑似违规内容"));
                                  if (!reason) return;
                                  await reportPost(p.id, reason);
                                  toast.success(t("举报已提交"));
                                } catch (e) {
                                  toast.error(t("举报失败"), { description: String((e as Error).message || e) });
                                }
                              }}
                            >
                              {t("举报")}
                            </Button>
                            {canDelete && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-border/70"
                                onClick={async () => {
                                  try {
                                    await removePost(p.id);
                                    toast.success(t("作品已下线并删除"));
                                  } catch (e) {
                                    toast.error(t("删除失败"), { description: String((e as Error).message || e) });
                                  }
                                }}
                              >
                                {t("删除")}
                              </Button>
                            )}
                          </div>
                        </div>

                        <Separator className="my-3 bg-border/70" />

                        <div className="max-h-36 space-y-2 overflow-auto rounded-xl border border-border/70 bg-background/60 p-2 text-xs">
                          {p.comments.length === 0 ? (
                            <div className="text-muted-foreground">{t("暂无评论")}</div>
                          ) : (
                            p.comments.map((c) => (
                              <div key={c.id} className="rounded-lg bg-background/70 px-2 py-1.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold">{c.userName}</span>
                                  <span className="text-[10px] text-muted-foreground">
                                    {new Date(c.createdAt).toLocaleString(locale)}
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
                            placeholder={t("写下你的评论")}
                          />
                          <Button
                            className="bg-primary text-primary-foreground hover:bg-primary/90"
                            onClick={async () => {
                              try {
                                await addComment(p.id, draft[p.id] ?? "");
                                setDraft((prev) => ({ ...prev, [p.id]: "" }));
                                toast.success(t("评论已发布"));
                              } catch (e) {
                                toast.error(t("评论失败"), { description: String((e as Error).message || e) });
                              }
                            }}
                          >
                            {t("发送")}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="following" className="mt-4">
            {followPosts.length === 0 ? (
              <Card className="border-border/70 bg-card/60">
                <CardContent className="p-10 text-center">
                  <div className="font-display text-3xl">{t("暂无关注动态")}</div>
                  <div className="mt-2 text-sm text-muted-foreground">{t("去公开画廊关注你喜欢的作者")}</div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {followPosts.map((p) => (
                  <Card key={`follow-${p.id}`} className="overflow-hidden border-border/70 bg-card/60">
                    <ImageCard src={p.dataUrl} alt={p.title} className="aspect-[4/3]" widthHint={960} />
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">{p.title}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {t("作者")}：{p.ownerUserName} · {new Date(p.publishedAt).toLocaleString(locale)}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-border/70"
                          onClick={async () => {
                            try {
                              await toggleFollow(p.ownerUserId);
                              toast.success(t("已取消关注"));
                            } catch (e) {
                              toast.error(t("操作失败"), { description: String((e as Error).message || e) });
                            }
                          }}
                        >
                          <UserMinus className="mr-1 h-3 w-3" />
                          {t("取消关注")}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function getPostIdFromHash(): string {
  try {
    const hash = window.location.hash || "";
    const idx = hash.indexOf("?");
    if (idx < 0) return "";
    const params = new URLSearchParams(hash.slice(idx + 1));
    return (params.get("post") || "").trim();
  } catch {
    return "";
  }
}

function buildShareLink(postId: string): string {
  const origin = window.location.origin || "";
  return `${origin}/#/gallery?post=${encodeURIComponent(postId)}`;
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
