import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, ChevronDown, Download, FileText, Loader2 } from "lucide-react";

import { exportConversationFile } from "../../api/chatExport";
import { getProjectChatCopy } from "./projectChatCopy";

type ProjectChatExportDropdownProps = {
  conversationId: number;
  conversationTitle?: string;
  onOpenSaveModal?: () => void;
};

export const ProjectChatExportDropdown = memo<ProjectChatExportDropdownProps>(
  ({ conversationId, conversationTitle, onOpenSaveModal }) => {
    const { i18n, t } = useTranslation();
    const copy = getProjectChatCopy(i18n.language.startsWith("zh"));
    const [isOpen, setIsOpen] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
          setIsOpen(false);
        }
      };

      if (isOpen) {
        document.addEventListener("mousedown", handleClickOutside);
      }

      return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isOpen]);

    const handleExport = async (format: "markdown" | "pdf") => {
      setIsExporting(true);
      try {
        await exportConversationFile(conversationId, format, conversationTitle || "conversation");
        setIsOpen(false);
      } catch (error) {
        console.error("Export failed:", error);
        alert(t("chat.exportFailed", copy.exportFailed));
      } finally {
        setIsExporting(false);
      }
    };

    const handleSaveToProject = () => {
      if (!onOpenSaveModal) {
        return;
      }
      onOpenSaveModal();
      setIsOpen(false);
    };

    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          disabled={isExporting}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
        >
          {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          <span className="hidden sm:inline">{t("chat.export", copy.export)}</span>
          <ChevronDown className="h-3 w-3" />
        </button>

        {isOpen && (
          <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
            <button
              onClick={() => handleExport("markdown")}
              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
            >
              <FileText className="h-4 w-4 text-gray-400" />
              {t("chat.exportMarkdown", copy.exportMarkdown)}
            </button>
            <button
              onClick={() => handleExport("pdf")}
              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
            >
              <FileText className="h-4 w-4 text-red-400" />
              {t("chat.exportPDF", copy.exportPDF)}
            </button>
            {onOpenSaveModal && (
              <button
                onClick={handleSaveToProject}
                className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                <BookOpen className="h-4 w-4 text-emerald-500" />
                {t("projects.saveConversationToProject", copy.saveConversationToProject)}
              </button>
            )}
          </div>
        )}
      </div>
    );
  },
);
