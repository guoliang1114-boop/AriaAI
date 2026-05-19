import { create } from "zustand";
import type { ChatPlanResponse, Message, Skill } from "../types/api";

interface ChatState {
  // Messages & conversations
  messages: Message[];
  conversations: Array<{ id: number; title: string; updated_at: string }>;
  activeConvId: number | null;

  // Model & mode
  selectedModel: string;
  selectedSkillId: number | null;
  isBackgroundMode: boolean;
  isPlanMode: boolean;

  // Plan mode
  planResult: ChatPlanResponse | null;
  isGeneratingPlan: boolean;
  planPendingContent: string;

  // Skills
  skills: Skill[];

  // Actions
  setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void;
  appendMessage: (msg: Message) => void;
  setConversations: (conversations: ChatState["conversations"]) => void;
  setActiveConvId: (id: number | null) => void;
  setSelectedModel: (model: string) => void;
  setSelectedSkillId: (id: number | null) => void;
  setIsBackgroundMode: (value: boolean) => void;
  setIsPlanMode: (value: boolean) => void;
  setPlanResult: (result: ChatPlanResponse | null) => void;
  setIsGeneratingPlan: (value: boolean) => void;
  setPlanPendingContent: (content: string) => void;
  setSkills: (skills: Skill[]) => void;
  resetPlanState: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  conversations: [],
  activeConvId: null,

  selectedModel: (() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("aria-preferred-model") || "";
  })(),
  selectedSkillId: null,
  isBackgroundMode: (() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("aria-chat-background-mode") === "true";
  })(),
  isPlanMode: (() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("aria-chat-plan-mode") === "true";
  })(),

  planResult: null,
  isGeneratingPlan: false,
  planPendingContent: "",

  skills: [],

  setMessages: (messages) =>
    set((state) => ({
      messages: typeof messages === "function" ? messages(state.messages) : messages,
    })),

  appendMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  setConversations: (conversations) => set({ conversations }),
  setActiveConvId: (id) => set({ activeConvId: id }),

  setSelectedModel: (model) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("aria-preferred-model", model);
    }
    set({ selectedModel: model });
  },

  setSelectedSkillId: (id) => set({ selectedSkillId: id }),

  setIsBackgroundMode: (value) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("aria-chat-background-mode", String(value));
    }
    set({ isBackgroundMode: value });
  },

  setIsPlanMode: (value) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("aria-chat-plan-mode", String(value));
    }
    set({ isPlanMode: value });
  },

  setPlanResult: (result) => set({ planResult: result }),
  setIsGeneratingPlan: (value) => set({ isGeneratingPlan: value }),
  setPlanPendingContent: (content) => set({ planPendingContent: content }),

  setSkills: (skills) => set({ skills }),

  resetPlanState: () =>
    set({
      planResult: null,
      isGeneratingPlan: false,
      planPendingContent: "",
    }),
}));
