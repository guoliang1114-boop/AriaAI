import { BookOpen } from "lucide-react";

interface ProjectOverviewNotesCardProps {
  isZh: boolean;
  notesText: string;
  onOpen: () => void;
}

export function ProjectOverviewNotesCard({
  isZh,
  notesText,
  onOpen,
}: ProjectOverviewNotesCardProps) {
  const previewText = notesText
    .replace(/[#+*`[\]()>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

  return (
    <div className="bg-white rounded-xl border border-codex-line">
      <div className="flex items-center justify-between p-5 border-b border-codex-line-soft">
        <h3 className="font-semibold text-codex-ink flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-codex-ink-faint" />
          {isZh ? "项目笔记" : "Project Notes"}
        </h3>
        <button onClick={onOpen} className="text-sm text-primary hover:underline">
          {isZh ? "打开笔记" : "Open notes"}
        </button>
      </div>
      <div className="p-5">
        <p className="text-sm text-codex-ink-soft line-clamp-4 whitespace-pre-wrap">
          {previewText}
        </p>
      </div>
    </div>
  );
}
