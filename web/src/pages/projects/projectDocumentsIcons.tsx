import { FileText } from "lucide-react";

export function getProjectDocumentFileIcon(fileType: string) {
  const type = fileType.toLowerCase();
  if (type.includes("pdf")) return <FileText className="w-6 h-6 text-codex-bad" />;
  if (type.includes("doc") || type.includes("word")) {
    return <FileText className="w-6 h-6 text-codex-accent" />;
  }
  if (type.includes("xls") || type.includes("sheet") || type.includes("csv")) {
    return <FileText className="w-6 h-6 text-codex-good" />;
  }
  if (type.includes("ppt") || type.includes("presentation")) {
    return <FileText className="w-6 h-6 text-codex-warn" />;
  }
  if (type.includes("image") || type.includes("jpg") || type.includes("png")) {
    return <FileText className="w-6 h-6 text-codex-accent" />;
  }
  return <FileText className="w-6 h-6 text-codex-ink-mute" />;
}
