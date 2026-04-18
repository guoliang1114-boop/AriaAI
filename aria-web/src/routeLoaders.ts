export const loadWelcome = () => import('./pages/Welcome')
export const loadChat = () => import('./pages/chat/Chat')
export const loadSkills = () => import('./pages/skills/Skills')
export const loadProjects = () => import('./pages/projects/Projects')
export const loadProjectDetail = () => import('./pages/projects/ProjectDetail')
export const loadNewProject = () => import('./pages/projects/NewProject')
export const loadKnowledge = () => import('./pages/knowledge/Knowledge')
export const loadClients = () => import('./pages/clients/Clients')
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
export const loadMessageSettings = () => import('./pages/settings/MessageSettings')
export const loadForbidden = () => import('./pages/Forbidden')
export const loadNotFound = () => import('./pages/NotFound')

export const primaryRouteLoaders: Record<string, () => Promise<unknown>> = {
  '/': loadWelcome,
  '/chat': loadChat,
  '/skills': loadSkills,
  '/projects': loadProjects,
  '/clients': loadClients,
  '/knowledge': loadKnowledge,
  '/messages': loadMessagesPage,
  '/settings': loadSettingsLayout,
}

export const warmPrimaryRoutes = () =>
  Promise.allSettled([
    loadChat(),
    loadSkills(),
    loadProjects(),
    loadClients(),
    loadKnowledge(),
    loadMessagesPage(),
    loadSettingsLayout(),
  ])
