import type { AppLocale } from "@/lib/i18n";

export const ZH_TW_PHRASES: Array<[string, string]> = [
  ["个人中心", "個人中心"],
  ["账户面板", "帳戶面板"],
  ["管理后台", "管理後台"],
  ["绘画社区", "繪畫社區"],
  ["论坛", "論壇"],
  ["用户协议", "用戶協議"],
  ["隐私政策", "隱私政策"],
  ["验证码", "驗證碼"],
  ["账号", "帳號"],
  ["账户", "帳戶"],
  ["密码", "密碼"],
  ["邮箱", "郵箱"],
  ["登录", "登入"],
  ["注册", "註冊"],
  ["首页", "首頁"],
  ["发布", "發佈"],
  ["评论", "評論"],
  ["点赞", "按讚"],
  ["转发", "轉發"],
  ["举报", "檢舉"],
  ["删除", "刪除"],
  ["保存", "儲存"],
  ["失败", "失敗"],
  ["成功", "成功"],
  ["设置", "設定"],
  ["默认", "預設"],
  ["返回", "返回"],
  ["加载", "載入"],
  ["发送", "發送"],
  ["选择", "選擇"],
  ["问题求助", "問題求助"],
  ["发布问题", "發佈問題"],
  ["搜索问题标题或内容", "搜尋問題標題或內容"],
  ["标签（逗号分隔，例如：构图,笔触,水墨）", "標籤（逗號分隔，例如：構圖,筆觸,水墨）"],
  ["全部标签", "全部標籤"],
  ["排序：最热", "排序：最熱"],
  ["排序：最新", "排序：最新"],
  ["排序：待回答优先", "排序：待回答優先"],
  ["邀请回答用户ID（逗号分隔，可选）", "邀請回答用戶ID（逗號分隔，可選）"],
  ["追加邀请回答用户ID（逗号分隔）", "追加邀請回答用戶ID（逗號分隔）"],
  ["邀请回答", "邀請回答"],
  ["已邀请回答", "已邀請回答"],
  ["邀请已发送", "邀請已發送"],
  ["邀请失败", "邀請失敗"],
  ["工作台", "工作台"],
  ["画廊", "畫廊"],
  ["作品", "作品"],
  ["规则", "規則"],
  ["奖励", "獎勵"],
  ["墨点", "墨點"],
  ["社区", "社區"],
  ["合规", "合規"],
  ["已启用", "已啟用"],
  ["已禁用", "已停用"],
  ["公开", "公開"],
  ["私有", "私有"],
  ["今日", "今日"],
  ["用户", "用戶"],
  ["数据", "數據"],
  ["刷新", "刷新"],
  ["导出", "匯出"],
  ["阈值", "閾值"],
  ["权限", "權限"],
  ["意见反馈", "意見反饋"],
  ["反馈类型", "反饋類型"],
  ["反馈标题", "反饋標題"],
  ["反馈内容", "反饋內容"],
  ["联系方式", "聯絡方式"],
  ["提交反馈", "提交反饋"],
  ["提交中...", "提交中..."],
  ["反馈已提交，管理员将在后台查看处理", "反饋已提交，管理員將在後台查看處理"],
  ["反馈提交失败", "反饋提交失敗"],
  ["待处理", "待處理"],
  ["已处理", "已處理"],
  ["用户反馈中心", "用戶反饋中心"],
  ["待处理:", "待處理:"],
  ["总反馈:", "總反饋:"],
  ["反馈已标记为处理完成", "反饋已標記為處理完成"],
  ["标记已处理", "標記已處理"],
  ["暂无用户反馈。", "暫無用戶反饋。"],
];

export const EN_PHRASES: Array<[string, string]> = [
  ["个人中心", "Profile"],
  ["账户面板", "Account Dashboard"],
  ["管理后台", "Admin Console"],
  ["绘画社区", "Gallery"],
  ["论坛", "Forum"],
  ["用户协议", "Terms of Service"],
  ["隐私政策", "Privacy Policy"],
  ["验证码", "Verification Code"],
  ["账号", "Account"],
  ["账户", "Account"],
  ["密码", "Password"],
  ["邮箱", "Email"],
  ["显示名称", "Display Name"],
  ["登录绑定状态", "Sign-in Bindings"],
  ["资料编辑", "Profile Edit"],
  ["修改密码", "Change Password"],
  ["旧密码", "Current Password"],
  ["新密码", "New Password"],
  ["确认新密码", "Confirm New Password"],
  ["更新密码", "Update Password"],
  ["保存资料", "Save Profile"],
  ["账户额度与规则", "Credits and Rules"],
  ["社区合规与协议", "Community Compliance and Policies"],
  ["创作与互动总览", "Creation and Engagement Overview"],
  ["我的生成图片", "My Generated Images"],
  ["AI工作台", "AI Workspace"],
  ["绘画社区", "Gallery"],
  ["论坛", "Forum"],
  ["当前墨点", "Current Credits"],
  ["支付入口已下线，平台使用墨点额度与奖励机制。", "Payment entry is offline. The platform now uses credits and reward rules."],
  ["新用户初始额度：1000 墨点", "Initial credits for new users: 1000"],
  ["每日恢复规则：+100 墨点", "Daily restore rule: +100 credits"],
  ["恢复上限：当余额 ≥ 500 时，当日不再恢复", "Restore cap: no restore when balance is >= 500"],
  ["作品发布奖励：每次 +80 墨点", "Artwork publish reward: +80 credits each time"],
  ["论坛回答奖励：每次 +50 墨点", "Forum answer reward: +50 credits each time"],
  ["发帖/评论双审核", "Dual moderation for posts/comments"],
  ["AI生成内容标识", "AI-generated content label"],
  ["举报与应急下线", "Report channel and emergency takedown"],
  ["使用平台即表示你同意遵守", "By using the platform, you agree to"],
  ["我的作品", "My Artworks"],
  ["已发布", "Published"],
  ["获赞数", "Likes"],
  ["论坛贡献", "Forum Contribution"],
  ["归档总数", "Archived Total"],
  ["社区互动", "Community Engagement"],
  ["提问", "Questions"],
  ["回答", "Answers"],
  ["创建于", "Created at"],
  ["已铸造", "Minted"],
  ["已定稿", "Finalized"],
  ["暂无作品，先去 AI 工作台生成并下载定稿。", "No artworks yet. Generate and finalize one in AI Workspace first."],
  ["首页", "Home"],
  ["工作台", "Workspace"],
  ["画廊", "Gallery"],
  ["登录", "Login"],
  ["注册", "Register"],
  ["退出", "Logout"],
  ["返回首页", "Back Home"],
  ["返回登录", "Back to Login"],
  ["去登录", "Go to Login"],
  ["去注册", "Go to Register"],
  ["获取验证码", "Send Code"],
  ["发送中...", "Sending..."],
  ["登录中...", "Signing in..."],
  ["登录失败", "Login failed"],
  ["注册失败", "Registration failed"],
  ["发送失败", "Send failed"],
  ["更新失败", "Update failed"],
  ["评论失败", "Comment failed"],
  ["评论已发布", "Comment posted"],
  ["发布失败", "Publish failed"],
  ["操作失败", "Operation failed"],
  ["删除", "Delete"],
  ["举报", "Report"],
  ["转发", "Share"],
  ["点赞", "Like"],
  ["发布", "Publish"],
  ["清空归档", "Clear Archive"],
  ["公开", "Public"],
  ["私有", "Private"],
  ["已公开", "Public"],
  ["取消公开", "Unpublish"],
  ["发布到公开画廊", "Publish to Gallery"],
  ["请选择图片", "Select Image"],
  ["上传后发布", "Upload and Publish"],
  ["上传作品标题", "Artwork Title"],
  ["补充描述（可选）", "Description (optional)"],
  ["选择图片", "Select Image"],
  ["发布问题", "Post Question"],
  ["问题求助", "Question Help"],
  ["搜索问题标题或内容", "Search title or content"],
  ["标签（逗号分隔，例如：构图,笔触,水墨）", "Tags (comma-separated, e.g. composition, brushwork, ink wash)"],
  ["全部标签", "All Tags"],
  ["排序：最热", "Sort: Hottest"],
  ["排序：最新", "Sort: Latest"],
  ["排序：待回答优先", "Sort: Unanswered First"],
  ["邀请回答用户ID（逗号分隔，可选）", "Invite user IDs (comma-separated, optional)"],
  ["追加邀请回答用户ID（逗号分隔）", "Add invited user IDs (comma-separated)"],
  ["邀请回答", "Invite Answer"],
  ["已邀请回答", "Invited Users"],
  ["邀请已发送", "Invitations sent"],
  ["邀请失败", "Invitation failed"],
  ["已解决", "Solved"],
  ["待解决", "Open"],
  ["切换状态", "Toggle Status"],
  ["回答（", "Answers ("],
  ["写下你的回答（回答可获得墨点奖励）", "Write your answer (you will get credits reward)"],
  ["账户面板已迁移至本页", "Account dashboard has been moved to this page"],
  ["加载中...", "Loading..."],
  ["刷新", "Refresh"],
  ["导出", "Export"],
  ["阈值", "Threshold"],
  ["权限", "Permission"],
  ["已启用", "Enabled"],
  ["已禁用", "Disabled"],
  ["成功", "Success"],
  ["失败", "Failed"],
  ["意见反馈", "Feedback"],
  ["反馈类型", "Feedback Type"],
  ["反馈标题", "Feedback Title"],
  ["反馈内容", "Feedback Details"],
  ["联系方式（可选）", "Contact (optional)"],
  ["联系方式", "Contact"],
  ["提交反馈", "Submit Feedback"],
  ["提交中...", "Submitting..."],
  ["请先填写反馈标题", "Please fill in the feedback title"],
  ["请先填写反馈内容", "Please fill in the feedback details"],
  ["反馈提交失败", "Feedback submission failed"],
  ["反馈已提交，管理员将在后台查看处理", "Feedback submitted. Admin will review it in the console."],
  ["请简要描述问题或建议", "Briefly describe your issue or suggestion"],
  ["请提供尽可能完整的信息，管理员可在后台查看并跟进处理。", "Please provide as much detail as possible. Admin can review and follow up in the console."],
  ["用户反馈中心", "User Feedback Center"],
  ["待处理", "Pending"],
  ["已处理", "Resolved"],
  ["待处理:", "Pending:"],
  ["总反馈:", "Total Feedback:"],
  ["反馈已标记为处理完成", "Feedback has been marked as resolved"],
  ["标记已处理", "Mark Resolved"],
  ["暂无用户反馈。", "No user feedback yet."],
  ["处理失败", "Resolve failed"],
];

const sortedMaps: Record<AppLocale, Array<[string, string]>> = {
  "zh-CN": [],
  "zh-TW": [...ZH_TW_PHRASES].sort((a, b) => b[0].length - a[0].length),
  "en-US": [...EN_PHRASES].sort((a, b) => b[0].length - a[0].length),
};

const ATTR_KEYS = ["placeholder", "title", "aria-label", "value", "alt"] as const;

let currentLocale: AppLocale = "zh-CN";
let observer: MutationObserver | null = null;
const originalTextMap = new WeakMap<Text, string>();
const originalAttrMap = new WeakMap<Element, Partial<Record<(typeof ATTR_KEYS)[number], string>>>();

function hasCjkText(input: string): boolean {
  return /[\u4e00-\u9fff]/.test(input);
}

function applyPhraseMap(input: string, locale: AppLocale): string {
  const map = sortedMaps[locale];
  if (!map.length) return input;
  let output = input;
  for (const [from, to] of map) {
    output = output.split(from).join(to);
  }
  return output;
}

function translateTextNode(node: Text): void {
  const raw = node.textContent || "";
  if (!raw.trim()) return;

  const knownOriginal = originalTextMap.get(node);
  let base = knownOriginal ?? raw;

  if (currentLocale !== "zh-CN" && hasCjkText(raw)) {
    const expected = applyPhraseMap(base, currentLocale);
    if (raw !== expected) {
      base = raw;
      originalTextMap.set(node, raw);
    }
  }

  if (!knownOriginal) {
    originalTextMap.set(node, base);
  }

  const translated = applyPhraseMap(base, currentLocale);
  if (raw !== translated) {
    node.textContent = translated;
  }
}

function translateElementAttrs(el: Element): void {
  let attrSnapshot = originalAttrMap.get(el);
  if (!attrSnapshot) {
    attrSnapshot = {};
    originalAttrMap.set(el, attrSnapshot);
  }

  for (const attr of ATTR_KEYS) {
    const raw = el.getAttribute(attr);
    if (!raw || !raw.trim()) continue;

    const hasOriginal = typeof attrSnapshot[attr] === "string";
    let base = hasOriginal ? (attrSnapshot[attr] as string) : raw;

    if (currentLocale !== "zh-CN" && hasCjkText(raw)) {
      const expected = applyPhraseMap(base, currentLocale);
      if (raw !== expected) {
        base = raw;
        attrSnapshot[attr] = raw;
      }
    }

    if (!hasOriginal) {
      attrSnapshot[attr] = base;
    }

    const translated = applyPhraseMap(base, currentLocale);
    if (raw !== translated) {
      el.setAttribute(attr, translated);
    }
  }
}

function walkAndTranslate(root: Node): void {
  if (!root) return;

  if (root instanceof Element) {
    translateElementAttrs(root);
    root.querySelectorAll("*").forEach((el) => translateElementAttrs(el));
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current: Node | null = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    const parentTag = textNode.parentElement?.tagName?.toLowerCase() || "";
    if (parentTag !== "script" && parentTag !== "style" && parentTag !== "code") {
      translateTextNode(textNode);
    }
    current = walker.nextNode();
  }
}

function translateDocument(): void {
  if (!document.body) return;
  walkAndTranslate(document.body);
}

export function setRuntimeLocale(locale: AppLocale): void {
  currentLocale = locale;
  translateDocument();
}

export function startRuntimeTranslator(initialLocale: AppLocale): () => void {
  currentLocale = initialLocale;
  translateDocument();

  if (observer) observer.disconnect();
  observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "characterData" && mutation.target instanceof Text) {
        translateTextNode(mutation.target);
      }
      if (mutation.type === "attributes" && mutation.target instanceof Element) {
        translateElementAttrs(mutation.target);
      }
      mutation.addedNodes.forEach((node) => walkAndTranslate(node));
    });
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...ATTR_KEYS],
  });

  return () => {
    observer?.disconnect();
    observer = null;
  };
}
