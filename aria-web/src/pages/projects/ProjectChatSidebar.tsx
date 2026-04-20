import { Edit3, MessageSquare, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { Conversation } from "../../types/api";
import { getProjectChatCopy } from "./projectChatCopy";

type ProjectChatSidebarProps = {
  isOpen: boolean;
  isFullscreen?: boolean;
  activeConvId: number | null;
  conversations: Conversation[];
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
};

export function ProjectChatSidebar({
  isOpen,
  isFullscreen = false,
  activeConvId,
  conversations,
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
}: ProjectChatSidebarProps) {
  const { i18n } = useTranslation();
  const copy = getProjectChatCopy(i18n.language.startsWith("zh"));

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

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
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
    </div>
  );
}
