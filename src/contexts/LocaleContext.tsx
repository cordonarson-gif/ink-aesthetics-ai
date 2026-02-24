import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { AppLocale } from "@/lib/i18n";
import { SUPPORTED_LOCALES, translate } from "@/lib/i18n";
import { startRuntimeTranslator } from "@/lib/runtime-translator";

const LS_LOCALE_KEY = "ink-aesthetics-ai.locale.v1";

type LocaleContextValue = {
  locale: AppLocale;
  supportedLocales: Array<{ code: AppLocale; label: string }>;
  setLocale: (next: AppLocale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function loadLocale(): AppLocale {
  try {
    const raw = (localStorage.getItem(LS_LOCALE_KEY) || "").trim() as AppLocale;
    if (SUPPORTED_LOCALES.some((x) => x.code === raw)) return raw;
  } catch {
    // ignore
  }
  return "zh-CN";
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(loadLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => startRuntimeTranslator(locale), [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      supportedLocales: SUPPORTED_LOCALES,
      setLocale: (next) => {
        setLocaleState(next);
        try {
          localStorage.setItem(LS_LOCALE_KEY, next);
        } catch {
          // ignore
        }
      },
      t: (key, vars) => translate(locale, key, vars),
    }),
    [locale]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used inside LocaleProvider");
  return ctx;
}
