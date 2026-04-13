import { useState } from 'react'
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
} from 'lucide-react'
import { api } from '../../api/client'
import { useToast } from '../../contexts/ToastContext'
import type { ProjectTodo } from '../../types/api'

interface ProjectTodosTabProps {
  projectId: string
  todos: ProjectTodo[]
  onUpdate: () => void
}

export function ProjectTodosTab({ projectId, todos, onUpdate }: ProjectTodosTabProps) {
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const toast = useToast()

  const [newContent, setNewContent] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editContent, setEditContent] = useState('')

  const completedCount = todos.filter((t) => t.is_done).length
  const progress = todos.length > 0 ? (completedCount / todos.length) * 100 : 0

  const handleCreate = async () => {
    if (!newContent.trim()) return
    setIsAdding(true)
    try {
      await api.post(`/projects/${projectId}/todos`, { content: newContent.trim() })
      setNewContent('')
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

  const handleDelete = async (todoId: number) => {
    if (!confirm(isZh ? '确定要删除这个待办吗？' : 'Are you sure you want to delete this todo?')) return
    try {
      await api.delete(`/projects/${projectId}/todos/${todoId}`)
      onUpdate()
    } catch (error) {
      console.error('Failed to delete todo:', error)
      toast.error(isZh ? '删除失败' : 'Failed to delete')
    }
  }

  const startEdit = (todo: ProjectTodo) => {
    setEditingId(todo.id)
    setEditContent(todo.content)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditContent('')
  }

  const handleSaveEdit = async (todoId: number) => {
    if (!editContent.trim()) return
    setSavingId(todoId)
    try {
      await api.patch(`/projects/${projectId}/todos/${todoId}`, {
        content: editContent.trim(),
      })
      setEditingId(null)
      setEditContent('')
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
        <div className="flex items-center gap-3">
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
          <button
            onClick={handleCreate}
            disabled={isAdding || !newContent.trim()}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
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
            {todos.map((todo) => (
              <div
                key={todo.id}
                className={`flex items-center gap-3 p-4 hover:bg-gray-50 transition-colors group ${
                  todo.is_done ? 'bg-gray-50/50' : ''
                }`}
              >
                <button
                  onClick={() => handleToggle(todo)}
                  disabled={savingId === todo.id}
                  className="flex-shrink-0 text-gray-400 hover:text-primary transition-colors disabled:opacity-50"
                >
                  {savingId === todo.id ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : todo.is_done ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  ) : (
                    <Circle className="w-5 h-5" />
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  {editingId === todo.id ? (
                    <div className="flex items-center gap-2">
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
                  ) : (
                    <p
                      className={`text-sm truncate ${
                        todo.is_done ? 'text-gray-400 line-through' : 'text-gray-900'
                      }`}
                    >
                      {todo.content}
                    </p>
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
                    onClick={() => handleDelete(todo.id)}
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
    </div>
  )
}
