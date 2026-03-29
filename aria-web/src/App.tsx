import { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Login } from './pages/Login'
import { Welcome } from './pages/Welcome'
import { Chat } from './pages/chat/Chat'
import { Skills } from './pages/skills/Skills'
import { Projects } from './pages/projects/Projects'
import { ProjectDetail } from './pages/projects/ProjectDetail'
import { NewProject } from './pages/projects/NewProject'
import { Knowledge } from './pages/knowledge/Knowledge'
import { SettingsLayout } from './pages/settings/SettingsLayout'
import { ProfileSettings } from './pages/settings/ProfileSettings'
import { AISettings } from './pages/settings/AISettings'
import { UsersSettings } from './pages/settings/UsersSettings'
import { ServerSettings } from './pages/settings/ServerSettings'
import { LanguageSettings } from './pages/settings/LanguageSettings'
import { AboutSettings } from './pages/settings/AboutSettings'

// Auth Guard Component
function AuthGuard({ children, isAuthenticated }: { children: React.ReactNode; isAuthenticated: boolean }) {
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!localStorage.getItem('authToken'))

  useEffect(() => {
    const checkAuth = () => {
      setIsAuthenticated(!!localStorage.getItem('authToken'))
    }
    checkAuth()
    window.addEventListener('storage', checkAuth)
    return () => window.removeEventListener('storage', checkAuth)
  }, [])

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <AuthGuard isAuthenticated={isAuthenticated}>
            <Layout />
          </AuthGuard>
        }
      >
        <Route index element={<Welcome />} />
        <Route path="chat" element={<Chat />} />
        <Route path="skills" element={<Skills />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/new" element={<NewProject />} />
        <Route path="projects/:id" element={<ProjectDetail />} />
        <Route path="knowledge" element={<Knowledge />} />
        <Route path="settings" element={<SettingsLayout />}>
          <Route index element={<ProfileSettings />} />
          <Route path="ai" element={<AISettings />} />
          <Route path="users" element={<UsersSettings />} />
          <Route path="server" element={<ServerSettings />} />
          <Route path="language" element={<LanguageSettings />} />
          <Route path="about" element={<AboutSettings />} />
        </Route>
      </Route>
    </Routes>
  )
}

export default App
