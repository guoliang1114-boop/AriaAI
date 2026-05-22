import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../api/client";
import type { Conversation, Message, PendingActionsResponse, PendingChatActionResponse, PendingToolAction } from "../../types/api";
import type { ProjectChatPendingAction } from "./ProjectChatActionPreviewPanel";
import { buildDefaultChatTitle } from "./projectChatCopy";

type UseProjectChatConversationsParams = {
  autoSelectFirstConversation?: boolean;
  projectId: number;
  isZh: boolean;
  onCreateConversationError: () => void;
  onDeleteConversationError: () => void;
  onRenameConversationError: () => void;
};

export function useProjectChatConversations({
  autoSelectFirstConversation = true,
  projectId,
  isZh,
  onCreateConversationError,
  onDeleteConversationError,
  onRenameConversationError,
}: UseProjectChatConversationsParams) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [serverPendingAction, setServerPendingAction] = useState<ProjectChatPendingAction | null>(null);
  const [pendingToolActions, setPendingToolActions] = useState<PendingToolAction[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [editingConvId, setEditingConvId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [conversationPendingDelete, setConversationPendingDelete] = useState<Conversation | null>(null);
  const [isDeletingConversation, setIsDeletingConversation] = useState(false);
  const skipNextFetchRef = useRef(false);

  useEffect(() => {
    void fetchConversations();
  }, [projectId]);

  useEffect(() => {
    if (activeConvId) {
      if (skipNextFetchRef.current) {
        skipNextFetchRef.current = false;
        return;
      }
      setMessages([]);
      setServerPendingAction(null);
      void fetchMessages(activeConvId);
    } else {
      setMessages([]);
      setServerPendingAction(null);
    }
  }, [activeConvId]);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConvId),
    [activeConvId, conversations],
  );

  const fetchConversations = async () => {
    setIsLoadingConversations(true);
    try {
      const data = await api.get<Conversation[]>(`/chat/conversations?project_id=${projectId}`);
      setConversations(data);
      if (autoSelectFirstConversation && data.length > 0 && !activeConvId) {
        setActiveConvId(data[0].id);
      }
    } catch (error) {
      console.error("Failed to fetch conversations:", error);
    } finally {
      setIsLoadingConversations(false);
    }
  };

  const fetchMessages = async (conversationId: number) => {
    setIsLoadingMessages(true);
    try {
      const [data, pendingAction] = await Promise.all([
        api.get<Message[]>(`/chat/conversations/${conversationId}/messages`, {
          params: { limit: 120, _: Date.now() },
          headers: { "Cache-Control": "no-cache" },
        }),
        fetchPendingAction(conversationId),
      ]);
      setMessages(data);
      setServerPendingAction(pendingAction);
      void fetchPendingToolActions(conversationId);
    } catch (error) {
      console.error("Failed to fetch messages:", error);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const fetchPendingAction = async (conversationId: number) => {
    try {
      const data = await api.get<PendingChatActionResponse | null>(
        `/chat/conversations/${conversationId}/pending-action`,
        {
          params: { _: Date.now() },
          headers: { "Cache-Control": "no-cache" },
        },
      );
      if (!data) return null;
      return {
        canConfirm: data.can_confirm,
        call: data.call,
        sourceContent: data.source_content,
      };
    } catch (error) {
      console.error("Failed to fetch pending chat action:", error);
      return null;
    }
  };

  const refreshPendingAction = async (conversationId: number) => {
    const pendingAction = await fetchPendingAction(conversationId);
    setServerPendingAction(pendingAction);
    return pendingAction;
  };

  const fetchPendingToolActions = async (conversationId: number) => {
    try {
      const data = await api.get<PendingActionsResponse>(`/chat/conversations/${conversationId}/pending-actions`);
      setPendingToolActions(data.items || []);
    } catch (error) {
      console.error("Failed to fetch pending tool actions:", error);
      setPendingToolActions([]);
    }
  };

  const confirmToolAction = async (actionId: number) => {
    try {
      const result = await api.post<{ status: string; result?: Record<string, unknown>; error_message?: string }>(
        `/chat/actions/${actionId}/confirm`,
        { approved: true },
      );
      // Refresh pending actions after confirmation
      if (activeConvId) {
        void fetchPendingToolActions(activeConvId);
      }
      return result;
    } catch (error) {
      console.error("Failed to confirm tool action:", error);
      throw error;
    }
  };

  const confirmToolActionBatch = async (batchId: string) => {
    try {
      const result = await api.post<{ status: string; result?: Record<string, unknown>; error_message?: string }>(
        `/chat/actions/batches/${encodeURIComponent(batchId)}/confirm`,
        { approved: true },
      );
      if (activeConvId) {
        void fetchPendingToolActions(activeConvId);
      }
      return result;
    } catch (error) {
      console.error("Failed to confirm tool action batch:", error);
      throw error;
    }
  };

  const rejectToolAction = async (actionId: number) => {
    try {
      await api.post(`/chat/actions/${actionId}/reject`, { approved: false });
      if (activeConvId) {
        void fetchPendingToolActions(activeConvId);
      }
    } catch (error) {
      console.error("Failed to reject tool action:", error);
      throw error;
    }
  };

  const rejectToolActionBatch = async (batchId: string) => {
    try {
      await api.post(`/chat/actions/batches/${encodeURIComponent(batchId)}/reject`, { approved: false });
      if (activeConvId) {
        void fetchPendingToolActions(activeConvId);
      }
    } catch (error) {
      console.error("Failed to reject tool action batch:", error);
      throw error;
    }
  };

  const clearPendingAction = () => {
    setServerPendingAction(null);
  };

  const createConversation = async (firstMessage?: string, skillId?: number | null) => {
    try {
      const title = buildDefaultChatTitle(firstMessage || "", isZh);
      const newConversation = await api.post<Conversation>("/chat/conversations", {
        project_id: projectId,
        skill_id: skillId || undefined,
        title,
      });
      setConversations((prev) => [newConversation, ...prev]);
      skipNextFetchRef.current = true;
      setActiveConvId(newConversation.id);
      return newConversation.id;
    } catch (error) {
      console.error("Failed to create conversation:", error);
      onCreateConversationError();
      return null;
    }
  };

  const deleteConversation = async (conversationId: number) => {
    setIsDeletingConversation(true);
    try {
      await api.delete(`/chat/conversations/${conversationId}`);
      setConversations((prev) => prev.filter((conversation) => conversation.id !== conversationId));
      if (activeConvId === conversationId) {
        setActiveConvId(null);
        setMessages([]);
        setServerPendingAction(null);
      }
      setConversationPendingDelete(null);
    } catch (error) {
      console.error("Failed to delete conversation:", error);
      onDeleteConversationError();
    } finally {
      setIsDeletingConversation(false);
    }
  };

  const renameConversation = async (conversationId: number, newTitle: string) => {
    const title = newTitle.trim();
    if (!title) {
      setEditingConvId(null);
      return;
    }
    try {
      await api.patch(`/chat/conversations/${conversationId}`, { title });
      setConversations((prev) =>
        prev.map((conversation) => (conversation.id === conversationId ? { ...conversation, title } : conversation)),
      );
      setEditingConvId(null);
    } catch (error) {
      console.error("Failed to rename conversation:", error);
      onRenameConversationError();
    }
  };

  const beginRenameConversation = (conversation: Conversation) => {
    setEditingConvId(conversation.id);
    setEditTitle(conversation.title);
  };

  const startNewChat = () => {
    setActiveConvId(null);
    setMessages([]);
    setServerPendingAction(null);
  };

  const openDeleteConversationDialog = (conversation: Conversation) => {
    setConversationPendingDelete(conversation);
  };

  const closeDeleteConversationDialog = () => {
    if (isDeletingConversation) return;
    setConversationPendingDelete(null);
  };

  return {
    conversations,
    activeConvId,
    setActiveConvId,
    messages,
    setMessages,
    serverPendingAction,
    pendingToolActions,
    activeConversation,
    isLoadingMessages,
    isLoadingConversations,
    editingConvId,
    setEditingConvId,
    editTitle,
    setEditTitle,
    conversationPendingDelete,
    isDeletingConversation,
    fetchConversations,
    fetchMessages,
    refreshPendingAction,
    clearPendingAction,
    fetchPendingToolActions,
    confirmToolAction,
    confirmToolActionBatch,
    rejectToolAction,
    rejectToolActionBatch,
    createConversation,
    deleteConversation,
    renameConversation,
    beginRenameConversation,
    startNewChat,
    openDeleteConversationDialog,
    closeDeleteConversationDialog,
  };
}
