import { loadSettings } from "@/lib/app-settings";
import { backendDeepSeekChat } from "@/lib/backend-api";

export type DeepSeekChatMessage = { role: "system" | "user" | "assistant"; content: string };

type DeepSeekChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
};

/**
 * DeepSeek Chat 调用（可用真实 Key；未配置则 fallback 到 mock）。
 *
 * 安全提醒：
 * - 前端直连会暴露 Key（部署后任何人可查看网络请求）。
 * - 生产环境建议用后端代理（或自建网关）来保管 Key。
 */
export async function callDeepSeekChatAPI(messages: DeepSeekChatMessage[]): Promise<string> {
  const settings = loadSettings();
  const apiKey = settings.deepSeekApiKey?.trim();

  const backendAvailable = Boolean(settings.backendBaseUrl?.trim());
  // 优先后端代理：避免前端暴露 key，也避免误配置时回落到 mock。
  if (backendAvailable && (settings.useBackendProxy || !apiKey)) {
    try {
      return await backendDeepSeekChat(settings, messages);
    } catch (e) {
      return `${mockDeepSeek(messages)}\n\n---\n（提示：后端 DeepSeek 代理调用失败：${String(e)}）`;
    }
  }

  if (!apiKey) return mockDeepSeek(messages);

  // 不推荐：前端直连（部署后会暴露 key）
  const url = `${settings.deepSeekBaseUrl.replace(/\/$/, "")}/chat/completions`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: settings.deepSeekModel,
      messages,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return `${mockDeepSeek(messages)}\n\n---\n（提示：DeepSeek 实际调用失败：${res.status} ${res.statusText}${t ? `\n${t}` : ""}）`;
  }

  const data = (await res.json()) as DeepSeekChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content ?? "";
  return content || "（DeepSeek 返回空内容）";
}

function mockDeepSeek(messages: DeepSeekChatMessage[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  if (lastUser.includes("皴")) {
    return "**皴法（Cùn）**是表现山石肌理与结构的笔触体系。\n\n常见类型：\n- 披麻皴：柔长线条，层层叠加，湿润清雅。\n- 斧劈皴：方折劲利，适合峭壁岩面。\n- 卷云皴：旋转团块，呈云纹般起伏。\n\n若要“可计算化”，可把皴法拆为：\n- 线段长度分布\n- 方向熵（笔触角度多样性）\n- 叠加密度（局部笔触计数）\n并作为参数权重进入评价模型。";
  }

  if (lastUser.includes("李成") || lastUser.toLowerCase().includes("li cheng")) {
    return "**李成（北宋）**擅长营造“寒林平远”的空间：\n\n- 构图讲究平远/高远，层层递进，远近虚实。\n- 笔墨骨力强，墨色清润而有层次。\n- 留白用于雾气、云烟与水面，形成呼吸感。\n\n提示词可加：\n> `Li Cheng style ink wash, cold forest, spacious negative space, atmospheric mist, rhythmic vitality`";
  }

  if (lastUser.includes("评估") || lastUser.includes("准确") || lastUser.includes("评价")) {
    return "弥补\"评估模型准确性\"的 gap：把审美拆成**可解释指标**再汇总。\n\n建议指标：\n1) 语义对齐（多模态相似度）\n2) 构图质量（主体/层次/留白占比）\n3) 风格一致性（水墨纹理、墨色层次、皴法特征）\n4) 伪影与噪声（边缘涂抹、重复纹理）\n\n最后用可学习的权重向量（你的 *Genetic Parameters*）进行加权，既能优化也能解释。";
  }

  return "我已收到你的问题（DeepSeek Mock）。\n\n如果你想让我回答得更准：\n- 给我作品题材（山水/花鸟/人物）\n- 指定风格源（李成/范宽/倪瓒…）\n- 指定技法关键词（皴法/破墨/积墨/泼墨）\n\n我会据此生成更可执行的提示词与参数建议。";
}
