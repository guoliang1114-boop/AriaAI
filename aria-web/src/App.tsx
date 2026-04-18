import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { Layout } from './components/Layout'
import { Login } from './pages/Login'
import { Welcome } from './pages/Welcome'
import { Chat } from './pages/chat/Chat'
import { Skills } from './pages/skills/Skills'
import { Projects } from './pages/projects/Projects'
import { ProjectDetail } from './pages/projects/ProjectDetail'
import { NewProject } from './pages/projects/NewProject'
import { Knowledge } from './pages/knowledge/Knowledge'
import { Clients } from './pages/clients/Clients'
import { ClientDetail } from './pages/clients/ClientDetail'
import { ClientMemoryPage } from './pages/clients/ClientMemoryPage'
import { MessagesPage } from './pages/messages/MessagesPage'
import { SettingsLayout } from './pages/settings/SettingsLayout'
import { ProfileSettings } from './pages/settings/ProfileSettings'
import { AISettings } from './pages/settings/AISettings'
import { UsersSettings } from './pages/settings/UsersSettings'
import { ServerSettings } from './pages/settings/ServerSettings'
import { LanguageSettings } from './pages/settings/LanguageSettings'
import { AboutSettings } from './pages/settings/AboutSettings'
import { ProjectMemorySettings } from './pages/settings/ProjectMemorySettings'
import { ClientMemorySettings } from './pages/settings/ClientMemorySettings'
import { MessageSettings } from './pages/settings/MessageSettings'

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth()
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <AuthGuard>
            <Layout />
          </AuthGuard>
        }
      >
        <Route index element={<Welcome />} />
        <Route path="chat" element={<Chat />} />
        <Route path="skills" element={<Skills />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/new" element={<NewProject />} />
        <Route path="projects/:id/*" element={<ProjectDetail />} />
        <Route path="knowledge" element={<Knowledge />} />
        <Route path="messages" element={<MessagesPage />} />
        <Route path="clients" element={<Clients />} />
        <Route path="clients/:id" element={<ClientDetail />} />
        <Route path="clients/:id/memory" element={<ClientMemoryPage />} />
        <Route path="settings" element={<SettingsLayout />}>
          <Route index element={<ProfileSettings />} />
          <Route path="ai" element={<AISettings />} />
          <Route path="memory" element={<ProjectMemorySettings />} />
          <Route path="client-memory" element={<ClientMemorySettings />} />
          <Route path="users" element={<UsersSettings />} />
          <Route path="messages" element={<MessageSettings />} />
          <Route path="server" element={<ServerSettings />} />
          <Route path="language" element={<LanguageSettings />} />
          <Route path="about" element={<AboutSettings />} />
        </Route>
      </Route>
    </Routes>
  )
}

function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}

export default App
