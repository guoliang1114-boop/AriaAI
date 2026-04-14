import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckCircle2,
  Circle,
  Plus,
  Trash2,
  Edit3,
  Loader2,
  X,
  Check,
  ListTodo,
  User,
  Search,
  ChevronDown,
  AlertCircle,
} from 'lucide-react'
import { api } from '../../api/client'
import { useToast } from '../../contexts/ToastContext'
import type { ProjectTodo } from '../../types/api'

interface UserItem {
  id: number
  display_name: string
}

interface ProjectTodosTabProps {
  projectId: string
  todos: ProjectTodo[]
  onUpdate: () => void
}

export function UserPicker({
  users,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  users: UserItem[]
  value: number | null
  onChange: (userId: number | null) => void
  placeholder?: string
  disabled?: boolean
}) {
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedUser = users.find((u) => u.id === value)

  const filtered = users.filter((u) =>
    u.display_name.toLowerCase().includes(query.toLowerCase())
  )

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={`flex items-center gap-2 w-full px-3 py-2 bg-white border rounded-lg text-sm transition-colors ${
          disabled ? 'opacity-50 cursor-not-allowed bg-gray-100' : 'hover:border-gray-300'
        } ${open ? 'border-primary ring-1 ring-primary/20' : 'border-gray-200'}`}
      >
        <User className="w-4 h-4 text-gray-400" />
        <span className={`flex-1 text-left truncate ${selectedUser ? 'text-gray-900' : 'text-gray-400'}`}>
          {selectedUser ? selectedUser.display_name : placeholder || (isZh ? '选择负责人' : 'Assign to')}
        </span>
        {selectedUser ? (
          <span
            onClick={(e) => {
              e.stopPropagation()
              onChange(null)
            }}
            className="p-0.5 rounded hover:bg-gray-100 text-gray-400"
          >
            <X className="w-3.5 h-3.5" />
          </span>
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100">
            <div className="flex items-center gap-2 bg-gray-50 rounded-md px-2 py-1.5">
              <Search className="w-3.5 h-3.5 text-gray-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={isZh ? '搜索用户...' : 'Search user...'}
                className="flex-1 bg-transparent text-sm outline-none"
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-48 overflow-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-400 text-center">
                {isZh ? '未找到用户' : 'No users found'}
              </div>
            ) : (
              filtered.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    onChange(u.id)
                    setOpen(false)
                    setQuery('')
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 ${
                    value === u.id ? 'bg-primary/5 text-primary font-medium' : 'text-gray-700'
                  }`}
                >
                  <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-xs text-gray-500">
                    {u.display_name.charAt(0)}
                  </div>
                  {u.display_name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function ProjectTodosTab({ projectId, todos, onUpdate }: ProjectTodosTabProps) {
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const toast = useToast()

  const [users, setUsers] = useState<UserItem[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)

  const currentUser = (() => {
    try {
      const raw = localStorage.getItem('user')
      return raw ? (JSON.parse(raw) as { id?: number }) : null
    } catch {
      return null
    }
  })()

  const [newContent, setNewContent] = useState('')
  const [newAssignee, setNewAssignee] = useState<number | null>(currentUser?.id ?? null)
  const [isAdding, setIsAdding] = useState(false)

  const [savingId, setSavingId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editAssignee, setEditAssignee] = useState<number | null>(null)
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set())
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [todoToDelete, setTodoToDelete] = useState<ProjectTodo | null>(null)

  const completedCount = todos.filter((t) => t.is_done).length
  const progress = todos.length > 0 ? (completedCount / todos.length) * 100 : 0

  useEffect(() => {
    const fetchUsers = async () => {
      setLoadingUsers(true)
      try {
        const data = await api.get<UserItem[]>('/auth/users/simple')
        setUsers(data)
      } catch (error) {
        console.error('Failed to fetch users:', error)
      } finally {
        setLoadingUsers(false)
      }
    }
    fetchUsers()
  }, [])

  const handleCreate = async () => {
    if (!newContent.trim()) return
    setIsAdding(true)
    try {
      await api.post(`/projects/${projectId}/todos`, {
        content: newContent.trim(),
        assigned_to_user_id: newAssignee,
      })
      setNewContent('')
      setNewAssignee(currentUser?.id ?? null)
      onUpdate()
    } catch (error) {
      console.error('Failed to create todo:', error)
      toast.error(isZh ? '创建失败' : 'Failed to create')
    } finally {
      setIsAdding(false)
    }
  }

  const handleToggle = async (todo: ProjectTodo) => {
    setSavingId(todo.id)
    try {
      await api.patch(`/projects/${projectId}/todos/${todo.id}`, {
        is_done: !todo.is_done,
      })
      onUpdate()
    } catch (error) {
      console.error('Failed to toggle todo:', error)
      toast.error(isZh ? '更新失败' : 'Failed to update')
    } finally {
      setSavingId(null)
    }
  }

  const openDeleteDialog = (todo: ProjectTodo) => {
    setTodoToDelete(todo)
    setShowDeleteDialog(true)
  }

  const closeDeleteDialog = () => {
    setShowDeleteDialog(false)
    setTodoToDelete(null)
  }

  const confirmDelete = async () => {
    if (!todoToDelete) return
    const todoId = todoToDelete.id
    setShowDeleteDialog(false)
    setDeletingIds((prev) => new Set(prev).add(todoId))
    try {
      await api.delete(`/projects/${projectId}/todos/${todoId}`)
      await onUpdate()
    } catch (error) {
      console.error('Failed to delete todo:', error)
      toast.error(isZh ? '删除失败' : 'Failed to delete')
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev)
        next.delete(todoId)
        return next
      })
      setTodoToDelete(null)
    }
  }

  const startEdit = (todo: ProjectTodo) => {
    setEditingId(todo.id)
    setEditContent(todo.content)
    setEditAssignee(todo.assigned_to_user_id ?? null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditContent('')
    setEditAssignee(null)
  }

  const handleSaveEdit = async (todoId: number) => {
    if (!editContent.trim()) return
    setSavingId(todoId)
    try {
      await api.patch(`/projects/${projectId}/todos/${todoId}`, {
        content: editContent.trim(),
        assigned_to_user_id: editAssignee,
      })
      setEditingId(null)
      setEditContent('')
      setEditAssignee(null)
      onUpdate()
    } catch (error) {
      console.error('Failed to update todo:', error)
      toast.error(isZh ? '保存失败' : 'Failed to save')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ListTodo className="w-5 h-5 text-gray-400" />
            <h3 className="font-semibold text-gray-900">
              {isZh ? '项目待办' : 'Project Todos'}
            </h3>
          </div>
          <span className="text-sm text-gray-500">
            {completedCount} / {todos.length} {isZh ? '已完成' : 'done'}
          </span>
        </div>
        <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Add Todo */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate()
            }}
            placeholder={isZh ? '添加新的待办事项...' : 'Add a new todo...'}
            className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
          <div className="sm:w-48">
            <UserPicker
              users={users}
              value={newAssignee}
              onChange={setNewAssignee}
              disabled={loadingUsers}
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={isAdding || !newContent.trim()}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {isZh ? '添加' : 'Add'}
          </button>
        </div>
      </div>

      {/* Todo List */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {todos.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <ListTodo className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="text-sm">{isZh ? '暂无待办事项' : 'No todos yet'}</p>
            <p className="text-xs mt-1 opacity-70">
              {isZh ? '在上方输入并添加第一个待办' : 'Type above to add your first todo'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {todos
              .filter((todo) => !deletingIds.has(todo.id))
              .map((todo) => (
                <div
                  key={todo.id}
                  className={`flex items-center gap-3 p-4 hover:bg-gray-50 transition-colors group ${
                    todo.is_done ? 'bg-gray-50/50' : ''
                  }`}
                >
                  <div className="flex-shrink-0 text-gray-400">
                    {savingId === todo.id ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : todo.is_done ? (
                      <button
                        onClick={() => handleToggle(todo)}
                        className="text-gray-400 hover:text-primary transition-colors"
                      >
                        <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleToggle(todo)}
                        className="text-gray-400 hover:text-primary transition-colors"
                      >
                        <Circle className="w-5 h-5" />
                      </button>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    {editingId === todo.id ? (
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit(todo.id)
                            if (e.key === 'Escape') cancelEdit()
                          }}
                          autoFocus
                          className="flex-1 px-3 py-1.5 bg-white border border-primary/30 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                        <div className="sm:w-44">
                          <UserPicker
                            users={users}
                            value={editAssignee}
                            onChange={setEditAssignee}
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleSaveEdit(todo.id)}
                            disabled={savingId === todo.id}
                            className="p-1.5 rounded-md bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
                          >
                            {savingId === todo.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Check className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="p-1.5 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <p className={`text-sm ${todo.is_done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                          {todo.content}
                        </p>
                        {todo.assigned_user && (
                          <div className="flex items-center gap-1.5 text-xs text-gray-500">
                            <div className="w-4 h-4 rounded-full bg-gray-100 flex items-center justify-center text-[10px] text-gray-500">
                              {todo.assigned_user.display_name.charAt(0)}
                            </div>
                            <span>{todo.assigned_user.display_name}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => startEdit(todo)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => openDeleteDialog(todo)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && todoToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl border border-gray-100">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">
                  {isZh ? '确认删除待办' : 'Delete Todo'}
                </h3>
                <p className="text-sm text-gray-500">
                  {isZh ? '此操作不可撤销' : 'This action cannot be undone'}
                </p>
              </div>
            </div>
            <p className="text-sm text-gray-700 mb-6">
              {isZh ? '确定要删除 "' : 'Are you sure you want to delete "'}
              <span className="font-medium text-gray-900">{todoToDelete.content}</span>
              {isZh ? '" 吗？' : '"?'}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={closeDeleteDialog}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
              >
                {isZh ? '取消' : 'Cancel'}
              </button>
              <button
                onClick={confirmDelete}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {isZh ? '确认删除' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
