import type { ReactNode } from "react";
import { AlertCircle, ServerCrash } from "lucide-react";

interface ServiceErrorAction {
  icon?: ReactNode;
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary";
}

interface ServiceErrorLink {
  description: string;
  icon?: ReactNode;
  label: string;
  onClick: () => void;
}

export function ServiceErrorState({
  actions,
  badge,
  description,
  detail,
  detailLabel = "Error detail",
  hintTitle,
  hints,
  links = [],
  linksTitle = "Quick links",
  serviceUnavailable = false,
  title,
}: {
  actions: ServiceErrorAction[];
  badge: string;
  description: string;
  detail?: string | null;
  detailLabel?: string;
  hintTitle: string;
  hints: string[];
  links?: ServiceErrorLink[];
  linksTitle?: string;
  serviceUnavailable?: boolean;
  title: string;
}) {
  const accentTone = serviceUnavailable
    ? { color: "var(--color-codex-warn)", bgMix: "color-mix(in oklch, var(--color-codex-warn) 14%, transparent)" }
    : { color: "var(--color-codex-bad)", bgMix: "color-mix(in oklch, var(--color-codex-bad) 12%, transparent)" };

  return (
    <div
      className="theme-codex h-full overflow-auto"
      style={{ background: "var(--color-codex-bg)" }}
    >
      <div className="mx-auto flex min-h-[calc(100vh-56px)] max-w-5xl items-center px-6 py-12">
        <div className="grid w-full gap-8 lg:grid-cols-[1.12fr_0.88fr]">
          <section
            className="p-8"
            style={{
              background: "var(--color-codex-bg-elev)",
              border: "1px solid var(--color-codex-line)",
              borderRadius: "var(--codex-r-md, 10px)",
            }}
          >
            <div
              className="inline-flex items-center gap-2 px-3 py-1 text-xs font-medium"
              style={{
                borderRadius: 999,
                background: accentTone.bgMix,
                color: accentTone.color,
              }}
            >
              {serviceUnavailable ? <ServerCrash className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
              {badge}
            </div>
            <h1
              className="mt-6 text-2xl font-medium"
              style={{
                color: "var(--color-codex-ink)",
                letterSpacing: "-0.015em",
              }}
            >
              {title}
            </h1>
            <p
              className="mt-4 max-w-2xl text-base leading-7"
              style={{ color: "var(--color-codex-ink-soft)" }}
            >
              {description}
            </p>

            {detail ? (
              <div
                className="mt-5 px-4 py-3 text-sm"
                style={{
                  background: "var(--color-codex-bg-tint)",
                  border: "1px solid var(--color-codex-line)",
                  borderRadius: "var(--codex-r-sm, 6px)",
                  color: "var(--color-codex-ink-soft)",
                }}
              >
                <div className="font-medium" style={{ color: "var(--color-codex-ink)" }}>
                  {detailLabel}
                </div>
                <div className="mt-1 break-words">{detail}</div>
              </div>
            ) : null}

            <div className="mt-8 flex flex-wrap gap-3">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={action.onClick}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition"
                  style={
                    action.variant === "secondary"
                      ? {
                          background: "var(--color-codex-bg-elev)",
                          color: "var(--color-codex-ink-soft)",
                          border: "1px solid var(--color-codex-line)",
                          borderRadius: "var(--codex-r-sm, 6px)",
                        }
                      : {
                          background: "var(--color-codex-ink)",
                          color: "var(--color-codex-bg-elev)",
                          borderRadius: "var(--codex-r-sm, 6px)",
                        }
                  }
                >
                  {action.icon}
                  {action.label}
                </button>
              ))}
            </div>
          </section>

          <aside className="space-y-4">
            <div
              className="p-6"
              style={{
                background: "var(--color-codex-bg-elev)",
                border: "1px solid var(--color-codex-line)",
                borderRadius: "var(--codex-r-md, 10px)",
              }}
            >
              <div
                className="mb-4 flex h-12 w-12 items-center justify-center"
                style={{
                  background: accentTone.bgMix,
                  color: accentTone.color,
                  borderRadius: "var(--codex-r-sm, 6px)",
                }}
              >
                {serviceUnavailable ? <ServerCrash className="h-6 w-6" /> : <AlertCircle className="h-6 w-6" />}
              </div>
              <h2
                className="text-lg font-medium"
                style={{
                  color: "var(--color-codex-ink)",
                  letterSpacing: "-0.01em",
                }}
              >
                {hintTitle}
              </h2>
              <div
                className="mt-4 space-y-3 text-sm leading-6"
                style={{ color: "var(--color-codex-ink-soft)" }}
              >
                {hints.map((hint) => (
                  <p key={hint}>{hint}</p>
                ))}
              </div>
            </div>

            {links.length ? (
              <div
                className="p-6"
                style={{
                  background: "var(--color-codex-bg-elev)",
                  border: "1px solid var(--color-codex-line)",
                  borderRadius: "var(--codex-r-md, 10px)",
                }}
              >
                <h3
                  className="text-sm font-medium font-mono"
                  style={{
                    color: "var(--color-codex-ink-mute)",
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                  }}
                >
                  {linksTitle}
                </h3>
                <div className="mt-4 grid gap-3">
                  {links.map((link) => (
                    <button
                      key={link.label}
                      type="button"
                      onClick={link.onClick}
                      className="row-hov px-4 py-4 text-left transition"
                      style={{
                        background: "transparent",
                        border: "1px solid var(--color-codex-line)",
                        borderRadius: "var(--codex-r-sm, 6px)",
                      }}
                    >
                      <div
                        className="flex items-center gap-2 text-sm font-medium"
                        style={{ color: "var(--color-codex-ink)" }}
                      >
                        {link.icon}
                        {link.label}
                      </div>
                      <div
                        className="mt-1 text-xs"
                        style={{ color: "var(--color-codex-ink-mute)" }}
                      >
                        {link.description}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
