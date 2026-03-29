import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { 
  ArrowLeft, 
  FolderKanban, 
  CheckCircle2, 
  Circle, 
  FileText,
  DollarSign,
  Loader2,
  MessageSquare,
  Edit3
} from 'lucide-react'
import { api } from '../../api/client'
import { PageTitle } from '../../components/PageTitle'
import type { ProjectDetail as ProjectDetailType } from '../../types/api'

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [projectDetail, setProjectDetail] = useState<ProjectDetailType | null>(null)

  useEffect(() => {
    if (id) {
      fetchProjectDetail(parseInt(id))
    }
  }, [id])

  const fetchProjectDetail = async (projectId: number) => {
    try {
      setLoading(true)
      const data = await api.get<ProjectDetailType>(`/projects/${projectId}/detail`)
      setProjectDetail(data)
    } catch (error) {
      console.error('Failed to fetch project detail:', error)
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-active/10 text-active'
      case 'lead': return 'bg-warning/10 text-warning'
      case 'completed': return 'bg-on-surface-muted/10 text-on-surface-muted'
      case 'archived': return 'bg-outline/20 text-on-surface-muted'
      default: return 'bg-surface-container-high text-on-surface-muted'
    }
  }

  if (loading) {
    return (
      <>
        <PageTitle title="Project" />
        <div className="min-h-full bg-surface flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </>
    )
  }

  if (!projectDetail) {
    return (
      <>
        <PageTitle title="Project" />
        <div className="min-h-full bg-surface flex items-center justify-center">
          <div className="text-center">
            <p className="text-on-surface-muted">Project not found</p>
            <button 
              onClick={() => navigate('/projects')}
              className="mt-4 text-primary hover:underline"
            >
              Back to Projects
            </button>
          </div>
        </div>
      </>
    )
  }

  const { project, files, milestones, folders, financials } = projectDetail

  return (
    <>
      <PageTitle title="Project" />
      <div className="min-h-full bg-surface">
        <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div className="flex items-start gap-4">
            <button 
              onClick={() => navigate('/projects')}
              className="p-2 rounded-xl hover:bg-surface-container-low transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-on-surface-muted" />
            </button>
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(project.status)}`}>
                  {project.status.toUpperCase()}
                </span>
                <span className="text-label-sm text-on-surface-muted">{project.client}</span>
              </div>
              <h1 className="text-headline-md text-on-surface">{project.name}</h1>
              <p className="text-body-md text-on-surface-muted mt-2">{project.description || 'No description'}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => navigate(`/chat?project=${project.id}`)}
              className="btn-secondary flex items-center gap-2"
            >
              <MessageSquare className="w-4 h-4" />
              Open Chat
            </button>
            <button className="p-2 rounded-xl hover:bg-surface-container-low transition-colors">
              <Edit3 className="w-5 h-5 text-on-surface-muted" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6">
          {/* Left Column - Main Content */}
          <div className="col-span-12 lg:col-span-8 space-y-6">
            {/* Context Summary */}
            {project.context_summary && (
              <div className="card bg-secondary-container/30">
                <h3 className="text-label-lg text-on-surface mb-3">AI Context Summary</h3>
                <p className="text-body-md text-on-surface-muted">{project.context_summary}</p>
              </div>
            )}

            {/* Milestones */}
            <div className="card">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-label-lg text-on-surface">Milestones</h3>
                <span className="text-sm text-on-surface-muted">
                  {milestones.filter(m => m.is_done).length} / {milestones.length} completed
                </span>
              </div>
              <div className="space-y-3">
                {milestones.length === 0 ? (
                  <p className="text-on-surface-muted text-center py-4">No milestones yet</p>
                ) : (
                  milestones.map((milestone) => (
                    <div 
                      key={milestone.id} 
                      className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface-container-low transition-colors"
                    >
                      {milestone.is_done ? (
                        <CheckCircle2 className="w-5 h-5 text-active" />
                      ) : (
                        <Circle className="w-5 h-5 text-on-surface-muted" />
                      )}
                      <div className="flex-1">
                        <p className={`text-sm ${milestone.is_done ? 'line-through text-on-surface-muted' : 'text-on-surface'}`}>
                          {milestone.title}
                        </p>
                        {milestone.due_date && (
                          <p className="text-xs text-on-surface-muted">
                            Due: {new Date(milestone.due_date).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                      <span className={`px-2 py-1 rounded-md text-xs font-medium ${
                        milestone.priority === 'high' ? 'bg-tertiary/10 text-tertiary' :
                        milestone.priority === 'medium' ? 'bg-warning/10 text-warning' :
                        'bg-surface-container-high text-on-surface-muted'
                      }`}>
                        {milestone.priority}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Files */}
            <div className="card">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-label-lg text-on-surface">Files</h3>
                <span className="text-sm text-on-surface-muted">{files.length} files</span>
              </div>
              <div className="space-y-2">
                {files.length === 0 ? (
                  <p className="text-on-surface-muted text-center py-4">No files uploaded</p>
                ) : (
                  files.map((file) => (
                    <div 
                      key={file.id} 
                      className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface-container-low transition-colors cursor-pointer"
                    >
                      <div className="w-10 h-10 rounded-lg bg-surface-container-low flex items-center justify-center">
                        <FileText className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-on-surface truncate">{file.name}</p>
                        <p className="text-xs text-on-surface-muted">{file.file_type.toUpperCase()}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Right Column - Sidebar */}
          <div className="col-span-12 lg:col-span-4 space-y-6">
            {/* Financials */}
            <div className="card bg-surface-container-low">
              <div className="flex items-center gap-2 mb-4">
                <DollarSign className="w-5 h-5 text-primary" />
                <h3 className="text-label-lg text-on-surface">Financials</h3>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-on-surface-muted">Contract Amount</span>
                  <span className="text-sm font-medium text-on-surface">
                    ¥{(financials.contract_amount || 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-on-surface-muted">Total Received</span>
                  <span className="text-sm font-medium text-active">
                    ¥{financials.total_received.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-on-surface-muted">Expenses</span>
                  <span className="text-sm font-medium text-tertiary">
                    ¥{financials.total_expense.toLocaleString()}
                  </span>
                </div>
                <div className="h-px bg-outline/10 my-3"></div>
                <div className="flex justify-between">
                  <span className="text-sm text-on-surface-muted">Remaining</span>
                  <span className="text-sm font-medium text-on-surface">
                    ¥{financials.remaining.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            {/* Folders */}
            <div className="card">
              <h3 className="text-label-lg text-on-surface mb-4">Folders</h3>
              <div className="space-y-2">
                {folders.map((folder) => (
                  <div 
                    key={folder.id}
                    className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface-container-low transition-colors cursor-pointer"
                  >
                    <FolderKanban className="w-5 h-5 text-on-surface-muted" />
                    <span className="text-sm text-on-surface">{folder.name}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Project Notes */}
            {project.notes && (
              <div className="card">
                <h3 className="text-label-lg text-on-surface mb-3">Notes</h3>
                <p className="text-body-sm text-on-surface-muted whitespace-pre-wrap">{project.notes}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  </>
  )
}
