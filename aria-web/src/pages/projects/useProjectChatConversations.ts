import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../api/client";
import type { Conversation, Message } from "../../types/api";
import { buildDefaultChatTitle } from "./projectChatCopy";

type UseProjectChatConversationsParams = {
  projectId: number;
  isZh: boolean;
  onCreateConversationError: () => void;
  onDeleteConversationError: () => void;
  onRenameConversationError: () => void;
};

export function useProjectChatConversations({
  projectId,
  isZh,
  onCreateConversationError,
  onDeleteConversationError,
  onRenameConversationError,
}: UseProjectChatConversationsParams) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
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
      void fetchMessages(activeConvId);
    } else {
      setMessages([]);
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
      if (data.length > 0 && !activeConvId) {
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
      const data = await api.get<Message[]>(`/chat/conversations/${conversationId}/messages`);
      setMessages(data);
    } catch (error) {
      console.error("Failed to fetch messages:", error);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const createConversation = async (firstMessage?: string) => {
    try {
      const title = buildDefaultChatTitle(firstMessage || "", isZh);
      const newConversation = await api.post<Conversation>("/chat/conversations", {
        project_id: projectId,
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
    createConversation,
    deleteConversation,
    renameConversation,
    beginRenameConversation,
    startNewChat,
    openDeleteConversationDialog,
    closeDeleteConversationDialog,
  };
}
