import AppShell from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useCredits } from "@/contexts/CreditsContext";
import { platformConfig } from "@/lib/platform-config";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type PayPack = { id: string; label: string; credits: number; amount: number };

const packs: PayPack[] = [
  { id: "p1", label: "轻量包", credits: 500, amount: 29 },
  { id: "p2", label: "标准包", credits: 1200, amount: 59 },
  { id: "p3", label: "创作包", credits: 3000, amount: 129 },
];

export default function PaymentPage() {
  const { credits, topUp } = useCredits();
  const [selected, setSelected] = useState<PayPack>(packs[1]);
  const [paying, setPaying] = useState(false);

  const orderNo = useMemo(
    () => `INK${Date.now().toString().slice(-8)}${Math.floor(1000 + Math.random() * 9000)}`,
    [selected.id]
  );

  return (
    <AppShell>
      <div className="grid gap-6 lg:grid-cols-12">
        <section className="space-y-6 lg:col-span-7">
          <div>
            <div className="font-display text-4xl tracking-wide">支付页面</div>
            <div className="mt-2 text-sm text-muted-foreground">
              独立承载充值支付流程。当前仅支持支付宝，支付代理为易收米（参数占位）。
            </div>
          </div>

          <Card className="border-border/70 bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">1) 选择充值包</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-3">
                {packs.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelected(p)}
                    className={
                      "rounded-xl border bg-background/60 p-4 text-left transition " +
                      (selected.id === p.id
                        ? "border-accent ring-cinnabar"
                        : "border-border/70 hover:bg-secondary/60")
                    }
                  >
                    <div className="text-sm font-semibold">{p.label}</div>
                    <div className="mt-1 font-display text-3xl">¥{p.amount}</div>
                    <div className="mt-1 text-xs text-muted-foreground">+{p.credits} 墨点</div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">2) 订单确认</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row k="订单号" v={orderNo} />
              <Row k="充值方案" v={selected.label} />
              <Row k="支付方式" v="支付宝" />
              <Row k="应付金额" v={`¥${selected.amount}`} />
              <Row k="到账墨点" v={`+${selected.credits}`} />
              <Separator className="bg-border/70" />
              <div className="flex items-center justify-between rounded-xl border border-border/70 bg-background/60 p-3">
                <div>
                  <div className="text-xs text-muted-foreground">当前墨点</div>
                  <div className="mt-1 font-display text-3xl">{credits}</div>
                </div>
                <Badge className="bg-accent text-accent-foreground">Alipay</Badge>
              </div>
              <Button
                disabled={paying}
                className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
                onClick={() => {
                  setPaying(true);
                  setTimeout(() => {
                    topUp(selected.credits);
                    setPaying(false);
                    toast.success("支付成功（演示）", {
                      description: `订单 ${orderNo} 已完成，到账 ${selected.credits} 墨点。`,
                    });
                  }, 800);
                }}
              >
                {paying ? "支付处理中…" : `立即支付 ¥${selected.amount}`}
              </Button>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-6 lg:col-span-5">
          <Card className="border-border/70 bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">易收米代理参数（占位）</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row k="Provider" v={platformConfig.payment.provider} />
              <Row k="支付宝 AppID" v={platformConfig.payment.alipay.appId || "（待配置）"} />
              <Row k="商户号" v={platformConfig.payment.alipay.merchantNo || "（待配置）"} />
              <Row k="Proxy Endpoint" v={platformConfig.payment.alipay.proxyEndpoint || "（待配置）"} />
              <Row k="Notify URL" v={platformConfig.payment.alipay.notifyUrl || "（待配置）"} />
              <Row k="Return URL" v={platformConfig.payment.alipay.returnUrl || "（待配置）"} />
              <Row k="签名算法" v={platformConfig.payment.alipay.signType} />
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/70">
            <CardContent className="p-4 text-xs text-muted-foreground leading-6">
              流程说明：
              <br />
              1) 前端提交订单请求到业务后端。
              <br />
              2) 业务后端调用易收米代理创建支付宝订单。
              <br />
              3) 以后端支付回调作为到账依据，更新用户墨点与账单状态。
            </CardContent>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background/60 px-3 py-2">
      <span className="text-muted-foreground">{k}</span>
      <code className="max-w-[220px] truncate text-foreground/80">{v}</code>
    </div>
  );
}
