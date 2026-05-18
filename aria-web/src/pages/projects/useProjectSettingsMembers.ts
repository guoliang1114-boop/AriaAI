import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import type { ProjectMember } from "../../types/api";

interface UserItem {
  id: number;
  display_name: string;
}

interface UseProjectSettingsMembersParams {
  isZh: boolean;
  members: ProjectMember[];
  onUpdate: () => void;
  projectId: number;
  toast: {
    error: (message: string) => void;
    success: (message: string) => void;
  };
}

interface ApiErrorLike {
  response?: {
    data?: {
      detail?: string;
    };
  };
}

const getApiErrorMessage = (error: unknown): string | undefined =>
  (error as ApiErrorLike | undefined)?.response?.data?.detail;

export function useProjectSettingsMembers({
  isZh,
  members: initialMembers,
  onUpdate,
  projectId,
  toast,
}: UseProjectSettingsMembersParams) {
  const [members, setMembers] = useState<ProjectMember[]>(initialMembers || []);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<number | null>(null);

  useEffect(() => {
    setMembers(initialMembers || []);
  }, [initialMembers]);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingUsers(true);
    api
      .get<UserItem[]>("/auth/users/simple")
      .then((data) => {
        if (!cancelled) {
          setUsers(data);
        }
      })
      .catch((error) => {
        console.error("Failed to load users:", error);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingUsers(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const availableUsers = useMemo(
    () => users.filter((user) => !members.some((member) => member.user_id === user.id)),
    [members, users],
  );

  const handleAddMember = async () => {
    if (!selectedUserId) return;
    setIsAddingMember(true);
    try {
      await api.post(`/projects/${projectId}/members`, { user_id: selectedUserId });
      toast.success(isZh ? "成员已添加" : "Member added");
      setSelectedUserId(null);
      onUpdate();
    } catch (error) {
      toast.error(
        getApiErrorMessage(error) ||
          (isZh ? "添加成员失败" : "Failed to add member"),
      );
    } finally {
      setIsAddingMember(false);
    }
  };

  const handleRemoveMember = async (userId: number) => {
    setRemovingUserId(userId);
    try {
      await api.delete(`/projects/${projectId}/members/${userId}`);
      toast.success(isZh ? "成员已移除" : "Member removed");
      onUpdate();
    } catch (error) {
      toast.error(
        getApiErrorMessage(error) ||
          (isZh ? "移除成员失败" : "Failed to remove member"),
      );
    } finally {
      setRemovingUserId(null);
    }
  };

  return {
    availableUsers,
    handleAddMember,
    handleRemoveMember,
    isAddingMember,
    isLoadingUsers,
    members,
    removingUserId,
    selectedUserId,
    setSelectedUserId,
  };
}
