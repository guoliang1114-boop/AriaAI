import { useTranslation } from 'react-i18next'
import { useToast } from '../../contexts/ToastContext'
import { ProjectMemoryInsightCard } from './ProjectMemoryInsightCard'
import type { ProjectTodo } from '../../types/api'
import { ProjectTodoCreateForm } from './ProjectTodoCreateForm'
import { ProjectTodoDeleteDialog } from './ProjectTodoDeleteDialog'
import { ProjectTodosPanel } from './ProjectTodosPanel'
import { useProjectMemorySummary } from './useProjectMemorySummary'
import { useProjectTodosManager } from './useProjectTodosManager'

interface ProjectTodosTabProps {
  projectId: string
  memoryVersion?: number
  todos: ProjectTodo[]
  onUpdate: () => void
}

export function ProjectTodosTab({ projectId, memoryVersion, todos, onUpdate }: ProjectTodosTabProps) {
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const toast = useToast()
  const riskInsight = useProjectMemorySummary({
    errorMessage: isZh ? '生成风险摘要失败，请稍后重试' : 'Failed to generate risk summary',
    language: i18n.language,
    memoryVersion,
    projectId,
    summaryType: 'risk',
  })
  const {
    cancelEdit,
    closeDeleteDialog,
    completedCount,
    confirmDelete,
    deletingIds,
    editAssignee,
    editContent,
    editDueDate,
    editingId,
    handleCreate,
    handleSaveEdit,
    handleToggle,
    isAdding,
    loadingUsers,
    newAssignee,
    newContent,
    newDueDate,
    openDeleteDialog,
    progress,
    savingId,
    setEditAssignee,
    setEditContent,
    setEditDueDate,
    setNewAssignee,
    setNewContent,
    setNewDueDate,
    showDeleteDialog,
    startEdit,
    todoToDelete,
    users,
  } = useProjectTodosManager({
    isZh,
    onUpdate,
    projectId,
    showError: toast.error,
    todos,
  })

  return (
    <div className="space-y-6">
      <ProjectMemoryInsightCard
        content={riskInsight.content}
        error={riskInsight.error}
        hint={
          isZh
            ? '基于项目记忆整理当前风险、阻塞点和最需要推进的待办方向'
            : 'Structured-memory risk view for blockers, risks, and the next todo focus'
        }
        isZh={isZh}
        loading={riskInsight.loading}
        onRefresh={() => {
          void riskInsight.refresh(true)
        }}
        title={isZh ? 'AI 风险摘要' : 'AI Risk Summary'}
      />

      <ProjectTodosPanel
        completedCount={completedCount}
        deletingIds={deletingIds}
        editAssignee={editAssignee}
        editContent={editContent}
        editDueDate={editDueDate}
        editingId={editingId}
        isZh={isZh}
        onCancelEdit={cancelEdit}
        onChangeEditAssignee={setEditAssignee}
        onChangeEditContent={setEditContent}
        onChangeEditDueDate={setEditDueDate}
        onDelete={openDeleteDialog}
        onSaveEdit={handleSaveEdit}
        onStartEdit={startEdit}
        onToggle={handleToggle}
        progress={progress}
        savingId={savingId}
        todos={todos}
        users={users}
      />

      <ProjectTodoCreateForm
        isAdding={isAdding}
        isZh={isZh}
        loadingUsers={loadingUsers}
        newAssignee={newAssignee}
        newContent={newContent}
        newDueDate={newDueDate}
        onAssigneeChange={setNewAssignee}
        onContentChange={setNewContent}
        onCreate={handleCreate}
        onDueDateChange={setNewDueDate}
        users={users}
      />

      {showDeleteDialog && todoToDelete && (
        <ProjectTodoDeleteDialog
          isZh={isZh}
          onCancel={closeDeleteDialog}
          onConfirm={confirmDelete}
          todoContent={todoToDelete.content}
        />
      )}
    </div>
  )
}
