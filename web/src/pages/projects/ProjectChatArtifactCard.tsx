import { Download, ExternalLink, FileText } from "lucide-react";
import type { GeneratedArtifact } from "../../types/api";

interface ProjectChatArtifactCardProps {
  artifact: GeneratedArtifact;
  isZh: boolean;
  onDownload: (artifact: GeneratedArtifact) => void;
  onOpen?: (artifact: GeneratedArtifact) => void;
}

export function ProjectChatArtifactCard({
  artifact,
  isZh,
  onDownload,
  onOpen,
}: ProjectChatArtifactCardProps) {
  const canOpenInSpace = Boolean(onOpen && artifact.project_file_id);
  const canDownload = Boolean(artifact.path);
  const isTextArtifact = artifact.file_type === "text";

  return (
    <div
      style={{
        padding: "12px 14px",
        background:
          "color-mix(in oklch, var(--color-codex-accent-bg) 70%, var(--color-codex-bg-elev))",
        border:
          "1px solid color-mix(in oklch, var(--color-codex-accent) 22%, transparent)",
        borderRadius: "var(--codex-r-md, 8px)",
      }}
    >
      <div className="flex items-start" style={{ gap: 12 }}>
        <span
          className="mt-0.5 inline-flex flex-shrink-0 items-center justify-center"
          style={{
            width: 32,
            height: 32,
            borderRadius: "var(--codex-r-sm, 6px)",
            background: "var(--color-codex-bg-elev)",
            color: "var(--color-codex-accent)",
            border: "1px solid var(--color-codex-line)",
          }}
        >
          <FileText className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className="truncate"
            style={{
              margin: 0,
              fontSize: 13.5,
              fontWeight: 500,
              color: "var(--color-codex-ink)",
              lineHeight: 1.4,
            }}
          >
            {artifact.name}
          </p>
          <div
            className="flex flex-wrap items-center"
            style={{
              gap: 6,
              marginTop: 4,
              fontSize: 11,
              color: "var(--color-codex-ink-mute)",
            }}
          >
            <span
              style={{
                fontFamily:
                  'var(--codex-mono, "JetBrains Mono", ui-monospace, monospace)',
                padding: "1px 6px",
                background: "var(--color-codex-bg-elev)",
                border: "1px solid var(--color-codex-line-soft)",
                borderRadius: 999,
                color: "var(--color-codex-accent-ink)",
                letterSpacing: "0.04em",
                fontSize: 10.5,
              }}
            >
              {isTextArtifact ? "TEXT" : artifact.file_type.toUpperCase()}
            </span>
            {artifact.description ? (
              <span className="truncate">{artifact.description}</span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center" style={{ gap: 6 }}>
          {canOpenInSpace ? (
            <button
              type="button"
              onClick={() => onOpen?.(artifact)}
              className="inline-flex items-center transition-colors"
              style={{
                gap: 5,
                padding: "5px 10px",
                fontSize: 11.5,
                fontWeight: 500,
                color: "var(--color-codex-accent-ink)",
                background: "var(--color-codex-bg-elev)",
                border: "1px solid var(--color-codex-line)",
                borderRadius: "var(--codex-r-sm, 6px)",
              }}
            >
              <ExternalLink className="h-3 w-3" />
              {isZh ? "打开" : "Open"}
            </button>
          ) : null}
          {canDownload ? (
            <button
              type="button"
              onClick={() => onDownload(artifact)}
              className="inline-flex items-center transition-colors"
              style={{
                gap: 5,
                padding: "5px 10px",
                fontSize: 11.5,
                fontWeight: 500,
                color: "var(--color-codex-accent-ink)",
                background: "var(--color-codex-bg-elev)",
                border: "1px solid var(--color-codex-line)",
                borderRadius: "var(--codex-r-sm, 6px)",
              }}
            >
              <Download className="h-3 w-3" />
              {isZh ? "下载" : "Download"}
            </button>
          ) : null}
        </div>
      </div>
      {isTextArtifact && artifact.description ? (
        <div
          className="overflow-y-auto whitespace-pre-wrap"
          style={{
            marginTop: 10,
            maxHeight: 224,
            padding: 12,
            fontSize: 11.5,
            lineHeight: 1.55,
            color: "var(--color-codex-ink-soft, var(--color-codex-ink))",
            background: "var(--color-codex-bg-elev)",
            border: "1px solid var(--color-codex-line-soft)",
            borderRadius: "var(--codex-r-sm, 6px)",
          }}
        >
          {artifact.description}
        </div>
      ) : null}
    </div>
  );
}
