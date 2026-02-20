import AppShell from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useArchive } from "@/contexts/ArchiveContext";
import { useAuth } from "@/contexts/AuthContext";
import { useCommunity } from "@/contexts/CommunityContext";
import { useCredits } from "@/contexts/CreditsContext";
import { toast } from "sonner";
import { useMemo, useState } from "react";

export default function Profile() {
  const { user, updateProfile, changePassword } = useAuth();
  const { credits, plan } = useCredits();
  const { items } = useArchive();
  const { posts } = useCommunity();

  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const myPublished = useMemo(
    () => posts.filter((x) => x.ownerUserId === user?.id),
    [posts, user?.id]
  );

  if (!user) return null;

  return (
    <AppShell>
      <div className="grid gap-6 lg:grid-cols-12">
        <section className="space-y-6 lg:col-span-5">
          <Card className="border-border/70 bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">个人主页</CardTitle>
              <div className="mt-1 text-sm text-muted-foreground">账号信息、登录绑定、密码安全。</div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <div className="text-xs text-muted-foreground">昵称</div>
                <div className="mt-1 font-display text-3xl">{user.displayName}</div>
                <div className="mt-2 text-xs text-muted-foreground">
                  用户名：{user.username} · 注册时间：{new Date(user.createdAt).toLocaleString("zh-CN")}
                </div>
              </div>

              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <div className="text-sm font-semibold">绑定状态</div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <Badge variant="outline" className="border-border/70">
                    手机：{user.phone ? "已绑定" : "未绑定"}
                  </Badge>
                  <Badge variant="outline" className="border-border/70">
                    QQ：{user.qqOpenId ? "已绑定" : "未绑定"}
                  </Badge>
                  <Badge variant="outline" className="border-border/70">
                    微信：{user.wechatOpenId ? "已绑定" : "未绑定"}
                  </Badge>
                </div>
              </div>

              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <div className="text-sm font-semibold">资料编辑</div>
                <Label className="mt-3 block">昵称</Label>
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
                      toast.success("个人资料已更新");
                    } catch (e) {
                      toast.error("更新失败", { description: String((e as Error).message || e) });
                    }
                  }}
                >
                  保存资料
                </Button>
              </div>

              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <div className="text-sm font-semibold">修改密码</div>
                <div className="mt-3 grid gap-2">
                  <div>
                    <Label>旧密码</Label>
                    <Input
                      type="password"
                      className="mt-2 border-border/70 bg-background/70"
                      value={oldPassword}
                      onChange={(e) => setOldPassword(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>新密码</Label>
                    <Input
                      type="password"
                      className="mt-2 border-border/70 bg-background/70"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>确认新密码</Label>
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
                      toast.error("两次新密码不一致");
                      return;
                    }
                    try {
                      await changePassword({ oldPassword, newPassword });
                      setOldPassword("");
                      setNewPassword("");
                      setConfirmPassword("");
                      toast.success("密码修改成功");
                    } catch (e) {
                      toast.error("修改失败", { description: String((e as Error).message || e) });
                    }
                  }}
                >
                  更新密码
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-6 lg:col-span-7">
          <Card className="border-border/70 bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">创作总览</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-4">
                <Stat title="墨点余额" value={String(credits)} hint={plan === "bundle" ? "套餐订阅" : "按量订阅"} />
                <Stat title="我的作品" value={String(items.length)} hint="归档总数" />
                <Stat title="已发布" value={String(myPublished.length)} hint="公开可见" />
                <Stat
                  title="获赞数"
                  value={String(myPublished.reduce((acc, p) => acc + p.likes.length, 0))}
                  hint="公开画廊"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">我的生成图片</CardTitle>
              <div className="mt-1 text-sm text-muted-foreground">展示你已定稿/归档的作品；发布控制请在“可计算画廊”中进行。</div>
            </CardHeader>
            <CardContent>
              {items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/70 bg-background/60 p-8 text-center text-sm text-muted-foreground">
                  暂无作品，先去 AI 工作台生成并下载定稿。
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
                            <Badge className="bg-accent text-accent-foreground">已铸造</Badge>
                          ) : (
                            <Badge variant="outline" className="border-border/70 text-muted-foreground">
                              已定稿
                            </Badge>
                          )}
                        </div>
                        <Separator className="my-2 bg-border/70" />
                        <div className="text-xs text-muted-foreground">
                          创建于 {new Date(it.createdAt).toLocaleString("zh-CN")}
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
