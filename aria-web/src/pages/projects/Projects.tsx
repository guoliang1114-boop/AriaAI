import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { api } from "../../api/client";
import { PageTitle } from "../../components/PageTitle";
import type { ProjectPhase } from "../../types/enums";
import type { Project, ProjectMemoryBatchRebuildResponse } from "../../types/api";
import { ProjectsHeader } from "./ProjectsHeader";
import { PHASES, ProjectsPhaseSection, getProjectPhase } from "./ProjectsPhaseSection";

type MemoryBatchMode = "stale" | "missing";

const getMemoryHealthRank = (project: Project): number => {
  if ((project.memory_version || 0) === 0) return 0;
  if (project.memory_stale) return 1;
  return 2;
};

const getTimestampValue = (value: string | null | undefined): number => {
  if (!value) return 0;
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`;
  const timestamp = new Date(normalized).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const compareProjectsByMemoryHealth = (left: Project, right: Project): number => {
  const rankDiff = getMemoryHealthRank(left) - getMemoryHealthRank(right);
  if (rankDiff !== 0) return rankDiff;

  const memoryTimeDiff =
    getTimestampValue(right.memory_updated_at) - getTimestampValue(left.memory_updated_at);
  if (memoryTimeDiff !== 0) return memoryTimeDiff;

  return getTimestampValue(right.updated_at) - getTimestampValue(left.updated_at);
};

export function Projects() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedPhase, setExpandedPhase] = useState<ProjectPhase | null>("business");
  const [users, setUsers] = useState<Array<{ id: number; display_name: string }>>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);
  const [showStaleOnly, setShowStaleOnly] = useState(false);
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const [isRefreshingStale, setIsRefreshingStale] = useState(false);
  const [isGeneratingMissing, setIsGeneratingMissing] = useState(false);
  const [refreshingPhase, setRefreshingPhase] = useState<ProjectPhase | "all" | null>(null);
  const [generatingPhase, setGeneratingPhase] = useState<ProjectPhase | "all" | null>(null);
  const [lastRefreshResult, setLastRefreshResult] = useState<{
    rebuiltCount: number;
    skippedCount: number;
    scope: string;
    mode: MemoryBatchMode;
  } | null>(null);

  useEffect(() => {
    void fetchProjects();
  }, [selectedMemberId]);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingUsers(true);
    api
      .get<Array<{ id: number; display_name: string }>>("/auth/users/simple")
      .then((data) => {
        if (!cancelled) setUsers(data);
      })
      .catch((error) => console.error("Failed to load users:", error))
      .finally(() => {
        if (!cancelled) setIsLoadingUsers(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchProjects = async () => {
    try {
      setLoading(true);
      const url =
        selectedMemberId != null ? `/projects?member_user_id=${selectedMemberId}` : "/projects";
      const data = await api.get<Project[]>(url);
      setProjects(data);
      setLastRefreshResult(null);
      setRefreshingPhase(null);
      setGeneratingPhase(null);
    } catch (error) {
      console.error("Failed to fetch projects:", error);
    } finally {
      setLoading(false);
    }
  };

  const filteredProjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return projects
      .filter((project) => {
        const matchesQuery =
          !query ||
          project.name.toLowerCase().includes(query) ||
          project.client.toLowerCase().includes(query) ||
          (project.description && project.description.toLowerCase().includes(query)) ||
          (project.context_summary && project.context_summary.toLowerCase().includes(query));

        const matchesStale = !showStaleOnly || Boolean(project.memory_stale);
        const matchesMissing = !showMissingOnly || (project.memory_version || 0) === 0;
        return matchesQuery && matchesStale && matchesMissing;
      })
      .sort(compareProjectsByMemoryHealth);
  }, [projects, searchQuery, showMissingOnly, showStaleOnly]);

  const staleCount = useMemo(
    () => projects.filter((project) => Boolean(project.memory_stale)).length,
    [projects],
  );
  const readyCount = useMemo(
    () =>
      projects.filter(
        (project) => (project.memory_version || 0) > 0 && !project.memory_stale,
      ).length,
    [projects],
  );
  const noMemoryCount = useMemo(
    () => projects.filter((project) => (project.memory_version || 0) === 0).length,
    [projects],
  );

  const staleCountByPhase = useMemo(
    () => ({
      business: projects.filter(
        (project) => getProjectPhase(project) === "business" && Boolean(project.memory_stale),
      ).length,
      delivery: projects.filter(
        (project) => getProjectPhase(project) === "delivery" && Boolean(project.memory_stale),
      ).length,
      archived: projects.filter(
        (project) => getProjectPhase(project) === "archived" && Boolean(project.memory_stale),
      ).length,
    }),
    [projects],
  );

  const noMemoryCountByPhase = useMemo(
    () => ({
      business: projects.filter(
        (project) => getProjectPhase(project) === "business" && (project.memory_version || 0) === 0,
      ).length,
      delivery: projects.filter(
        (project) => getProjectPhase(project) === "delivery" && (project.memory_version || 0) === 0,
      ).length,
      archived: projects.filter(
        (project) => getProjectPhase(project) === "archived" && (project.memory_version || 0) === 0,
      ).length,
    }),
    [projects],
  );

  const phasePriority = useMemo(() => {
    const candidates: Array<{
      phase: ProjectPhase;
      missing: number;
      stale: number;
      score: number;
    }> = [
      {
        phase: "business",
        missing: noMemoryCountByPhase.business,
        stale: staleCountByPhase.business,
        score: noMemoryCountByPhase.business * 2 + staleCountByPhase.business,
      },
      {
        phase: "delivery",
        missing: noMemoryCountByPhase.delivery,
        stale: staleCountByPhase.delivery,
        score: noMemoryCountByPhase.delivery * 2 + staleCountByPhase.delivery,
      },
      {
        phase: "archived",
        missing: noMemoryCountByPhase.archived,
        stale: staleCountByPhase.archived,
        score: noMemoryCountByPhase.archived * 2 + staleCountByPhase.archived,
      },
    ];

    candidates.sort((left, right) => right.score - left.score);
    return candidates[0]?.score > 0 ? candidates[0] : null;
  }, [noMemoryCountByPhase, staleCountByPhase]);

  const handlePhaseBatch = (phase: ProjectPhase) => {
    const phaseProjects = projects.filter((project) => getProjectPhase(project) === phase);
    const mode: MemoryBatchMode = staleCountByPhase[phase] > 0 ? "stale" : "missing";
    void runProjectMemoryBatch(phaseProjects, phase, mode);
  };

  const runProjectMemoryBatch = async (
    targetProjects: Project[],
    scope: ProjectPhase | "all",
    mode: MemoryBatchMode,
  ) => {
    const candidateProjects = targetProjects.filter((project) =>
      mode === "stale" ? Boolean(project.memory_stale) : (project.memory_version || 0) === 0,
    );
    if (candidateProjects.length === 0) {
      return;
    }

    if (mode === "stale") {
      setIsRefreshingStale(true);
      setRefreshingPhase(scope);
    } else {
      setIsGeneratingMissing(true);
      setGeneratingPhase(scope);
    }

    try {
      const result = await api.post<ProjectMemoryBatchRebuildResponse>(
        "/projects/memory/rebuild-batch",
        {
          project_ids: candidateProjects.map((project) => project.id),
          stale_only: mode === "stale",
        },
        { timeout: 120000 },
      );
      const updates = new Map(result.rebuilt.map((item) => [item.project_id, item]));

      if (updates.size > 0) {
        setProjects((current) =>
          current.map((project) => {
            const update = updates.get(project.id);
            if (!update) return project;
            return {
              ...project,
              memory_stale: update.memory_stale,
              memory_updated_at: update.memory_updated_at ?? project.memory_updated_at,
              memory_version: update.memory_version,
              context_summary: update.memory.project_brief?.trim() || project.context_summary,
            };
          }),
        );
      }

      setLastRefreshResult({
        rebuiltCount: result.rebuilt_count,
        skippedCount: result.skipped.length,
        scope:
          scope === "all"
            ? isZh
              ? "全部项目"
              : "All Projects"
            : isZh
              ? PHASES[scope].labelZh
              : PHASES[scope].label,
        mode,
      });
    } catch (error) {
      console.error(
        `Failed to ${mode === "stale" ? "refresh stale" : "generate missing"} project memory:`,
        error,
      );
    } finally {
      if (mode === "stale") {
        setIsRefreshingStale(false);
        setRefreshingPhase(null);
      } else {
        setIsGeneratingMissing(false);
        setGeneratingPhase(null);
      }
    }
  };

  const refreshStaleProjects = async () => {
    await runProjectMemoryBatch(projects, "all", "stale");
  };

  const generateMissingProjects = async () => {
    await runProjectMemoryBatch(projects, "all", "missing");
  };

  const businessProjects = filteredProjects.filter((project) => getProjectPhase(project) === "business");
  const deliveryProjects = filteredProjects.filter((project) => getProjectPhase(project) === "delivery");
  const archivedProjects = filteredProjects.filter((project) => getProjectPhase(project) === "archived");

  if (loading) {
    return (
      <>
        <PageTitle title={t("projects.title")} />
        <div className="flex min-h-full items-center justify-center bg-gray-50">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </>
    );
  }

  return (
    <>
      <PageTitle title={t("projects.title")} />
      <div className="min-h-full bg-gradient-to-b from-gray-50 to-white">
        <ProjectsHeader
          isGeneratingMissing={isGeneratingMissing}
          isLoadingUsers={isLoadingUsers}
          isRefreshingStale={isRefreshingStale}
          isZh={isZh}
          onHandlePriorityPhase={
            phasePriority
              ? () => {
                  handlePhaseBatch(phasePriority.phase);
                }
              : null
          }
          lastRefreshResult={lastRefreshResult}
          noMemoryCount={noMemoryCount}
          onCreateProject={() => navigate("/projects/new")}
          onGenerateMissing={() => {
            void generateMissingProjects();
          }}
          onRefreshStale={() => {
            void refreshStaleProjects();
          }}
          onSearchChange={setSearchQuery}
          onMissingOnlyChange={setShowMissingOnly}
          onSelectedMemberChange={setSelectedMemberId}
          onStaleOnlyChange={setShowStaleOnly}
          readyCount={readyCount}
          searchQuery={searchQuery}
          selectedMemberId={selectedMemberId}
          priorityPhaseLabel={
            phasePriority ? (isZh ? PHASES[phasePriority.phase].labelZh : PHASES[phasePriority.phase].label) : null
          }
          priorityPhasePendingCount={phasePriority ? phasePriority.missing + phasePriority.stale : 0}
          showMissingOnly={showMissingOnly}
          showStaleOnly={showStaleOnly}
          staleCount={staleCount}
          totalCount={projects.length}
          users={users}
        />

        <div className="mx-auto max-w-full px-6 py-8">
          <ProjectsPhaseSection
            isExpanded={expandedPhase === "business"}
            isGenerating={isGeneratingMissing && generatingPhase === "business"}
            isRefreshing={isRefreshingStale && refreshingPhase === "business"}
            noMemoryCount={noMemoryCountByPhase.business}
            onProjectClick={(id) => navigate(`/projects/${id}`)}
            onRefreshPhase={() => {
              handlePhaseBatch("business");
            }}
            onToggle={() => setExpandedPhase(expandedPhase === "business" ? null : "business")}
            phase={PHASES.business}
            projects={businessProjects}
            staleCount={staleCountByPhase.business}
          />

          <ProjectsPhaseSection
            isExpanded={expandedPhase === "delivery"}
            isGenerating={isGeneratingMissing && generatingPhase === "delivery"}
            isRefreshing={isRefreshingStale && refreshingPhase === "delivery"}
            noMemoryCount={noMemoryCountByPhase.delivery}
            onProjectClick={(id) => navigate(`/projects/${id}`)}
            onRefreshPhase={() => {
              handlePhaseBatch("delivery");
            }}
            onToggle={() => setExpandedPhase(expandedPhase === "delivery" ? null : "delivery")}
            phase={PHASES.delivery}
            projects={deliveryProjects}
            staleCount={staleCountByPhase.delivery}
          />

          <ProjectsPhaseSection
            isExpanded={expandedPhase === "archived"}
            isGenerating={isGeneratingMissing && generatingPhase === "archived"}
            isRefreshing={isRefreshingStale && refreshingPhase === "archived"}
            noMemoryCount={noMemoryCountByPhase.archived}
            onProjectClick={(id) => navigate(`/projects/${id}`)}
            onRefreshPhase={() => {
              handlePhaseBatch("archived");
            }}
            onToggle={() => setExpandedPhase(expandedPhase === "archived" ? null : "archived")}
            phase={PHASES.archived}
            projects={archivedProjects}
            staleCount={staleCountByPhase.archived}
          />
        </div>
      </div>
    </>
  );
}
