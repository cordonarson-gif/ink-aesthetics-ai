import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { ready, user } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (ready && !user) setLocation("/login");
  }, [ready, user, setLocation]);

  if (!ready || !user) {
    return (
      <div className="ink-paper min-h-screen">
        <div className="mx-auto max-w-3xl px-4 py-24 text-center">
          <div className="font-display text-4xl">正在校验登录状态…</div>
          <div className="mt-3 text-sm text-muted-foreground">未登录时会自动跳转到登录页。</div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
