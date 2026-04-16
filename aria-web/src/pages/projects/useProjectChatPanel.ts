import { useRef, useState } from "react";

export function useProjectChatPanel() {
  const [knowledgeScope, setKnowledgeScope] = useState<"project" | "client" | "global">("project");
  const [inputValue, setInputValue] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveMessageId, setSaveMessageId] = useState<number | null>(null);
  const [conversationSaveModalOpen, setConversationSaveModalOpen] = useState(false);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  const handleScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const scrollToBottom = (smooth = true) => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };

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

  const handleSend = (sendMessage: (content: string) => Promise<unknown> | unknown) => {
    const content = inputValue;
    setInputValue("");
    void sendMessage(content);
  };

  return {
    closeConversationSaveModal,
    closeSaveModal,
    conversationSaveModalOpen,
    handleScroll,
    handleSend,
    inputValue,
    isNearBottomRef,
    isSidebarOpen,
    knowledgeScope,
    messagesContainerRef,
    openConversationSaveModal,
    openSaveModal,
    saveMessageId,
    saveModalOpen,
    scrollToBottom,
    setInputValue,
    setIsSidebarOpen,
    setKnowledgeScope,
  };
}
