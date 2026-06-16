// common.jsx — shared sample data + tiny utility components
// Exposed via window globals so direction files can use them.

const PROJECTS = [
  { id: 1, name: "鼎和保险 · 数字化转型咨询", nameEn: "DingHe · Digital Transformation", client: "鼎和保险股份有限公司", clientShort: "鼎和保险", status: "opportunity", statusEn: "Opportunity", amount: 2_800_000, updated: "2 小时前", updatedEn: "2h ago", memory: { fresh: true, v: 12 }, owner: "陈悦" },
  { id: 2, name: "申通快运 · 中台升级", nameEn: "STO · Middle Platform Upgrade", client: "申通快运有限公司", clientShort: "申通快运", status: "delivering", statusEn: "Delivering", amount: 4_500_000, updated: "昨天", updatedEn: "Yesterday", memory: { fresh: true, v: 28 }, owner: "林宥" },
  { id: 3, name: "浩瀚集团 · 数据治理", nameEn: "Haohan Group · Data Governance", client: "浩瀚集团", clientShort: "浩瀚集团", status: "lead", statusEn: "Lead", amount: 0, updated: "3 天前", updatedEn: "3d ago", memory: { fresh: false, v: 3 }, owner: "苏明" },
  { id: 4, name: "华兴生物 · AI 售前评估", nameEn: "Huaxing Bio · AI Pre-sales", client: "华兴生物科技", clientShort: "华兴生物", status: "won", statusEn: "Won", amount: 1_200_000, updated: "上周", updatedEn: "Last week", memory: { fresh: true, v: 18 }, owner: "陈悦" },
  { id: 5, name: "中信地产 · 智慧园区", nameEn: "CITIC RE · Smart Campus", client: "中信地产", clientShort: "中信地产", status: "opportunity", statusEn: "Opportunity", amount: 6_200_000, updated: "5 小时前", updatedEn: "5h ago", memory: { fresh: false, v: 7 }, owner: "林宥" },
  { id: 6, name: "金辉医疗 · 知识库迁移", nameEn: "JinHui Medical · KB Migration", client: "金辉医疗集团", clientShort: "金辉医疗", status: "delivering", statusEn: "Delivering", amount: 980_000, updated: "1 周前", updatedEn: "1w ago", memory: { fresh: true, v: 9 }, owner: "苏明" },
];

const SKILLS = [
  { id: "s1", name: "数字化战略分析", nameEn: "Digital Strategy", uses: 27, category: "战略", description: "结合行业洞察 + 客户上下文,产出三层战略框架。" },
  { id: "s2", name: "会前简报", nameEn: "Pre-meeting Brief", uses: 23, category: "销售", description: "10 分钟生成客户会前一页纸,带最近动态与建议话题。" },
  { id: "s3", name: "RFP 拆解", nameEn: "RFP Breakdown", uses: 18, category: "售前", description: "解析 RFP 文档,生成评分维度与响应大纲。" },
  { id: "s4", name: "项目周报", nameEn: "Weekly Report", uses: 15, category: "交付", description: "从项目记忆中抽取里程碑、风险与下一步。" },
  { id: "s5", name: "客户画像", nameEn: "Client Profile", uses: 14, category: "客户", description: "汇总客户行业、组织、决策链与历史合作。" },
  { id: "s6", name: "售前方案大纲", nameEn: "Pre-sales Outline", uses: 11, category: "售前", description: "基于客户痛点 + 解决方案库生成方案目录。" },
  { id: "s7", name: "竞争对手研究", nameEn: "Competitor Research", uses: 9, category: "战略", description: "拉取公开信息 + 内部记忆,生成对比表。" },
  { id: "s8", name: "里程碑复盘", nameEn: "Milestone Retrospective", uses: 7, category: "交付", description: "对比计划与实际,产出复盘文档。" },
];

const CLIENTS = [
  { id: 1, name: "鼎和保险股份有限公司", short: "鼎和保险", industry: "保险", region: "深圳", projects: 3, lastContact: "2 天前", health: "active" },
  { id: 2, name: "申通快运有限公司", short: "申通快运", industry: "物流", region: "上海", projects: 2, lastContact: "今天", health: "active" },
  { id: 3, name: "浩瀚集团", short: "浩瀚集团", industry: "制造", region: "苏州", projects: 1, lastContact: "1 周前", health: "watch" },
  { id: 4, name: "华兴生物科技", short: "华兴生物", industry: "生物医药", region: "北京", projects: 4, lastContact: "3 小时前", health: "active" },
  { id: 5, name: "中信地产", short: "中信地产", industry: "地产", region: "北京", projects: 2, lastContact: "1 天前", health: "active" },
  { id: 6, name: "金辉医疗集团", short: "金辉医疗", industry: "医疗", region: "杭州", projects: 1, lastContact: "2 周前", health: "dormant" },
];

const CONVERSATIONS = [
  { id: "c1", title: "鼎和保险 · 数字化转型框架草稿", projectId: 1, time: "刚刚", timeEn: "Just now", preview: "我把战略分成业务、技术、组织三层…" },
  { id: "c2", title: "申通快运周报", projectId: 2, time: "1 小时前", timeEn: "1h ago", preview: "本周完成 7 个里程碑,3 项风险已闭环…" },
  { id: "c3", title: "浩瀚 RFP 拆解", projectId: 3, time: "今早", timeEn: "Morning", preview: "RFP 共 47 页,识别出 23 个响应点…" },
  { id: "c4", title: "华兴生物 客户画像更新", projectId: 4, time: "昨天", timeEn: "Yesterday", preview: "新增决策链信息:CTO 王浩主导评估…" },
  { id: "c5", title: "中信智慧园区方案大纲", projectId: 5, time: "2 天前", timeEn: "2d ago", preview: "围绕园区四大场景:门禁、能耗、停车、招商…" },
];

const TODOS = [
  { id: "t1", title: "整理鼎和保险周三会议纪要", project: "鼎和保险", due: "今天 17:00", priority: "high" },
  { id: "t2", title: "完成中信地产方案 V2 修订", project: "中信地产", due: "明天", priority: "high" },
  { id: "t3", title: "回复申通 CTO 关于灰度计划的问题", project: "申通快运", due: "今天", priority: "med" },
  { id: "t4", title: "录入金辉医疗最新会议纪要到记忆", project: "金辉医疗", due: "本周", priority: "low" },
];

const MILESTONES = [
  { id: "m1", title: "需求蓝图签字", project: "申通快运 · 中台升级", date: "12/02", status: "done" },
  { id: "m2", title: "数据治理 POC 启动", project: "鼎和保险 · 数字化转型", date: "12/05", status: "in-progress" },
  { id: "m3", title: "中信智慧园区方案评审", project: "中信地产 · 智慧园区", date: "12/08", status: "planned" },
  { id: "m4", title: "金辉医疗知识库切换", project: "金辉医疗 · 知识库迁移", date: "12/12", status: "planned" },
];

const NAV = [
  { key: "workspace", zh: "工作台", en: "Workspace" },
  { key: "chat", zh: "对话", en: "Chat" },
  { key: "skills", zh: "Skill 库", en: "Skills" },
  { key: "projects", zh: "项目", en: "Projects" },
  { key: "clients", zh: "客户", en: "Clients" },
  { key: "contacts", zh: "联系人", en: "Contacts" },
  { key: "knowledge", zh: "知识库", en: "Knowledge" },
];

const PROJECT_TABS = [
  { key: "overview", zh: "概览", en: "Overview" },
  { key: "chat", zh: "聊天", en: "Chat" },
  { key: "memory", zh: "记忆", en: "Memory" },
  { key: "notes", zh: "笔记", en: "Notes" },
  { key: "todos", zh: "待办", en: "Todos" },
  { key: "milestones", zh: "里程碑", en: "Milestones" },
  { key: "finance", zh: "财务", en: "Finance" },
  { key: "docs", zh: "文档", en: "Docs" },
  { key: "settings", zh: "设置", en: "Settings" },
];

// ---------- Icon set (stroke-based, minimal) ----------
function I({ name, size = 16, stroke = 1.5, style = {} }) {
  const s = size;
  const props = { width: s, height: s, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: stroke, strokeLinecap: "round", strokeLinejoin: "round", style };
  switch (name) {
    case "home": return <svg {...props}><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>;
    case "chat": return <svg {...props}><path d="M4 5h16v11H8l-4 4z"/></svg>;
    case "wrench": return <svg {...props}><path d="M14.7 6.3a4 4 0 015.3 5.3l-2-2-2 2-2-2 2-2-1.3-1.3z"/><path d="M14 11l-7 7-3 3-1-1 3-3 7-7"/></svg>;
    case "folder": return <svg {...props}><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>;
    case "building": return <svg {...props}><rect x="4" y="3" width="16" height="18"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2"/></svg>;
    case "user": return <svg {...props}><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/></svg>;
    case "book": return <svg {...props}><path d="M4 4h7a3 3 0 013 3v13a2 2 0 00-2-2H4z"/><path d="M20 4h-7a3 3 0 00-3 3v13a2 2 0 012-2h8z"/></svg>;
    case "settings": return <svg {...props}><circle cx="12" cy="12" r="3"/><path d="M19 12l1.5-2-1.5-3-2.4.6-1.7-1L14 4h-4l-.9 2.6-1.7 1L5 7l-1.5 3L5 12l-1.5 2L5 17l2.4-.6 1.7 1L10 20h4l.9-2.6 1.7-1L19 17l1.5-3z"/></svg>;
    case "bell": return <svg {...props}><path d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 21a2 2 0 004 0"/></svg>;
    case "search": return <svg {...props}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>;
    case "plus": return <svg {...props}><path d="M12 5v14M5 12h14"/></svg>;
    case "arrow-right": return <svg {...props}><path d="M5 12h14M13 5l7 7-7 7"/></svg>;
    case "arrow-up-right": return <svg {...props}><path d="M7 17L17 7M9 7h8v8"/></svg>;
    case "chevron-right": return <svg {...props}><path d="M9 6l6 6-6 6"/></svg>;
    case "chevron-down": return <svg {...props}><path d="M6 9l6 6 6-6"/></svg>;
    case "sparkle": return <svg {...props}><path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7z"/></svg>;
    case "target": return <svg {...props}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg>;
    case "zap": return <svg {...props}><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>;
    case "clock": return <svg {...props}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
    case "calendar": return <svg {...props}><rect x="3" y="5" width="18" height="16" rx="1"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>;
    case "send": return <svg {...props}><path d="M3 12l18-8-7 18-3-7z"/></svg>;
    case "paperclip": return <svg {...props}><path d="M21 12l-8.5 8.5a5 5 0 01-7-7L14 5a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L15 8"/></svg>;
    case "file": return <svg {...props}><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6"/></svg>;
    case "check": return <svg {...props}><path d="M5 12l5 5L20 7"/></svg>;
    case "dot": return <svg {...props} viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" fill="currentColor"/></svg>;
    case "quote": return <svg {...props}><path d="M6 7h4v6a4 4 0 01-4 4M14 7h4v6a4 4 0 01-4 4"/></svg>;
    case "more": return <svg {...props}><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></svg>;
    case "filter": return <svg {...props}><path d="M3 5h18l-7 9v6l-4-2v-4z"/></svg>;
    case "grid": return <svg {...props}><rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/></svg>;
    case "list": return <svg {...props}><path d="M8 6h13M8 12h13M8 18h13M4 6h.01M4 12h.01M4 18h.01"/></svg>;
    case "logout": return <svg {...props}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>;
    case "star": return <svg {...props}><path d="M12 3l2.7 6 6.3.5-4.7 4.2 1.4 6.3L12 16.8 6.3 20l1.4-6.3L3 9.5 9.3 9z"/></svg>;
    case "tag": return <svg {...props}><path d="M3 12V3h9l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>;
    case "lock": return <svg {...props}><rect x="4" y="11" width="16" height="10" rx="1"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>;
    case "mail": return <svg {...props}><rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 7l9 7 9-7"/></svg>;
    case "moon": return <svg {...props}><path d="M21 13A9 9 0 1111 3a7 7 0 0010 10z"/></svg>;
    case "sun": return <svg {...props}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/></svg>;
    default: return <svg {...props}><rect x="4" y="4" width="16" height="16"/></svg>;
  }
}

// Tiny placeholder helpers
function PlaceholderImage({ height = 120, label = "PRODUCT SHOT", style = {} }) {
  return (
    <div className="placeholder-stripe" style={{ height, borderRadius: "var(--r-md)", display: "flex", alignItems: "center", justifyContent: "center", ...style }}>
      <span className="placeholder-label">{label}</span>
    </div>
  );
}

function Avatar({ initials, size = 28, tone = "var(--accent-soft)", ink = "var(--accent-ink)", style = {} }) {
  return (
    <div style={{ width: size, height: size, borderRadius: "999px", background: tone, color: ink, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.4, fontWeight: 600, fontFamily: "var(--font-body)", letterSpacing: "-0.01em", ...style }}>
      {initials}
    </div>
  );
}

function statusInitials(name) {
  // For Chinese names: first character; for client short names: first 2
  const trimmed = (name || "").trim();
  if (!trimmed) return "";
  // strip whitespace and punctuation
  const m = trimmed.replace(/[·\.,。、 ]+/g, " ").split(" ")[0];
  return m.slice(0, 2);
}

Object.assign(window, {
  PROJECTS, SKILLS, CLIENTS, CONVERSATIONS, TODOS, MILESTONES, NAV, PROJECT_TABS,
  I, PlaceholderImage, Avatar, statusInitials,
});
