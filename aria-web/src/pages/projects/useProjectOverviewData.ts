import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import type {
  GeneratedArtifact,
  ProjectDetail as ProjectDetailType,
  ProjectMemory,
  ProjectMemoryResponse,
  ProjectMemorySummaryResponse,
  ProjectMemorySummaryType,
} from "../../types/api";

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

type SummaryCache = Partial<Record<ProjectMemorySummaryType, string>>;
const API_LIMIT_COOLDOWN_MS = 90_000;

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

async function streamSummaryRequest<TDone extends object>(options: {
  body?: Record<string, unknown>;
  errorMessage: string;
  onChunk: (content: string) => void;
  onDone?: (payload: TDone) => void;
  url: string;
}) {
  const token = localStorage.getItem("authToken") || "";
  const response = await fetch(options.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Auth-Token": token,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return "";
  }

  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;

      const data = JSON.parse(line.slice(6)) as
        | ({ type?: "text"; content?: string; message?: string } & TDone)
        | ({ type?: "done"; content?: string; message?: string } & TDone)
        | ({ type?: "error"; content?: string; message?: string } & TDone);

      if (data.type === "text" && data.content) {
        fullText += data.content;
        options.onChunk(fullText);
        continue;
      }

      if (data.type === "done") {
        fullText = (data.content || fullText).trim();
        options.onChunk(fullText);
        options.onDone?.(data);
        continue;
      }

      if (data.type === "error") {
        throw new Error(data.message || options.errorMessage);
      }
    }
  }

  return fullText.trim();
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
  const [descExpanded, setDescExpanded] = useState(false);
  const [overviewNotesText, setOverviewNotesText] = useState((mdNotes || "").trim());
  const [recentArtifacts, setRecentArtifacts] = useState<GeneratedArtifact[]>([]);
  const [isLoadingArtifacts, setIsLoadingArtifacts] = useState(false);
  const [memory, setMemory] = useState<ProjectMemory | null>(null);
  const [isLoadingMemory, setIsLoadingMemory] = useState(false);
  const [isRebuildingMemory, setIsRebuildingMemory] = useState(false);
  const autoRefreshAttemptedRef = useRef<string>("");
  const [pendingSummaryRefresh, setPendingSummaryRefresh] =
    useState<Exclude<ProjectMemorySummaryType, "overview"> | null>(null);
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
      if (summaryType !== "overview" && summaryText.trim()) {
        setSummaryCache((current) => {
          const next = { ...current };
          delete next[summaryType];
          return next;
        });
        setPendingSummaryRefresh(summaryType);
      }
    } finally {
      setIsRebuildingMemory(false);
    }
  };

  useEffect(() => {
    if (!memory?.stale || isLoadingMemory || isRebuildingMemory) {
      return;
    }

    const attemptKey = `${projectId}:${memory.memory_version ?? 0}`;
    if (autoRefreshAttemptedRef.current === attemptKey) {
      return;
    }
    autoRefreshAttemptedRef.current = attemptKey;

    const timer = window.setTimeout(() => {
      void rebuildMemory();
    }, 1500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isLoadingMemory, isRebuildingMemory, memory?.memory_version, memory?.stale, projectId]);

  useEffect(() => {
    if (!pendingSummaryRefresh || isRebuildingMemory) {
      return;
    }

    const summaryTypeToRefresh = pendingSummaryRefresh;
    setPendingSummaryRefresh(null);
    void generateMemorySummary(summaryTypeToRefresh, true);
  }, [isRebuildingMemory, pendingSummaryRefresh]);

  const generateOverviewSummary = async () => {
    if (isSummaryCoolingDown()) {
      setSummaryError(getApiLimitSummaryError(isZh));
      return;
    }

    setGeneratingSummary(true);
    setSummaryText("");
    setSummaryError("");

    try {
      const fullSummary = await streamSummaryRequest<{ context_summary?: string }>({
        body: {
          language,
        },
        errorMessage: isZh
          ? "生成项目总结失败，请稍后重试"
          : "Failed to generate project summary, please try again",
        onChunk: setSummaryText,
        onDone: (data) => {
          if (data.context_summary) {
            setSummaryText(data.context_summary);
          }
        },
        url: `/api/projects/${projectId}/generate-context`,
      });

      setSummaryCache((current) => ({
        ...current,
        overview: fullSummary,
      }));
      await refreshMemory();
    } catch (error) {
      console.error("Failed to generate summary:", error);
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
            : "Failed to generate summary, please try again",
      );
    } finally {
      setGeneratingSummary(false);
    }
  };

  const generateMemorySummary = async (
    nextType: Exclude<ProjectMemorySummaryType, "overview">,
    force = false,
  ) => {
    if (!force && summaryCache[nextType]) {
      setSummaryText(summaryCache[nextType] || "");
      setSummaryError("");
      return;
    }

    if (isSummaryCoolingDown()) {
      setSummaryError(getApiLimitSummaryError(isZh));
      return;
    }

    setGeneratingSummary(true);
    setSummaryError("");
    setSummaryText("");

    try {
      const content = await streamSummaryRequest<ProjectMemorySummaryResponse>({
        body: {
          language,
          summary_type: nextType,
          rebuild_if_stale: true,
          stream: true,
        },
        errorMessage: isZh
          ? "生成项目摘要失败，请稍后重试"
          : "Failed to generate project summary, please try again",
        onChunk: setSummaryText,
        url: `/api/projects/${projectId}/memory/summarize`,
      });

      setSummaryCache((current) => ({
        ...current,
        [nextType]: content,
      }));
      setSummaryText(content);
      await refreshMemory();
    } catch (error) {
      console.error("Failed to generate memory summary:", error);
      if (isApiLimitError(error)) {
        startSummaryCooldown();
        setSummaryError(getApiLimitSummaryError(isZh));
        return;
      }
      setSummaryError(
        error instanceof Error && error.message
          ? error.message
          : isZh
            ? "生成项目摘要失败，请稍后重试"
            : "Failed to generate project summary, please try again",
      );
    } finally {
      setGeneratingSummary(false);
    }
  };

  const generateSummary = async (
    nextType: ProjectMemorySummaryType = summaryType,
    force = true,
  ) => {
    if (nextType === "overview") {
      await generateOverviewSummary();
      return;
    }
    await generateMemorySummary(nextType, force);
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
    void generateMemorySummary(nextType, false);
  };

  return {
    descExpanded,
    formatAmount,
    formatAmountInTenThousand,
    generateSummary,
    generatingSummary,
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
