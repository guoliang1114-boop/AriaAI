import { Loader2, X } from "lucide-react";
import type { ProjectMember } from "../../types/api";
import { UserPicker } from "./ProjectUserPicker";

interface UserOption {
  id: number;
  display_name: string;
}

interface ProjectSettingsMembersCardProps {
  availableUsers: UserOption[];
  handleAddMember: () => void;
  handleRemoveMember: (userId: number) => void;
  isAddingMember: boolean;
  isLoadingUsers: boolean;
  isZh: boolean;
  members: ProjectMember[];
  removingUserId: number | null;
  selectedUserId: number | null;
  setSelectedUserId: (value: number | null) => void;
}

export function ProjectSettingsMembersCard({
  availableUsers,
  handleAddMember,
  handleRemoveMember,
  isAddingMember,
  isLoadingUsers,
  isZh,
  members,
  removingUserId,
  selectedUserId,
  setSelectedUserId,
}: ProjectSettingsMembersCardProps) {
  const roleLabel = (role?: string) => {
    if (role === "owner") return isZh ? "负责人" : "Owner";
    if (role === "viewer") return isZh ? "只读" : "Viewer";
    return isZh ? "可编辑" : "Editor";
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <h3 className="mb-4 font-semibold text-gray-900">
        {isZh ? "项目成员" : "Project Members"}
      </h3>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <UserPicker
              users={availableUsers}
              value={selectedUserId}
              onChange={setSelectedUserId}
              placeholder={isZh ? "选择成员并添加" : "Select user to add"}
              disabled={isLoadingUsers || isAddingMember}
            />
          </div>
          <button
            onClick={handleAddMember}
            disabled={!selectedUserId || isAddingMember}
            className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isAddingMember ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isZh ? (
              "添加"
            ) : (
              "Add"
            )}
          </button>
        </div>

        <div className="pt-2">
          {members.length === 0 ? (
            <p className="text-sm text-gray-400">
              {isZh ? "暂无成员" : "No members yet"}
            </p>
          ) : (
            <ul className="space-y-2">
              {members.map((member) => (
                <li
                  key={member.user_id}
                  className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2"
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {(member.user?.display_name || "?").charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <span className="block truncate text-sm text-gray-800">
                        {member.user?.display_name || (isZh ? "未知成员" : "Unknown")}
                      </span>
                      <span className="text-xs text-gray-400">{roleLabel(member.role)}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveMember(member.user_id)}
                    disabled={removingUserId === member.user_id}
                    title={isZh ? "移除成员" : "Remove"}
                    className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                  >
                    {removingUserId === member.user_id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <X className="h-3.5 w-3.5" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
