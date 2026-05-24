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
      className={`group flex items-center gap-3 p-4 transition-colors hover:bg-gray-50 ${
        todo.is_done ? 'bg-gray-50/50' : ''
      }`}
    >
      <div className="shrink-0 text-gray-400">
        {isSaving ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : todo.is_done ? (
          <button
            onClick={() => onToggle(todo)}
            className="text-gray-400 transition-colors hover:text-primary"
          >
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          </button>
        ) : (
          <button
            onClick={() => onToggle(todo)}
            className="text-gray-400 transition-colors hover:text-primary"
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
                <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="date"
                  value={editDueDate}
                  onChange={(event) => onChangeEditDueDate(event.target.value)}
                  className="w-full rounded-md border border-gray-200 bg-white py-1.5 pl-9 pr-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/20"
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
                className="rounded-md bg-primary p-1.5 text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {isSaving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                onClick={onCancelEdit}
                className="rounded-md bg-gray-100 p-1.5 text-gray-600 hover:bg-gray-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <p className={`text-sm ${todo.is_done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
              {todo.content}
            </p>
            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
              {todo.due_date && (
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>{todo.due_date}</span>
                </div>
              )}
              {todo.assigned_user && (
                <div className="flex items-center gap-1.5">
                  <div className="flex h-4 w-4 items-center justify-center rounded-full bg-gray-100 text-xs text-gray-500">
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
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          <Edit3 className="h-4 w-4" />
        </button>
        <button
          onClick={() => onDelete(todo)}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
