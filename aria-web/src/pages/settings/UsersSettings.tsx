import { useState } from 'react'
import { Users, UserPlus, Trash2, Shield, User } from 'lucide-react'

interface UserItem {
  id: number
  name: string
  email: string
  role: 'admin' | 'user'
}

export function UsersSettings() {
  const [users] = useState<UserItem[]>([
    { id: 1, name: 'Admin User', email: 'admin@example.com', role: 'admin' },
  ])
  const [showAddDialog, setShowAddDialog] = useState(false)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">用户管理</h2>
          <p className="text-sm text-[var(--color-text-muted)]">管理团队成员和权限</p>
        </div>
        <button
          onClick={() => setShowAddDialog(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-[var(--color-accent-600)] hover:bg-[var(--color-accent-700)] text-white rounded-lg font-medium transition-all"
        >
          <UserPlus className="w-4 h-4" />
          添加用户
        </button>
      </div>

      {/* Users List */}
      <div className="space-y-3">
        {users.map(user => (
          <div
            key={user.id}
            className="flex items-center justify-between p-4 bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-default)]"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[var(--color-accent-50)] rounded-xl flex items-center justify-center">
                <User className="w-5 h-5 text-[var(--color-accent-600)]" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-[var(--color-text-primary)]">{user.name}</span>
                  {user.role === 'admin' && (
                    <span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-[var(--color-accent-50)] text-[var(--color-accent-600)] rounded-full">
                      <Shield className="w-3 h-3" />
                      管理员
                    </span>
                  )}
                </div>
                <p className="text-sm text-[var(--color-text-muted)]">{user.email}</p>
              </div>
            </div>
            <button className="p-2 hover:bg-[var(--color-error-50)] rounded-lg group transition-all">
              <Trash2 className="w-4 h-4 text-[var(--color-text-tertiary)] group-hover:text-[var(--color-error-500)]" />
            </button>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {users.length === 0 && (
        <div className="text-center py-12 bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-default)]">
          <Users className="w-12 h-12 text-[var(--color-text-tertiary)] mx-auto mb-4" />
          <p className="text-[var(--color-text-muted)]">暂无其他用户</p>
        </div>
      )}

      {/* Add User Dialog */}
      {showAddDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--color-bg-primary)] rounded-2xl p-6 w-full max-w-md shadow-2xl border border-[var(--color-border-default)]">
            <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">添加用户</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                  邮箱地址
                </label>
                <input
                  type="email"
                  placeholder="user@example.com"
                  className="w-full px-4 py-2.5 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)]/20 focus:border-[var(--color-accent-500)] transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                  角色
                </label>
                <select className="w-full px-4 py-2.5 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)]/20 focus:border-[var(--color-accent-500)] transition-all">
                  <option value="user">普通用户</option>
                  <option value="admin">管理员</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowAddDialog(false)}
                className="px-4 py-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] rounded-lg transition-all"
              >
                取消
              </button>
              <button
                onClick={() => setShowAddDialog(false)}
                className="px-4 py-2 bg-[var(--color-accent-600)] hover:bg-[var(--color-accent-700)] text-white rounded-lg transition-all"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
