import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import type {
  GeneratedArtifact,
  ProjectDetail as ProjectDetailType,
  ProjectMemory,
  ProjectMemoryResponse,
  ProjectMemorySummariesResponse,
  ProjectMemorySummaryType,
} from "../../types/api";
import {
  PROJECT_MEMORY_SUMMARY_TYPES,
  dispatchProjectMemorySummariesUpdated,
  normalizeProjectSummaryLanguage,
  subscribeProjectMemorySummariesUpdated,
  type ProjectMemorySummaryMap,
} from "./projectMemorySummarySync";
import { dispatchProjectMemoryStateUpdated } from "./useProjectDetailData";

const formatAmount = (amount: number | undefined | null): string => {
  if (!amount || amount === 0) return "0";
  return amount.toLocaleString("zh-CN");
};

const formatAmountInTenThousand = (amount: number | undefined | null): string => {
  if (!amount || amount === 0) return "0";
  const tenThousand = amount / 10000;
  if (tenThousand < 1) {
    return formatAmount(amount);
  }
  const hasFraction = tenThousand % 1 !== 0;
  return hasFraction
    ? tenThousand.toLocaleString("zh-CN", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })
    : tenThousand.toLocaleString("zh-CN");
};

interface UseProjectOverviewDataOptions {
  language: string;
  isZh: boolean;
  mdNotes: string;
  projectDetail: ProjectDetailType;
  projectId: string;
}

type SummaryCache = ProjectMemorySummaryMap;
const API_LIMIT_COOLDOWN_MS = 90_000;
const SUMMARY_GENERATION_LOCK_TTL_MS = 120_000;
const SUMMARY_GENERATION_LOCK_PREFIX = "aria:project-summary-generation";

function getSummaryGenerationLockKey(projectId: string, language: string, memoryVersion?: number) {
  return [
    SUMMARY_GENERATION_LOCK_PREFIX,
    projectId,
    normalizeProjectSummaryLanguage(language),
    memoryVersion ?? 0,
  ].join(":");
}

function readSummaryGenerationLock(lockKey: string) {
  if (typeof window === "undefined") return false;
  const rawValue = window.localStorage.getItem(lockKey);
  if (!rawValue) return false;
  const expiresAt = Number(rawValue);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    window.localStorage.removeItem(lockKey);
    return false;
  }
  return true;
}

function writeSummaryGenerationLock(lockKey: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(lockKey, String(Date.now() + SUMMARY_GENERATION_LOCK_TTL_MS));
}

function clearSummaryGenerationLock(lockKey: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(lockKey);
}

function hasCompleteSummaryCache(cache: SummaryCache) {
  return PROJECT_MEMORY_SUMMARY_TYPES.every((type) => !!cache[type]?.trim());
}

function isApiLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  const normalized = message.toLowerCase();
  return (
    normalized.includes("429") ||
    normalized.includes("rate limit") ||
    normalized.includes("too many requests") ||
    normalized.includes("engine_overloaded") ||
    message.includes("API 限流") ||
    message.includes("服务当前繁忙")
  );
}

function getApiLimitSummaryError(isZh: boolean) {
  return isZh
    ? "Kimi 当前触发 API 限流，不是风险模块故障。系统已暂停本页重新生成 90 秒，并记录到 API 限流页；请稍后重试或先使用已有项目记忆。"
    : "Kimi hit an API rate limit. This is not a risk-module failure. Regeneration is paused on this page for 90 seconds and recorded in API Limits; please retry later or use existing project memory.";
}

export function useProjectOverviewData({
  language,
  isZh,
  mdNotes,
  projectDetail,
  projectId,
}: UseProjectOverviewDataOptions) {
  const { files, milestones, project, todos } = projectDetail;
  const [summaryType, setSummaryType] = useState<ProjectMemorySummaryType>("overview");
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [summaryText, setSummaryText] = useState(project.context_summary || "");
  const [summaryError, setSummaryError] = useState("");
  const [summaryCooldownUntil, setSummaryCooldownUntil] = useState<number | null>(null);
  const summaryGenerationLockKey = useMemo(
    () => getSummaryGenerationLockKey(projectId, language, project.memory_version ?? 0),
    [language, project.memory_version, projectId],
  );
  const [hasPersistedSummaryGeneration, setHasPersistedSummaryGeneration] = useState(() =>
    readSummaryGenerationLock(summaryGenerationLockKey),
  );
  const [descExpanded, setDescExpanded] = useState(false);
  const [overviewNotesText, setOverviewNotesText] = useState((mdNotes || "").trim());
  const [recentArtifacts, setRecentArtifacts] = useState<GeneratedArtifact[]>([]);
  const [isLoadingArtifacts, setIsLoadingArtifacts] = useState(false);
  const [memory, setMemory] = useState<ProjectMemory | null>(null);
  const [isLoadingMemory, setIsLoadingMemory] = useState(false);
  const [isRebuildingMemory, setIsRebuildingMemory] = useState(false);
  const [summaryCache, setSummaryCache] = useState<SummaryCache>({
    overview: project.context_summary || "",
  });

  const startSummaryCooldown = () => {
    setSummaryCooldownUntil(Date.now() + API_LIMIT_COOLDOWN_MS);
  };

  const isSummaryCoolingDown = () => !!summaryCooldownUntil && Date.now() < summaryCooldownUntil;

  useEffect(() => {
    if (!summaryCooldownUntil) return;
    const delay = Math.max(summaryCooldownUntil - Date.now(), 0);
    const timer = window.setTimeout(() => setSummaryCooldownUntil(null), delay);
    return () => window.clearTimeout(timer);
  }, [summaryCooldownUntil]);

  useEffect(() => {
    const syncSummaryGenerationLock = () => {
      setHasPersistedSummaryGeneration(readSummaryGenerationLock(summaryGenerationLockKey));
    };

    syncSummaryGenerationLock();
    const timer = window.setInterval(syncSummaryGenerationLock, 1000);
    window.addEventListener("storage", syncSummaryGenerationLock);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", syncSummaryGenerationLock);
    };
  }, [summaryGenerationLockKey]);

  const firstMarkdownFile = useMemo(
    () =>
      [...files]
        .filter((file) => file.file_type?.toLowerCase() === "md")
        .sort(
          (a, b) =>
            new Date(a.uploaded_at).getTime() - new Date(b.uploaded_at).getTime(),
        )[0] || null,
    [files],
  );

  const recentTodos = useMemo(
    () => todos.filter((todo) => !todo.is_done).slice(0, 3),
    [todos],
  );

  const recentMilestones = useMemo(
    () =>
      [...milestones]
        .sort(
          (a, b) =>
            new Date(b.due_date || "").getTime() - new Date(a.due_date || "").getTime(),
        )
        .slice(0, 3),
    [milestones],
  );

  const recentFiles = useMemo(
    () =>
      [...files]
        .sort(
          (a, b) =>
            new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime(),
        )
        .slice(0, 5),
    [files],
  );

  useEffect(() => {
    let cancelled = false;

    const loadOverviewNotes = async () => {
      if (!firstMarkdownFile) {
        setOverviewNotesText((mdNotes || "").trim());
        return;
      }

      try {
        const data = await api.get<{ content: string }>(
          `/projects/${projectId}/documents/${firstMarkdownFile.id}`,
        );
        if (!cancelled) {
          setOverviewNotesText((data.content || "").trim() || (mdNotes || "").trim());
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load overview notes:", error);
          setOverviewNotesText((mdNotes || "").trim());
        }
      }
    };

    void loadOverviewNotes();
    return () => {
      cancelled = true;
    };
  }, [firstMarkdownFile, mdNotes, projectId]);

  useEffect(() => {
    let cancelled = false;

    const loadArtifacts = async () => {
      setIsLoadingArtifacts(true);
      try {
        const data = await api.get<GeneratedArtifact[]>(`/artifacts?project_id=${projectId}`);
        if (!cancelled) {
          setRecentArtifacts(data.slice(0, 5));
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load artifacts:", error);
          setRecentArtifacts([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingArtifacts(false);
        }
      }
    };

    void loadArtifacts();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;

    const loadMemory = async () => {
      setIsLoadingMemory(true);
      try {
        const data = await api.get<ProjectMemoryResponse>(`/projects/${projectId}/memory`);
        if (!cancelled) {
          setMemory(data.memory);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load project memory:", error);
          setMemory(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingMemory(false);
        }
      }
    };

    void loadMemory();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    setSummaryType("overview");
    setSummaryError("");
    setSummaryText(project.context_summary || "");
    setSummaryCache({ overview: project.context_summary || "" });
  }, [project.context_summary, projectId]);

  useEffect(() => {
    if (!project.memory_version) return;

    let cancelled = false;
    void api
      .get<ProjectMemorySummariesResponse>(`/projects/${projectId}/memory/summaries`, {
        params: { language },
      })
      .then((data) => {
        if (cancelled) return;
        const nextCache: SummaryCache = {
          overview: project.context_summary || "",
        };
        for (const type of PROJECT_MEMORY_SUMMARY_TYPES) {
          const content = data.summaries[type]?.content?.trim();
          if (content) nextCache[type] = content;
        }
        setSummaryCache(nextCache);
        if (hasCompleteSummaryCache(nextCache)) {
          clearSummaryGenerationLock(summaryGenerationLockKey);
          setHasPersistedSummaryGeneration(false);
        }
        const currentContent = nextCache[summaryType];
        if (currentContent) {
          setSummaryText(currentContent);
          setSummaryError("");
        }
      })
      .catch((error) => {
        if (!cancelled) console.error("Failed to load cached project summaries:", error);
      });

    return () => {
      cancelled = true;
    };
  }, [language, project.context_summary, project.memory_version, projectId, summaryType]);

  useEffect(() => {
    return subscribeProjectMemorySummariesUpdated((detail) => {
      const sameProject = detail.projectId === projectId;
      const sameLanguage = normalizeProjectSummaryLanguage(detail.language) === normalizeProjectSummaryLanguage(language);
      const sameVersion = !project.memory_version || !detail.memoryVersion || detail.memoryVersion === project.memory_version;
      if (!sameProject || !sameLanguage || !sameVersion) return;

      setSummaryCache((current) => ({
        ...current,
        ...detail.summaries,
      }));
      const nextContent = detail.summaries[summaryType]?.trim();
      if (!nextContent) return;
      setSummaryText(nextContent);
      setSummaryError("");
    });
  }, [language, project.memory_version, projectId, summaryType]);

  const refreshMemory = async () => {
    try {
      const data = await api.get<ProjectMemoryResponse>(`/projects/${projectId}/memory`);
      setMemory(data.memory);
      return data.memory;
    } catch (error) {
      console.error("Failed to refresh project memory:", error);
      return null;
    }
  };

  const rebuildMemory = async () => {
    setIsRebuildingMemory(true);
    try {
      const data = await api.post<ProjectMemoryResponse>(
        `/projects/${projectId}/memory/rebuild`,
        {},
        { timeout: 60000 },
      );
      setMemory(data.memory);
      dispatchProjectMemoryStateUpdated({
        projectId: Number(projectId),
        memory_stale: data.memory_stale,
        memory_updated_at: data.memory_updated_at,
        memory_version: data.memory_version,
        memory_rebuild_status: data.memory_rebuild_status ?? "idle",
        memory_rebuild_failed_at: data.memory_rebuild_failed_at ?? null,
        project_brief: data.memory.project_brief,
      });
    } finally {
      setIsRebuildingMemory(false);
    }
  };

  const generateAllMemorySummaries = async (
    nextType: ProjectMemorySummaryType = summaryType,
    force = true,
  ) => {
    if (!force && summaryCache[nextType]) {
      setSummaryType(nextType);
      setSummaryText(summaryCache[nextType] || "");
      setSummaryError("");
      return;
    }

    if (isSummaryCoolingDown()) {
      setSummaryError(getApiLimitSummaryError(isZh));
      return;
    }

    if (generatingSummary || readSummaryGenerationLock(summaryGenerationLockKey)) {
      setHasPersistedSummaryGeneration(true);
      setSummaryError(isZh ? "项目总结正在生成中，请稍候。" : "Project summaries are already being generated. Please wait.");
      return;
    }

    setSummaryType(nextType);
    setGeneratingSummary(true);
    setHasPersistedSummaryGeneration(true);
    writeSummaryGenerationLock(summaryGenerationLockKey);
    setSummaryError("");

    try {
      const data = await api.post<ProjectMemorySummariesResponse>(
        `/projects/${projectId}/memory/summaries/generate`,
        {
          force_refresh: force,
          language,
          rebuild_if_stale: true,
          summary_types: PROJECT_MEMORY_SUMMARY_TYPES,
        },
        { timeout: 90000 },
      );
      const nextCache: SummaryCache = {};
      for (const type of PROJECT_MEMORY_SUMMARY_TYPES) {
        const content = data.summaries[type]?.content?.trim();
        if (content) nextCache[type] = content;
      }
      setSummaryCache(nextCache);
      setSummaryText(nextCache[nextType] || "");
      if (hasCompleteSummaryCache(nextCache)) {
        clearSummaryGenerationLock(summaryGenerationLockKey);
        setHasPersistedSummaryGeneration(false);
      }
      dispatchProjectMemorySummariesUpdated({
        language,
        memoryVersion: data.source_memory_version || project.memory_version,
        projectId,
        summaries: nextCache,
      });
      await refreshMemory();
    } catch (error) {
      console.error("Failed to generate project summaries:", error);
      if (isApiLimitError(error)) {
        startSummaryCooldown();
        setSummaryError(getApiLimitSummaryError(isZh));
        return;
      }
      setSummaryError(
        error instanceof Error && error.message
          ? error.message
          : isZh
            ? "生成项目总结失败，请稍后重试"
            : "Failed to generate project summaries, please try again",
      );
    } finally {
      setGeneratingSummary(false);
      clearSummaryGenerationLock(summaryGenerationLockKey);
      setHasPersistedSummaryGeneration(false);
    }
  };

  const generateSummary = async (
    nextType: ProjectMemorySummaryType = summaryType,
    force = true,
  ) => {
    await generateAllMemorySummaries(nextType, force);
  };

  const handleSummaryTypeChange = (nextType: ProjectMemorySummaryType) => {
    setSummaryType(nextType);
    setSummaryError("");

    if (nextType === "overview") {
      setSummaryText(summaryCache.overview || project.context_summary || "");
      return;
    }

    const cached = summaryCache[nextType];
    if (cached) {
      setSummaryText(cached);
      return;
    }

    setSummaryText("");
  };

  return {
    descExpanded,
    formatAmount,
    formatAmountInTenThousand,
    generateSummary,
    generatingSummary: generatingSummary || hasPersistedSummaryGeneration,
    handleSummaryTypeChange,
    isLoadingArtifacts,
    isLoadingMemory,
    isRebuildingMemory,
    memory,
    overviewNotesText,
    recentArtifacts,
    recentFiles,
    recentMilestones,
    recentTodos,
    rebuildMemory,
    setDescExpanded,
    summaryCooldownUntil,
    summaryError,
    summaryText,
    summaryType,
  };
}
