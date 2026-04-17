import {
  ArrowRight,
  Filter,
  FolderKanban,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  User,
  Wand2,
} from "lucide-react";

interface ProjectsHeaderProps {
  isGeneratingMissing: boolean;
  isLoadingUsers: boolean;
  isRefreshingStale: boolean;
  isZh: boolean;
  lastRefreshResult: {
    rebuiltCount: number;
    skippedCount: number;
    scope: string;
    mode: "stale" | "missing";
  } | null;
  noMemoryCount: number;
  onCreateProject: () => void;
  onGenerateMissing: () => void;
  onHandlePriorityPhase: (() => void) | null;
  onMissingOnlyChange: (value: boolean) => void;
  onRefreshStale: () => void;
  onSearchChange: (value: string) => void;
  onSelectedMemberChange: (value: number | null) => void;
  onStaleOnlyChange: (value: boolean) => void;
  priorityPhaseLabel: string | null;
  priorityPhasePendingCount: number;
  readyCount: number;
  searchQuery: string;
  selectedMemberId: number | null;
  showMissingOnly: boolean;
  showStaleOnly: boolean;
  staleCount: number;
  totalCount: number;
  users: Array<{ id: number; display_name: string }>;
}

const statCardClassName = "rounded-2xl border px-4 py-3 shadow-sm transition-colors";

export function ProjectsHeader({
  isGeneratingMissing,
  isLoadingUsers,
  isRefreshingStale,
  isZh,
  lastRefreshResult,
  noMemoryCount,
  onCreateProject,
  onGenerateMissing,
  onHandlePriorityPhase,
  onMissingOnlyChange,
  onRefreshStale,
  onSearchChange,
  onSelectedMemberChange,
  onStaleOnlyChange,
  priorityPhaseLabel,
  priorityPhasePendingCount,
  readyCount,
  searchQuery,
  selectedMemberId,
  showMissingOnly,
  showStaleOnly,
  staleCount,
  totalCount,
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
                ? "从商机发现到交付执行，项目与项目记忆一起可视化管理"
                : "Visual management for both project execution and project memory"}
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
              type="button"
              onClick={() => onStaleOnlyChange(!showStaleOnly)}
              className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                showStaleOnly
                  ? "border-amber-300 bg-amber-50 text-amber-700"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              <Filter className="h-4 w-4" />
              {isZh ? "只看待刷新" : "Stale Only"}
              <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px]">{staleCount}</span>
            </button>

            <button
              type="button"
              onClick={() => onMissingOnlyChange(!showMissingOnly)}
              className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                showMissingOnly
                  ? "border-slate-300 bg-slate-100 text-slate-700"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              <Wand2 className="h-4 w-4" />
              {isZh ? "只看未生成" : "Missing Only"}
              <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px]">{noMemoryCount}</span>
            </button>

            <button
              type="button"
              onClick={onRefreshStale}
              disabled={isRefreshingStale || staleCount === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              {isRefreshingStale ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {isZh ? "刷新待刷新记忆" : "Refresh Stale Memory"}
            </button>

            <button
              type="button"
              onClick={onGenerateMissing}
              disabled={isGeneratingMissing || noMemoryCount === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              {isGeneratingMissing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
              {isZh ? "补齐缺失记忆" : "Generate Missing Memory"}
            </button>

            <button
              onClick={onCreateProject}
              className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20"
            >
              <Plus className="h-4 w-4" />
              {isZh ? "新建项目" : "New Project"}
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className={`${statCardClassName} border-gray-200 bg-gray-50/80`}>
            <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
              {isZh ? "项目总数" : "Total Projects"}
            </div>
            <div className="mt-1 text-2xl font-bold text-gray-900">{totalCount}</div>
          </div>

          <div className={`${statCardClassName} border-emerald-200 bg-emerald-50`}>
            <div className="text-[11px] font-medium uppercase tracking-wider text-emerald-600">
              {isZh ? "记忆已同步" : "Memory Ready"}
            </div>
            <div className="mt-1 text-2xl font-bold text-emerald-700">{readyCount}</div>
          </div>

          <div className={`${statCardClassName} border-amber-200 bg-amber-50`}>
            <div className="text-[11px] font-medium uppercase tracking-wider text-amber-600">
              {isZh ? "记忆待刷新" : "Memory Stale"}
            </div>
            <div className="mt-1 text-2xl font-bold text-amber-700">{staleCount}</div>
          </div>

          <div className={`${statCardClassName} border-slate-200 bg-slate-50`}>
            <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              {isZh ? "未生成记忆" : "No Memory Yet"}
            </div>
            <div className="mt-1 text-2xl font-bold text-slate-700">{noMemoryCount}</div>
          </div>
        </div>

        {priorityPhaseLabel && onHandlePriorityPhase ? (
          <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-primary/15 bg-primary/5 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-semibold text-gray-900">
                {isZh ? "优先处理建议" : "Priority Suggestion"}
              </div>
              <div className="mt-1 text-sm text-gray-600">
                {isZh
                  ? `建议优先处理 ${priorityPhaseLabel}，当前有 ${priorityPhasePendingCount} 个项目存在待处理的记忆问题。`
                  : `Recommended next focus: ${priorityPhaseLabel}, with ${priorityPhasePendingCount} projects needing memory attention.`}
              </div>
            </div>
            <button
              type="button"
              onClick={onHandlePriorityPhase}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-primary/90"
            >
              <ArrowRight className="h-4 w-4" />
              {isZh ? "处理最急阶段" : "Handle Top Priority"}
            </button>
          </div>
        ) : null}

        {lastRefreshResult ? (
          <div className="mt-4 flex items-start gap-2 rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              {isZh
                ? `刚刚完成一次 ${lastRefreshResult.scope} 的${lastRefreshResult.mode === "stale" ? "待刷新记忆" : "缺失记忆"}处理：成功更新 ${lastRefreshResult.rebuiltCount} 个项目，跳过 ${lastRefreshResult.skippedCount} 个项目。`
                : `Just completed a ${lastRefreshResult.scope} ${lastRefreshResult.mode === "stale" ? "stale memory refresh" : "missing memory generation"}: updated ${lastRefreshResult.rebuiltCount} projects and skipped ${lastRefreshResult.skippedCount}.`}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
