import { ArrowLeft } from 'lucide-react'

interface NewProjectHeaderProps {
  isZh: boolean
  onBack: () => void
}

export function NewProjectHeader({ isZh, onBack }: NewProjectHeaderProps) {
  return (
    <div className="flex items-center gap-4 mb-8">
      <button
        onClick={onBack}
        className="p-2 rounded-xl hover:bg-surface-container-low transition-colors text-on-surface-muted"
      >
        <ArrowLeft className="w-5 h-5" />
      </button>
      <div>
        <h1 className="text-headline-md text-on-surface font-semibold">
          {isZh ? '新建项目' : 'New Project'}
        </h1>
        <p className="text-body-sm text-on-surface-muted mt-0.5">
          {isZh ? '填写基本信息，快速创建咨询项目' : 'Fill in the basics and create a project quickly'}
        </p>
      </div>
    </div>
  )
}
