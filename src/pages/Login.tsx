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

type LoginMode = "password" | "email";

export default function LoginPage() {
  const {
    ready,
    user,
    loginWithPassword,
    loginWithEmail,
    sendEmailCode,
  } = useAuth();
  const { t } = useLocale();
  const [, setLocation] = useLocation();
  const nextPath = getSafeNextPath("/workspace");
  const routeText = t(routeKeyFromPath(nextPath));

  const [mode, setMode] = useState<LoginMode>("password");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaUnavailable, setCaptchaUnavailable] = useState(false);
  const [sending, setSending] = useState(false);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [emailSubmitting, setEmailSubmitting] = useState(false);
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
        purpose: "login",
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

  const handlePasswordLogin = async () => {
    if (!account.trim() || !password.trim()) {
      toast.error(t("请输入账号和密码"));
      return;
    }
    if (captchaRequired && !captchaToken.trim()) {
      toast.error(t("请先完成人机验证"));
      return;
    }
    setPasswordSubmitting(true);
    try {
      const u = await loginWithPassword({
        account,
        password,
        captcha_token: captchaRequired ? captchaToken : undefined,
      });
      toast.success(t("auth.loginSuccess", { target: routeText }), {
        description: u.displayName,
      });
      setLocation(nextPath);
    } catch (e) {
      toast.error(t("auth.loginFail"), {
        description: String((e as Error).message || e),
      });
    } finally {
      setPasswordSubmitting(false);
    }
  };

  const handleEmailLogin = async () => {
    if (!email.trim() || !code.trim()) {
      toast.error(t("请输入邮箱和验证码"));
      return;
    }
    if (captchaRequired && !captchaToken.trim()) {
      toast.error(t("请先完成人机验证"));
      return;
    }
    setEmailSubmitting(true);
    try {
      const u = await loginWithEmail({
        email,
        code,
        captcha_token: captchaRequired ? captchaToken : undefined,
      });
      toast.success(t("auth.loginSuccess", { target: routeText }), {
        description: u.displayName,
      });
      setLocation(nextPath);
    } catch (e) {
      toast.error(t("auth.loginFail"), {
        description: String((e as Error).message || e),
      });
    } finally {
      setEmailSubmitting(false);
    }
  };

  return (
    <PortalShell
      title={t("登录中心")}
      subtitle={t("独立登录页，登录成功后会跳转到目标页面")}
      backHref="/"
    >
      <div className="mx-auto w-full max-w-3xl">
        <Card className="border-border/70 bg-card/70">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-2xl">{t("登录")}</CardTitle>
              <Link href={`/register?next=${encodeURIComponent(nextPath)}`}>
                <Button variant="outline" className="border-border/70">
                  {t("去注册")}
                </Button>
              </Link>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {t("欢迎回来，登录后即可使用 AI 工作台与个人中心。")}
            </div>
          </CardHeader>

          <CardContent className="min-h-[460px]">
            <div className="flex h-full flex-col">
              <div className="space-y-4">
                {mode === "password" ? (
                  <>
                    <div>
                      <Label>{t("账号（用户名或邮箱）")}</Label>
                      <Input
                        className="mt-2 border-border/70 bg-background/70"
                        value={account}
                        onChange={(e) => setAccount(e.target.value)}
                        placeholder={t("账号（用户名或邮箱）")}
                      />
                    </div>
                    <div>
                      <Label>{t("密码")}</Label>
                      <Input
                        type="password"
                        className="mt-2 border-border/70 bg-background/70"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={t("密码")}
                      />
                    </div>
                    <Button
                      className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
                      onClick={handlePasswordLogin}
                      disabled={passwordSubmitting}
                    >
                      {passwordSubmitting ? t("登录中...") : t("登录")}
                    </Button>
                  </>
                ) : (
                  <>
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
                    <Button
                      className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
                      onClick={handleEmailLogin}
                      disabled={emailSubmitting}
                    >
                      {emailSubmitting ? t("登录中...") : t("邮箱验证码登录")}
                    </Button>
                  </>
                )}
              </div>

              {captchaRequired && (
                <div className="mt-4">
                  <Label>{t("人机验证")}</Label>
                  <div ref={captchaRef} className="mt-2" />
                </div>
              )}

              <div className="mt-auto flex items-end justify-end pt-8">
                <Button
                  variant="ghost"
                  className="text-foreground/80 hover:bg-secondary"
                  onClick={() =>
                    setMode((m) => (m === "password" ? "email" : "password"))
                  }
                >
                  {mode === "password" ? t("邮箱验证码登录") : t("账号密码登录")}
                </Button>
              </div>
            </div>
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
