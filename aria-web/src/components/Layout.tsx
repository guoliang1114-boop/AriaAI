import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { 
  LayoutDashboard, 
  MessageSquare, 
  Wrench, 
  FolderKanban, 
  BookOpen,
  Search,
  Bell,
  User,
  LogOut
} from 'lucide-react'
import { useState } from 'react'

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/chat', label: 'Chat', icon: MessageSquare },
  { path: '/skills', label: 'Skills Hub', icon: Wrench },
  { path: '/projects', label: 'Projects', icon: FolderKanban },
  { path: '/knowledge', label: 'Knowledge Base', icon: BookOpen },
]

export function Layout() {
  const location = useLocation()
  const [showUserMenu, setShowUserMenu] = useState(false)

  const handleLogout = () => {
    localStorage.removeItem('authToken')
    window.location.href = '/login'
  }

  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Glassmorphism Top Navigation */}
      <header className="glass sticky top-0 z-50 border-b border-outline/10">
        <div className="flex items-center justify-between px-6 h-16">
          {/* Logo */}
          <div className="flex items-center gap-8">
            <NavLink to="/" className="flex items-center gap-2">
              <span className="font-manrope text-xl font-bold text-primary">
                Aria AI
              </span>
            </NavLink>
            
            {/* Main Navigation */}
            <nav className="hidden md:flex items-center gap-1">
              {navItems.map((item) => {
                const isActive = location.pathname === item.path || 
                  (item.path !== '/' && location.pathname.startsWith(item.path))
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      isActive
                        ? 'text-primary bg-secondary-container/50'
                        : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low'
                    }`}
                  >
                    {item.label}
                  </NavLink>
                )
              })}
            </nav>
          </div>

          {/* Right Section */}
          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-surface-container-lowest rounded-xl w-64">
              <Search className="w-4 h-4 text-on-surface-muted" />
              <input
                type="text"
                placeholder="Search insights..."
                className="flex-1 bg-transparent text-sm text-on-surface placeholder:text-on-surface-muted outline-none"
              />
            </div>

            {/* Notifications */}
            <button className="relative p-2 rounded-xl hover:bg-surface-container-low transition-colors">
              <Bell className="w-5 h-5 text-on-surface-variant" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-tertiary rounded-full"></span>
            </button>

            {/* User Menu */}
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="w-9 h-9 rounded-full bg-gradient-primary flex items-center justify-center text-white font-medium text-sm"
              >
                <User className="w-5 h-5" />
              </button>
              
              {showUserMenu && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-surface-container-lowest rounded-xl shadow-lg border border-outline/10 py-2 animate-fade-in">
                  <div className="px-4 py-2 border-b border-outline/10">
                    <p className="text-sm font-medium text-on-surface">Consultant</p>
                    <p className="text-xs text-on-surface-muted">consultant@aria.ai</p>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-on-surface-variant hover:bg-surface-container-low transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
