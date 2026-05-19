import { useCallback } from "react";
import { api } from "../../api/client";
import type { ChatPlanResponse, SendMessageRequest } from "../../types/api";
import { parseMentions } from "../../pages/projects/projectChatMentions";

interface UseChatPlanParams {
  activeConvId: number | null;
  projectId: number;
  selectedSkillId: number | null;
  forceSkill: boolean;
  knowledgeScope: "project" | "client" | "global";
  selectedModel: string;
  onPlanGenerated?: () => void;
  onPlanError?: () => void;
}

interface UseChatPlanResult {
  generatePlan: (content: string) => Promise<ChatPlanResponse | null>;
}

export function useChatPlan({
  activeConvId,
  projectId,
  selectedSkillId,
  forceSkill,
  knowledgeScope,
  selectedModel,
  onPlanGenerated,
  onPlanError,
}: UseChatPlanParams): UseChatPlanResult {
  const generatePlan = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return null;

      const mentions = parseMentions(trimmed);
      const mentionContext =
        mentions.length > 0
          ? {
              file_ids: mentions.filter((m) => m.type === "file").map((m) => m.id),
              stakeholder_ids: mentions.filter((m) => m.type === "stakeholder").map((m) => m.id),
              milestone_ids: mentions.filter((m) => m.type === "milestone").map((m) => m.id),
            }
          : undefined;

      const body: SendMessageRequest = {
        conversation_id: activeConvId ?? undefined,
        content: trimmed,
        project_id: projectId,
        skill_id: selectedSkillId ?? undefined,
        force_skill: forceSkill,
        knowledge_scope: knowledgeScope,
        model: selectedModel || undefined,
        mention_context: mentionContext,
      };

      try {
        const response = await api.post<ChatPlanResponse>("/chat/plan", body);
        onPlanGenerated?.();
        return response;
      } catch {
        onPlanError?.();
        return null;
      }
    },
    [
      activeConvId,
      projectId,
      selectedSkillId,
      forceSkill,
      knowledgeScope,
      selectedModel,
      onPlanGenerated,
      onPlanError,
    ]
  );

  return { generatePlan };
}
