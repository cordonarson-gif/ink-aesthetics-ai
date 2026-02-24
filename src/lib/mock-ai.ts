import { nanoid } from "nanoid";
import type { GeneratedImage, GeneticParams } from "@/lib/types";
import { callDeepSeekChatAPI } from "@/lib/deepseek-chat";
import type { AppSettings } from "@/lib/app-settings";
import { sdWebuiTxt2Img } from "@/lib/sd-webui";
import { backendLiblibaiGen } from "@/lib/backend-api";

const GENERATE_COUNT = 4;

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function randomParams(seed: number): GeneticParams {
  const r = (k: number) => {
    const x = Math.sin(seed * (k + 1) * 999) * 10000;
    return clamp01(x - Math.floor(x));
  };

  const styleInkWash = 0.55 + r(1) * 0.45;
  const structureRhythm = 0.45 + r(2) * 0.55;
  const textureCun = r(3);
  const edgeBleed = 0.2 + r(4) * 0.8;
  const multimodalFusion = 0.35 + r(5) * 0.65;

  return {
    styleInkWash: clamp01(styleInkWash),
    structureRhythm: clamp01(structureRhythm),
    textureCun: clamp01(textureCun),
    edgeBleed: clamp01(edgeBleed),
    multimodalFusion: clamp01(multimodalFusion),
  };
}

function normalizeImageValue(value: string): string {
  const v = (value || "").trim();
  if (!v) return "";
  if (v.startsWith("data:")) return v;
  if (v.startsWith("http://") || v.startsWith("https://")) return v;
  return `data:image/png;base64,${v}`;
}

export async function callDeepSeekAPI(rawPrompt: string): Promise<string> {
  const base = rawPrompt.trim() || "（未提供描述）";

  const messages = [
    {
      role: "system" as const,
      content:
        "你是提示词工程师，专门为‘中国水墨 + 可计算数字绘画’生成专业 Artistic Prompt。输出必须是中文为主，夹带必要英文关键字（如 Li Cheng style ink wash、multimodal feature fusion）。请给：\n1) 一段精炼主提示词（含风格/构图/技法/光影/材质）\n2) 关键词列表（逗号分隔）\n3) 建议负面词（逗号分隔）",
    },
    {
      role: "user" as const,
      content: `用户原始描述：\n${base}`,
    },
  ];

  return await callDeepSeekChatAPI(messages);
}

function svgToDataUrl(svg: string) {
  const encoded = encodeURIComponent(svg).replace(/'/g, "%27").replace(/"/g, "%22");
  return `data:image/svg+xml;charset=utf-8,${encoded}`;
}

function makeInkSVG(title: string, seed: number) {
  const p = randomParams(seed);
  const bleed = 18 + p.edgeBleed * 42;
  const ink = 20 + p.styleInkWash * 35;
  const rhythm = 0.2 + p.structureRhythm * 0.8;
  const cun = 0.15 + p.textureCun * 0.85;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" viewBox="0 0 1024 768">
  <defs>
    <filter id="wash" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="${bleed.toFixed(1)}" result="blur"/>
      <feColorMatrix in="blur" type="matrix" values="
        1 0 0 0 0
        0 1 0 0 0
        0 0 1 0 0
        0 0 0 ${rhythm.toFixed(3)} 0"/>
    </filter>
    <filter id="cun" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="${(0.006 + cun * 0.02).toFixed(4)}" numOctaves="2" seed="${seed}" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="${(8 + cun * 22).toFixed(1)}" />
    </filter>
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#F9F9F9"/>
      <stop offset="100%" stop-color="#F3F3F3"/>
    </linearGradient>
  </defs>

  <rect width="1024" height="768" fill="url(#paper)"/>

  <g filter="url(#wash)" opacity="0.95">
    <circle cx="${220 + (seed % 7) * 55}" cy="${210 + (seed % 5) * 45}" r="${(110 + ink * 2).toFixed(1)}" fill="#1A1A1A" opacity="0.30"/>
    <circle cx="${590 + (seed % 9) * 25}" cy="${280 + (seed % 6) * 33}" r="${(160 + ink * 2.4).toFixed(1)}" fill="#1A1A1A" opacity="0.24"/>
    <circle cx="${440 + (seed % 11) * 17}" cy="${520 + (seed % 8) * 26}" r="${(210 + ink * 2.2).toFixed(1)}" fill="#1A1A1A" opacity="0.18"/>
  </g>

  <g filter="url(#cun)" opacity="0.42">
    <path d="M120 560 C 260 420, 390 620, 520 490 S 820 560, 930 420" fill="none" stroke="#1A1A1A" stroke-width="14" stroke-linecap="round"/>
    <path d="M160 610 C 310 520, 380 660, 560 560 S 840 660, 940 520" fill="none" stroke="#1A1A1A" stroke-width="9" stroke-linecap="round"/>
  </g>

  <g transform="translate(820 86)">
    <rect x="0" y="0" width="130" height="130" rx="18" fill="#C22F2F" opacity="0.95"/>
    <path d="M30 48 H100 M30 78 H100" stroke="#F9F9F9" stroke-width="10" stroke-linecap="round"/>
    <path d="M46 34 V102" stroke="#F9F9F9" stroke-width="10" stroke-linecap="round"/>
    <path d="M84 34 V102" stroke="#F9F9F9" stroke-width="10" stroke-linecap="round"/>
  </g>

  <text x="64" y="96" font-family="'Noto Serif SC', serif" font-size="34" fill="#1A1A1A" opacity="0.92">${title}</text>
  <text x="64" y="132" font-family="'Noto Serif SC', serif" font-size="18" fill="#1A1A1A" opacity="0.55">参数驱动 · 可计算数字绘画 · seed=${seed}</text>
</svg>`;
}

export async function generateFiveImages(rawPrompt: string, settings?: AppSettings): Promise<GeneratedImage[]> {
  const artistic = await callDeepSeekAPI(rawPrompt);
  const s = settings;

  const backendAvailable = Boolean(s?.backendBaseUrl?.trim());
  if (s && backendAvailable && (s.useBackendProxy || s.sdBackend === "mock")) {
    try {
      const resp = await backendLiblibaiGen(s, rawPrompt);
      const now = new Date().toISOString();
      return (resp.images || []).slice(0, GENERATE_COUNT).map((value, idx) => {
        const seed = Date.now() % 100000 + (idx + 1) * 1337;
        return {
          id: nanoid(),
          promptRaw: rawPrompt,
          promptArtistic: resp.artistic_prompt,
          dataUrl: normalizeImageValue(value),
          params: randomParams(seed),
          createdAt: now,
          generationTaskId: resp.generation_task_id || undefined,
          candidateId: resp.candidate_ids?.[idx] || undefined,
          candidateIndex: resp.candidate_indexes?.[idx] || idx + 1,
        };
      });
    } catch (e) {
      if (s.useBackendProxy) {
        throw e;
      }
    }
  }

  const useWebui = s?.sdBackend === "sd-webui";
  if (!useWebui) {
    await new Promise((r) => setTimeout(r, 650));
    return Array.from({ length: GENERATE_COUNT }).map((_, idx) => {
      const seed = Date.now() % 100000 + (idx + 1) * 1337;
      return {
        id: nanoid(),
        promptRaw: rawPrompt,
        promptArtistic: artistic,
        dataUrl: svgToDataUrl(makeInkSVG(`作品 ${idx + 1}`, seed)),
        params: randomParams(seed),
        createdAt: new Date().toISOString(),
      };
    });
  }

  const finalPrompt = `${(s?.loraTag || "").trim()}\n${artistic}`.trim();
  const resp = await sdWebuiTxt2Img(s!, {
    prompt: finalPrompt,
    negative_prompt: "lowres, worst quality, blurry, watermark, text, logo, extra fingers, bad hands",
    steps: s!.sdWebuiSteps,
    sampler_name: s!.sdWebuiSampler,
    cfg_scale: s!.sdWebuiCfgScale,
    width: s!.sdWebuiWidth,
    height: s!.sdWebuiHeight,
    batch_size: s!.sdWebuiBatchSize,
  });

  const now = new Date().toISOString();
  return (resp.images || []).slice(0, GENERATE_COUNT).map((value, idx) => {
    const seed = Date.now() % 100000 + (idx + 1) * 1337;
    return {
      id: nanoid(),
      promptRaw: rawPrompt,
      promptArtistic: artistic,
      dataUrl: normalizeImageValue(value),
      params: randomParams(seed),
      createdAt: now,
    };
  });
}
