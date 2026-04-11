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
  MoreVertical,
  Lock,
  Edit3,
  X,
  Mail,
  UserCog,
  Search,
  RefreshCw
} from 'lucide-react'
import { api } from '../../api/client'

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

export function UsersSettings() {
  const { t } = useTranslation()
  const [users, setUsers] = useState<UserItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  
  // Dialog states
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showResetPasswordDialog, setShowResetPasswordDialog] = useState(false)
  const [selectedUser, setSelectedUser] = useState<UserItem | null>(null)
  
  // Form states
  const [formData, setFormData] = useState<UserFormData>({
    email: '',
    display_name: '',
    is_admin: false,
    password: '',
  })
  const [newPassword, setNewPassword] = useState('')
  const [formLoading, setFormLoading] = useState(false)

  // Load users on mount
  useEffect(() => {
    loadUsers()
  }, [])

  const loadUsers = async () => {
    try {
      setLoading(true)
      setError('')
      const data = await api.get<UserItem[]>('/auth/users')
      setUsers(data)
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
      resetForm()
      await loadUsers()
      
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

  // Filter users by search query
  const filteredUsers = users.filter(user => 
    user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.display_name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-on-surface mb-1">
            {t('users.title') || '用户管理'}
          </h2>
          <p className="text-sm text-on-surface-muted">
            {t('users.subtitle') || '管理团队成员和权限'}
          </p>
        </div>
        <button
          onClick={() => {
            resetForm()
            setShowAddDialog(true)
          }}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-xl font-medium transition-all"
        >
          <UserPlus className="w-4 h-4" />
          {t('users.addUser') || '添加用户'}
        </button>
      </div>

      {/* Alerts */}
      {error && (
        <div className="p-3 bg-error/10 border border-error/20 rounded-lg flex items-center gap-2 text-error text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
          <button 
            onClick={() => setError('')}
            className="ml-auto hover:opacity-70"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      
      {successMessage && (
        <div className="p-3 bg-success/10 border border-success/20 rounded-lg flex items-center gap-2 text-success text-sm">
          <Check className="w-4 h-4 flex-shrink-0" />
          {successMessage}
        </div>
      )}

      {/* Search and Refresh */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('users.search') || '搜索用户...'}
            className="w-full pl-10 pr-4 py-2.5 bg-surface-container-low border border-outline/20 rounded-xl text-on-surface placeholder:text-on-surface-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
          />
        </div>
        <button
          onClick={loadUsers}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2.5 border border-outline/20 rounded-xl hover:bg-surface-container-high transition-all disabled:opacity-50 text-on-surface-secondary"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Users List */}
      <div className="space-y-2">
        {filteredUsers.map(user => (
          <div
            key={user.id}
            className="flex items-center justify-between p-4 bg-surface-container-low rounded-xl border border-outline/10 hover:border-outline/20 transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
                <User className="w-5 h-5 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-on-surface">
                    {user.display_name}
                  </span>
                  {user.is_admin && (
                    <span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-tertiary-container text-on-tertiary-container rounded-full">
                      <Shield className="w-3 h-3" />
                      {t('users.admin') || '管理员'}
                    </span>
                  )}
                  {!user.is_active && (
                    <span className="px-2 py-0.5 text-xs bg-error/10 text-error rounded-full">
                      {t('users.inactive') || '已停用'}
                    </span>
                  )}
                </div>
                <p className="text-sm text-on-surface-muted flex items-center gap-1">
                  <Mail className="w-3 h-3" />
                  {user.email}
                </p>
              </div>
            </div>
            
            {/* Actions */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => openEditDialog(user)}
                className="p-2 hover:bg-surface-container-high rounded-lg transition-colors"
                title={t('users.edit') || '编辑'}
              >
                <Edit3 className="w-4 h-4 text-on-surface-muted" />
              </button>
              <button
                onClick={() => openResetPasswordDialog(user)}
                className="p-2 hover:bg-surface-container-high rounded-lg transition-colors"
                title={t('users.resetPassword') || '重置密码'}
              >
                <Lock className="w-4 h-4 text-on-surface-muted" />
              </button>
              <button
                onClick={() => openDeleteDialog(user)}
                className="p-2 hover:bg-error/10 rounded-lg transition-colors group"
                title={t('users.delete') || '删除'}
              >
                <Trash2 className="w-4 h-4 text-on-surface-muted group-hover:text-error" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {filteredUsers.length === 0 && !loading && (
        <div className="text-center py-12 bg-surface-container-low rounded-xl border border-outline/10">
          <Users className="w-12 h-12 text-on-surface-muted mx-auto mb-4" />
          <p className="text-on-surface-muted">
            {searchQuery 
              ? (t('users.noSearchResults') || '未找到匹配的用户')
              : (t('users.noUsers') || '暂无其他用户')
            }
          </p>
        </div>
      )}

      {/* Add User Dialog */}
      {showAddDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-2xl p-6 w-full max-w-md shadow-2xl border border-outline/20">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
                <UserPlus className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-on-surface">
                {t('users.addUser') || '添加用户'}
              </h3>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-on-surface-secondary mb-1.5">
                  {t('users.email') || '邮箱地址'} *
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="user@example.com"
                  className="w-full px-4 py-2.5 bg-surface-container-lowest border border-outline/20 rounded-xl text-on-surface placeholder:text-on-surface-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-on-surface-secondary mb-1.5">
                  {t('users.displayName') || '显示名称'}
                </label>
                <input
                  type="text"
                  value={formData.display_name}
                  onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                  placeholder={t('users.displayNamePlaceholder') || '输入显示名称'}
                  className="w-full px-4 py-2.5 bg-surface-container-lowest border border-outline/20 rounded-xl text-on-surface placeholder:text-on-surface-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-on-surface-secondary mb-1.5">
                  {t('users.password') || '密码'} *
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder={t('users.passwordPlaceholder') || '至少6位字符'}
                  className="w-full px-4 py-2.5 bg-surface-container-lowest border border-outline/20 rounded-xl text-on-surface placeholder:text-on-surface-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
                />
              </div>
              
              <div className="flex items-center gap-3 p-3 bg-surface-container-high rounded-xl">
                <input
                  type="checkbox"
                  id="isAdmin"
                  checked={formData.is_admin}
                  onChange={(e) => setFormData({ ...formData, is_admin: e.target.checked })}
                  className="w-4 h-4 accent-primary rounded"
                />
                <label htmlFor="isAdmin" className="flex-1 text-sm text-on-surface cursor-pointer">
                  <span className="font-medium">{t('users.setAsAdmin') || '设为管理员'}</span>
                  <p className="text-xs text-on-surface-muted mt-0.5">
                    {t('users.adminDesc') || '管理员可以管理用户和系统设置'}
                  </p>
                </label>
              </div>
            </div>
            
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowAddDialog(false)}
                className="px-4 py-2.5 text-on-surface-secondary hover:bg-surface-container-high rounded-xl transition-all"
              >
                {t('common.cancel') || '取消'}
              </button>
              <button
                onClick={handleAddUser}
                disabled={formLoading || !formData.email || !formData.password}
                className="flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white rounded-xl transition-all"
              >
                {formLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('users.add') || '添加'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Dialog */}
      {showEditDialog && selectedUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-2xl p-6 w-full max-w-md shadow-2xl border border-outline/20">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-secondary/10 rounded-xl flex items-center justify-center">
                <UserCog className="w-5 h-5 text-secondary" />
              </div>
              <h3 className="text-lg font-semibold text-on-surface">
                {t('users.editUser') || '编辑用户'}
              </h3>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-on-surface-secondary mb-1.5">
                  {t('users.email') || '邮箱地址'}
                </label>
                <input
                  type="email"
                  value={formData.email}
                  disabled
                  className="w-full px-4 py-2.5 bg-surface-container-low border border-outline/20 rounded-xl text-on-surface-muted cursor-not-allowed"
                />
                <p className="text-xs text-on-surface-muted mt-1">
                  {t('users.emailCannotChange') || '邮箱地址无法更改'}
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-on-surface-secondary mb-1.5">
                  {t('users.displayName') || '显示名称'}
                </label>
                <input
                  type="text"
                  value={formData.display_name}
                  onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                  className="w-full px-4 py-2.5 bg-surface-container-lowest border border-outline/20 rounded-xl text-on-surface placeholder:text-on-surface-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
                />
              </div>
              
              <div className="flex items-center gap-3 p-3 bg-surface-container-high rounded-xl">
                <input
                  type="checkbox"
                  id="editIsAdmin"
                  checked={formData.is_admin}
                  onChange={(e) => setFormData({ ...formData, is_admin: e.target.checked })}
                  className="w-4 h-4 accent-primary rounded"
                />
                <label htmlFor="editIsAdmin" className="flex-1 text-sm text-on-surface cursor-pointer">
                  <span className="font-medium">{t('users.setAsAdmin') || '设为管理员'}</span>
                </label>
              </div>
            </div>
            
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowEditDialog(false)}
                className="px-4 py-2.5 text-on-surface-secondary hover:bg-surface-container-high rounded-xl transition-all"
              >
                {t('common.cancel') || '取消'}
              </button>
              <button
                onClick={handleEditUser}
                disabled={formLoading}
                className="flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white rounded-xl transition-all"
              >
                {formLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('common.save') || '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete User Dialog */}
      {showDeleteDialog && selectedUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-2xl p-6 w-full max-w-md shadow-2xl border border-outline/20">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-error/10 rounded-xl flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-error" />
              </div>
              <h3 className="text-lg font-semibold text-on-surface">
                {t('users.deleteUser') || '删除用户'}
              </h3>
            </div>
            
            <p className="text-on-surface-muted mb-4">
              {t('users.deleteConfirm') || '确定要删除用户'} 
              <span className="font-medium text-on-surface"> {selectedUser.display_name}</span>?
              {t('users.deleteWarning') || '此操作无法撤销。'}
            </p>
            
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteDialog(false)}
                className="px-4 py-2.5 text-on-surface-secondary hover:bg-surface-container-high rounded-xl transition-all"
              >
                {t('common.cancel') || '取消'}
              </button>
              <button
                onClick={handleDeleteUser}
                disabled={formLoading}
                className="flex items-center gap-2 px-4 py-2.5 bg-error hover:bg-error/90 disabled:opacity-50 text-white rounded-xl transition-all"
              >
                {formLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('common.delete') || '删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Dialog */}
      {showResetPasswordDialog && selectedUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-2xl p-6 w-full max-w-md shadow-2xl border border-outline/20">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
                <Lock className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-on-surface">
                {t('users.resetPassword') || '重置密码'}
              </h3>
            </div>
            
            <p className="text-sm text-on-surface-muted mb-4">
              {t('users.resetPasswordFor') || '为'} 
              <span className="font-medium text-on-surface"> {selectedUser.display_name} </span>
              {t('users.setNewPassword') || '设置新密码'}
            </p>
            
            <div>
              <label className="block text-sm font-medium text-on-surface-secondary mb-1.5">
                {t('users.newPassword') || '新密码'}
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t('users.passwordPlaceholder') || '至少6位字符'}
                className="w-full px-4 py-2.5 bg-surface-container-lowest border border-outline/20 rounded-xl text-on-surface placeholder:text-on-surface-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
              />
            </div>
            
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowResetPasswordDialog(false)}
                className="px-4 py-2.5 text-on-surface-secondary hover:bg-surface-container-high rounded-xl transition-all"
              >
                {t('common.cancel') || '取消'}
              </button>
              <button
                onClick={handleResetPassword}
                disabled={formLoading || !newPassword}
                className="flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white rounded-xl transition-all"
              >
                {formLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('users.reset') || '重置'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
