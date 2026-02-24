import AppShell from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useArchive } from "@/contexts/ArchiveContext";
import { useAuth } from "@/contexts/AuthContext";
import { useCommunity } from "@/contexts/CommunityContext";
import { useCredits } from "@/contexts/CreditsContext";
import { useForum } from "@/contexts/ForumContext";
import { useLocale } from "@/contexts/LocaleContext";
import { fetchMyFeedback, markFeedbackRead, submitFeedback, type FeedbackCategory, type FeedbackItem } from "@/lib/feedback-api";
import { Link } from "wouter";
import { toast } from "sonner";
import { useCallback, useEffect, useMemo, useState } from "react";

export default function Profile() {
  const { t, locale } = useLocale();
  const { user, updateProfile, changePassword } = useAuth();
  const { credits } = useCredits();
  const { items } = useArchive();
  const { posts } = useCommunity();
  const { questions } = useForum();

  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [feedbackCategory, setFeedbackCategory] = useState<FeedbackCategory>("general");
  const [feedbackTitle, setFeedbackTitle] = useState("");
  const [feedbackContent, setFeedbackContent] = useState("");
  const [feedbackContact, setFeedbackContact] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackList, setFeedbackList] = useState<FeedbackItem[]>([]);
  const [feedbackUnread, setFeedbackUnread] = useState(0);
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  const myPublished = useMemo(() => posts.filter((x) => x.ownerUserId === user?.id), [posts, user?.id]);
  const myQuestions = useMemo(() => questions.filter((q) => q.userId === user?.id), [questions, user?.id]);
  const myAnswers = useMemo(
    () => questions.reduce((acc, q) => acc + q.answers.filter((a) => a.userId === user?.id).length, 0),
    [questions, user?.id]
  );

  const loadMyFeedback = useCallback(async () => {
    if (!user) return;
    setFeedbackLoading(true);
    try {
      const res = await fetchMyFeedback(100);
      setFeedbackList(res.items || []);
      setFeedbackUnread(Number(res.unread_reply_count || 0));
    } catch (e) {
      toast.error(t("加载我的反馈失败"), { description: String((e as Error).message || e) });
    } finally {
      setFeedbackLoading(false);
    }
  }, [t, user]);

  useEffect(() => {
    void loadMyFeedback();
  }, [loadMyFeedback]);

  if (!user) return null;

  return (
    <AppShell>
      <div className="grid gap-6 lg:grid-cols-12">
        <section className="space-y-6 lg:col-span-5">
          <Card className="border-border/70 bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">{t("个人中心")}</CardTitle>
              <div className="mt-1 text-sm text-muted-foreground">
                {t("原“账户面板”已迁移至本页，账户额度、规则、奖励与合规信息统一在此管理。")}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <div className="text-xs text-muted-foreground">{t("显示名称")}</div>
                <div className="mt-1 font-display text-3xl">{user.displayName}</div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {t("用户名")}：{user.username} · {t("注册时间")}：{new Date(user.createdAt).toLocaleString(locale)}
                </div>
              </div>

              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <div className="text-sm font-semibold">{t("快捷入口")}</div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <Link href="/workspace">
                    <Button variant="outline" className="w-full border-border/70">
                      {t("AI工作台")}
                    </Button>
                  </Link>
                  <Link href="/gallery">
                    <Button variant="outline" className="w-full border-border/70">
                      {t("绘画社区")}
                    </Button>
                  </Link>
                  <Link href="/forum">
                    <Button variant="outline" className="w-full border-border/70">
                      {t("论坛")}
                    </Button>
                  </Link>
                </div>
              </div>

              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <div className="text-sm font-semibold">{t("登录绑定状态")}</div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <Badge variant="outline" className="border-border/70">
                    {t("邮箱")}：{user.email ? t("已绑定") : t("未绑定")}
                  </Badge>
                </div>
              </div>

              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <div className="text-sm font-semibold">{t("资料编辑")}</div>
                <Label className="mt-3 block">{t("显示名称")}</Label>
                <Input
                  className="mt-2 border-border/70 bg-background/70"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
                <Button
                  className="mt-3 w-full bg-accent text-accent-foreground hover:bg-accent/90"
                  onClick={async () => {
                    try {
                      const u = await updateProfile({ displayName });
                      setDisplayName(u.displayName);
                      toast.success(t("个人资料已更新"));
                    } catch (e) {
                      toast.error(t("更新失败"), { description: String((e as Error).message || e) });
                    }
                  }}
                >
                  {t("保存资料")}
                </Button>
              </div>

              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <div className="text-sm font-semibold">{t("修改密码")}</div>
                <div className="mt-3 grid gap-2">
                  <div>
                    <Label>{t("旧密码")}</Label>
                    <Input
                      type="password"
                      className="mt-2 border-border/70 bg-background/70"
                      value={oldPassword}
                      onChange={(e) => setOldPassword(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>{t("新密码")}</Label>
                    <Input
                      type="password"
                      className="mt-2 border-border/70 bg-background/70"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>{t("确认新密码")}</Label>
                    <Input
                      type="password"
                      className="mt-2 border-border/70 bg-background/70"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                  </div>
                </div>
                <Button
                  className="mt-3 w-full bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={async () => {
                    if (newPassword !== confirmPassword) {
                      toast.error(t("两次新密码不一致"));
                      return;
                    }
                    try {
                      await changePassword({ oldPassword, newPassword });
                      setOldPassword("");
                      setNewPassword("");
                      setConfirmPassword("");
                      toast.success(t("密码修改成功"));
                    } catch (e) {
                      toast.error(t("修改失败"), { description: String((e as Error).message || e) });
                    }
                  }}
                >
                  {t("更新密码")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-6 lg:col-span-7">
          <Card className="border-border/70 bg-card/70">
            <CardHeader>
              <CardTitle>{t("账户额度与规则")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <div className="text-xs text-muted-foreground">{t("当前墨点")}</div>
                <div className="mt-1 font-display text-5xl">{credits}</div>
                <div className="mt-2 text-xs text-muted-foreground">{t("支付入口已下线，平台使用墨点额度与奖励机制。")}</div>
              </div>
              <Separator className="bg-border/70" />
              <div className="space-y-2 text-sm text-muted-foreground">
                <div>{t("新用户初始额度：1000 墨点")}</div>
                <div>{t("每日恢复规则：+100 墨点")}</div>
                <div>{t("恢复上限：当余额 ≥ 500 时，当日不再恢复")}</div>
                <div>{t("作品发布奖励：每次 +80 墨点")}</div>
                <div>{t("论坛回答奖励：每次 +50 墨点")}</div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/70">
            <CardHeader>
              <CardTitle>{t("社区合规与协议")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Badge className="bg-accent text-accent-foreground">{t("已启用")}</Badge>
                {t("发帖/评论双审核")}
              </div>
              <div className="flex items-center gap-2">
                <Badge className="bg-accent text-accent-foreground">{t("已启用")}</Badge>
                {t("AI生成内容标识")}
              </div>
              <div className="flex items-center gap-2">
                <Badge className="bg-accent text-accent-foreground">{t("已启用")}</Badge>
                {t("举报与应急下线")}
              </div>
              <div>
                {t("使用平台即表示你同意遵守")}
                <Link href="/terms" className="mx-1 text-foreground underline">
                  {`《${t("用户协议")}》`}
                </Link>
                {t("与")}
                <Link href="/privacy" className="ml-1 text-foreground underline">
                  {`《${t("隐私政策")}》`}
                </Link>
                。
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/70">
            <CardHeader>
              <CardTitle>{t("意见反馈")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="md:col-span-1">
                  <Label>{t("反馈类型")}</Label>
                  <select
                    value={feedbackCategory}
                    onChange={(e) => setFeedbackCategory(e.target.value as FeedbackCategory)}
                    className="mt-2 w-full rounded-md border border-border/70 bg-background/70 px-3 py-2 text-sm outline-none"
                  >
                    <option value="general">{t("一般反馈")}</option>
                    <option value="bug">{t("问题缺陷")}</option>
                    <option value="feature">{t("功能建议")}</option>
                    <option value="abuse">{t("违规举报")}</option>
                    <option value="other">{t("其他")}</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <Label>{t("反馈标题")}</Label>
                  <Input
                    value={feedbackTitle}
                    onChange={(e) => setFeedbackTitle(e.target.value)}
                    className="mt-2 border-border/70 bg-background/70"
                    placeholder={t("请简要描述问题或建议")}
                  />
                </div>
              </div>
              <div>
                <Label>{t("反馈内容")}</Label>
                <Textarea
                  value={feedbackContent}
                  onChange={(e) => setFeedbackContent(e.target.value)}
                  className="mt-2 min-h-32 border-border/70 bg-background/70"
                  placeholder={t("请提供尽可能完整的信息，管理员可在后台查看并跟进处理。")}
                />
              </div>
              <div>
                <Label>{t("联系方式（可选）")}</Label>
                <Input
                  value={feedbackContact}
                  onChange={(e) => setFeedbackContact(e.target.value)}
                  className="mt-2 border-border/70 bg-background/70"
                    placeholder={t("联系方式（可选）")}
                  />
              </div>
              <Button
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                disabled={feedbackSubmitting}
                onClick={async () => {
                  if (!feedbackTitle.trim()) {
                    toast.error(t("请先填写反馈标题"));
                    return;
                  }
                  if (!feedbackContent.trim()) {
                    toast.error(t("请先填写反馈内容"));
                    return;
                  }
                  setFeedbackSubmitting(true);
                  try {
                    await submitFeedback({
                      category: feedbackCategory,
                      title: feedbackTitle,
                      content: feedbackContent,
                      contact: feedbackContact,
                    });
                    setFeedbackTitle("");
                    setFeedbackContent("");
                    setFeedbackContact("");
                    setFeedbackCategory("general");
                    toast.success(t("反馈已提交，管理员将在后台查看处理"));
                    await loadMyFeedback();
                  } catch (e) {
                    toast.error(t("反馈提交失败"), { description: String((e as Error).message || e) });
                  } finally {
                    setFeedbackSubmitting(false);
                  }
                }}
              >
                {feedbackSubmitting ? t("提交中...") : t("提交反馈")}
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">
                {t("我的反馈记录")}
                {feedbackUnread > 0 ? (
                  <Badge className="ml-2 bg-destructive text-white">未读回复 {feedbackUnread}</Badge>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {feedbackLoading ? (
                <div className="text-sm text-muted-foreground">{t("正在加载反馈记录...")}</div>
              ) : feedbackList.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/70 bg-background/60 p-4 text-sm text-muted-foreground">
                  {t("你还没有提交反馈。")}
                </div>
              ) : (
                <div className="space-y-3">
                  {feedbackList.slice(0, 10).map((item) => (
                    <div key={item.id} className="rounded-xl border border-border/70 bg-background/60 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-semibold">#{item.id} [{item.category}] {item.title}</div>
                        <Badge className={item.status === "open" ? "bg-secondary text-foreground" : "bg-emerald-600 text-white"}>
                          {item.status === "open" ? t("处理中") : t("已处理")}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{t("提交于")} {new Date(item.created_at).toLocaleString(locale)}</div>
                      <div className="mt-2 whitespace-pre-wrap text-sm text-foreground/85">{item.content}</div>
                      {item.admin_note ? (
                        <div className="mt-2 rounded-lg border border-border/70 bg-background/70 p-2 text-sm">
                          <div className="text-xs text-muted-foreground">{t("管理员回复")}</div>
                          <div className="mt-1">{item.admin_note}</div>
                          <div className="mt-1 text-[11px] text-muted-foreground">
                        {t("回复时间")}：{item.replied_at ? new Date(item.replied_at).toLocaleString(locale) : "-"}
                          </div>
                        </div>
                      ) : null}
                      {item.has_unread_reply ? (
                        <div className="mt-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-border/70"
                            onClick={async () => {
                              try {
                                await markFeedbackRead(item.id);
                                await loadMyFeedback();
                                toast.success(t("已标记为已读"));
                              } catch (e) {
                                toast.error(t("标记失败"), { description: String((e as Error).message || e) });
                              }
                            }}
                          >
                            {t("标记回复已读")}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">{t("创作与互动总览")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-4">
                <Stat title={t("我的作品")} value={String(items.length)} hint={t("归档总数")} />
                <Stat title={t("已发布")} value={String(myPublished.length)} hint={t("公开可见")} />
                <Stat
                  title={t("获赞数")}
                  value={String(myPublished.reduce((acc, p) => acc + p.likes.length, 0))}
                  hint={t("社区互动")}
                />
                <Stat
                  title={t("论坛贡献")}
                  value={String(myAnswers)}
                  hint={`${t("提问")} ${myQuestions.length} · ${t("回答")} ${myAnswers}`}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">{t("我的生成图片")}</CardTitle>
              <div className="mt-1 text-sm text-muted-foreground">{t("展示你已归档作品，发布控制请在“绘画社区”中操作。")}</div>
            </CardHeader>
            <CardContent>
              {items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/70 bg-background/60 p-8 text-center text-sm text-muted-foreground">
                  {t("暂无作品，先去 AI 工作台生成并下载定稿。")}
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {items.map((it) => (
                    <div key={it.id} className="overflow-hidden rounded-xl border border-border/70 bg-background/60">
                      <img src={it.dataUrl} alt={it.title} className="aspect-[4/3] w-full object-cover" />
                      <div className="p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold">{it.title}</div>
                          {it.minted ? (
                            <Badge className="bg-accent text-accent-foreground">{t("已铸造")}</Badge>
                          ) : (
                            <Badge variant="outline" className="border-border/70 text-muted-foreground">
                              {t("已定稿")}
                            </Badge>
                          )}
                        </div>
                        <Separator className="my-2 bg-border/70" />
                        <div className="text-xs text-muted-foreground">
                          {t("创建于")} {new Date(it.createdAt).toLocaleString(locale)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}

function Stat({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/60 p-3">
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className="mt-1 font-display text-3xl">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}
