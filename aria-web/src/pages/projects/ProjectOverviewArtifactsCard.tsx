import { Download, Package } from "lucide-react";
import type { GeneratedArtifact } from "../../types/api";

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
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="flex items-center justify-between p-5 border-b border-gray-100">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <Package className="w-4 h-4 text-gray-400" />
          {isZh ? "AI 生成物" : "Generated Artifacts"}
        </h3>
      </div>
      <div className="divide-y divide-gray-100">
        {isLoading ? (
          <div className="p-5 text-sm text-gray-400">
            {isZh ? "正在加载生成物..." : "Loading artifacts..."}
          </div>
        ) : artifacts.length === 0 ? (
          <div className="p-5 text-sm text-gray-400">
            {isZh ? "还没有生成物" : "No generated artifacts yet"}
          </div>
        ) : (
          artifacts.map((artifact) => (
            <div key={`${artifact.id ?? artifact.path}-${artifact.name}`} className="flex items-center gap-3 p-4">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                <Package className="w-5 h-5 text-emerald-600" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900 truncate">{artifact.name}</p>
                <p className="text-xs text-gray-400">
                  {artifact.file_type.toUpperCase()}
                  {artifact.created_at ? ` · ${new Date(artifact.created_at).toLocaleDateString()}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onDownload(artifact)}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"
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
