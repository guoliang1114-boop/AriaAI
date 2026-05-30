import { Download, Package } from "lucide-react";
import type { GeneratedArtifact } from "../../types/api";
import { formatDateOnly } from "../../utils/timezone";

interface ProjectOverviewArtifactsCardProps {
  artifacts: GeneratedArtifact[];
  isZh: boolean;
  isLoading: boolean;
  onDownload: (artifact: GeneratedArtifact) => void;
}

export function ProjectOverviewArtifactsCard({
  artifacts,
  isZh,
  isLoading,
  onDownload,
}: ProjectOverviewArtifactsCardProps) {
  return (
    <div className="bg-white rounded-xl border border-codex-line">
      <div className="flex items-center justify-between p-5 border-b border-codex-line-soft">
        <h3 className="font-semibold text-codex-ink flex items-center gap-2">
          <Package className="w-4 h-4 text-codex-ink-faint" />
          {isZh ? "AI 生成物" : "Generated Artifacts"}
        </h3>
      </div>
      <div className="divide-y divide-gray-100">
        {isLoading ? (
          <div className="p-5 text-sm text-codex-ink-faint">
            {isZh ? "正在加载生成物..." : "Loading artifacts..."}
          </div>
        ) : artifacts.length === 0 ? (
          <div className="p-5 text-sm text-codex-ink-faint">
            {isZh ? "还没有生成物" : "No generated artifacts yet"}
          </div>
        ) : (
          artifacts.map((artifact) => (
            <div key={`${artifact.id ?? artifact.path}-${artifact.name}`} className="flex items-center gap-3 p-4">
              <div className="w-10 h-10 rounded-lg bg-codex-accent-bg flex items-center justify-center">
                <Package className="w-5 h-5 text-codex-good" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-codex-ink truncate">{artifact.name}</p>
                <p className="text-xs text-codex-ink-faint">
                  {artifact.file_type.toUpperCase()}
                  {artifact.created_at ? ` · ${formatDateOnly(artifact.created_at)}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onDownload(artifact)}
                className="p-2 rounded-lg hover:bg-codex-bg-tint text-codex-ink-faint hover:text-codex-ink-soft"
              >
                <Download className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
