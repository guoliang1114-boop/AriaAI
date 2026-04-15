import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Search, User, X } from 'lucide-react'

export interface ProjectUserPickerItem {
  id: number
  display_name: string
}

interface ProjectUserPickerProps {
  users: ProjectUserPickerItem[]
  value: number | null
  onChange: (userId: number | null) => void
  placeholder?: string
  disabled?: boolean
}

export function UserPicker({
  users,
  value,
  onChange,
  placeholder,
  disabled,
}: ProjectUserPickerProps) {
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
        className={`flex w-full items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm transition-colors ${
          disabled ? 'cursor-not-allowed bg-gray-100 opacity-50' : 'hover:border-gray-300'
        } ${open ? 'border-primary ring-1 ring-primary/20' : 'border-gray-200'}`}
      >
        <User className="h-4 w-4 text-gray-400" />
        <span
          className={`flex-1 truncate text-left ${
            selectedUser ? 'text-gray-900' : 'text-gray-400'
          }`}
        >
          {selectedUser
            ? selectedUser.display_name
            : placeholder || (isZh ? '选择负责人' : 'Assign to')}
        </span>
        {selectedUser ? (
          <span
            onClick={(e) => {
              e.stopPropagation()
              onChange(null)
            }}
            className="rounded p-0.5 text-gray-400 hover:bg-gray-100"
          >
            <X className="h-3.5 w-3.5" />
          </span>
        ) : (
          <ChevronDown className="h-4 w-4 text-gray-400" />
        )}
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="border-b border-gray-100 px-3 py-2">
            <div className="flex items-center gap-2 rounded-md bg-gray-50 px-2 py-1.5">
              <Search className="h-3.5 w-3.5 text-gray-400" />
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
              <div className="px-3 py-2 text-center text-sm text-gray-400">
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
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                    value === u.id ? 'bg-primary/5 font-medium text-primary' : 'text-gray-700'
                  }`}
                >
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-xs text-gray-500">
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
