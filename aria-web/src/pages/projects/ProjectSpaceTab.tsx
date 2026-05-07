import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import type { ProjectDetail as ProjectDetailType } from "../../types/api";
import { ProjectNotesTab } from "./ProjectNotesTab";

interface ProjectSpaceTabProps {
  projectDetail: ProjectDetailType;
  projectId: string;
  onUpdate: () => void;
}

export function ProjectSpaceTab({
  projectDetail,
  projectId,
  onUpdate,
}: ProjectSpaceTabProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");

  return (
    <div className="flex min-h-[calc(100vh-180px)] flex-col gap-4">
      <div className="border-b border-gray-200 bg-white px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <Sparkles className="h-4 w-4" />
            <span>{isZh ? "AI 管理的项目空间" : "AI-managed project space"}</span>
          </div>
          <h2 className="mt-1 text-xl font-semibold text-gray-900">
            {isZh ? "空间" : "Space"}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            {isZh
              ? "左侧目录统一展示 Markdown、上传材料和交付物。目录结构由 AI 维护；用户聚焦录入、阅读、编辑和下载。"
              : "The left directory shows Markdown, uploaded material, and deliverables together. AI maintains the structure; people focus on capturing, reading, editing, and downloading."}
          </p>
        </div>
      </div>

      <ProjectNotesTab
        projectId={projectId}
        projectName={projectDetail.project.name}
        files={projectDetail.files}
        folders={projectDetail.folders}
        memoryVersion={projectDetail.project.memory_version ?? 0}
        onUpdate={onUpdate}
      />
    </div>
  );
}
