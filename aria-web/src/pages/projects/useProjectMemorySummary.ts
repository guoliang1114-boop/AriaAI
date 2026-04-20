import { useEffect, useState } from "react";
import type {
  ProjectMemorySummariesResponse,
  ProjectMemorySummaryResponse,
  ProjectMemorySummaryType,
} from "../../types/api";

interface UseProjectMemorySummaryOptions {
  enabled?: boolean;
  errorMessage: string;
  language: string;
  memoryVersion?: number;
  projectId: string;
  summaryType: ProjectMemorySummaryType;
}

const memorySummaryCache = new Map<string, string>();

function normalizeSummaryLanguage(language: string) {
  const normalized = language.trim().toLowerCase();
  if (normalized.startsWith("zh")) return "zh";
  if (normalized.startsWith("en")) return "en";
  return normalized || "default";
}

function buildSummaryCacheKey(options: {
  language: string;
  memoryVersion?: number;
  projectId: string;
  summaryType: ProjectMemorySummaryType;
}) {
  return [
    options.projectId,
    options.summaryType,
    normalizeSummaryLanguage(options.language),
    options.memoryVersion ?? 0,
  ].join(":");
}

async function streamMemorySummary(options: {
  errorMessage: string;
  forceRefresh?: boolean;
  language: string;
  memoryVersion?: number;
  projectId: string;
  summaryType: ProjectMemorySummaryType;
  onChunk: (value: string) => void;
}) {
  if (options.forceRefresh) {
    const token = localStorage.getItem("authToken") || "";
    const response = await fetch(`/api/projects/${options.projectId}/memory/summaries/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": token,
      },
      body: JSON.stringify({
        force_refresh: true,
        language: options.language,
        rebuild_if_stale: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as ProjectMemorySummariesResponse;
    for (const [summaryType, summary] of Object.entries(data.summaries)) {
      const content = summary?.content?.trim();
      if (!content) continue;
      memorySummaryCache.set(
        buildSummaryCacheKey({
          language: options.language,
          memoryVersion: data.source_memory_version || options.memoryVersion,
          projectId: options.projectId,
          summaryType: summaryType as ProjectMemorySummaryType,
        }),
        content,
      );
    }

    const content = data.summaries[options.summaryType]?.content?.trim() || "";
    options.onChunk(content);
    return content;
  }

  const token = localStorage.getItem("authToken") || "";
  const response = await fetch(`/api/projects/${options.projectId}/memory/summarize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Auth-Token": token,
    },
    body: JSON.stringify({
      force_refresh: options.forceRefresh ?? false,
      language: options.language,
      rebuild_if_stale: true,
      stream: true,
      summary_type: options.summaryType,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return "";
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = JSON.parse(line.slice(6)) as {
        type?: string;
        content?: string;
        message?: string;
      };

      if (data.type === "text" && data.content) {
        content += data.content;
        options.onChunk(content);
      } else if (data.type === "done") {
        content = (data.content || content).trim();
        options.onChunk(content);
      } else if (data.type === "error") {
        throw new Error(data.message || options.errorMessage);
      }
    }
  }

  return content.trim();
}

async function loadCachedMemorySummary(options: {
  language: string;
  projectId: string;
  summaryType: ProjectMemorySummaryType;
}) {
  const token = localStorage.getItem("authToken") || "";
  const params = new URLSearchParams({ language: options.language });
  const response = await fetch(
    `/api/projects/${options.projectId}/memory/summaries/${encodeURIComponent(options.summaryType)}?${params.toString()}`,
    {
      headers: {
        "X-Auth-Token": token,
      },
    },
  );

  if (response.status === 404) return "";
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as ProjectMemorySummaryResponse;
  return data.content?.trim() || "";
}

export function useProjectMemorySummary({
  enabled = true,
  errorMessage,
  language,
  memoryVersion,
  projectId,
  summaryType,
}: UseProjectMemorySummaryOptions) {
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const cacheKey = buildSummaryCacheKey({
    language,
    memoryVersion,
    projectId,
    summaryType,
  });

  const refresh = async (forceRefresh = false) => {
    if (!forceRefresh) {
      const cached = memorySummaryCache.get(cacheKey);
      if (cached) {
        setError("");
        setContent(cached);
        setLoading(false);
        return cached;
      }
    }

    setLoading(true);
    setError("");
    setContent("");

    try {
      const nextContent = await streamMemorySummary({
        errorMessage,
        forceRefresh,
        language,
        memoryVersion,
        onChunk: setContent,
        projectId,
        summaryType,
      });
      memorySummaryCache.set(cacheKey, nextContent);
      setContent(nextContent);
      return nextContent;
    } catch (nextError) {
      console.error("Failed to load project memory summary:", nextError);
      setError(
        nextError instanceof Error && nextError.message ? nextError.message : errorMessage,
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!enabled) return;
    const cached = memorySummaryCache.get(cacheKey);
    if (cached) {
      setContent(cached);
      setError("");
      setLoading(false);
      return;
    }

    if (!memoryVersion) return;

    let cancelled = false;
    void loadCachedMemorySummary({ language, projectId, summaryType })
      .then((cachedContent) => {
        if (cancelled || !cachedContent) return;
        memorySummaryCache.set(cacheKey, cachedContent);
        setContent(cachedContent);
        setError("");
        setLoading(false);
      })
      .catch((nextError) => {
        if (cancelled) return;
        console.error("Failed to load cached project memory summary:", nextError);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, enabled, language, memoryVersion, projectId, summaryType]);

  return {
    content,
    error,
    loading,
    refresh,
  };
}
