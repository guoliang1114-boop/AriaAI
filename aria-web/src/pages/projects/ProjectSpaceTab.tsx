import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Files, Sparkles } from "lucide-react";
import type { ProjectDetail as ProjectDetailType } from "../../types/api";
import { ProjectDocumentsTab } from "./ProjectDocumentsTab";
import { ProjectNotesTab } from "./ProjectNotesTab";

type ProjectSpaceView = "markdown" | "files";

interface ProjectSpaceTabProps {
  projectDetail: ProjectDetailType;
  projectId: string;
  initialView?: ProjectSpaceView;
  onUpdate: () => void;
}

export function ProjectSpaceTab({
  projectDetail,
  projectId,
  initialView = "markdown",
  onUpdate,
}: ProjectSpaceTabProps) {
  const { i18n } = useTranslation();
  const [view, setView] = useState<ProjectSpaceView>(initialView);
  const isZh = i18n.language.startsWith("zh");

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  const viewOptions: Array<{
    id: ProjectSpaceView;
    label: string;
    description: string;
    icon: typeof BookOpen;
  }> = [
    {
      id: "markdown",
      label: isZh ? "Markdown" : "Markdown",
      description: isZh ? "AI 与用户共同维护的项目知识文档" : "Project knowledge maintained by people and AI",
      icon: BookOpen,
    },
    {
      id: "files",
      label: isZh ? "文件" : "Files",
      description: isZh ? "上传材料、原始文件和交付物" : "Uploads, source files, and deliverables",
      icon: Files,
    },
  ];

  return (
    <div className="flex min-h-[calc(100vh-180px)] flex-col gap-4">
      <div className="border-b border-gray-200 bg-white px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
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
                ? "统一管理 Markdown 文档、上传材料和项目交付物。Markdown 是默认协作界面，文件视图保留原始材料和产出物。"
                : "Manage Markdown documents, uploaded material, and project deliverables in one place. Markdown is the default collaboration surface; files keep source material and outputs accessible."}
            </p>
          </div>

          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
            {viewOptions.map((option) => {
              const Icon = option.icon;
              const isActive = view === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  title={option.description}
                  onClick={() => setView(option.id)}
                  className={`flex min-w-[7.5rem] items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-white text-primary shadow-sm"
                      : "text-gray-500 hover:text-gray-800"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {view === "markdown" ? (
        <ProjectNotesTab
          projectId={projectId}
          projectName={projectDetail.project.name}
          files={projectDetail.files}
          folders={projectDetail.folders}
          memoryVersion={projectDetail.project.memory_version ?? 0}
          onUpdate={onUpdate}
        />
      ) : (
        <ProjectDocumentsTab
          projectDetail={projectDetail}
          projectId={projectId}
          onUpdate={onUpdate}
        />
      )}
    </div>
  );
}
