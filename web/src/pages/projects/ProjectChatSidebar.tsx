import {
  Brain,
  ChevronDown,
  ChevronRight,
  Edit3,
  Expand,
  FolderOpen,
  Loader2,
  MessageSquare,
  Search,
  Shrink,
  Star,
  Trash2,
  X,
  FolderKanban,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type {
  Conversation,
  ProjectFile,
  ProjectFolder,
  ProjectMemory,
} from "../../types/api";
import {
  formatDateOnly,
  formatDatePartsKey,
  formatTimeOnly,
} from "../../utils/timezone";
import { useAppTimeZone } from "../../hooks/useAppTimeZone";
import { getProjectChatCopy } from "./projectChatCopy";
import { ProjectSpaceFileIcon } from "./projectFileIcon";

// ─── helpers ───────────────────────────────────────────────────────────────

export function formatProjectConversationTime(
  dateStr: string,
  timeZone?: string,
  now = new Date(),
) {
  const todayKey = formatDatePartsKey(now, timeZone);
  const targetKey = formatDatePartsKey(dateStr, timeZone);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayKey = formatDatePartsKey(yesterday, timeZone);
  if (todayKey === targetKey)
    return formatTimeOnly(
      dateStr,
      { hour: "2-digit", minute: "2-digit", hour12: false },
      timeZone,
    );
  if (yesterdayKey === targetKey) return "昨天";
  return formatDateOnly(
    dateStr,
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
    ...(yesterdayItems.length
      ? [{ label: "昨天", items: yesterdayItems }]
      : []),
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
  /** Project memory snapshot for the Space tree's 项目记忆 / 锚点
   *  branches. Optional so the sidebar still renders when memory hasn't
   *  loaded yet (Space view shows only the files tree in that case). */
  memory?: ProjectMemory | null;
  memoryStale?: boolean;
  memoryVersion?: number;
  /** Click target for the Space tree branches that link into the
   *  project memory tab. Sidebar doesn't know the project id, so the
   *  caller wires this up. */
  onOpenMemoryTab?: () => void;
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
  memory = null,
  memoryStale = false,
  memoryVersion = 0,
  onOpenMemoryTab,
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
    for (const file of [...files].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
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
      className={`${isOpen ? (isFullscreen ? "w-72" : "w-56") : "w-0"} min-h-0 border-r border-codex-line-soft bg-white flex flex-col text-[12.5px] transition-all duration-300 ${isOpen ? "" : "overflow-hidden"}`}
    >
      {onUploadFiles ? (
        <input
          ref={uploadInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.currentTarget.files?.length) {
              onUploadFiles(
                event.currentTarget.files,
                uploadTargetFolderIdRef.current,
              );
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
            className="flex min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-codex-accent px-2.5 py-1.5 text-[12px] font-medium leading-4 text-white transition-all hover:bg-primary/90 active:scale-[0.98]"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            {copy.newChatButton}
          </button>
          {onUploadFiles ? (
            <div
              ref={uploadDropdownRef}
              className="relative flex min-w-0 flex-1"
            >
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
                className="flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-codex-line bg-white px-2.5 py-1.5 text-[12px] font-medium leading-4 text-codex-ink-soft transition-all hover:bg-codex-bg-tint active:scale-[0.98] disabled:opacity-50"
              >
                {isUploadingFile ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                {isZh ? "上传文档" : "Upload"}
                {folderList.length > 1 ? (
                  <ChevronDown className="h-3.5 w-3.5 text-codex-ink-faint" />
                ) : null}
              </button>
              {showUploadFolderSelect && folderList.length > 1 ? (
                <div className="absolute left-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-lg border border-codex-line bg-white shadow-xl shadow-slate-900/10">
                  <div className="border-b border-codex-line-soft px-3 py-2">
                    <p className="text-[13px] font-semibold leading-5 text-codex-ink-soft">
                      {isZh ? "选择上传目录" : "Select upload folder"}
                    </p>
                    <p className="text-xs leading-4 text-codex-ink-mute">
                      {isZh
                        ? "文件会保存到所选项目空间目录"
                        : "Files will be saved to the selected space folder"}
                    </p>
                  </div>
                  <div className="max-h-72 overflow-y-auto py-1">
                    {folderList.map((folder) => {
                      const fileCount =
                        groupedFiles.get(folder.id)?.length ?? 0;
                      return (
                        <button
                          key={folder.id}
                          type="button"
                          onClick={() => {
                            setShowUploadFolderSelect(false);
                            openUploadPicker(folder.id);
                          }}
                          className="group flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-codex-bg-tint"
                        >
                          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-codex-bg-tint text-codex-warn">
                            <FolderOpen className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="line-clamp-2 break-words text-[13px] font-medium leading-5 text-codex-ink-soft group-hover:text-codex-accent">
                              {folder.name}
                            </span>
                            <span className="mt-0.5 block text-xs leading-4 text-codex-ink-mute">
                              {isZh
                                ? `${fileCount} 个文件`
                                : `${fileCount} files`}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowUploadFolderSelect(false)}
                    className="flex w-full items-center gap-2 border-t border-codex-line-soft px-3 py-2 text-left text-xs font-medium text-codex-ink-mute transition-colors hover:bg-codex-bg-tint hover:text-codex-ink-soft"
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
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-codex-line bg-white text-codex-ink-mute transition-colors hover:bg-codex-bg-tint hover:text-codex-ink-soft"
              title={isFullscreen ? copy.exitFullscreen : copy.enterFullscreen}
              aria-label={
                isFullscreen ? copy.exitFullscreen : copy.enterFullscreen
              }
            >
              {isFullscreen ? (
                <Shrink className="h-4 w-4" />
              ) : (
                <Expand className="h-4 w-4" />
              )}
            </button>
          ) : null}
        </div>

        {/* Tabs — flat bottom-border style to match the project shell */}
        <div
          className="flex items-stretch"
          style={{ borderBottom: "1px solid var(--color-codex-line-soft)" }}
        >
          {(
            [
              { key: "chat" as const, icon: MessageSquare, label: isZh ? "对话" : "Chat" },
              { key: "space" as const, icon: FolderKanban, label: isZh ? "空间" : "Space" },
            ]
          ).map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className="inline-flex flex-1 items-center justify-center transition-colors"
                style={{
                  gap: 6,
                  padding: "8px 0",
                  fontSize: 12.5,
                  lineHeight: 1.35,
                  fontWeight: active ? 500 : 400,
                  color: active
                    ? "var(--color-codex-ink)"
                    : "var(--color-codex-ink-mute)",
                  background: "transparent",
                  border: "none",
                  borderBottom: `2px solid ${
                    active ? "var(--color-codex-accent)" : "transparent"
                  }`,
                  marginBottom: -1,
                }}
              >
                <tab.icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "chat" ? (
          <div className="flex h-full flex-col">
            {/* Search */}
            <div className="px-3 pb-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-codex-ink-faint pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={isZh ? "搜索对话" : "Search conversations"}
                  className="w-full rounded-lg border border-codex-line-soft bg-codex-bg-tint py-1.5 pl-8 pr-7 text-[12.5px] leading-5 text-codex-ink-soft outline-none transition-colors placeholder:text-codex-ink-faint focus:border-primary/30"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-codex-ink-faint hover:text-codex-ink-mute"
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
                      className="flex items-center gap-2 px-2.5 py-2 rounded-lg animate-pulse"
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-codex-bg-tint flex-shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <div
                          className="h-3 rounded bg-codex-bg-tint"
                          style={{ width: `${55 + (i % 3) * 18}%` }}
                        />
                        <div className="h-2 rounded bg-codex-bg-tint w-16" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : activeConvId === null && !search ? (
                <div className="pt-1">
                  {/* New chat placeholder */}
                  <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-primary/8 mb-0.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-codex-accent flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-[12.5px] font-medium leading-5 text-codex-accent">
                        {copy.defaultNewChatTitle}
                      </p>
                    </div>
                  </div>
                  {conversationGroups.map((group) => (
                    <div key={group.label}>
                      <p className="px-2.5 pt-3 pb-1 text-[11.5px] font-semibold leading-4 text-codex-ink-mute">
                        {group.label}
                      </p>
                      {group.items.map((conversation) => (
                        <Link
                          key={conversation.id}
                          to={getConversationHref?.(conversation.id) || "#"}
                          onClick={() => onSelectConversation(conversation.id)}
                          className="group flex items-center gap-2 px-2.5 py-2 rounded-lg mb-0.5 transition-colors hover:bg-codex-bg-tint cursor-pointer"
                        >
                          <div className="w-1.5 h-1.5 rounded-full bg-codex-bg-tint flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="truncate text-[12.5px] leading-5 text-codex-ink-soft">
                              {conversation.title || copy.defaultNewChatTitle}
                            </p>
                            <p className="mt-0.5 text-[11.5px] leading-4 text-codex-ink-mute">
                              {formatProjectConversationTime(
                                conversation.updated_at,
                                resolvedTimeZone,
                              )}
                            </p>
                          </div>
                        </Link>
                      ))}
                    </div>
                  ))}
                </div>
              ) : filteredConversations.length === 0 && search ? (
                <p className="text-xs text-codex-ink-faint text-center py-8">
                  {isZh ? "无搜索结果" : "No results"}
                </p>
              ) : (
                <div className="pt-1">
                  {activeConvId === null && !search && (
                    <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-primary/8 mb-0.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-codex-accent flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-[12.5px] font-medium leading-5 text-codex-accent">
                          {copy.defaultNewChatTitle}
                        </p>
                      </div>
                    </div>
                  )}
                  {conversationGroups.map((group) => (
                    <div key={group.label}>
                      <p className="px-2.5 pt-3 pb-1 text-[11.5px] font-semibold leading-4 text-codex-ink-mute">
                        {group.label}
                      </p>
                      {group.items.map((conversation) => {
                        const isEditing = editingConvId === conversation.id;
                        const rowClassName = `group flex items-center gap-2 px-2.5 py-2 rounded-lg mb-0.5 transition-all duration-200 overflow-hidden cursor-pointer ${
                          activeConvId === conversation.id
                            ? "bg-primary/8"
                            : "hover:bg-codex-bg-tint"
                        }`;
                        const rowContent = (
                          <>
                            <div
                              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors ${
                                activeConvId === conversation.id
                                  ? "bg-codex-accent"
                                  : "bg-codex-bg-tint"
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
                                      onRenameSubmit(
                                        conversation.id,
                                        editTitle,
                                      );
                                    else if (event.key === "Escape")
                                      onCancelRename();
                                  }}
                                  onBlur={() =>
                                    onRenameSubmit(conversation.id, editTitle)
                                  }
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-full rounded border border-codex-line px-2 py-1 text-[12.5px] leading-5 focus:outline-none focus:ring-2 focus:ring-primary/20"
                                  autoFocus
                                />
                              ) : (
                                <p
                                  className={`truncate text-[12.5px] leading-5 transition-colors ${
                                    activeConvId === conversation.id
                                      ? "text-codex-accent font-medium"
                                      : "text-codex-ink-soft"
                                  }`}
                                >
                                  {conversation.title ||
                                    copy.defaultNewChatTitle}
                                </p>
                              )}
                              <p className="mt-0.5 text-[11.5px] leading-4 text-codex-ink-mute">
                                {formatProjectConversationTime(
                                  conversation.updated_at,
                                  resolvedTimeZone,
                                )}
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
                                  className="p-1 rounded-md hover:bg-codex-bg-tint text-codex-ink-faint hover:text-codex-ink-mute transition-colors"
                                >
                                  <Edit3 className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={(event) =>
                                    handleDelete(event, conversation)
                                  }
                                  className="p-1 rounded-md hover:bg-codex-bg-tint text-codex-ink-faint hover:text-codex-bad transition-colors"
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
                            onClick={() =>
                              onSelectConversation(conversation.id)
                            }
                            className={rowClassName}
                          >
                            {rowContent}
                          </div>
                        ) : (
                          <Link
                            key={conversation.id}
                            to={getConversationHref?.(conversation.id) || "#"}
                            onClick={() =>
                              onSelectConversation(conversation.id)
                            }
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
          <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            <div className="mb-2.5 flex w-full items-center justify-between rounded-lg px-1 text-left text-[12px] font-semibold leading-4 text-codex-ink-mute">
              <span>{isZh ? "项目空间" : "Project Space"}</span>
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-codex-ink-faint">
                  {files.length}
                </span>
              </div>
            </div>

            {/* Drop zone — matches direction-codex-project-chat.jsx
             * "拖入文件或点击上传" affordance. Click opens the file
             * picker; native drag-and-drop also routes through the
             * existing onUploadFiles handler. */}
            {onUploadFiles ? (
              <button
                type="button"
                onClick={() => openUploadPicker(folderList[0]?.id ?? null)}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const dropped = event.dataTransfer.files;
                  if (dropped && dropped.length > 0) {
                    onUploadFiles(dropped, folderList[0]?.id ?? null);
                  }
                }}
                disabled={isUploadingFile}
                className="mb-3 flex w-full flex-col items-center justify-center transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  gap: 4,
                  padding: "12px 10px",
                  fontSize: 11.5,
                  color: "var(--color-codex-ink-mute)",
                  background: "transparent",
                  border: "1px dashed var(--color-codex-line-strong, var(--color-codex-line))",
                  borderRadius: "var(--codex-r-sm, 6px)",
                  textAlign: "center",
                  lineHeight: 1.45,
                }}
              >
                {isUploadingFile ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: "var(--color-codex-accent)" }} />
                ) : null}
                <span style={{ color: "var(--color-codex-ink-soft, var(--color-codex-ink))" }}>
                  {isZh ? "拖入文件或点击上传" : "Drop files or click to upload"}
                </span>
                <span style={{ fontSize: 10.5, color: "var(--color-codex-ink-faint, var(--color-codex-ink-mute))" }}>
                  PDF / DOC / MD / TXT · ≤ 50 MB
                </span>
              </button>
            ) : null}

            {/* 项目记忆 + 锚点 tree branches — per
             * direction-codex-project-chat.jsx "空间" view. Wired to
             * the project memory data so counts and version stay
             * live; clicking any item opens the memory tab. */}
            {memory || memoryVersion > 0 ? (
              <div className="mb-1 space-y-0.5">
                {/* 项目记忆 */}
                <div className="rounded-lg">
                  <button
                    type="button"
                    onClick={() => toggleFolder("memory")}
                    className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-[12.5px] font-medium leading-5 text-codex-ink-soft hover:bg-codex-bg-tint"
                  >
                    {openFolders.memory ?? true ? (
                      <ChevronDown className="h-3.5 w-3.5 text-codex-ink-faint" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-codex-ink-faint" />
                    )}
                    <Brain
                      className="h-3.5 w-3.5"
                      style={{ color: "var(--color-codex-accent)" }}
                    />
                    <span className="truncate">
                      {isZh ? "项目记忆" : "Memory"}
                    </span>
                    <span
                      className="ml-auto"
                      style={{
                        fontFamily:
                          'var(--codex-mono, "JetBrains Mono", ui-monospace, monospace)',
                        fontSize: 10.5,
                        color: memoryStale
                          ? "var(--color-codex-warn)"
                          : "var(--color-codex-ink-faint)",
                      }}
                    >
                      v{memoryVersion}
                    </span>
                  </button>
                  {(openFolders.memory ?? true) ? (
                    <div className="ml-6 space-y-0.5 pb-1">
                      <button
                        type="button"
                        onClick={() => onOpenMemoryTab?.()}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] leading-5 text-codex-ink-soft transition-colors hover:bg-codex-bg-tint hover:text-codex-ink"
                      >
                        <span
                          style={{
                            width: 5,
                            height: 5,
                            borderRadius: 99,
                            background: memoryStale
                              ? "var(--color-codex-warn)"
                              : "var(--color-codex-good)",
                          }}
                        />
                        <span className="truncate">
                          {memoryStale
                            ? isZh
                              ? "记忆待更新"
                              : "Memory stale"
                            : isZh
                              ? "当前已同步"
                              : "Currently synced"}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenMemoryTab?.()}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] leading-5 text-codex-ink-soft transition-colors hover:bg-codex-bg-tint hover:text-codex-ink"
                      >
                        <span
                          style={{
                            width: 5,
                            height: 5,
                            borderRadius: 99,
                            background: "var(--color-codex-ink-faint, var(--color-codex-ink-mute))",
                          }}
                        />
                        <span className="truncate">
                          {isZh ? "历史版本" : "Version history"}
                        </span>
                      </button>
                    </div>
                  ) : null}
                </div>

                {/* 锚点 */}
                {(() => {
                  const riskCount = (memory?.key_risks_detail?.pinned || []).filter(Boolean).length;
                  const questionCount = (memory?.open_questions_detail?.pinned || []).filter(Boolean).length;
                  const stakeholderCount = (memory?.stakeholder_notes_detail?.pinned || []).filter(Boolean).length;
                  const total = riskCount + questionCount + stakeholderCount;
                  return (
                    <div className="rounded-lg">
                      <button
                        type="button"
                        onClick={() => toggleFolder("anchors")}
                        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-[12.5px] font-medium leading-5 text-codex-ink-soft hover:bg-codex-bg-tint"
                      >
                        {openFolders.anchors ?? false ? (
                          <ChevronDown className="h-3.5 w-3.5 text-codex-ink-faint" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-codex-ink-faint" />
                        )}
                        <Star
                          className="h-3.5 w-3.5 fill-current"
                          style={{ color: "var(--color-codex-accent)" }}
                        />
                        <span className="truncate">{isZh ? "锚点" : "Anchors"}</span>
                        <span
                          className="ml-auto"
                          style={{
                            fontFamily:
                              'var(--codex-mono, "JetBrains Mono", ui-monospace, monospace)',
                            fontSize: 10.5,
                            color: "var(--color-codex-ink-faint)",
                          }}
                        >
                          {total}
                        </span>
                      </button>
                      {(openFolders.anchors ?? false) ? (
                        <div className="ml-6 space-y-0.5 pb-1">
                          {[
                            {
                              key: "risks",
                              label: isZh ? "风险锚点" : "Risk anchors",
                              count: riskCount,
                              color: "var(--color-codex-bad)",
                            },
                            {
                              key: "questions",
                              label: isZh ? "待确认问题" : "Open questions",
                              count: questionCount,
                              color: "var(--color-codex-warn)",
                            },
                            {
                              key: "stakeholders",
                              label: isZh ? "干系人提示" : "Stakeholder notes",
                              count: stakeholderCount,
                              color: "var(--color-codex-info, var(--color-codex-accent))",
                            },
                          ].map((row) => (
                            <button
                              key={row.key}
                              type="button"
                              onClick={() => onOpenMemoryTab?.()}
                              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] leading-5 text-codex-ink-soft transition-colors hover:bg-codex-bg-tint hover:text-codex-ink"
                            >
                              <span
                                style={{
                                  width: 5,
                                  height: 5,
                                  borderRadius: 99,
                                  background: row.color,
                                }}
                              />
                              <span className="truncate flex-1">{row.label}</span>
                              <span
                                style={{
                                  fontFamily:
                                    'var(--codex-mono, "JetBrains Mono", ui-monospace, monospace)',
                                  fontSize: 10,
                                  color: "var(--color-codex-ink-faint)",
                                }}
                              >
                                {row.count}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })()}

                {/* divider between memory/anchors and files */}
                <div
                  style={{
                    height: 1,
                    margin: "8px 0 4px",
                    background: "var(--color-codex-line-soft)",
                  }}
                />

                {/* 文档 header */}
                <div className="flex items-center gap-1.5 px-1.5 py-1 text-[11.5px] font-medium leading-4 text-codex-ink-mute">
                  <FolderKanban className="h-3 w-3 text-codex-ink-faint" />
                  <span>{isZh ? "文档" : "Documents"}</span>
                  <span
                    className="ml-auto"
                    style={{
                      fontFamily:
                        'var(--codex-mono, "JetBrains Mono", ui-monospace, monospace)',
                      fontSize: 10.5,
                      color: "var(--color-codex-ink-faint)",
                    }}
                  >
                    {files.length}
                  </span>
                </div>
              </div>
            ) : null}

            <div className="space-y-1">
              {folderList.map((folder) => {
                const folderFiles = groupedFiles.get(folder.id) || [];
                const isFolderOpen = openFolders[folder.id] ?? true;
                return (
                  <div key={folder.id} className="rounded-lg">
                    <button
                      type="button"
                      onClick={() => toggleFolder(folder.id)}
                      className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-[12.5px] font-medium leading-5 text-codex-ink-soft hover:bg-codex-bg-tint"
                    >
                      {isFolderOpen ? (
                        <ChevronDown className="h-3.5 w-3.5 text-codex-ink-faint" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-codex-ink-faint" />
                      )}
                      <FolderOpen className="h-3.5 w-3.5 text-codex-warn" />
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
                            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] leading-5 transition-colors ${
                              selectedFileId === file.id
                                ? "bg-primary/10 font-medium text-codex-accent"
                                : "text-codex-ink-soft hover:bg-codex-bg-tint hover:text-codex-ink"
                            }`}
                          >
                            <ProjectSpaceFileIcon file={file} />
                            <span className="truncate">{file.name}</span>
                          </button>
                        ))}
                        {folderFiles.length === 0 ? (
                          <p className="px-2 py-1 text-xs text-codex-ink-faint">
                            {isZh ? "暂无文件" : "No files"}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}

              {(groupedFiles.get("uncategorized") || []).length > 0 ? (
                <div className="mt-2 rounded-lg border-t border-dashed border-codex-line-soft pt-2">
                  <button
                    type="button"
                    onClick={() => toggleFolder("uncategorized")}
                    className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-[12.5px] font-medium leading-5 text-codex-ink-mute hover:bg-codex-bg-tint"
                  >
                    {openFolders.uncategorized ? (
                      <ChevronDown className="h-3.5 w-3.5 text-codex-ink-faint" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-codex-ink-faint" />
                    )}
                    <FolderKanban className="h-3.5 w-3.5 text-codex-ink-faint" />
                    <span>{isZh ? "待归类" : "To classify"}</span>
                    <span className="ml-auto text-xs text-codex-ink-faint">
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
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] leading-5 transition-colors ${
                            selectedFileId === file.id
                              ? "bg-primary/10 font-medium text-codex-accent"
                              : "text-codex-ink-soft hover:bg-codex-bg-tint hover:text-codex-ink"
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
                <p className="rounded-lg border border-dashed border-codex-line bg-white px-3 py-4 text-center text-xs text-codex-ink-faint">
                  {isZh ? "暂无空间文件" : "No space files yet"}
                </p>
              ) : null}
            </div>
          </div>

          {/* Storage usage footer — matches the design's bottom strip.
           * No quota endpoint yet, so we show used size + file count
           * rather than the "23 MB / 1 GB" bar. The bar visual flips on
           * once the backend reports a quota. */}
          <div
            className="flex items-center justify-between"
            style={{
              padding: "8px 12px",
              fontSize: 11,
              color: "var(--color-codex-ink-mute)",
              borderTop: "1px solid var(--color-codex-line-soft)",
              background: "var(--color-codex-bg-elev)",
            }}
          >
            <span
              className="inline-flex items-center"
              style={{ gap: 6 }}
            >
              <FolderKanban
                className="h-3 w-3"
                style={{ color: "var(--color-codex-ink-faint, var(--color-codex-ink-mute))" }}
              />
              <span
                style={{
                  fontFamily:
                    'var(--codex-mono, "JetBrains Mono", ui-monospace, monospace)',
                  color: "var(--color-codex-ink-soft, var(--color-codex-ink))",
                }}
              >
                {formatStorageSize(
                  files.reduce((sum, file) => sum + (file.size || 0), 0),
                )}
              </span>
              <span style={{ color: "var(--color-codex-ink-faint, var(--color-codex-ink-mute))" }}>
                · {files.length} {isZh ? "份" : "files"}
              </span>
            </span>
          </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatStorageSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
