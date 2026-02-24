import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocale } from "@/contexts/LocaleContext";

export default function SettingsPanel() {
  const { t } = useLocale();

  return (
    <Card className="border-border/70 bg-card/70">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">{t("settings.statusTitle")}</CardTitle>
        <div className="mt-1 text-sm text-muted-foreground">
          {t("settings.statusDesc")}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-3">
          <StatusChip title="DeepSeek" value="Slot" desc={t("settings.deepseekDesc")} />
          <StatusChip title="liblibai" value="Slot" desc={t("settings.liblibaiDesc")} />
          <StatusChip title={t("settings.evalTitle")} value="Slot" desc={t("settings.evalDesc")} />
        </div>
      </CardContent>
    </Card>
  );
}

function StatusChip({ title, value, desc }: { title: string; value: string; desc: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/60 p-4">
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className="mt-1 font-display text-2xl">{value}</div>
      <div className="mt-2 text-xs text-muted-foreground leading-5">{desc}</div>
    </div>
  );
}
