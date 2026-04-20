import { useCallback, useRef, useState } from "react";

export function useProjectChatPanel() {
  const [knowledgeScope, setKnowledgeScope] = useState<"project" | "client" | "global">("project");
  const [inputValue, setInputValue] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isAutoFollow, setIsAutoFollow] = useState(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveMessageId, setSaveMessageId] = useState<number | null>(null);
  const [conversationSaveModalOpen, setConversationSaveModalOpen] = useState(false);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isNearBottom = distanceToBottom < 120;
    isNearBottomRef.current = isNearBottom;
    setShowScrollToBottom(distanceToBottom > 240);
    if (!isNearBottom && isAutoFollow) {
      setIsAutoFollow(false);
    }
    if (isNearBottom && !isAutoFollow) {
      setShowScrollToBottom(false);
    }
  }, [isAutoFollow]);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    isNearBottomRef.current = true;
    setShowScrollToBottom(false);
  }, []);

  const enableAutoFollow = useCallback(() => {
    setIsAutoFollow(true);
    scrollToBottom(true);
  }, [scrollToBottom]);

  const openSaveModal = (messageId: number) => {
    setSaveMessageId(messageId);
    setSaveModalOpen(true);
  };

  const closeSaveModal = () => {
    setSaveModalOpen(false);
  };

  const openConversationSaveModal = () => {
    setConversationSaveModalOpen(true);
  };

  const closeConversationSaveModal = () => {
    setConversationSaveModalOpen(false);
  };

  const handleSend = useCallback((sendMessage: (content: string) => Promise<unknown> | unknown) => {
    const content = inputValue;
    setInputValue("");
    void sendMessage(content);
  }, [inputValue]);

  return {
    closeConversationSaveModal,
    closeSaveModal,
    conversationSaveModalOpen,
    handleScroll,
    handleSend,
    inputValue,
    isAutoFollow,
    isNearBottomRef,
    isSidebarOpen,
    knowledgeScope,
    messagesContainerRef,
    openConversationSaveModal,
    openSaveModal,
    saveMessageId,
    saveModalOpen,
    enableAutoFollow,
    scrollToBottom,
    showScrollToBottom,
    setInputValue,
    setIsSidebarOpen,
    setKnowledgeScope,
  };
}
