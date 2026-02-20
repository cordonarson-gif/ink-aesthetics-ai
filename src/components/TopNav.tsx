import { Link, useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Brush, GalleryHorizontalEnd, LayoutDashboard, ShieldAlert, Sparkles, UserCircle2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export default function TopNav() {
  const [loc] = useLocation();
  const { user, logout } = useAuth();
  const isRoot = user?.id === "root";

  const items = [
    { href: "/", label: "首页", icon: Sparkles },
    { href: "/workspace", label: "AI 工作台", icon: Brush },
    { href: "/gallery", label: "可计算画廊", icon: GalleryHorizontalEnd },
    { href: "/dashboard", label: "SaaS 面板", icon: LayoutDashboard },
    { href: "/profile", label: "个人主页", icon: UserCircle2 },
    ...(isRoot ? [{ href: "/super-admin", label: "Root 大屏", icon: ShieldAlert }] : []),
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="group inline-flex items-baseline gap-2">
            <span className="font-display text-2xl leading-none tracking-wide">墨韵AI</span>
            <Badge variant="outline" className="border-border/70 bg-card/60 text-muted-foreground">
              Calculable Digital Painting
            </Badge>
          </Link>
        </div>

        <nav className="hidden items-center gap-1 md:flex">
          {items.map((it) => {
            const active = loc === it.href;
            const Icon = it.icon;
            return (
              <Link
                key={it.href}
                href={it.href}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm transition",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground/80 hover:bg-secondary hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {it.label}
              </Link>
            );
          })}
        </nav>

        {user ? (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-border/70 bg-card/60 text-foreground/80">
              {user.displayName}
            </Badge>
            <Link href="/payment">
              <Button variant="outline" className="border-border/70">
                支付中心
              </Button>
            </Link>
            <Button
              variant="outline"
              className="border-border/70"
              onClick={() => {
                logout();
                toast.success("已退出登录");
              }}
            >
              退出
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Link href="/login">
              <Button variant="outline" className="border-border/70">
                登录
              </Button>
            </Link>
            <Link href="/register">
              <Button className="bg-accent text-accent-foreground hover:bg-accent/90">
                注册
              </Button>
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
