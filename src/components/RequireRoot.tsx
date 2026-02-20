import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

export default function RequireRoot({ children }: { children: React.ReactNode }) {
  const { ready, user } = useAuth();
  const [, setLocation] = useLocation();

  const isRoot = !!user && user.id === "root";

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      setLocation("/login");
      return;
    }
    if (!isRoot) {
      setLocation("/no-access");
    }
  }, [ready, user, isRoot, setLocation]);

  if (!ready || !user || !isRoot) {
    return (
      <div className="ink-paper min-h-screen">
        <div className="mx-auto max-w-3xl px-4 py-24 text-center">
          <div className="font-display text-4xl">Validating Root Permission...</div>
          <div className="mt-3 text-sm text-muted-foreground">
            Non-root accounts will be redirected to the no-access page.
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
