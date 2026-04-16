import { Loader2, X } from "lucide-react";

type DocumentDialogMode = "create" | "rename";

interface ProjectNotesDocumentDialogProps {
  isOpen: boolean;
  isPending: boolean;
  isZh: boolean;
  mode: DocumentDialogMode;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

const COPY = {
  createTitle: { zh: "新建文档", en: "Create Document" },
  renameTitle: { zh: "重命名文档", en: "Rename Document" },
  createDescription: {
    zh: "为当前项目新增一篇 Markdown 文档。",
    en: "Create a new Markdown document for this project.",
  },
  renameDescription: {
    zh: "更新当前文档的名称。",
    en: "Update the name of the current document.",
  },
  fieldLabel: { zh: "文档名称", en: "Document name" },
  placeholder: { zh: "例如：项目总览", en: "For example: Project Overview" },
  cancel: { zh: "取消", en: "Cancel" },
  create: { zh: "创建", en: "Create" },
  save: { zh: "保存", en: "Save" },
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

export function ProjectNotesDocumentDialog({
  isOpen,
  isPending,
  isZh,
  mode,
  value,
  onChange,
  onClose,
  onSubmit,
}: ProjectNotesDocumentDialogProps) {
  if (!isOpen) return null;

  const title = mode === "create" ? COPY.createTitle : COPY.renameTitle;
  const description =
    mode === "create" ? COPY.createDescription : COPY.renameDescription;
  const submitLabel = mode === "create" ? COPY.create : COPY.save;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              {pick(isZh, title)}
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {pick(isZh, description)}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isPending}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5">
          <label className="block text-sm font-medium text-gray-700">
            {pick(isZh, COPY.fieldLabel)}
          </label>
          <input
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              onSubmit();
            }}
            placeholder={pick(isZh, COPY.placeholder)}
            className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/20"
            autoFocus
          />
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={isPending}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            {pick(isZh, COPY.cancel)}
          </button>
          <button
            onClick={onSubmit}
            disabled={!value.trim() || isPending}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {pick(isZh, submitLabel)}
          </button>
        </div>
      </div>
    </div>
  );
}
