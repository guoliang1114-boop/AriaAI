import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  Brain,
  Briefcase,
  Clock3,
  Cpu,
  DollarSign,
  FileText,
  MessageSquare,
  Search,
  Shield,
  Target,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";

import { api } from "../../api/client";
import { PageTitle } from "../../components/PageTitle";
import type { SkillSummary } from "../../types/api";

const extractMinutes = (estimatedTime?: string) => {
  if (!estimatedTime) return 0;
  const match = estimatedTime.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
};

const normalizeCategory = (value: string) => value.replace(/\?/g, "").trim();

const getCategoryIcon = (category: string) => {
  const normalized = normalizeCategory(category).toLowerCase();
  if (normalized.includes("strategy")) return TrendingUp;
  if (normalized.includes("market")) return Target;
  if (normalized.includes("finance")) return DollarSign;
  if (normalized.includes("risk")) return Shield;
  if (normalized.includes("digital")) return Cpu;
  if (normalized.includes("proposal")) return FileText;
  if (normalized.includes("operation")) return Briefcase;
  if (normalized.includes("org")) return Users;
  if (normalized.includes("data")) return BarChart3;
  return Brain;
};

const getCategoryTone = (category: string) => {
  const normalized = normalizeCategory(category).toLowerCase();
  if (normalized.includes("strategy")) return "bg-blue-50 text-blue-700 border-blue-100";
  if (normalized.includes("market")) return "bg-emerald-50 text-emerald-700 border-emerald-100";
  if (normalized.includes("finance")) return "bg-amber-50 text-amber-700 border-amber-100";
  if (normalized.includes("risk")) return "bg-rose-50 text-rose-700 border-rose-100";
  if (normalized.includes("digital")) return "bg-violet-50 text-violet-700 border-violet-100";
  return "bg-slate-50 text-slate-700 border-slate-200";
};

export function Skills() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [activeType, setActiveType] = useState<"all" | "quick" | "deep">("all");

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

  const handleUseSkill = (skillId: number) => {
    const projectId = searchParams.get("project");
    const nextParams = new URLSearchParams({ skill: String(skillId) });
    if (projectId) nextParams.set("project", projectId);
    navigate(`/chat?${nextParams.toString()}`);
  };

  const categories = useMemo(
    () => [
      { id: "all", label: t("skills.categories.all") },
      ...Array.from(new Map(skills.map((skill) => [normalizeCategory(skill.category), skill.category])).values()).map(
        (category) => ({
          id: category,
          label: category,
        }),
      ),
    ],
    [skills, t],
  );

  const filteredSkills = useMemo(() => {
    return skills.filter((skill) => {
      const normalizedSearch = search.trim().toLowerCase();
      const matchesSearch =
        !normalizedSearch ||
        skill.name.toLowerCase().includes(normalizedSearch) ||
        skill.description.toLowerCase().includes(normalizedSearch) ||
        skill.category.toLowerCase().includes(normalizedSearch);
      const matchesCategory =
        activeCategory === "all" || normalizeCategory(skill.category) === normalizeCategory(activeCategory);
      const minutes = extractMinutes(skill.estimated_time);
      const isQuick = minutes <= 10;
      const matchesType =
        activeType === "all" ||
        (activeType === "quick" && isQuick) ||
        (activeType === "deep" && !isQuick);

      return matchesSearch && matchesCategory && matchesType;
    });
  }, [activeCategory, activeType, search, skills]);

  const featuredSkills = filteredSkills.slice(0, 2);
  const regularSkills = filteredSkills.slice(2);

  if (loading) {
    return (
      <>
        <PageTitle title={t("skills.title")} />
        <div className="flex min-h-full items-center justify-center bg-slate-50">
          <Zap className="h-8 w-8 animate-pulse text-primary" />
        </div>
      </>
    );
  }

  return (
    <>
      <PageTitle title={t("skills.title")} />
      <div className="min-h-full bg-[linear-gradient(180deg,#f7f8fb_0%,#eef3f8_100%)]">
        <div className="w-full px-6 py-8 xl:px-8 2xl:px-10">
          <section className="relative overflow-hidden rounded-[2rem] border border-slate-200 bg-[radial-gradient(circle_at_top_right,#dcecff_0%,#f8fbff_42%,#ffffff_100%)] p-8 shadow-[0_30px_70px_rgba(15,23,42,0.08)]">
            <div className="absolute right-0 top-0 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
            <div className="relative">
              <div className="max-w-3xl">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/10 bg-white/80 px-3 py-1.5 text-xs font-medium text-primary shadow-sm backdrop-blur">
                  <Brain className="h-3.5 w-3.5" />
                  <span>{t("skills.title")}</span>
                </div>
                <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-slate-900">
                  {t("skills.workbenchTitle")}
                </h1>
                <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
                  {t("skills.workbenchSubtitle")}
                </p>
              </div>
            </div>
          </section>

          <section className="mt-6 rounded-[1.5rem] border border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="relative w-full min-w-0 flex-1 xl:max-w-2xl">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("skills.searchPlaceholder")}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm text-slate-700 outline-none transition focus:border-primary/30 focus:bg-white focus:ring-2 focus:ring-primary/15"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 xl:flex-nowrap">
                <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
                  {(["all", "quick", "deep"] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setActiveType(type)}
                      className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                        activeType === type
                          ? "bg-slate-900 text-white shadow-sm"
                          : "text-slate-600 hover:bg-white hover:text-slate-900"
                      }`}
                    >
                      {type === "all" ? t("skills.types.all") : type === "quick" ? t("skills.types.quick") : t("skills.types.deep")}
                    </button>
                  ))}
                </div>

                <div className="relative min-w-[180px]">
                  <select
                    value={activeCategory}
                    onChange={(event) => setActiveCategory(event.target.value)}
                    className="w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-4 pr-10 text-sm text-slate-700 outline-none transition focus:border-primary/30 focus:bg-white focus:ring-2 focus:ring-primary/15"
                  >
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  {t("skills.resultsCount", { count: filteredSkills.length })}
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
                  <FeaturedSkillCard key={skill.id} skill={skill} onUse={() => handleUseSkill(skill.id)} />
                ))}
              </section>

              <section className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
                {regularSkills.map((skill) => (
                  <SkillCard key={skill.id} skill={skill} onUse={() => handleUseSkill(skill.id)} />
                ))}
              </section>
            </>
          )}
        </div>
      </div>
    </>
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

      <h3 className="mt-5 text-xl font-semibold text-slate-900 transition-colors group-hover:text-primary">
        {skill.name}
      </h3>
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
