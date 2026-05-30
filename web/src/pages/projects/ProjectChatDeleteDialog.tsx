import { Loader2, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { getProjectChatCopy } from "./projectChatCopy";

type ProjectChatDeleteDialogProps = {
  isOpen: boolean;
  conversationTitle?: string;
  isDeleting?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ProjectChatDeleteDialog({
  isOpen,
  conversationTitle,
  isDeleting = false,
  onCancel,
  onConfirm,
}: ProjectChatDeleteDialogProps) {
  const { i18n } = useTranslation();
  const copy = getProjectChatCopy(i18n.language.startsWith("zh"));

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-codex-line-soft px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-codex-bg-tint text-codex-bad">
              <Trash2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-codex-ink">{copy.deleteConversationTitle}</h3>
              <p className="text-sm text-codex-ink-mute">{copy.deleteConversationConfirm}</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="rounded-lg p-1.5 text-codex-ink-faint transition-colors hover:bg-codex-bg-tint"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2 px-5 py-4">
          {conversationTitle && (
            <div className="rounded-xl border border-codex-line bg-codex-bg-tint px-3 py-2">
              <p className="truncate text-sm font-medium text-codex-ink-soft">{conversationTitle}</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-codex-line-soft bg-codex-bg-tint px-5 py-4">
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="rounded-lg border border-codex-line px-4 py-2 text-sm font-medium text-codex-ink-soft transition-colors hover:bg-white disabled:opacity-50"
          >
            {copy.cancel}
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex items-center gap-2 rounded-lg bg-codex-bg-tint0 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-codex-bad disabled:opacity-50"
          >
            {isDeleting && <Loader2 className="h-4 w-4 animate-spin" />}
            {copy.deleteConversationAction}
          </button>
        </div>
      </div>
    </div>
  );
}
