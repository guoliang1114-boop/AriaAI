import { BookOpen, Loader2 } from "lucide-react";
import { MarkdownRenderer } from "../../components/MarkdownRenderer";

interface ProjectNotesContentPanelProps {
  content: string;
  copy: {
    editPlaceholder: string;
    emptyDescription: string;
    emptyTitle: string;
    previewEmpty: string;
  };
  isLoadingDoc: boolean;
  mode: "edit" | "preview" | "split";
  selectedFile: unknown;
  updateContent: (value: string) => void;
}

export function ProjectNotesContentPanel({
  content,
  copy,
  isLoadingDoc,
  mode,
  selectedFile,
  updateContent,
}: ProjectNotesContentPanelProps) {
  const showEdit = mode === "edit" || mode === "split";
  const showPreview = mode === "preview" || mode === "split";

  if (!selectedFile) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center">
        <div>
          <BookOpen className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-4 text-base font-medium text-gray-900">{copy.emptyTitle}</p>
          <p className="mt-2 text-sm text-gray-500">{copy.emptyDescription}</p>
        </div>
      </div>
    );
  }

  if (isLoadingDoc) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-full gap-4 p-4">
      {showEdit && (
        <div className={`${mode === "split" ? "w-1/2" : "w-full"} min-w-0`}>
          <textarea
            value={content}
            onChange={(event) => updateContent(event.target.value)}
            placeholder={copy.editPlaceholder}
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
                {copy.previewEmpty}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
