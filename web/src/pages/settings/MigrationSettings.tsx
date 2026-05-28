/**
 * Settings → 迁移状态 — V0.0.6 Codex redesign (PR 7/N).
 *
 * Read-only status page for the database migration governance. All
 * data + actions (refresh, fetch) are unchanged from the previous
 * implementation; only the rendering layer was rewritten.
 *
 * Layout: header (title + refresh CTA) → status banner (good/warn) →
 * 4-stat tile row → 2-col detail panels (pending revisions + ops
 * commands) → known revisions chip list. Each tile uses the Codex
 * stat-card pattern (bg-elev + hairline border, no shadow, mono-font
 * value).
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  GitBranch,
  Loader2,
  RefreshCw,
} from "lucide-react";

import { api } from "../../api/client";
import { CxStatus } from "../../components/codex";

interface MigrationGovernance {
  mode: "bootstrap" | "lightweight" | "alembic" | string;
  current_revision?: string | null;
  latest_revision?: string | null;
  known_revisions?: string[];
  pending_revisions?: string[];
  pending_count?: number;
  up_to_date?: boolean | null;
  idempotent_bootstrap?: boolean;
  notes?: Record<string, string>;
}

type Tone = "neutral" | "ok" | "warning";

function getModeTone(governance: MigrationGovernance | null): Tone {
  if (!governance) return "neutral";
  if (governance.mode === "alembic" && governance.pending_count === 0) return "ok";
  if (governance.mode === "lightweight") return "warning";
  if ((governance.pending_count ?? 0) > 0) return "warning";
  return "neutral";
}

function StatTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: Tone;
}) {
  const valueColor =
    tone === "ok"
      ? "var(--color-codex-good)"
      : tone === "warning"
        ? "var(--color-codex-warn)"
        : "var(--color-codex-ink)";
  return (
    <div
      style={{
        background: "var(--color-codex-bg-elev)",
        border: "1px solid var(--color-codex-line)",
        borderRadius: "var(--codex-r-md, 6px)",
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          fontSize: 11.5,
          fontWeight: 500,
          color: "var(--color-codex-ink-mute)",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        className="font-mono"
        style={{
          marginTop: 6,
          fontSize: 18,
          fontWeight: 500,
          color: valueColor,
          wordBreak: "break-all",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value || "-"}
      </div>
    </div>
  );
}

export function MigrationSettings() {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const [loading, setLoading] = useState(true);
  const [governance, setGovernance] = useState<MigrationGovernance | null>(null);
  const [error, setError] = useState("");

  const loadGovernance = async () => {
    try {
      setLoading(true);
      setError("");
      const data = await api.get<MigrationGovernance>("/health/db/migrations");
      setGovernance(data);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Failed to load migration governance:", err);
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || (isZh ? "加载迁移状态失败" : "Failed to load migration status"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadGovernance();
    // No deps — load once on mount. i18n changes don't refetch.
  }, []);

  if (loading) {
    return (
      <div
        className="theme-codex flex items-center justify-center"
        style={{ padding: "48px 0", color: "var(--color-codex-ink-mute)" }}
      >
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const tone = getModeTone(governance);
  const healthy = tone === "ok";

  return (
    <div
      className="theme-codex"
      data-testid="migration-settings"
      style={{
        background: "var(--color-codex-bg)",
        color: "var(--color-codex-ink)",
        padding: "8px 4px 32px",
      }}
    >
      {/* Header */}
      <header
        className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"
        style={{ marginBottom: 18 }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 500,
              color: "var(--color-codex-ink)",
              letterSpacing: "-0.015em",
            }}
          >
            {isZh ? "数据库迁移状态" : "Database Migrations"}
          </h1>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 13,
              color: "var(--color-codex-ink-mute)",
              lineHeight: 1.6,
            }}
          >
            {isZh
              ? "只读查看当前数据库迁移治理状态，用于部署后校验和数据库类失败排查。"
              : "Read-only migration governance status for deployment checks and database failure triage."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadGovernance()}
          className="inline-flex items-center gap-1.5"
          style={{
            padding: "8px 14px",
            background: "var(--color-codex-bg-elev)",
            color: "var(--color-codex-ink-soft)",
            border: "1px solid var(--color-codex-line)",
            borderRadius: "var(--codex-r-sm, 3px)",
            fontSize: 12.5,
            fontWeight: 500,
          }}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          {isZh ? "刷新状态" : "Refresh"}
        </button>
      </header>

      {/* Error alert */}
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-2"
          style={{
            padding: "9px 12px",
            background: "color-mix(in oklch, var(--color-codex-bad) 8%, transparent)",
            border: "1px solid color-mix(in oklch, var(--color-codex-bad) 30%, transparent)",
            borderRadius: "var(--codex-r-sm, 3px)",
            color: "var(--color-codex-bad)",
            fontSize: 12,
          }}
        >
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}

      {/* Status banner */}
      <section
        className="mb-5"
        style={{
          padding: "16px 20px",
          background: healthy
            ? "color-mix(in oklch, var(--color-codex-good) 6%, transparent)"
            : "color-mix(in oklch, var(--color-codex-warn) 6%, transparent)",
          border: `1px solid color-mix(in oklch, var(${
            healthy ? "--color-codex-good" : "--color-codex-warn"
          }) 30%, transparent)`,
          borderRadius: "var(--codex-r-md, 6px)",
        }}
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="inline-flex items-center justify-center flex-shrink-0"
            style={{
              width: 36,
              height: 36,
              borderRadius: "var(--codex-r-sm, 3px)",
              background: healthy
                ? "color-mix(in oklch, var(--color-codex-good) 16%, transparent)"
                : "color-mix(in oklch, var(--color-codex-warn) 16%, transparent)",
              color: healthy
                ? "var(--color-codex-good)"
                : "var(--color-codex-warn)",
            }}
          >
            {healthy ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <AlertTriangle className="h-4 w-4" />
            )}
          </span>
          <div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: "var(--color-codex-ink)",
              }}
            >
              {healthy
                ? isZh
                  ? "迁移状态正常"
                  : "Migrations are healthy"
                : isZh
                  ? "需要关注迁移状态"
                  : "Migration state needs attention"}
            </div>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 12.5,
                color: "var(--color-codex-ink-soft)",
                lineHeight: 1.6,
              }}
            >
              {healthy
                ? isZh
                  ? "当前数据库由 Alembic 管理，且没有待执行迁移。"
                  : "The database is Alembic-managed and has no pending revisions."
                : isZh
                  ? "如果这是线上环境，请先查看部署日志中的 migration_governance 输出，再决定是否执行 ensure 或 upgrade。"
                  : "For production, inspect migration_governance deployment logs before deciding whether to run ensure or upgrade."}
            </p>
          </div>
        </div>
      </section>

      {/* Stat tiles */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 mb-5">
        <StatTile
          label={isZh ? "模式" : "Mode"}
          value={governance?.mode || "-"}
          tone={tone}
        />
        <StatTile
          label={isZh ? "当前版本" : "Current revision"}
          value={governance?.current_revision || "-"}
        />
        <StatTile
          label={isZh ? "最新版本" : "Latest revision"}
          value={governance?.latest_revision || "-"}
        />
        <StatTile
          label={isZh ? "待执行数量" : "Pending count"}
          value={governance?.pending_count ?? 0}
          tone={(governance?.pending_count ?? 0) > 0 ? "warning" : "ok"}
        />
      </div>

      {/* Two-column detail */}
      <div className="grid gap-4 lg:grid-cols-2 mb-5">
        {/* Pending revisions */}
        <section
          style={{
            background: "var(--color-codex-bg-elev)",
            border: "1px solid var(--color-codex-line)",
            borderRadius: "var(--codex-r-md, 6px)",
            padding: "14px 16px",
          }}
        >
          <div
            className="mb-3 flex items-center gap-2"
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--color-codex-ink)",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
            {isZh ? "待执行 Revision" : "Pending revisions"}
          </div>
          {governance?.pending_revisions?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {governance.pending_revisions.map((revision) => (
                <span
                  key={revision}
                  className="font-mono"
                  style={{
                    padding: "3px 8px",
                    fontSize: 11.5,
                    background: "color-mix(in oklch, var(--color-codex-warn) 12%, transparent)",
                    color: "var(--color-codex-warn)",
                    borderRadius: "var(--codex-r-pill, 999px)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {revision}
                </span>
              ))}
            </div>
          ) : (
            <div
              className="flex items-center gap-2"
              style={{
                padding: "10px 12px",
                background: "var(--color-codex-bg-tint)",
                borderRadius: "var(--codex-r-sm, 3px)",
                fontSize: 12.5,
                color: "var(--color-codex-ink-mute)",
              }}
            >
              <CxStatus tone="good">{isZh ? "无" : "none"}</CxStatus>
              {isZh ? "没有待执行迁移。" : "No pending migrations."}
            </div>
          )}
        </section>

        {/* Ops commands */}
        <section
          style={{
            background: "var(--color-codex-bg-elev)",
            border: "1px solid var(--color-codex-line)",
            borderRadius: "var(--codex-r-md, 6px)",
            padding: "14px 16px",
          }}
        >
          <div
            className="mb-3 flex items-center gap-2"
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--color-codex-ink)",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            <Database className="h-3.5 w-3.5" aria-hidden="true" />
            {isZh ? "运维命令" : "Operational commands"}
          </div>
          <div className="flex flex-col gap-1.5">
            {[
              "python scripts/migration_governance.py report",
              "python scripts/migration_governance.py check",
              "python scripts/migration_governance.py ensure",
              "python scripts/migration_governance.py upgrade",
            ].map((cmd) => (
              <code
                key={cmd}
                className="font-mono"
                style={{
                  display: "block",
                  padding: "8px 10px",
                  background: "var(--color-codex-bg-tint)",
                  border: "1px solid var(--color-codex-line-soft)",
                  borderRadius: "var(--codex-r-sm, 3px)",
                  fontSize: 11.5,
                  color: "var(--color-codex-ink-soft)",
                  overflowX: "auto",
                }}
              >
                {cmd}
              </code>
            ))}
          </div>
        </section>
      </div>

      {/* Known revisions */}
      <section
        style={{
          background: "var(--color-codex-bg-elev)",
          border: "1px solid var(--color-codex-line)",
          borderRadius: "var(--codex-r-md, 6px)",
          padding: "14px 16px",
        }}
      >
        <div
          className="mb-3"
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--color-codex-ink)",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          {isZh ? "已知 Revision" : "Known revisions"}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(governance?.known_revisions || []).map((revision) => (
            <span
              key={revision}
              className="font-mono"
              style={{
                padding: "3px 8px",
                fontSize: 11.5,
                background: "var(--color-codex-bg-tint)",
                color: "var(--color-codex-ink-mute)",
                borderRadius: "var(--codex-r-pill, 999px)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {revision}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
