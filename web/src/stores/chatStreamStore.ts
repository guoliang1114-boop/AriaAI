import { create } from "zustand";
import type {
  AgentStepView,
  GeneratedArtifact,
  Reference,
  ToolCallEvent,
} from "../types/api";

interface ChatStreamState {
  isLoading: boolean;
  streamingContent: string;
  streamingStatus: string;
  streamingToolCalls: ToolCallEvent[];
  streamingArtifacts: GeneratedArtifact[];
  streamingReferences: Reference[];
  streamingTruncated: boolean;
  streamingSteps: AgentStepView[];

  setIsLoading: (value: boolean) => void;
  appendText: (text: string) => void;
  setStatus: (status: string) => void;
  upsertToolCall: (toolCall: ToolCallEvent) => void;
  setStreamingToolCalls: (toolCalls: ToolCallEvent[]) => void;
  setReferences: (refs: Reference[]) => void;
  addArtifact: (artifact: GeneratedArtifact) => void;
  setStreamingArtifacts: (artifacts: GeneratedArtifact[]) => void;
  setTruncated: (value: boolean) => void;
  upsertStep: (step: AgentStepView) => void;
  setStreamingSteps: (steps: AgentStepView[]) => void;
  reset: () => void;
}

const initialState = {
  isLoading: false,
  streamingContent: "",
  streamingStatus: "",
  streamingToolCalls: [] as ToolCallEvent[],
  streamingArtifacts: [] as GeneratedArtifact[],
  streamingReferences: [] as Reference[],
  streamingTruncated: false,
  streamingSteps: [] as AgentStepView[],
};

export const useChatStreamStore = create<ChatStreamState>((set) => ({
  ...initialState,

  setIsLoading: (value) => set({ isLoading: value }),

  appendText: (text) =>
    set((state) => ({ streamingContent: state.streamingContent + text })),

  setStatus: (status) => set({ streamingStatus: status }),

  upsertToolCall: (toolCall) =>
    set((state) => {
      const idx = state.streamingToolCalls.findIndex(
        (t) => t.tool_name === toolCall.tool_name && t.step_index === toolCall.step_index
      );
      if (idx >= 0) {
        const next = [...state.streamingToolCalls];
        next[idx] = { ...next[idx], ...toolCall };
        return { streamingToolCalls: next };
      }
      return { streamingToolCalls: [...state.streamingToolCalls, toolCall] };
    }),

  setStreamingToolCalls: (toolCalls) => set({ streamingToolCalls: toolCalls }),

  setReferences: (refs) => set({ streamingReferences: refs }),

  addArtifact: (artifact) =>
    set((state) => ({
      streamingArtifacts: [...state.streamingArtifacts, artifact],
    })),

  setStreamingArtifacts: (artifacts) => set({ streamingArtifacts: artifacts }),

  setTruncated: (value) => set({ streamingTruncated: value }),

  upsertStep: (step) =>
    set((state) => {
      const idx = state.streamingSteps.findIndex((s) => s.index === step.index);
      if (idx >= 0) {
        const next = [...state.streamingSteps];
        next[idx] = { ...next[idx], ...step };
        return { streamingSteps: next };
      }
      return { streamingSteps: [...state.streamingSteps, step] };
    }),

  setStreamingSteps: (steps) => set({ streamingSteps: steps }),

  reset: () => set(initialState),
}));
