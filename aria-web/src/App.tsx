import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { Layout } from './components/Layout'
import { Login } from './pages/Login'
import {
  loadWelcome,
  loadChat,
  loadSkills,
  loadProjects,
  loadProjectDetail,
  loadNewProject,
  loadKnowledge,
  loadClients,
  loadClientDetail,
  loadClientMemoryPage,
  loadMessagesPage,
  loadSettingsLayout,
  loadProfileSettings,
  loadAISettings,
  loadUsersSettings,
  loadServerSettings,
  loadLanguageSettings,
  loadAboutSettings,
  loadProjectMemorySettings,
  loadClientMemorySettings,
  loadMemoryOperationsSettings,
  loadMessageSettings,
} from './routeLoaders'

const Welcome = lazy(() => loadWelcome().then((module) => ({ default: module.Welcome })))
const Chat = lazy(() => loadChat().then((module) => ({ default: module.Chat })))
const Skills = lazy(() => loadSkills().then((module) => ({ default: module.Skills })))
const Projects = lazy(() => loadProjects().then((module) => ({ default: module.Projects })))
const ProjectDetail = lazy(() => loadProjectDetail().then((module) => ({ default: module.ProjectDetail })))
const NewProject = lazy(() => loadNewProject().then((module) => ({ default: module.NewProject })))
const Knowledge = lazy(() => loadKnowledge().then((module) => ({ default: module.Knowledge })))
const Clients = lazy(() => loadClients().then((module) => ({ default: module.Clients })))
const ClientDetail = lazy(() => loadClientDetail().then((module) => ({ default: module.ClientDetail })))
const ClientMemoryPage = lazy(() => loadClientMemoryPage().then((module) => ({ default: module.ClientMemoryPage })))
const MessagesPage = lazy(() => loadMessagesPage().then((module) => ({ default: module.MessagesPage })))
const SettingsLayout = lazy(() => loadSettingsLayout().then((module) => ({ default: module.SettingsLayout })))
const ProfileSettings = lazy(() => loadProfileSettings().then((module) => ({ default: module.ProfileSettings })))
const AISettings = lazy(() => loadAISettings().then((module) => ({ default: module.AISettings })))
const UsersSettings = lazy(() => loadUsersSettings().then((module) => ({ default: module.UsersSettings })))
const ServerSettings = lazy(() => loadServerSettings().then((module) => ({ default: module.ServerSettings })))
const LanguageSettings = lazy(() => loadLanguageSettings().then((module) => ({ default: module.LanguageSettings })))
const AboutSettings = lazy(() => loadAboutSettings().then((module) => ({ default: module.AboutSettings })))
const ProjectMemorySettings = lazy(() =>
  loadProjectMemorySettings().then((module) => ({ default: module.ProjectMemorySettings })),
)
const ClientMemorySettings = lazy(() =>
  loadClientMemorySettings().then((module) => ({ default: module.ClientMemorySettings })),
)
const MemoryOperationsSettings = lazy(() =>
  loadMemoryOperationsSettings().then((module) => ({ default: module.MemoryOperationsSettings })),
)
const MessageSettings = lazy(() => loadMessageSettings().then((module) => ({ default: module.MessageSettings })))

function RouteFallback() {
  return (
    <div className="flex h-full min-h-[240px] items-center justify-center bg-surface">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  )
}

function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>
}

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
        <Route
          index
          element={
            <LazyPage>
              <Welcome />
            </LazyPage>
          }
        />
        <Route
          path="chat"
          element={
            <LazyPage>
              <Chat />
            </LazyPage>
          }
        />
        <Route
          path="skills"
          element={
            <LazyPage>
              <Skills />
            </LazyPage>
          }
        />
        <Route
          path="projects"
          element={
            <LazyPage>
              <Projects />
            </LazyPage>
          }
        />
        <Route
          path="projects/new"
          element={
            <LazyPage>
              <NewProject />
            </LazyPage>
          }
        />
        <Route
          path="projects/:id/*"
          element={
            <LazyPage>
              <ProjectDetail />
            </LazyPage>
          }
        />
        <Route
          path="knowledge"
          element={
            <LazyPage>
              <Knowledge />
            </LazyPage>
          }
        />
        <Route
          path="messages"
          element={
            <LazyPage>
              <MessagesPage />
            </LazyPage>
          }
        />
        <Route
          path="clients"
          element={
            <LazyPage>
              <Clients />
            </LazyPage>
          }
        />
        <Route
          path="clients/:id"
          element={
            <LazyPage>
              <ClientDetail />
            </LazyPage>
          }
        />
        <Route
          path="clients/:id/memory"
          element={
            <LazyPage>
              <ClientMemoryPage />
            </LazyPage>
          }
        />
        <Route
          path="settings"
          element={
            <LazyPage>
              <SettingsLayout />
            </LazyPage>
          }
        >
          <Route
            index
            element={
              <LazyPage>
                <ProfileSettings />
              </LazyPage>
            }
          />
          <Route
            path="ai"
            element={
              <LazyPage>
                <AISettings />
              </LazyPage>
            }
          />
          <Route
            path="memory"
            element={
              <LazyPage>
                <ProjectMemorySettings />
              </LazyPage>
            }
          />
          <Route
            path="client-memory"
            element={
              <LazyPage>
                <ClientMemorySettings />
              </LazyPage>
            }
          />
          <Route
            path="memory-ops"
            element={
              <LazyPage>
                <MemoryOperationsSettings />
              </LazyPage>
            }
          />
          <Route
            path="users"
            element={
              <LazyPage>
                <UsersSettings />
              </LazyPage>
            }
          />
          <Route
            path="messages"
            element={
              <LazyPage>
                <MessageSettings />
              </LazyPage>
            }
          />
          <Route
            path="server"
            element={
              <LazyPage>
                <ServerSettings />
              </LazyPage>
            }
          />
          <Route
            path="language"
            element={
              <LazyPage>
                <LanguageSettings />
              </LazyPage>
            }
          />
          <Route
            path="about"
            element={
              <LazyPage>
                <AboutSettings />
              </LazyPage>
            }
          />
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
