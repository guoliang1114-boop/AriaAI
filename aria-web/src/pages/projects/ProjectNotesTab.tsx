import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, Eye, Edit3, Save, Loader2 } from 'lucide-react'
import { api } from '../../api/client'
import { MarkdownRenderer } from '../../components/MarkdownRenderer'
import { useToast } from '../../contexts/ToastContext'

interface ProjectNotesTabProps {
  projectId: string
  mdNotes: string
  onUpdate: () => void
}

export function ProjectNotesTab({ projectId, mdNotes, onUpdate }: ProjectNotesTabProps) {
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const toast = useToast()

  const [content, setContent] = useState(mdNotes || '')
  const [mode, setMode] = useState<'edit' | 'preview' | 'split'>('split')
  const [saving, setSaving] = useState(false)

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const target = e.currentTarget
      const start = target.selectionStart
      const end = target.selectionEnd
      const newValue = content.substring(0, start) + '  ' + content.substring(end)
      setContent(newValue)
      setTimeout(() => {
        target.selectionStart = target.selectionEnd = start + 2
      }, 0)
    }
  }, [content])

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.patch(`/projects/${projectId}`, { md_notes: content })
      onUpdate()
      toast.success(isZh ? '笔记已保存' : 'Notes saved')
    } catch (error) {
      console.error('Failed to save notes:', error)
      toast.error(isZh ? '保存失败' : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const showEdit = mode === 'edit' || mode === 'split'
  const showPreview = mode === 'preview' || mode === 'split'

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-gray-400" />
          <h3 className="font-semibold text-gray-900">
            {isZh ? '项目笔记' : 'Project Notes'}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setMode('edit')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                mode === 'edit' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Edit3 className="w-3.5 h-3.5" />
              {isZh ? '编辑' : 'Edit'}
            </button>
            <button
              onClick={() => setMode('split')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                mode === 'split' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {isZh ? '分栏' : 'Split'}
            </button>
            <button
              onClick={() => setMode('preview')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                mode === 'preview' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              {isZh ? '预览' : 'Preview'}
            </button>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isZh ? '保存' : 'Save'}
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 min-h-0 flex gap-4">
        {showEdit && (
          <div className={`flex flex-col ${mode === 'split' ? 'w-3/5' : 'w-full'}`}>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isZh ? '在此输入 Markdown 笔记...' : 'Type Markdown notes here...'}
              className="flex-1 w-full min-h-[calc(100vh-280px)] px-4 py-4 bg-white border border-gray-200 rounded-xl text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
              spellCheck={false}
            />
          </div>
        )}
        {showPreview && (
          <div className={`flex flex-col ${mode === 'split' ? 'w-2/5' : 'w-full'}`}>
            <div className="flex-1 min-h-[calc(100vh-280px)] px-5 py-4 bg-gray-50 border border-gray-200 rounded-xl overflow-auto">
              {content.trim() ? (
                <div className="md-root">
                  <MarkdownRenderer content={content} />
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-gray-400">
                  <Eye className="w-10 h-10 mb-3 opacity-30" />
                  <p className="text-sm">{isZh ? '预览区域' : 'Preview area'}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
