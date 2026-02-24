export type TurnstileApi = {
  render: (
    container: string | HTMLElement,
    options: { sitekey: string; callback: (token: string) => void },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    onTurnstileLoad?: () => void;
    __inkaiTurnstileResolvers?: Array<() => void>;
  }
}

const DEFAULT_TURNSTILE_SITE_KEY = "0x4AAAAAACg5k2WrPwGAOZSI";

const truthySet = new Set(["1", "true", "yes", "on"]);

export const TURNSTILE_ENABLED = truthySet.has(
  String(import.meta.env.VITE_TURNSTILE_ENABLED ?? "")
    .trim()
    .toLowerCase(),
);

export const TURNSTILE_SITE_KEY =
  (import.meta.env.VITE_TURNSTILE_SITE_KEY || DEFAULT_TURNSTILE_SITE_KEY).trim() ||
  DEFAULT_TURNSTILE_SITE_KEY;

const TURNSTILE_SCRIPT_ID = "inkai-turnstile-script";
const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad";

export function loadTurnstileScript(): Promise<TurnstileApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Turnstile 仅可在浏览器环境加载"));
  }
  if (!TURNSTILE_ENABLED) {
    return Promise.reject(new Error("Turnstile is disabled by VITE_TURNSTILE_ENABLED"));
  }
  if (window.turnstile) return Promise.resolve(window.turnstile);

  return new Promise((resolve, reject) => {
    const resolveWhenReady = () => {
      if (window.turnstile) {
        resolve(window.turnstile);
      } else {
        reject(new Error("Turnstile 脚本已加载，但 API 不可用"));
      }
    };

    if (!window.__inkaiTurnstileResolvers) {
      window.__inkaiTurnstileResolvers = [];
    }
    window.__inkaiTurnstileResolvers.push(resolveWhenReady);

    const prevOnLoad = window.onTurnstileLoad;
    window.onTurnstileLoad = () => {
      prevOnLoad?.();
      const callbacks = window.__inkaiTurnstileResolvers || [];
      window.__inkaiTurnstileResolvers = [];
      callbacks.forEach((cb) => cb());
    };

    let script = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = TURNSTILE_SCRIPT_ID;
      script.src = TURNSTILE_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onerror = () => reject(new Error("Turnstile 脚本加载失败"));
      document.head.appendChild(script);
    }
  });
}
