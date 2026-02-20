import { createContext, useContext, useMemo, useState } from "react";
import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";

const LS_KEY = "ink-aesthetics-ai.credits.by-user.v2";
type UserCredits = { credits: number; plan: "usage" | "bundle" };
type CreditsStore = Record<string, UserCredits>;

type CreditsContextValue = {
  credits: number;
  plan: "usage" | "bundle";
  setPlan: (p: "usage" | "bundle") => void;
  spend: (amount: number) => boolean;
  topUp: (amount: number) => void;
};

const CreditsContext = createContext<CreditsContextValue | null>(null);

export function CreditsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [store, setStore] = useState<CreditsStore>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setStore(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(store));
  }, [store]);

  useEffect(() => {
    if (!user) return;
    setStore((prev) => {
      if (prev[user.id]) return prev;
      return { ...prev, [user.id]: { credits: 1200, plan: "bundle" } };
    });
  }, [user]);

  const account: UserCredits = user ? store[user.id] ?? { credits: 1200, plan: "bundle" } : { credits: 0, plan: "bundle" };

  const value = useMemo<CreditsContextValue>(
    () => ({
      credits: account.credits,
      plan: account.plan,
      setPlan: (p) => {
        if (!user) return;
        setStore((prev) => ({ ...prev, [user.id]: { ...account, plan: p } }));
      },
      spend: (amount) => {
        if (!user) return false;
        if (account.credits < amount) return false;
        setStore((prev) => ({ ...prev, [user.id]: { ...account, credits: account.credits - amount } }));
        return true;
      },
      topUp: (amount) => {
        if (!user) return;
        setStore((prev) => ({ ...prev, [user.id]: { ...account, credits: account.credits + amount } }));
      },
    }),
    [account, user]
  );

  return <CreditsContext.Provider value={value}>{children}</CreditsContext.Provider>;
}

export function useCredits() {
  const ctx = useContext(CreditsContext);
  if (!ctx) throw new Error("useCredits 必须在 CreditsProvider 内使用");
  return ctx;
}
