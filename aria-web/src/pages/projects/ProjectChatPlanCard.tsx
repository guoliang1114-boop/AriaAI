import { memo } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, ListChecks, Play, Wrench, X } from "lucide-react";
import type { ChatPlanResponse } from "../../types/api";

interface ProjectChatPlanCardProps {
  plan: ChatPlanResponse;
  isGenerating?: boolean;
  onExecute: () => void;
  onCancel: () => void;
}

export const ProjectChatPlanCard = memo<ProjectChatPlanCardProps>(
  ({ plan, isGenerating, onExecute, onCancel }) => {
    const { i18n } = useTranslation();
    const isZh = i18n.language.startsWith("zh");

    return (
      <div className="mx-auto flex max-w-4xl items-start gap-3.5">
        <div className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 bg-gradient-to-br from-indigo-500 to-violet-500 shadow-sm shadow-indigo-500/20">
          <ListChecks className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="flex-1 min-w-0 flex flex-col items-stretch">
          <p className="text-[11px] font-medium text-gray-400 mb-1.5 px-0.5">
            {isZh ? "执行计划" : "Execution Plan"}
          </p>

          <div className="w-full max-w-none rounded-xl border border-indigo-100 bg-indigo-50/40 px-4 py-3">
            {isGenerating ? (
              <div className="flex items-center gap-2 text-sm text-indigo-600">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
                {isZh ? "正在制定执行计划…" : "Generating execution plan…"}
              </div>
            ) : (
              <>
                <div className="md-root w-full text-[15px] leading-[1.8] text-gray-700 whitespace-pre-wrap">
                  {plan.plan_text}
                </div>

                {plan.planned_tools.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    <p className="text-xs font-medium text-indigo-700">
                      {isZh ? "计划调用的工具" : "Planned tools"}
                    </p>
                    {plan.planned_tools.map((tool, index) => (
                      <div
                        key={`${tool.name}-${index}`}
                        className="flex items-center gap-2 rounded-lg border border-indigo-100 bg-white px-3 py-2"
                      >
                        <Wrench className="h-3.5 w-3.5 text-indigo-400" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-700">{tool.name}</p>
                          <p className="text-xs text-gray-400">{tool.input_summary}</p>
                        </div>
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-4 flex items-center gap-2">
                  <button
                    onClick={onExecute}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700"
                  >
                    <Play className="h-3.5 w-3.5" />
                    {isZh ? "执行此计划" : "Execute plan"}
                  </button>
                  <button
                    onClick={onCancel}
                    className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-500 transition hover:bg-gray-100"
                  >
                    {isZh ? "取消" : "Cancel"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  },
);
