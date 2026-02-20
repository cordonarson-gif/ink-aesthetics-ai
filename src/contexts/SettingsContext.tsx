import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { AppSettings } from "@/lib/app-settings";
import { defaultSettings, loadSettings, saveSettings } from "@/lib/app-settings";

type SettingsContextValue = {
  settings: AppSettings;
  setSettings: (next: AppSettings) => void;
  patchSettings: (patch: Partial<AppSettings>) => void;
  resetSettings: () => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettingsState] = useState<AppSettings>(defaultSettings);

  useEffect(() => {
    setSettingsState(loadSettings());
  }, []);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      setSettings: (next) => setSettingsState(next),
      patchSettings: (patch) => setSettingsState((s) => ({ ...s, ...patch })),
      resetSettings: () => setSettingsState(defaultSettings),
    }),
    [settings]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings 必须在 SettingsProvider 内使用");
  return ctx;
}
