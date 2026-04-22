import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Brain,
  Briefcase,
  CheckCircle2,
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
import type { SkillSummary } from "../../types/api";

type SkillTypeFilter = "all" | "quick" | "deep";

type SkillCategory = {
  id: string;
  label: string;
  count: number;
};

const extractMinutes = (estimatedTime?: string) => {
  if (!estimatedTime) return 0;
  const match = estimatedTime.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
};

const normalizeCategory = (value: string) => value.replace(/\?/g, "").trim();

const getCategoryKey = (category: string) => {
  const normalized = normalizeCategory(category).toLowerCase();
  if (normalized.includes("strategy") || normalized.includes("战略")) return "strategy";
  if (normalized.includes("market") || normalized.includes("customer") || normalized.includes("市场") || normalized.includes("客户")) return "market";
  if (normalized.includes("finance") || normalized.includes("财务")) return "finance";
  if (normalized.includes("risk") || normalized.includes("compliance") || normalized.includes("风险") || normalized.includes("合规")) return "risk";
  if (normalized.includes("digital") || normalized.includes("technology") || normalized.includes("数字化") || normalized.includes("技术")) return "digital";
  if (normalized.includes("proposal") || normalized.includes("delivery") || normalized.includes("提案") || normalized.includes("交付")) return "proposals";
  if (normalized.includes("operation") || normalized.includes("efficiency") || normalized.includes("运营") || normalized.includes("效能")) return "operations";
  if (normalized.includes("org") || normalized.includes("talent") || normalized.includes("组织") || normalized.includes("人才")) return "org";
  if (normalized.includes("m&a") || normalized.includes("transactions") || normalized.includes("并购") || normalized.includes("交易")) return "manda";
  if (normalized.includes("data") || normalized.includes("数据")) return "data";
  return "other";
};

const categoryOrder = ["all", "market", "org", "digital", "strategy", "operations", "finance", "risk", "proposals", "manda", "data", "other"];

const getCategoryIcon = (category: string) => {
  const key = getCategoryKey(category);
  if (key === "strategy") return TrendingUp;
  if (key === "market") return Target;
  if (key === "finance") return DollarSign;
  if (key === "risk") return Shield;
  if (key === "digital") return Cpu;
  if (key === "proposals") return FileText;
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
  if (key === "proposals") return "bg-indigo-50 text-indigo-700 border-indigo-100";
  return "bg-slate-50 text-slate-700 border-slate-200";
};

const getCategoryGradient = (category: string) => {
  const key = getCategoryKey(category);
  if (key === "market") return "from-emerald-50 via-teal-50 to-sky-50";
  if (key === "org") return "from-orange-50 via-amber-50 to-rose-50";
  if (key === "digital") return "from-cyan-50 via-blue-50 to-indigo-50";
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
    proposals: {
      zh: "提案、交付审查、项目启动和项目复盘。",
      en: "Proposals, delivery review, project kickoff, and retrospectives.",
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

const buildCategories = (skills: SkillSummary[], allLabel: string) => {
  const categoryMap = new Map<string, SkillCategory>();
  skills.forEach((skill) => {
    const id = normalizeCategory(skill.category);
    const current = categoryMap.get(id);
    categoryMap.set(id, {
      id,
      label: skill.category,
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

function useSkillsData(allLabel: string) {
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

  const categories = useMemo(() => buildCategories(skills, allLabel), [allLabel, skills]);

  return { categories, loading, skills };
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
  const { categories, loading, skills } = useSkillsData(t("skills.categories.all"));
  const [categorySearch, setCategorySearch] = useState("");

  const visibleCategories = useMemo(() => {
    const keyword = categorySearch.trim().toLowerCase();
    if (!keyword) return categories;
    return categories.filter((category) => {
      const description = getCategoryDescription(category.id, isZh).toLowerCase();
      return category.label.toLowerCase().includes(keyword) || description.includes(keyword);
    });
  }, [categories, categorySearch, isZh]);

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

          <section className="mt-6 rounded-[1.75rem] border border-white/80 bg-white/85 p-5 shadow-sm backdrop-blur">
            <LaunchContextBanners launchSource={launchSource} isZh={isZh} />

            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">{isZh ? "能力分类" : "Capability categories"}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {isZh ? "点击任意分类进入详情页，在里面查看并启动具体能力。" : "Click any category to view and launch its specific Skills."}
                </p>
              </div>
              <div className="relative w-full md:max-w-sm">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={categorySearch}
                  onChange={(event) => setCategorySearch(event.target.value)}
                  placeholder={isZh ? "搜索能力分类" : "Search categories"}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm text-slate-700 outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-2 focus:ring-emerald-100"
                />
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visibleCategories.map((category, index) => (
                <CategoryShowcaseCard
                  key={category.id}
                  category={category}
                  index={index}
                  isZh={isZh}
                  onClick={() => navigate(buildCategoryPath(category.id, launchSource.searchParams))}
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
  const { categories, loading, skills } = useSkillsData(t("skills.categories.all"));
  const [search, setSearch] = useState("");
  const [activeType, setActiveType] = useState<SkillTypeFilter>("all");
  const activeCategory = safeDecode(categoryId);

  const activeCategoryInfo = useMemo(() => {
    return categories.find((category) => normalizeCategory(category.id) === normalizeCategory(activeCategory)) ?? categories[0];
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
        activeCategoryInfo?.id === "all" || normalizeCategory(skill.category) === normalizeCategory(activeCategoryInfo?.id || "all");
      const minutes = extractMinutes(skill.estimated_time);
      const isQuick = minutes <= 10;
      const matchesType =
        activeType === "all" ||
        (activeType === "quick" && isQuick) ||
        (activeType === "deep" && !isQuick);

      return matchesSearch && matchesCategory && matchesType;
    });
  }, [activeCategoryInfo, activeType, search, skills]);

  const featuredSkills = filteredSkills.slice(0, 2);
  const regularSkills = filteredSkills.slice(2);
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
            <>
              <section className="mt-8 grid gap-6 lg:grid-cols-2">
                {featuredSkills.map((skill) => (
                  <FeaturedSkillCard key={skill.id} skill={skill} onUse={() => navigate(buildSkillChatPath(skill.id, launchSource.searchParams))} />
                ))}
              </section>

              <section className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
                {regularSkills.map((skill) => (
                  <SkillCard key={skill.id} skill={skill} onUse={() => navigate(buildSkillChatPath(skill.id, launchSource.searchParams))} />
                ))}
              </section>
            </>
          )}
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

function CategoryShowcaseCard({
  category,
  index,
  isZh,
  onClick,
}: {
  category: SkillCategory;
  index: number;
  isZh: boolean;
  onClick: () => void;
}) {
  const Icon = category.id === "all" ? Layers3 : getCategoryIcon(category.id);
  const isHero = index > 0 && index <= 3;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative overflow-hidden rounded-[1.75rem] border p-5 text-left transition hover:-translate-y-1 hover:shadow-[0_20px_48px_rgba(15,23,42,0.08)] ${
        isHero ? "border-slate-200 bg-white text-slate-950" : "border-slate-200 bg-white text-slate-950"
      }`}
    >
      {isHero ? <div className={`absolute inset-0 bg-gradient-to-br ${getCategoryGradient(category.id)} opacity-70`} /> : null}
      <div className="absolute -right-10 -top-12 h-32 w-32 rounded-full bg-white/70 blur-2xl" />
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div className={`flex h-14 w-14 items-center justify-center rounded-2xl border ${getCategoryTone(category.id)}`}>
            <Icon className="h-6 w-6" />
          </div>
          <div className="rounded-full bg-white/75 px-3 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
            {category.count} Skills
          </div>
        </div>
        <h3 className="mt-6 text-xl font-semibold">{category.label}</h3>
        <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-500">
          {getCategoryDescription(category.id, isZh)}
        </p>
        <div className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
          {isZh ? "进入分类" : "Open category"}
          <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
        </div>
      </div>
    </button>
  );
}

function FeaturedSkillCard({
  skill,
  onUse,
}: {
  skill: SkillSummary;
  onUse: () => void;
}) {
  const { t } = useTranslation();
  const Icon = getCategoryIcon(skill.category);
  const tone = getCategoryTone(skill.category);
  const isQuick = extractMinutes(skill.estimated_time) <= 10;

  return (
    <div className="group overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
      <div className="flex items-start justify-between gap-4">
        <div className={`flex h-14 w-14 items-center justify-center rounded-2xl border ${tone}`}>
          <Icon className="h-6 w-6" />
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-medium ${tone}`}>{skill.category}</span>
      </div>

      <h3 className="mt-5 text-xl font-semibold text-slate-900 transition-colors group-hover:text-primary">{skill.name}</h3>
      <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">{skill.description}</p>

      <div className="mt-6 flex items-center gap-3 text-sm text-slate-500">
        <span className={`rounded-full px-3 py-1 ${isQuick ? "bg-emerald-50 text-emerald-700" : "bg-primary/10 text-primary"}`}>
          {isQuick ? t("skills.types.quick") : t("skills.types.deep")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock3 className="h-4 w-4" />
          {skill.estimated_time || t("skills.timeFallback")}
        </span>
      </div>

      <button
        type="button"
        onClick={onUse}
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-primary"
      >
        <MessageSquare className="h-4 w-4" />
        <span>{t("skills.useSkill")}</span>
        <ArrowRight className="h-4 w-4" />
      </button>
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
  const { t } = useTranslation();
  const Icon = getCategoryIcon(skill.category);
  const tone = getCategoryTone(skill.category);
  const isQuick = extractMinutes(skill.estimated_time) <= 10;

  return (
    <div className="flex h-full flex-col rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(15,23,42,0.06)]">
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl border ${tone}`}>
          <Icon className="h-5 w-5" />
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${tone}`}>{skill.category}</span>
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
        <MessageSquare className="h-4 w-4" />
        <span>{t("skills.useSkill")}</span>
      </button>
    </div>
  );
}
