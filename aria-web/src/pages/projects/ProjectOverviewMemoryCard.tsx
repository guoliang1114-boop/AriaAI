import { AlertTriangle, Brain, Loader2, RefreshCw } from 'lucide-react'
import type { ProjectMemory } from '../../types/api'
import { formatProjectMemoryUpdatedAt } from './projectMemoryTime'

interface ProjectOverviewMemoryCardProps {
  isZh: boolean
  isLoading: boolean
  isRebuilding: boolean
  memory: ProjectMemory | null
  rebuildStatus?: string
  rebuildFailedAt?: string | null
  onRebuild: () => void
}

function getAsyncStatusText(status: string | undefined, isZh: boolean) {
  switch (status) {
    case 'queued':
      return isZh ? '排队中' : 'Queued'
    case 'rebuilding':
      return isZh ? '重建中' : 'Rebuilding'
    case 'failed':
      return isZh ? '重建失败' : 'Failed'
    default:
      return isZh ? '空闲' : 'Idle'
  }
}

export function ProjectOverviewMemoryCard({
  isZh,
  isLoading,
  isRebuilding,
  memory,
  rebuildStatus,
  rebuildFailedAt,
  onRebuild,
}: ProjectOverviewMemoryCardProps) {
  const hasMemory = !!memory && memory.memory_version > 0
  const statusText = isLoading
    ? isZh
      ? '加载中'
      : 'Loading'
    : memory?.stale
      ? isZh
        ? '待刷新'
        : 'Stale'
      : hasMemory
        ? isZh
          ? '已同步'
          : 'Ready'
        : isZh
          ? '未生成'
          : 'Not Built'

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 p-5">
        <h3 className="flex items-center gap-2 font-semibold text-gray-900">
          <Brain className="h-4 w-4 text-gray-400" />
          {isZh ? '项目记忆' : 'Project Memory'}
        </h3>
        <button
          type="button"
          onClick={onRebuild}
          disabled={isLoading || isRebuilding}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          {isRebuilding ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {isZh ? '更新记忆' : 'Refresh Memory'}
        </button>
      </div>

      <div className="space-y-3 p-5 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-gray-500">{isZh ? '状态' : 'Status'}</span>
          <span className="font-medium text-gray-900">{statusText}</span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <span className="text-gray-500">{isZh ? '更新时间' : 'Updated'}</span>
          <span className="text-right font-medium text-gray-900">
            {formatProjectMemoryUpdatedAt(memory?.last_updated_at, isZh)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-gray-500">{isZh ? '异步状态' : 'Async Status'}</span>
          <span className="text-right font-medium text-gray-900">{getAsyncStatusText(rebuildStatus, isZh)}</span>
        </div>
        {rebuildFailedAt ? (
          <div className="flex items-start justify-between gap-4">
            <span className="text-gray-500">{isZh ? '失败时间' : 'Failed At'}</span>
            <span className="text-right font-medium text-red-600">
              {formatProjectMemoryUpdatedAt(rebuildFailedAt, isZh)}
            </span>
          </div>
        ) : null}

        {memory?.stale ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                {isZh
                  ? '项目最近有更新，这份记忆可能略旧。系统会尝试自动刷新，你也可以手动更新。'
                  : 'Project data changed recently. The app will try to refresh this memory automatically, or you can update it manually.'}
              </p>
            </div>
          </div>
        ) : null}

        {hasMemory ? (
          <div className="rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-600">
            {memory?.project_brief
              ? memory.project_brief
              : isZh
                ? '项目记忆已经可用，可供概览、聊天和执行页复用。'
                : 'Project memory is ready for summaries, chat, and execution views.'}
          </div>
        ) : (
          <div className="rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-600">
            {isZh
              ? '系统还没有为这个项目整理出可复用的项目记忆。'
              : 'No reusable project memory has been generated for this project yet.'}
          </div>
        )}
      </div>
    </div>
  )
}
