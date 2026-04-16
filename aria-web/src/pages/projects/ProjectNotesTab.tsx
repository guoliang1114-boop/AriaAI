import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Loader2, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { api } from "../../api/client";
import { getApiBaseUrl } from "../../config/api";
import { MarkdownRenderer } from "../../components/MarkdownRenderer";
import { useToast } from "../../contexts/ToastContext";
import type { ProjectFile, ProjectFolder } from "../../types/api";
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
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
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
      await api.patch(`/projects/${projectId}/documents/${selectedFileId}`, { content });
      markContentSynced(content);
      onUpdate();
      toast.success(isZh ? "鏂囨。宸蹭繚瀛?" : "Document saved");
    } catch (error) {
      console.error("Failed to save document:", error);
      toast.error(isZh ? "淇濆瓨澶辫触" : "Failed to save");
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
          ? isZh
            ? "宸茬敓鎴愭ā鏉垮苟娓呯悊閲嶅鐩綍"
            : "Template created and duplicate folders cleaned"
          : isZh
            ? "宸茬敓鎴愬挩璇㈠敭鍓嶆ā鏉?"
            : "Consulting pre-sales template created",
      );
    } catch (error) {
      console.error("Failed to initialize template:", error);
      toast.error(isZh ? "妯℃澘鐢熸垚澶辫触" : "Failed to create template");
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
      const created = await api.post<ProjectFile>(`/projects/${projectId}/documents`, {
        folder_id: pendingFolderId,
        name: normalizedName,
        content: `# ${normalizedName.replace(/\.md$/i, "")}\n`,
      });
      onUpdate();
      setSelectedFileId(created.id);
      closeDocumentDialog();
      toast.success(isZh ? "鏂囨。宸插垱寤?" : "Document created");
    } catch (error) {
      console.error("Failed to create document:", error);
      toast.error(isZh ? "鍒涘缓鏂囨。澶辫触" : "Failed to create document");
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
      toast.success(isZh ? "鏂囨。宸查噸鍛藉悕" : "Document renamed");
    } catch (error) {
      console.error("Failed to rename document:", error);
      toast.error(isZh ? "閲嶅懡鍚嶆枃妗ｅけ璐?" : "Failed to rename document");
    } finally {
      setIsRenamingDoc(false);
    }
  };

  const handleDeleteDocument = async () => {
    if (!selectedFile) return;
    setIsDeletingDoc(true);
    try {
      await api.delete(`/projects/${projectId}/files/${selectedFile.id}`);
      const nextFile = markdownFiles.find((file) => file.id !== selectedFile.id) || null;
      setSelectedFileId(nextFile?.id ?? null);
      resetDocumentState();
      setShowDeleteDialog(false);
      onUpdate();
      toast.success(isZh ? "鏂囨。宸插垹闄?" : "Document deleted");
    } catch (error) {
      console.error("Failed to delete document:", error);
      toast.error(isZh ? "鍒犻櫎鏂囨。澶辫触" : "Failed to delete document");
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
      toast.error(
        error?.message ||
          (isZh ? "AI 鐢熸垚澶辫触锛岃閲嶈瘯" : "AI generation failed, please try again"),
      );
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
    toast.success(isZh ? "宸插簲鐢ㄥ埌褰撳墠鏂囨。" : "Applied to current document");
  };

  const showEdit = mode === "edit" || mode === "split";
  const showPreview = mode === "preview" || mode === "split";

  return (
    <div className="h-full min-h-[calc(100vh-220px)] rounded-2xl border border-gray-200 bg-white overflow-hidden">
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

        <section className="flex-1 flex flex-col min-w-0">
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

          <div className="flex-1 min-h-0 bg-white">
            {!selectedFile ? (
              <div className="h-full flex items-center justify-center text-center px-8">
                <div>
                  <BookOpen className="w-12 h-12 mx-auto text-gray-300" />
                  <p className="mt-4 text-base font-medium text-gray-900">
                    {isZh ? "浠庡乏渚ч€夋嫨涓€涓枃妗?" : "Choose a document from the left"}
                  </p>
                  <p className="mt-2 text-sm text-gray-500">
                    {isZh
                      ? "浣犲彲浠ュ厛鐢熸垚鍜ㄨ鍞墠妯℃澘锛屾垨鑰呮柊寤轰竴涓?Markdown 鏂囨。銆?"
                      : "Create the consulting pre-sales template or start a new Markdown document."}
                  </p>
                </div>
              </div>
            ) : isLoadingDoc ? (
              <div className="h-full flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : (
              <div className="h-full flex gap-4 p-4">
                {showEdit && (
                  <div className={`${mode === "split" ? "w-1/2" : "w-full"} min-w-0`}>
                    <textarea
                      value={content}
                      onChange={(event) => {
                        updateContent(event.target.value);
                      }}
                      placeholder={isZh ? "鍦ㄨ繖閲岀紪杈?Markdown 鏂囨。..." : "Edit your Markdown document here..."}
                      className="w-full h-full min-h-[calc(100vh-340px)] rounded-xl border border-gray-200 bg-white px-4 py-4 text-sm font-mono leading-7 text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                      spellCheck={false}
                    />
                  </div>
                )}

                {showPreview && (
                  <div className={`${mode === "split" ? "w-1/2" : "w-full"} min-w-0`}>
                    <div className="h-full min-h-[calc(100vh-340px)] rounded-xl border border-gray-200 bg-gray-50 px-5 py-4 overflow-auto">
                      {content.trim() ? (
                        <div className="md-root">
                          <MarkdownRenderer content={content} />
                        </div>
                      ) : (
                        <div className="h-full flex items-center justify-center text-sm text-gray-400">
                          {isZh ? "棰勮鍖?" : "Preview area"}
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

      {showDocumentDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {documentDialogMode === "create"
                    ? isZh
                      ? "鏂板缓鏂囨。"
                      : "Create Document"
                    : isZh
                      ? "閲嶅懡鍚嶆枃妗?"
                      : "Rename Document"}
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  {documentDialogMode === "create"
                    ? isZh
                      ? "浣跨敤缁熶竴缁勪欢鍒涘缓鏂扮殑椤圭洰鏂囨。銆?"
                      : "Create a new project document with the shared dialog."
                    : isZh
                      ? "淇敼褰撳墠鏂囨。鍚嶇О銆?"
                      : "Update the name of the current document."}
                </p>
              </div>
              <button
                onClick={closeDocumentDialog}
                disabled={isCreatingDoc || isRenamingDoc}
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-5">
              <label className="block text-sm font-medium text-gray-700">
                {isZh ? "鏂囨。鍚嶇О" : "Document name"}
              </label>
              <input
                type="text"
                value={documentName}
                onChange={(event) => setDocumentName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void (documentDialogMode === "create"
                      ? handleCreateDocument()
                      : handleRenameDocument());
                  }
                }}
                placeholder={isZh ? "渚嬪锛氶」鐩€昏" : "For example: Project Overview"}
                className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/20"
                autoFocus
              />
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={closeDocumentDialog}
                disabled={isCreatingDoc || isRenamingDoc}
                className="rounded-xl px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
              >
                {isZh ? "鍙栨秷" : "Cancel"}
              </button>
              <button
                onClick={() =>
                  void (documentDialogMode === "create"
                    ? handleCreateDocument()
                    : handleRenameDocument())
                }
                disabled={!documentName.trim() || isCreatingDoc || isRenamingDoc}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {(isCreatingDoc || isRenamingDoc) && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {documentDialogMode === "create"
                  ? isZh
                    ? "鍒涘缓"
                    : "Create"
                  : isZh
                    ? "淇濆瓨"
                    : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteDialog && selectedFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-red-100 bg-white p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50">
                <Trash2 className="h-5 w-5 text-red-500" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-semibold text-gray-900">
                  {isZh ? "鍒犻櫎鏂囨。" : "Delete Document"}
                </h3>
                <p className="mt-1 text-sm leading-6 text-gray-500">
                  {isZh
                    ? `纭畾瑕佸垹闄も€?{selectedFile.name}鈥濆悧锛熷垹闄ゅ悗灏嗘棤娉曟仮澶嶃€俙`
                    : `Delete "${selectedFile.name}"? This action cannot be undone.`}
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteDialog(false)}
                disabled={isDeletingDoc}
                className="rounded-xl px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
              >
                {isZh ? "鍙栨秷" : "Cancel"}
              </button>
              <button
                onClick={() => void handleDeleteDocument()}
                disabled={isDeletingDoc}
                className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {isDeletingDoc && <Loader2 className="h-4 w-4 animate-spin" />}
                {isZh ? "鍒犻櫎" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAIModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-indigo-600" />
                <h3 className="font-semibold text-gray-900">
                  {isZh ? "AI 杈呭姪鍐欎綔" : "AI Writing Assistant"}
                </h3>
              </div>
              <button
                onClick={() => {
                  setShowAIModal(false);
                  setAiDraft("");
                  setAiResult("");
                }}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="flex flex-col gap-3">
                  <label className="text-sm font-medium text-gray-700">
                    {isZh ? "鑽夌鎴栬ˉ鍏呰鏄?" : "Draft or instruction"}
                  </label>
                  <textarea
                    value={aiDraft}
                    onChange={(event) => setAiDraft(event.target.value)}
                    placeholder={isZh ? "杈撳叆琛ュ厖璇存槑锛岀暀绌哄垯鐩存帴鍩轰簬褰撳墠鏂囨。娑﹁壊銆?" : "Add guidance here, or leave empty to polish the current document."}
                    className="min-h-[220px] px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                  />
                  <button
                    onClick={() => void handleAIGenerate()}
                    disabled={aiLoading}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {isZh ? "鐢熸垚鍐呭" : "Generate"}
                  </button>
                </div>

                <div className="flex flex-col gap-3">
                  <label className="text-sm font-medium text-gray-700">
                    {isZh ? "鐢熸垚缁撴灉" : "Generated result"}
                  </label>
                  <div className="min-h-[220px] px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl overflow-auto">
                    {aiResult.trim() ? (
                      <div className="md-root text-sm">
                        <MarkdownRenderer content={aiResult} />
                      </div>
                    ) : (
                      <div className="h-full flex items-center justify-center text-sm text-gray-400">
                        {isZh ? "鐢熸垚缁撴灉浼氬嚭鐜板湪杩欓噷" : "The generated result will appear here"}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => applyAIResult("replace")}
                      disabled={!aiResult.trim()}
                      className="flex-1 px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                    >
                      {isZh ? "鏇挎崲褰撳墠鏂囨。" : "Replace"}
                    </button>
                    <button
                      onClick={() => applyAIResult("append")}
                      disabled={!aiResult.trim()}
                      className="flex-1 px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {isZh ? "杩藉姞鍒版枃妗?" : "Append"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
