import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";

type LoginMode = "password" | "sms";

export default function LoginPage() {
  const { ready, user, loginWithPassword, loginWithPhone, sendPhoneCode, loginWithOAuth } = useAuth();
  const [, setLocation] = useLocation();

  const [mode, setMode] = useState<LoginMode>("password");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");

  useEffect(() => {
    if (ready && user) setLocation("/workspace");
  }, [ready, user, setLocation]);

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-3xl">
        <Card className="border-border/70 bg-card/70">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-2xl">登录</CardTitle>
              <Link href="/register">
                <Button variant="outline" className="border-border/70">
                  去注册
                </Button>
              </Link>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">欢迎回来，登录后即可使用 AI 工作台与个人主页。</div>
          </CardHeader>

          <CardContent className="min-h-[460px]">
            <div className="flex h-full flex-col">
              <div className="space-y-4">
                {mode === "password" ? (
                  <>
                    <div>
                      <Label>账号（用户名或手机号）</Label>
                      <Input
                        className="mt-2 border-border/70 bg-background/70"
                        value={account}
                        onChange={(e) => setAccount(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label>密码</Label>
                      <Input
                        type="password"
                        className="mt-2 border-border/70 bg-background/70"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </div>
                    <Button
                      className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
                      onClick={async () => {
                        try {
                          const u = await loginWithPassword({ account, password });
                          toast.success(`欢迎回来，${u.displayName}`);
                          setLocation("/workspace");
                        } catch (e) {
                          toast.error("登录失败", { description: String((e as Error).message || e) });
                        }
                      }}
                    >
                      登录
                    </Button>
                  </>
                ) : (
                  <>
                    <div>
                      <Label>手机号</Label>
                      <Input
                        className="mt-2 border-border/70 bg-background/70"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="col-span-2">
                        <Label>验证码</Label>
                        <Input
                          className="mt-2 border-border/70 bg-background/70"
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                        />
                      </div>
                      <div className="flex items-end">
                        <Button
                          variant="outline"
                          className="w-full border-border/70"
                          onClick={async () => {
                            try {
                              const sent = await sendPhoneCode({ phone, purpose: "login" });
                              toast.message("验证码已发送（演示）", { description: `调试验证码：${sent}` });
                            } catch (e) {
                              toast.error("发送失败", { description: String((e as Error).message || e) });
                            }
                          }}
                        >
                          获取验证码
                        </Button>
                      </div>
                    </div>
                    <Button
                      className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
                      onClick={async () => {
                        try {
                          const u = await loginWithPhone({ phone, code });
                          toast.success(`欢迎回来，${u.displayName}`);
                          setLocation("/workspace");
                        } catch (e) {
                          toast.error("登录失败", { description: String((e as Error).message || e) });
                        }
                      }}
                    >
                      短信登录
                    </Button>
                  </>
                )}
              </div>

              <div className="mt-auto flex items-end justify-between pt-8">
                <div className="flex items-center gap-2">
                  <BrandIconButton
                    title="QQ 登录"
                    src="https://cdn.simpleicons.org/tencentqq/12B7F5"
                    onClick={async () => {
                      try {
                        const u = await loginWithOAuth("qq");
                        toast.success(`已通过 QQ 登录：${u.displayName}`);
                        setLocation("/workspace");
                      } catch (e) {
                        toast.error("QQ 登录失败", { description: String((e as Error).message || e) });
                      }
                    }}
                  />
                  <BrandIconButton
                    title="微信登录"
                    src="https://cdn.simpleicons.org/wechat/07C160"
                    onClick={async () => {
                      try {
                        const u = await loginWithOAuth("wechat");
                        toast.success(`已通过微信登录：${u.displayName}`);
                        setLocation("/workspace");
                      } catch (e) {
                        toast.error("微信登录失败", { description: String((e as Error).message || e) });
                      }
                    }}
                  />
                </div>

                <Button
                  variant="ghost"
                  className="text-foreground/80 hover:bg-secondary"
                  onClick={() => setMode((m) => (m === "password" ? "sms" : "password"))}
                >
                  {mode === "password" ? "短信验证码登录" : "账号密码登录"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function BrandIconButton({
  title,
  src,
  onClick,
}: {
  title: string;
  src: string;
  onClick: () => void | Promise<void>;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border/70 bg-background/70 transition hover:bg-secondary"
    >
      <img src={src} alt={title} className="h-6 w-6" />
    </button>
  );
}
