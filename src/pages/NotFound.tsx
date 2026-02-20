export default function NotFound() {
  return (
    <div className="ink-paper min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-20">
        <div className="font-display text-5xl">404</div>
        <div className="mt-3 text-muted-foreground">你要找的页面不存在。</div>
        <a href="#/" className="mt-8 inline-flex rounded-full bg-accent px-4 py-2 text-sm text-accent-foreground">
          返回首页
        </a>
      </div>
    </div>
  );
}
