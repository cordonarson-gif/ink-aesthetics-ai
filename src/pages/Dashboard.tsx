import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCredits } from "@/contexts/CreditsContext";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { useMemo, useState } from "react";
import { Check, Coins, CreditCard, Crown, Zap } from "lucide-react";

export default function Dashboard() {
  const { credits, topUp, plan, setPlan } = useCredits();
  const [customTopUp, setCustomTopUp] = useState(500);

  const usagePlans = useMemo(
    () => [
      {
        key: "usage_basic",
        icon: Zap,
        name: "按量订阅",
        price: "¥19/月",
        desc: "以弹性为先：订阅拿到“按量价格”，用多少算多少。",
        included: "每月赠送 200 墨点",
        tokenRate: "额外墨点：¥0.06/点",
        bullets: ["适合轻度/间歇式创作", "不会浪费配额", "可随时自定义充值"],
      },
      {
        key: "usage_pro",
        icon: Zap,
        name: "按量订阅 Pro",
        price: "¥49/月",
        desc: "更低按量单价 + 更高赠送，适合频繁生成但用量波动大。",
        included: "每月赠送 800 墨点",
        tokenRate: "额外墨点：¥0.045/点",
        bullets: ["更低单位成本", "适合旺季/项目制", "依旧保留按量弹性"],
      },
    ],
    []
  );

  const bundlePlans = useMemo(
    () => [
      {
        key: "bundle_artist",
        icon: Crown,
        name: "套餐订阅 Artist",
        price: "¥99/月",
        badge: "推荐",
        desc: "用“稳定月配额”换更低单位成本：比按量更便宜。",
        credits: 3000,
        note: "单点折算 ≈ ¥0.033/点（低于按量）",
        bullets: ["稳定产能", "更低单点成本", "适合持续创作"],
      },
      {
        key: "bundle_studio",
        icon: Crown,
        name: "套餐订阅 Studio",
        price: "¥269/月",
        desc: "工作室/小团队：更高配额 + 管理能力扩展。",
        credits: 9000,
        note: "单点折算 ≈ ¥0.029/点（更低）",
        bullets: ["更高配额", "项目并行更从容", "适合团队"],
      },
      {
        key: "bundle_enterprise",
        icon: CreditCard,
        name: "套餐订阅 Enterprise",
        price: "定制",
        desc: "面向创意产业链：团队席位、私有风格库、版权流程。",
        credits: 0,
        note: "支持 SSO、审计、私有部署",
        bullets: ["私有化/合规", "审计与权限", "定制 SLA"],
      },
    ],
    []
  );

  return (
    <AppShell>
      <div className="grid gap-6 lg:grid-cols-12">
        <section className="lg:col-span-5">
          <Card className="border-border/70 bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">用户档案</CardTitle>
              <div className="mt-1 text-sm text-muted-foreground">订阅 + 墨点账户（概念原型）</div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <div className="text-xs text-muted-foreground">当前订阅模式</div>
                <div className="mt-1 flex items-center justify-between">
                  <div className="font-display text-2xl">{plan === "bundle" ? "套餐订阅" : "按量订阅"}</div>
                  <Badge className="bg-primary text-primary-foreground">有效</Badge>
                </div>
                <Separator className="my-3 bg-border/70" />
                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">墨点余额（Ink Credits）</div>
                    <div className="mt-1 font-display text-4xl">{credits}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <div className="text-sm font-semibold">自定义充值（随充随用）</div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <Label>充值墨点数量</Label>
                    <Input
                      type="number"
                      value={customTopUp}
                      onChange={(e) => setCustomTopUp(Math.max(0, Number(e.target.value)))}
                      className="mt-2 border-border/70 bg-background/70"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
                      onClick={() => {
                        topUp(customTopUp);
                        toast.success(`已充值 ${customTopUp} 墨点（Mock）`);
                      }}
                    >
                      立即充值
                    </Button>
                  </div>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">提示：当前仅支持支付宝（易收米代理占位），上线后由后端回调记账。</div>
              </div>

              <div className="rounded-xl border border-border/70 bg-background/60 p-4 text-sm text-muted-foreground">
                <div className="font-semibold text-foreground">为什么“套餐订阅更便宜”？</div>
                <ul className="mt-2 list-disc pl-5 leading-6">
                  <li>套餐用“承诺月度用量”换取更低的单位成本。</li>
                  <li>按量订阅保留弹性，但单位成本更高。</li>
                  <li>两者都支持额外自定义充值，满足峰值需求。</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="lg:col-span-7">
          <Card className="border-border/70 bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">订阅模式</CardTitle>
              <div className="mt-1 text-sm text-muted-foreground">
                二选一：按量订阅（更弹性） vs 套餐订阅（单位更便宜）。两者都支持自定义充值。
              </div>
            </CardHeader>
            <CardContent>
              <Tabs value={plan} onValueChange={(v) => setPlan(v as any)}>
                <TabsList className="bg-background/60 border border-border/70">
                  <TabsTrigger value="usage">按量订阅</TabsTrigger>
                  <TabsTrigger value="bundle">套餐订阅</TabsTrigger>
                </TabsList>

                <TabsContent value="usage" className="mt-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    {usagePlans.map((p) => {
                      const Icon = p.icon;
                      return (
                        <div key={p.key} className="rounded-2xl border border-border/70 bg-background/60 p-5">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-secondary/70">
                                  <Icon className="h-4 w-4" />
                                </span>
                                <div className="text-sm font-semibold">{p.name}</div>
                              </div>
                              <div className="mt-2 font-display text-3xl">{p.price}</div>
                            </div>
                            <Badge variant="outline" className="border-border/70 text-muted-foreground">
                              弹性
                            </Badge>
                          </div>

                          <div className="mt-3 text-sm text-muted-foreground leading-6">{p.desc}</div>

                          <Separator className="my-4 bg-border/70" />

                          <div className="space-y-2 text-sm text-muted-foreground">
                            <div className="flex items-center gap-2">
                              <Coins className="h-4 w-4" />
                              <span>{p.included}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <CreditCard className="h-4 w-4" />
                              <span>{p.tokenRate}</span>
                            </div>
                          </div>

                          <div className="mt-4 space-y-2">
                            {p.bullets.map((b) => (
                              <div key={b} className="flex items-start gap-2 text-sm text-foreground/80">
                                <Check className="mt-0.5 h-4 w-4 text-accent" />
                                <span>{b}</span>
                              </div>
                            ))}
                          </div>

                          <Button
                            className="mt-5 w-full bg-primary text-primary-foreground hover:bg-primary/90"
                            onClick={() => toast.message("此按钮为演示", { description: "后续接入真实订阅支付。" })}
                          >
                            选择 {p.name}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </TabsContent>

                <TabsContent value="bundle" className="mt-4">
                  <div className="grid gap-4 md:grid-cols-3">
                    {bundlePlans.map((p) => {
                      const Icon = p.icon;
                      return (
                        <div
                          key={p.key}
                          className={
                            "relative rounded-2xl border border-border/70 bg-background/60 p-5" +
                            (p.badge ? " ring-cinnabar" : "")
                          }
                        >
                          {p.badge && (
                            <div className="absolute -top-3 left-4 rounded-full bg-accent px-3 py-1 text-xs text-accent-foreground">
                              {p.badge}
                            </div>
                          )}

                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-secondary/70">
                                  <Icon className="h-4 w-4" />
                                </span>
                                <div className="text-sm font-semibold">{p.name}</div>
                              </div>
                              <div className="mt-2 font-display text-3xl">{p.price}</div>
                            </div>
                            <Badge className="bg-accent text-accent-foreground">更便宜</Badge>
                          </div>

                          <div className="mt-3 text-sm text-muted-foreground leading-6">{p.desc}</div>

                          <Separator className="my-4 bg-border/70" />

                          {p.credits > 0 ? (
                            <div className="rounded-xl border border-border/70 bg-background/60 p-3">
                              <div className="text-xs text-muted-foreground">每月墨点</div>
                              <div className="mt-1 font-display text-3xl">{p.credits.toLocaleString("zh-CN")}</div>
                              <div className="mt-2 text-xs text-muted-foreground">{p.note}</div>
                            </div>
                          ) : (
                            <div className="text-sm text-muted-foreground">{p.note}</div>
                          )}

                          <div className="mt-4 space-y-2">
                            {p.bullets.map((b) => (
                              <div key={b} className="flex items-start gap-2 text-sm text-foreground/80">
                                <Check className="mt-0.5 h-4 w-4 text-accent" />
                                <span>{b}</span>
                              </div>
                            ))}
                          </div>

                          <Button
                            className={
                              "mt-5 w-full " +
                              (p.badge
                                ? "bg-accent text-accent-foreground hover:bg-accent/90"
                                : "bg-primary text-primary-foreground hover:bg-primary/90")
                            }
                            onClick={() => toast.message("此按钮为演示", { description: "后续接入真实订阅支付。" })}
                          >
                            选择 {p.name}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}
