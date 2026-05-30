import { Download, FolderKanban, MoreVertical, Trash2 } from "lucide-react";
import type { ProjectFile, ProjectFolder } from "../../types/api";
import { getProjectDocumentFileIcon } from "./projectDocumentsIcons";
import { formatDateTime, getResolvedAppTimeZone } from "../../utils/timezone";

interface ProjectDocumentsListViewProps {
  enterFolder: (folderName: string) => void;
  filteredFiles: ProjectFile[];
  filteredFolders: ProjectFolder[];
  handleContextMenu: (event: React.MouseEvent, item: ProjectFile | ProjectFolder) => void;
  handleDeleteFile: (fileId: number, fileName: string) => void;
  handleDownload: (file: ProjectFile) => Promise<void>;
  isZh: boolean;
}

export function ProjectDocumentsListView({
  enterFolder,
  filteredFiles,
  filteredFolders,
  handleContextMenu,
  handleDeleteFile,
  handleDownload,
  isZh,
}: ProjectDocumentsListViewProps) {
  return (
    <div className="flex-1 bg-white rounded-xl border border-codex-line overflow-hidden">
      <table className="w-full">
        <thead className="bg-codex-bg-tint border-b border-codex-line">
          <tr>
            <th className="text-left text-xs font-medium text-codex-ink-mute px-4 py-3">
              {isZh ? "名称" : "Name"}
            </th>
            <th className="text-left text-xs font-medium text-codex-ink-mute px-4 py-3 w-32">
              {isZh ? "类型" : "Type"}
            </th>
            <th className="text-left text-xs font-medium text-codex-ink-mute px-4 py-3 w-52">
              {isZh ? "修改时间" : "Modified"}
            </th>
            <th className="text-right text-xs font-medium text-codex-ink-mute px-4 py-3 w-20">
              {isZh ? "操作" : "Action"}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {filteredFolders.map((folder) => (
            <tr
              key={folder.id}
              onClick={() => enterFolder(folder.name)}
              onContextMenu={(event) => handleContextMenu(event, folder)}
              className="hover:bg-codex-bg-tint cursor-pointer group"
            >
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-codex-accent-bg flex items-center justify-center">
                    <FolderKanban className="w-5 h-5 text-codex-accent" />
                  </div>
                  <span className="font-medium text-codex-ink text-sm">{folder.name}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-codex-ink-mute">
                {isZh ? "文件夹" : "Folder"}
              </td>
              <td className="px-4 py-3 text-sm text-codex-ink-faint">-</td>
              <td className="px-4 py-3 text-right">
                <button className="p-1.5 rounded-lg hover:bg-codex-bg-tint text-codex-ink-faint opacity-0 group-hover:opacity-100 transition-opacity">
                  <MoreVertical className="w-4 h-4" />
                </button>
              </td>
            </tr>
          ))}
          {filteredFiles.map((file) => (
            <tr
              key={file.id}
              onContextMenu={(event) => handleContextMenu(event, file)}
              className="hover:bg-codex-bg-tint cursor-pointer group"
            >
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-codex-bg-tint flex items-center justify-center">
                    {getProjectDocumentFileIcon(file.file_type)}
                  </div>
                  <span className="font-medium text-codex-ink text-sm">{file.name}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-codex-ink-mute">{file.file_type}</td>
              <td className="px-4 py-3 text-sm text-codex-ink-faint">
                {formatDateTime(file.uploaded_at, isZh ? "zh-CN" : "en-GB", { hour12: false }, getResolvedAppTimeZone())}
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDownload(file);
                    }}
                    className="p-1.5 rounded-lg hover:bg-codex-bg-tint text-codex-ink-faint"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      handleDeleteFile(file.id, file.name);
                    }}
                    className="p-1.5 rounded-lg hover:bg-codex-bg-tint text-codex-ink-faint hover:text-codex-bad"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
