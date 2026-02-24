import AppShell from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useCredits } from "@/contexts/CreditsContext";
import { Link } from "wouter";

export default function Dashboard() {
  const { credits } = useCredits();

  return (
    <AppShell>
      <div className="grid gap-6 lg:grid-cols-12">
        <section className="lg:col-span-5">
          <Card className="border-border/70 bg-card/70">
            <CardHeader>
              <CardTitle>账户额度</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <div className="text-xs text-muted-foreground">当前墨点</div>
                <div className="mt-1 font-display text-5xl">{credits}</div>
                <div className="mt-2 text-xs text-muted-foreground">该页面已取消支付充值入口。</div>
              </div>
              <Separator className="bg-border/70" />
              <div className="space-y-2 text-sm text-muted-foreground">
                <div>新用户初始额度：1000 墨点</div>
                <div>每日恢复规则：+100 墨点</div>
                <div>恢复上限：当余额 ≥ 500 时，当日不再恢复</div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="lg:col-span-7 space-y-6">
          <Card className="border-border/70 bg-card/70">
            <CardHeader>
              <CardTitle>社区与论坛奖励</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Badge className="bg-accent text-accent-foreground">已启用</Badge>
                发布作品可获得墨点奖励
              </div>
              <div className="flex items-center gap-2">
                <Badge className="bg-accent text-accent-foreground">已启用</Badge>
                在论坛回答问题可获得墨点奖励
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/70">
            <CardHeader>
              <CardTitle>社区合规状态</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Badge className="bg-accent text-accent-foreground">已启用</Badge>
                发帖/评论双审核
              </div>
              <div className="flex items-center gap-2">
                <Badge className="bg-accent text-accent-foreground">已启用</Badge>
                AI 生成标识
              </div>
              <div className="flex items-center gap-2">
                <Badge className="bg-accent text-accent-foreground">已启用</Badge>
                举报与应急下线
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/70">
            <CardHeader>
              <CardTitle>协议与隐私</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <div>
                使用平台即表示你同意遵守
                <Link href="/terms" className="mx-1 text-foreground underline">
                  《用户协议》
                </Link>
                与
                <Link href="/privacy" className="ml-1 text-foreground underline">
                  《隐私政策》
                </Link>
                。
              </div>
              <div>平台按最小必要原则处理数据，不滥用、不泄露。</div>
            </CardContent>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}

