import { ChevronDown, ChevronRight, Edit3, FolderOpen, MessageSquare, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Conversation, ProjectFile, ProjectFolder } from "../../types/api";
import { getProjectChatCopy } from "./projectChatCopy";
import { ProjectSpaceFileIcon } from "./ProjectNotesFolderTree";

type ProjectChatSidebarProps = {
  isOpen: boolean;
  isFullscreen?: boolean;
  activeConvId: number | null;
  conversations: Conversation[];
  files?: ProjectFile[];
  folders?: ProjectFolder[];
  isLoadingConversations: boolean;
  editingConvId: number | null;
  editTitle: string;
  onStartNewChat: () => void;
  onSelectConversation: (conversationId: number) => void;
  onBeginRename: (conversation: Conversation) => void;
  onRenameTitleChange: (value: string) => void;
  onRenameSubmit: (conversationId: number, title: string) => void;
  onCancelRename: () => void;
  onDeleteConversation: (conversation: Conversation) => void;
  onOpenSpace: () => void;
};

export function ProjectChatSidebar({
  isOpen,
  isFullscreen = false,
  activeConvId,
  conversations,
  files = [],
  folders = [],
  isLoadingConversations,
  editingConvId,
  editTitle,
  onStartNewChat,
  onSelectConversation,
  onBeginRename,
  onRenameTitleChange,
  onRenameSubmit,
  onCancelRename,
  onDeleteConversation,
  onOpenSpace,
}: ProjectChatSidebarProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const copy = getProjectChatCopy(isZh);
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const folderList = useMemo(
    () =>
      [...folders].sort(
        (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
      ),
    [folders],
  );
  const groupedFiles = useMemo(() => {
    const map = new Map<number | "uncategorized", ProjectFile[]>();
    for (const folder of folderList) {
      map.set(folder.id, []);
    }
    map.set("uncategorized", []);
    for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
      const key = file.folder_id ?? "uncategorized";
      const bucket = map.get(key) || [];
      bucket.push(file);
      map.set(key, bucket);
    }
    return map;
  }, [files, folderList]);

  useEffect(() => {
    setOpenFolders((current) => {
      const next = { ...current };
      for (const folder of folderList) {
        if (!(folder.id in next)) {
          next[folder.id] = true;
        }
      }
      if (!("uncategorized" in next)) {
        next.uncategorized = true;
      }
      return next;
    });
  }, [folderList]);

  const toggleFolder = (key: string | number) => {
    setOpenFolders((current) => ({ ...current, [key]: !current[key] }));
  };

  return (
    <div
      className={`${isOpen ? (isFullscreen ? "w-72" : "w-64") : "w-0"} min-h-0 border-r border-gray-200 bg-gray-50/50 flex flex-col transition-all duration-300 ${isOpen ? "" : "overflow-hidden"}`}
    >
      <div className="p-4 border-b border-gray-100 bg-white">
        <button
          onClick={onStartNewChat}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          {copy.newChatButton}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-1">
        {activeConvId === null && (
          <div className="flex items-center gap-2 p-2.5 bg-white rounded-lg border border-primary/20 shadow-sm">
            <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
              <MessageSquare className="w-3.5 h-3.5 text-primary flex-shrink-0" />
            </div>
            <p className="text-sm font-medium text-gray-900 truncate">{copy.defaultNewChatTitle}</p>
          </div>
        )}

        {isLoadingConversations ? (
          <div className="p-2 space-y-2 animate-pulse">
            {[80, 60, 70, 55].map((width, index) => (
              <div key={index} className="flex items-center gap-2 p-2.5">
                <div className="w-6 h-6 rounded bg-gray-200 flex-shrink-0" />
                <div className="h-3 bg-gray-200 rounded-full" style={{ width: `${width}%` }} />
              </div>
            ))}
          </div>
        ) : conversations.length === 0 && activeConvId !== null ? (
          <div className="p-4 text-center text-gray-400 text-sm">{copy.noConversations}</div>
        ) : (
          conversations.map((conversation) => (
            <div
              key={conversation.id}
              onClick={() => onSelectConversation(conversation.id)}
              className={`group flex items-center gap-2 p-2.5 cursor-pointer rounded-lg transition-all ${
                activeConvId === conversation.id
                  ? "bg-white shadow-sm border border-gray-200"
                  : "hover:bg-white hover:shadow-sm border border-transparent hover:border-gray-200"
              }`}
            >
              <div
                className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${
                  activeConvId === conversation.id ? "bg-primary/10" : "bg-gray-100 group-hover:bg-primary/5"
                }`}
              >
                <MessageSquare
                  className={`w-3.5 h-3.5 flex-shrink-0 ${
                    activeConvId === conversation.id ? "text-primary" : "text-gray-400 group-hover:text-primary/60"
                  }`}
                />
              </div>
              <div className="flex-1 min-w-0">
                {editingConvId === conversation.id ? (
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(event) => onRenameTitleChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") onRenameSubmit(conversation.id, editTitle);
                      else if (event.key === "Escape") onCancelRename();
                    }}
                    onBlur={() => onRenameSubmit(conversation.id, editTitle)}
                    className="w-full px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary/20"
                    autoFocus
                  />
                ) : (
                  <p
                    className={`text-sm truncate ${
                      activeConvId === conversation.id ? "font-medium text-gray-900" : "text-gray-600"
                    }`}
                  >
                    {conversation.title}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onBeginRename(conversation);
                  }}
                  className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <Edit3 className="w-3 h-3" />
                </button>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteConversation(conversation);
                  }}
                  className="p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="max-h-[45%] min-h-56 overflow-y-auto border-t border-gray-200 bg-white/70 p-2">
        <button
          type="button"
          onClick={onOpenSpace}
          className="mb-2 flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 hover:bg-white"
        >
          <span>{isZh ? "项目空间" : "Project Space"}</span>
          <span className="text-[10px] font-medium tracking-normal text-gray-400">
            {files.length}
          </span>
        </button>

        <div className="space-y-1">
          {folderList.map((folder) => {
            const folderFiles = groupedFiles.get(folder.id) || [];
            const isOpen = openFolders[folder.id] ?? true;
            return (
              <div key={folder.id} className="rounded-lg">
                <button
                  type="button"
                  onClick={() => toggleFolder(folder.id)}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  {isOpen ? (
                    <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                  )}
                  <FolderOpen className="h-3.5 w-3.5 text-amber-500" />
                  <span className="truncate">{folder.name}</span>
                </button>
                {isOpen ? (
                  <div className="ml-5 space-y-0.5 pb-1">
                    {folderFiles.map((file) => (
                      <button
                        key={file.id}
                        type="button"
                        onClick={onOpenSpace}
                        title={file.name}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-gray-600 hover:bg-primary/5 hover:text-primary"
                      >
                        <ProjectSpaceFileIcon file={file} />
                        <span className="truncate">{file.name}</span>
                      </button>
                    ))}
                    {folderFiles.length === 0 ? (
                      <p className="px-2 py-1 text-xs text-gray-400">
                        {isZh ? "暂无文件" : "No files"}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}

          {(groupedFiles.get("uncategorized") || []).length > 0 ? (
            <div className="rounded-lg">
              <button
                type="button"
                onClick={() => toggleFolder("uncategorized")}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                {openFolders.uncategorized ? (
                  <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                )}
                <FolderOpen className="h-3.5 w-3.5 text-gray-400" />
                <span>{isZh ? "未归类" : "Uncategorized"}</span>
              </button>
              {openFolders.uncategorized ? (
                <div className="ml-5 space-y-0.5 pb-1">
                  {(groupedFiles.get("uncategorized") || []).map((file) => (
                    <button
                      key={file.id}
                      type="button"
                      onClick={onOpenSpace}
                      title={file.name}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-gray-600 hover:bg-primary/5 hover:text-primary"
                    >
                      <ProjectSpaceFileIcon file={file} />
                      <span className="truncate">{file.name}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {files.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-200 bg-white px-3 py-4 text-center text-xs text-gray-400">
              {isZh ? "暂无空间文件" : "No space files yet"}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
