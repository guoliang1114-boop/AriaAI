import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { api } from '../../api/client'
import { PageTitle } from '../../components/PageTitle'
import { type ProjectPhase } from '../../types/enums'
import type { Project } from '../../types/api'
import { ProjectsHeader } from './ProjectsHeader'
import { PHASES, ProjectsPhaseSection, getProjectPhase } from './ProjectsPhaseSection'

export function Projects() {
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState<Project[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedPhase, setExpandedPhase] = useState<ProjectPhase | null>('business')
  const [users, setUsers] = useState<Array<{ id: number; display_name: string }>>([])
  const [isLoadingUsers, setIsLoadingUsers] = useState(false)
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null)

  useEffect(() => {
    fetchProjects()
  }, [selectedMemberId])

  useEffect(() => {
    let cancelled = false
    setIsLoadingUsers(true)
    api
      .get<Array<{ id: number; display_name: string }>>('/auth/users/simple')
      .then((data) => {
        if (!cancelled) setUsers(data)
      })
      .catch((error) => console.error('Failed to load users:', error))
      .finally(() => {
        if (!cancelled) setIsLoadingUsers(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const fetchProjects = async () => {
    try {
      setLoading(true)
      const url =
        selectedMemberId != null
          ? `/projects?member_user_id=${selectedMemberId}`
          : '/projects'
      const data = await api.get<Project[]>(url)
      setProjects(data)
    } catch (error) {
      console.error('Failed to fetch projects:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return projects
    const query = searchQuery.toLowerCase()
    return projects.filter(
      (project) =>
        project.name.toLowerCase().includes(query) ||
        project.client.toLowerCase().includes(query) ||
        (project.description && project.description.toLowerCase().includes(query)),
    )
  }, [projects, searchQuery])

  const businessProjects = filteredProjects.filter((project) => {
    return getProjectPhase(project) === 'business'
  })

  const deliveryProjects = filteredProjects.filter((project) => {
    return getProjectPhase(project) === 'delivery'
  })

  const archivedProjects = filteredProjects.filter((project) => {
    return getProjectPhase(project) === 'archived'
  })

  if (loading) {
    return (
      <>
        <PageTitle title={t('projects.title')} />
        <div className="min-h-full bg-gray-50 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </>
    )
  }

  return (
    <>
      <PageTitle title={t('projects.title')} />
      <div className="min-h-full bg-gradient-to-b from-gray-50 to-white">
        <ProjectsHeader
          isLoadingUsers={isLoadingUsers}
          isZh={isZh}
          onCreateProject={() => navigate('/projects/new')}
          onSearchChange={setSearchQuery}
          onSelectedMemberChange={setSelectedMemberId}
          searchQuery={searchQuery}
          selectedMemberId={selectedMemberId}
          users={users}
        />

        <div className="max-w-full mx-auto px-6 py-8">
          <ProjectsPhaseSection
            phase={PHASES.business}
            projects={businessProjects}
            onProjectClick={(id) => navigate(`/projects/${id}`)}
            isExpanded={expandedPhase === 'business'}
            onToggle={() => setExpandedPhase(expandedPhase === 'business' ? null : 'business')}
          />

          <ProjectsPhaseSection
            phase={PHASES.delivery}
            projects={deliveryProjects}
            onProjectClick={(id) => navigate(`/projects/${id}`)}
            isExpanded={expandedPhase === 'delivery'}
            onToggle={() => setExpandedPhase(expandedPhase === 'delivery' ? null : 'delivery')}
          />

          <ProjectsPhaseSection
            phase={PHASES.archived}
            projects={archivedProjects}
            onProjectClick={(id) => navigate(`/projects/${id}`)}
            isExpanded={expandedPhase === 'archived'}
            onToggle={() => setExpandedPhase(expandedPhase === 'archived' ? null : 'archived')}
          />
        </div>
      </div>
    </>
  )
}
