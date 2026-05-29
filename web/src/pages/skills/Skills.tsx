import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpen,
  Brain,
  Briefcase,
  Calculator,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Compass,
  Cpu,
  DollarSign,
  FileText,
  Layers3,
  LayoutGrid,
  MessageSquare,
  Receipt,
  Search,
  Shield,
  ShieldCheck,
  Target,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";

import { api } from "../../api/client";
import { PageTitle } from "../../components/PageTitle";
import type { Skill, SkillSummary } from "../../types/api";

type SkillTypeFilter = "all" | "quick" | "deep";

type SkillCategory = {
  id: string;
  label: string;
  count: number;
};

const SKILLS_PAGE_SIZE = 12;

const extractMinutes = (estimatedTime?: string) => {
  if (!estimatedTime) return 0;
  const match = estimatedTime.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
};

const normalizeCategory = (value: string) => value.replace(/\?/g, "").trim();

const getCategoryKey = (category: string) => {
  const normalized = normalizeCategory(category).toLowerCase();
  if (
    [
      "consulting_scoping",
      "consulting_delivery",
      "consulting_review",
      "consulting_learning",
      "common",
      "market",
      "org",
      "digital",
      "strategy",
      "operations",
      "finance",
      "risk",
      "manda",
      "data",
      "other",
      "all",
      "audit",
      "assurance",
      "tax",
    ].includes(normalized)
  ) return normalized;
  if (
    normalized.includes("proposal") ||
    normalized.includes("delivery") ||
    normalized.includes("deep task") ||
    normalized.includes("deep_task") ||
    normalized.includes("quick tool") ||
    normalized.includes("quick_tool") ||
    normalized.includes("guided workflow") ||
    normalized.includes("guided_workflow") ||
    normalized.includes("提案") ||
    normalized.includes("交付")
  ) return "common";
  if (normalized.includes("strategy") || normalized.includes("战略")) return "strategy";
  if (normalized.includes("market") || normalized.includes("customer") || normalized.includes("市场") || normalized.includes("客户")) return "market";
  if (normalized.includes("finance") || normalized.includes("财务")) return "finance";
  if (normalized.includes("risk") || normalized.includes("compliance") || normalized.includes("风险") || normalized.includes("合规")) return "risk";
  if (normalized.includes("digital") || normalized.includes("technology") || normalized.includes("数字化") || normalized.includes("技术")) return "digital";
  if (normalized.includes("operation") || normalized.includes("efficiency") || normalized.includes("运营") || normalized.includes("效能")) return "operations";
  if (normalized.includes("org") || normalized.includes("talent") || normalized.includes("组织") || normalized.includes("人才")) return "org";
  if (normalized.includes("m&a") || normalized.includes("transactions") || normalized.includes("并购") || normalized.includes("交易")) return "manda";
  if (normalized.includes("data") || normalized.includes("数据")) return "data";
  if (normalized.includes("audit") || normalized.includes("审计")) return "audit";
  if (normalized.includes("assurance") || normalized.includes("鉴证")) return "assurance";
  if (normalized.includes("tax") || normalized.includes("税务") || normalized.includes("税")) return "tax";
  return "other";
};

const isDigitalCapabilitySkill = (skill: Pick<SkillSummary, "name" | "description" | "category">) => {
  const baseKey = getCategoryKey(skill.category);
  if (["audit", "assurance", "tax"].includes(baseKey)) return false;

  const category = normalizeCategory(skill.category).toLowerCase();
  const name = skill.name.toLowerCase();
  const description = skill.description.toLowerCase();
  const text = `${name} ${description}`;

  if (category.includes("数字化") || category.includes("digital") || category.includes("technology")) {
    return true;
  }

  const nameSignals = [
    "ai 用例",
    "ai应用",
    "数字化",
    "数字技术",
    "企业架构",
    "数据治理",
    "流程数字化",
    "行业数字化",
  ];
  if (nameSignals.some((signal) => name.includes(signal))) return true;

  const descriptionSignals = [
    "数字化转型",
    "数字化项目",
    "数字化方案",
    "技术架构",
    "数据治理",
    "流程数字化",
    "数据平台",
    "ai 应用场景",
  ];
  return descriptionSignals.some((signal) => text.includes(signal));
};

const getSkillCategoryKey = (skill: Pick<SkillSummary, "name" | "description" | "category">) => {
  const baseKey = getCategoryKey(skill.category);
  if (isDigitalCapabilitySkill(skill)) return "digital";
  if (baseKey !== "common") return baseKey;

  const text = `${skill.name} ${skill.description}`.toLowerCase();
  if (text.includes("启动") || text.includes("brief") || text.includes("scoping") || text.includes("kickoff")) {
    return "consulting_scoping";
  }
  if (text.includes("复盘") || text.includes("retro") || text.includes("learning") || text.includes("沉淀")) {
    return "consulting_learning";
  }
  if (
    text.includes("挑战") ||
    text.includes("审查") ||
    text.includes("review") ||
    text.includes("challenge") ||
    text.includes("quality")
  ) {
    return "consulting_review";
  }
  return "consulting_delivery";
};

const categoryOrder = [
  "all",
  "strategy",
  "manda",
  "market",
  "org",
  "finance",
  "operations",
  "risk",
  "digital",
  "data",
  "audit",
  "assurance",
  "tax",
  "consulting_scoping",
  "consulting_delivery",
  "consulting_review",
  "consulting_learning",
  "common",
  "other",
];

const getCategoryIcon = (category: string) => {
  const key = getCategoryKey(category);
  if (key === "strategy") return TrendingUp;
  if (key === "market") return Target;
  if (key === "finance") return DollarSign;
  if (key === "risk") return Shield;
  if (key === "digital") return Cpu;
  if (key.startsWith("consulting_") || key === "common") return FileText;
  if (key === "operations") return Briefcase;
  if (key === "org") return Users;
  if (key === "manda") return BarChart3;
  if (key === "data") return BarChart3;
  if (key === "audit") return ClipboardList;
  if (key === "assurance") return CheckCircle2;
  if (key === "tax") return Calculator;
  return Brain;
};

const getCategoryTone = (category: string) => {
  const key = getCategoryKey(category);
  if (key === "strategy") return "bg-blue-50 text-blue-700 border-blue-100";
  if (key === "market") return "bg-emerald-50 text-emerald-700 border-emerald-100";
  if (key === "finance") return "bg-amber-50 text-amber-700 border-amber-100";
  if (key === "risk") return "bg-rose-50 text-rose-700 border-rose-100";
  if (key === "digital") return "bg-cyan-50 text-cyan-700 border-cyan-100";
  if (key === "org") return "bg-orange-50 text-orange-700 border-orange-100";
  if (key === "operations") return "bg-teal-50 text-teal-700 border-teal-100";
  if (key.startsWith("consulting_")) return "bg-violet-50 text-violet-700 border-violet-100";
  if (key === "common") return "bg-indigo-50 text-indigo-700 border-indigo-100";
  if (key === "audit") return "bg-sky-50 text-sky-700 border-sky-100";
  if (key === "assurance") return "bg-blue-50 text-blue-700 border-blue-100";
  if (key === "tax") return "bg-emerald-50 text-emerald-700 border-emerald-100";
  return "bg-slate-50 text-slate-700 border-slate-200";
};

const getCategoryLabel = (category: string, isZh: boolean) => {
  const key = getCategoryKey(category);
  const labels: Record<string, { zh: string; en: string }> = {
    all: { zh: "全部能力", en: "All capabilities" },
    market: { zh: "市场与客户", en: "Market & Customers" },
    org: { zh: "组织与人才", en: "Organization & Talent" },
    digital: { zh: "数字化与技术", en: "Digital & Technology" },
    common: { zh: "通用能力", en: "General Capabilities" },
    consulting_scoping: { zh: "问题定义与启动", en: "Scoping & Kickoff" },
    consulting_delivery: { zh: "摘要与交付", en: "Synthesis & Delivery" },
    consulting_review: { zh: "质量挑战与审查", en: "Challenge & Review" },
    consulting_learning: { zh: "复盘与沉淀", en: "Retrospective & Learning" },
    strategy: { zh: "战略与增长", en: "Strategy & Growth" },
    operations: { zh: "运营与效能", en: "Operations & Efficiency" },
    finance: { zh: "财务咨询", en: "Finance" },
    risk: { zh: "风险与合规", en: "Risk & Compliance" },
    manda: { zh: "并购与交易", en: "M&A & Transactions" },
    data: { zh: "数据与洞察", en: "Data & Insights" },
    other: { zh: "其他能力", en: "Other Capabilities" },
    audit: { zh: "审计", en: "Audit" },
    assurance: { zh: "鉴证", en: "Assurance" },
    tax: { zh: "税务", en: "Tax" },
  };
  return isZh ? labels[key]?.zh || labels.other.zh : labels[key]?.en || labels.other.en;
};

// ── 业务线映射（Practice Lines）─────────────────────────

type PracticeGroup = {
  label: { zh: string; en: string };
  categoryIds: string[];
};

type PracticeLineMeta = {
  id: string;
  title: { zh: string; en: string };
  subtitle: { zh: string; en: string };
  description: { zh: string; en: string };
  icon: typeof ShieldCheck;
  accentClass: string;
  cardTintClass: string;
  badgeTone: string; // e.g. "bg-blue-50 text-blue-700"
};

const PRACTICE_LINE_META: Record<string, PracticeLineMeta> = {
  "audit-assurance": {
    id: "audit-assurance",
    title: { zh: "审计鉴证", en: "Audit & Assurance" },
    subtitle: { zh: "Audit & Assurance", en: "Audit & Assurance" },
    description: { zh: "面向审计、鉴证、内控和可持续信息披露的专业能力。", en: "Capabilities for audit, assurance, controls, and sustainability reporting." },
    icon: ShieldCheck,
    accentClass: "bg-blue-200",
    cardTintClass: "from-sky-50/80 via-white to-white",
    badgeTone: "border border-blue-100 bg-blue-50/70 text-blue-700",
  },
  tax: {
    id: "tax",
    title: { zh: "税务", en: "Tax" },
    subtitle: { zh: "Tax", en: "Tax" },
    description: { zh: "覆盖企业税、国际税、转让定价、税务合规和筹划优化。", en: "Covers corporate tax, international tax, transfer pricing, compliance, and planning." },
    icon: Receipt,
    accentClass: "bg-emerald-200",
    cardTintClass: "from-emerald-50/80 via-white to-white",
    badgeTone: "border border-emerald-100 bg-emerald-50/70 text-emerald-700",
  },
  consulting: {
    id: "consulting",
    title: { zh: "咨询", en: "Consulting" },
    subtitle: { zh: "Consulting", en: "Consulting" },
    description: { zh: "按咨询业务线组织，覆盖战略、客户、组织、技术、数据和风险。", en: "Organized by consulting practice lines across strategy, customer, people, technology, data, and risk." },
    icon: Compass,
    accentClass: "bg-indigo-200",
    cardTintClass: "from-indigo-50/75 via-white to-white",
    badgeTone: "border border-indigo-100 bg-indigo-50/70 text-indigo-700",
  },
};

const GENERAL_LINE_META: PracticeLineMeta = {
  id: "general",
  title: { zh: "通用能力", en: "General Capabilities" },
  subtitle: { zh: "跨业务线共享的基础服务与工具", en: "Cross-practice foundational services & tools" },
  description: { zh: "适用于提案、交付、复盘、资料整理和跨业务线基础工作。", en: "Reusable capabilities for proposals, delivery, retrospectives, synthesis, and cross-practice work." },
  icon: LayoutGrid,
  accentClass: "bg-slate-200",
  cardTintClass: "from-slate-50 via-white to-white",
  badgeTone: "border border-slate-200 bg-slate-50 text-slate-700",
};

const PRACTICE_LINE_IDS = ["audit-assurance", "tax", "consulting", "general"] as const;
const CORE_PRACTICE_LINE_IDS = ["audit-assurance", "tax", "consulting"] as const;
type PracticeLineId = (typeof PRACTICE_LINE_IDS)[number];

/** 每个业务线内部分组定义 */
const PRACTICE_LINE_GROUPS: Record<string, PracticeGroup[]> = {
  "audit-assurance": [
    { label: { zh: "审计", en: "Audit" }, categoryIds: ["audit"] },
    { label: { zh: "鉴证", en: "Assurance" }, categoryIds: ["assurance", "consulting_review", "consulting_learning"] },
  ],
  tax: [
    { label: { zh: "税务", en: "Tax" }, categoryIds: ["tax", "finance"] },
  ],
  consulting: [
    { label: { zh: "战略与企业交易", en: "Strategy & Transactions" }, categoryIds: ["strategy", "manda"] },
    { label: { zh: "客户业务", en: "Customer" }, categoryIds: ["market"] },
    { label: { zh: "人力资本", en: "Human Capital" }, categoryIds: ["org"] },
    { label: { zh: "企业技术与绩效", en: "Technology & Performance" }, categoryIds: ["digital", "operations"] },
    { label: { zh: "AI与数据", en: "AI & Data" }, categoryIds: ["data"] },
    { label: { zh: "网络安全", en: "Cybersecurity" }, categoryIds: [] },
    { label: { zh: "风险合规", en: "Risk & Compliance" }, categoryIds: ["risk"] },
  ],
  general: [
    { label: { zh: "基础服务", en: "Foundation" }, categoryIds: ["common", "consulting_scoping", "consulting_delivery"] },
    { label: { zh: "其他", en: "Other" }, categoryIds: ["other"] },
  ],
};

/** Category ID → Practice Line ID */
const CATEGORY_TO_PRACTICE_LINE: Record<string, string> = {
  // 审计鉴证
  audit: "audit-assurance",
  assurance: "audit-assurance",
  consulting_review: "audit-assurance",
  consulting_learning: "audit-assurance",
  // 税务
  tax: "tax",
  finance: "tax",
  // 咨询
  strategy: "consulting",
  manda: "consulting",
  market: "consulting",
  org: "consulting",
  digital: "consulting",
  data: "consulting",
  operations: "consulting",
  risk: "consulting",
};

/** 通用能力业务线元数据 */
const getPracticeLineId = (categoryId: string): string | null => {
  return CATEGORY_TO_PRACTICE_LINE[categoryId] || null;
};

const isPracticeLineId = (value: string | null): value is PracticeLineId => {
  return Boolean(value && (PRACTICE_LINE_IDS as readonly string[]).includes(value));
};

const getPracticeLineMeta = (lineId: PracticeLineId): PracticeLineMeta => {
  return lineId === "general" ? GENERAL_LINE_META : PRACTICE_LINE_META[lineId];
};

const safeDecode = (value?: string) => {
  try {
    return decodeURIComponent(value || "all");
  } catch {
    return "all";
  }
};

const buildCategoryPath = (categoryId: string, searchParams: URLSearchParams) => {
  const params = new URLSearchParams(searchParams);
  const query = params.toString();
  return `/skills/${encodeURIComponent(categoryId)}${query ? `?${query}` : ""}`;
};

const buildPracticeLinePath = (lineId: PracticeLineId, searchParams: URLSearchParams) => {
  const params = new URLSearchParams(searchParams);
  params.set("line", lineId);
  const query = params.toString();
  return `/skills/all${query ? `?${query}` : ""}`;
};

const buildSkillsPath = (searchParams: URLSearchParams) => {
  const params = new URLSearchParams(searchParams);
  params.delete("line");
  const query = params.toString();
  return `/skills${query ? `?${query}` : ""}`;
};

const buildSkillDetailPath = (skillId: number, searchParams: URLSearchParams) => {
  const params = new URLSearchParams(searchParams);
  const query = params.toString();
  return `/skills/item/${skillId}${query ? `?${query}` : ""}`;
};

const buildSkillChatPath = (skillId: number, searchParams: URLSearchParams) => {
  const projectId = searchParams.get("project");
  const clientProjectId = searchParams.get("clientProject");
  const prefilledPrompt = searchParams.get("q");
  const targetProjectId = projectId || clientProjectId;
  const nextParams = new URLSearchParams({ skill: String(skillId) });
  if (targetProjectId) nextParams.set("project", targetProjectId);
  if (prefilledPrompt) nextParams.set("q", prefilledPrompt);
  return targetProjectId ? `/projects/${targetProjectId}/chat?${nextParams.toString()}` : `/chat?${nextParams.toString()}`;
};

const buildCategories = (skills: SkillSummary[], allLabel: string, isZh: boolean) => {
  const categoryMap = new Map<string, SkillCategory>();
  skills.forEach((skill) => {
    const id = getSkillCategoryKey(skill);
    const current = categoryMap.get(id);
    categoryMap.set(id, {
      id,
      label: getCategoryLabel(id, isZh),
      count: (current?.count ?? 0) + 1,
    });
  });

  const sorted = Array.from(categoryMap.values()).sort((a, b) => {
    const aOrder = categoryOrder.indexOf(getCategoryKey(a.id));
    const bOrder = categoryOrder.indexOf(getCategoryKey(b.id));
    const safeAOrder = aOrder === -1 ? categoryOrder.length : aOrder;
    const safeBOrder = bOrder === -1 ? categoryOrder.length : bOrder;
    if (safeAOrder !== safeBOrder) return safeAOrder - safeBOrder;
    return b.count - a.count;
  });

  return [{ id: "all", label: allLabel, count: skills.length }, ...sorted];
};

function useSkillsData(allLabel: string, isZh: boolean) {
  const [loading, setLoading] = useState(true);
  const [skills, setSkills] = useState<SkillSummary[]>([]);

  useEffect(() => {
    const fetchSkills = async () => {
      try {
        setLoading(true);
        const data = await api.get<SkillSummary[]>("/skills/meta/summary");
        setSkills(data);
      } catch (error) {
        console.error("Failed to fetch skills:", error);
      } finally {
        setLoading(false);
      }
    };

    void fetchSkills();
  }, []);

  const categories = useMemo(() => buildCategories(skills, allLabel, isZh), [allLabel, isZh, skills]);

  return { categories, loading, skills };
}

function useSkillDetail(skillId?: string) {
  const [loading, setLoading] = useState(true);
  const [skill, setSkill] = useState<Skill | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const id = Number(skillId);
    if (!Number.isFinite(id) || id <= 0) {
      setLoading(false);
      setError("invalid");
      return;
    }

    const fetchSkill = async () => {
      try {
        setLoading(true);
        setError("");
        const data = await api.get<Skill>(`/skills/${id}`);
        setSkill(data);
      } catch (fetchError) {
        console.error("Failed to fetch skill:", fetchError);
        setError("not_found");
      } finally {
        setLoading(false);
      }
    };

    void fetchSkill();
  }, [skillId]);

  return { error, loading, skill };
}

function useLaunchSource() {
  const [searchParams] = useSearchParams();
  return {
    clientId: searchParams.get("client"),
    clientName: searchParams.get("clientName"),
    clientProjectId: searchParams.get("clientProject"),
    projectId: searchParams.get("project"),
    projectName: searchParams.get("projectName"),
    searchParams,
  };
}

function PracticeLineCard({
  lineMeta,
  categories,
  onLineClick,
  isZh,
  prominence = "core",
}: {
  lineMeta: PracticeLineMeta;
  categories: SkillCategory[];
  onLineClick: () => void;
  isZh: boolean;
  prominence?: "core" | "support";
}) {
  const groups = PRACTICE_LINE_GROUPS[lineMeta.id] || [];
  const Icon = lineMeta.icon;
  const totalCount = categories.reduce((sum, category) => sum + category.count, 0);
  const visibleGroups = groups.slice(0, prominence === "support" ? 4 : 3);
  const hiddenGroupCount = Math.max(0, groups.length - visibleGroups.length);
  const isSupport = prominence === "support";
  const groupSummary = visibleGroups
    .map((group) => (isZh ? group.label.zh : group.label.en))
    .concat(hiddenGroupCount > 0 ? [isZh ? `+${hiddenGroupCount}` : `+${hiddenGroupCount}`] : []);

  return (
    <button
      type="button"
      onClick={onLineClick}
      className={`group relative flex h-full w-full flex-col overflow-hidden rounded-[1.5rem] border border-white/80 ${isSupport ? "min-h-40 bg-gradient-to-r p-6 md:min-h-36" : "min-h-40 bg-gradient-to-br p-5"} ${lineMeta.cardTintClass} text-left shadow-[0_1px_0_rgba(15,23,42,0.04)] transition duration-200 hover:-translate-y-0.5 hover:border-primary/20 hover:bg-white hover:shadow-[0_18px_40px_rgba(15,23,42,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20`}
    >
      <div className={`absolute inset-x-0 top-0 h-1 ${lineMeta.accentClass}`} />
      <div className={isSupport ? "grid h-full gap-5 md:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.7fr)_auto] md:items-center" : "flex flex-col gap-4"}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className={`${isSupport ? "h-12 w-12" : "h-11 w-11"} flex shrink-0 items-center justify-center rounded-2xl border border-white bg-white/80 text-slate-600 shadow-sm`}>
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className={`${isSupport ? "text-xl" : "text-lg"} block font-semibold text-slate-950`}>
                {isZh ? lineMeta.title.zh : lineMeta.title.en}
              </span>
              <span className="mt-0.5 block text-xs font-medium text-slate-400">
                {isZh ? lineMeta.subtitle.zh : lineMeta.subtitle.en}
              </span>
            </span>
          </div>
          <span className="inline-flex shrink-0 items-center rounded-full border border-white/80 bg-white/75 px-2.5 py-1 text-xs font-semibold text-slate-600 shadow-sm">
            {totalCount}
          </span>
        </div>

        <div className="min-w-0">
          <p className="line-clamp-2 text-sm leading-6 text-slate-600">
            {isZh ? lineMeta.description.zh : lineMeta.description.en}
          </p>
          <div className={`${isSupport ? "gap-2" : "gap-1.5"} mt-3 flex flex-wrap`}>
            {groupSummary.map((label) => (
              <span
                key={label}
                className={`${isSupport ? "px-3 py-1.5" : "px-2.5 py-1"} rounded-full border border-white/80 bg-white/58 text-xs font-medium text-slate-500`}
              >
                {label}
              </span>
            ))}
          </div>
        </div>

        <span className={`mt-auto inline-flex items-center gap-1.5 pt-1 text-xs font-semibold text-slate-600 transition group-hover:text-primary ${isSupport ? "justify-self-start rounded-full border border-white/80 bg-white/70 px-3.5 py-2 shadow-sm md:mt-0 md:shrink-0 md:justify-self-end md:pt-2" : ""}`}>
          {isZh ? "进入子能力" : "Open capabilities"}
          <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
        </span>
      </div>
    </button>
  );
}

function CapabilityFramework({
  categoryBuckets,
  isZh,
  onLineClick,
}: {
  categoryBuckets: Record<PracticeLineId, SkillCategory[]>;
  isZh: boolean;
  onLineClick: (lineId: PracticeLineId) => void;
}) {
  return (
    <section className="mt-4 overflow-hidden rounded-[2rem] border border-slate-200 bg-white/90 p-4 shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
      <div className="flex flex-col gap-1 px-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">
            {isZh ? "咨询公司能力框架" : "Firm-wide capability framework"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {isZh
              ? "上层是专业服务主线，下层是交付、提案和知识工作的通用能力底座。"
              : "Professional service lines sit above a shared foundation for proposals, delivery, and knowledge work."}
          </p>
        </div>
        <span className="w-fit rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
          {isZh ? "覆盖全域服务能力" : "Full-service coverage"}
        </span>
      </div>

      <div className="mt-4 rounded-[1.5rem] border border-slate-100 bg-slate-50/65 p-4">
        <div className="mb-3 flex items-center gap-3">
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
            {isZh ? "专业服务主线" : "Professional services"}
          </span>
          <div className="h-px flex-1 bg-slate-200/80" />
        </div>

        <div className="grid gap-3 xl:grid-cols-3">
          {CORE_PRACTICE_LINE_IDS.map((lineId) => (
            <PracticeLineCard
              key={lineId}
              categories={categoryBuckets[lineId]}
              isZh={isZh}
              lineMeta={getPracticeLineMeta(lineId)}
              onLineClick={() => onLineClick(lineId)}
            />
          ))}
        </div>

        <div className="flex items-center justify-center py-3">
          <div className="h-6 w-px bg-slate-200" />
        </div>

        <div className="mb-3 flex items-center gap-3">
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
            {isZh ? "通用能力底座" : "Shared capability foundation"}
          </span>
          <div className="h-px flex-1 bg-slate-200/80" />
        </div>

        <PracticeLineCard
          categories={categoryBuckets.general}
          isZh={isZh}
          lineMeta={GENERAL_LINE_META}
          onLineClick={() => onLineClick("general")}
          prominence="support"
        />
      </div>
    </section>
  );
}

type CapabilityArea = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  categoryIds: string[];
  icon: typeof Brain;
};

type LineFrameworkConfig = {
  eyebrow: string;
  title: string;
  subtitle: string;
  description: string;
  journey: string[];
  areas: CapabilityArea[];
};

function buildLineFrameworkConfig(lineId: PracticeLineId, isZh: boolean): LineFrameworkConfig {
  if (lineId === "audit-assurance") {
    return {
      eyebrow: isZh ? "审计鉴证能力框架" : "Audit & assurance capability framework",
      title: isZh ? "从可信报告出发，组织审计与鉴证能力" : "Organize audit and assurance capabilities around trusted reporting",
      subtitle: "Audit & Assurance",
      description: isZh
        ? "围绕财务报告可信度、内控有效性、鉴证要求和质量复核，形成审计鉴证工作的专业能力体系。"
        : "A capability system for reporting reliability, control effectiveness, assurance requirements, and quality review.",
      journey: isZh
        ? ["理解业务与风险", "执行审计与鉴证程序", "挑战关键判断", "沉淀质量与经验"]
        : ["Understand business and risk", "Execute audit and assurance work", "Challenge key judgments", "Capture quality and learning"],
      areas: [
        {
          id: "audit",
          title: isZh ? "审计" : "Audit",
          subtitle: isZh ? "财务报表与审计程序" : "Financial statements and audit procedures",
          description: isZh
            ? "覆盖审计计划、程序执行、数据分析、底稿组织和审计判断。"
            : "Audit planning, procedures, analytics, workpaper organization, and audit judgment.",
          categoryIds: ["audit"],
          icon: ClipboardList,
        },
        {
          id: "assurance",
          title: isZh ? "鉴证" : "Assurance",
          subtitle: isZh ? "内控、报告和可持续鉴证" : "Controls, reporting, and sustainability assurance",
          description: isZh
            ? "围绕内控、专项报告、可持续披露和合规鉴证形成独立判断。"
            : "Independent judgment for controls, special reports, sustainability disclosures, and compliance assurance.",
          categoryIds: ["assurance"],
          icon: CheckCircle2,
        },
        {
          id: "review-quality",
          title: isZh ? "复核与质量挑战" : "Review & Quality Challenge",
          subtitle: isZh ? "关键假设、红旗和质量控制" : "Key assumptions, red flags, and quality control",
          description: isZh
            ? "识别重大判断、底稿质量、披露逻辑和报告风险，提升交付质量。"
            : "Review major judgments, workpaper quality, disclosure logic, and report risk.",
          categoryIds: ["consulting_review"],
          icon: ShieldCheck,
        },
        {
          id: "learning",
          title: isZh ? "经验沉淀" : "Learning",
          subtitle: isZh ? "复盘、模板和可复用资产" : "Retrospectives, templates, and reusable assets",
          description: isZh
            ? "把项目经验转化为复盘结论、方法模板和下次执行起点。"
            : "Turn project experience into retrospectives, templates, and starting points for future work.",
          categoryIds: ["consulting_learning"],
          icon: BookOpen,
        },
      ],
    };
  }

  if (lineId === "tax") {
    return {
      eyebrow: isZh ? "税务能力框架" : "Tax capability framework",
      title: isZh ? "从合规确定性出发，组织税务专业能力" : "Organize tax capabilities around compliance certainty",
      subtitle: "Tax",
      description: isZh
        ? "围绕税务合规、筹划优化、交易税务和财务影响，帮助企业在规则约束下提升经营确定性。"
        : "Capabilities for tax compliance, planning, transaction tax, and financial impact under regulatory constraints.",
      journey: isZh
        ? ["识别税务事实", "判断规则影响", "设计筹划路径", "量化财务结果"]
        : ["Identify tax facts", "Assess rule impact", "Design planning paths", "Quantify financial results"],
      areas: [
        {
          id: "tax-compliance",
          title: isZh ? "税务合规与筹划" : "Tax Compliance & Planning",
          subtitle: isZh ? "申报、合规和税务优化" : "Filing, compliance, and optimization",
          description: isZh
            ? "覆盖企业税、间接税、国际税、税务合规和筹划优化。"
            : "Corporate tax, indirect tax, international tax, compliance, and planning.",
          categoryIds: ["tax"],
          icon: Receipt,
        },
        {
          id: "finance-impact",
          title: isZh ? "财务影响与测算" : "Financial Impact",
          subtitle: isZh ? "测算、假设和经营影响" : "Modeling, assumptions, and business impact",
          description: isZh
            ? "把税务判断转化为财务影响、测算框架和经营决策依据。"
            : "Translate tax judgments into financial impact, modeling frames, and business decisions.",
          categoryIds: ["finance"],
          icon: DollarSign,
        },
      ],
    };
  }

  if (lineId === "general") {
    return {
      eyebrow: isZh ? "通用能力框架" : "General capability framework",
      title: isZh ? "用通用能力支撑提案、交付和知识沉淀" : "Use shared capabilities to support proposals, delivery, and knowledge work",
      subtitle: "General Capabilities",
      description: isZh
        ? "通用能力不是单一业务线，而是支撑专业服务交付的基础层：启动、交付、复核、复盘和资料组织。"
        : "A shared foundation for professional delivery: scoping, delivery, review, learning, and knowledge organization.",
      journey: isZh
        ? ["定义问题和范围", "组织交付产出", "复核质量", "沉淀可复用资产"]
        : ["Define problem and scope", "Organize deliverables", "Review quality", "Capture reusable assets"],
      areas: [
        {
          id: "scoping",
          title: isZh ? "项目启动与范围" : "Scoping",
          subtitle: isZh ? "问题定义、边界和计划" : "Problem, boundary, and plan",
          description: isZh
            ? "帮助项目快速明确问题、目标、边界、利益相关方和第一步行动。"
            : "Clarify problem, goals, boundaries, stakeholders, and first actions.",
          categoryIds: ["consulting_scoping"],
          icon: Target,
        },
        {
          id: "delivery",
          title: isZh ? "交付与表达" : "Delivery",
          subtitle: isZh ? "报告、提案和结构化表达" : "Reports, proposals, and structured expression",
          description: isZh
            ? "把项目材料组织成客户可读、可讨论、可推进的交付内容。"
            : "Turn project material into client-ready deliverables for discussion and action.",
          categoryIds: ["consulting_delivery", "common"],
          icon: FileText,
        },
        {
          id: "review",
          title: isZh ? "复核与挑战" : "Review",
          subtitle: isZh ? "红旗、假设和质量控制" : "Red flags, assumptions, and quality control",
          description: isZh
            ? "用于检查逻辑、假设、材料质量和客户沟通风险。"
            : "Check logic, assumptions, material quality, and client communication risk.",
          categoryIds: ["consulting_review"],
          icon: ShieldCheck,
        },
        {
          id: "learning",
          title: isZh ? "复盘与沉淀" : "Learning",
          subtitle: isZh ? "经验教训和知识资产" : "Lessons and reusable knowledge",
          description: isZh
            ? "把项目经验沉淀成复盘、模板、方法论和后续复用资产。"
            : "Convert project experience into retrospectives, templates, methods, and reusable assets.",
          categoryIds: ["consulting_learning", "other"],
          icon: BookOpen,
        },
      ],
    };
  }

  return {
    eyebrow: isZh ? "咨询能力框架" : "Consulting capability framework",
    title: isZh ? "从企业增长问题出发，组织咨询能力" : "Organize consulting capabilities around enterprise growth questions",
    subtitle: "Consulting Capability Framework",
    description: isZh
      ? "咨询不是能力清单的堆叠，而是一套帮助客户识别增长、设计路径、组织承接并控制风险的专业框架。"
      : "Consulting is not a flat list of skills. It is a professional system for growth, path design, execution readiness, and risk control.",
    journey: isZh
      ? ["识别增长机会", "设计交易与市场路径", "组织运营承接", "风险、数字和数据支撑"]
      : ["Find growth", "Design transaction and market paths", "Mobilize operations", "Support with risk, digital, and data"],
    areas: [
      {
        id: "strategy-growth",
        title: isZh ? "战略与增长" : "Strategy & Growth",
        subtitle: isZh ? "方向选择与增长路径" : "Direction choices and growth path",
        description: isZh
          ? "回答企业要去哪里、选择哪些赛道、如何设计增长路径和战略优先级。"
          : "Answer where to play, which arenas to prioritize, and how to design the growth path.",
        categoryIds: ["strategy"],
        icon: TrendingUp,
      },
      {
        id: "transactions",
        title: isZh ? "并购与交易" : "M&A & Transactions",
        subtitle: isZh ? "资本路径与交易整合" : "Capital path and transaction integration",
        description: isZh
          ? "围绕投资并购、商业尽调、交易逻辑和整合规划，支撑非有机增长。"
          : "Support inorganic growth through investment thesis, due diligence, transaction logic, and integration planning.",
        categoryIds: ["manda"],
        icon: BarChart3,
      },
      {
        id: "market-customer",
        title: isZh ? "市场与客户" : "Market & Customer",
        subtitle: isZh ? "客户洞察、品牌和渠道" : "Customer insight, brand, and channels",
        description: isZh
          ? "把市场机会转化为客户价值、品牌定位、渠道打法和增长运营。"
          : "Translate market opportunities into customer value, brand positioning, channel plays, and growth operations.",
        categoryIds: ["market"],
        icon: Users,
      },
      {
        id: "organization-talent",
        title: isZh ? "组织与人才" : "Organization & Talent",
        subtitle: isZh ? "组织设计与变革承接" : "Organization design and change readiness",
        description: isZh
          ? "设计组织、机制、人才和变革路径，让战略能够被团队稳定承接。"
          : "Design organization, mechanisms, talent systems, and change paths so strategy can be absorbed by teams.",
        categoryIds: ["org"],
        icon: Users,
      },
      {
        id: "operations-efficiency",
        title: isZh ? "运营与效能" : "Operations & Performance",
        subtitle: isZh ? "流程、成本与效率提升" : "Process, cost, and productivity",
        description: isZh
          ? "围绕流程、供应链、经营管理和效率改善，把战略落到可执行的运营体系。"
          : "Turn strategy into an executable operating model across processes, supply chain, and performance.",
        categoryIds: ["operations"],
        icon: Briefcase,
      },
      {
        id: "risk-compliance",
        title: isZh ? "风险与合规" : "Risk & Compliance",
        subtitle: isZh ? "控制风险与建立治理机制" : "Risk control and governance mechanisms",
        description: isZh
          ? "围绕风险识别、控制机制、合规要求和治理体系，让增长更可控。"
          : "Build risk discovery, control mechanisms, compliance readiness, and governance systems.",
        categoryIds: ["risk"],
        icon: Shield,
      },
      {
        id: "digital-technology",
        title: isZh ? "数字化与技术" : "Digital & Technology",
        subtitle: isZh ? "技术架构与数字化转型" : "Technology architecture and digital transformation",
        description: isZh
          ? "规划数字化转型、系统能力、技术架构和业务技术融合路径。"
          : "Plan digital transformation, system capabilities, technology architecture, and business-technology alignment.",
        categoryIds: ["digital"],
        icon: Cpu,
      },
      {
        id: "data-insights",
        title: isZh ? "数据与洞察" : "Data & Insights",
        subtitle: isZh ? "数据资产与分析洞察" : "Data assets and analytical insight",
        description: isZh
          ? "把数据资产、指标体系和分析模型转化为更清晰的经营判断。"
          : "Turn data assets, metric systems, and analytical models into clearer management decisions.",
        categoryIds: ["data"],
        icon: BarChart3,
      },
    ],
  };
}

function LineCapabilityFramework({
  categories,
  isZh,
  lineId,
  onCategoryClick,
}: {
  categories: SkillCategory[];
  isZh: boolean;
  lineId: PracticeLineId;
  onCategoryClick: (categoryId: string) => void;
}) {
  const config = buildLineFrameworkConfig(lineId, isZh);
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const getCount = (categoryIds: string[]) =>
    categoryIds.reduce((sum, id) => sum + (categoryMap.get(id)?.count ?? 0), 0);

  return (
    <section className="mt-6 overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_20px_52px_rgba(15,23,42,0.07)]">
      <div className="bg-gradient-to-br from-white via-sky-50 to-blue-50 px-6 py-6 xl:px-7">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-4xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-white/75 px-3 py-1.5 text-xs font-semibold text-blue-700 shadow-sm">
              <Compass className="h-3.5 w-3.5" />
              {config.eyebrow}
            </div>
            <h2 className="mt-4 text-2xl font-semibold text-slate-950 md:text-2xl">
              {config.title}
            </h2>
            <p className="mt-1 text-sm font-medium text-blue-700">{config.subtitle}</p>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              {config.description}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:w-[520px]">
            {config.journey.map((item, index) => (
              <div
                key={item}
                className="rounded-2xl border border-white/80 bg-white/70 px-3 py-2 text-xs font-medium text-slate-600 shadow-sm"
              >
                <span className="mr-2 text-blue-600">{String(index + 1).padStart(2, "0")}</span>
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3 bg-slate-50/75 p-4 md:grid-cols-2 xl:grid-cols-4 xl:p-5">
        {config.areas.map((area) => {
          const Icon = area.icon;
          const count = getCount(area.categoryIds);
          const primaryCategoryId = area.categoryIds[0] || "all";
          return (
            <button
              key={area.id}
              type="button"
              onClick={() => onCategoryClick(primaryCategoryId)}
              className="group flex min-h-64 flex-col rounded-[1.25rem] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_14px_32px_rgba(15,23,42,0.07)]"
            >
              <div className="h-1 w-10 rounded-full bg-blue-500" />
              <div className="flex items-start justify-between gap-3">
                <div className="mt-4 flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700">
                  <Icon className="h-4 w-4" />
                </div>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
                  {count}
                </span>
              </div>

              <div className="mt-4 text-left">
                <h3 className="text-base font-semibold text-slate-950">{area.title}</h3>
                <p className="mt-1 text-xs font-medium text-slate-400">{area.subtitle}</p>
                <p className="mt-3 text-sm leading-6 text-slate-600">{area.description}</p>
              </div>

              <div className="mt-auto pt-5">
                <div className="flex flex-wrap gap-2">
                  {area.categoryIds.map((categoryId) => {
                    const category = categoryMap.get(categoryId);
                    return (
                      <span
                        key={categoryId}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-primary/25 hover:bg-white hover:text-primary hover:shadow-sm"
                      >
                        <span>{category?.label ?? getCategoryLabel(categoryId, isZh)}</span>
                        <span className="text-slate-400">{category?.count ?? 0}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function Skills() {
  /*
   * Skill 库 — Codex layout per
   * ``design_handoff_aria_codex_redesign/direction-codex-part2.jsx:6``.
   *
   * 220px inline sidebar lists every category with its count plus a
   * tiny stats block; the right column groups every skill by category
   * and rows link to ``/skills/item/:id`` for the detail page (which
   * was already on the route table). The practice-line / hero /
   * framework UI from the V0.0.5 version was dropped — the design
   * intentionally flattens the navigation to "pick a category, see
   * skills".
   */
  const { i18n, t } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const navigate = useNavigate();
  const { categories, loading, skills } = useSkillsData(t("skills.categories.all"), isZh);

  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  if (loading) return <SkillsLoading title={t("skills.title")} />;

  // ``categories`` already contains an "all" entry — pull it out for
  // the sidebar top spot and treat the rest as the filter list.
  const allCategory =
    categories.find((cat) => cat.id === "all") ??
    ({ id: "all", label: t("skills.categories.all"), count: skills.length } as SkillCategory);
  const filterCategories = categories.filter((cat) => cat.id !== "all");

  // Group skills by their normalized category key. When the user picks
  // a single category from the sidebar we collapse the grouping to a
  // single section; "all" shows every group.
  const skillsByCategoryKey = new Map<string, SkillSummary[]>();
  for (const skill of skills) {
    const key = getSkillCategoryKey(skill);
    if (!skillsByCategoryKey.has(key)) skillsByCategoryKey.set(key, []);
    skillsByCategoryKey.get(key)!.push(skill);
  }
  const visibleGroups =
    selectedCategory === "all"
      ? filterCategories.map((cat) => ({
          cat,
          items: skillsByCategoryKey.get(cat.id) ?? [],
        }))
      : [
          {
            cat:
              filterCategories.find((c) => c.id === selectedCategory) ??
              ({ id: selectedCategory, label: selectedCategory, count: 0 } as SkillCategory),
            items: skillsByCategoryKey.get(selectedCategory) ?? [],
          },
        ];

  const sidebarLinkStyle = (active: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "7px 10px",
    marginBottom: 1,
    fontSize: 13,
    fontWeight: active ? 500 : 400,
    background: active ? "var(--color-codex-bg-tint)" : "transparent",
    color: active ? "var(--color-codex-ink)" : "var(--color-codex-ink-soft)",
    borderRadius: "var(--codex-r-sm, 3px)",
    cursor: "pointer",
  });

  const sidebarSectionLabelStyle: React.CSSProperties = {
    marginBottom: 10,
    fontSize: 12,
    color: "var(--color-codex-ink-mute)",
  };

  return (
    <>
      <PageTitle title={t("skills.title")} />
      <div
        className="theme-codex flex min-h-full"
        style={{
          background: "var(--color-codex-bg)",
          color: "var(--color-codex-ink)",
        }}
      >
        {/* Sidebar — 220px on desktop, hidden on mobile (the category
            list moves into a horizontal pill row instead). */}
        <aside
          className="hidden flex-shrink-0 lg:block"
          style={{
            width: 220,
            padding: "28px 18px 28px 40px",
            borderRight: "1px solid var(--color-codex-line)",
          }}
        >
          <div style={sidebarSectionLabelStyle}>{isZh ? "分类" : "Categories"}</div>
          <button
            type="button"
            className="row-hov cx-no-hover w-full text-left"
            style={sidebarLinkStyle(selectedCategory === "all")}
            onClick={() => setSelectedCategory("all")}
          >
            <span>{allCategory.label}</span>
            <span
              className="font-mono"
              style={{
                fontSize: 11.5,
                color:
                  selectedCategory === "all"
                    ? "var(--color-codex-accent)"
                    : "var(--color-codex-ink-faint)",
              }}
            >
              {allCategory.count}
            </span>
          </button>
          {filterCategories.map((cat) => {
            const active = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                className="row-hov cx-no-hover w-full text-left"
                style={sidebarLinkStyle(active)}
                onClick={() => setSelectedCategory(cat.id)}
              >
                <span>{cat.label}</span>
                <span
                  className="font-mono"
                  style={{
                    fontSize: 11.5,
                    color: active
                      ? "var(--color-codex-accent)"
                      : "var(--color-codex-ink-faint)",
                  }}
                >
                  {cat.count}
                </span>
              </button>
            );
          })}

          <div style={{ ...sidebarSectionLabelStyle, margin: "26px 0 8px" }}>
            {isZh ? "统计" : "Stats"}
          </div>
          <div
            style={{
              padding: "4px 10px",
              fontSize: 12.5,
              color: "var(--color-codex-ink-soft)",
              lineHeight: 1.9,
            }}
          >
            <div className="flex justify-between">
              <span>{isZh ? "总数" : "Total"}</span>
              <span className="font-mono" style={{ color: "var(--color-codex-ink)" }}>
                {skills.length}
              </span>
            </div>
            <div className="flex justify-between">
              <span>{isZh ? "分类数" : "Categories"}</span>
              <span className="font-mono" style={{ color: "var(--color-codex-ink)" }}>
                {filterCategories.length}
              </span>
            </div>
          </div>
        </aside>

        {/* Mobile/tablet category pill row */}
        <nav
          className="flex gap-1 overflow-x-auto px-4 py-3 lg:hidden"
          style={{ borderBottom: "1px solid var(--color-codex-line)" }}
        >
          {[allCategory, ...filterCategories].map((cat) => {
            const active = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                className="row-hov cx-no-hover flex-shrink-0"
                style={{
                  padding: "6px 12px",
                  fontSize: 13,
                  fontWeight: active ? 500 : 400,
                  background: active ? "var(--color-codex-bg-tint)" : "transparent",
                  color: active ? "var(--color-codex-ink)" : "var(--color-codex-ink-soft)",
                  borderRadius: "var(--codex-r-sm, 3px)",
                  whiteSpace: "nowrap",
                }}
                onClick={() => setSelectedCategory(cat.id)}
              >
                {cat.label}{" "}
                <span
                  className="font-mono"
                  style={{ marginLeft: 6, color: "var(--color-codex-ink-faint)" }}
                >
                  {cat.count}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Main column */}
        <div className="min-w-0 flex-1 overflow-auto" style={{ padding: "32px 56px 40px" }}>
          <header
            className="flex flex-wrap items-end justify-between"
            style={{ marginBottom: 28, gap: 24 }}
          >
            <div className="min-w-0">
              <h1
                style={{
                  margin: 0,
                  fontSize: 28,
                  fontWeight: 500,
                  color: "var(--color-codex-ink)",
                  letterSpacing: "-0.02em",
                }}
              >
                {isZh ? "Skill 库" : "Skill Library"}
              </h1>
              <p
                style={{
                  margin: "8px 0 0",
                  maxWidth: 540,
                  fontSize: 13.5,
                  color: "var(--color-codex-ink-mute)",
                  lineHeight: 1.6,
                }}
              >
                {isZh
                  ? `把重复的工作沉淀成可调用的模板。共 ${skills.length} 个 Skill，分 ${filterCategories.length} 个分类。`
                  : `Recurring work, captured as reusable templates. ${skills.length} skills across ${filterCategories.length} categories.`}
              </p>
            </div>
          </header>

          {visibleGroups.map(({ cat, items }) => (
            <section key={cat.id} style={{ marginBottom: 28 }}>
              <div
                className="flex items-baseline justify-between"
                style={{ marginBottom: 14 }}
              >
                <h3
                  style={{
                    margin: 0,
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--color-codex-ink-mute)",
                    letterSpacing: "0.01em",
                  }}
                >
                  {cat.label}
                </h3>
                <span
                  className="font-mono"
                  style={{ fontSize: 11.5, color: "var(--color-codex-ink-faint)" }}
                >
                  {items.length} {isZh ? "项" : "items"}
                </span>
              </div>

              {items.length === 0 ? (
                <div
                  style={{
                    padding: "16px 8px",
                    fontSize: 13,
                    color: "var(--color-codex-ink-mute)",
                  }}
                >
                  {isZh ? "这个分类暂时还没有 Skill。" : "No skills in this category yet."}
                </div>
              ) : (
                items.map((skill, i) => (
                  <button
                    key={skill.id}
                    type="button"
                    onClick={() => navigate(`/skills/item/${skill.id}`)}
                    className="codex-row-hov grid w-full items-center text-left"
                    style={{
                      gridTemplateColumns: "1fr 90px 80px 14px",
                      columnGap: 16,
                      padding: "14px 8px",
                      borderBottom:
                        i === items.length - 1
                          ? "none"
                          : "1px solid var(--color-codex-line-soft)",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 500,
                          color: "var(--color-codex-ink)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {skill.name}
                      </div>
                      <div
                        className="line-clamp-2"
                        style={{
                          marginTop: 3,
                          fontSize: 12.5,
                          lineHeight: 1.55,
                          color: "var(--color-codex-ink-mute)",
                        }}
                      >
                        {skill.description}
                      </div>
                    </div>
                    <span
                      style={{
                        padding: "2px 8px",
                        fontSize: 10.5,
                        fontFamily:
                          "var(--font-mono, ui-monospace, monospace)",
                        background: "var(--color-codex-bg-tint)",
                        color: "var(--color-codex-ink-soft)",
                        borderRadius: "var(--codex-r-pill, 999px)",
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        textAlign: "center",
                      }}
                    >
                      {cat.label}
                    </span>
                    <span
                      className="font-mono"
                      style={{
                        fontSize: 12,
                        color: "var(--color-codex-ink-mute)",
                      }}
                    >
                      {skill.estimated_time || "—"}
                    </span>
                    <ArrowRight
                      className="h-3 w-3"
                      aria-hidden="true"
                      style={{ color: "var(--color-codex-ink-faint)" }}
                    />
                  </button>
                ))
              )}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}

export function SkillCategoryPage() {
  const { categoryId } = useParams();
  const { i18n, t } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const navigate = useNavigate();
  const launchSource = useLaunchSource();
  const { categories, loading, skills } = useSkillsData(t("skills.categories.all"), isZh);
  const [search, setSearch] = useState("");
  const [activeType, setActiveType] = useState<SkillTypeFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const activeCategory = safeDecode(categoryId);
  const requestedPracticeLine = launchSource.searchParams.get("line");
  const activePracticeLineId = isPracticeLineId(requestedPracticeLine) ? requestedPracticeLine : null;
  const activePracticeLineMeta = activePracticeLineId ? getPracticeLineMeta(activePracticeLineId) : null;

  const lineSkillCount = useMemo(() => {
    if (!activePracticeLineId) return skills.length;
    return skills.filter((skill) => {
      const categoryKey = getSkillCategoryKey(skill);
      return (getPracticeLineId(categoryKey) || "general") === activePracticeLineId;
    }).length;
  }, [activePracticeLineId, skills]);

  const visibleCategories = useMemo(() => {
    if (!activePracticeLineId) return categories;
    const scoped = categories.filter((category) => {
      if (category.id === "all") return false;
      return (getPracticeLineId(category.id) || "general") === activePracticeLineId;
    });
    return [{ id: "all", label: isZh ? "全部" : "All", count: lineSkillCount }, ...scoped];
  }, [activePracticeLineId, categories, isZh, lineSkillCount]);

  const activeCategoryInfo = useMemo(() => {
    const activeKey = activeCategory === "all" ? "all" : getCategoryKey(activeCategory);
    return visibleCategories.find((category) => category.id === activeKey) ?? visibleCategories[0];
  }, [activeCategory, visibleCategories]);

  const filteredSkills = useMemo(() => {
    return skills.filter((skill) => {
      const categoryKey = getSkillCategoryKey(skill);
      const matchesLine =
        !activePracticeLineId || (getPracticeLineId(categoryKey) || "general") === activePracticeLineId;
      const normalizedSearch = search.trim().toLowerCase();
      const matchesSearch =
        !normalizedSearch ||
        skill.name.toLowerCase().includes(normalizedSearch) ||
        skill.description.toLowerCase().includes(normalizedSearch) ||
        skill.category.toLowerCase().includes(normalizedSearch);
      const matchesCategory =
        activeCategoryInfo?.id === "all" || categoryKey === activeCategoryInfo?.id;
      const minutes = extractMinutes(skill.estimated_time);
      const isQuick = minutes <= 10;
      const matchesType =
        activeType === "all" ||
        (activeType === "quick" && isQuick) ||
        (activeType === "deep" && !isQuick);

      return matchesLine && matchesSearch && matchesCategory && matchesType;
    });
  }, [activeCategoryInfo, activePracticeLineId, activeType, search, skills]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeCategoryInfo?.id, activePracticeLineId, activeType, search]);

  const totalPages = Math.max(1, Math.ceil(filteredSkills.length / SKILLS_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedSkills = filteredSkills.slice(
    (safeCurrentPage - 1) * SKILLS_PAGE_SIZE,
    safeCurrentPage * SKILLS_PAGE_SIZE,
  );
  const isLineLandingPage = activeCategoryInfo?.id === "all";
  const showLineFramework = Boolean(activePracticeLineId && isLineLandingPage && !search.trim() && activeType === "all");
  const CategoryIcon = activePracticeLineMeta?.icon || (activeCategoryInfo?.id === "all" ? Layers3 : getCategoryIcon(activeCategoryInfo?.id || "all"));
  const pageLabel = activePracticeLineMeta && isLineLandingPage
    ? (isZh ? activePracticeLineMeta.title.zh : activePracticeLineMeta.title.en)
    : activeCategoryInfo?.label || t("skills.title");
  const pageDescription = activePracticeLineMeta && isLineLandingPage
    ? (isZh ? activePracticeLineMeta.description.zh : activePracticeLineMeta.description.en)
    : "";

  if (loading) return <SkillsLoading title={t("skills.title")} />;

  return (
    <>
      <PageTitle title={pageLabel} />
      <div className="min-h-full bg-slate-50">
        <div className="w-full px-6 py-8 xl:px-8 2xl:px-10">
          <Breadcrumb
            items={[
              { label: isZh ? "首页" : "Home", to: "/" },
              { label: isZh ? "技能" : "Skills", to: buildSkillsPath(launchSource.searchParams) },
              { label: pageLabel },
            ]}
          />

          <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-sm">
                  <CategoryIcon className="h-4 w-4" />
                </div>
                <div>
                  <h1 className="text-2xl font-semibold text-slate-950">{pageLabel}</h1>
                  <p className="mt-1 text-sm text-slate-500">
                    {filteredSkills.length} {isZh ? "个能力" : "skills"}
                    {pageDescription ? <span className="ml-2 text-slate-400">{pageDescription}</span> : null}
                  </p>
                </div>
              </div>
            </div>
            {!showLineFramework ? (
              <div className="flex gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={isZh ? "搜索..." : "Search..."}
                    className="w-48 rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                  />
                </div>
                <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5">
                  {(["all", "quick", "deep"] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setActiveType(type)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                        activeType === type ? "bg-emerald-50 text-emerald-800" : "text-slate-500 hover:text-slate-900"
                      }`}
                    >
                      {type === "all" ? t("skills.types.all") : type === "quick" ? t("skills.types.quick") : t("skills.types.deep")}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {!showLineFramework ? (
            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              {visibleCategories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => navigate(buildCategoryPath(category.id, launchSource.searchParams))}
                  className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                    normalizeCategory(category.id) === normalizeCategory(activeCategoryInfo?.id || "all")
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-slate-200 bg-white text-slate-500 hover:text-slate-900"
                  }`}
                >
                  {category.label}
                  <span className="ml-1 opacity-50">{category.count}</span>
                </button>
              ))}
            </div>
          ) : null}

          <LaunchContextBanners launchSource={launchSource} isZh={isZh} />

          {showLineFramework && activePracticeLineId ? (
            <LineCapabilityFramework
              categories={visibleCategories}
              isZh={isZh}
              lineId={activePracticeLineId}
              onCategoryClick={(catId) => navigate(buildCategoryPath(catId, launchSource.searchParams))}
            />
          ) : filteredSkills.length === 0 ? (
            <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-slate-500">
              <Brain className="mx-auto mb-3 h-8 w-8 text-slate-300" />
              <p className="text-sm">{t("skills.noSkills")}</p>
            </div>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {paginatedSkills.map((skill) => (
                <SkillCard key={skill.id} skill={skill} onUse={() => navigate(buildSkillDetailPath(skill.id, launchSource.searchParams))} />
              ))}
            </div>
          )}

          {!showLineFramework && filteredSkills.length > SKILLS_PAGE_SIZE ? (
            <SkillPagination
              currentPage={safeCurrentPage}
              isZh={isZh}
              onPageChange={setCurrentPage}
              pageSize={SKILLS_PAGE_SIZE}
              totalItems={filteredSkills.length}
              totalPages={totalPages}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}

export function SkillDetailPage() {
  const { skillId } = useParams();
  const { i18n, t } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const navigate = useNavigate();
  const launchSource = useLaunchSource();
  const { error, loading, skill } = useSkillDetail(skillId);

  const toolNames = useMemo(() => parseToolNames(skill?.tools_definition_json), [skill?.tools_definition_json]);
  const inputHints = useMemo(() => buildInputHints(skill, isZh), [isZh, skill]);
  const outputHints = useMemo(() => buildOutputHints(skill, isZh), [isZh, skill]);
  const usageSteps = useMemo(() => buildUsageSteps(skill, isZh), [isZh, skill]);
  const skillCategoryKey = skill ? getSkillCategoryKey(skill) : "other";
  const Icon = skill ? getCategoryIcon(skillCategoryKey) : Brain;
  const tone = skill ? getCategoryTone(skillCategoryKey) : "bg-slate-50 text-slate-700 border-slate-200";

  if (loading) return <SkillsLoading title={t("skills.title")} />;

  if (error || !skill) {
    return (
      <>
        <PageTitle title={isZh ? "能力未找到" : "Skill not found"} />
        <div className="flex min-h-full items-center justify-center bg-slate-50 px-6">
          <div className="max-w-md rounded-[1.75rem] border border-slate-200 bg-white p-8 text-center shadow-sm">
            <Brain className="mx-auto h-10 w-10 text-slate-300" />
            <h1 className="mt-4 text-xl font-semibold text-slate-950">{isZh ? "这个能力暂时不可用" : "This Skill is unavailable"}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {isZh ? "可能已被删除，或者当前链接不正确。可以返回能力分类重新选择。" : "It may have been deleted, or the link is invalid. Go back to the capability map and choose again."}
            </p>
            <button
              type="button"
              onClick={() => navigate(buildSkillsPath(launchSource.searchParams))}
              className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-primary"
            >
              <ArrowLeft className="h-4 w-4" />
              {isZh ? "返回能力分类" : "Back to categories"}
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageTitle title={skill.name} />
      <div className="min-h-full bg-[linear-gradient(180deg,#f8fafc_0%,#f5f8f7_100%)]">
        <div className="w-full px-6 py-8 xl:px-8 2xl:px-10">
          <div className="mb-5">
            <Breadcrumb
              items={[
                { label: isZh ? "首页" : "Home", to: "/" },
                { label: isZh ? "技能" : "Skills", to: buildSkillsPath(launchSource.searchParams) },
                { label: getCategoryLabel(skillCategoryKey, isZh), to: buildCategoryPath(skillCategoryKey, launchSource.searchParams) },
                { label: skill.name },
              ]}
            />
          </div>

          <section className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${tone}`}>
                <Icon className="h-3.5 w-3.5" />
                {getCategoryLabel(skillCategoryKey, isZh)}
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <Clock3 className="h-3.5 w-3.5" />
                {skill.estimated_time || t("skills.timeFallback")}
              </span>
            </div>
            <h1 className="text-2xl font-semibold text-slate-950">{skill.name}</h1>
            <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">{skill.description}</p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => navigate(buildSkillChatPath(skill.id, launchSource.searchParams))}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-primary"
              >
                <MessageSquare className="h-4 w-4" />
                {t("skills.useSkill")}
              </button>
              <button
                type="button"
                onClick={() => navigate(buildCategoryPath(skillCategoryKey, launchSource.searchParams))}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-950"
              >
                <ArrowLeft className="h-4 w-4" />
                {isZh ? "返回分类" : "Back"}
              </button>
            </div>
          </section>

          <LaunchContextBanners launchSource={launchSource} isZh={isZh} />

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-6">
              <section className="rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-base font-semibold text-slate-950">{isZh ? "建议输入" : "Recommended inputs"}</h2>
                <div className="mt-4 space-y-2">
                  {inputHints.map((item, index) => (
                    <div key={item} className="flex gap-3 rounded-xl bg-slate-50 p-3">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">{index + 1}</span>
                      <p className="text-sm leading-6 text-slate-600">{item}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-base font-semibold text-slate-950">{isZh ? "预期输出" : "Expected outputs"}</h2>
                <div className="mt-4 space-y-2">
                  {outputHints.map((item) => (
                    <div key={item} className="flex items-start gap-2 rounded-xl bg-emerald-50/50 p-3">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      <p className="text-sm leading-5 text-slate-600">{item}</p>
                    </div>
                  ))}
                </div>
              </section>

              <PromptPreview
                isZh={isZh}
                systemPrompt={skill.system_prompt}
                userTemplate={skill.user_template}
              />
            </div>

            <aside className="space-y-6">
              <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-base font-semibold text-slate-950">{isZh ? "使用步骤" : "Steps"}</h2>
                <div className="mt-4 space-y-3">
                  {usageSteps.map((step, index) => (
                    <div key={step} className="flex gap-3">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">{index + 1}</span>
                      <p className="text-sm leading-5 text-slate-600">{step}</p>
                    </div>
                  ))}
                </div>
              </div>

              {toolNames.length > 0 && (
                <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
                  <h2 className="text-base font-semibold text-slate-950">{isZh ? "可用工具" : "Tools"}</h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {toolNames.map((tool) => (
                      <span key={tool} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </aside>
          </div>
        </div>
      </div>
    </>
  );
}

function SkillsLoading({ title }: { title: string }) {
  return (
    <>
      <PageTitle title={title} />
      <div className="flex min-h-full items-center justify-center bg-slate-50">
        <Zap className="h-8 w-8 animate-pulse text-primary" />
      </div>
    </>
  );
}

function Breadcrumb({
  items,
}: {
  items: { label: string; to?: string }[];
}) {
  return (
    <nav className="flex items-center gap-1.5 text-sm text-slate-500">
      {items.map((item, index) => (
        <span key={item.label} className="flex items-center gap-1.5">
          {index > 0 && <span className="text-slate-300">/</span>}
          {item.to ? (
            <Link to={item.to} className="transition hover:text-slate-950">{item.label}</Link>
          ) : (
            <span className="text-slate-950 font-medium">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

function LaunchContextBanners({
  isZh,
  launchSource,
}: {
  isZh: boolean;
  launchSource: ReturnType<typeof useLaunchSource>;
}) {
  const navigate = useNavigate();
  const { clientId, clientName, clientProjectId, projectId, projectName } = launchSource;
  const hasProjectSource = Boolean(projectId);
  const hasClientSource = Boolean(clientId && !projectId);
  const clientTargetText = clientProjectId
    ? isZh
      ? "选择后会进入该客户最近关联项目的 Chat 执行，输出可保存为项目文档或笔记。"
      : "After selection, this will open the client's latest related project chat so outputs can be saved as project notes or documents."
    : isZh
      ? "该客户暂无关联项目，将先进入通用 Chat 兜底；建议后续关联项目后再沉淀为项目资产。"
      : "No related project is available, so this falls back to general Chat. Link a project later to persist outputs as project assets.";

  return (
    <>
      {hasProjectSource ? (
        <LaunchSourceBanner
          buttonLabel={isZh ? "返回项目空间" : "Back to project"}
          description={
            isZh
              ? "选择一个 Skill 后，会进入当前项目 Chat，并自动带入项目记忆、文档、待办、财务和客户线索。输出后可保存为项目文档或笔记。"
              : "Choose a Skill to open this project chat with memory, documents, todos, financials, and client signals prefilled. Outputs can be saved as project notes or documents."
          }
          onBack={() => navigate(`/projects/${projectId}`)}
          title={projectName ? (isZh ? `来自项目空间：${projectName}` : `From project: ${projectName}`) : isZh ? "来自项目空间" : "From project workspace"}
          tone="indigo"
        />
      ) : null}

      {hasClientSource ? (
        <LaunchSourceBanner
          buttonLabel={isZh ? "返回客户空间" : "Back to client"}
          description={clientTargetText}
          onBack={() => navigate(`/clients/${clientId}`)}
          title={clientName ? (isZh ? `来自客户空间：${clientName}` : `From client: ${clientName}`) : isZh ? "来自客户空间" : "From client workspace"}
          tone="emerald"
        />
      ) : null}
    </>
  );
}

function LaunchSourceBanner({
  buttonLabel,
  description,
  onBack,
  title,
  tone,
}: {
  buttonLabel: string;
  description: string;
  onBack: () => void;
  title: string;
  tone: "emerald" | "indigo";
}) {
  const toneClass =
    tone === "indigo"
      ? "border-indigo-100 bg-indigo-50 text-indigo-800"
      : "border-emerald-100 bg-emerald-50 text-emerald-800";
  const buttonClass =
    tone === "indigo"
      ? "border-indigo-200 text-indigo-800 hover:bg-indigo-100"
      : "border-emerald-200 text-emerald-800 hover:bg-emerald-100";

  return (
    <div className={`mb-4 rounded-2xl border px-4 py-3 ${toneClass}`}>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-xs leading-5">{description}</p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className={`inline-flex items-center justify-center rounded-xl border bg-white px-3 py-2 text-xs font-medium transition ${buttonClass}`}
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}

function parseToolNames(raw?: string) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((tool) => {
        if (typeof tool === "string") return tool;
        if (tool && typeof tool === "object") {
          const record = tool as Record<string, unknown>;
          return String(record.name || record.tool_name || record.title || "").trim();
        }
        return "";
      })
      .filter(Boolean);
  } catch {
    return raw
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function buildInputHints(skill: Skill | null, isZh: boolean) {
  if (!skill) return [];
  const templateLines = skill.user_template
    .split(/\r?\n/)
    .map((line) => line.replace(/[[\]{}]/g, "").trim())
    .filter((line) => line.length > 0 && line.length < 120)
    .slice(0, 5);

  if (templateLines.length >= 3) return templateLines;

  return isZh
    ? [
        "业务背景：项目、客户、行业或当前要解决的问题。",
        "目标对象：这份输出给谁看，用于决策、汇报还是执行。",
        "已有材料：粘贴关键事实、数据、访谈记录、文档摘要或约束条件。",
        "期望格式：如果你需要表格、清单、PPT 大纲或行动计划，可以提前说明。",
      ]
    : [
        "Business context: project, client, industry, or the problem to solve.",
        "Audience: who will use the output and for what decision or action.",
        "Source material: facts, data, notes, document summaries, or constraints.",
        "Preferred format: table, checklist, slide outline, or action plan.",
      ];
}

function buildOutputHints(skill: Skill | null, isZh: boolean) {
  if (!skill) return [];
  const key = getSkillCategoryKey(skill);
  const common = isZh
    ? ["结构化结论和关键判断", "可直接复制到项目文档或会议材料的内容", "下一步行动建议"]
    : ["Structured conclusions and key judgment", "Content ready to copy into project documents or meeting materials", "Recommended next actions"];
  const byCategory: Record<string, string[]> = {
    market: isZh ? ["客户/市场洞察", "机会优先级与增长抓手"] : ["Customer or market insights", "Opportunity priorities and growth levers"],
    org: isZh ? ["组织/人才问题诊断", "机制设计或变革建议"] : ["Organization or talent diagnosis", "Mechanism design or change recommendations"],
    digital: isZh ? ["数字化场景拆解", "系统、数据、流程或 ROI 建议"] : ["Digital use-case breakdown", "System, data, process, or ROI recommendations"],
    finance: isZh ? ["财务影响判断", "关键假设和测算框架"] : ["Financial impact assessment", "Key assumptions and modeling frame"],
    risk: isZh ? ["风险清单", "缓释措施和责任建议"] : ["Risk register", "Mitigation actions and ownership suggestions"],
    consulting_scoping: isZh ? ["项目简报", "问题陈述和范围边界", "第一周行动计划"] : ["Project brief", "Problem statement and scope boundaries", "Week-one action plan"],
    consulting_delivery: isZh ? ["执行摘要", "客户报告或提案叙事", "结构化交付草稿"] : ["Executive summary", "Client report or proposal storyline", "Structured deliverable draft"],
    consulting_review: isZh ? ["红旗清单", "假设挑战和质量问题", "必须修改的优先级建议"] : ["Red flags", "Assumption challenge and quality issues", "Priority fixes before delivery"],
    consulting_learning: isZh ? ["项目复盘报告", "经验教训和可复用资产", "下次同类项目起点"] : ["Retrospective report", "Lessons and reusable assets", "Starting point for the next similar project"],
    common: isZh ? ["通用任务结构", "提案/交付/复盘/深度分析草稿"] : ["General task structure", "Proposal, delivery, retrospective, or deep-analysis draft"],
  };
  return [...(byCategory[key] || []), ...common].slice(0, 5);
}

function buildUsageSteps(skill: Skill | null, isZh: boolean) {
  if (!skill) return [];
  return isZh
    ? [
        "先阅读建议输入，准备项目背景、目标受众和关键材料。",
        "点击“使用 Skill”进入 Chat，系统会自动带入该能力的专业提示词。",
        "如果从项目或客户空间进入，Chat 会同步带入对应上下文。",
        "生成后可以继续追问、细化，也可以沉淀为项目笔记或文档。",
      ]
    : [
        "Review the recommended inputs and prepare context, audience, and source material.",
        "Click Use Skill to open Chat with this Skill's expert prompt applied.",
        "If launched from a project or client workspace, related context is carried over.",
        "Refine the result in chat, then save it as a project note or document when useful.",
      ];
}

function PromptPreview({
  isZh,
  systemPrompt,
  userTemplate,
}: {
  isZh: boolean;
  systemPrompt: string;
  userTemplate: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasPrompt = Boolean(systemPrompt || userTemplate);

  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-slate-50 p-3 text-slate-700 ring-1 ring-slate-200">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">{isZh ? "提示词与输入模板" : "Prompt and input template"}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {isZh ? "用于说明该能力背后的执行方式，默认折叠，避免页面过重。" : "Explains how the Skill runs. Collapsed by default to keep the page light."}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:text-slate-950"
        >
          {expanded ? (isZh ? "收起" : "Collapse") : isZh ? "展开查看" : "Expand"}
        </button>
      </div>

      {expanded ? (
        hasPrompt ? (
          <div className="mt-5 space-y-4">
            <PromptBlock title={isZh ? "系统提示词" : "System prompt"} content={systemPrompt || (isZh ? "暂无" : "Not configured")} />
            <PromptBlock title={isZh ? "用户输入模板" : "User template"} content={userTemplate || (isZh ? "暂无" : "Not configured")} />
          </div>
        ) : (
          <p className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">{isZh ? "这个 Skill 暂未配置提示词模板。" : "No prompt template is configured for this Skill yet."}</p>
        )
      ) : null}
    </section>
  );
}

function PromptBlock({ content, title }: { content: string; title: string }) {
  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-slate-700">{title}</div>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-2xl border border-slate-200 bg-slate-950 p-4 text-xs leading-6 text-slate-100">
        {content}
      </pre>
    </div>
  );
}

function SkillPagination({
  currentPage,
  isZh,
  onPageChange,
  pageSize,
  totalItems,
  totalPages,
}: {
  currentPage: number;
  isZh: boolean;
  onPageChange: (page: number) => void;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}) {
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);
  const visiblePages = buildVisiblePages(currentPage, totalPages);

  return (
    <div className="mt-6 flex flex-col gap-3 rounded-[1.5rem] border border-slate-200 bg-white/90 p-4 shadow-sm md:flex-row md:items-center md:justify-between">
      <div className="text-sm text-slate-500">
        {isZh
          ? `显示 ${start}-${end}，共 ${totalItems} 个 Skill`
          : `Showing ${start}-${end} of ${totalItems} Skills`}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {isZh ? "上一页" : "Previous"}
        </button>
        {visiblePages.map((page) => (
          <button
            key={page}
            type="button"
            onClick={() => onPageChange(page)}
            className={`h-9 min-w-9 rounded-xl border px-3 text-sm font-semibold transition ${
              page === currentPage
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-slate-200 bg-white text-slate-600 hover:text-slate-950"
            }`}
          >
            {page}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage >= totalPages}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {isZh ? "下一页" : "Next"}
        </button>
      </div>
    </div>
  );
}

function buildVisiblePages(currentPage: number, totalPages: number) {
  const pages = new Set<number>();
  pages.add(1);
  pages.add(totalPages);
  for (let page = currentPage - 1; page <= currentPage + 1; page += 1) {
    if (page >= 1 && page <= totalPages) pages.add(page);
  }
  return Array.from(pages).sort((a, b) => a - b);
}

function SkillCard({
  skill,
  onUse,
}: {
  skill: SkillSummary;
  onUse: () => void;
}) {
  const { t } = useTranslation();
  const isQuick = extractMinutes(skill.estimated_time) <= 10;

  return (
    <button
      type="button"
      onClick={onUse}
      className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-emerald-300 hover:shadow-sm"
    >
      <h4 className="text-sm font-semibold text-slate-900">{skill.name}</h4>
      <p className="mt-1.5 flex-1 line-clamp-2 text-xs leading-5 text-slate-500">{skill.description}</p>
      <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
        <Clock3 className="h-3.5 w-3.5" />
        <span>{skill.estimated_time || t("skills.timeFallback")}</span>
        {isQuick && <span className="text-emerald-600">· {t("skills.types.quick")}</span>}
      </div>
    </button>
  );
}
