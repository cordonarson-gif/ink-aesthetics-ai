import PortalShell from "@/components/PortalShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocale } from "@/contexts/LocaleContext";

export default function PrivacyPage() {
  const { t } = useLocale();

  return (
    <PortalShell title={t("隐私政策")} subtitle={t("最小必要原则与数据保护说明")} backHref="/register" backLabel={t("返回注册")}>
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <Card className="border-border/70 bg-card/70">
          <CardHeader>
            <CardTitle>{t("墨韵AI 隐私政策（摘要）")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-7 text-foreground/85">
            <p>{t("1. 平台仅收集提供服务所必需的信息（账号、登录凭据、创作内容、基础访问日志）。")}</p>
            <p>{t("2. 平台不会超范围收集个人信息，不会将个人数据用于未声明用途。")}</p>
            <p>{t("3. 平台采取合理技术措施保护数据安全，防止泄露、篡改和未授权访问。")}</p>
            <p>{t("4. 用户可通过平台提供的通道申请更正或删除可删除的个人数据。")}</p>
            <p>{t("5. 若发生安全事件，平台将按规则启动应急处置并通知受影响用户。")}</p>
          </CardContent>
        </Card>
      </div>
    </PortalShell>
  );
}
