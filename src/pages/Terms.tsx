import PortalShell from "@/components/PortalShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocale } from "@/contexts/LocaleContext";

export default function TermsPage() {
  const { t } = useLocale();

  return (
    <PortalShell title={t("用户协议")} subtitle={t("请在使用前完整阅读本协议")} backHref="/register" backLabel={t("返回注册")}>
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <Card className="border-border/70 bg-card/70">
          <CardHeader>
            <CardTitle>{t("墨韵AI 用户协议（摘要）")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-7 text-foreground/85">
            <p>{t("1. 用户承诺不得利用平台发布或生成违法、色情、暴力、侵权或其他敏感内容。")}</p>
            <p>{t("2. 用户对其发布、评论、传播的内容承担全部责任，平台有权对违规内容下线、删除或限制账号功能。")}</p>
            <p>{t("3. 平台生成内容默认带有 AI生成 标识，用户不得伪装为人工原创以误导他人。")}</p>
            <p>{t("4. 平台提供举报与应急处置机制。收到有效举报后，平台可先行下线后复核。")}</p>
            <p>{t("5. 用户继续使用即视为同意本协议及《隐私政策》。")}</p>
          </CardContent>
        </Card>
      </div>
    </PortalShell>
  );
}
