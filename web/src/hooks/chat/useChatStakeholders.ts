import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { Message } from "../../types/api";
export type { StakeholderCandidate } from "../../types/chat";
import type { StakeholderCandidate } from "../../types/chat";

export const NON_PERSON_STAKEHOLDER_TERMS = [
  "数据", "安全", "系统", "方案", "报价", "合同", "需求", "交付", "品牌", "渠道",
  "战略", "高管", "管理", "产品", "技术", "财务", "采购", "法务", "商务", "运维",
  "市场", "销售", "部门", "业务", "项目", "客户", "公司",
];

export const ROLE_ONLY_STAKEHOLDER_NAMES = new Set([
  "采购负责人", "财务负责人", "法务负责人", "安全负责人", "业务负责人",
  "技术负责人", "项目负责人", "产品经理", "品牌负责人", "渠道负责人",
  "战略部", "高管层", "管理层",
]);

export function isDisplayableStakeholderCandidate(candidate: StakeholderCandidate): boolean {
  const name = candidate.name.trim();
  const role = candidate.role.trim();
  if (!name || ROLE_ONLY_STAKEHOLDER_NAMES.has(name)) return false;
  if (
    /^[\u4e00-\u9fa5]{2,6}$/.test(name) &&
    NON_PERSON_STAKEHOLDER_TERMS.some((term) => name.includes(term))
  ) {
    return false;
  }
  return Boolean(role);
}

export function filterDisplayableStakeholders(candidates: StakeholderCandidate[]): StakeholderCandidate[] {
  return candidates.filter(isDisplayableStakeholderCandidate);
}

interface AutoStakeholderBanner {
  candidates: StakeholderCandidate[];
  clientName: string;
  sourceText: string;
}

interface UseChatStakeholdersResult {
  autoStakeholderBanner: AutoStakeholderBanner | null;
  dismissedAutoDetectRef: React.MutableRefObject<string>;
  setAutoStakeholderBanner: (banner: AutoStakeholderBanner | null) => void;
}

export function useChatStakeholders(
  projectId: number,
  messages: Message[],
  isLoading: boolean
): UseChatStakeholdersResult {
  const [autoStakeholderBanner, setAutoStakeholderBanner] = useState<AutoStakeholderBanner | null>(null);
  const prevIsLoadingRef = useRef(false);
  const dismissedAutoDetectRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    if (prevIsLoadingRef.current && !isLoading) {
      const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
      if (
        lastAssistant &&
        lastAssistant.content.length > 30 &&
        lastAssistant.content !== dismissedAutoDetectRef.current
      ) {
        void (async () => {
          try {
            const result = await api.post<{
              client_name: string;
              candidates: StakeholderCandidate[];
            }>(`/projects/${projectId}/stakeholder-candidates`, {
              text: lastAssistant.content,
            });
            if (cancelled) return;
            const displayable = filterDisplayableStakeholders(result.candidates);
            if (displayable.length > 0) {
              setAutoStakeholderBanner({
                candidates: displayable,
                clientName: result.client_name,
                sourceText: lastAssistant.content,
              });
            }
          } catch {
            // silently ignore
          }
        })();
      }
    }
    prevIsLoadingRef.current = isLoading;
    return () => {
      cancelled = true;
    };
  }, [isLoading, messages, projectId]);

  return {
    autoStakeholderBanner,
    dismissedAutoDetectRef,
    setAutoStakeholderBanner,
  };
}
