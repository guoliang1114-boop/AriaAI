import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { 
  ArrowLeft, 
  Loader2,
  Building2,
  FileText,
  DollarSign,
  Briefcase
} from 'lucide-react'
import { api } from '../../api/client'
import { PageTitle } from '../../components/PageTitle'
import type { Project } from '../../types/api'

export function NewProject() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    client: '',
    description: '',
    status: 'lead' as const,
    contract_amount: ''
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name || !formData.client) return

    try {
      setLoading(true)
      const project = await api.post<Project>('/projects', {
        name: formData.name,
        client: formData.client,
        description: formData.description,
        status: formData.status,
        contract_amount: formData.contract_amount ? parseFloat(formData.contract_amount) : undefined
      })
      navigate(`/projects/${project.id}`)
    } catch (error) {
      console.error('Failed to create project:', error)
      alert('Failed to create project. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <PageTitle title="New Project" />
      <div className="min-h-full bg-surface">
        <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button 
            onClick={() => navigate('/projects')}
            className="p-2 rounded-xl hover:bg-surface-container-low transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-on-surface-muted" />
          </button>
          <div>
            <h1 className="text-headline-md text-on-surface">New Project</h1>
            <p className="text-body-md text-on-surface-muted">Create a new consulting project</p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="card space-y-6">
          {/* Project Name */}
          <div>
            <label className="block text-label-md text-on-surface-variant mb-2">
              PROJECT NAME *
            </label>
            <div className="relative">
              <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-on-surface-muted" />
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Digital Transformation 2024"
                className="w-full pl-12 pr-4 py-3.5 bg-surface-container-lowest rounded-xl border-none text-on-surface placeholder:text-on-surface-muted outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>

          {/* Client */}
          <div>
            <label className="block text-label-md text-on-surface-variant mb-2">
              CLIENT *
            </label>
            <div className="relative">
              <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-on-surface-muted" />
              <input
                type="text"
                required
                value={formData.client}
                onChange={(e) => setFormData({ ...formData, client: e.target.value })}
                placeholder="e.g., Global Logistics Corp"
                className="w-full pl-12 pr-4 py-3.5 bg-surface-container-lowest rounded-xl border-none text-on-surface placeholder:text-on-surface-muted outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-label-md text-on-surface-variant mb-2">
              DESCRIPTION
            </label>
            <div className="relative">
              <FileText className="absolute left-4 top-4 w-5 h-5 text-on-surface-muted" />
              <textarea
                rows={4}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe the project scope and objectives..."
                className="w-full pl-12 pr-4 py-3.5 bg-surface-container-lowest rounded-xl border-none text-on-surface placeholder:text-on-surface-muted outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              />
            </div>
          </div>

          {/* Status & Contract Amount */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-label-md text-on-surface-variant mb-2">
                STATUS
              </label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                className="w-full px-4 py-3.5 bg-surface-container-lowest rounded-xl border-none text-on-surface outline-none focus:ring-2 focus:ring-primary/20 appearance-none cursor-pointer"
              >
                <option value="lead">Lead</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div>
              <label className="block text-label-md text-on-surface-variant mb-2">
                CONTRACT AMOUNT
              </label>
              <div className="relative">
                <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-on-surface-muted" />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.contract_amount}
                  onChange={(e) => setFormData({ ...formData, contract_amount: e.target.value })}
                  placeholder="0.00"
                  className="w-full pl-12 pr-4 py-3.5 bg-surface-container-lowest rounded-xl border-none text-on-surface placeholder:text-on-surface-muted outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-outline/10">
            <button
              type="button"
              onClick={() => navigate('/projects')}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !formData.name || !formData.client}
              className="btn-primary flex items-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Project'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  </>
  )
}
