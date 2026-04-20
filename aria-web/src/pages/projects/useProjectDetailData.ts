import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { api } from "../../api/client";
import type { ProjectDetail as ProjectDetailType } from "../../types/api";

const PROJECT_DETAIL_CACHE_TTL_MS = 60_000;

type ProjectDetailCacheEntry = {
  data: ProjectDetailType;
  fetchedAt: number;
};

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
  const [projectDetail, setProjectDetail] = useState<ProjectDetailType | null>(cachedDetail);

  useEffect(() => {
    projectDetailRef.current = cachedDetail;
    setProjectDetail(cachedDetail);
    setInitialLoading(!cachedDetail);
    setError(null);
  }, [cachedDetail, numericProjectId]);

  const refreshProjectDetail = useCallback(async () => {
    if (!numericProjectId) {
      abortControllerRef.current?.abort();
      projectDetailRef.current = null;
      setProjectDetail(null);
      setError(projectId ? "Invalid project id" : null);
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

  return {
    error,
    initialLoading,
    isRefreshing,
    projectDetail,
    refreshProjectDetail,
  };
}
