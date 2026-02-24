import AppShell from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Link } from "wouter";
import { Brush, MessagesSquare, Rocket, ShieldCheck, Sparkles, WandSparkles } from "lucide-react";
import { motion } from "framer-motion";
import { useLocale } from "@/contexts/LocaleContext";

const fade = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
};

export default function Landing() {
  const { t } = useLocale();

  return (
    <AppShell>
      <div className="relative overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-br from-amber-50 via-background to-zinc-100 p-6 md:p-10">
        <div className="pointer-events-none absolute -left-14 -top-14 h-56 w-56 rounded-full bg-amber-200/45 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -right-12 h-64 w-64 rounded-full bg-zinc-300/35 blur-3xl" />

        <div className="relative grid gap-10 md:grid-cols-12 md:items-end">
          <section className="md:col-span-8">
            <motion.div variants={fade} initial="hidden" animate="show" transition={{ duration: 0.5 }}>
              <Badge variant="outline" className="border-border/70 bg-white/70 text-foreground/80">
                Calculable Digital Painting Platform
              </Badge>
            </motion.div>

            <motion.h1
              variants={fade}
              initial="hidden"
              animate="show"
              transition={{ duration: 0.6, delay: 0.05 }}
              className="mt-4 font-display text-5xl leading-[1.06] tracking-wide md:text-6xl"
            >
              墨韵AI
              <span className="mt-3 block text-2xl font-semibold text-foreground/80 md:text-3xl">
                {t("传统水墨美学 × 现代生成效率 × 社区协作创作")}
              </span>
            </motion.h1>

            <motion.p
              variants={fade}
              initial="hidden"
              animate="show"
              transition={{ duration: 0.6, delay: 0.12 }}
              className="mt-6 max-w-3xl text-base leading-7 text-muted-foreground"
            >
              {t("从提示词优化、参数可解释生成，到作品发布、互动传播、论坛问答与墨点激励，形成完整创作闭环。")}
              {t("你可以快速产出作品，也可以沉淀个人风格并参与社区共创。")}
            </motion.p>

            <motion.div
              variants={fade}
              initial="hidden"
              animate="show"
              transition={{ duration: 0.6, delay: 0.18 }}
              className="mt-8 flex flex-wrap gap-3"
            >
              <Link href="/workspace">
                <Button className="bg-accent text-accent-foreground hover:bg-accent/90">
                  <Sparkles className="mr-2 h-4 w-4" />
                  {t("进入 AI 工作台")}
                </Button>
              </Link>
              <Link href="/gallery">
                <Button variant="outline" className="border-border/70">
                  {t("浏览作品社区")}
                </Button>
              </Link>
              <Link href="/profile">
                <Button variant="outline" className="border-border/70">
                  {t("进入个人中心")}
                </Button>
              </Link>
            </motion.div>
          </section>

          <section className="md:col-span-4">
            <Card className="border-border/70 bg-card/70 backdrop-blur">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">{t("平台工作流")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Step icon={WandSparkles} title={t("提示词优化")} desc={t("将原始描述转化为可执行的艺术化提示词。")} />
                <Separator className="bg-border/70" />
                <Step icon={Brush} title={t("生成与定稿")} desc={t("4图并行生成，选择作品并归档发布。")} />
                <Separator className="bg-border/70" />
                <Step icon={Rocket} title={t("传播与激励")} desc={t("点赞评论转发举报，发布与答疑可获墨点奖励。")} />
              </CardContent>
            </Card>
          </section>
        </div>
      </div>

      <section className="mt-8 grid gap-4 md:grid-cols-4">
        <Metric title={t("生成效率")} value="4-Grid" hint={t("一次生成四张候选作品")} />
        <Metric title={t("发布渠道")} value={t("双通道")} hint={t("AI生成直发 + 用户上传发布")} />
        <Metric title={t("社区互动")} value={t("全链路")} hint={t("点赞、评论、转发、举报")} />
        <Metric title={t("激励机制")} value={t("墨点奖励")} hint={t("发布作品/论坛答疑均可获奖")} />
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-3">
        <FeatureCard
          icon={ShieldCheck}
          title={t("合规治理")}
          desc={t("发帖与评论双审核，违规内容应急下线与举报通道联动。")}
        />
        <FeatureCard
          icon={MessagesSquare}
          title={t("论坛互助")}
          desc={t("问题求助与答疑协作沉淀经验，帮助新用户快速上手。")}
        />
        <FeatureCard
          icon={Sparkles}
          title={t("个人沉淀")}
          desc={t("个人中心整合账户面板、创作数据、奖励与合规信息。")}
        />
      </section>
    </AppShell>
  );
}

function Step({ icon: Icon, title, desc }: { icon: React.ElementType; title: string; desc: string }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-1 text-xs leading-5 text-muted-foreground">{desc}</div>
      </div>
    </div>
  );
}

function Metric({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <Card className="border-border/70 bg-card/60">
      <CardContent className="p-5">
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className="mt-1 font-display text-3xl tracking-wide">{value}</div>
        <div className="mt-2 text-sm text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}

function FeatureCard({ icon: Icon, title, desc }: { icon: React.ElementType; title: string; desc: string }) {
  return (
    <Card className="border-border/70 bg-card/70">
      <CardContent className="flex gap-3 p-5">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-foreground">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <div className="mt-1 text-sm leading-6 text-muted-foreground">{desc}</div>
        </div>
      </CardContent>
    </Card>
  );
}
