import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Link } from "wouter";
import { Brush, MessagesSquare, ShieldCheck, Sparkles } from "lucide-react";
import { motion } from "framer-motion";

const fade = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0 },
};

export default function Landing() {
  return (
    <AppShell>
      <section className="relative">
        <div className="grid gap-10 md:grid-cols-12 md:items-end">
          <div className="md:col-span-7">
            <motion.h1
              variants={fade}
              initial="hidden"
              animate="show"
              transition={{ duration: 0.6 }}
              className="font-display text-5xl leading-[1.05] tracking-wide md:text-6xl"
            >
              墨韵AI
              <span className="block text-foreground/80 text-3xl md:text-4xl mt-3 font-semibold font-[inherit]">
                可计算数字绘画 · 传统水墨 × 现代 AI
              </span>
            </motion.h1>
            <motion.p
              variants={fade}
              initial="hidden"
              animate="show"
              transition={{ duration: 0.7, delay: 0.1 }}
              className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground"
            >
              我们把“生成”拆解成可解释、可复现的参数：多模态权重、皴法纹理、墨晕边缘、气韵节奏……
              让每一幅作品既有传统的留白与呼吸，也有工程化的效率与一致性。
            </motion.p>

            <motion.div
              variants={fade}
              initial="hidden"
              animate="show"
              transition={{ duration: 0.7, delay: 0.2 }}
              className="mt-8 flex flex-col gap-3 sm:flex-row"
            >
              <Link href="/workspace">
                <Button className="bg-accent text-accent-foreground hover:bg-accent/90">
                  <Sparkles className="mr-2 h-4 w-4" /> 进入 AI 工作台
                </Button>
              </Link>
              <Link href="/payment">
                <Button variant="outline" className="border-border/70">
                  进入支付中心
                </Button>
              </Link>
            </motion.div>
          </div>

          <div className="md:col-span-5">
            <Card className="border-border/70 bg-card/70 backdrop-blur">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">产品能力一览</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <Feature
                  icon={Brush}
                  title="AI 工作台"
                  desc="先用 DeepSeek（Mock）把原始描述优化成“艺术化提示词”，再一次生成 4 张作品。"
                />
                <Separator className="bg-border/70" />
                <Feature
                  icon={MessagesSquare}
                  title="AI 画圣（问答）"
                  desc="悬浮聊天：讲中国画史、技法（如皴法）、并辅助弥补“评估模型准确性”鸿沟。"
                />
                <Separator className="bg-border/70" />
                <Feature
                  icon={ShieldCheck}
                  title="版权铸造（概念）"
                  desc="从 4 张里选 1 张定稿后，可一键“铸造成数字资产”，形成竞争壁垒。"
                />
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-3">
          <Metric label="生成" value="4-Grid" hint="一次并行生成四幅" />
          <Metric label="参数" value="Genetic" hint="多模态权重可解释" />
          <Metric label="交互" value="一键定稿" hint="选中 1 张才可下载/铸造" />
        </div>
      </section>
    </AppShell>
  );
}

function Feature({
  icon: Icon,
  title,
  desc,
}: {
  icon: React.ElementType;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-1 text-sm leading-6 text-muted-foreground">{desc}</div>
      </div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="border-border/70 bg-card/60">
      <CardContent className="p-5">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 font-display text-3xl tracking-wide">{value}</div>
        <div className="mt-2 text-sm text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}
