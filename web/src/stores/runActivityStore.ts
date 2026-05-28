/**
 * Zustand store for the current run's activity timeline (Product Run Event v1).
 *
 * The pure ``reduceRunActivity`` reducer does the actual folding — this store
 * is just the live-state shell so React components can subscribe to changes.
 */
import { create } from "zustand";
import type { ProductRunEvent } from "../types/productRunEvent";
import {
  type RunActivityTimeline,
  reduceRunActivity,
} from "./runActivityReducer";

interface RunActivityState {
  timeline: RunActivityTimeline | null;
  apply: (event: ProductRunEvent) => void;
  reset: () => void;
}

export const useRunActivityStore = create<RunActivityState>((set) => ({
  timeline: null,
  apply: (event) =>
    set((state) => ({ timeline: reduceRunActivity(state.timeline, event) })),
  reset: () => set({ timeline: null }),
}));
