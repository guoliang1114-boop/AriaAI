import { Suspense, lazy, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { CxTopProgress } from './components/codex'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { Layout } from './components/Layout'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Login } from './pages/Login'
import {
  loadPreferenceOnboarding,
  loadWorkspace,
  loadChat,
  loadSkills,
  loadProjects,
  loadProjectDetail,
  loadNewProject,
  loadKnowledge,
  loadClients,
  loadContacts,
  loadContactDetail,
  loadClientDetail,
  loadClientMemoryPage,
  loadMessagesPage,
  loadSettingsLayout,
  loadProfileSettings,
  loadPreferenceSettings,
  loadAppearanceSettings,
  loadAISettings,
  loadUsersSettings,
  loadServerSettings,
  loadLanguageSettings,
  loadAboutSettings,
  loadProjectMemorySettings,
  loadClientMemorySettings,
  loadMemoryOperationsSettings,
  loadApiLimitsSettings,
  loadMigrationSettings,
  loadMessageSettings,
  loadForbidden,
  loadNotFound,
  loadServiceDown,
} from './routeLoaders'

const PreferenceOnboarding = lazy(() =>
  loadPreferenceOnboarding().then((module) => ({ default: module.PreferenceOnboarding })),
)
const Workspace = lazy(() => loadWorkspace().then((module) => ({ default: module.Workspace })))
const Chat = lazy(() => loadChat().then((module) => ({ default: module.Chat })))
const Skills = lazy(() => loadSkills().then((module) => ({ default: module.Skills })))
const SkillDetailPage = lazy(() => loadSkills().then((module) => ({ default: module.SkillDetailPage })))
const Projects = lazy(() => loadProjects().then((module) => ({ default: module.Projects })))
const ProjectDetail = lazy(() => loadProjectDetail().then((module) => ({ default: module.ProjectDetail })))
const NewProject = lazy(() => loadNewProject().then((module) => ({ default: module.NewProject })))
const Knowledge = lazy(() => loadKnowledge().then((module) => ({ default: module.Knowledge })))
const Clients = lazy(() => loadClients().then((module) => ({ default: module.Clients })))
const Contacts = lazy(() => loadContacts().then((module) => ({ default: module.Contacts })))
const ContactDetail = lazy(() => loadContactDetail().then((module) => ({ default: module.ContactDetail })))
const ClientDetail = lazy(() => loadClientDetail().then((module) => ({ default: module.ClientDetail })))
const ClientMemoryPage = lazy(() => loadClientMemoryPage().then((module) => ({ default: module.ClientMemoryPage })))
const MessagesPage = lazy(() => loadMessagesPage().then((module) => ({ default: module.MessagesPage })))
const SettingsLayout = lazy(() => loadSettingsLayout().then((module) => ({ default: module.SettingsLayout })))
const ProfileSettings = lazy(() => loadProfileSettings().then((module) => ({ default: module.ProfileSettings })))
const PreferenceSettings = lazy(() =>
  loadPreferenceSettings().then((module) => ({ default: module.PreferenceSettings })),
)
const AppearanceSettings = lazy(() => loadAppearanceSettings().then((module) => ({ default: module.AppearanceSettings })))
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
const ApiLimitsSettings = lazy(() =>
  loadApiLimitsSettings().then((module) => ({ default: module.ApiLimitsSettings })),
)
const MigrationSettings = lazy(() =>
  loadMigrationSettings().then((module) => ({ default: module.MigrationSettings })),
)
const MessageSettings = lazy(() => loadMessageSettings().then((module) => ({ default: module.MessageSettings })))
const Forbidden = lazy(() => loadForbidden().then((module) => ({ default: module.Forbidden })))
const NotFound = lazy(() => loadNotFound().then((module) => ({ default: module.NotFound })))
const ServiceDown = lazy(() => loadServiceDown().then((module) => ({ default: module.ServiceDown })))

function RouteFallback() {
  // ``bg-surface`` + ``text-primary`` (MD3 light + V0.0.5 blue) used
  // to paint a white slab with a blue spinner here, which is what
  // showed up as a "white flash" inside the Codex shell when a lazy
  // route bundle was still downloading. Transparent now so the
  // shell's ``html`` background (set by the inline bootstrap script
  // in ``index.html``) shows through; the codex top progress bar
  // gives a "loading" cue without committing to a centered spinner.
  return (
    <div
      className="theme-codex flex h-full min-h-[240px] flex-col"
      style={{ background: 'var(--color-codex-bg)', color: 'var(--color-codex-ink)' }}
    >
      <CxTopProgress />
    </div>
  )
}

function LazyPage({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<RouteFallback />}>{children}</Suspense>
    </ErrorBoundary>
  )
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth()
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

function getStoredUserIsAdmin() {
  try {
    const raw = localStorage.getItem('user')
    if (!raw) return false
    const parsed = JSON.parse(raw) as { is_admin?: boolean }
    return !!parsed?.is_admin
  } catch {
    return false
  }
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  if (!getStoredUserIsAdmin()) {
    return <Navigate to="/403" replace />
  }
  return <>{children}</>
}

// Listens for ``api:service-down`` events fired by the API client
// when it sees a 503 response, and redirects the user to the
// ServiceDown page. Sits inside ``<BrowserRouter>`` (via AppRoutes)
// so it can use the navigation hooks; sits OUTSIDE any Auth guard so
// even unauthenticated users get bounced off a broken backend.
function ServiceDownRedirect() {
  const navigate = useNavigate()
  const location = useLocation()
  useEffect(() => {
    const onServiceDown = () => {
      // Don't bounce off /503 onto itself — also leaves /login and /403
      // alone since those don't depend on the API actually being up.
      if (location.pathname === '/503') return
      navigate('/503', { replace: true, state: { from: location.pathname } })
    }
    window.addEventListener('api:service-down', onServiceDown)
    return () => window.removeEventListener('api:service-down', onServiceDown)
  }, [navigate, location.pathname])
  return null
}

function AppRoutes() {
  return (
    <>
    <ServiceDownRedirect />
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/403"
        element={
          <LazyPage>
            <Forbidden />
          </LazyPage>
        }
      />
      <Route
        path="/503"
        element={
          <LazyPage>
            <ServiceDown />
          </LazyPage>
        }
      />
      <Route
        path="/onboarding"
        element={
          <AuthGuard>
            <LazyPage>
              <PreferenceOnboarding />
            </LazyPage>
          </AuthGuard>
        }
      />
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
              <Workspace />
            </LazyPage>
          }
        />
        <Route
          path="workspace"
          element={
            <LazyPage>
              <Workspace />
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
          path="skills/item/:skillId"
          element={
            <LazyPage>
              <SkillDetailPage />
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
          path="contacts"
          element={
            <LazyPage>
              <Contacts />
            </LazyPage>
          }
        />
        <Route
          path="contacts/:id"
          element={
            <LazyPage>
              <ContactDetail />
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
            path="preferences"
            element={
              <LazyPage>
                <PreferenceSettings />
              </LazyPage>
            }
          />
          <Route
            path="appearance"
            element={
              <LazyPage>
                <AppearanceSettings />
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
              <AdminGuard>
                <LazyPage>
                  <MemoryOperationsSettings />
                </LazyPage>
              </AdminGuard>
            }
          />
          <Route
            path="api-limits"
            element={
              <AdminGuard>
                <LazyPage>
                  <ApiLimitsSettings />
                </LazyPage>
              </AdminGuard>
            }
          />
          <Route
            path="migrations"
            element={
              <AdminGuard>
                <LazyPage>
                  <MigrationSettings />
                </LazyPage>
              </AdminGuard>
            }
          />
          <Route
            path="users"
            element={
              <AdminGuard>
                <LazyPage>
                  <UsersSettings />
                </LazyPage>
              </AdminGuard>
            }
          />
          <Route
            path="messages"
            element={
              <AdminGuard>
                <LazyPage>
                  <MessageSettings />
                </LazyPage>
              </AdminGuard>
            }
          />
          <Route
            path="server"
            element={
              <AdminGuard>
                <LazyPage>
                  <ServerSettings />
                </LazyPage>
              </AdminGuard>
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
          <Route
            path="*"
            element={
              <LazyPage>
                <NotFound />
              </LazyPage>
            }
          />
        </Route>
      </Route>
      <Route
        path="*"
        element={
          <LazyPage>
            <NotFound />
          </LazyPage>
        }
      />
    </Routes>
    </>
  )
}

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ErrorBoundary>
  )
}

export default App
