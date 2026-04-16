import { Eye, Loader2, MoreVertical, Pencil, Save, Sparkles, Trash2 } from "lucide-react";
import type { ProjectFile } from "../../types/api";

export function ProjectNotesToolbar({
  dirty,
  isDeletingDoc,
  isRenamingDoc,
  isSaving,
  isZh,
  mode,
  selectedFile,
  showMoreMenu,
  onOpenAIModal,
  onOpenRename,
  onRequestDelete,
  onSave,
  onSetMode,
  onToggleMoreMenu,
}: {
  dirty: boolean;
  isDeletingDoc: boolean;
  isRenamingDoc: boolean;
  isSaving: boolean;
  isZh: boolean;
  mode: "edit" | "preview" | "split";
  selectedFile: ProjectFile | null;
  showMoreMenu: boolean;
  onOpenAIModal: () => void;
  onOpenRename: () => void;
  onRequestDelete: () => void;
  onSave: () => void;
  onSetMode: (mode: "edit" | "preview" | "split") => void;
  onToggleMoreMenu: () => void;
}) {
  return (
    <div className="px-5 py-4 border-b border-gray-200 bg-white flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-[0.18em] text-gray-400">
          {isZh ? "褰撳墠鏂囨。" : "Current Document"}
        </p>
        <h3 className="mt-1 text-lg font-semibold text-gray-900 truncate">
          {selectedFile?.name || (isZh ? "璇烽€夋嫨鏂囨。" : "Select a document")}
        </h3>
        {dirty && <p className="mt-1 text-xs text-amber-600">{isZh ? "鏈夋湭淇濆瓨淇敼" : "Unsaved changes"}</p>}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => onSetMode("edit")}
            className={`px-3 py-1.5 rounded-md text-sm ${mode === "edit" ? "bg-white shadow-sm text-gray-900" : "text-gray-500"}`}
          >
            {isZh ? "缂栬緫" : "Edit"}
          </button>
          <button
            onClick={() => onSetMode("split")}
            className={`px-3 py-1.5 rounded-md text-sm ${mode === "split" ? "bg-white shadow-sm text-gray-900" : "text-gray-500"}`}
          >
            {isZh ? "鍒嗘爮" : "Split"}
          </button>
          <button
            onClick={() => onSetMode("preview")}
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm ${mode === "preview" ? "bg-white shadow-sm text-gray-900" : "text-gray-500"}`}
          >
            <Eye className="w-3.5 h-3.5" />
            {isZh ? "棰勮" : "Preview"}
          </button>
        </div>

        <button
          onClick={onOpenAIModal}
          disabled={!selectedFile}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-50 text-indigo-700 text-sm font-medium hover:bg-indigo-100 disabled:opacity-50"
        >
          <Sparkles className="w-4 h-4" />
          {isZh ? "AI 娑﹁壊" : "AI Assist"}
        </button>

        <button
          onClick={onSave}
          disabled={!selectedFile || isSaving || !dirty}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {isZh ? "淇濆瓨" : "Save"}
        </button>

        <button
          onClick={onToggleMoreMenu}
          disabled={!selectedFile}
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          title={isZh ? "鏇村鎿嶄綔" : "More actions"}
        >
          <MoreVertical className="w-4 h-4" />
        </button>

        {showMoreMenu && (
          <div className="absolute right-0 top-full mt-2 w-40 bg-white rounded-xl border border-gray-200 shadow-lg py-1 z-50">
            <button
              onClick={onOpenRename}
              disabled={isRenamingDoc}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {isRenamingDoc ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4 text-gray-400" />}
              {isZh ? "閲嶅懡鍚?" : "Rename"}
            </button>
            <button
              onClick={onRequestDelete}
              disabled={isDeletingDoc}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {isDeletingDoc ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4 text-red-500" />}
              {isZh ? "鍒犻櫎" : "Delete"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
