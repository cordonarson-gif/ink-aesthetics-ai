import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPanel() {
  return (
    <Card className="border-border/70 bg-card/70">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">工作台状态</CardTitle>
        <div className="mt-1 text-sm text-muted-foreground">
          已预留 DeepSeek 与 liblibai 的对接空位（后续可由后端接入）。
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-3">
          <StatusChip title="DeepSeek" value="Slot" desc="一键优化提示词" />
          <StatusChip title="liblibai" value="Slot" desc="4 图并行生成" />
          <StatusChip title="评估模型" value="Slot" desc="参数化审美评分" />
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
