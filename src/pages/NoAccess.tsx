import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";
import { ShieldX } from "lucide-react";
import { Link } from "wouter";

export default function NoAccessPage() {
  const { t } = useLocale();

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl rounded-2xl border border-border/70 bg-card/70 px-8 py-14 text-center">
        <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-destructive/15 text-destructive">
          <ShieldX className="h-8 w-8" />
        </div>
        <h1 className="mt-5 font-display text-4xl">{t("无访问权限")}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {t("当前页面仅管理员账号可访问。")}
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/">
            <Button variant="outline" className="border-border/70">
              {t("返回首页")}
            </Button>
          </Link>
          <Link href="/workspace">
            <Button className="bg-accent text-accent-foreground hover:bg-accent/90">{t("前往工作台")}</Button>
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
