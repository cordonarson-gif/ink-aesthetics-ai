import { nanoid } from "nanoid";
import type { GeneratedImage, GeneticParams } from "@/lib/types";

/**
 * 这里是“可替换的空位层（Integration Slots）”。
 *
 * - DeepSeek：用于把用户 raw prompt 优化为更专业的 Artistic Prompt
 * - liblibai：用于生成 5 张候选图
 *
 * 你后期补充时只需要替换这两个函数的实现（建议走后端代理）。
 */

export type OptimizeResult = {
  artisticPrompt: string;
  keywords: string[];
  negative: string[];
};

export async function optimizePromptWithDeepSeek(rawPrompt: string): Promise<OptimizeResult> {
  // TODO: Replace with real DeepSeek call
  // Suggested signature:
  // POST /api/prompt/optimize { raw_prompt }
  // return { artistic_prompt }

  const base = rawPrompt.trim() || "（未提供描述）";
  const keywords = [
    "Li Cheng style ink wash",
    "rhythmic vitality",
    "negative space",
    "cun strokes",
    "multimodal feature fusion",
    "xuan paper texture",
  ];
  const negative = ["lowres", "watermark", "text", "logo", "blurry", "worst quality"];

  return {
    artisticPrompt:
      `【艺术化提示词（占位）】\n${base}\n\n构图：高远/平远结合，留白为雾气与水面。\n技法：披麻皴与破墨层叠，墨色分五阶。\n氛围：晨雾清润、静谧、空间深远。\n\n关键词：${keywords.join(", ")}\n\n负面词：${negative.join(", ")}`,
    keywords,
    negative,
  };
}

export async function generateImagesWithLiblibai(
  artisticPrompt: string,
  n = 5
): Promise<string[]> {
  // TODO: Replace with real liblibai call
  // Suggested signature:
  // POST /api/liblibai/gen-img { prompt, n }
  // return images[] as base64 or url

  // Placeholder: return 5 computed SVG data URLs as stand-in
  await new Promise((r) => setTimeout(r, 500));
  return Array.from({ length: n }).map((_, i) => makeInkSvgDataUrl(`候选 ${i + 1}`, Date.now() + i * 1337));
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

export function randomParams(seed: number): GeneticParams {
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

export async function generateFiveArtwork(rawPrompt: string): Promise<{ images: GeneratedImage[]; optimized: OptimizeResult }> {
  const optimized = await optimizePromptWithDeepSeek(rawPrompt);
  const urls = await generateImagesWithLiblibai(optimized.artisticPrompt, 5);

  const now = new Date().toISOString();
  const images: GeneratedImage[] = urls.map((u, idx) => {
    const seed = Date.now() % 100000 + (idx + 1) * 1337;
    return {
      id: nanoid(),
      promptRaw: rawPrompt,
      promptArtistic: optimized.artisticPrompt,
      dataUrl: u,
      params: randomParams(seed),
      createdAt: now,
    };
  });

  return { images, optimized };
}

function svgToDataUrl(svg: string) {
  const encoded = encodeURIComponent(svg).replace(/'/g, "%27").replace(/\"/g, "%22");
  return `data:image/svg+xml;charset=utf-8,${encoded}`;
}

function makeInkSvgDataUrl(title: string, seed: number) {
  const bleed = 18 + (seed % 33);
  const ink = 34 + (seed % 31);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" viewBox="0 0 1024 768">
  <defs>
    <filter id="wash" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="${bleed}" result="blur"/>
      <feColorMatrix in="blur" type="matrix" values="
        1 0 0 0 0
        0 1 0 0 0
        0 0 1 0 0
        0 0 0 0.55 0"/>
    </filter>
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#F9F9F9"/>
      <stop offset="100%" stop-color="#F2F2F2"/>
    </linearGradient>
  </defs>

  <rect width="1024" height="768" fill="url(#paper)"/>

  <g filter="url(#wash)" opacity="0.95">
    <circle cx="${220 + (seed % 7) * 55}" cy="${210 + (seed % 5) * 45}" r="${110 + ink * 2}" fill="#1A1A1A" opacity="0.28"/>
    <circle cx="${590 + (seed % 9) * 25}" cy="${280 + (seed % 6) * 33}" r="${160 + ink * 2.4}" fill="#1A1A1A" opacity="0.22"/>
    <circle cx="${440 + (seed % 11) * 17}" cy="${520 + (seed % 8) * 26}" r="${210 + ink * 2.2}" fill="#1A1A1A" opacity="0.17"/>
  </g>

  <g transform="translate(820 86)">
    <rect x="0" y="0" width="130" height="130" rx="18" fill="#C22F2F" opacity="0.95"/>
    <path d="M30 48 H100 M30 78 H100" stroke="#F9F9F9" stroke-width="10" stroke-linecap="round"/>
    <path d="M46 34 V102" stroke="#F9F9F9" stroke-width="10" stroke-linecap="round"/>
    <path d="M84 34 V102" stroke="#F9F9F9" stroke-width="10" stroke-linecap="round"/>
  </g>

  <text x="64" y="96" font-family="Noto Serif SC, serif" font-size="34" fill="#1A1A1A" opacity="0.92">${title}</text>
  <text x="64" y="132" font-family="Noto Serif SC, serif" font-size="18" fill="#1A1A1A" opacity="0.55">liblibai slot · seed=${seed}</text>
</svg>`;

  return svgToDataUrl(svg);
}
