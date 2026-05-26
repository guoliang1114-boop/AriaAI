import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../api/client";
import type { Conversation, Message, PendingActionsResponse, PendingChatActionResponse, PendingToolAction } from "../../types/api";
import type { ProjectChatPendingAction } from "./ProjectChatActionPreviewPanel";
import { buildDefaultChatTitle } from "./projectChatCopy";

type UseProjectChatConversationsParams = {
  autoSelectFirstConversation?: boolean;
  initialConversationId?: number | null;
  projectId: number;
  isZh: boolean;
  onCreateConversationError: () => void;
  onDeleteConversationError: () => void;
  onRenameConversationError: () => void;
};

type RefreshOptions = {
  silent?: boolean;
};

export function useProjectChatConversations({
  autoSelectFirstConversation = true,
  initialConversationId = null,
  projectId,
  isZh,
  onCreateConversationError,
  onDeleteConversationError,
  onRenameConversationError,
}: UseProjectChatConversationsParams) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(() => initialConversationId);
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
  const activeConvIdRef = useRef<number | null>(activeConvId);
  const latestMessagesRequestRef = useRef(0);
  const latestPendingActionsRequestRef = useRef(0);

  useEffect(() => {
    activeConvIdRef.current = activeConvId;
  }, [activeConvId]);

  useEffect(() => {
    void fetchConversations();
  }, [projectId]);

  useEffect(() => {
    if (!initialConversationId) return;
    setActiveConvId((current) => (current === initialConversationId ? current : initialConversationId));
  }, [initialConversationId, projectId]);

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
      setPendingToolActions([]);
    }
  }, [activeConvId]);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConvId),
    [activeConvId, conversations],
  );

  const fetchConversations = async (options: RefreshOptions = {}) => {
    if (!options.silent) {
      setIsLoadingConversations(true);
    }
    try {
      const data = await api.get<Conversation[]>(`/chat/conversations?project_id=${projectId}`);
      setConversations(data);
      if (autoSelectFirstConversation && data.length > 0) {
        setActiveConvId((current) => current ?? data[0].id);
      }
    } catch (error) {
      console.error("Failed to fetch conversations:", error);
    } finally {
      if (!options.silent) {
        setIsLoadingConversations(false);
      }
    }
  };

  const fetchMessages = async (conversationId: number, options: RefreshOptions = {}) => {
    const requestId = latestMessagesRequestRef.current + 1;
    latestMessagesRequestRef.current = requestId;
    if (!options.silent) {
      setIsLoadingMessages(true);
    }
    try {
      const [data, pendingAction] = await Promise.all([
        api.get<Message[]>(`/chat/conversations/${conversationId}/messages`, {
          params: { limit: 120, _: Date.now() },
          headers: { "Cache-Control": "no-cache" },
        }),
        fetchPendingAction(conversationId),
      ]);
      if (
        requestId !== latestMessagesRequestRef.current
        || (activeConvIdRef.current !== null && activeConvIdRef.current !== conversationId)
      ) {
        return;
      }
      setMessages(data);
      setServerPendingAction(pendingAction);
      void fetchPendingToolActions(conversationId);
    } catch (error) {
      console.error("Failed to fetch messages:", error);
    } finally {
      if (!options.silent) {
        setIsLoadingMessages(false);
      }
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
    if (activeConvIdRef.current !== conversationId) {
      return pendingAction;
    }
    setServerPendingAction(pendingAction);
    return pendingAction;
  };

  const fetchPendingToolActions = async (conversationId: number) => {
    const requestId = latestPendingActionsRequestRef.current + 1;
    latestPendingActionsRequestRef.current = requestId;
    try {
      const data = await api.get<PendingActionsResponse>(`/chat/conversations/${conversationId}/pending-actions`);
      if (
        requestId !== latestPendingActionsRequestRef.current
        || activeConvIdRef.current !== conversationId
      ) {
        return;
      }
      setPendingToolActions(data.items || []);
    } catch (error) {
      console.error("Failed to fetch pending tool actions:", error);
      if (requestId !== latestPendingActionsRequestRef.current || activeConvIdRef.current !== conversationId) {
        return;
      }
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
        setPendingToolActions([]);
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
    setPendingToolActions([]);
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
