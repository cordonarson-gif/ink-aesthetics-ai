import PortalShell from "@/components/PortalShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useLocale } from "@/contexts/LocaleContext";
import { TURNSTILE_ENABLED, TURNSTILE_SITE_KEY, loadTurnstileScript } from "@/lib/turnstile";
import { useEffect, useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";

export default function RegisterPage() {
  const { ready, user, sendEmailCode, registerWithEmail } = useAuth();
  const { t } = useLocale();
  const [, setLocation] = useLocation();
  const nextPath = getSafeNextPath("/workspace");
  const routeText = t(routeKeyFromPath(nextPath));

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaUnavailable, setCaptchaUnavailable] = useState(false);
  const [sending, setSending] = useState(false);
  const captchaRef = useRef<HTMLDivElement>(null);
  const captchaWidgetIdRef = useRef<string | null>(null);
  const captchaRequired = TURNSTILE_ENABLED && !captchaUnavailable;

  useEffect(() => {
    if (ready && user) setLocation(nextPath);
  }, [ready, user, setLocation, nextPath]);

  useEffect(() => {
    if (!captchaRequired) {
      const widgetId = captchaWidgetIdRef.current;
      if (widgetId && window.turnstile) {
        window.turnstile.remove(widgetId);
      }
      captchaWidgetIdRef.current = null;
      setCaptchaToken("");
      return;
    }

    let cancelled = false;
    loadTurnstileScript()
      .then((turnstile) => {
        setCaptchaUnavailable(false);
        if (cancelled || !captchaRef.current || captchaWidgetIdRef.current) return;
        captchaWidgetIdRef.current = turnstile.render(captchaRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (token: string) => {
            setCaptchaToken(token);
          },
        });
      })
      .catch((e) => {
        setCaptchaUnavailable(true);
        toast.error(t("人机验证加载失败"), {
          description: String((e as Error).message || e),
        });
      });

    return () => {
      cancelled = true;
      const widgetId = captchaWidgetIdRef.current;
      if (widgetId && window.turnstile) {
        window.turnstile.remove(widgetId);
      }
      captchaWidgetIdRef.current = null;
    };
  }, [captchaRequired, t]);

  const handleSendCode = async () => {
    if (!email.trim()) {
      toast.error(t("请输入邮箱地址"));
      return;
    }
    if (captchaRequired && !captchaToken.trim()) {
      toast.error(t("请先完成人机验证"));
      return;
    }
    setSending(true);
    try {
      const sent = await sendEmailCode({
        email,
        purpose: "register",
        captcha_token: captchaRequired ? captchaToken : undefined,
      });
      toast.success(t("auth.sendCodeSuccess"), {
        description: sent ? `${t("验证码")}已发送到 ${email}` : "",
      });
      const widgetId = captchaWidgetIdRef.current;
      if (captchaRequired && window.turnstile && widgetId) {
        window.turnstile.reset(widgetId);
        setCaptchaToken("");
      }
    } catch (e) {
      toast.error(t("auth.sendCodeFail"), {
        description: String((e as Error).message || e),
      });
    } finally {
      setSending(false);
    }
  };

  const handleRegister = async () => {
    if (password !== confirm) {
      toast.error(t("两次密码不一致"));
      return;
    }
    if (captchaRequired && !captchaToken.trim()) {
      toast.error(t("请先完成人机验证"));
      return;
    }
    if (!agreed) {
      toast.error(t("请先阅读并同意用户协议与隐私政策"));
      return;
    }
    try {
      const u = await registerWithEmail({
        username,
        email,
        code,
        displayName: username.trim() || t("新用户"),
        password,
        captcha_token: captchaRequired ? captchaToken : undefined,
      });
      toast.success(t("auth.registerSuccess", { target: routeText }), {
        description: u.displayName,
      });
      setLocation(nextPath);
    } catch (e) {
      toast.error(t("auth.registerFail"), {
        description: String((e as Error).message || e),
      });
    }
  };

  return (
    <PortalShell
      title={t("注册中心")}
      subtitle={t("独立注册页，注册成功后自动跳转")}
      backHref="/login"
      backLabel={t("返回登录")}
    >
      <div className="mx-auto w-full max-w-2xl">
        <Card className="border-border/70 bg-card/70">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-2xl">{t("注册")}</CardTitle>
              <Link href={`/login?next=${encodeURIComponent(nextPath)}`}>
                <Button variant="outline" className="border-border/70">
                  {t("去登录")}
                </Button>
              </Link>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {t("当前支持邮箱验证码注册，完成后可直接登录并跳转目标页。")}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>{t("账号名")}</Label>
              <Input
                className="mt-2 border-border/70 bg-background/70"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t("账号名")}
              />
            </div>
            <div>
              <Label>{t("邮箱地址")}</Label>
              <Input
                className="mt-2 border-border/70 bg-background/70"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <Label>{t("验证码")}</Label>
                <Input
                  className="mt-2 border-border/70 bg-background/70"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={t("验证码")}
                />
              </div>
              <div className="flex items-end">
                <Button
                  variant="outline"
                  className="w-full border-border/70"
                  onClick={handleSendCode}
                  disabled={sending}
                >
                  {sending ? t("发送中...") : t("获取验证码")}
                </Button>
              </div>
            </div>
            {captchaRequired && (
              <div>
                <Label>{t("人机验证")}</Label>
                <div ref={captchaRef} className="mt-2" />
              </div>
            )}
            <div>
              <Label>{t("设置密码")}</Label>
              <Input
                type="password"
                className="mt-2 border-border/70 bg-background/70"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("设置密码")}
              />
            </div>
            <div>
              <Label>{t("确认密码")}</Label>
              <Input
                type="password"
                className="mt-2 border-border/70 bg-background/70"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={t("确认密码")}
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <span>
                {t("我已阅读并同意")}
                <Link href="/terms" className="mx-1 text-foreground underline">
                  {`《${t("用户协议")}》`}
                </Link>
                {t("和")}
                <Link href="/privacy" className="ml-1 text-foreground underline">
                  {`《${t("隐私政策")}》`}
                </Link>
              </span>
            </label>
            <Button
              className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
              onClick={handleRegister}
            >
              {t("注册并登录")}
            </Button>
          </CardContent>
        </Card>
      </div>
    </PortalShell>
  );
}

function getSafeNextPath(defaultPath: string): string {
  try {
    const hash = window.location.hash || "";
    const queryStart = hash.indexOf("?");
    if (queryStart < 0) return defaultPath;
    const params = new URLSearchParams(hash.slice(queryStart + 1));
    const next = (params.get("next") || "").trim();
    if (!next.startsWith("/")) return defaultPath;
    if (next.startsWith("/login") || next.startsWith("/register"))
      return defaultPath;
    return next;
  } catch {
    return defaultPath;
  }
}

function routeKeyFromPath(path: string): string {
  if (path.startsWith("/workspace")) return "route.workspace";
  if (path.startsWith("/forum")) return "route.forum";
  if (path.startsWith("/dashboard")) return "route.profile";
  if (path.startsWith("/profile")) return "route.profile";
  if (path.startsWith("/super-admin")) return "route.admin";
  return "route.default";
}
