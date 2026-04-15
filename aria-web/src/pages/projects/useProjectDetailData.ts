import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { ProjectDetail as ProjectDetailType } from "../../types/api";

export function useProjectDetailData(projectId?: string) {
  const [initialLoading, setInitialLoading] = useState(true);
  const [projectDetail, setProjectDetail] = useState<ProjectDetailType | null>(
    null,
  );

  const refreshProjectDetail = async () => {
    if (!projectId) return;

    try {
      const data = await api.get<ProjectDetailType>(
        `/projects/${parseInt(projectId, 10)}/detail`,
      );
      setProjectDetail(data);
    } catch (error) {
      console.error("Failed to fetch project detail:", error);
    } finally {
      setInitialLoading(false);
    }
  };

  useEffect(() => {
    void refreshProjectDetail();
  }, [projectId]);

  return {
    initialLoading,
    projectDetail: projectDetail as ProjectDetailType,
    refreshProjectDetail,
  };
}
