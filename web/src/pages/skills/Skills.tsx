import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Brain,
  Briefcase,
  Calculator,
  CheckCircle2,
  ClipboardList,
  Compass,
  Cpu,
  DollarSign,
  FileText,
  LayoutGrid,
  Loader2,
  MessageSquare,
  Receipt,
  RefreshCw,
  Shield,
  ShieldCheck,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";

import { api } from "../../api/client";
import { CxPagination, CxSkeleton, CxTopProgress } from "../../components/codex";
import { PageTitle } from "../../components/PageTitle";
import type { Skill, SkillSummary } from "../../types/api";

const SKILLS_PAGE_SIZE = 10;

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

function SkillCategoryIcon({ category }: { category: string }) {
  const key = getCategoryKey(category);
  const props = { className: "h-5 w-5", strokeWidth: 1.5 };
  if (key === "strategy") return <TrendingUp {...props} />;
  if (key === "market") return <Target {...props} />;
  if (key === "finance") return <DollarSign {...props} />;
  if (key === "risk") return <Shield {...props} />;
  if (key === "digital") return <Cpu {...props} />;
  if (key.startsWith("consulting_") || key === "common") return <FileText {...props} />;
  if (key === "operations") return <Briefcase {...props} />;
  if (key === "org") return <Users {...props} />;
  if (key === "manda" || key === "data") return <BarChart3 {...props} />;
  if (key === "audit") return <ClipboardList {...props} />;
  if (key === "assurance") return <CheckCircle2 {...props} />;
  if (key === "tax") return <Calculator {...props} />;
  return <Brain {...props} />;
}

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
};

const PRACTICE_LINE_META: Record<string, PracticeLineMeta> = {
  "audit-assurance": {
    id: "audit-assurance",
    title: { zh: "审计鉴证", en: "Audit & Assurance" },
    subtitle: { zh: "Audit & Assurance", en: "Audit & Assurance" },
    description: { zh: "面向审计、鉴证、内控和可持续信息披露的专业能力。", en: "Capabilities for audit, assurance, controls, and sustainability reporting." },
    icon: ShieldCheck,
  },
  tax: {
    id: "tax",
    title: { zh: "税务", en: "Tax" },
    subtitle: { zh: "Tax", en: "Tax" },
    description: { zh: "覆盖企业税、国际税、转让定价、税务合规和筹划优化。", en: "Covers corporate tax, international tax, transfer pricing, compliance, and planning." },
    icon: Receipt,
  },
  consulting: {
    id: "consulting",
    title: { zh: "咨询", en: "Consulting" },
    subtitle: { zh: "Consulting", en: "Consulting" },
    description: { zh: "按咨询业务线组织，覆盖战略、客户、组织、技术、数据和风险。", en: "Organized by consulting practice lines across strategy, customer, people, technology, data, and risk." },
    icon: Compass,
  },
};

const GENERAL_LINE_META: PracticeLineMeta = {
  id: "general",
  title: { zh: "通用能力", en: "General Capabilities" },
  subtitle: { zh: "跨业务线共享的基础服务与工具", en: "Cross-practice foundational services & tools" },
  description: { zh: "适用于提案、交付、复盘、资料整理和跨业务线基础工作。", en: "Reusable capabilities for proposals, delivery, retrospectives, synthesis, and cross-practice work." },
  icon: LayoutGrid,
};

const PRACTICE_LINE_IDS = ["audit-assurance", "tax", "consulting", "general"] as const;
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

const isPracticeLineId = (value: string | null): value is PracticeLineId => {
  return Boolean(value && (PRACTICE_LINE_IDS as readonly string[]).includes(value));
};

const getPracticeLineMeta = (lineId: PracticeLineId): PracticeLineMeta => {
  return lineId === "general" ? GENERAL_LINE_META : PRACTICE_LINE_META[lineId];
};

const buildSkillsPath = (searchParams: URLSearchParams) => {
  const params = new URLSearchParams(searchParams);
  params.delete("line");
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

interface SkillCategoryCount {
  id: string;
  count: number;
}

interface SkillSummaryListResponse {
  items: SkillSummary[];
  total: number;
  limit: number;
  offset: number;
  categories: SkillCategoryCount[];
}

const buildCategoriesFromCounts = (counts: SkillCategoryCount[], allLabel: string, isZh: boolean) => {
  const sorted = counts
    .filter((item) => item.count > 0)
    .map((item) => ({
      id: item.id,
      label: getCategoryLabel(item.id, isZh),
      count: item.count,
    }))
    .sort((a, b) => {
      const aOrder = categoryOrder.indexOf(getCategoryKey(a.id));
      const bOrder = categoryOrder.indexOf(getCategoryKey(b.id));
      const safeAOrder = aOrder === -1 ? categoryOrder.length : aOrder;
      const safeBOrder = bOrder === -1 ? categoryOrder.length : bOrder;
      if (safeAOrder !== safeBOrder) return safeAOrder - safeBOrder;
      return b.count - a.count;
    });
  const total = sorted.reduce((sum, item) => sum + item.count, 0);
  return [{ id: "all", label: allLabel, count: total }, ...sorted];
};

const buildCategoryGroupToken = (categoryIds: string[]) => `cats:${categoryIds.join(",")}`;

const parseCategorySelection = (selection: string) => {
  if (selection.startsWith("cats:")) {
    return selection
      .slice("cats:".length)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (selection.startsWith("cat:")) return [selection.slice("cat:".length)];
  return [];
};

function useSkillsData(
  allLabel: string,
  isZh: boolean,
  categoryKeys: string[],
  page: number,
  pageSize: number,
  onPageOutOfRange: (page: number) => void,
) {
  const [loading, setLoading] = useState(true);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [categoryCounts, setCategoryCounts] = useState<SkillCategoryCount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const hasLoadedRef = useRef(false);
  const requestIdRef = useRef(0);
  const categoryKeyParam = categoryKeys.join(",");

  useEffect(() => {
    const fetchSkills = async () => {
      const requestId = ++requestIdRef.current;
      const isInitialLoad = !hasLoadedRef.current;
      try {
        if (isInitialLoad) {
          setLoading(true);
        } else {
          setListLoading(true);
        }
        setError(null);
        const data = await api.get<SkillSummaryListResponse>("/skills/meta/list", {
          params: {
            category_keys: categoryKeyParam,
            limit: pageSize,
            offset: (page - 1) * pageSize,
          },
        });
        if (requestId !== requestIdRef.current) return;
        const lastPage = Math.max(1, Math.ceil(data.total / pageSize));
        if (page > lastPage) {
          onPageOutOfRange(lastPage);
          return;
        }
        setSkills(data.items);
        setTotal(data.total);
        setCategoryCounts(data.categories);
        hasLoadedRef.current = true;
        setHasLoaded(true);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        console.error("Failed to fetch skills:", err);
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        setError(detail || (err instanceof Error ? err.message : "request failed"));
      } finally {
        if (requestId === requestIdRef.current) {
          if (isInitialLoad) {
            setLoading(false);
          } else {
            setListLoading(false);
          }
        }
      }
    };

    void fetchSkills();
  }, [categoryKeyParam, onPageOutOfRange, page, pageSize, reloadKey]);

  const categories = useMemo(() => buildCategoriesFromCounts(categoryCounts, allLabel, isZh), [allLabel, categoryCounts, isZh]);

  return {
    categories,
    error,
    hasLoaded,
    listLoading,
    loading,
    reload: () => setReloadKey((k) => k + 1),
    skills,
    total,
  };
}

function useSkillDetail(skillId?: string) {
  const id = Number(skillId);
  const validId = Number.isFinite(id) && id > 0;
  const [result, setResult] = useState<{
    id: number;
    skill: Skill | null;
    error: string;
  } | null>(null);

  useEffect(() => {
    if (!validId) return;
    let cancelled = false;
    void api.get<Skill>(`/skills/${id}`)
      .then((skill) => {
        if (!cancelled) setResult({ id, skill, error: "" });
      })
      .catch((fetchError: unknown) => {
        console.error("Failed to fetch skill:", fetchError);
        if (!cancelled) setResult({ id, skill: null, error: "not_found" });
      });
    return () => {
      cancelled = true;
    };
  }, [id, validId]);

  if (!validId) return { error: "invalid", loading: false, skill: null };
  if (!result || result.id !== id) return { error: "", loading: true, skill: null };
  return { error: result.error, loading: false, skill: result.skill };
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
  /*
   * Skill 库 — Codex layout per
   * ``design_handoff_aria_codex_redesign/direction-codex-part2.jsx:6``.
   *
   * 220px inline sidebar; the right column groups every skill by
   * category and rows link to ``/skills/item/:id`` for the detail page.
   *
   * Sidebar is two-level: practice line (审计鉴证 / 税务 / 咨询 /
   * 通用能力) is a mono-uppercase group header, sub-categories sit
   * indented below as the clickable items. Picking a sub-category
   * filters the right pane to that single category; picking a line
   * filters to every sub-category under it.
   */
  const { i18n, t } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const navigate = useNavigate();

  // Selection token. ``all`` shows every line + every sub-category;
  // ``line:<id>`` filters to one practice line; ``cat:<id>`` filters
  // to a single sub-category.
  const [selection, setSelection] = useState<string>("all");
  const [skillPage, setSkillPage] = useState(1);
  const [skillPageSize, setSkillPageSize] = useState(SKILLS_PAGE_SIZE);
  const selectedCategoryKeys = useMemo(() => {
    if (selection === "all") return [];
    if (selection.startsWith("line:")) {
      const lineId = selection.slice("line:".length);
      return (PRACTICE_LINE_GROUPS[lineId] ?? []).flatMap((group) => group.categoryIds);
    }
    const categorySelection = parseCategorySelection(selection);
    if (categorySelection.length > 0) return categorySelection;
    return [];
  }, [selection]);
  const {
    categories,
    error,
    hasLoaded,
    listLoading,
    loading,
    reload,
    skills,
    total: skillTotal,
  } = useSkillsData(
    t("skills.categories.all"),
    isZh,
    selectedCategoryKeys,
    skillPage,
    skillPageSize,
    setSkillPage,
  );

  if (loading && !hasLoaded) return <SkillsLoading title={t("skills.title")} />;
  if (error && !hasLoaded) return <SkillsLoadError title={t("skills.title")} message={error} onRetry={reload} isZh={isZh} />;

  const filterCategories = categories.filter((cat) => cat.id !== "all");
  const allCategoryCount =
    categories.find((cat) => cat.id === "all")?.count ?? skills.length;
  const allCategoryLabel =
    categories.find((cat) => cat.id === "all")?.label ?? t("skills.categories.all");

  // Group skills by their normalized category key — used for both the
  // right-pane render and the per-sub-category counts in the sidebar.
  const skillsByCategoryKey = new Map<string, SkillSummary[]>();
  for (const skill of skills) {
    const key = getSkillCategoryKey(skill);
    if (!skillsByCategoryKey.has(key)) skillsByCategoryKey.set(key, []);
    skillsByCategoryKey.get(key)!.push(skill);
  }
  const categoryCountMap = new Map(categories.map((cat) => [cat.id, cat.count]));

  // Materialize the 2-level sidebar tree. For each practice line we
  // walk ``PRACTICE_LINE_GROUPS`` (the design's grouping table), then
  // collapse each group's category IDs to ``{ label, count }`` rows
  // for the sidebar. A group with zero skills is hidden so users
  // don't stare at empty rows.
  type SidebarSubGroup = { id: string; label: string; count: number; token: string };
  type SidebarLine = {
    lineId: PracticeLineId;
    lineLabel: string;
    lineTotal: number;
    subGroups: SidebarSubGroup[];
  };

  const sidebarLines: SidebarLine[] = PRACTICE_LINE_IDS.map((lineId) => {
    const meta = getPracticeLineMeta(lineId);
    const groups = PRACTICE_LINE_GROUPS[lineId] ?? [];
    const subGroups: SidebarSubGroup[] = [];
    let lineTotal = 0;
    for (const group of groups) {
      let count = 0;
      for (const catId of group.categoryIds) {
        count += categoryCountMap.get(catId) ?? 0;
      }
      lineTotal += count;
      if (count > 0) {
        subGroups.push({
          id: group.categoryIds[0] ?? `${lineId}-${group.label.en}`,
          label: isZh ? group.label.zh : group.label.en,
          count,
          token: buildCategoryGroupToken(group.categoryIds),
        });
      }
    }
    return {
      lineId,
      lineLabel: isZh ? meta.title.zh : meta.title.en,
      lineTotal,
      subGroups,
    };
  }).filter((line) => line.lineTotal > 0);

  // Resolve the selection to "which sub-category IDs are visible". For
  // ``cat:<id>`` it's just that id; for ``line:<id>`` it's every
  // categoryId across every group under that line; for ``all`` it's
  // every key present in ``skillsByCategoryKey``.
  let visibleKeys: string[];
  let titleOverride: string | null = null;
  if (selection === "all") {
    visibleKeys = Array.from(skillsByCategoryKey.keys());
  } else if (selection.startsWith("line:")) {
    const lineId = selection.slice("line:".length);
    const groups = PRACTICE_LINE_GROUPS[lineId] ?? [];
    visibleKeys = groups.flatMap((g) => g.categoryIds);
    const meta = isPracticeLineId(lineId) ? getPracticeLineMeta(lineId) : null;
    titleOverride = meta ? (isZh ? meta.title.zh : meta.title.en) : null;
  } else if (selection.startsWith("cat:") || selection.startsWith("cats:")) {
    visibleKeys = parseCategorySelection(selection);
    const selectedGroup = sidebarLines
      .flatMap((line) => line.subGroups)
      .find((sub) => sub.token === selection || selection === `cat:${sub.id}`);
    titleOverride = selectedGroup?.label ?? null;
  } else {
    visibleKeys = Array.from(skillsByCategoryKey.keys());
  }

  // Order the visible groups so they read top-down by practice line —
  // strategy first, then customer, etc., as defined in
  // ``PRACTICE_LINE_GROUPS``. This keeps the right pane aligned with
  // the sidebar order rather than alphabetic.
  const lineOrderedKeys: string[] = [];
  for (const lineId of PRACTICE_LINE_IDS) {
    for (const group of PRACTICE_LINE_GROUPS[lineId] ?? []) {
      for (const catId of group.categoryIds) {
        if (visibleKeys.includes(catId) && skillsByCategoryKey.has(catId)) {
          if (!lineOrderedKeys.includes(catId)) lineOrderedKeys.push(catId);
        }
      }
    }
  }
  // Any visible key that wasn't claimed by a practice line group (e.g.
  // categories without a line mapping) goes after.
  for (const k of visibleKeys) {
    if (!lineOrderedKeys.includes(k) && skillsByCategoryKey.has(k)) {
      lineOrderedKeys.push(k);
    }
  }

  const visibleGroups = lineOrderedKeys.map((key) => ({
    cat: filterCategories.find((c) => c.id === key) ?? {
      id: key,
      label: getCategoryLabel(getCategoryKey(key), isZh),
      count: skillsByCategoryKey.get(key)?.length ?? 0,
    },
    items: skillsByCategoryKey.get(key) ?? [],
  }));
  const skillPageCount = Math.max(1, Math.ceil(skillTotal / skillPageSize));
  const currentSkillPage = Math.min(skillPage, skillPageCount);
  const paginatedVisibleGroups = visibleGroups
    .map((group) => ({
      cat: group.cat,
      items: group.items,
      totalCount: categoryCountMap.get(group.cat.id) ?? group.items.length,
    }))
    .filter((group) => group.items.length > 0 || skillTotal === 0);

  const selectSkillScope = (token: string) => {
    setSelection(token);
    setSkillPage(1);
  };

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

          {/* Top-level "全部" — selects everything across every line */}
          <button
            type="button"
            className="row-hov cx-no-hover w-full text-left"
            style={sidebarLinkStyle(selection === "all")}
            onClick={() => selectSkillScope("all")}
          >
            <span>{allCategoryLabel}</span>
            <span
              className="font-mono"
              style={{
                fontSize: 11.5,
                color:
                  selection === "all"
                    ? "var(--color-codex-accent)"
                    : "var(--color-codex-ink-faint)",
              }}
            >
              {allCategoryCount}
            </span>
          </button>

          {/* Practice lines + nested sub-groups. The line label itself
              is clickable too — clicking it filters to every
              sub-category under that line. */}
          {sidebarLines.map((line) => {
            const lineActive = selection === `line:${line.lineId}`;
            return (
              <div key={line.lineId} style={{ marginTop: 20 }}>
                <button
                  type="button"
                  className="cx-no-hover flex w-full items-center justify-between"
                  style={{
                    padding: "4px 10px 6px",
                    fontSize: 10.5,
                    fontFamily: "var(--font-mono, ui-monospace, monospace)",
                    color: lineActive
                      ? "var(--color-codex-ink)"
                      : "var(--color-codex-ink-faint)",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    textAlign: "left",
                    cursor: "pointer",
                    fontWeight: lineActive ? 600 : 500,
                  }}
                  onClick={() => selectSkillScope(`line:${line.lineId}`)}
                >
                  <span>{line.lineLabel}</span>
                  <span
                    style={{
                      color: lineActive
                        ? "var(--color-codex-accent)"
                        : "var(--color-codex-ink-faint)",
                    }}
                  >
                    {line.lineTotal}
                  </span>
                </button>
                {line.subGroups.map((sub) => {
                  const subActive = selection === `cat:${sub.id}`;
                  const nextToken = sub.token;
                  const active = selection === nextToken || subActive;
                  return (
                    <button
                      key={sub.id}
                      type="button"
                      className="row-hov cx-no-hover w-full text-left"
                      style={{
                        ...sidebarLinkStyle(active),
                        // Indent the sub-group items so the hierarchy
                        // reads at a glance.
                        paddingLeft: 20,
                      }}
                      onClick={() => selectSkillScope(nextToken)}
                    >
                      <span>{sub.label}</span>
                      <span
                        className="font-mono"
                        style={{
                          fontSize: 11.5,
                          color: active
                            ? "var(--color-codex-accent)"
                            : "var(--color-codex-ink-faint)",
                        }}
                      >
                        {sub.count}
                      </span>
                    </button>
                  );
                })}
              </div>
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
                {allCategoryCount}
              </span>
            </div>
            <div className="flex justify-between">
              <span>{isZh ? "业务线" : "Practice lines"}</span>
              <span className="font-mono" style={{ color: "var(--color-codex-ink)" }}>
                {sidebarLines.length}
              </span>
            </div>
          </div>
        </aside>

        {/* Mobile/tablet category pill row — flattened: top-level
            practice lines + ``全部``. The 2-level sidebar drops back
            to one level on narrow widths because nested pills would
            crowd the row. */}
        <nav
          className="flex gap-1 overflow-x-auto px-4 py-3 lg:hidden"
          style={{ borderBottom: "1px solid var(--color-codex-line)" }}
        >
          {[
            {
              id: "all",
              label: allCategoryLabel,
              count: allCategoryCount,
              token: "all",
            },
            ...sidebarLines.map((line) => ({
              id: `line:${line.lineId}`,
              label: line.lineLabel,
              count: line.lineTotal,
              token: `line:${line.lineId}`,
            })),
          ].map((entry) => {
            const active = selection === entry.token;
            return (
              <button
                key={entry.id}
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
                onClick={() => selectSkillScope(entry.token)}
              >
                {entry.label}{" "}
                <span
                  className="font-mono"
                  style={{ marginLeft: 6, color: "var(--color-codex-ink-faint)" }}
                >
                  {entry.count}
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
                {titleOverride ?? (isZh ? "Skill 库" : "Skill Library")}
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
                {(() => {
                  if (selection === "all") {
                    return isZh
                      ? `把重复的工作沉淀成可调用的模板。共 ${allCategoryCount} 个 Skill，分 ${sidebarLines.length} 个业务线。`
                      : `Recurring work, captured as reusable templates. ${allCategoryCount} skills across ${sidebarLines.length} practice lines.`;
                  }
                  if (selection.startsWith("line:")) {
                    return isZh
                      ? `该业务线下共 ${skillTotal} 个 Skill，按子分类分组。`
                      : `${skillTotal} skills in this practice line, grouped by sub-category.`;
                  }
                  return isZh
                    ? `当前分类下 ${skillTotal} 个 Skill。`
                    : `${skillTotal} skills in this category.`;
                })()}
              </p>
            </div>
          </header>

          {error && hasLoaded ? (
            <div
              role="alert"
              style={{
                marginBottom: 16,
                padding: "10px 12px",
                background: "color-mix(in oklch, var(--color-codex-bad) 8%, transparent)",
                border: "1px solid color-mix(in oklch, var(--color-codex-bad) 30%, transparent)",
                borderRadius: "var(--codex-r-sm, 3px)",
                color: "var(--color-codex-bad)",
                fontSize: 12.5,
              }}
            >
              {isZh ? "列表更新失败，当前仍显示上一次结果。" : "List update failed. Showing the previous results."}
            </div>
          ) : null}

          <div className="relative">
            <div
              style={{
                opacity: listLoading ? 0.48 : 1,
                transition: "opacity 140ms ease",
              }}
            >
              {paginatedVisibleGroups.map(({ cat, items, totalCount }) => (
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
                      {totalCount} {isZh ? "项" : "items"}
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
              <CxPagination
                page={currentSkillPage}
                pageSize={skillPageSize}
                totalItems={skillTotal}
                onPageChange={setSkillPage}
                onPageSizeChange={(nextPageSize) => {
                  setSkillPageSize(nextPageSize);
                  setSkillPage(1);
                }}
                pageSizeOptions={[10, 20, 50]}
                isZh={isZh}
              />
            </div>
            {listLoading ? (
              <div
                className="pointer-events-none absolute inset-0 flex items-start justify-center"
                style={{
                  paddingTop: 28,
                  background: "color-mix(in oklch, var(--color-codex-bg) 50%, transparent)",
                  borderRadius: "var(--codex-r-md, 6px)",
                }}
              >
                <div
                  className="inline-flex items-center gap-2"
                  style={{
                    padding: "8px 12px",
                    background: "var(--color-codex-bg-elev)",
                    border: "1px solid var(--color-codex-line)",
                    borderRadius: "var(--codex-r-sm, 3px)",
                    color: "var(--color-codex-ink-soft)",
                    fontSize: 12.5,
                    boxShadow: "0 8px 22px color-mix(in oklch, var(--color-codex-ink) 8%, transparent)",
                  }}
                >
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {isZh ? "正在更新列表" : "Updating list"}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}


export function SkillDetailPage() {
  /*
   * Skill detail — Codex layout per
   * ``design_handoff_aria_codex_redesign/direction-codex-more-2.jsx:6``
   * (``CxSkillDetail``).
   *
   * Header is a clean breadcrumb + 48px accent-bg icon + h1 + description
   * + secondary buttons; below that, four mono stat columns sit between
   * two hairline rules; then a 1fr / 300px two-column body with three
   * panels on the left (它会做什么 / 需要哪些上下文 / 示例输出 — driven by
   * ``buildUsageSteps`` / ``buildInputHints`` / ``buildOutputHints``)
   * and two on the right (最近调用 placeholder + 基础信息).
   *
   * The previous V0.0.5 detail page used a blue gradient hero, two
   * separate emerald/slate panel sets, and a tools chip rail. Those
   * panels (``PromptPreview``, ``Breadcrumb``, ``LaunchContextBanners``)
   * are no longer referenced.
   */
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
  const categoryLabel = skill ? getCategoryLabel(skillCategoryKey, isZh) : "";

  if (loading) return <SkillsLoading title={t("skills.title")} />;

  if (error || !skill) {
    return (
      <>
        <PageTitle title={isZh ? "能力未找到" : "Skill not found"} />
        <div
          className="theme-codex flex min-h-full items-center justify-center px-6"
          style={{ background: "var(--color-codex-bg)", color: "var(--color-codex-ink)" }}
        >
          <div
            className="max-w-md text-center"
            style={{
              padding: 32,
              background: "var(--color-codex-bg-elev)",
              border: "1px solid var(--color-codex-line)",
              borderRadius: "var(--codex-r-md, 6px)",
            }}
          >
            <Brain className="mx-auto h-10 w-10" style={{ color: "var(--color-codex-ink-faint)" }} />
            <h1
              style={{
                margin: "16px 0 0",
                fontSize: 18,
                fontWeight: 500,
                color: "var(--color-codex-ink)",
              }}
            >
              {isZh ? "这个能力暂时不可用" : "This Skill is unavailable"}
            </h1>
            <p
              style={{
                margin: "8px 0 0",
                fontSize: 13,
                lineHeight: 1.6,
                color: "var(--color-codex-ink-mute)",
              }}
            >
              {isZh
                ? "可能已被删除，或者当前链接不正确。"
                : "It may have been deleted, or the link is invalid."}
            </p>
            <button
              type="button"
              onClick={() => navigate(buildSkillsPath(launchSource.searchParams))}
              className="mt-6 inline-flex items-center justify-center gap-2"
              style={{
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 500,
                background: "var(--color-codex-ink)",
                color: "var(--color-codex-bg-elev)",
                borderRadius: "var(--codex-r-sm, 3px)",
              }}
            >
              <ArrowLeft className="h-4 w-4" />
              {isZh ? "返回 Skill 库" : "Back to Skill Library"}
            </button>
          </div>
        </div>
      </>
    );
  }

  // Mono stat columns. The four prototype values (本月调用 / 累计调用 /
  // 平均耗时 / 好评率) aren't tracked yet on the backend, so we surface
  // what we do have — estimated_time + tools_count + category — and
  // leave the rest as ``—`` placeholders for when the metrics endpoint
  // is wired up. The labels stay so the layout reads as 4-up.
  const statColumns = [
    {
      label: isZh ? "本月调用" : "Calls this month",
      value: "—",
    },
    {
      label: isZh ? "累计调用" : "Total calls",
      value: "—",
    },
    {
      label: isZh ? "平均耗时" : "Avg duration",
      value: skill.estimated_time || "—",
    },
    {
      label: isZh ? "可用工具" : "Tools",
      value: toolNames.length > 0 ? String(toolNames.length) : "—",
    },
  ];

  const ghostButton: React.CSSProperties = {
    padding: "7px 12px",
    fontSize: 12.5,
    background: "var(--color-codex-bg)",
    color: "var(--color-codex-ink-soft)",
    border: "1px solid var(--color-codex-line)",
    borderRadius: "var(--codex-r-sm, 3px)",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  };

  const panelStyle: React.CSSProperties = {
    padding: 18,
    background: "var(--color-codex-bg-elev)",
    border: "1px solid var(--color-codex-line)",
    borderRadius: "var(--codex-r-md, 6px)",
  };

  const panelTitleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: 13,
    fontWeight: 500,
    color: "var(--color-codex-ink-mute)",
    letterSpacing: "0.01em",
    marginBottom: 12,
  };

  return (
    <>
      <PageTitle title={skill.name} />
      <div
        className="theme-codex flex h-full flex-col overflow-hidden"
        style={{ background: "var(--color-codex-bg)", color: "var(--color-codex-ink)" }}
      >
        {/* Header */}
        <div style={{ padding: "22px 40px 0", flexShrink: 0 }}>
          {/* Breadcrumb */}
          <div style={{ marginBottom: 10, fontSize: 12, color: "var(--color-codex-ink-mute)" }}>
            <button
              type="button"
              onClick={() => navigate(buildSkillsPath(launchSource.searchParams))}
              style={{
                color: "var(--color-codex-ink-faint)",
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
              }}
            >
              {isZh ? "Skill 库" : "Skill Library"}
            </button>
            <span style={{ margin: "0 6px", color: "var(--color-codex-ink-faint)" }}>/</span>
            <span style={{ color: "var(--color-codex-ink-faint)" }}>{categoryLabel}</span>
            <span style={{ margin: "0 6px", color: "var(--color-codex-ink-faint)" }}>/</span>
            <span>{skill.name}</span>
          </div>

          {/* Title row */}
          <div className="flex flex-wrap items-start justify-between" style={{ gap: 24 }}>
            <div className="flex min-w-0" style={{ gap: 16 }}>
              <span
                className="inline-flex flex-shrink-0 items-center justify-center"
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "var(--codex-r-md, 6px)",
                  background: "var(--color-codex-accent-bg)",
                  color: "var(--color-codex-accent)",
                }}
              >
                <SkillCategoryIcon category={skillCategoryKey} />
              </span>
              <div style={{ minWidth: 0 }}>
                <h1
                  style={{
                    margin: 0,
                    fontSize: 24,
                    fontWeight: 500,
                    color: "var(--color-codex-ink)",
                    letterSpacing: "-0.02em",
                  }}
                >
                  {skill.name}
                </h1>
                <p
                  style={{
                    margin: "6px 0 0",
                    maxWidth: 580,
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: "var(--color-codex-ink-soft)",
                  }}
                >
                  {skill.description}
                </p>
              </div>
            </div>
            <div className="flex flex-shrink-0" style={{ gap: 6 }}>
              <button
                type="button"
                onClick={() => navigate(buildSkillsPath(launchSource.searchParams))}
                style={ghostButton}
              >
                <ArrowLeft className="h-3 w-3" />
                {isZh ? "返回" : "Back"}
              </button>
              <button
                type="button"
                onClick={() => navigate(buildSkillChatPath(skill.id, launchSource.searchParams))}
                style={{
                  padding: "7px 14px",
                  fontSize: 12.5,
                  fontWeight: 500,
                  background: "var(--color-codex-ink)",
                  color: "var(--color-codex-bg-elev)",
                  borderRadius: "var(--codex-r-sm, 3px)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.5} />
                {t("skills.useSkill")}
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div
          className="flex-1 overflow-auto"
          style={{
            padding: "22px 40px 32px",
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 300px",
            gap: 24,
            minWidth: 0,
          }}
        >
          <div className="flex flex-col" style={{ gap: 16, minWidth: 0 }}>
            {/* 4 mono stat columns sandwiched between hairlines per design */}
            <div
              className="grid"
              style={{
                gridTemplateColumns: "repeat(4, 1fr)",
                padding: "16px 0",
                borderTop: "1px solid var(--color-codex-line)",
                borderBottom: "1px solid var(--color-codex-line)",
              }}
            >
              {statColumns.map((stat, i) => (
                <div
                  key={stat.label}
                  style={{
                    padding: "0 20px",
                    borderLeft: i > 0 ? "1px solid var(--color-codex-line-soft)" : "none",
                  }}
                >
                  <div
                    className="font-mono"
                    style={{
                      marginBottom: 5,
                      fontSize: 10.5,
                      color: "var(--color-codex-ink-mute)",
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                    }}
                  >
                    {stat.label}
                  </div>
                  <span
                    className="font-mono"
                    style={{
                      fontSize: 22,
                      fontWeight: 500,
                      color: "var(--color-codex-ink)",
                    }}
                  >
                    {stat.value}
                  </span>
                </div>
              ))}
            </div>

            {/* What it does */}
            <section style={panelStyle}>
              <h2 style={panelTitleStyle}>{isZh ? "它会做什么" : "What it does"}</h2>
              <ol
                style={{
                  margin: 0,
                  paddingLeft: 22,
                  fontSize: 13.5,
                  lineHeight: 1.85,
                  color: "var(--color-codex-ink)",
                }}
              >
                {usageSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </section>

            {/* Recommended inputs */}
            <section style={panelStyle}>
              <h2 style={panelTitleStyle}>{isZh ? "建议输入" : "Recommended inputs"}</h2>
              <div
                className="grid"
                style={{
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 8,
                }}
              >
                {inputHints.map((item) => (
                  <div
                    key={item}
                    className="flex items-start"
                    style={{
                      gap: 8,
                      padding: "10px 12px",
                      background: "var(--color-codex-bg-tint)",
                      borderRadius: "var(--codex-r-sm, 3px)",
                    }}
                  >
                    <CheckCircle2
                      className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
                      strokeWidth={1.5}
                      style={{ color: "var(--color-codex-accent)" }}
                    />
                    <p
                      style={{
                        margin: 0,
                        fontSize: 12.5,
                        lineHeight: 1.55,
                        color: "var(--color-codex-ink)",
                      }}
                    >
                      {item}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            {/* Expected outputs */}
            <section style={panelStyle}>
              <h2 style={panelTitleStyle}>{isZh ? "预期输出" : "Expected outputs"}</h2>
              <ul
                style={{
                  margin: 0,
                  padding: 0,
                  fontSize: 13,
                  lineHeight: 1.75,
                  color: "var(--color-codex-ink-soft)",
                  listStyle: "none",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {outputHints.map((item) => (
                  <li
                    key={item}
                    className="flex items-start"
                    style={{ gap: 8 }}
                  >
                    <span
                      className="font-mono mt-0.5 flex-shrink-0"
                      style={{
                        fontSize: 11,
                        color: "var(--color-codex-accent)",
                        fontWeight: 500,
                      }}
                    >
                      ·
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </section>

            {/* Prompt template */}
            {(skill.system_prompt || skill.user_template) && (
              <section style={panelStyle}>
                <h2 style={panelTitleStyle}>{isZh ? "提示词模板" : "Prompt template"}</h2>
                {skill.system_prompt && (
                  <div style={{ marginBottom: 12 }}>
                    <div
                      className="font-mono"
                      style={{
                        marginBottom: 6,
                        fontSize: 10.5,
                        color: "var(--color-codex-ink-mute)",
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                      }}
                    >
                      {isZh ? "系统提示词" : "System prompt"}
                    </div>
                    <pre
                      className="font-mono whitespace-pre-wrap"
                      style={{
                        margin: 0,
                        padding: "10px 12px",
                        fontSize: 12,
                        lineHeight: 1.6,
                        color: "var(--color-codex-ink)",
                        background: "var(--color-codex-bg-tint)",
                        border: "1px solid var(--color-codex-line-soft)",
                        borderRadius: "var(--codex-r-sm, 3px)",
                        overflow: "auto",
                      }}
                    >
                      {skill.system_prompt}
                    </pre>
                  </div>
                )}
                {skill.user_template && (
                  <div>
                    <div
                      className="font-mono"
                      style={{
                        marginBottom: 6,
                        fontSize: 10.5,
                        color: "var(--color-codex-ink-mute)",
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                      }}
                    >
                      {isZh ? "用户输入模板" : "User template"}
                    </div>
                    <pre
                      className="font-mono whitespace-pre-wrap"
                      style={{
                        margin: 0,
                        padding: "10px 12px",
                        fontSize: 12,
                        lineHeight: 1.6,
                        color: "var(--color-codex-ink)",
                        background: "var(--color-codex-bg-tint)",
                        border: "1px solid var(--color-codex-line-soft)",
                        borderRadius: "var(--codex-r-sm, 3px)",
                        overflow: "auto",
                      }}
                    >
                      {skill.user_template}
                    </pre>
                  </div>
                )}
              </section>
            )}
          </div>

          {/* Right rail — basic info + tools */}
          <aside className="flex flex-col" style={{ gap: 16 }}>
            <section style={panelStyle}>
              <h2 style={panelTitleStyle}>{isZh ? "基础信息" : "Basic info"}</h2>
              <div
                style={{
                  fontSize: 12.5,
                  lineHeight: 1.9,
                  color: "var(--color-codex-ink-soft)",
                }}
              >
                <div className="flex justify-between">
                  <span style={{ color: "var(--color-codex-ink-mute)" }}>
                    {isZh ? "分类" : "Category"}
                  </span>
                  <span style={{ color: "var(--color-codex-ink)" }}>{categoryLabel}</span>
                </div>
                {skill.estimated_time && (
                  <div className="flex justify-between">
                    <span style={{ color: "var(--color-codex-ink-mute)" }}>
                      {isZh ? "预计耗时" : "Estimated"}
                    </span>
                    <span className="font-mono" style={{ color: "var(--color-codex-ink)" }}>
                      {skill.estimated_time}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span style={{ color: "var(--color-codex-ink-mute)" }}>
                    {isZh ? "可用工具" : "Tools"}
                  </span>
                  <span className="font-mono" style={{ color: "var(--color-codex-ink)" }}>
                    {toolNames.length}
                  </span>
                </div>
              </div>
            </section>

            {toolNames.length > 0 && (
              <section style={panelStyle}>
                <h2 style={panelTitleStyle}>{isZh ? "工具列表" : "Tools"}</h2>
                <div className="flex flex-wrap" style={{ gap: 6 }}>
                  {toolNames.map((tool) => (
                    <span
                      key={tool}
                      className="font-mono"
                      style={{
                        padding: "3px 8px",
                        fontSize: 11.5,
                        background: "var(--color-codex-bg-tint)",
                        color: "var(--color-codex-ink-soft)",
                        borderRadius: "var(--codex-r-sm, 3px)",
                        letterSpacing: "0.02em",
                      }}
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </section>
            )}
          </aside>
        </div>
      </div>
    </>
  );
}

/**
 * Skills 库 skeleton — mirrors the real page layout (220px sidebar +
 * grouped list) per the design's CxLoading approach in
 * ``design_handoff_aria_codex_redesign/direction-codex-states.jsx:23``.
 *
 * Top progress bar gives a "fetching" cue without committing to a
 * spinner that hides the fact that the page is structured.
 */
function SkillsLoading({ title }: { title: string }) {
  return (
    <>
      <PageTitle title={title} />
      <div
        className="theme-codex flex h-full flex-col"
        style={{
          background: "var(--color-codex-bg)",
          color: "var(--color-codex-ink)",
        }}
      >
        <CxTopProgress />
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar skeleton — matches the 220px panel with categories
              and stats from the real page. */}
          <aside
            className="hidden flex-shrink-0 lg:block"
            style={{
              width: 220,
              padding: "28px 18px 28px 40px",
              borderRight: "1px solid var(--color-codex-line)",
            }}
          >
            <div style={{ marginBottom: 10 }}>
              <CxSkeleton w={48} h={11} />
            </div>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="flex items-center justify-between"
                style={{ padding: "7px 10px", marginBottom: 1 }}
              >
                <CxSkeleton w="55%" h={12} />
                <CxSkeleton w={18} h={11} />
              </div>
            ))}
            <div style={{ margin: "26px 0 8px" }}>
              <CxSkeleton w={48} h={11} />
            </div>
            <div style={{ padding: "4px 10px" }}>
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="flex items-center justify-between"
                  style={{ padding: "6px 0" }}
                >
                  <CxSkeleton w="40%" h={11} />
                  <CxSkeleton w={24} h={11} />
                </div>
              ))}
            </div>
          </aside>

          {/* Main column skeleton — heading + 2 grouped sections of
              skill rows. */}
          <div className="min-w-0 flex-1 overflow-auto" style={{ padding: "32px 56px 40px" }}>
            <div style={{ marginBottom: 28 }}>
              <CxSkeleton w={160} h={28} />
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                <CxSkeleton w="60%" h={14} />
                <CxSkeleton w="40%" h={14} />
              </div>
            </div>
            {[0, 1].map((group) => (
              <section key={group} style={{ marginBottom: 28 }}>
                <div
                  className="flex items-baseline justify-between"
                  style={{ marginBottom: 14 }}
                >
                  <CxSkeleton w={80} h={13} />
                  <CxSkeleton w={48} h={11} />
                </div>
                {[0, 1, 2].map((i, _, arr) => (
                  <div
                    key={i}
                    className="grid items-center"
                    style={{
                      gridTemplateColumns: "1fr 90px 80px 14px",
                      columnGap: 16,
                      padding: "14px 8px",
                      borderBottom:
                        i === arr.length - 1
                          ? "none"
                          : "1px solid var(--color-codex-line-soft)",
                    }}
                  >
                    <div>
                      <CxSkeleton w="50%" h={15} />
                      <div style={{ marginTop: 5 }}>
                        <CxSkeleton w="80%" h={12} />
                      </div>
                    </div>
                    <CxSkeleton w={70} h={14} radius={999} />
                    <CxSkeleton w={50} h={12} />
                    <CxSkeleton w={10} h={10} />
                  </div>
                ))}
              </section>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function SkillsLoadError({
  title,
  message,
  onRetry,
  isZh,
}: {
  title: string;
  message: string;
  onRetry: () => void;
  isZh: boolean;
}) {
  return (
    <>
      <PageTitle title={title} />
      <div
        className="theme-codex flex h-full flex-col items-center justify-center"
        style={{
          background: "var(--color-codex-bg)",
          color: "var(--color-codex-ink)",
          padding: "32px",
          textAlign: "center",
        }}
      >
        <AlertCircle
          className="mb-3 h-7 w-7"
          style={{ color: "var(--color-codex-bad)" }}
          aria-hidden="true"
        />
        <p
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 500,
            color: "var(--color-codex-ink)",
          }}
        >
          {isZh ? "暂时拉不到 Skill 列表" : "Couldn't load skills"}
        </p>
        <p
          style={{
            margin: "6px 0 16px",
            fontSize: 12,
            color: "var(--color-codex-ink-mute)",
            maxWidth: 420,
            lineHeight: 1.6,
          }}
        >
          {message}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5"
          style={{
            padding: "8px 14px",
            background: "var(--color-codex-bg-tint)",
            color: "var(--color-codex-ink-soft)",
            border: "1px solid var(--color-codex-line)",
            borderRadius: "var(--codex-r-sm, 6px)",
            fontSize: 13,
          }}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          {isZh ? "重试" : "Retry"}
        </button>
      </div>
    </>
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
