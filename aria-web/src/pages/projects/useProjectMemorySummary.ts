import { useEffect, useState } from "react";
import type {
  ProjectMemorySummariesResponse,
  ProjectMemorySummaryResponse,
  ProjectMemorySummaryType,
} from "../../types/api";
import {
  dispatchProjectMemorySummariesUpdated,
  normalizeProjectSummaryLanguage,
  subscribeProjectMemorySummariesUpdated,
  type ProjectMemorySummaryMap,
} from "./projectMemorySummarySync";

interface UseProjectMemorySummaryOptions {
  enabled?: boolean;
  errorMessage: string;
  language: string;
  memoryVersion?: number;
  projectId: string;
  summaryType: ProjectMemorySummaryType;
}

const memorySummaryCache = new Map<string, string>();
const generatedSummaryKeys = new Set<string>();
const memorySummaryGenerationRequests = new Map<
  string,
  Promise<{
    memoryVersion?: number;
    summaries: ProjectMemorySummaryMap;
  }>
>();

function normalizeSummaryLanguage(language: string) {
  return normalizeProjectSummaryLanguage(language);
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

function buildSummaryGenerationKey(options: {
  language: string;
  memoryVersion?: number;
  projectId: string;
}) {
  return [
    options.projectId,
    normalizeSummaryLanguage(options.language),
    options.memoryVersion ?? 0,
  ].join(":");
}

function cacheSummaryMap(options: {
  language: string;
  memoryVersion?: number;
  projectId: string;
  summaries: ProjectMemorySummaryMap;
}) {
  for (const [summaryType, content] of Object.entries(options.summaries)) {
    const trimmed = content?.trim() || "";
    const cacheKey = buildSummaryCacheKey({
      language: options.language,
      memoryVersion: options.memoryVersion,
      projectId: options.projectId,
      summaryType: summaryType as ProjectMemorySummaryType,
    });
    generatedSummaryKeys.add(cacheKey);
    memorySummaryCache.set(
      cacheKey,
      trimmed,
    );
  }
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
    const generationKey = buildSummaryGenerationKey({
      language: options.language,
      memoryVersion: options.memoryVersion,
      projectId: options.projectId,
    });

    let generationRequest = memorySummaryGenerationRequests.get(generationKey);
    if (!generationRequest) {
      generationRequest = (async () => {
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
        const summaries: ProjectMemorySummaryMap = {};
        for (const [summaryType, summary] of Object.entries(data.summaries)) {
          summaries[summaryType as ProjectMemorySummaryType] = summary?.content?.trim() || "";
        }

        const nextMemoryVersion = data.source_memory_version || options.memoryVersion;
        cacheSummaryMap({
          language: options.language,
          memoryVersion: nextMemoryVersion,
          projectId: options.projectId,
          summaries,
        });
        dispatchProjectMemorySummariesUpdated({
          language: options.language,
          memoryVersion: nextMemoryVersion,
          projectId: options.projectId,
          summaries,
        });

        return {
          memoryVersion: nextMemoryVersion,
          summaries,
        };
      })().finally(() => {
        memorySummaryGenerationRequests.delete(generationKey);
      });
      memorySummaryGenerationRequests.set(generationKey, generationRequest);
    }

    const data = await generationRequest;
    const content = data.summaries[options.summaryType]?.trim() || "";
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

  if (response.status === 404) return { content: "", found: false };
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as ProjectMemorySummaryResponse;
  return {
    content: data.content?.trim() || "",
    found: true,
  };
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
  const [generated, setGenerated] = useState(false);
  const [loading, setLoading] = useState(false);
  const cacheKey = buildSummaryCacheKey({
    language,
    memoryVersion,
    projectId,
    summaryType,
  });

  const refresh = async (forceRefresh = false) => {
    if (!forceRefresh) {
      if (memorySummaryCache.has(cacheKey)) {
        const cached = memorySummaryCache.get(cacheKey) || "";
        setError("");
        setContent(cached);
        setGenerated(generatedSummaryKeys.has(cacheKey));
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
      generatedSummaryKeys.add(cacheKey);
      memorySummaryCache.set(cacheKey, nextContent);
      setContent(nextContent);
      setGenerated(true);
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
    if (memorySummaryCache.has(cacheKey)) {
      setContent(cached || "");
      setError("");
      setGenerated(generatedSummaryKeys.has(cacheKey));
      setLoading(false);
      return;
    }

    if (!memoryVersion) {
      setGenerated(false);
      return;
    }

    let cancelled = false;
    void loadCachedMemorySummary({ language, projectId, summaryType })
      .then((cachedSummary) => {
        if (cancelled || !cachedSummary.found) return;
        generatedSummaryKeys.add(cacheKey);
        memorySummaryCache.set(cacheKey, cachedSummary.content);
        setContent(cachedSummary.content);
        setError("");
        setGenerated(true);
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

  useEffect(() => {
    if (!enabled) return;
    return subscribeProjectMemorySummariesUpdated((detail) => {
      const sameProject = detail.projectId === projectId;
      const sameLanguage = normalizeSummaryLanguage(detail.language) === normalizeSummaryLanguage(language);
      const sameVersion = !memoryVersion || !detail.memoryVersion || detail.memoryVersion === memoryVersion;
      if (!sameProject || !sameLanguage || !sameVersion) return;

      cacheSummaryMap({
        language,
        memoryVersion: detail.memoryVersion || memoryVersion,
        projectId,
        summaries: detail.summaries,
      });
      if (!(summaryType in detail.summaries)) return;
      const nextContent = detail.summaries[summaryType]?.trim() || "";
      generatedSummaryKeys.add(cacheKey);
      setContent(nextContent);
      setError("");
      setGenerated(true);
      setLoading(false);
    });
  }, [enabled, language, memoryVersion, projectId, summaryType]);

  return {
    content,
    error,
    generated,
    loading,
    refresh,
  };
}
