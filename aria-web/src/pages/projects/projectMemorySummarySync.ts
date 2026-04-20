import type { ProjectMemorySummaryType } from "../../types/api";

export type ProjectMemorySummaryMap = Partial<Record<ProjectMemorySummaryType, string>>;

export const PROJECT_MEMORY_SUMMARY_TYPES: ProjectMemorySummaryType[] = [
  "overview",
  "risk",
  "delivery",
  "stakeholder",
  "client-facing",
  "financial",
  "documents",
];

const PROJECT_MEMORY_SUMMARIES_UPDATED = "aria:project-memory-summaries-updated";

export interface ProjectMemorySummariesUpdatedDetail {
  language: string;
  memoryVersion?: number;
  projectId: string;
  summaries: ProjectMemorySummaryMap;
}

export function normalizeProjectSummaryLanguage(language: string) {
  const normalized = language.trim().toLowerCase();
  if (normalized.startsWith("zh")) return "zh";
  if (normalized.startsWith("en")) return "en";
  return normalized || "default";
}

export function dispatchProjectMemorySummariesUpdated(detail: ProjectMemorySummariesUpdatedDetail) {
  window.dispatchEvent(new CustomEvent<ProjectMemorySummariesUpdatedDetail>(PROJECT_MEMORY_SUMMARIES_UPDATED, { detail }));
}

export function subscribeProjectMemorySummariesUpdated(
  handler: (detail: ProjectMemorySummariesUpdatedDetail) => void,
) {
  const listener = (event: Event) => {
    handler((event as CustomEvent<ProjectMemorySummariesUpdatedDetail>).detail);
  };
  window.addEventListener(PROJECT_MEMORY_SUMMARIES_UPDATED, listener);
  return () => window.removeEventListener(PROJECT_MEMORY_SUMMARIES_UPDATED, listener);
}
