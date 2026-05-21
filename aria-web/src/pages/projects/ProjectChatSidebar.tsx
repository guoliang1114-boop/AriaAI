import {
  ChevronDown,
  ChevronRight,
  Edit3,
  Expand,
  FolderOpen,
  Loader2,
  MessageSquare,
  Search,
  Shrink,
  Trash2,
  X,
  FolderKanban,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { Conversation, ProjectFile, ProjectFolder } from "../../types/api";
import {
  formatDateOnly,
  formatDatePartsKey,
  formatTimeOnly,
} from "../../utils/timezone";
import { useAppTimeZone } from "../../hooks/useAppTimeZone";
import { getProjectChatCopy } from "./projectChatCopy";
import { ProjectSpaceFileIcon } from "./ProjectNotesFolderTree";

// ─── helpers ───────────────────────────────────────────────────────────────

function formatTime(dateStr: string, timeZone?: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const todayKey = formatDatePartsKey(now, timeZone);
  const targetKey = formatDatePartsKey(d, timeZone);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayKey = formatDatePartsKey(yesterday, timeZone);
  if (todayKey === targetKey)
    return formatTimeOnly(d, { hour: "2-digit", minute: "2-digit" }, timeZone);
  if (yesterdayKey === targetKey) return "昨天";
  return formatDateOnly(
    d,
    { year: "numeric", month: "2-digit", day: "2-digit" },
    timeZone,
  );
}

function groupConversations(conversations: Conversation[], timeZone?: string) {
  const now = new Date();
  const today: Conversation[] = [];
  const yesterdayItems: Conversation[] = [];
  const thisWeek: Conversation[] = [];
  const older: Conversation[] = [];
  const todayKey = formatDatePartsKey(now, timeZone);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayKey = formatDatePartsKey(yesterday, timeZone);
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);
  const weekStartKey = formatDatePartsKey(weekStart, timeZone);

  for (const c of conversations) {
    const itemKey = formatDatePartsKey(c.updated_at, timeZone);
    if (itemKey === todayKey) today.push(c);
    else if (itemKey === yesterdayKey) yesterdayItems.push(c);
    else if (itemKey >= weekStartKey) thisWeek.push(c);
    else older.push(c);
  }

  return [
    ...(today.length ? [{ label: "今天", items: today }] : []),
    ...(yesterdayItems.length ? [{ label: "昨天", items: yesterdayItems }] : []),
    ...(thisWeek.length ? [{ label: "本周", items: thisWeek }] : []),
    ...(older.length ? [{ label: "更早", items: older }] : []),
  ];
}

// ─── component ─────────────────────────────────────────────────────────────

type ProjectChatSidebarProps = {
  isOpen: boolean;
  isFullscreen?: boolean;
  activeConvId: number | null;
  conversations: Conversation[];
  files?: ProjectFile[];
  folders?: ProjectFolder[];
  selectedFileId?: number | null;
  isUploadingFile?: boolean;
  isLoadingConversations: boolean;
  editingConvId: number | null;
  editTitle: string;
  onStartNewChat: () => void;
  onSelectConversation: (conversationId: number) => void;
  getConversationHref?: (conversationId: number) => string;
  onBeginRename: (conversation: Conversation) => void;
  onRenameTitleChange: (value: string) => void;
  onRenameSubmit: (conversationId: number, title: string) => void;
  onCancelRename: () => void;
  onDeleteConversation: (conversation: Conversation) => void;
  onSelectFile?: (file: ProjectFile) => void;
  onUploadFiles?: (files: FileList, folderId?: number | null) => void;
  onToggleFullscreen?: () => void;
};

export function ProjectChatSidebar({
  isOpen,
  isFullscreen = false,
  activeConvId,
  conversations,
  files = [],
  folders = [],
  selectedFileId,
  isUploadingFile = false,
  isLoadingConversations,
  editingConvId,
  editTitle,
  onStartNewChat,
  onSelectConversation,
  getConversationHref,
  onBeginRename,
  onRenameTitleChange,
  onRenameSubmit,
  onCancelRename,
  onDeleteConversation,
  onSelectFile,
  onUploadFiles,
  onToggleFullscreen,
}: ProjectChatSidebarProps) {
  const { i18n } = useTranslation();
  const { resolvedTimeZone } = useAppTimeZone();
  const isZh = i18n.language.startsWith("zh");
  const copy = getProjectChatCopy(isZh);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"chat" | "space">("chat");
  const [showUploadFolderSelect, setShowUploadFolderSelect] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetFolderIdRef = useRef<number | null>(null);
  const uploadDropdownRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (!showUploadFolderSelect) return;

    const closeOnOutsideInteraction = (event: MouseEvent) => {
      if (uploadDropdownRef.current?.contains(event.target as Node)) return;
      setShowUploadFolderSelect(false);
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowUploadFolderSelect(false);
      }
    };

    document.addEventListener("mousedown", closeOnOutsideInteraction);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsideInteraction);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [showUploadFolderSelect]);

  const toggleFolder = (key: string | number) => {
    setOpenFolders((current) => ({ ...current, [key]: !current[key] }));
  };

  const openUploadPicker = (folderId?: number | null) => {
    uploadTargetFolderIdRef.current = folderId ?? folderList[0]?.id ?? null;
    uploadInputRef.current?.click();
  };

  const filteredConversations = useMemo(() => {
    if (!search.trim()) return conversations;
    const q = search.trim().toLowerCase();
    return conversations.filter((c) =>
      (c.title || "").toLowerCase().includes(q),
    );
  }, [conversations, search]);

  const conversationGroups = useMemo(
    () => groupConversations(filteredConversations, resolvedTimeZone),
    [filteredConversations, resolvedTimeZone],
  );

  const handleDelete = (
    event: React.MouseEvent,
    conversation: Conversation,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    onDeleteConversation(conversation);
  };

  return (
    <div
      className={`${isOpen ? (isFullscreen ? "w-72" : "w-56") : "w-0"} min-h-0 border-r border-slate-100 bg-white flex flex-col transition-all duration-300 ${isOpen ? "" : "overflow-hidden"}`}
    >
      {onUploadFiles ? (
        <input
          ref={uploadInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.currentTarget.files?.length) {
              onUploadFiles(event.currentTarget.files, uploadTargetFolderIdRef.current);
            }
            event.currentTarget.value = "";
          }}
        />
      ) : null}
      {/* Header */}
      <div className="px-3 pt-3 pb-2 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={onStartNewChat}
            className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-primary/90 active:scale-[0.98] whitespace-nowrap"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            {copy.newChatButton}
          </button>
          {onUploadFiles ? (
            <div ref={uploadDropdownRef} className="relative flex min-w-0 flex-1">
              <button
                type="button"
                onClick={() => {
                  if (folderList.length <= 1) {
                    openUploadPicker(folderList[0]?.id ?? null);
                  } else {
                    setShowUploadFolderSelect((v) => !v);
                  }
                }}
                disabled={isUploadingFile}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-all hover:bg-gray-50 active:scale-[0.98] disabled:opacity-50 whitespace-nowrap"
              >
                {isUploadingFile ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                {isZh ? "上传文档" : "Upload"}
                {folderList.length > 1 ? (
                  <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                ) : null}
              </button>
              {showUploadFolderSelect && folderList.length > 1 ? (
                <div className="absolute left-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
                  <div className="border-b border-slate-100 px-3 py-2">
                    <p className="text-[12px] font-semibold leading-5 text-slate-700">
                      {isZh ? "选择上传目录" : "Select upload folder"}
                    </p>
                    <p className="text-[11px] leading-4 text-slate-400">
                      {isZh ? "文件会保存到所选项目空间目录" : "Files will be saved to the selected space folder"}
                    </p>
                  </div>
                  <div className="max-h-72 overflow-y-auto py-1">
                    {folderList.map((folder) => {
                      const fileCount = groupedFiles.get(folder.id)?.length ?? 0;
                      return (
                        <button
                          key={folder.id}
                          type="button"
                          onClick={() => {
                            setShowUploadFolderSelect(false);
                            openUploadPicker(folder.id);
                          }}
                          className="group flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-slate-50"
                        >
                          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-600">
                            <FolderOpen className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="line-clamp-2 break-words text-[13px] font-medium leading-5 text-slate-800 group-hover:text-primary">
                              {folder.name}
                            </span>
                            <span className="mt-0.5 block text-[11px] leading-4 text-slate-400">
                              {isZh ? `${fileCount} 个文件` : `${fileCount} files`}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowUploadFolderSelect(false)}
                    className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-left text-[12px] font-medium text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600"
                  >
                    <X className="h-3.5 w-3.5" />
                    {isZh ? "取消" : "Cancel"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {onToggleFullscreen ? (
            <button
              type="button"
              onClick={onToggleFullscreen}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800"
              title={isFullscreen ? copy.exitFullscreen : copy.enterFullscreen}
              aria-label={isFullscreen ? copy.exitFullscreen : copy.enterFullscreen}
            >
              {isFullscreen ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
            </button>
          ) : null}
        </div>

        {/* Tabs */}
        <div className="flex rounded-md bg-gray-100 p-0.5">
          <button
            onClick={() => setActiveTab("chat")}
            className={`flex flex-1 items-center justify-center gap-1 rounded-md py-1.5 text-xs font-medium transition-all ${
              activeTab === "chat"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            {isZh ? "对话" : "Chat"}
          </button>
          <button
            onClick={() => setActiveTab("space")}
            className={`flex flex-1 items-center justify-center gap-1 rounded-md py-1.5 text-xs font-medium transition-all ${
              activeTab === "space"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <FolderKanban className="w-3.5 h-3.5" />
            {isZh ? "空间" : "Space"}
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "chat" ? (
          <div className="flex h-full flex-col">
            {/* Search */}
            <div className="px-3 pb-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={isZh ? "搜索对话" : "Search conversations"}
                  className="w-full pl-8 pr-7 py-1.5 bg-gray-50 rounded-lg text-[12px] text-gray-700 placeholder:text-gray-400 outline-none border border-gray-100 focus:border-primary/30 transition-colors"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Conversation list */}
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {isLoadingConversations ? (
                <div className="space-y-0.5 pt-1">
                  {[...Array(4)].map((_, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl animate-pulse"
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-gray-100 flex-shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <div
                          className="h-3 rounded bg-gray-100"
                          style={{ width: `${55 + (i % 3) * 18}%` }}
                        />
                        <div className="h-2 rounded bg-gray-100 w-16" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : activeConvId === null && !search ? (
                <div className="pt-1">
                  {/* New chat placeholder */}
                  <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-primary/8 mb-0.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] truncate text-primary font-medium">
                        {copy.defaultNewChatTitle}
                      </p>
                    </div>
                  </div>
                  {conversationGroups.map((group) => (
                    <div key={group.label}>
                      <p className="px-3 pt-3 pb-1 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
                        {group.label}
                      </p>
                      {group.items.map((conversation) => (
                        <Link
                          key={conversation.id}
                          to={getConversationHref?.(conversation.id) || "#"}
                          onClick={() => onSelectConversation(conversation.id)}
                          className="group flex items-center gap-2.5 px-3 py-2.5 rounded-xl mb-0.5 transition-colors hover:bg-gray-50 cursor-pointer"
                        >
                          <div className="w-1.5 h-1.5 rounded-full bg-gray-200 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] truncate text-gray-700">
                              {conversation.title || copy.defaultNewChatTitle}
                            </p>
                            <p className="text-[11px] text-gray-400 mt-0.5">
                              {formatTime(conversation.updated_at, resolvedTimeZone)}
                            </p>
                          </div>
                        </Link>
                      ))}
                    </div>
                  ))}
                </div>
              ) : filteredConversations.length === 0 && search ? (
                <p className="text-xs text-gray-300 text-center py-8">
                  {isZh ? "无搜索结果" : "No results"}
                </p>
              ) : (
                <div className="pt-1">
                  {activeConvId === null && !search && (
                    <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-primary/8 mb-0.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] truncate text-primary font-medium">
                          {copy.defaultNewChatTitle}
                        </p>
                      </div>
                    </div>
                  )}
                  {conversationGroups.map((group) => (
                    <div key={group.label}>
                      <p className="px-3 pt-3 pb-1 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
                        {group.label}
                      </p>
                      {group.items.map((conversation) => {
                        const isEditing = editingConvId === conversation.id;
                        const rowClassName = `group flex items-center gap-2.5 px-3 py-2.5 rounded-xl mb-0.5 transition-all duration-200 overflow-hidden cursor-pointer ${
                          activeConvId === conversation.id
                            ? "bg-primary/8"
                            : "hover:bg-gray-50"
                        }`;
                        const rowContent = (
                          <>
                            <div
                              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors ${
                                activeConvId === conversation.id
                                  ? "bg-primary"
                                  : "bg-gray-200"
                              }`}
                            />
                            <div className="flex-1 min-w-0">
                              {isEditing ? (
                                <input
                                  type="text"
                                  value={editTitle}
                                  onChange={(event) =>
                                    onRenameTitleChange(event.target.value)
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter")
                                      onRenameSubmit(conversation.id, editTitle);
                                    else if (event.key === "Escape")
                                      onCancelRename();
                                  }}
                                  onBlur={() =>
                                    onRenameSubmit(conversation.id, editTitle)
                                  }
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-full px-2 py-1 text-[13px] border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary/20"
                                  autoFocus
                                />
                              ) : (
                                <p
                                  className={`text-[13px] truncate transition-colors ${
                                    activeConvId === conversation.id
                                      ? "text-primary font-medium"
                                      : "text-gray-700"
                                  }`}
                                >
                                  {conversation.title || copy.defaultNewChatTitle}
                                </p>
                              )}
                              <p className="text-[11px] text-gray-400 mt-0.5">
                                {formatTime(conversation.updated_at, resolvedTimeZone)}
                              </p>
                            </div>
                            {!isEditing && (
                              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                <button
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onBeginRename(conversation);
                                  }}
                                  className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-300 hover:text-gray-500 transition-colors"
                                >
                                  <Edit3 className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={(event) =>
                                    handleDelete(event, conversation)
                                  }
                                  className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            )}
                          </>
                        );

                        return isEditing ? (
                          <div
                            key={conversation.id}
                            onClick={() => onSelectConversation(conversation.id)}
                            className={rowClassName}
                          >
                            {rowContent}
                          </div>
                        ) : (
                          <Link
                            key={conversation.id}
                            to={getConversationHref?.(conversation.id) || "#"}
                            onClick={() => onSelectConversation(conversation.id)}
                            className={rowClassName}
                          >
                            {rowContent}
                          </Link>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Project Space */
          <div className="h-full overflow-y-auto px-3 py-3">
            <div
              className="mb-3 flex w-full items-center justify-between rounded-lg px-1 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500"
            >
              <span>{isZh ? "项目空间" : "Project Space"}</span>
              <div className="flex items-center gap-1">
                <span className="text-[10px] font-medium tracking-normal text-gray-400">
                  {files.length}
                </span>
              </div>
            </div>

            <div className="space-y-1">
              {folderList.map((folder) => {
                const folderFiles = groupedFiles.get(folder.id) || [];
                const isFolderOpen = openFolders[folder.id] ?? true;
                return (
                  <div key={folder.id} className="rounded-lg">
                    <button
                      type="button"
                      onClick={() => toggleFolder(folder.id)}
                      className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-[13px] font-medium leading-5 text-gray-700 hover:bg-gray-50"
                    >
                      {isFolderOpen ? (
                        <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                      )}
                      <FolderOpen className="h-3.5 w-3.5 text-amber-500" />
                      <span className="truncate">{folder.name}</span>
                    </button>
                    {isFolderOpen ? (
                      <div className="ml-6 space-y-0.5 pb-1">
                        {folderFiles.map((file) => (
                          <button
                            type="button"
                            key={file.id}
                            title={file.name}
                            onClick={() => onSelectFile?.(file)}
                            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-5 transition-colors ${
                              selectedFileId === file.id
                                ? "bg-primary/10 font-medium text-primary"
                                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                            }`}
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
                <div className="mt-2 rounded-lg border-t border-dashed border-gray-100 pt-2">
                  <button
                    type="button"
                    onClick={() => toggleFolder("uncategorized")}
                    className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-[12px] font-medium leading-5 text-gray-500 hover:bg-gray-50"
                  >
                    {openFolders.uncategorized ? (
                      <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                    )}
                    <FolderKanban className="h-3.5 w-3.5 text-gray-400" />
                    <span>{isZh ? "待归类" : "To classify"}</span>
                    <span className="ml-auto text-[10px] text-gray-400">
                      {(groupedFiles.get("uncategorized") || []).length}
                    </span>
                  </button>
                  {openFolders.uncategorized ? (
                    <div className="ml-6 space-y-0.5 pb-1 opacity-90">
                      {(groupedFiles.get("uncategorized") || []).map((file) => (
                        <button
                          type="button"
                          key={file.id}
                          title={file.name}
                          onClick={() => onSelectFile?.(file)}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-5 transition-colors ${
                            selectedFileId === file.id
                              ? "bg-primary/10 font-medium text-primary"
                              : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                          }`}
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
        )}
      </div>
    </div>
  );
}
