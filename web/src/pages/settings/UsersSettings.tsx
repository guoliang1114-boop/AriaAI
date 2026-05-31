import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Users,
  UserPlus,
  Trash2,
  Shield,
  User,
  Loader2,
  AlertCircle,
  Check,
  Lock,
  Edit3,
  X,
  Mail,
  UserCog,
  Search,
  RefreshCw,
} from 'lucide-react'
import { api } from '../../api/client'
import { CxPagination } from '../../components/codex'

interface UserItem {
  id: number
  email: string
  display_name: string
  is_admin: boolean
  is_active: boolean
}

interface UserFormData {
  email: string
  display_name: string
  is_admin: boolean
  password?: string
}

interface UserListResponse {
  items: UserItem[]
  total: number
  limit: number
  offset: number
}

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: 13.5,
  background: 'var(--color-codex-bg)',
  border: '1px solid var(--color-codex-line)',
  borderRadius: 'var(--codex-r-sm, 3px)',
  color: 'var(--color-codex-ink)',
  outline: 'none',
}

const LABEL_STYLE: React.CSSProperties = {
  display: 'block',
  marginBottom: 6,
  fontSize: 10.5,
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  color: 'var(--color-codex-ink-mute)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
}

const GHOST_BUTTON_STYLE: React.CSSProperties = {
  padding: '8px 14px',
  fontSize: 13,
  background: 'var(--color-codex-bg)',
  color: 'var(--color-codex-ink-soft)',
  border: '1px solid var(--color-codex-line)',
  borderRadius: 'var(--codex-r-sm, 3px)',
}

const ACCENT_BUTTON_STYLE: React.CSSProperties = {
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 500,
  background: 'var(--color-codex-accent)',
  color: 'var(--color-codex-bg-elev)',
  borderRadius: 'var(--codex-r-sm, 3px)',
}

const DANGER_BUTTON_STYLE: React.CSSProperties = {
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 500,
  background: 'var(--color-codex-bad)',
  color: 'var(--color-codex-bg-elev)',
  borderRadius: 'var(--codex-r-sm, 3px)',
}

const USERS_PAGE_SIZE = 10

function DialogShell({ icon: Icon, iconTone, title, children }: {
  icon: typeof UserPlus
  iconTone: 'accent' | 'danger' | 'neutral'
  title: string
  children: React.ReactNode
}) {
  const toneBg = iconTone === 'danger'
    ? 'color-mix(in oklch, var(--color-codex-bad) 12%, transparent)'
    : iconTone === 'neutral'
      ? 'var(--color-codex-bg-tint)'
      : 'var(--color-codex-accent-bg)'
  const toneColor = iconTone === 'danger'
    ? 'var(--color-codex-bad)'
    : iconTone === 'neutral'
      ? 'var(--color-codex-ink-soft)'
      : 'var(--color-codex-accent)'
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)' }}
    >
      <div
        className="w-full max-w-md p-6"
        style={{
          background: 'var(--color-codex-bg-elev)',
          border: '1px solid var(--color-codex-line)',
          borderRadius: 'var(--codex-r-md, 6px)',
          boxShadow: '0 24px 60px -16px rgba(0,0,0,0.32)',
        }}
      >
        <div className="mb-4 flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center"
            style={{
              background: toneBg,
              color: toneColor,
              borderRadius: 'var(--codex-r-sm, 3px)',
            }}
          >
            <Icon className="h-5 w-5" />
          </div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--color-codex-ink)' }}>
            {title}
          </h3>
        </div>
        {children}
      </div>
    </div>
  )
}

export function UsersSettings() {
  const { t, i18n } = useTranslation()
  const isZh = !i18n?.language || i18n.language.startsWith('zh')
  const [users, setUsers] = useState<UserItem[]>([])
  const [userTotal, setUserTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [userPage, setUserPage] = useState(1)
  const [userPageSize, setUserPageSize] = useState(USERS_PAGE_SIZE)

  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showResetPasswordDialog, setShowResetPasswordDialog] = useState(false)
  const [selectedUser, setSelectedUser] = useState<UserItem | null>(null)

  const [formData, setFormData] = useState<UserFormData>({
    email: '',
    display_name: '',
    is_admin: false,
    password: '',
  })
  const [newPassword, setNewPassword] = useState('')
  const [formLoading, setFormLoading] = useState(false)

  useEffect(() => {
    loadUsers()
  }, [searchQuery, userPage, userPageSize])

  const loadUsers = async (options: { page?: number } = {}) => {
    try {
      setLoading(true)
      setError('')
      const page = options.page ?? userPage
      const data = await api.get<UserListResponse>('/auth/users/list', {
        params: {
          search: searchQuery.trim(),
          limit: userPageSize,
          offset: (page - 1) * userPageSize,
        },
      })
      setUsers(data.items)
      setUserTotal(data.total)
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  const handleAddUser = async () => {
    if (!formData.email || !formData.password) {
      setError(t('users.emailAndPasswordRequired') || 'Email and password are required')
      return
    }

    setFormLoading(true)
    setError('')

    try {
      await api.post('/auth/users', {
        email: formData.email,
        password: formData.password,
        display_name: formData.display_name || formData.email.split('@')[0],
        is_admin: formData.is_admin,
      })

      setSuccessMessage(t('users.userAdded') || 'User added successfully')
      setShowAddDialog(false)
      setUserPage(1)
      resetForm()
      await loadUsers({ page: 1 })

      setTimeout(() => setSuccessMessage(''), 3000)
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to add user')
    } finally {
      setFormLoading(false)
    }
  }

  const handleEditUser = async () => {
    if (!selectedUser) return

    setFormLoading(true)
    setError('')

    try {
      await api.patch(`/auth/users/${selectedUser.id}`, {
        display_name: formData.display_name,
        is_admin: formData.is_admin,
        is_active: true,
      })

      setSuccessMessage(t('users.userUpdated') || 'User updated successfully')
      setShowEditDialog(false)
      setSelectedUser(null)
      await loadUsers()

      setTimeout(() => setSuccessMessage(''), 3000)
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to update user')
    } finally {
      setFormLoading(false)
    }
  }

  const handleDeleteUser = async () => {
    if (!selectedUser) return

    setFormLoading(true)
    setError('')

    try {
      await api.delete(`/auth/users/${selectedUser.id}`)

      setSuccessMessage(t('users.userDeleted') || 'User deleted successfully')
      setShowDeleteDialog(false)
      setSelectedUser(null)
      await loadUsers()

      setTimeout(() => setSuccessMessage(''), 3000)
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to delete user')
    } finally {
      setFormLoading(false)
    }
  }

  const handleResetPassword = async () => {
    if (!selectedUser || !newPassword) {
      setError(t('users.passwordRequired') || 'Password is required')
      return
    }

    setFormLoading(true)
    setError('')

    try {
      await api.post(`/auth/users/${selectedUser.id}/reset-password`, {
        new_password: newPassword,
      })

      setSuccessMessage(t('users.passwordReset') || 'Password reset successfully')
      setShowResetPasswordDialog(false)
      setSelectedUser(null)
      setNewPassword('')

      setTimeout(() => setSuccessMessage(''), 3000)
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to reset password')
    } finally {
      setFormLoading(false)
    }
  }

  const openEditDialog = (user: UserItem) => {
    setSelectedUser(user)
    setFormData({
      email: user.email,
      display_name: user.display_name,
      is_admin: user.is_admin,
      password: '',
    })
    setShowEditDialog(true)
  }

  const openDeleteDialog = (user: UserItem) => {
    setSelectedUser(user)
    setShowDeleteDialog(true)
  }

  const openResetPasswordDialog = (user: UserItem) => {
    setSelectedUser(user)
    setNewPassword('')
    setShowResetPasswordDialog(true)
  }

  const resetForm = () => {
    setFormData({
      email: '',
      display_name: '',
      is_admin: false,
      password: '',
    })
  }

  const userPageCount = Math.max(1, Math.ceil(userTotal / userPageSize))
  const currentUserPage = Math.min(userPage, userPageCount)

  useEffect(() => {
    setUserPage(1)
  }, [searchQuery])

  useEffect(() => {
    setUserPage((current) => Math.min(current, userPageCount))
  }, [userPageCount])

  if (loading) {
    return (
      <div
        className="theme-codex flex items-center justify-center py-12"
        style={{ background: 'var(--color-codex-bg)' }}
      >
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--color-codex-accent)' }} />
      </div>
    )
  }

  return (
    <div
      className="theme-codex"
      style={{
        background: 'var(--color-codex-bg)',
        color: 'var(--color-codex-ink)',
        padding: '8px 4px 32px',
      }}
    >
      {/* Header */}
      <header
        className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
        style={{ marginBottom: 20 }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 500,
              color: 'var(--color-codex-ink)',
              letterSpacing: '-0.015em',
            }}
          >
            {t('users.title') || '用户管理'}
          </h1>
          <p
            style={{
              margin: '6px 0 0',
              fontSize: 13,
              color: 'var(--color-codex-ink-mute)',
              lineHeight: 1.6,
            }}
          >
            {t('users.subtitle') || '管理团队成员和权限'}
          </p>
        </div>
        <button
          onClick={() => {
            resetForm()
            setShowAddDialog(true)
          }}
          className="inline-flex items-center justify-center gap-2 px-3 py-2 transition-colors"
          style={{
            fontSize: 13,
            fontWeight: 500,
            background: 'var(--color-codex-accent)',
            color: 'var(--color-codex-bg-elev)',
            borderRadius: 'var(--codex-r-sm, 3px)',
          }}
        >
          <UserPlus className="h-3.5 w-3.5" />
          {t('users.addUser') || '添加用户'}
        </button>
      </header>

      {/* Alerts */}
      {error && (
        <div
          className="mb-4 flex items-center gap-2"
          style={{
            padding: '10px 14px',
            fontSize: 13,
            background: 'color-mix(in oklch, var(--color-codex-bad) 8%, transparent)',
            border: '1px solid color-mix(in oklch, var(--color-codex-bad) 30%, transparent)',
            borderRadius: 'var(--codex-r-sm, 3px)',
            color: 'var(--color-codex-bad)',
          }}
        >
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
          <button
            onClick={() => setError('')}
            className="ml-auto opacity-70 hover:opacity-100"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {successMessage && (
        <div
          className="mb-4 flex items-center gap-2"
          style={{
            padding: '10px 14px',
            fontSize: 13,
            background: 'var(--color-codex-accent-bg)',
            border: '1px solid color-mix(in oklch, var(--color-codex-accent) 30%, transparent)',
            borderRadius: 'var(--codex-r-sm, 3px)',
            color: 'var(--color-codex-accent-ink)',
          }}
        >
          <Check className="h-4 w-4 flex-shrink-0" />
          {successMessage}
        </div>
      )}

      {/* Search + refresh */}
      <div className="mb-4 flex items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search
            className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
            style={{ color: 'var(--color-codex-ink-faint)' }}
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setUserPage(1)
            }}
            placeholder={t('users.search') || '搜索用户...'}
            style={{ ...INPUT_STYLE, paddingLeft: 32 }}
          />
        </div>
        <button
          onClick={() => void loadUsers()}
          disabled={loading}
          className="flex items-center justify-center px-3 py-2 transition-colors disabled:opacity-50"
          style={GHOST_BUTTON_STYLE}
          title={t('common.refresh') || 'Refresh'}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* User list */}
      <div className="space-y-2">
        {users.map((user) => (
          <div
            key={user.id}
            className="flex items-center justify-between"
            style={{
              padding: '14px 16px',
              background: 'var(--color-codex-bg-elev)',
              border: '1px solid var(--color-codex-line)',
              borderRadius: 'var(--codex-r-sm, 3px)',
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center"
                style={{
                  background: 'var(--color-codex-bg-tint)',
                  color: 'var(--color-codex-ink-soft)',
                  borderRadius: 'var(--codex-r-sm, 3px)',
                }}
              >
                <User className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: 'var(--color-codex-ink)',
                    }}
                  >
                    {user.display_name}
                  </span>
                  {user.is_admin && (
                    <span
                      className="flex items-center gap-1 font-mono"
                      style={{
                        padding: '2px 8px',
                        fontSize: 10.5,
                        background: 'var(--color-codex-accent-bg)',
                        color: 'var(--color-codex-accent-ink)',
                        borderRadius: 'var(--codex-r-pill, 999px)',
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                      }}
                    >
                      <Shield className="h-3 w-3" />
                      {t('users.admin') || 'Admin'}
                    </span>
                  )}
                  {!user.is_active && (
                    <span
                      className="font-mono"
                      style={{
                        padding: '2px 8px',
                        fontSize: 10.5,
                        background: 'color-mix(in oklch, var(--color-codex-bad) 12%, transparent)',
                        color: 'var(--color-codex-bad)',
                        borderRadius: 'var(--codex-r-pill, 999px)',
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {t('users.inactive') || 'Inactive'}
                    </span>
                  )}
                </div>
                <p
                  className="flex items-center gap-1 font-mono"
                  style={{
                    margin: '4px 0 0',
                    fontSize: 11.5,
                    color: 'var(--color-codex-ink-mute)',
                  }}
                >
                  <Mail className="h-3 w-3" />
                  {user.email}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => openEditDialog(user)}
                className="p-2 transition-colors"
                style={{ color: 'var(--color-codex-ink-soft)', borderRadius: 'var(--codex-r-sm, 3px)' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--color-codex-bg-tint)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
                title={t('users.edit') || '编辑'}
              >
                <Edit3 className="h-4 w-4" />
              </button>
              <button
                onClick={() => openResetPasswordDialog(user)}
                className="p-2 transition-colors"
                style={{ color: 'var(--color-codex-ink-soft)', borderRadius: 'var(--codex-r-sm, 3px)' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--color-codex-bg-tint)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
                title={t('users.resetPassword') || '重置密码'}
              >
                <Lock className="h-4 w-4" />
              </button>
              <button
                onClick={() => openDeleteDialog(user)}
                className="group p-2 transition-colors"
                style={{ color: 'var(--color-codex-ink-soft)', borderRadius: 'var(--codex-r-sm, 3px)' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background =
                    'color-mix(in oklch, var(--color-codex-bad) 10%, transparent)'
                  e.currentTarget.style.color = 'var(--color-codex-bad)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = 'var(--color-codex-ink-soft)'
                }}
                title={t('users.delete') || '删除'}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {userTotal > 0 ? (
        <CxPagination
          page={currentUserPage}
          pageSize={userPageSize}
          totalItems={userTotal}
          onPageChange={setUserPage}
          onPageSizeChange={(nextPageSize) => {
            setUserPageSize(nextPageSize)
            setUserPage(1)
          }}
          isZh={isZh}
          pageSizeOptions={[10, 20, 50]}
          style={{ marginTop: 10 }}
        />
      ) : null}

      {/* Empty state */}
      {userTotal === 0 && !loading && (
        <div
          className="text-center"
          style={{
            padding: '40px 24px',
            background: 'var(--color-codex-bg-tint)',
            border: '1px dashed var(--color-codex-line)',
            borderRadius: 'var(--codex-r-sm, 3px)',
          }}
        >
          <Users
            className="mx-auto mb-4 h-10 w-10"
            style={{ color: 'var(--color-codex-ink-faint)' }}
          />
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-codex-ink-mute)' }}>
            {searchQuery
              ? t('users.noSearchResults') || '未找到匹配的用户'
              : t('users.noUsers') || '暂无其他用户'}
          </p>
        </div>
      )}

      {/* Add user dialog */}
      {showAddDialog && (
        <DialogShell
          icon={UserPlus}
          iconTone="accent"
          title={t('users.addUser') || '添加用户'}
        >
          <div className="space-y-4">
            <div>
              <label style={LABEL_STYLE}>{t('users.email') || '邮箱地址'} *</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="user@example.com"
                style={INPUT_STYLE}
              />
            </div>

            <div>
              <label style={LABEL_STYLE}>{t('users.displayName') || '显示名称'}</label>
              <input
                type="text"
                value={formData.display_name}
                onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                placeholder={t('users.displayNamePlaceholder') || '输入显示名称'}
                style={INPUT_STYLE}
              />
            </div>

            <div>
              <label style={LABEL_STYLE}>{t('users.password') || '密码'} *</label>
              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder={t('users.passwordPlaceholder') || '至少6位字符'}
                style={INPUT_STYLE}
              />
            </div>

            <label
              className="flex items-center gap-3"
              style={{
                padding: '10px 14px',
                background: 'var(--color-codex-bg-tint)',
                border: '1px solid var(--color-codex-line-soft)',
                borderRadius: 'var(--codex-r-sm, 3px)',
              }}
            >
              <input
                type="checkbox"
                id="isAdmin"
                checked={formData.is_admin}
                onChange={(e) => setFormData({ ...formData, is_admin: e.target.checked })}
                className="h-4 w-4"
                style={{ accentColor: 'var(--color-codex-accent)' }}
              />
              <div className="flex-1">
                <span
                  style={{
                    display: 'block',
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'var(--color-codex-ink)',
                  }}
                >
                  {t('users.setAsAdmin') || '设为管理员'}
                </span>
                <p
                  style={{
                    margin: '2px 0 0',
                    fontSize: 11.5,
                    color: 'var(--color-codex-ink-mute)',
                  }}
                >
                  {t('users.adminDesc') || '管理员可以管理用户和系统设置'}
                </p>
              </div>
            </label>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button onClick={() => setShowAddDialog(false)} style={GHOST_BUTTON_STYLE}>
              {t('common.cancel') || '取消'}
            </button>
            <button
              onClick={handleAddUser}
              disabled={formLoading || !formData.email || !formData.password}
              className="inline-flex items-center gap-2 disabled:opacity-50"
              style={ACCENT_BUTTON_STYLE}
            >
              {formLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t('users.add') || '添加'}
            </button>
          </div>
        </DialogShell>
      )}

      {/* Edit user dialog */}
      {showEditDialog && selectedUser && (
        <DialogShell
          icon={UserCog}
          iconTone="neutral"
          title={t('users.editUser') || '编辑用户'}
        >
          <div className="space-y-4">
            <div>
              <label style={LABEL_STYLE}>{t('users.email') || '邮箱地址'}</label>
              <input
                type="email"
                value={formData.email}
                disabled
                style={{
                  ...INPUT_STYLE,
                  background: 'var(--color-codex-bg-tint)',
                  color: 'var(--color-codex-ink-mute)',
                  cursor: 'not-allowed',
                }}
              />
              <p
                style={{
                  margin: '4px 0 0',
                  fontSize: 11,
                  color: 'var(--color-codex-ink-mute)',
                }}
              >
                {t('users.emailCannotChange') || '邮箱地址无法更改'}
              </p>
            </div>

            <div>
              <label style={LABEL_STYLE}>{t('users.displayName') || '显示名称'}</label>
              <input
                type="text"
                value={formData.display_name}
                onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                style={INPUT_STYLE}
              />
            </div>

            <label
              className="flex items-center gap-3"
              style={{
                padding: '10px 14px',
                background: 'var(--color-codex-bg-tint)',
                border: '1px solid var(--color-codex-line-soft)',
                borderRadius: 'var(--codex-r-sm, 3px)',
              }}
            >
              <input
                type="checkbox"
                id="editIsAdmin"
                checked={formData.is_admin}
                onChange={(e) => setFormData({ ...formData, is_admin: e.target.checked })}
                className="h-4 w-4"
                style={{ accentColor: 'var(--color-codex-accent)' }}
              />
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--color-codex-ink)',
                }}
              >
                {t('users.setAsAdmin') || '设为管理员'}
              </span>
            </label>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button onClick={() => setShowEditDialog(false)} style={GHOST_BUTTON_STYLE}>
              {t('common.cancel') || '取消'}
            </button>
            <button
              onClick={handleEditUser}
              disabled={formLoading}
              className="inline-flex items-center gap-2 disabled:opacity-50"
              style={ACCENT_BUTTON_STYLE}
            >
              {formLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t('common.save') || '保存'}
            </button>
          </div>
        </DialogShell>
      )}

      {/* Delete user dialog */}
      {showDeleteDialog && selectedUser && (
        <DialogShell
          icon={Trash2}
          iconTone="danger"
          title={t('users.deleteUser') || '删除用户'}
        >
          <p
            style={{
              margin: '0 0 20px',
              fontSize: 13,
              lineHeight: 1.6,
              color: 'var(--color-codex-ink-soft)',
            }}
          >
            {t('users.deleteConfirm') || '确定要删除用户'}
            <span style={{ fontWeight: 600, color: 'var(--color-codex-ink)' }}>
              {' '}{selectedUser.display_name}
            </span>
            ?{' '}
            {t('users.deleteWarning') || '此操作无法撤销。'}
          </p>

          <div className="flex justify-end gap-2">
            <button onClick={() => setShowDeleteDialog(false)} style={GHOST_BUTTON_STYLE}>
              {t('common.cancel') || '取消'}
            </button>
            <button
              onClick={handleDeleteUser}
              disabled={formLoading}
              className="inline-flex items-center gap-2 disabled:opacity-50"
              style={DANGER_BUTTON_STYLE}
            >
              {formLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t('common.delete') || '删除'}
            </button>
          </div>
        </DialogShell>
      )}

      {/* Reset password dialog */}
      {showResetPasswordDialog && selectedUser && (
        <DialogShell
          icon={Lock}
          iconTone="accent"
          title={t('users.resetPassword') || '重置密码'}
        >
          <p
            style={{
              margin: '0 0 16px',
              fontSize: 12.5,
              color: 'var(--color-codex-ink-mute)',
            }}
          >
            {t('users.resetPasswordFor') || '为'}
            <span style={{ fontWeight: 500, color: 'var(--color-codex-ink)' }}>
              {' '}{selectedUser.display_name}{' '}
            </span>
            {t('users.setNewPassword') || '设置新密码'}
          </p>

          <div>
            <label style={LABEL_STYLE}>{t('users.newPassword') || '新密码'}</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t('users.passwordPlaceholder') || '至少6位字符'}
              style={INPUT_STYLE}
            />
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button onClick={() => setShowResetPasswordDialog(false)} style={GHOST_BUTTON_STYLE}>
              {t('common.cancel') || '取消'}
            </button>
            <button
              onClick={handleResetPassword}
              disabled={formLoading || !newPassword}
              className="inline-flex items-center gap-2 disabled:opacity-50"
              style={ACCENT_BUTTON_STYLE}
            >
              {formLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t('users.reset') || '重置'}
            </button>
          </div>
        </DialogShell>
      )}
    </div>
  )
}
