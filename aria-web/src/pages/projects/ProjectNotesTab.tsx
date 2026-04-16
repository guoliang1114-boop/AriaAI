import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Loader2 } from "lucide-react";
import { api } from "../../api/client";
import { getApiBaseUrl } from "../../config/api";
import { MarkdownRenderer } from "../../components/MarkdownRenderer";
import { useToast } from "../../contexts/ToastContext";
import type { ProjectFile, ProjectFolder } from "../../types/api";
import { ProjectNotesAIModal } from "./ProjectNotesAIModal";
import { ProjectNotesDeleteDialog } from "./ProjectNotesDeleteDialog";
import { ProjectNotesDocumentDialog } from "./ProjectNotesDocumentDialog";
import { ProjectNotesSidebar } from "./ProjectNotesSidebar";
import { ProjectNotesToolbar } from "./ProjectNotesToolbar";
import { useProjectNotesDocuments } from "./useProjectNotesDocuments";

interface ProjectNotesTabProps {
  projectId: string;
  projectName: string;
  files: ProjectFile[];
  folders: ProjectFolder[];
  onUpdate: () => void;
}

type DocumentDialogMode = "create" | "rename";

const COPY = {
  saved: { zh: "文档已保存", en: "Document saved" },
  saveFailed: { zh: "保存失败", en: "Failed to save" },
  templateCreated: {
    zh: "咨询售前模板已创建",
    en: "Consulting pre-sales template created",
  },
  templateCreatedAndCleaned: {
    zh: "模板已创建，并清理了重复目录",
    en: "Template created and duplicate folders cleaned",
  },
  templateCreateFailed: { zh: "模板创建失败", en: "Failed to create template" },
  documentCreated: { zh: "文档已创建", en: "Document created" },
  documentCreateFailed: { zh: "创建文档失败", en: "Failed to create document" },
  documentRenamed: { zh: "文档已重命名", en: "Document renamed" },
  documentRenameFailed: {
    zh: "重命名文档失败",
    en: "Failed to rename document",
  },
  documentDeleted: { zh: "文档已删除", en: "Document deleted" },
  documentDeleteFailed: {
    zh: "删除文档失败",
    en: "Failed to delete document",
  },
  aiGenerationFailed: {
    zh: "AI 润色失败，请稍后重试",
    en: "AI generation failed, please try again",
  },
  aiApplied: {
    zh: "已应用到当前文档",
    en: "Applied to current document",
  },
  emptyTitle: { zh: "请先从左侧选择文档", en: "Choose a document from the left" },
  emptyDescription: {
    zh: "可以先生成咨询售前模板，或者新建一篇 Markdown 文档开始整理。",
    en: "Create the consulting pre-sales template or start a new Markdown document.",
  },
  editPlaceholder: {
    zh: "在这里编辑 Markdown 文档……",
    en: "Edit your Markdown document here...",
  },
  previewEmpty: { zh: "预览区域", en: "Preview area" },
} as const;

function pick(
  isZh: boolean,
  value: {
    zh: string;
    en: string;
  },
) {
  return isZh ? value.zh : value.en;
}

export function ProjectNotesTab({
  projectId,
  projectName,
  files,
  folders,
  onUpdate,
}: ProjectNotesTabProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const toast = useToast();
  const {
    content,
    dirty,
    folderList,
    groupedFiles,
    isLoadingDoc,
    markdownFiles,
    openFolders,
    selectedFile,
    selectedFileId,
    setSelectedFileId,
    toggleFolder,
    updateContent,
    markContentSynced,
    resetDocumentState,
  } = useProjectNotesDocuments({
    projectId,
    files,
    folders,
  });
  const [mode, setMode] = useState<"edit" | "preview" | "split">("preview");
  const [isSaving, setIsSaving] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [isCreatingDoc, setIsCreatingDoc] = useState(false);
  const [isRenamingDoc, setIsRenamingDoc] = useState(false);
  const [isDeletingDoc, setIsDeletingDoc] = useState(false);
  const [showDocumentDialog, setShowDocumentDialog] = useState(false);
  const [documentDialogMode, setDocumentDialogMode] =
    useState<DocumentDialogMode>("create");
  const [documentName, setDocumentName] = useState("");
  const [pendingFolderId, setPendingFolderId] = useState<number | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiDraft, setAiDraft] = useState("");
  const [aiResult, setAiResult] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const contentRef = useRef(content);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (
        moreMenuRef.current &&
        !moreMenuRef.current.contains(event.target as Node)
      ) {
        setShowMoreMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleSave = async () => {
    if (!selectedFileId) return;
    setIsSaving(true);
    try {
      await api.patch(`/projects/${projectId}/documents/${selectedFileId}`, {
        content,
      });
      markContentSynced(content);
      onUpdate();
      toast.success(pick(isZh, COPY.saved));
    } catch (error) {
      console.error("Failed to save document:", error);
      toast.error(pick(isZh, COPY.saveFailed));
    } finally {
      setIsSaving(false);
    }
  };

  const handleInitTemplate = async () => {
    setIsBootstrapping(true);
    try {
      const result = await api.post<{ cleaned_folder_count?: number }>(
        `/projects/${projectId}/notes/templates/presales`,
        {},
      );
      onUpdate();
      toast.success(
        result.cleaned_folder_count
          ? pick(isZh, COPY.templateCreatedAndCleaned)
          : pick(isZh, COPY.templateCreated),
      );
    } catch (error) {
      console.error("Failed to initialize template:", error);
      toast.error(pick(isZh, COPY.templateCreateFailed));
    } finally {
      setIsBootstrapping(false);
    }
  };

  const openCreateDialog = (folderId?: number | null) => {
    setDocumentDialogMode("create");
    setPendingFolderId(folderId ?? null);
    setDocumentName("");
    setShowDocumentDialog(true);
  };

  const openRenameDialog = () => {
    if (!selectedFile) return;
    setDocumentDialogMode("rename");
    setPendingFolderId(selectedFile.folder_id ?? null);
    setDocumentName(selectedFile.name);
    setShowDocumentDialog(true);
  };

  const closeDocumentDialog = () => {
    if (isCreatingDoc || isRenamingDoc) return;
    setShowDocumentDialog(false);
    setDocumentName("");
    setPendingFolderId(null);
  };

  const handleCreateDocument = async () => {
    const normalizedName = documentName.trim();
    if (!normalizedName) return;
    setIsCreatingDoc(true);
    try {
      const created = await api.post<ProjectFile>(
        `/projects/${projectId}/documents`,
        {
          folder_id: pendingFolderId,
          name: normalizedName,
          content: `# ${normalizedName.replace(/\.md$/i, "")}\n`,
        },
      );
      onUpdate();
      setSelectedFileId(created.id);
      closeDocumentDialog();
      toast.success(pick(isZh, COPY.documentCreated));
    } catch (error) {
      console.error("Failed to create document:", error);
      toast.error(pick(isZh, COPY.documentCreateFailed));
    } finally {
      setIsCreatingDoc(false);
    }
  };

  const handleRenameDocument = async () => {
    if (!selectedFile) return;
    const normalizedName = documentName.trim();
    if (!normalizedName || normalizedName === selectedFile.name) return;
    setIsRenamingDoc(true);
    try {
      await api.patch(`/projects/${projectId}/documents/${selectedFile.id}`, {
        name: normalizedName,
      });
      onUpdate();
      closeDocumentDialog();
      toast.success(pick(isZh, COPY.documentRenamed));
    } catch (error) {
      console.error("Failed to rename document:", error);
      toast.error(pick(isZh, COPY.documentRenameFailed));
    } finally {
      setIsRenamingDoc(false);
    }
  };

  const handleDeleteDocument = async () => {
    if (!selectedFile) return;
    setIsDeletingDoc(true);
    try {
      await api.delete(`/projects/${projectId}/files/${selectedFile.id}`);
      const nextFile =
        markdownFiles.find((file) => file.id !== selectedFile.id) || null;
      setSelectedFileId(nextFile?.id ?? null);
      resetDocumentState();
      setShowDeleteDialog(false);
      onUpdate();
      toast.success(pick(isZh, COPY.documentDeleted));
    } catch (error) {
      console.error("Failed to delete document:", error);
      toast.error(pick(isZh, COPY.documentDeleteFailed));
    } finally {
      setIsDeletingDoc(false);
    }
  };

  const handleAIGenerate = async () => {
    const draft = aiDraft.trim() || content.trim();
    if (!draft) return;
    setAiLoading(true);
    setAiResult("");
    try {
      const response = await fetch(
        `${getApiBaseUrl()}/projects/${projectId}/notes/ai-polish-stream`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Auth-Token": localStorage.getItem("authToken") || "",
          },
          body: JSON.stringify({ draft }),
        },
      );
      if (!response.ok) throw new Error("Network response was not ok");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";
        for (const event of events) {
          const line = event
            .split("\n")
            .map((item) => item.trim())
            .find((item) => item.startsWith("data: "));
          if (!line) continue;
          try {
            const payload = JSON.parse(line.replace(/^data:\s*/, ""));
            if (payload.type === "text" && payload.content) {
              setAiResult((current) => current + payload.content);
            } else if (payload.type === "error") {
              throw new Error(payload.message || "AI generation failed");
            }
          } catch (error) {
            console.error("Failed to parse stream event:", error);
          }
        }
      }
    } catch (error: any) {
      console.error("AI generation failed:", error);
      toast.error(error?.message || pick(isZh, COPY.aiGenerationFailed));
    } finally {
      setAiLoading(false);
    }
  };

  const applyAIResult = (applyMode: "replace" | "append") => {
    const currentResult = aiResult.trim();
    if (!currentResult) return;
    const prevContent = contentRef.current;
    const nextContent =
      applyMode === "replace"
        ? currentResult
        : `${prevContent.trim() ? `${prevContent}\n\n---\n\n` : ""}${currentResult}`;
    updateContent(nextContent);
    setShowAIModal(false);
    setAiDraft("");
    setAiResult("");
    toast.success(pick(isZh, COPY.aiApplied));
  };

  const closeAIModal = () => {
    setShowAIModal(false);
    setAiDraft("");
    setAiResult("");
  };

  const showEdit = mode === "edit" || mode === "split";
  const showPreview = mode === "preview" || mode === "split";

  return (
    <div className="h-full min-h-[calc(100vh-220px)] overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="flex h-full min-h-[calc(100vh-220px)]">
        <ProjectNotesSidebar
          folderList={folderList}
          groupedFiles={groupedFiles}
          isBootstrapping={isBootstrapping}
          isCreatingDoc={isCreatingDoc}
          isZh={isZh}
          markdownFiles={markdownFiles}
          openFolders={openFolders}
          projectName={projectName}
          selectedFileId={selectedFileId}
          onCreateDocument={openCreateDialog}
          onInitTemplate={() => void handleInitTemplate()}
          onSelectFile={setSelectedFileId}
          onToggleFolder={toggleFolder}
        />

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="relative" ref={moreMenuRef}>
            <ProjectNotesToolbar
              dirty={dirty}
              isDeletingDoc={isDeletingDoc}
              isRenamingDoc={isRenamingDoc}
              isSaving={isSaving}
              isZh={isZh}
              mode={mode}
              selectedFile={selectedFile}
              showMoreMenu={showMoreMenu}
              onOpenAIModal={() => setShowAIModal(true)}
              onOpenRename={() => {
                setShowMoreMenu(false);
                openRenameDialog();
              }}
              onRequestDelete={() => {
                setShowMoreMenu(false);
                setShowDeleteDialog(true);
              }}
              onSave={() => void handleSave()}
              onSetMode={setMode}
              onToggleMoreMenu={() => setShowMoreMenu((value) => !value)}
            />
          </div>

          <div className="min-h-0 flex-1 bg-white">
            {!selectedFile ? (
              <div className="flex h-full items-center justify-center px-8 text-center">
                <div>
                  <BookOpen className="mx-auto h-12 w-12 text-gray-300" />
                  <p className="mt-4 text-base font-medium text-gray-900">
                    {pick(isZh, COPY.emptyTitle)}
                  </p>
                  <p className="mt-2 text-sm text-gray-500">
                    {pick(isZh, COPY.emptyDescription)}
                  </p>
                </div>
              </div>
            ) : isLoadingDoc ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <div className="flex h-full gap-4 p-4">
                {showEdit && (
                  <div className={`${mode === "split" ? "w-1/2" : "w-full"} min-w-0`}>
                    <textarea
                      value={content}
                      onChange={(event) => updateContent(event.target.value)}
                      placeholder={pick(isZh, COPY.editPlaceholder)}
                      className="h-full min-h-[calc(100vh-340px)] w-full resize-none rounded-xl border border-gray-200 bg-white px-4 py-4 font-mono text-sm leading-7 text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary/20"
                      spellCheck={false}
                    />
                  </div>
                )}

                {showPreview && (
                  <div className={`${mode === "split" ? "w-1/2" : "w-full"} min-w-0`}>
                    <div className="h-full min-h-[calc(100vh-340px)] overflow-auto rounded-xl border border-gray-200 bg-gray-50 px-5 py-4">
                      {content.trim() ? (
                        <div className="md-root">
                          <MarkdownRenderer content={content} />
                        </div>
                      ) : (
                        <div className="flex h-full items-center justify-center text-sm text-gray-400">
                          {pick(isZh, COPY.previewEmpty)}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      <ProjectNotesDocumentDialog
        isOpen={showDocumentDialog}
        isPending={isCreatingDoc || isRenamingDoc}
        isZh={isZh}
        mode={documentDialogMode}
        value={documentName}
        onChange={setDocumentName}
        onClose={closeDocumentDialog}
        onSubmit={() =>
          void (documentDialogMode === "create"
            ? handleCreateDocument()
            : handleRenameDocument())
        }
      />

      <ProjectNotesDeleteDialog
        file={selectedFile}
        isDeleting={isDeletingDoc}
        isOpen={showDeleteDialog}
        isZh={isZh}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={() => void handleDeleteDocument()}
      />

      <ProjectNotesAIModal
        aiDraft={aiDraft}
        aiLoading={aiLoading}
        aiResult={aiResult}
        isOpen={showAIModal}
        isZh={isZh}
        onApply={applyAIResult}
        onChangeDraft={setAiDraft}
        onClose={closeAIModal}
        onGenerate={() => void handleAIGenerate()}
      />
    </div>
  );
}
