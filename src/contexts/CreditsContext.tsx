import { createContext, useContext, useMemo, useState } from "react";
import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";

const LS_KEY = "ink-aesthetics-ai.credits.by-user.v2";
const INITIAL_CREDITS = 1000;
const DAILY_RESTORE = 100;
const DAILY_RESTORE_CAP = 500;

type UserCredits = {
  credits: number;
  plan: "usage" | "bundle";
  lastDailyRestoreDate?: string;
};
type CreditsStore = Record<string, UserCredits>;

type CreditsContextValue = {
  credits: number;
  plan: "usage" | "bundle";
  setPlan: (p: "usage" | "bundle") => void;
  spend: (amount: number) => boolean;
  topUp: (amount: number) => void;
  grantReward: (amount: number, reason?: string) => void;
};

const CreditsContext = createContext<CreditsContextValue | null>(null);

function dayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function normalizeAccount(account: UserCredits | undefined): UserCredits {
  if (!account) {
    return { credits: INITIAL_CREDITS, plan: "bundle", lastDailyRestoreDate: dayKey() };
  }
  return {
    credits: Number.isFinite(account.credits) ? Math.max(0, Math.floor(account.credits)) : INITIAL_CREDITS,
    plan: account.plan === "usage" ? "usage" : "bundle",
    lastDailyRestoreDate: account.lastDailyRestoreDate || undefined,
  };
}

function applyDailyRestore(account: UserCredits): UserCredits {
  const today = dayKey();
  if ((account.lastDailyRestoreDate || "") === today) return account;
  if (account.credits >= DAILY_RESTORE_CAP) {
    return { ...account, lastDailyRestoreDate: today };
  }
  const grant = Math.min(DAILY_RESTORE, DAILY_RESTORE_CAP - account.credits);
  return {
    ...account,
    credits: account.credits + grant,
    lastDailyRestoreDate: today,
  };
}

function loadCreditsStore(): CreditsStore {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CreditsStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function resolveAccount(store: CreditsStore, userId: string): UserCredits {
  return applyDailyRestore(normalizeAccount(store[userId]));
}

export function CreditsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [store, setStore] = useState<CreditsStore>(loadCreditsStore);

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(store));
  }, [store]);

  const account = useMemo<UserCredits>(
    () => (user ? resolveAccount(store, user.id) : { credits: 0, plan: "bundle", lastDailyRestoreDate: undefined }),
    [store, user]
  );

  const value = useMemo<CreditsContextValue>(
    () => ({
      credits: account.credits,
      plan: account.plan,
      setPlan: (p) => {
        if (!user) return;
        setStore((prev) => {
          const current = resolveAccount(prev, user.id);
          return { ...prev, [user.id]: { ...current, plan: p } };
        });
      },
      spend: (amount) => {
        if (!user) return false;
        if (account.credits < amount) return false;
        setStore((prev) => {
          const current = resolveAccount(prev, user.id);
          if (current.credits < amount) return prev;
          return { ...prev, [user.id]: { ...current, credits: current.credits - amount } };
        });
        return true;
      },
      topUp: (amount) => {
        if (!user) return;
        setStore((prev) => {
          const current = resolveAccount(prev, user.id);
          return { ...prev, [user.id]: { ...current, credits: current.credits + amount } };
        });
      },
      grantReward: (amount, reason) => {
        if (!user) return;
        void reason;
        const grant = Math.max(0, Math.floor(amount));
        if (!grant) return;
        setStore((prev) => {
          const current = resolveAccount(prev, user.id);
          return { ...prev, [user.id]: { ...current, credits: current.credits + grant } };
        });
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
