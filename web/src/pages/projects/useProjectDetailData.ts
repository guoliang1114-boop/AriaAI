import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { api } from "../../api/client";
import type { ProjectDetail as ProjectDetailType } from "../../types/api";

const PROJECT_DETAIL_CACHE_TTL_MS = 60_000;

type ProjectDetailCacheEntry = {
  data: ProjectDetailType;
  fetchedAt: number;
};

export interface ProjectMemoryStateUpdate {
  memory_rebuild_failed_at?: string | null;
  memory_rebuild_status?: string;
  memory_stale: boolean;
  memory_updated_at?: string | null;
  memory_version: number;
  projectId: number;
  project_brief?: string;
}

const PROJECT_MEMORY_STATE_UPDATED = "aria:project-memory-state-updated";
const projectDetailCache = new Map<number, ProjectDetailCacheEntry>();
const projectDetailInFlight = new Map<number, Promise<ProjectDetailType>>();

function getProjectDetailErrorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.detail || error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Failed to fetch project detail";
}

function getProjectDetailErrorStatus(error: unknown) {
  if (axios.isAxiosError(error)) {
    return error.response?.status ?? null;
  }

  return null;
}

function getCachedProjectDetail(projectId: number | null) {
  if (!projectId) return null;
  const entry = projectDetailCache.get(projectId);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > PROJECT_DETAIL_CACHE_TTL_MS) return null;
  return entry.data;
}

function setCachedProjectDetail(projectId: number, data: ProjectDetailType) {
  projectDetailCache.set(projectId, { data, fetchedAt: Date.now() });
}

function applyMemoryUpdateToDetail(
  detail: ProjectDetailType,
  update: ProjectMemoryStateUpdate,
): ProjectDetailType {
  return {
    ...detail,
    project: {
      ...detail.project,
      context_summary: update.project_brief?.trim() || detail.project.context_summary,
      memory_rebuild_failed_at: update.memory_rebuild_failed_at ?? null,
      memory_rebuild_status: update.memory_rebuild_status ?? detail.project.memory_rebuild_status ?? "idle",
      memory_stale: update.memory_stale,
      memory_updated_at: update.memory_updated_at ?? detail.project.memory_updated_at,
      memory_version: update.memory_version,
    },
  };
}

export function dispatchProjectMemoryStateUpdated(update: ProjectMemoryStateUpdate) {
  const cached = getCachedProjectDetail(update.projectId);
  if (cached) {
    setCachedProjectDetail(update.projectId, applyMemoryUpdateToDetail(cached, update));
  }
  window.dispatchEvent(new CustomEvent<ProjectMemoryStateUpdate>(PROJECT_MEMORY_STATE_UPDATED, { detail: update }));
}

function subscribeProjectMemoryStateUpdated(handler: (update: ProjectMemoryStateUpdate) => void) {
  const listener = (event: Event) => {
    handler((event as CustomEvent<ProjectMemoryStateUpdate>).detail);
  };
  window.addEventListener(PROJECT_MEMORY_STATE_UPDATED, listener);
  return () => window.removeEventListener(PROJECT_MEMORY_STATE_UPDATED, listener);
}

export async function prefetchProjectDetailData(projectId: number) {
  const cached = getCachedProjectDetail(projectId);
  if (cached) return cached;

  const existingPromise = projectDetailInFlight.get(projectId);
  if (existingPromise) return existingPromise;

  const request = api
    .get<ProjectDetailType>(`/projects/${projectId}/detail`)
    .then((data) => {
      setCachedProjectDetail(projectId, data);
      return data;
    })
    .finally(() => {
      projectDetailInFlight.delete(projectId);
    });

  projectDetailInFlight.set(projectId, request);
  return request;
}

export function useProjectDetailData(projectId?: string) {
  const numericProjectId = useMemo(() => {
    if (!projectId) {
      return null;
    }

    const parsedId = Number.parseInt(projectId, 10);
    return Number.isNaN(parsedId) ? null : parsedId;
  }, [projectId]);
  const cachedDetail = useMemo(() => getCachedProjectDetail(numericProjectId), [numericProjectId]);
  const requestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const projectDetailRef = useRef<ProjectDetailType | null>(cachedDetail);
  const [initialLoading, setInitialLoading] = useState(!cachedDetail);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [projectDetail, setProjectDetail] = useState<ProjectDetailType | null>(cachedDetail);

  useEffect(() => {
    projectDetailRef.current = cachedDetail;
    setProjectDetail(cachedDetail);
    setInitialLoading(!cachedDetail);
    setError(null);
    setErrorStatus(null);
  }, [cachedDetail, numericProjectId]);

  const refreshProjectDetail = useCallback(async () => {
    if (!numericProjectId) {
      abortControllerRef.current?.abort();
      projectDetailRef.current = null;
      setProjectDetail(null);
      setError(projectId ? "Invalid project id" : null);
      setErrorStatus(null);
      setInitialLoading(false);
      setIsRefreshing(false);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    abortControllerRef.current?.abort();

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const isFirstLoad = !projectDetailRef.current;

    setError(null);
    setErrorStatus(null);
    setIsRefreshing(!isFirstLoad);

    try {
      const data = await api.get<ProjectDetailType>(
        `/projects/${numericProjectId}/detail`,
        { signal: controller.signal },
      );

      if (requestIdRef.current !== requestId) {
        return;
      }

      setCachedProjectDetail(numericProjectId, data);
      projectDetailRef.current = data;
      setProjectDetail(data);
    } catch (error) {
      if (controller.signal.aborted || requestIdRef.current !== requestId) {
        return;
      }

      console.error("Failed to fetch project detail:", error);
      projectDetailRef.current = null;
      setProjectDetail(null);
      setError(getProjectDetailErrorMessage(error));
      setErrorStatus(getProjectDetailErrorStatus(error));
    } finally {
      if (requestIdRef.current === requestId) {
        setInitialLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [numericProjectId, projectId]);

  useEffect(() => {
    void refreshProjectDetail();

    return () => {
      abortControllerRef.current?.abort();
    };
  }, [refreshProjectDetail]);

  useEffect(() => {
    if (!numericProjectId) return;
    return subscribeProjectMemoryStateUpdated((update) => {
      if (update.projectId !== numericProjectId) return;
      const current = projectDetailRef.current;
      if (!current) return;
      const nextDetail = applyMemoryUpdateToDetail(current, update);
      projectDetailRef.current = nextDetail;
      setCachedProjectDetail(numericProjectId, nextDetail);
      setProjectDetail(nextDetail);
    });
  }, [numericProjectId]);

  return {
    error,
    errorStatus,
    initialLoading,
    isRefreshing,
    projectDetail,
    refreshProjectDetail,
  };
}
