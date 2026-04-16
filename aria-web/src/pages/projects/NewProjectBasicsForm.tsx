import type { RefObject } from 'react'
import { FileText, Briefcase, Loader2, Plus } from 'lucide-react'
import type { ProjectStage } from '../../types/enums'
import { NewProjectClientSelect } from './NewProjectClientSelect'
import { NewProjectStageSelector } from './NewProjectStageSelector'

interface ClientRecord {
  id: number
  name: string
  industry: string
}

interface NewProjectFormData {
  client: string
  contract_amount: string
  description: string
  name: string
  notes: string
  status: ProjectStage
}

interface NewProjectBasicsFormProps {
  clientDropdownRef: RefObject<HTMLDivElement | null>
  clientSearch: string
  error: string | null
  filteredClients: ClientRecord[]
  formData: NewProjectFormData
  isZh: boolean
  loading: boolean
  onCancel: () => void
  onClientSearchChange: (value: string) => void
  onFieldChange: (field: keyof NewProjectFormData, value: string | ProjectStage) => void
  onSelectClient: (clientName: string) => void
  onToggleClientDropdown: () => void
  showClientDropdown: boolean
}

export function NewProjectBasicsForm({
  clientDropdownRef,
  clientSearch,
  error,
  filteredClients,
  formData,
  isZh,
  loading,
  onCancel,
  onClientSearchChange,
  onFieldChange,
  onSelectClient,
  onToggleClientDropdown,
  showClientDropdown,
}: NewProjectBasicsFormProps) {
  return (
    <>
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-outline/10" />
        <span className="text-xs text-on-surface-muted">{isZh ? '基本信息' : 'Basics'}</span>
        <div className="flex-1 h-px bg-outline/10" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1.5">
            {isZh ? '项目名称' : 'Project Name'} <span className="text-error">*</span>
          </label>
          <div className="relative">
            <Briefcase className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-muted pointer-events-none" />
            <input
              type="text"
              required
              value={formData.name}
              onChange={e => onFieldChange('name', e.target.value)}
              placeholder={isZh ? '例如：ERP 系统升级项目' : 'e.g. ERP Upgrade Project'}
              className="w-full pl-10 pr-4 py-3 bg-surface-container-lowest rounded-xl border border-outline/15 text-sm text-on-surface placeholder:text-on-surface-muted outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 transition-colors"
            />
          </div>
        </div>

        <NewProjectClientSelect
          clientDropdownRef={clientDropdownRef}
          clientSearch={clientSearch}
          clients={filteredClients}
          onClientSearchChange={onClientSearchChange}
          onSelectClient={onSelectClient}
          onToggleDropdown={onToggleClientDropdown}
          selectedClient={formData.client}
          showClientDropdown={showClientDropdown}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-on-surface-variant mb-1.5">
          {isZh ? '项目描述' : 'Description'}
        </label>
        <div className="relative">
          <FileText className="absolute left-3.5 top-3.5 w-4 h-4 text-on-surface-muted pointer-events-none" />
          <textarea
            rows={3}
            value={formData.description}
            onChange={e => onFieldChange('description', e.target.value)}
            placeholder={isZh ? '简要描述项目背景、目标和范围...' : 'Describe the project background, goals, and scope...'}
            className="w-full pl-10 pr-4 py-3 bg-surface-container-lowest rounded-xl border border-outline/15 text-sm text-on-surface placeholder:text-on-surface-muted outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 transition-colors resize-none"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-on-surface-variant mb-1.5">
          {isZh ? '合同金额（元）' : 'Contract Amount (CNY)'}
        </label>
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-on-surface-muted font-medium">¥</span>
          <input
            type="number"
            min="0"
            value={formData.contract_amount}
            onChange={e => onFieldChange('contract_amount', e.target.value)}
            placeholder="0"
            className="w-full pl-8 pr-4 py-3 bg-surface-container-lowest rounded-xl border border-outline/15 text-sm text-on-surface placeholder:text-on-surface-muted outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 transition-colors"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-outline/10" />
        <span className="text-xs text-on-surface-muted">{isZh ? '项目阶段' : 'Stage'}</span>
        <div className="flex-1 h-px bg-outline/10" />
      </div>

      <NewProjectStageSelector
        value={formData.status}
        onChange={status => onFieldChange('status', status)}
      />

      {error && (
        <div className="px-4 py-3 rounded-xl bg-error/5 border border-error/20 text-sm text-error">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-outline/10">
        <button
          type="button"
          onClick={onCancel}
          className="px-5 py-2.5 text-sm text-on-surface-muted hover:bg-surface-container-low rounded-xl transition-colors"
        >
          {isZh ? '取消' : 'Cancel'}
        </button>
        <button
          type="submit"
          disabled={loading || !formData.name.trim() || !formData.client.trim()}
          className="flex items-center gap-2 px-6 py-2.5 bg-gradient-primary text-white text-sm font-medium rounded-xl hover:opacity-90 hover:shadow-lg hover:shadow-primary/20 active:scale-95 transition-all disabled:opacity-40"
        >
          {loading ? (
            <><Loader2 className="w-4 h-4 animate-spin" />{isZh ? '创建中...' : 'Creating...'}</>
          ) : (
            <><Plus className="w-4 h-4" />{isZh ? '创建项目' : 'Create Project'}</>
          )}
        </button>
      </div>
    </>
  )
}
