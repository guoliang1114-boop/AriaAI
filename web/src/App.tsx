import { Suspense, lazy, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { CxTopProgress } from './components/codex'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { useToast } from './contexts/ToastContext'
import { Layout } from './components/Layout'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Login } from './pages/Login'
import {
  loadPreferenceOnboarding,
  loadWorkspace,
  loadWeekly,
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
const WeeklyFocus = lazy(() => loadWeekly().then((module) => ({ default: module.WeeklyFocus })))
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

function SettingsRouteFallback() {
  return (
    <div
      className="theme-codex"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1,
        background: 'var(--color-codex-bg)',
        color: 'var(--color-codex-ink)',
      }}
    >
      <CxTopProgress />
    </div>
  )
}

function SettingsLazyPage({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<SettingsRouteFallback />}>{children}</Suspense>
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

// Mirrors ServiceDownRedirect for the project membership 403 case
// (R73). The api client fires ``aria:project-access-denied`` when a
// /projects/{id}/* request returns 403 — the listener toasts the
// reason and bounces the user back to /projects. Lives outside the
// project route subtree so it stays mounted across navigations.
function ProjectAccessDeniedRedirect() {
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  useEffect(() => {
    const onDenied = (event: Event) => {
      // Already on the project list — no need to bounce or toast
      // (the list itself filters to memberships, so the user just
      // sees an empty/sparse view).
      if (
        location.pathname === '/projects' ||
        location.pathname.startsWith('/projects/new')
      ) {
        return
      }
      const detail = (event as CustomEvent<{ projectId?: string }>).detail
      toast.warning({
        title: '无权访问该项目',
        description: detail?.projectId
          ? `项目 #${detail.projectId} 不在你的团队中,已返回项目列表。`
          : '该项目不在你的团队中,已返回项目列表。',
      })
      navigate('/projects', { replace: true })
    }
    window.addEventListener('aria:project-access-denied', onDenied)
    return () =>
      window.removeEventListener('aria:project-access-denied', onDenied)
  }, [navigate, location.pathname, toast])
  return null
}

function AppRoutes() {
  return (
    <>
    <ServiceDownRedirect />
    <ProjectAccessDeniedRedirect />
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
          path="weekly"
          element={
            <LazyPage>
              <WeeklyFocus />
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
              <SettingsLazyPage>
                <ProfileSettings />
              </SettingsLazyPage>
            }
          />
          <Route
            path="preferences"
            element={
              <SettingsLazyPage>
                <PreferenceSettings />
              </SettingsLazyPage>
            }
          />
          <Route
            path="appearance"
            element={
              <SettingsLazyPage>
                <AppearanceSettings />
              </SettingsLazyPage>
            }
          />
          <Route
            path="ai"
            element={
              <SettingsLazyPage>
                <AISettings />
              </SettingsLazyPage>
            }
          />
          <Route
            path="memory"
            element={
              <SettingsLazyPage>
                <ProjectMemorySettings />
              </SettingsLazyPage>
            }
          />
          <Route
            path="client-memory"
            element={
              <SettingsLazyPage>
                <ClientMemorySettings />
              </SettingsLazyPage>
            }
          />
          <Route
            path="memory-ops"
            element={
              <AdminGuard>
                <SettingsLazyPage>
                  <MemoryOperationsSettings />
                </SettingsLazyPage>
              </AdminGuard>
            }
          />
          <Route
            path="api-limits"
            element={
              <AdminGuard>
                <SettingsLazyPage>
                  <ApiLimitsSettings />
                </SettingsLazyPage>
              </AdminGuard>
            }
          />
          <Route
            path="migrations"
            element={
              <AdminGuard>
                <SettingsLazyPage>
                  <MigrationSettings />
                </SettingsLazyPage>
              </AdminGuard>
            }
          />
          <Route
            path="users"
            element={
              <AdminGuard>
                <SettingsLazyPage>
                  <UsersSettings />
                </SettingsLazyPage>
              </AdminGuard>
            }
          />
          <Route
            path="messages"
            element={
              <AdminGuard>
                <SettingsLazyPage>
                  <MessageSettings />
                </SettingsLazyPage>
              </AdminGuard>
            }
          />
          <Route
            path="server"
            element={
              <AdminGuard>
                <SettingsLazyPage>
                  <ServerSettings />
                </SettingsLazyPage>
              </AdminGuard>
            }
          />
          <Route
            path="language"
            element={
              <SettingsLazyPage>
                <LanguageSettings />
              </SettingsLazyPage>
            }
          />
          <Route
            path="about"
            element={
              <SettingsLazyPage>
                <AboutSettings />
              </SettingsLazyPage>
            }
          />
          <Route
            path="*"
            element={
              <SettingsLazyPage>
                <NotFound />
              </SettingsLazyPage>
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
