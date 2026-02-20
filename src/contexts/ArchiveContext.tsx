import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ArchiveItem } from "@/lib/types";
import { useAuth } from "@/contexts/AuthContext";

const LS_KEY = "ink-aesthetics-ai.archive.by-user.v2";
type ArchiveStore = Record<string, ArchiveItem[]>;

type ArchiveContextValue = {
  items: ArchiveItem[];
  addItem: (item: ArchiveItem) => void;
  markMinted: (id: string) => void;
  clear: () => void;
};

const ArchiveContext = createContext<ArchiveContextValue | null>(null);

export function ArchiveProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [store, setStore] = useState<ArchiveStore>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setStore(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(store));
    } catch {
      // ignore
    }
  }, [store]);

  const items = useMemo<ArchiveItem[]>(() => {
    if (!user) return [];
    return store[user.id] ?? [];
  }, [store, user]);

  const value = useMemo<ArchiveContextValue>(
    () => ({
      items,
      addItem: (item) => {
        if (!user) return;
        setStore((prev) => ({
          ...prev,
          [user.id]: [{ ...item, ownerUserId: user.id }, ...(prev[user.id] ?? [])],
        }));
      },
      markMinted: (id) =>
        user &&
        setStore((prev) => ({
          ...prev,
          [user.id]: (prev[user.id] ?? []).map((x) => (x.id === id ? { ...x, minted: true } : x)),
        })),
      clear: () =>
        user &&
        setStore((prev) => ({
          ...prev,
          [user.id]: [],
        })),
    }),
    [items, user]
  );

  return <ArchiveContext.Provider value={value}>{children}</ArchiveContext.Provider>;
}

export function useArchive() {
  const ctx = useContext(ArchiveContext);
  if (!ctx) throw new Error("useArchive 必须在 ArchiveProvider 内使用");
  return ctx;
}
