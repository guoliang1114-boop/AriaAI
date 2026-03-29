import { NavLink, useNavigate } from 'react-router-dom'
import { 
  MessageSquare, 
  Wrench, 
  FolderKanban, 
  BookOpen, 
  Clock,
  Plus,
  Settings,
  LogOut,
  Sparkles
} from 'lucide-react'

const navItems = [
  { path: '/chat', icon: MessageSquare, label: '对话' },
  { path: '/skills', icon: Wrench, label: '技能中心' },
  { path: '/projects', icon: FolderKanban, label: '项目空间' },
  { path: '/knowledge', icon: BookOpen, label: '知识库' },
  { path: '/tasks', icon: Clock, label: '定时任务' },
]

export function Sidebar() {
  const navigate = useNavigate()

  const handleLogout = () => {
    localStorage.removeItem('authToken')
    navigate('/login')
  }

  return (
    <aside className="w-56 h-full bg-gray-50 border-r border-gray-200 flex flex-col">
      {/* Header */}
      <div className="h-14 flex items-center px-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-primary-600 rounded-lg flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-gray-900">AriaAI</span>
        </div>
      </div>

      {/* New Task Button */}
      <div className="p-3">
        <button 
          onClick={() => navigate('/chat')}
          className="w-full flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all"
        >
          <Plus className="w-4 h-4" />
          新任务
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
                isActive
                  ? 'bg-primary-50 text-primary-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`
            }
          >
            <item.icon className="w-4 h-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Bottom Actions */}
      <div className="p-3 border-t border-gray-200 space-y-1">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
              isActive
                ? 'bg-primary-50 text-primary-700 font-medium'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            }`
          }
        >
          <Settings className="w-4 h-4" />
          设置
        </NavLink>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-all"
        >
          <LogOut className="w-4 h-4" />
          退出登录
        </button>
      </div>
    </aside>
  )
}
