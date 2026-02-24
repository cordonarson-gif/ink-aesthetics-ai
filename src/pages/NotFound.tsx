import { useLocale } from "@/contexts/LocaleContext";
import type { AppLocale } from "@/lib/i18n";

export default function NotFound() {
  const { locale, supportedLocales, setLocale, t } = useLocale();

  return (
    <div className="ink-paper min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="flex justify-end">
          <LanguageSwitcher locale={locale} onChange={setLocale} options={supportedLocales} />
        </div>
      </div>
      <div className="mx-auto max-w-3xl px-4 py-14">
        <div className="font-display text-5xl">404</div>
        <div className="mt-3 text-muted-foreground">{t("你要找的页面不存在。")}</div>
        <a href="#/" className="mt-8 inline-flex rounded-full bg-accent px-4 py-2 text-sm text-accent-foreground">
          {t("返回首页")}
        </a>
      </div>
    </div>
  );
}

function LanguageSwitcher({
  locale,
  onChange,
  options,
}: {
  locale: AppLocale;
  onChange: (next: AppLocale) => void;
  options: Array<{ code: AppLocale; label: string }>;
}) {
  return (
    <label className="inline-flex items-center rounded-full border border-border/70 bg-card/60 px-3 py-1">
      <select
        value={locale}
        onChange={(e) => onChange(e.target.value as AppLocale)}
        className="bg-transparent text-xs text-foreground/80 outline-none"
        aria-label="language-switcher"
      >
        {options.map((item) => (
          <option key={item.code} value={item.code}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}
