import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpen,
  Brain,
  Briefcase,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Compass,
  Cpu,
  DollarSign,
  FileText,
  Layers3,
  MessageSquare,
  Search,
  Shield,
  Sparkles,
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

type ServiceLine = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  categories: SkillCategory[];
  count: number;
  tone: string;
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
  return "other";
};

const categoryOrder = ["all", "market", "org", "digital", "common", "strategy", "operations", "finance", "risk", "manda", "data", "other"];

const getCategoryIcon = (category: string) => {
  const key = getCategoryKey(category);
  if (key === "strategy") return TrendingUp;
  if (key === "market") return Target;
  if (key === "finance") return DollarSign;
  if (key === "risk") return Shield;
  if (key === "digital") return Cpu;
  if (key === "common") return FileText;
  if (key === "operations") return Briefcase;
  if (key === "org") return Users;
  if (key === "manda") return BarChart3;
  if (key === "data") return BarChart3;
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
  if (key === "common") return "bg-indigo-50 text-indigo-700 border-indigo-100";
  return "bg-slate-50 text-slate-700 border-slate-200";
};

const getCategoryGradient = (category: string) => {
  const key = getCategoryKey(category);
  if (key === "market") return "from-emerald-50 via-teal-50 to-sky-50";
  if (key === "org") return "from-orange-50 via-amber-50 to-rose-50";
  if (key === "digital") return "from-cyan-50 via-blue-50 to-indigo-50";
  if (key === "common") return "from-indigo-50 via-slate-50 to-emerald-50";
  if (key === "strategy") return "from-blue-50 via-indigo-50 to-violet-50";
  if (key === "finance") return "from-amber-50 via-orange-50 to-yellow-50";
  if (key === "risk") return "from-rose-50 via-red-50 to-orange-50";
  return "from-slate-50 via-white to-slate-100";
};

const getCategoryDescription = (category: string, isZh: boolean) => {
  const key = getCategoryKey(category);
  const descriptions: Record<string, { zh: string; en: string }> = {
    all: {
      zh: "浏览全部能力，适合还不确定从哪个咨询场景开始。",
      en: "Browse every capability when you are still choosing the right consulting angle.",
    },
    market: {
      zh: "客户洞察、市场进入、GTM、画像与增长策略。",
      en: "Customer insight, market entry, GTM, personas, and growth strategy.",
    },
    org: {
      zh: "组织设计、人才机制、OKR、变革管理与协同效率。",
      en: "Organization design, talent systems, OKRs, change, and collaboration.",
    },
    digital: {
      zh: "数字化战略、AI 场景、架构、数据治理、流程与 ROI。",
      en: "Digital strategy, AI use cases, architecture, data governance, process, and ROI.",
    },
    strategy: {
      zh: "战略判断、增长机会、竞争分析与业务组合设计。",
      en: "Strategic choices, growth opportunities, competition, and portfolio design.",
    },
    operations: {
      zh: "运营诊断、根因分析、效率提升与流程优化。",
      en: "Operational diagnosis, root causes, efficiency, and process improvement.",
    },
    finance: {
      zh: "财务诊断、商业案例、投资测算与决策支持。",
      en: "Financial diagnostics, business cases, investment modeling, and decisions.",
    },
    risk: {
      zh: "风险识别、合规差距、控制机制与审查清单。",
      en: "Risk discovery, compliance gaps, controls, and review checklists.",
    },
    common: {
      zh: "通用任务、提案交付、项目复盘、深度分析和跨场景工作流。",
      en: "General tasks, proposal delivery, retrospectives, deep analysis, and cross-scenario workflows.",
    },
    manda: {
      zh: "并购、交易、尽调和整合规划。",
      en: "M&A, transactions, due diligence, and integration planning.",
    },
    data: {
      zh: "数据分析、指标体系、看板设计和洞察交付。",
      en: "Analytics, KPI systems, dashboard design, and insight delivery.",
    },
    other: {
      zh: "其他可复用的专业能力。",
      en: "Other reusable expert capabilities.",
    },
  };
  return isZh ? descriptions[key]?.zh || descriptions.other.zh : descriptions[key]?.en || descriptions.other.en;
};

const getCategoryLabel = (category: string, isZh: boolean) => {
  const key = getCategoryKey(category);
  const labels: Record<string, { zh: string; en: string }> = {
    all: { zh: "全部能力", en: "All capabilities" },
    market: { zh: "市场与客户", en: "Market & Customers" },
    org: { zh: "组织与人才", en: "Organization & Talent" },
    digital: { zh: "数字化与技术", en: "Digital & Technology" },
    common: { zh: "通用能力", en: "General Capabilities" },
    strategy: { zh: "战略与增长", en: "Strategy & Growth" },
    operations: { zh: "运营与效能", en: "Operations & Efficiency" },
    finance: { zh: "财务咨询", en: "Finance" },
    risk: { zh: "风险与合规", en: "Risk & Compliance" },
    manda: { zh: "并购与交易", en: "M&A & Transactions" },
    data: { zh: "数据与洞察", en: "Data & Insights" },
    other: { zh: "其他能力", en: "Other Capabilities" },
  };
  return isZh ? labels[key]?.zh || labels.other.zh : labels[key]?.en || labels.other.en;
};

const buildServiceLines = (categories: SkillCategory[], isZh: boolean): ServiceLine[] => {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter(Boolean) as SkillCategory[];
  const makeLine = (
    id: string,
    title: string,
    subtitle: string,
    description: string,
    categoryIds: string[],
    tone: string,
  ) => {
    const lineCategories = pick(categoryIds);
    return {
      id,
      title,
      subtitle,
      description,
      categories: lineCategories,
      count: lineCategories.reduce((sum, category) => sum + category.count, 0),
      tone,
    };
  };

  return [
    makeLine(
      "strategy-analytics",
      isZh ? "战略、分析与交易" : "Strategy, Analytics & Transactions",
      isZh ? "从增长判断到交易决策" : "From growth choices to transaction decisions",
      isZh ? "覆盖战略增长、数据洞察、并购交易等高层决策型能力。" : "Covers executive decision capabilities across strategy, analytics, and transactions.",
      ["strategy", "data", "manda"],
      "from-blue-50 via-indigo-50 to-slate-50",
    ),
    makeLine(
      "customer-marketing",
      isZh ? "客户与市场" : "Customer & Marketing",
      isZh ? "从客户洞察到增长体验" : "From customer insight to growth experience",
      isZh ? "围绕客户、市场、增长、体验和商业化场景组织能力。" : "Organizes customer, market, growth, experience, and commercialization capabilities.",
      ["market"],
      "from-emerald-50 via-teal-50 to-sky-50",
    ),
    makeLine(
      "human-capital",
      isZh ? "组织与人才" : "Human Capital",
      isZh ? "从组织机制到变革落地" : "From organization systems to change adoption",
      isZh ? "面向组织设计、人才机制、协同效率和变革管理。" : "For organization design, talent systems, collaboration, and change management.",
      ["org"],
      "from-orange-50 via-amber-50 to-rose-50",
    ),
    makeLine(
      "enterprise-technology",
      isZh ? "企业技术与绩效" : "Enterprise Technology & Performance",
      isZh ? "从数字化战略到绩效闭环" : "From digital strategy to performance impact",
      isZh ? "连接数字化、技术架构、财务绩效、投资回报和企业能力建设。" : "Connects digital, technology architecture, finance performance, ROI, and enterprise capability building.",
      ["digital", "finance"],
      "from-cyan-50 via-blue-50 to-indigo-50",
    ),
    makeLine(
      "core-operations",
      isZh ? "核心业务运营" : "Core Business Operations",
      isZh ? "从流程效能到交付执行" : "From process effectiveness to delivery execution",
      isZh ? "承接运营、效能、通用任务、提案交付和项目复盘。" : "Supports operations, efficiency, general tasks, proposal delivery, and retrospectives.",
      ["operations", "common"],
      "from-teal-50 via-slate-50 to-emerald-50",
    ),
    makeLine(
      "risk-advisory",
      isZh ? "风险、监管与合规" : "Risk, Regulatory & Compliance",
      isZh ? "从风险识别到控制机制" : "From risk discovery to control design",
      isZh ? "覆盖风险识别、合规差距、控制机制和审查清单。" : "Covers risk discovery, compliance gaps, controls, and review checklists.",
      ["risk"],
      "from-rose-50 via-red-50 to-orange-50",
    ),
  ].filter((line) => line.categories.length > 0);
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

const buildSkillsPath = (searchParams: URLSearchParams) => {
  const params = new URLSearchParams(searchParams);
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
    const id = getCategoryKey(skill.category);
    const current = categoryMap.get(id);
    categoryMap.set(id, {
      id,
      label: getCategoryLabel(skill.category, isZh),
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

export function Skills() {
  const { i18n, t } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const navigate = useNavigate();
  const launchSource = useLaunchSource();
  const { categories, loading, skills } = useSkillsData(t("skills.categories.all"), isZh);
  const serviceLines = useMemo(() => buildServiceLines(categories, isZh), [categories, isZh]);

  if (loading) return <SkillsLoading title={t("skills.title")} />;

  return (
    <>
      <PageTitle title={t("skills.title")} />
      <div className="min-h-full overflow-hidden bg-[radial-gradient(circle_at_top_left,#ecfdf5_0%,transparent_30%),radial-gradient(circle_at_top_right,#eff6ff_0%,transparent_32%),linear-gradient(180deg,#f8fafc_0%,#f7faf9_100%)]">
        <div className="w-full px-6 py-8 xl:px-8 2xl:px-10">
          <section className="relative overflow-hidden rounded-[2.25rem] border border-slate-200/70 bg-white/82 p-8 shadow-[0_22px_70px_rgba(15,23,42,0.07)] backdrop-blur">
            <div className="absolute -right-16 -top-20 h-72 w-72 rounded-full bg-emerald-100/70 blur-3xl" />
            <div className="absolute bottom-0 left-1/3 h-52 w-52 rounded-full bg-sky-100/60 blur-3xl" />
            <div className="relative grid gap-8 xl:grid-cols-[1fr_380px] xl:items-end">
              <div className="max-w-4xl">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/80 px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>{isZh ? "能力分类优先" : "Capability-first browsing"}</span>
                </div>
                <h1 className="text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">
                  {isZh ? "先选方向，再进入具体 Skill" : "Pick the domain, then choose the Skill"}
                </h1>
                <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
                  {isZh
                    ? "市场和客户、组织和人才、数字化转型这些分类才是用户真正理解工作的入口。这里做成能力地图，点击分类直接进入详情页。"
                    : "Market and customers, organization and talent, and digital transformation are the real entry points. Click a category to open its dedicated Skill page."}
                </p>
              </div>

              <div className="rounded-[1.75rem] border border-slate-200 bg-white/85 p-5 text-slate-900 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700">
                    <Compass className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{isZh ? "能力地图" : "Capability map"}</div>
                    <div className="text-xs text-slate-500">
                      {isZh ? `${categories.length - 1} 个分类 · ${skills.length} 个 Skill` : `${categories.length - 1} categories · ${skills.length} skills`}
                    </div>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-2">
                  {categories.slice(1, 4).map((category) => {
                    const Icon = getCategoryIcon(category.id);
                    return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => navigate(buildCategoryPath(category.id, launchSource.searchParams))}
                        className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 text-left transition hover:border-emerald-200 hover:bg-emerald-50/60"
                      >
                        <Icon className="h-4 w-4 text-emerald-600" />
                        <div className="mt-3 truncate text-xs font-semibold">{category.label}</div>
                        <div className="mt-1 text-[11px] text-slate-500">{category.count} Skills</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          <section className="mt-6 rounded-[1.75rem] border border-slate-200 bg-white/88 p-5 shadow-sm backdrop-blur">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">
                  <Layers3 className="h-3.5 w-3.5" />
                  {isZh ? "服务线能力地图" : "Service-line capability map"}
                </div>
                <h2 className="mt-3 text-xl font-semibold text-slate-950">
                  {isZh ? "按专业服务线组织能力，而不是只按标签平铺" : "Organize capabilities by professional service lines, not just tags"}
                </h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
                  {isZh
                    ? "参考大型咨询公司的服务线表达方式，把 Aria Skill 归入更容易理解的能力组合。点击任一能力域即可进入具体 Skill 列表。"
                    : "Inspired by large consulting firms' service-line taxonomy, Aria groups Skills into clearer capability portfolios. Click any capability area to open its Skill list."}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                {isZh ? `${serviceLines.length} 条服务线 · ${skills.length} 个 Skill` : `${serviceLines.length} service lines · ${skills.length} Skills`}
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {serviceLines.map((line, index) => (
                <ServiceLineCard
                  key={line.id}
                  index={index}
                  line={line}
                  onOpenCategory={(categoryId) => navigate(buildCategoryPath(categoryId, launchSource.searchParams))}
                />
              ))}
            </div>
          </section>

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

  const activeCategoryInfo = useMemo(() => {
    const activeKey = activeCategory === "all" ? "all" : getCategoryKey(activeCategory);
    return categories.find((category) => category.id === activeKey) ?? categories[0];
  }, [activeCategory, categories]);

  const filteredSkills = useMemo(() => {
    return skills.filter((skill) => {
      const normalizedSearch = search.trim().toLowerCase();
      const matchesSearch =
        !normalizedSearch ||
        skill.name.toLowerCase().includes(normalizedSearch) ||
        skill.description.toLowerCase().includes(normalizedSearch) ||
        skill.category.toLowerCase().includes(normalizedSearch);
      const matchesCategory =
        activeCategoryInfo?.id === "all" || getCategoryKey(skill.category) === activeCategoryInfo?.id;
      const minutes = extractMinutes(skill.estimated_time);
      const isQuick = minutes <= 10;
      const matchesType =
        activeType === "all" ||
        (activeType === "quick" && isQuick) ||
        (activeType === "deep" && !isQuick);

      return matchesSearch && matchesCategory && matchesType;
    });
  }, [activeCategoryInfo, activeType, search, skills]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeCategoryInfo?.id, activeType, search]);

  const totalPages = Math.max(1, Math.ceil(filteredSkills.length / SKILLS_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedSkills = filteredSkills.slice(
    (safeCurrentPage - 1) * SKILLS_PAGE_SIZE,
    safeCurrentPage * SKILLS_PAGE_SIZE,
  );
  const CategoryIcon = activeCategoryInfo?.id === "all" ? Layers3 : getCategoryIcon(activeCategoryInfo?.id || "all");

  if (loading) return <SkillsLoading title={t("skills.title")} />;

  return (
    <>
      <PageTitle title={activeCategoryInfo?.label || t("skills.title")} />
      <div className="min-h-full bg-[linear-gradient(180deg,#f8fafc_0%,#eef6f3_100%)]">
        <div className="w-full px-6 py-8 xl:px-8 2xl:px-10">
          <button
            type="button"
            onClick={() => navigate(buildSkillsPath(launchSource.searchParams))}
            className="mb-5 inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-950"
          >
            <ArrowLeft className="h-4 w-4" />
            {isZh ? "返回能力分类" : "Back to categories"}
          </button>

          <section className={`relative overflow-hidden rounded-[2rem] border border-slate-200 bg-gradient-to-br ${getCategoryGradient(activeCategoryInfo?.id || "all")} p-8 text-slate-950 shadow-[0_22px_70px_rgba(15,23,42,0.07)]`}>
            <div className="absolute right-0 top-0 h-64 w-64 rounded-full bg-white/70 blur-3xl" />
            <div className="absolute -bottom-20 left-20 h-56 w-56 rounded-full bg-slate-200/35 blur-3xl" />
            <div className="relative grid gap-8 xl:grid-cols-[1fr_360px] xl:items-end">
              <div>
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3 py-1.5 text-xs font-semibold text-slate-700 backdrop-blur">
                  <CategoryIcon className="h-3.5 w-3.5" />
                  <span>{isZh ? "能力详情" : "Capability detail"}</span>
                </div>
                <h1 className="text-4xl font-semibold tracking-tight">{activeCategoryInfo?.label}</h1>
                <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
                  {getCategoryDescription(activeCategoryInfo?.id || "all", isZh)}
                </p>
              </div>

              <div className="rounded-[1.5rem] border border-slate-200 bg-white/70 p-5 backdrop-blur">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{isZh ? "当前分类能力" : "Skills in this category"}</div>
                    <div className="text-3xl font-semibold">{filteredSkills.length}</div>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-500">
                  {isZh ? "可以直接启动能力，也可以切换到其他分类继续浏览。" : "Launch a Skill directly, or switch to another category below."}
                </p>
              </div>
            </div>
          </section>

          <section className="mt-6 rounded-[1.75rem] border border-slate-200 bg-white/90 p-5 shadow-sm backdrop-blur">
            <LaunchContextBanners launchSource={launchSource} isZh={isZh} />

            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {categories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => navigate(buildCategoryPath(category.id, launchSource.searchParams))}
                    className={`shrink-0 rounded-2xl border px-4 py-2.5 text-sm font-medium transition ${
                      normalizeCategory(category.id) === normalizeCategory(activeCategoryInfo?.id || "all")
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-950"
                    }`}
                  >
                    {category.label}
                    <span className="ml-2 opacity-60">{category.count}</span>
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <div className="relative w-full md:w-72">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={isZh ? "搜索本分类 Skill" : "Search this category"}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm text-slate-700 outline-none transition focus:border-primary/30 focus:bg-white focus:ring-2 focus:ring-primary/15"
                  />
                </div>
                <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
                  {(["all", "quick", "deep"] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setActiveType(type)}
                      className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                        activeType === type ? "bg-emerald-50 text-emerald-800 shadow-sm" : "text-slate-600 hover:bg-white hover:text-slate-900"
                      }`}
                    >
                      {type === "all" ? t("skills.types.all") : type === "quick" ? t("skills.types.quick") : t("skills.types.deep")}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {filteredSkills.length === 0 ? (
            <div className="mt-8 rounded-[1.5rem] border border-dashed border-slate-300 bg-white/80 px-6 py-20 text-center text-slate-500">
              <Brain className="mx-auto mb-4 h-10 w-10 text-slate-300" />
              <h3 className="text-lg font-semibold text-slate-700">{t("skills.noSkills")}</h3>
              <p className="mt-2 text-sm">{t("skills.createFirst")}</p>
            </div>
          ) : (
            <section className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
              {paginatedSkills.map((skill) => (
                <SkillCard key={skill.id} skill={skill} onUse={() => navigate(buildSkillDetailPath(skill.id, launchSource.searchParams))} />
              ))}
            </section>
          )}

          {filteredSkills.length > SKILLS_PAGE_SIZE ? (
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
  const Icon = skill ? getCategoryIcon(skill.category) : Brain;
  const tone = skill ? getCategoryTone(skill.category) : "bg-slate-50 text-slate-700 border-slate-200";
  const isQuick = extractMinutes(skill?.estimated_time) <= 10;

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
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => navigate(buildCategoryPath(getCategoryKey(skill.category), launchSource.searchParams))}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-950"
            >
              <ArrowLeft className="h-4 w-4" />
              {isZh ? "返回所属分类" : "Back to category"}
            </button>
            <button
              type="button"
              onClick={() => navigate(buildSkillChatPath(skill.id, launchSource.searchParams))}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-primary"
            >
              <MessageSquare className="h-4 w-4" />
              {t("skills.useSkill")}
            </button>
          </div>

          <section className="relative overflow-hidden rounded-[2rem] border border-slate-200 bg-white/90 p-8 shadow-[0_22px_70px_rgba(15,23,42,0.07)]">
            <div className={`absolute inset-0 bg-gradient-to-br ${getCategoryGradient(skill.category)} opacity-80`} />
            <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-white/70 blur-3xl" />
            <div className="relative grid gap-8 xl:grid-cols-[1fr_360px] xl:items-end">
              <div>
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <span className={`inline-flex items-center gap-2 rounded-full border bg-white/75 px-3 py-1.5 text-xs font-semibold ${tone}`}>
                    <Icon className="h-3.5 w-3.5" />
                    {getCategoryLabel(skill.category, isZh)}
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/75 px-3 py-1.5 text-xs font-semibold text-slate-600">
                    <Clock3 className="h-3.5 w-3.5" />
                    {skill.estimated_time || t("skills.timeFallback")}
                  </span>
                </div>
                <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-slate-950">{skill.name}</h1>
                <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">{skill.description}</p>
              </div>

              <div className="rounded-[1.5rem] border border-slate-200 bg-white/75 p-5 backdrop-blur">
                <div className="text-sm font-semibold text-slate-950">{isZh ? "使用定位" : "Usage profile"}</div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <SkillMetric label={isZh ? "类型" : "Type"} value={isQuick ? t("skills.types.quick") : t("skills.types.deep")} />
                  <SkillMetric label={isZh ? "工具" : "Tools"} value={toolNames.length ? String(toolNames.length) : isZh ? "无" : "None"} />
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-500">
                  {isZh ? "建议先补充足够背景，再启动 Skill；项目或客户入口会自动带入上下文。" : "Add enough context before launching. Project and client entry points automatically carry context into chat."}
                </p>
              </div>
            </div>
          </section>

          <LaunchContextBanners launchSource={launchSource} isZh={isZh} />

          <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_360px]">
            <div className="space-y-6">
              <DetailSection
                icon={BookOpen}
                title={isZh ? "这个能力解决什么问题" : "What this Skill is for"}
                items={[
                  skill.description,
                  getCategoryDescription(skill.category, isZh),
                  isZh ? "适合需要结构化思考、快速形成专业交付草稿的场景。" : "Best for turning messy context into a structured professional draft.",
                ]}
              />

              <DetailSection
                icon={ClipboardList}
                title={isZh ? "建议输入" : "Recommended inputs"}
                items={inputHints}
              />

              <DetailSection
                icon={CheckCircle2}
                title={isZh ? "预期输出" : "Expected outputs"}
                items={outputHints}
              />

              <PromptPreview
                isZh={isZh}
                systemPrompt={skill.system_prompt}
                userTemplate={skill.user_template}
              />
            </div>

            <aside className="space-y-6">
              <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-base font-semibold text-slate-950">{isZh ? "怎么使用" : "How to use"}</h2>
                <div className="mt-4 space-y-3">
                  {usageSteps.map((step, index) => (
                    <div key={step} className="flex gap-3 rounded-2xl bg-slate-50 p-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                        {index + 1}
                      </div>
                      <p className="text-sm leading-6 text-slate-600">{step}</p>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => navigate(buildSkillChatPath(skill.id, launchSource.searchParams))}
                  className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-primary"
                >
                  <MessageSquare className="h-4 w-4" />
                  {t("skills.useSkill")}
                </button>
              </div>

              <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-base font-semibold text-slate-950">{isZh ? "可用工具" : "Available tools"}</h2>
                {toolNames.length ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {toolNames.map((tool) => (
                      <span key={tool} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                        {tool}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-slate-500">
                    {isZh ? "这个 Skill 当前不依赖额外工具，主要通过对话和上下文完成。" : "This Skill does not require extra tools yet; it mainly works through chat and context."}
                  </p>
                )}
              </div>
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
    .map((line) => line.replace(/[\[\]{}]/g, "").trim())
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
  const key = getCategoryKey(skill.category);
  const common = isZh
    ? ["结构化结论和关键判断", "可直接复制到项目文档或会议材料的内容", "下一步行动建议"]
    : ["Structured conclusions and key judgment", "Content ready to copy into project documents or meeting materials", "Recommended next actions"];
  const byCategory: Record<string, string[]> = {
    market: isZh ? ["客户/市场洞察", "机会优先级与增长抓手"] : ["Customer or market insights", "Opportunity priorities and growth levers"],
    org: isZh ? ["组织/人才问题诊断", "机制设计或变革建议"] : ["Organization or talent diagnosis", "Mechanism design or change recommendations"],
    digital: isZh ? ["数字化场景拆解", "系统、数据、流程或 ROI 建议"] : ["Digital use-case breakdown", "System, data, process, or ROI recommendations"],
    finance: isZh ? ["财务影响判断", "关键假设和测算框架"] : ["Financial impact assessment", "Key assumptions and modeling frame"],
    risk: isZh ? ["风险清单", "缓释措施和责任建议"] : ["Risk register", "Mitigation actions and ownership suggestions"],
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

function SkillMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/80 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function DetailSection({
  icon: Icon,
  items,
  title,
}: {
  icon: typeof Brain;
  items: string[];
  title: string;
}) {
  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-slate-50 p-3 text-slate-700 ring-1 ring-slate-200">
          <Icon className="h-5 w-5" />
        </div>
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {items.map((item) => (
          <div key={item} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4 text-sm leading-6 text-slate-600">
            {item}
          </div>
        ))}
      </div>
    </section>
  );
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

function ServiceLineCard({
  index,
  line,
  onOpenCategory,
}: {
  index: number;
  line: ServiceLine;
  onOpenCategory: (categoryId: string) => void;
}) {
  const leadCategory = line.categories[0];
  const Icon = leadCategory ? getCategoryIcon(leadCategory.id) : Brain;

  return (
    <div className={`group relative overflow-hidden rounded-[1.75rem] border border-slate-200 bg-gradient-to-br ${line.tone} p-5 transition hover:-translate-y-0.5 hover:shadow-[0_20px_48px_rgba(15,23,42,0.08)]`}>
      <div className="absolute -right-10 -top-12 h-36 w-36 rounded-full bg-white/70 blur-2xl" />
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/80 bg-white/75 text-slate-700 shadow-sm">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                {String(index + 1).padStart(2, "0")} Portfolio
              </div>
              <h3 className="mt-1 text-lg font-semibold text-slate-950">{line.title}</h3>
            </div>
          </div>
          <div className="rounded-full border border-white/80 bg-white/75 px-3 py-1 text-xs font-semibold text-slate-600">
            {line.count} Skills
          </div>
        </div>

        <p className="mt-3 text-sm font-medium text-slate-700">{line.subtitle}</p>
        <p className="mt-2 min-h-12 text-sm leading-6 text-slate-500">{line.description}</p>

        <div className="mt-5 flex flex-wrap gap-2">
          {line.categories.map((category) => {
            const CategoryIcon = getCategoryIcon(category.id);
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => onOpenCategory(category.id)}
                className="inline-flex items-center gap-2 rounded-full border border-white/90 bg-white/80 px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-950"
              >
                <CategoryIcon className="h-3.5 w-3.5" />
                {category.label}
                <span className="text-slate-400">{category.count}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/70">
          <div
            className="h-full rounded-full bg-slate-900/45 transition-all"
            style={{ width: `${Math.min(100, Math.max(16, line.count * 8))}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function SkillCard({
  skill,
  onUse,
}: {
  skill: SkillSummary;
  onUse: () => void;
}) {
  const { i18n, t } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const Icon = getCategoryIcon(skill.category);
  const tone = getCategoryTone(skill.category);
  const isQuick = extractMinutes(skill.estimated_time) <= 10;
  const categoryLabel = getCategoryLabel(skill.category, isZh);

  return (
    <div className="flex h-full flex-col rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(15,23,42,0.06)]">
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl border ${tone}`}>
          <Icon className="h-5 w-5" />
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${tone}`}>{categoryLabel}</span>
      </div>

      <h4 className="mt-4 text-base font-semibold text-slate-900">{skill.name}</h4>
      <p className="mt-2 flex-1 line-clamp-3 text-sm leading-6 text-slate-600">{skill.description}</p>

      <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 text-sm">
        <span className={`${isQuick ? "text-emerald-700" : "text-primary"} font-medium`}>
          {isQuick ? t("skills.types.quick") : t("skills.types.deep")}
        </span>
        <span className="inline-flex items-center gap-1.5 text-slate-500">
          <Clock3 className="h-4 w-4" />
          {skill.estimated_time || t("skills.timeFallback")}
        </span>
      </div>

      <button
        type="button"
        onClick={onUse}
        className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5 text-sm font-medium text-primary transition hover:bg-primary/10"
      >
        <BookOpen className="h-4 w-4" />
        <span>{isZh ? "查看详情" : "View details"}</span>
      </button>
    </div>
  );
}
