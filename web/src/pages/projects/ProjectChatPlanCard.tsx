import { memo } from "react";
import { useTranslation } from "react-i18next";
import { ListChecks, Loader2, Play, X } from "lucide-react";
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

    // Codex plan card: quiet accent tint with hairline border + step
    // progress dots. The avatar swaps the old indigo→violet gradient
    // for the accent-bg square used elsewhere in the redesign.
    return (
      <div className="mx-auto flex max-w-4xl items-start" style={{ gap: 14 }}>
        <span
          className="inline-flex flex-shrink-0 items-center justify-center"
          style={{
            width: 28,
            height: 28,
            marginTop: 2,
            borderRadius: "var(--codex-r-sm, 6px)",
            background: "var(--color-codex-accent-bg)",
            color: "var(--color-codex-accent)",
          }}
        >
          <ListChecks className="h-3.5 w-3.5" />
        </span>

        <div className="flex min-w-0 flex-1 flex-col items-stretch">
          <p
            style={{
              margin: "0 0 6px",
              padding: "0 2px",
              fontSize: 11.5,
              fontWeight: 500,
              letterSpacing: "0.02em",
              color: "var(--color-codex-ink-faint, var(--color-codex-ink-mute))",
            }}
          >
            {isZh ? "执行计划" : "Execution plan"}
          </p>

          <div
            style={{
              background:
                "color-mix(in oklch, var(--color-codex-accent-bg) 65%, var(--color-codex-bg-elev))",
              border:
                "1px solid color-mix(in oklch, var(--color-codex-accent) 22%, transparent)",
              borderRadius: "var(--codex-r-md, 8px)",
              padding: "14px 16px",
            }}
          >
            {isGenerating ? (
              <div
                className="flex items-center"
                style={{ gap: 8, fontSize: 13, color: "var(--color-codex-accent)" }}
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {isZh ? "正在制定执行计划…" : "Generating execution plan…"}
              </div>
            ) : (
              <>
                <div
                  className="md-root whitespace-pre-wrap"
                  style={{
                    fontSize: 14,
                    lineHeight: 1.75,
                    color: "var(--color-codex-ink)",
                  }}
                >
                  {plan.plan_text}
                </div>

                {plan.planned_tools.length > 0 ? (
                  <div style={{ marginTop: 14 }}>
                    <p
                      style={{
                        margin: "0 0 8px",
                        fontSize: 11.5,
                        fontWeight: 500,
                        color: "var(--color-codex-accent-ink)",
                        letterSpacing: "0.02em",
                      }}
                    >
                      {isZh
                        ? `计划调用的工具 · ${plan.planned_tools.length}`
                        : `Planned tools · ${plan.planned_tools.length}`}
                    </p>
                    <div className="flex flex-col" style={{ gap: 6 }}>
                      {plan.planned_tools.map((tool, index) => (
                        <div
                          key={`${tool.name}-${index}`}
                          className="flex items-start"
                          style={{
                            gap: 10,
                            padding: "8px 10px",
                            background: "var(--color-codex-bg-elev)",
                            border: "1px solid var(--color-codex-line-soft)",
                            borderRadius: "var(--codex-r-sm, 6px)",
                          }}
                        >
                          <span
                            className="flex-shrink-0"
                            style={{
                              width: 6,
                              height: 6,
                              marginTop: 6,
                              borderRadius: 99,
                              background: "var(--color-codex-accent)",
                            }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 500,
                                color: "var(--color-codex-ink)",
                                lineHeight: 1.4,
                              }}
                            >
                              {tool.name}
                            </div>
                            {tool.input_summary ? (
                              <div
                                style={{
                                  fontSize: 11.5,
                                  color: "var(--color-codex-ink-mute)",
                                  marginTop: 2,
                                  lineHeight: 1.5,
                                }}
                              >
                                {tool.input_summary}
                              </div>
                            ) : null}
                          </div>
                          <span
                            className="flex-shrink-0"
                            style={{
                              fontFamily:
                                'var(--codex-mono, "JetBrains Mono", ui-monospace, monospace)',
                              fontSize: 10.5,
                              color:
                                "var(--color-codex-ink-faint, var(--color-codex-ink-mute))",
                              paddingTop: 2,
                            }}
                          >
                            {String(index + 1).padStart(2, "0")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div
                  className="flex items-center"
                  style={{ gap: 8, marginTop: 16 }}
                >
                  <button
                    type="button"
                    onClick={onExecute}
                    className="inline-flex items-center transition-colors"
                    style={{
                      gap: 6,
                      padding: "7px 14px",
                      fontSize: 12.5,
                      fontWeight: 500,
                      background: "var(--color-codex-ink)",
                      color: "var(--color-codex-bg-elev)",
                      borderRadius: "var(--codex-r-sm, 6px)",
                      border: "none",
                    }}
                  >
                    <Play className="h-3 w-3" />
                    {isZh ? "执行此计划" : "Execute plan"}
                  </button>
                  <button
                    type="button"
                    onClick={onCancel}
                    className="inline-flex items-center transition-colors"
                    style={{
                      gap: 6,
                      padding: "7px 14px",
                      fontSize: 12.5,
                      color: "var(--color-codex-ink-soft, var(--color-codex-ink))",
                      background: "transparent",
                      border: "1px solid var(--color-codex-line)",
                      borderRadius: "var(--codex-r-sm, 6px)",
                    }}
                  >
                    <X className="h-3 w-3" />
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
