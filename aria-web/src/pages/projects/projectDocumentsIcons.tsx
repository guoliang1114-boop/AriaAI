import { FileText } from "lucide-react";

export function getProjectDocumentFileIcon(fileType: string) {
  const type = fileType.toLowerCase();
  if (type.includes("pdf")) return <FileText className="w-6 h-6 text-red-500" />;
  if (type.includes("doc") || type.includes("word")) {
    return <FileText className="w-6 h-6 text-blue-500" />;
  }
  if (type.includes("xls") || type.includes("sheet") || type.includes("csv")) {
    return <FileText className="w-6 h-6 text-green-500" />;
  }
  if (type.includes("ppt") || type.includes("presentation")) {
    return <FileText className="w-6 h-6 text-orange-500" />;
  }
  if (type.includes("image") || type.includes("jpg") || type.includes("png")) {
    return <FileText className="w-6 h-6 text-purple-500" />;
  }
  return <FileText className="w-6 h-6 text-gray-500" />;
}
