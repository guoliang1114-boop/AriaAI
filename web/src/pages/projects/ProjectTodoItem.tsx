import {
  Calendar,
  Check,
  CheckCircle2,
  Circle,
  Edit3,
  Loader2,
  Trash2,
  X,
} from 'lucide-react'
import type { ProjectTodo } from '../../types/api'
import { UserPicker, type ProjectUserPickerItem as UserItem } from './ProjectUserPicker'

interface ProjectTodoItemProps {
  editAssignee: number | null
  editContent: string
  editDueDate: string
  editingId: number | null
  onCancelEdit: () => void
  onChangeEditAssignee: (value: number | null) => void
  onChangeEditContent: (value: string) => void
  onChangeEditDueDate: (value: string) => void
  onDelete: (todo: ProjectTodo) => void
  onSaveEdit: (todoId: number) => void
  onStartEdit: (todo: ProjectTodo) => void
  onToggle: (todo: ProjectTodo) => void
  savingId: number | null
  todo: ProjectTodo
  users: UserItem[]
}

export function ProjectTodoItem({
  editAssignee,
  editContent,
  editDueDate,
  editingId,
  onCancelEdit,
  onChangeEditAssignee,
  onChangeEditContent,
  onChangeEditDueDate,
  onDelete,
  onSaveEdit,
  onStartEdit,
  onToggle,
  savingId,
  todo,
  users,
}: ProjectTodoItemProps) {
  const isEditing = editingId === todo.id
  const isSaving = savingId === todo.id

  return (
    <div
      className={`group flex items-center gap-3 p-4 transition-colors hover:bg-codex-bg-tint ${
        todo.is_done ? 'bg-codex-bg-tint/50' : ''
      }`}
    >
      <div className="shrink-0 text-codex-ink-faint">
        {isSaving ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : todo.is_done ? (
          <button
            onClick={() => onToggle(todo)}
            className="text-codex-ink-faint transition-colors hover:text-codex-accent"
          >
            <CheckCircle2 className="h-5 w-5 text-codex-good" />
          </button>
        ) : (
          <button
            onClick={() => onToggle(todo)}
            className="text-codex-ink-faint transition-colors hover:text-codex-accent"
          >
            <Circle className="h-5 w-5" />
          </button>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {isEditing ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={editContent}
              onChange={(event) => onChangeEditContent(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onSaveEdit(todo.id)
                if (event.key === 'Escape') onCancelEdit()
              }}
              autoFocus
              className="flex-1 rounded-md border border-primary/30 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <div className="sm:w-40">
              <div className="relative">
                <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-codex-ink-faint" />
                <input
                  type="date"
                  value={editDueDate}
                  onChange={(event) => onChangeEditDueDate(event.target.value)}
                  className="w-full rounded-md border border-codex-line bg-white py-1.5 pl-9 pr-3 text-sm text-codex-ink-soft focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
            <div className="sm:w-44">
              <UserPicker
                users={users}
                value={editAssignee}
                onChange={onChangeEditAssignee}
              />
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => onSaveEdit(todo.id)}
                disabled={isSaving}
                className="rounded-md bg-codex-accent p-1.5 text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {isSaving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                onClick={onCancelEdit}
                className="rounded-md bg-codex-bg-tint p-1.5 text-codex-ink-soft hover:bg-codex-bg-tint"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <p className={`text-sm ${todo.is_done ? 'text-codex-ink-faint line-through' : 'text-codex-ink'}`}>
              {todo.content}
            </p>
            <div className="flex flex-wrap items-center gap-3 text-xs text-codex-ink-mute">
              {todo.due_date && (
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>{todo.due_date}</span>
                </div>
              )}
              {todo.assigned_user && (
                <div className="flex items-center gap-1.5">
                  <div className="flex h-4 w-4 items-center justify-center rounded-full bg-codex-bg-tint text-xs text-codex-ink-mute">
                    {todo.assigned_user.display_name.charAt(0)}
                  </div>
                  <span>{todo.assigned_user.display_name}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={() => onStartEdit(todo)}
          className="rounded-lg p-1.5 text-codex-ink-faint hover:bg-codex-bg-tint hover:text-codex-ink-soft"
        >
          <Edit3 className="h-4 w-4" />
        </button>
        <button
          onClick={() => onDelete(todo)}
          className="rounded-lg p-1.5 text-codex-ink-faint hover:bg-codex-bg-tint hover:text-codex-bad"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
