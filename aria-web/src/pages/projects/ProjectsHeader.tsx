import { FolderKanban, Plus, Search } from "lucide-react";
import { User } from "lucide-react";

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
    <div className="bg-white border-b border-gray-100">
      <div className="max-w-full mx-auto px-6 py-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <FolderKanban className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {isZh ? "椤圭洰绌洪棿" : "Project Workspace"}
                </h1>
              </div>
            </div>
            <p className="text-sm text-gray-500">
              {isZh
                ? "浠庡晢鏈哄彂鐜板埌浜や粯杩愮淮锛屽叏娴佺▼鍙鍖栫鐞?"
                : "Visual management from lead to delivery"}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={isZh ? "鎼滅储椤圭洰..." : "Search projects..."}
                className="pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm w-56 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary focus:bg-white transition-all"
              />
            </div>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <select
                value={selectedMemberId ?? ""}
                onChange={(event) =>
                  onSelectedMemberChange(
                    event.target.value ? Number(event.target.value) : null,
                  )
                }
                disabled={isLoadingUsers}
                className="pl-9 pr-8 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm w-40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary focus:bg-white transition-all appearance-none cursor-pointer"
              >
                <option value="">{isZh ? "鍏ㄩ儴鎴愬憳" : "All members"}</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.display_name}
                  </option>
                ))}
              </select>
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
            <button
              onClick={onCreateProject}
              className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20 transition-all"
            >
              <Plus className="w-4 h-4" />
              {isZh ? "鏂板缓椤圭洰" : "New Project"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
