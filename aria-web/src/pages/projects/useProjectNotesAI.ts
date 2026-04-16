import { useState } from "react";

import { getApiBaseUrl } from "../../config/api";
import { getProjectNotesCopy } from "./projectNotesCopy";

type ApplyMode = "replace" | "append";

interface UseProjectNotesAIOptions {
  content: string;
  isZh: boolean;
  onToastError: (message: string) => void;
  onToastSuccess: (message: string) => void;
  projectId: string;
  updateContent: (value: string) => void;
}

export function useProjectNotesAI({
  content,
  isZh,
  onToastError,
  onToastSuccess,
  projectId,
  updateContent,
}: UseProjectNotesAIOptions) {
  const copy = getProjectNotesCopy(isZh);
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiDraft, setAiDraft] = useState("");
  const [aiResult, setAiResult] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  const openAIModal = () => setShowAIModal(true);

  const closeAIModal = () => {
    setShowAIModal(false);
    setAiDraft("");
    setAiResult("");
  };

  const handleAIGenerate = async () => {
    const draft = aiDraft.trim() || content.trim();
    if (!draft) return;

    setAiLoading(true);
    setAiResult("");

    try {
      const response = await fetch(
        `${getApiBaseUrl()}/projects/${projectId}/notes/ai-polish-stream`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Auth-Token": localStorage.getItem("authToken") || "",
          },
          body: JSON.stringify({ draft }),
        },
      );

      if (!response.ok) throw new Error("Network response was not ok");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const event of events) {
          const line = event
            .split("\n")
            .map((item) => item.trim())
            .find((item) => item.startsWith("data: "));
          if (!line) continue;

          try {
            const payload = JSON.parse(line.replace(/^data:\s*/, ""));
            if (payload.type === "text" && payload.content) {
              setAiResult((current) => current + payload.content);
            } else if (payload.type === "error") {
              throw new Error(payload.message || "AI generation failed");
            }
          } catch (error) {
            console.error("Failed to parse stream event:", error);
          }
        }
      }
    } catch (error: any) {
      console.error("AI generation failed:", error);
      onToastError(error?.message || copy.aiGenerationFailed);
    } finally {
      setAiLoading(false);
    }
  };

  const applyAIResult = (applyMode: ApplyMode) => {
    const currentResult = aiResult.trim();
    if (!currentResult) return;

    const nextContent =
      applyMode === "replace"
        ? currentResult
        : `${content.trim() ? `${content}\n\n---\n\n` : ""}${currentResult}`;

    updateContent(nextContent);
    closeAIModal();
    onToastSuccess(copy.aiApplied);
  };

  return {
    aiDraft,
    aiLoading,
    aiResult,
    applyAIResult,
    closeAIModal,
    handleAIGenerate,
    openAIModal,
    setAiDraft,
    showAIModal,
  };
}
