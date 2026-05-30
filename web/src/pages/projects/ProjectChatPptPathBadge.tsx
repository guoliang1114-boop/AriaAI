/**
 * Small badge that surfaces *how* a PPT was generated this turn (V0.0.4 A4).
 *
 * Reads ``metadata.route_decision`` + ``metadata.task_run`` and renders a
 * one-line chip beside the assistant reply. Stays silent when no PPT was
 * generated, so it never clutters normal text turns.
 */
import { FileText, ListTree, Workflow } from "lucide-react";
import type { GeneratedArtifact, MessageMetadata } from "../../types/api";

interface Props {
  metadata: MessageMetadata;
  artifacts: GeneratedArtifact[];
}

function isPptArtifact(a: GeneratedArtifact): boolean {
  const t = (a.file_type || "").toLowerCase().replace(/^\./, "");
  if (t === "pptx" || t === "ppt") return true;
  return (a.name || "").toLowerCase().endsWith(".pptx");
}

export function ProjectChatPptPathBadge({ metadata, artifacts }: Props) {
  const hasPpt = artifacts.some(isPptArtifact);
  if (!hasPpt) return null;

  const reason = metadata.route_decision?.reason || "";
  const taskType = metadata.task_run?.task_type || "";

  // (1) Conversational PPT path (the rule:pptx_from_prior_outline I added
  //     earlier in V0.0.4) — the model built slides from the conversation.
  if (reason === "rule:pptx_from_prior_outline") {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[11px] text-codex-accent">
        <ListTree className="h-3 w-3" />
        PPT 按本次对话的大纲生成
      </div>
    );
  }

  // (2) Deterministic durable-task pipeline (generate_client_ppt) — the
  //     pipeline built its own outline from project memory.
  if (taskType === "generate_client_ppt") {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full border border-codex-line bg-codex-bg-tint px-2 py-0.5 text-[11px] text-codex-ink-soft">
        <Workflow className="h-3 w-3" />
        PPT 自动从项目记忆生成
      </div>
    );
  }

  // (3) Fallback: a PPT exists but we can't tell the path with confidence —
  //     still show a neutral chip so the user sees it was deliberate.
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-codex-line bg-codex-bg-tint px-2 py-0.5 text-[11px] text-codex-ink-soft">
      <FileText className="h-3 w-3" />
      已生成 PPT
    </div>
  );
}
