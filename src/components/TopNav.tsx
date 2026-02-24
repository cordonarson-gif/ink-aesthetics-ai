import { Link, useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Brush, GalleryHorizontalEnd, MessageSquareMore, ShieldAlert, Sparkles, UserCircle2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocale } from "@/contexts/LocaleContext";
import type { AppLocale } from "@/lib/i18n";
import { toast } from "sonner";
import { isAdminUser } from "@/lib/authz";
import NotificationBell from "@/components/NotificationBell";

export default function TopNav() {
  const [loc] = useLocation();
  const { user, logout } = useAuth();
  const { locale, supportedLocales, setLocale, t } = useLocale();
  const isRoot = isAdminUser(user);

  const items = [
    { href: "/", label: t("nav.home"), icon: Sparkles },
    { href: "/workspace", label: t("nav.workspace"), icon: Brush },
    { href: "/gallery", label: t("nav.gallery"), icon: GalleryHorizontalEnd },
    { href: "/forum", label: t("nav.forum"), icon: MessageSquareMore },
    { href: "/profile", label: t("nav.profile"), icon: UserCircle2 },
    ...(isRoot ? [{ href: "/super-admin", label: t("nav.admin"), icon: ShieldAlert }] : []),
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="group inline-flex items-baseline gap-2">
            <span className="font-display text-2xl leading-none tracking-wide">墨韵AI</span>
            <Badge variant="outline" className="border-border/70 bg-card/60 text-muted-foreground">
              Calculable Digital Painting
            </Badge>
          </Link>
        </div>

        <nav className="hidden items-center gap-1 md:flex">
          {items.map((it) => {
            const active = loc === it.href;
            const Icon = it.icon;
            return (
              <Link
                key={it.href}
                href={it.href}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm transition",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground/80 hover:bg-secondary hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {it.label}
              </Link>
            );
          })}
        </nav>

        {user ? (
          <div className="flex items-center gap-2">
            <LanguageSwitcher
              locale={locale}
              onChange={setLocale}
              options={supportedLocales}
            />
            <NotificationBell />
            <Badge variant="outline" className="border-border/70 bg-card/60 text-foreground/80">
              {user.displayName}
            </Badge>
            <Button
              variant="outline"
              className="border-border/70"
              onClick={() => {
                void logout();
                toast.success(t("nav.logoutSuccess"));
              }}
            >
              {t("nav.logout")}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <LanguageSwitcher
              locale={locale}
              onChange={setLocale}
              options={supportedLocales}
            />
            <Link href="/login">
              <Button variant="outline" className="border-border/70">
                {t("nav.login")}
              </Button>
            </Link>
            <Link href="/register">
              <Button className="bg-accent text-accent-foreground hover:bg-accent/90">
                {t("nav.register")}
              </Button>
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}

function LanguageSwitcher({
  locale,
  onChange,
  options,
}: {
  locale: AppLocale;
  onChange: (next: AppLocale) => void;
  options: Array<{ code: AppLocale; label: string }>;
}) {
  return (
    <label className="inline-flex items-center rounded-full border border-border/70 bg-card/60 px-3 py-1">
      <select
        value={locale}
        onChange={(e) => onChange(e.target.value as AppLocale)}
        className="bg-transparent text-xs text-foreground/80 outline-none"
        aria-label="language-switcher"
      >
        {options.map((item) => (
          <option key={item.code} value={item.code}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}
