import { FolderKanban, Plus, Search, User } from "lucide-react";

interface ProjectsHeaderProps {
  isLoadingUsers: boolean;
  isZh: boolean;
  onCreateProject: () => void;
  onSearchChange: (value: string) => void;
  onSelectedMemberChange: (value: number | null) => void;
  searchQuery: string;
  selectedMemberId: number | null;
  users: Array<{ id: number; display_name: string }>;
}

export function ProjectsHeader({
  isLoadingUsers,
  isZh,
  onCreateProject,
  onSearchChange,
  onSelectedMemberChange,
  searchQuery,
  selectedMemberId,
  users,
}: ProjectsHeaderProps) {
  return (
    <div className="border-b border-gray-100 bg-white">
      <div className="mx-auto max-w-full px-6 py-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <div className="mb-2 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <FolderKanban className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {isZh ? "项目空间" : "Project Workspace"}
                </h1>
              </div>
            </div>
            <p className="text-sm text-gray-500">
              {isZh
                ? "按阶段管理项目，快速查看商务、交付和归档内容。"
                : "Manage projects by phase and quickly review business, delivery, and archived work."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={isZh ? "搜索项目..." : "Search projects..."}
                className="w-56 rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-10 pr-4 text-sm transition-all focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <div className="relative">
              <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <select
                value={selectedMemberId ?? ""}
                onChange={(event) =>
                  onSelectedMemberChange(event.target.value ? Number(event.target.value) : null)
                }
                disabled={isLoadingUsers}
                className="w-40 appearance-none cursor-pointer rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-8 text-sm transition-all focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="">{isZh ? "全部成员" : "All members"}</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.display_name}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
                <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>

            <button
              onClick={onCreateProject}
              className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20"
            >
              <Plus className="h-4 w-4" />
              {isZh ? "新建项目" : "New Project"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
