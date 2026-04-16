import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import type { ProjectDetail as ProjectDetailType } from "../../types/api";

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
  isZh: boolean;
  mdNotes: string;
  projectDetail: ProjectDetailType;
  projectId: string;
}

export function useProjectOverviewData({
  isZh,
  mdNotes,
  projectDetail,
  projectId,
}: UseProjectOverviewDataOptions) {
  const { files, milestones, project, todos } = projectDetail;
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [summaryText, setSummaryText] = useState(project.context_summary || "");
  const [summaryError, setSummaryError] = useState("");
  const [descExpanded, setDescExpanded] = useState(false);
  const [overviewNotesText, setOverviewNotesText] = useState((mdNotes || "").trim());

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
            new Date(b.due_date || "").getTime() -
            new Date(a.due_date || "").getTime(),
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

  const generateSummary = async () => {
    setGeneratingSummary(true);
    setSummaryText("");
    setSummaryError("");

    try {
      const token = localStorage.getItem("authToken") || "";
      const response = await fetch(`/api/projects/${projectId}/generate-context`, {
        method: "POST",
        headers: {
          "X-Auth-Token": token,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullSummary = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === "text" && data.content) {
                  fullSummary += data.content;
                  setSummaryText(fullSummary);
                } else if (data.type === "done") {
                  fullSummary = data.context_summary || fullSummary;
                  setSummaryText(fullSummary);
                }
              } catch {
                // Ignore malformed stream lines and keep the stream alive.
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Failed to generate summary:", error);
      setSummaryError(
        isZh
          ? "鐢熸垚鎽樿澶辫触锛岃绋嶅悗閲嶈瘯"
          : "Failed to generate summary, please try again",
      );
    } finally {
      setGeneratingSummary(false);
    }
  };

  return {
    descExpanded,
    formatAmount,
    formatAmountInTenThousand,
    generateSummary,
    generatingSummary,
    overviewNotesText,
    recentFiles,
    recentMilestones,
    recentTodos,
    setDescExpanded,
    summaryError,
    summaryText,
  };
}
