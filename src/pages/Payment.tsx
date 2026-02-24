import PortalShell from "@/components/PortalShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEffect } from "react";
import { useLocation } from "wouter";

export default function PaymentPage() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    const timer = window.setTimeout(() => setLocation("/profile"), 1200);
    return () => window.clearTimeout(timer);
  }, [setLocation]);

  return (
    <PortalShell title="支付中心" subtitle="支付功能已下线，自动跳转到个人中心" backHref="/profile" backLabel="返回个人中心">
      <div className="mx-auto max-w-2xl">
        <Card className="border-border/70 bg-card/70">
          <CardHeader>
            <CardTitle>支付入口已下线</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div>当前版本不再提供充值支付能力，墨点由注册赠送与每日恢复规则发放。</div>
            <div>系统将自动跳转到个人中心，你也可以立即手动跳转。</div>
            <Button className="w-full" onClick={() => setLocation("/profile")}>
              前往个人中心
            </Button>
          </CardContent>
        </Card>
      </div>
    </PortalShell>
  );
}
