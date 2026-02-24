import { Link } from "wouter";
import { useLocale } from "@/contexts/LocaleContext";
import type { AppLocale } from "@/lib/i18n";

type PortalShellProps = {
  title: string;
  subtitle: string;
  backHref?: string;
  backLabel?: string;
  children: React.ReactNode;
};

export default function PortalShell({
  title,
  subtitle,
  backHref = "/",
  backLabel = "返回首页",
  children,
}: PortalShellProps) {
  const { locale, supportedLocales, setLocale, t } = useLocale();

  return (
    <div className="ink-paper min-h-screen">
      <header className="border-b border-border/70 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-4">
          <div>
            <div className="font-display text-2xl">墨韵AI · {t(title)}</div>
            <div className="mt-1 text-xs text-muted-foreground">{t(subtitle)}</div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher locale={locale} onChange={setLocale} options={supportedLocales} />
            <Link
              href={backHref}
              className="rounded-full border border-border/70 px-3 py-1 text-xs text-foreground/80 transition hover:bg-secondary"
            >
              {t(backLabel)}
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-10">{children}</main>
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
