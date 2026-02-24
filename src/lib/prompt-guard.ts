const DEFAULT_BLOCKED_TERMS = [
  "儿童色情",
  "未成年人色情",
  "性虐待",
  "强奸",
  "乱伦",
  "bloodbath",
  "gore",
  "beheading",
  "dismember",
  "sexual assault",
  "child porn",
  "terrorist attack",
  "爆炸物制作",
  "枪支制造",
  "毒品制作",
  "仇恨言论",
];

function normalizeGuardText(value: string): string {
  return (value || "").toLowerCase().replace(/[\W_]+/g, "");
}

export function findPromptViolations(rawPrompt: string, blockedTerms: string[] = DEFAULT_BLOCKED_TERMS): string[] {
  const text = normalizeGuardText(rawPrompt);
  if (!text) return [];
  const hits: string[] = [];
  blockedTerms.forEach((term) => {
    const token = normalizeGuardText(term);
    if (token && text.includes(token)) hits.push(term);
  });
  return hits.slice(0, 5);
}

export function assertPromptAllowed(rawPrompt: string) {
  const hits = findPromptViolations(rawPrompt);
  if (!hits.length) return;
  throw new Error(`提示词包含违规内容，禁止生成：${hits.join(", ")}`);
}
