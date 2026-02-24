import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { isAdminUser } from "@/lib/authz";
import { useLocale } from "@/contexts/LocaleContext";

export default function RequireRoot({ children }: { children: React.ReactNode }) {
  const { ready, user } = useAuth();
  const { t } = useLocale();
  const [loc, setLocation] = useLocation();

  const isRoot = isAdminUser(user);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      const next = loc?.startsWith("/") ? loc : "/super-admin";
      setLocation(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    if (!isRoot) {
      setLocation("/no-access");
    }
  }, [ready, user, isRoot, setLocation, loc]);

  if (!ready || !user || !isRoot) {
    return (
      <div className="ink-paper min-h-screen">
        <div className="mx-auto max-w-3xl px-4 py-24 text-center">
          <div className="font-display text-4xl">{t("guard.adminCheckingTitle")}</div>
          <div className="mt-3 text-sm text-muted-foreground">
            {t("guard.adminCheckingDesc")}
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
