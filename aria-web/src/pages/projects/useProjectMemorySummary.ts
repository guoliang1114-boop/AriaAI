import { useEffect, useState } from "react";
import type { ProjectMemorySummaryType } from "../../types/api";

interface UseProjectMemorySummaryOptions {
  enabled?: boolean;
  errorMessage: string;
  language: string;
  projectId: string;
  summaryType: ProjectMemorySummaryType;
}

async function streamMemorySummary(options: {
  errorMessage: string;
  language: string;
  projectId: string;
  summaryType: ProjectMemorySummaryType;
  onChunk: (value: string) => void;
}) {
  const token = localStorage.getItem("authToken") || "";
  const response = await fetch(`/api/projects/${options.projectId}/memory/summarize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Auth-Token": token,
    },
    body: JSON.stringify({
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

export function useProjectMemorySummary({
  enabled = true,
  errorMessage,
  language,
  projectId,
  summaryType,
}: UseProjectMemorySummaryOptions) {
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError("");
    setContent("");

    try {
      const nextContent = await streamMemorySummary({
        errorMessage,
        language,
        onChunk: setContent,
        projectId,
        summaryType,
      });
      setContent(nextContent);
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
    void refresh();
  }, [enabled, language, projectId, summaryType]);

  return {
    content,
    error,
    loading,
    refresh,
  };
}
