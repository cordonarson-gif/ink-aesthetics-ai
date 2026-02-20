export type SdBackendType = "mock" | "sd-webui";

export type AppSettings = {
  // 推荐：启用后端代理（隐藏 DeepSeek Key、避免浏览器直连本地模型/CORS）
  useBackendProxy: boolean;
  backendBaseUrl: string; // e.g. http://127.0.0.1:8787
  backendAdminToken: string; // optional, sent as X-InkAI-Token

  sdBackend: SdBackendType;
  sdWebuiBaseUrl: string; // e.g. http://127.0.0.1:7860
  sdWebuiSampler: string;
  sdWebuiSteps: number;
  sdWebuiCfgScale: number;
  sdWebuiWidth: number;
  sdWebuiHeight: number;
  sdWebuiBatchSize: number; // 4
  loraTag: string; // e.g. <lora:chinese_art_lora_v1.0:0.8>

  deepSeekBaseUrl: string; // https://api.deepseek.com
  deepSeekApiKey: string; // DO NOT commit; stored locally in browser
  deepSeekModel: "deepseek-chat" | "deepseek-reasoner";
};

const LS_KEY = "ink-aesthetics-ai.settings.v1";

export const defaultSettings: AppSettings = {
  useBackendProxy: true,
  backendBaseUrl: "http://127.0.0.1:8787",
  backendAdminToken: "",

  sdBackend: "mock",
  sdWebuiBaseUrl: "http://127.0.0.1:7860",
  sdWebuiSampler: "DPM++ 2M Karras",
  sdWebuiSteps: 28,
  sdWebuiCfgScale: 6.5,
  sdWebuiWidth: 768,
  sdWebuiHeight: 576,
  sdWebuiBatchSize: 4,
  loraTag: "<lora:chinese_art_lora_v1.0:0.8>",

  deepSeekBaseUrl: "https://api.deepseek.com",
  deepSeekApiKey: "",
  deepSeekModel: "deepseek-chat",
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw);
    return { ...defaultSettings, ...parsed } as AppSettings;
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(next: AppSettings) {
  localStorage.setItem(LS_KEY, JSON.stringify(next));
}
