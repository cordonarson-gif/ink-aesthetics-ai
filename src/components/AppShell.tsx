import TopNav from "@/components/TopNav";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="ink-paper min-h-screen">
      <TopNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-10">{children}</main>
      <footer className="border-t border-border/70 bg-background/70 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} 墨韵AI（概念原型）</p>
          <p>传统水墨美学 × 现代 AI 效率 · 可计算数字绘画</p>
        </div>
      </footer>
    </div>
  );
}
