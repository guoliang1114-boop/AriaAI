import { useState, useEffect } from 'react'
import { User, Mail, KeyRound, Check, Loader2, AlertCircle, X, Lock, Clock3, Type } from 'lucide-react'
import { api } from '../../api/client'
import type { User as UserType } from '../../types/api'
import { BROWSER_TIMEZONE_VALUE, DEFAULT_APP_TIMEZONE, getBrowserTimeZone, setAppTimeZone } from '../../utils/timezone'
import {
  APP_FONT_SIZE_SETTING_KEY,
  getStoredAppFontSize,
  isAppFontSize,
  setAppFontSize,
  type AppFontSize,
} from '../../utils/fontSize'

const fontSizeOptions: { value: AppFontSize; label: string; previewClass: string }[] = [
  { value: 'small', label: '小', previewClass: 'text-[13px]' },
  { value: 'medium', label: '中', previewClass: 'text-[15px]' },
  { value: 'large', label: '大', previewClass: 'text-[17px]' },
]

const timezoneOptions = [
  { value: 'Asia/Shanghai', label: '中国标准时间', hint: 'UTC+08:00' },
  { value: BROWSER_TIMEZONE_VALUE, label: '跟随浏览器', hint: '' },
  { value: 'UTC', label: '协调世界时', hint: 'UTC+00:00' },
  { value: 'Asia/Tokyo', label: '日本标准时间', hint: 'UTC+09:00' },
  { value: 'America/Los_Angeles', label: '洛杉矶时间', hint: 'UTC-08:00 / -07:00' },
  { value: 'America/New_York', label: '纽约时间', hint: 'UTC-05:00 / -04:00' },
  { value: 'Europe/London', label: '伦敦时间', hint: 'UTC+00:00 / +01:00' },
]

export function ProfileSettings() {
  const [user, setUser] = useState<UserType | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameMsg, setNameMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [selectedTimeZone, setSelectedTimeZone] = useState(DEFAULT_APP_TIMEZONE)
  const [savingTimeZone, setSavingTimeZone] = useState(false)
  const [timeZoneMsg, setTimeZoneMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [selectedFontSize, setSelectedFontSize] = useState<AppFontSize>(getStoredAppFontSize)
  const [savingFontSize, setSavingFontSize] = useState(false)
  const [fontSizeMsg, setFontSizeMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Password dialog state
  const [showPasswordDialog, setShowPasswordDialog] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPwd, setSavingPwd] = useState(false)
  const [pwdMsg, setPwdMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    Promise.all([
      api.get<UserType>('/auth/me'),
      api.get<Record<string, string>>('/settings/').catch(() => ({} as Record<string, string>)),
    ]).then(([u, settings]) => {
      setUser(u)
      setDisplayName(u.display_name)
      setSelectedTimeZone(settings.timezone || DEFAULT_APP_TIMEZONE)
      const remoteFontSize = settings[APP_FONT_SIZE_SETTING_KEY]
      if (isAppFontSize(remoteFontSize)) {
        // Sync the server value down to this device (apply + persist locally).
        setSelectedFontSize(remoteFontSize)
        setAppFontSize(remoteFontSize)
      }
    }).catch(() => {})
  }, [])

  const handleSelectFontSize = (value: AppFontSize) => {
    setSelectedFontSize(value)
    setAppFontSize(value) // live preview + local persistence
    setFontSizeMsg(null)
  }

  const handleSaveFontSize = async () => {
    setSavingFontSize(true)
    setFontSizeMsg(null)
    try {
      await api.put(`/settings/${APP_FONT_SIZE_SETTING_KEY}`, { value: selectedFontSize })
      setAppFontSize(selectedFontSize)
      setFontSizeMsg({ type: 'success', text: '字体大小已保存' })
      setTimeout(() => setFontSizeMsg(null), 3000)
    } catch (err: any) {
      setFontSizeMsg({ type: 'error', text: err.response?.data?.detail || '保存字体大小失败' })
    } finally {
      setSavingFontSize(false)
    }
  }

  const handleSaveName = async () => {
    if (!user || !displayName.trim()) return
    setSavingName(true)
    setNameMsg(null)
    try {
      await api.patch(`/auth/users/${user.id}`, { display_name: displayName.trim() })
      setNameMsg({ type: 'success', text: '已保存' })
      setTimeout(() => setNameMsg(null), 3000)
    } catch (err: any) {
      setNameMsg({ type: 'error', text: err.response?.data?.detail || '保存失败' })
    } finally {
      setSavingName(false)
    }
  }

  const handleSaveTimeZone = async () => {
    setSavingTimeZone(true)
    setTimeZoneMsg(null)
    try {
      await api.put('/settings/timezone', { value: selectedTimeZone })
      setAppTimeZone(selectedTimeZone)
      setTimeZoneMsg({ type: 'success', text: '时区已保存' })
      setTimeout(() => setTimeZoneMsg(null), 3000)
    } catch (err: any) {
      setTimeZoneMsg({ type: 'error', text: err.response?.data?.detail || '保存时区失败' })
    } finally {
      setSavingTimeZone(false)
    }
  }

  const openPasswordDialog = () => {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setPwdMsg(null)
    setShowPasswordDialog(true)
  }

  const closePasswordDialog = () => {
    if (savingPwd) return
    setShowPasswordDialog(false)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setPwdMsg(null)
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      setPwdMsg({ type: 'error', text: '两次输入的新密码不一致' })
      return
    }
    if (newPassword.length < 6) {
      setPwdMsg({ type: 'error', text: '新密码至少需要6位' })
      return
    }
    setSavingPwd(true)
    setPwdMsg(null)
    try {
      await api.post('/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPwdMsg({ type: 'success', text: '密码已修改成功' })
      setTimeout(() => {
        setShowPasswordDialog(false)
        setPwdMsg(null)
      }, 1500)
    } catch (err: any) {
      setPwdMsg({ type: 'error', text: err.response?.data?.detail || '修改密码失败' })
    } finally {
      setSavingPwd(false)
    }
  }

  const inputCls = 'w-full px-4 py-2.5 bg-surface-container-lowest border border-outline/20 rounded-xl text-on-surface placeholder:text-on-surface-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all'

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-label-lg text-on-surface mb-1">个人信息</h2>
        <p className="text-body-sm text-on-surface-muted">管理你的个人资料</p>
      </div>

      {/* Profile Card */}
      <div className="card space-y-4">
        {/* Avatar placeholder */}
        <div className="flex items-center gap-4 pb-4 border-b border-outline/10">
          <div className="w-14 h-14 rounded-full bg-gradient-primary flex items-center justify-center text-white font-semibold text-lg">
            {displayName ? displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : <User className="w-6 h-6" />}
          </div>
          <div>
            <p className="font-medium text-on-surface">{displayName || '—'}</p>
            <p className="text-sm text-on-surface-muted">{user?.email || '…'}</p>
          </div>
        </div>

        {/* Display Name */}
        <div className="space-y-2">
          <label className="text-label-sm text-on-surface-muted flex items-center gap-1.5">
            <User className="w-3.5 h-3.5" />
            显示名称
          </label>
          <div className="flex gap-3">
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="你的显示名称"
              className={inputCls + ' flex-1'}
            />
            <button
              onClick={handleSaveName}
              disabled={savingName || displayName.trim() === (user?.display_name ?? '')}
              className="btn-primary flex items-center gap-2 px-4 disabled:opacity-40"
            >
              {savingName ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              保存
            </button>
          </div>
          {nameMsg && (
            <p className={`text-xs flex items-center gap-1 ${nameMsg.type === 'success' ? 'text-active' : 'text-error'}`}>
              {nameMsg.type === 'error' && <AlertCircle className="w-3 h-3" />}
              {nameMsg.text}
            </p>
          )}
        </div>

        {/* Email (read-only) */}
        <div className="space-y-2">
          <label className="text-label-sm text-on-surface-muted flex items-center gap-1.5">
            <Mail className="w-3.5 h-3.5" />
            邮箱地址
          </label>
          <input
            type="email"
            value={user?.email ?? ''}
            readOnly
            className={inputCls + ' opacity-60 cursor-not-allowed'}
          />
        </div>

        <div className="space-y-2">
          <label className="text-label-sm text-on-surface-muted flex items-center gap-1.5">
            <Clock3 className="w-3.5 h-3.5" />
            时区
          </label>
          <div className="flex gap-3">
            <select
              value={selectedTimeZone}
              onChange={(e) => setSelectedTimeZone(e.target.value)}
              className={inputCls + ' flex-1'}
            >
              {timezoneOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                  {option.value === BROWSER_TIMEZONE_VALUE ? `（当前：${getBrowserTimeZone()}）` : option.hint ? `（${option.hint}）` : ''}
                </option>
              ))}
            </select>
            <button
              onClick={handleSaveTimeZone}
              disabled={savingTimeZone}
              className="btn-primary flex items-center gap-2 px-4 disabled:opacity-40"
            >
              {savingTimeZone ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              保存
            </button>
          </div>
          <p className="text-xs text-on-surface-muted">
            默认使用北京时间（UTC+08:00）。对话、项目、知识库和任务记录等时间显示会优先使用这里的时区。
          </p>
          {timeZoneMsg && (
            <p className={`text-xs flex items-center gap-1 ${timeZoneMsg.type === 'success' ? 'text-active' : 'text-error'}`}>
              {timeZoneMsg.type === 'error' && <AlertCircle className="w-3 h-3" />}
              {timeZoneMsg.text}
            </p>
          )}
        </div>

        {/* Font size */}
        <div className="space-y-2">
          <label className="text-label-sm text-on-surface-muted flex items-center gap-1.5">
            <Type className="w-3.5 h-3.5" />
            字体大小
          </label>
          <div className="flex gap-3">
            <div className="flex flex-1 gap-2 rounded-xl border border-outline/20 bg-surface-container-lowest p-1">
              {fontSizeOptions.map((option) => {
                const active = selectedFontSize === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleSelectFontSize(option.value)}
                    aria-pressed={active}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 transition-all ${
                      active
                        ? 'bg-primary text-white shadow-sm'
                        : 'text-on-surface-variant hover:bg-surface-container-low'
                    }`}
                  >
                    <span className={option.previewClass}>Aa</span>
                    <span className="text-sm font-medium">{option.label}</span>
                  </button>
                )
              })}
            </div>
            <button
              onClick={handleSaveFontSize}
              disabled={savingFontSize}
              className="btn-primary flex items-center gap-2 px-4 disabled:opacity-40"
            >
              {savingFontSize ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              保存
            </button>
          </div>
          <p className="text-xs text-on-surface-muted">
            调整后整个界面的文字会按比例缩放，点击即可即时预览，保存后在其他设备同步。默认为「中」。
          </p>
          {fontSizeMsg && (
            <p className={`text-xs flex items-center gap-1 ${fontSizeMsg.type === 'success' ? 'text-active' : 'text-error'}`}>
              {fontSizeMsg.type === 'error' && <AlertCircle className="w-3 h-3" />}
              {fontSizeMsg.text}
            </p>
          )}
        </div>
      </div>

      {/* Password Card */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-label-lg text-on-surface flex items-center gap-2 mb-1">
              <KeyRound className="w-4 h-4 text-primary" />
              密码安全
            </h3>
            <p className="text-body-sm text-on-surface-muted">定期更换密码可以保护你的账户安全</p>
          </div>
          <button
            onClick={openPasswordDialog}
            className="btn-secondary flex items-center gap-2"
          >
            <Lock className="w-4 h-4" />
            修改密码
          </button>
        </div>
      </div>

      {/* Password Change Dialog */}
      {showPasswordDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-container-lowest rounded-2xl w-full max-w-md shadow-2xl border border-outline/10 overflow-hidden">
            {/* Dialog Header */}
            <div className="px-6 py-4 border-b border-outline/10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Lock className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-on-surface">修改密码</h3>
                  <p className="text-xs text-on-surface-muted">请输入当前密码和新密码</p>
                </div>
              </div>
              <button
                onClick={closePasswordDialog}
                disabled={savingPwd}
                className="p-2 rounded-xl hover:bg-surface-container-low text-on-surface-muted transition-colors disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Dialog Content */}
            <form onSubmit={handleChangePassword} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-label-sm text-on-surface-muted">当前密码</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="请输入当前密码"
                  className={inputCls}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-label-sm text-on-surface-muted">新密码</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="至少6位"
                  className={inputCls}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-label-sm text-on-surface-muted">确认新密码</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="再次输入新密码"
                  className={inputCls}
                  required
                />
              </div>
              
              {pwdMsg && (
                <div className={`p-3 rounded-xl flex items-center gap-2 ${
                  pwdMsg.type === 'success' 
                    ? 'bg-success/10 text-success border border-success/20' 
                    : 'bg-error/10 text-error border border-error/20'
                }`}>
                  {pwdMsg.type === 'error' ? (
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  ) : (
                    <Check className="w-4 h-4 flex-shrink-0" />
                  )}
                  <p className="text-sm">{pwdMsg.text}</p>
                </div>
              )}

              {/* Dialog Footer */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closePasswordDialog}
                  disabled={savingPwd}
                  className="px-4 py-2.5 text-on-surface-muted hover:bg-surface-container-low rounded-xl transition-colors disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={savingPwd || !currentPassword || !newPassword || !confirmPassword}
                  className="flex items-center gap-2 px-6 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white rounded-xl font-medium transition-all"
                >
                  {savingPwd ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      修改中...
                    </>
                  ) : (
                    <>
                      <KeyRound className="w-4 h-4" />
                      确认修改
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
