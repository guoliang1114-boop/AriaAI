import { useState } from 'react'
import { User, Mail, Check, Camera } from 'lucide-react'

export function ProfileSettings() {
  const [formData, setFormData] = useState({
    displayName: 'User',
    email: 'user@example.com',
    avatar: '',
  })
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">个人信息</h2>
      <p className="text-sm text-[var(--color-text-muted)] mb-6">管理你的个人资料</p>

      <div className="space-y-6">
        {/* Avatar */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-3">
            头像
          </label>
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 bg-[var(--color-accent-50)] rounded-2xl flex items-center justify-center">
              <User className="w-10 h-10 text-[var(--color-accent-600)]" />
            </div>
            <button className="flex items-center gap-2 px-4 py-2.5 border border-[var(--color-border-default)] rounded-lg hover:bg-[var(--color-bg-tertiary)] transition-all text-[var(--color-text-secondary)]">
              <Camera className="w-4 h-4" />
              更换头像
            </button>
          </div>
        </div>

        {/* Display Name */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
            显示名称
          </label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-tertiary)]" />
            <input
              type="text"
              value={formData.displayName}
              onChange={(e) => handleChange('displayName', e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)]/20 focus:border-[var(--color-accent-500)] transition-all"
            />
          </div>
        </div>

        {/* Email */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
            邮箱地址
          </label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-tertiary)]" />
            <input
              type="email"
              value={formData.email}
              onChange={(e) => handleChange('email', e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)]/20 focus:border-[var(--color-accent-500)] transition-all"
            />
          </div>
        </div>

        {/* Save Button */}
        <div className="pt-4 border-t border-[var(--color-border-default)]">
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2.5 bg-[var(--color-accent-600)] hover:bg-[var(--color-accent-700)] text-white rounded-lg font-medium transition-all"
          >
            {saved ? (
              <>
                <Check className="w-4 h-4" />
                已保存
              </>
            ) : (
              '保存更改'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
