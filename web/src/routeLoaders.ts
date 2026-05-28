export const loadWelcome = () => import('./pages/Welcome')
export const loadPreferenceOnboarding = () => import('./pages/PreferenceOnboarding')
export const loadWorkspace = () => import('./pages/Workspace')
export const loadChat = () => import('./pages/chat/Chat')
export const loadSkills = () => import('./pages/skills/Skills')
export const loadProjects = () => import('./pages/projects/Projects')
export const loadProjectDetail = () => import('./pages/projects/ProjectDetail')
export const loadNewProject = () => import('./pages/projects/NewProject')
export const loadKnowledge = () => import('./pages/knowledge/Knowledge')
export const loadClients = () => import('./pages/clients/Clients')
export const loadContacts = () => import('./pages/contacts/Contacts')
export const loadContactDetail = () => import('./pages/contacts/ContactDetail')
export const loadClientDetail = () => import('./pages/clients/ClientDetail')
export const loadClientMemoryPage = () => import('./pages/clients/ClientMemoryPage')
export const loadMessagesPage = () => import('./pages/messages/MessagesPage')
export const loadSettingsLayout = () => import('./pages/settings/SettingsLayout')
export const loadProfileSettings = () => import('./pages/settings/ProfileSettings')
export const loadAISettings = () => import('./pages/settings/AISettings')
export const loadUsersSettings = () => import('./pages/settings/UsersSettings')
export const loadServerSettings = () => import('./pages/settings/ServerSettings')
export const loadLanguageSettings = () => import('./pages/settings/LanguageSettings')
export const loadAboutSettings = () => import('./pages/settings/AboutSettings')
export const loadProjectMemorySettings = () => import('./pages/settings/ProjectMemorySettings')
export const loadClientMemorySettings = () => import('./pages/settings/ClientMemorySettings')
export const loadMemoryOperationsSettings = () => import('./pages/settings/MemoryOperationsSettings')
export const loadApiLimitsSettings = () => import('./pages/settings/ApiLimitsSettings')
export const loadMigrationSettings = () => import('./pages/settings/MigrationSettings')
export const loadMessageSettings = () => import('./pages/settings/MessageSettings')
export const loadForbidden = () => import('./pages/Forbidden')
export const loadNotFound = () => import('./pages/NotFound')

export const primaryRouteLoaders: Record<string, () => Promise<unknown>> = {
  '/': loadWorkspace,
  '/workspace': loadWorkspace,
  '/chat': loadChat,
  '/skills': loadSkills,
  '/projects': loadProjects,
  '/clients': loadClients,
  '/contacts': loadContacts,
  '/knowledge': loadKnowledge,
  '/messages': loadMessagesPage,
  '/settings': loadSettingsLayout,
}

export const warmPrimaryRoutes = () =>
  Promise.allSettled([
    loadWorkspace(),
    loadChat(),
    loadSkills(),
    loadProjects(),
    loadClients(),
    loadContacts(),
    loadKnowledge(),
    loadMessagesPage(),
    loadSettingsLayout(),
  ])
