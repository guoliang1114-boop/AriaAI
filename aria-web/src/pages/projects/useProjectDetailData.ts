import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { api } from "../../api/client";
import type { ProjectDetail as ProjectDetailType } from "../../types/api";

function getProjectDetailErrorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.detail || error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Failed to fetch project detail";
}

export function useProjectDetailData(projectId?: string) {
  const numericProjectId = useMemo(() => {
    if (!projectId) {
      return null;
    }

    const parsedId = Number.parseInt(projectId, 10);
    return Number.isNaN(parsedId) ? null : parsedId;
  }, [projectId]);
  const requestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectDetail, setProjectDetail] = useState<ProjectDetailType | null>(null);

  const refreshProjectDetail = useCallback(async () => {
    if (!numericProjectId) {
      abortControllerRef.current?.abort();
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
    const isFirstLoad = initialLoading;

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

      setProjectDetail(data);
    } catch (error) {
      if (controller.signal.aborted || requestIdRef.current !== requestId) {
        return;
      }

      console.error("Failed to fetch project detail:", error);
      setProjectDetail(null);
      setError(getProjectDetailErrorMessage(error));
    } finally {
      if (requestIdRef.current === requestId) {
        setInitialLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [initialLoading, numericProjectId, projectId]);

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
