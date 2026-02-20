import type { AppSettings } from "@/lib/app-settings";

export type SdWebuiTxt2ImgRequest = {
  prompt: string;
  negative_prompt?: string;
  steps?: number;
  sampler_name?: string;
  cfg_scale?: number;
  width?: number;
  height?: number;
  batch_size?: number;
};

export type SdWebuiTxt2ImgResponse = {
  images: string[]; // base64 png
  info?: string;
  parameters?: unknown;
};

export async function sdWebuiTxt2Img(
  settings: AppSettings,
  req: SdWebuiTxt2ImgRequest
): Promise<SdWebuiTxt2ImgResponse> {
  const url = `${settings.sdWebuiBaseUrl.replace(/\/$/, "")}/sdapi/v1/txt2img`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`SD WebUI 调用失败：${res.status} ${res.statusText}${t ? `\n${t}` : ""}`);
  }

  return (await res.json()) as SdWebuiTxt2ImgResponse;
}

export async function sdWebuiPing(settings: AppSettings) {
  // WebUI 有时会提供 /sdapi/v1/samplers，可用它做连通性检测
  const url = `${settings.sdWebuiBaseUrl.replace(/\/$/, "")}/sdapi/v1/samplers`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`无法连接 SD WebUI：${res.status} ${res.statusText}`);
  return (await res.json()) as unknown;
}
