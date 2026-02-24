import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useLocale } from "@/contexts/LocaleContext";

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { ready, user } = useAuth();
  const { t } = useLocale();
  const [loc, setLocation] = useLocation();

  useEffect(() => {
    if (!ready || user) return;
    const next = loc?.startsWith("/") ? loc : "/workspace";
    setLocation(`/login?next=${encodeURIComponent(next)}`);
  }, [ready, user, loc, setLocation]);

  if (!ready || !user) {
    return (
      <div className="ink-paper min-h-screen">
        <div className="mx-auto max-w-3xl px-4 py-24 text-center">
          <div className="font-display text-4xl">{t("guard.authCheckingTitle")}</div>
          <div className="mt-3 text-sm text-muted-foreground">{t("guard.authCheckingDesc")}</div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
