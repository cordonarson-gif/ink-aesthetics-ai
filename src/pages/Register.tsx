import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";

export default function RegisterPage() {
  const { ready, user, sendPhoneCode, registerWithPhone } = useAuth();
  const [, setLocation] = useLocation();

  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    if (ready && user) setLocation("/workspace");
  }, [ready, user, setLocation]);

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-2xl">
        <Card className="border-border/70 bg-card/70">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-2xl">注册</CardTitle>
              <Link href="/login">
                <Button variant="outline" className="border-border/70">
                  去登录
                </Button>
              </Link>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              仅支持手机号验证码注册，完成后设置登录密码。
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>账户名</Label>
              <Input
                className="mt-2 border-border/70 bg-background/70"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="用于登录，例如：yangfan"
              />
            </div>
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
                      const sent = await sendPhoneCode({ phone, purpose: "register" });
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
            <div>
              <Label>设置密码</Label>
              <Input
                type="password"
                className="mt-2 border-border/70 bg-background/70"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div>
              <Label>确认密码</Label>
              <Input
                type="password"
                className="mt-2 border-border/70 bg-background/70"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <Button
              className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
              onClick={async () => {
                if (password !== confirm) {
                  toast.error("两次密码不一致");
                  return;
                }
                try {
                  const u = await registerWithPhone({
                    username,
                    phone,
                    code,
                    displayName: username.trim() || "新用户",
                    password,
                  });
                  toast.success(`注册成功，欢迎 ${u.displayName}`);
                  setLocation("/workspace");
                } catch (e) {
                  toast.error("注册失败", { description: String((e as Error).message || e) });
                }
              }}
            >
              注册并登录
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
