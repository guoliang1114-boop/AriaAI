import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Eye,
  FilePlus2,
  FileText,
  FolderOpen,
  Loader2,
  Pencil,
  Save,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'
import { api } from '../../api/client'
import { MarkdownRenderer } from '../../components/MarkdownRenderer'
import { useToast } from '../../contexts/ToastContext'
import type { ProjectFile, ProjectFolder } from '../../types/api'

interface ProjectNotesTabProps {
  projectId: string
  projectName: string
  files: ProjectFile[]
  folders: ProjectFolder[]
  onUpdate: () => void
}

interface ProjectDocumentDetail {
  id: number
  project_id: number
  folder_id?: number | null
  name: string
  content: string
  summary?: string
  uploaded_at: string
}

export function ProjectNotesTab({ projectId, projectName, files, folders, onUpdate }: ProjectNotesTabProps) {
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const toast = useToast()

  const markdownFiles = useMemo(
    () => files.filter((file) => file.file_type?.toLowerCase() === 'md').sort((a, b) => a.name.localeCompare(b.name)),
    [files]
  )
  const folderList = useMemo(
    () => [...folders].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [folders]
  )

  const [selectedFileId, setSelectedFileId] = useState<number | null>(null)
  const [content, setContent] = useState('')
  const [mode, setMode] = useState<'edit' | 'preview' | 'split'>('preview')
  const [isLoadingDoc, setIsLoadingDoc] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isBootstrapping, setIsBootstrapping] = useState(false)
  const [isCreatingDoc, setIsCreatingDoc] = useState(false)
  const [isRenamingDoc, setIsRenamingDoc] = useState(false)
  const [isDeletingDoc, setIsDeletingDoc] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({})

  const [showAIModal, setShowAIModal] = useState(false)
  const [aiDraft, setAiDraft] = useState('')
  const [aiResult, setAiResult] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  const lastLoadedContentRef = useRef('')

  useEffect(() => {
    setOpenFolders((prev) => {
      const next = { ...prev }
      for (const folder of folderList) {
        if (!(folder.id in next)) next[folder.id] = true
      }
      if (!('uncategorized' in next)) next.uncategorized = true
      return next
    })
  }, [folderList])

  useEffect(() => {
    if (markdownFiles.length === 0) {
      setSelectedFileId(null)
      setContent('')
      setDirty(false)
      lastLoadedContentRef.current = ''
      return
    }

    if (!selectedFileId || !markdownFiles.some((file) => file.id === selectedFileId)) {
      setSelectedFileId(markdownFiles[0].id)
    }
  }, [markdownFiles, selectedFileId])

  useEffect(() => {
    if (!selectedFileId) return
    let cancelled = false

    const loadDocument = async () => {
      setIsLoadingDoc(true)
      try {
        const data = await api.get<ProjectDocumentDetail>(`/projects/${projectId}/documents/${selectedFileId}`)
        if (cancelled) return
        setContent(data.content || '')
        setDirty(false)
        lastLoadedContentRef.current = data.content || ''
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load project document:', error)
          toast.error(isZh ? '加载文档失败' : 'Failed to load document')
        }
      } finally {
        if (!cancelled) setIsLoadingDoc(false)
      }
    }

    void loadDocument()
    return () => {
      cancelled = true
    }
  }, [selectedFileId, projectId, toast, isZh])

  const selectedFile = markdownFiles.find((file) => file.id === selectedFileId) || null

  const groupedFiles = useMemo(() => {
    const map = new Map<number | 'uncategorized', ProjectFile[]>()
    for (const folder of folderList) map.set(folder.id, [])
    map.set('uncategorized', [])
    for (const file of markdownFiles) {
      const key = file.folder_id ?? 'uncategorized'
      const bucket = map.get(key) || []
      bucket.push(file)
      map.set(key, bucket)
    }
    return map
  }, [folderList, markdownFiles])

  const handleSave = async () => {
    if (!selectedFileId) return
    setIsSaving(true)
    try {
      await api.patch(`/projects/${projectId}/documents/${selectedFileId}`, { content })
      lastLoadedContentRef.current = content
      setDirty(false)
      onUpdate()
      toast.success(isZh ? '文档已保存' : 'Document saved')
    } catch (error) {
      console.error('Failed to save document:', error)
      toast.error(isZh ? '保存失败' : 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }

  const handleInitTemplate = async () => {
    setIsBootstrapping(true)
    try {
      const result = await api.post<{ cleaned_folder_count?: number }>(`/projects/${projectId}/notes/templates/presales`, {})
      onUpdate()
      toast.success(
        result.cleaned_folder_count
          ? (isZh ? '已生成模板并清理重复目录' : 'Template created and duplicate folders cleaned')
          : (isZh ? '已生成咨询售前模板' : 'Consulting pre-sales template created')
      )
    } catch (error) {
      console.error('Failed to initialize template:', error)
      toast.error(isZh ? '模板生成失败' : 'Failed to create template')
    } finally {
      setIsBootstrapping(false)
    }
  }

  const handleCreateDocument = async (folderId?: number | null) => {
    const rawName = window.prompt(isZh ? '请输入新文档名称' : 'Enter a document name')
    const name = rawName?.trim()
    if (!name) return
    setIsCreatingDoc(true)
    try {
      const created = await api.post<ProjectFile>(`/projects/${projectId}/documents`, {
        folder_id: folderId,
        name,
        content: `# ${name.replace(/\.md$/i, '')}\n`,
      })
      onUpdate()
      setSelectedFileId(created.id)
      toast.success(isZh ? '已创建文档' : 'Document created')
    } catch (error) {
      console.error('Failed to create document:', error)
      toast.error(isZh ? '创建文档失败' : 'Failed to create document')
    } finally {
      setIsCreatingDoc(false)
    }
  }

  const handleRenameDocument = async () => {
    if (!selectedFile) return
    const rawName = window.prompt(isZh ? '请输入新的文档名称' : 'Enter a new document name', selectedFile.name)
    const name = rawName?.trim()
    if (!name || name === selectedFile.name) return
    setIsRenamingDoc(true)
    try {
      await api.patch(`/projects/${projectId}/documents/${selectedFile.id}`, { name })
      onUpdate()
      toast.success(isZh ? '文档已重命名' : 'Document renamed')
    } catch (error) {
      console.error('Failed to rename document:', error)
      toast.error(isZh ? '重命名失败' : 'Failed to rename document')
    } finally {
      setIsRenamingDoc(false)
    }
  }

  const handleDeleteDocument = async () => {
    if (!selectedFile) return
    const confirmed = window.confirm(
      isZh ? `确定删除文档“${selectedFile.name}”吗？` : `Delete document "${selectedFile.name}"?`
    )
    if (!confirmed) return
    setIsDeletingDoc(true)
    try {
      await api.delete(`/projects/${projectId}/files/${selectedFile.id}`)
      const nextFile = markdownFiles.find((file) => file.id !== selectedFile.id) || null
      setSelectedFileId(nextFile?.id ?? null)
      setContent('')
      setDirty(false)
      lastLoadedContentRef.current = ''
      onUpdate()
      toast.success(isZh ? '文档已删除' : 'Document deleted')
    } catch (error) {
      console.error('Failed to delete document:', error)
      toast.error(isZh ? '删除失败' : 'Failed to delete document')
    } finally {
      setIsDeletingDoc(false)
    }
  }

  const handleAIGenerate = async () => {
    const draft = aiDraft.trim() || content.trim()
    if (!draft) return
    setAiLoading(true)
    try {
      const data = await api.post<{ result: string }>(
        `/projects/${projectId}/notes/ai-polish`,
        { draft },
        { timeout: 120000 }
      )
      setAiResult(data.result)
    } catch (error) {
      console.error('AI generation failed:', error)
      toast.error(isZh ? 'AI 生成失败，请重试' : 'AI generation failed, please try again')
    } finally {
      setAiLoading(false)
    }
  }

  const applyAIResult = (applyMode: 'replace' | 'append') => {
    if (!aiResult.trim()) return
    const nextContent = applyMode === 'replace'
      ? aiResult
      : `${content.trim() ? `${content}\n\n---\n\n` : ''}${aiResult}`
    setContent(nextContent)
    setDirty(nextContent !== lastLoadedContentRef.current)
    setShowAIModal(false)
    setAiDraft('')
    setAiResult('')
    toast.success(isZh ? '已应用到当前文档' : 'Applied to current document')
  }

  const toggleFolder = (key: string | number) => {
    setOpenFolders((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const showEdit = mode === 'edit' || mode === 'split'
  const showPreview = mode === 'preview' || mode === 'split'

  return (
    <div className="h-full min-h-[calc(100vh-220px)] rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex h-full min-h-[calc(100vh-220px)]">
        <aside className="w-80 border-r border-gray-200 bg-gray-50/70 flex flex-col">
          <div className="p-4 border-b border-gray-200 bg-white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-gray-400">
                  {isZh ? '咨询项目文档' : 'Consulting Project Docs'}
                </p>
                <h3 className="mt-1 text-base font-semibold text-gray-900">{projectName}</h3>
              </div>
              <BookOpen className="w-5 h-5 text-primary mt-0.5" />
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => void handleInitTemplate()}
                disabled={isBootstrapping}
                className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {isBootstrapping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                {isZh ? '咨询售前模板' : 'Consulting Pre-sales'}
              </button>
              <button
                onClick={() => void handleCreateDocument(folderList[0]?.id ?? null)}
                disabled={isCreatingDoc}
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                title={isZh ? '新建文档' : 'New document'}
              >
                {isCreatingDoc ? <Loader2 className="w-4 h-4 animate-spin" /> : <FilePlus2 className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {folderList.map((folder) => {
              const folderFiles = groupedFiles.get(folder.id) || []
              const isOpen = openFolders[folder.id] ?? true

              return (
                <div key={folder.id} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                  <div className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50">
                    <button
                      onClick={() => toggleFolder(folder.id)}
                      className="flex items-center gap-2 text-sm font-medium text-gray-800 text-left flex-1"
                    >
                      {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                      <FolderOpen className="w-4 h-4 text-amber-500" />
                      {folder.name}
                    </button>
                    <button
                      onClick={(event) => {
                        event.stopPropagation()
                        void handleCreateDocument(folder.id)
                      }}
                      className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                      title={isZh ? '在此分组新建文档' : 'Create document in this folder'}
                    >
                      <FilePlus2 className="w-4 h-4" />
                    </button>
                  </div>

                  {isOpen && (
                    <div className="px-2 pb-2 space-y-1">
                      {folderFiles.length > 0 ? (
                        folderFiles.map((file) => (
                          <button
                            key={file.id}
                            onClick={() => setSelectedFileId(file.id)}
                            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                              selectedFileId === file.id
                                ? 'bg-primary/10 text-primary'
                                : 'text-gray-600 hover:bg-gray-50'
                            }`}
                          >
                            <FileText className="w-4 h-4 flex-shrink-0" />
                            <span className="truncate">{file.name}</span>
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-2 text-xs text-gray-400">{isZh ? '暂无文档' : 'No documents yet'}</div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {(groupedFiles.get('uncategorized') || []).length > 0 && (
              <div className="rounded-xl border border-dashed border-gray-200 bg-white overflow-hidden">
                <button
                  onClick={() => toggleFolder('uncategorized')}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  {openFolders.uncategorized ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                  <FolderOpen className="w-4 h-4 text-gray-400" />
                  {isZh ? '未分组文档' : 'Uncategorized'}
                </button>
                {openFolders.uncategorized && (
                  <div className="px-2 pb-2 space-y-1">
                    {(groupedFiles.get('uncategorized') || []).map((file) => (
                      <button
                        key={file.id}
                        onClick={() => setSelectedFileId(file.id)}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                          selectedFileId === file.id
                            ? 'bg-primary/10 text-primary'
                            : 'text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <FileText className="w-4 h-4 flex-shrink-0" />
                        <span className="truncate">{file.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {markdownFiles.length === 0 && (
              <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-5 py-8 text-center">
                <BookOpen className="w-10 h-10 mx-auto text-gray-300" />
                <p className="mt-3 text-sm font-medium text-gray-800">{isZh ? '还没有项目文档' : 'No project documents yet'}</p>
                <p className="mt-1 text-xs leading-6 text-gray-500">
                  {isZh
                    ? '先生成咨询售前模板，就能得到一套适合咨询项目推进的标准笔记目录。'
                    : 'Create the consulting pre-sales template to start with a structured notes tree.'}
                </p>
                <button
                  onClick={() => void handleInitTemplate()}
                  disabled={isBootstrapping}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                >
                  {isBootstrapping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  {isZh ? '生成咨询售前模板' : 'Create Consulting Pre-sales Template'}
                </button>
              </div>
            )}
          </div>
        </aside>

        <section className="flex-1 flex flex-col min-w-0">
          <div className="px-5 py-4 border-b border-gray-200 bg-white flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.18em] text-gray-400">{isZh ? '当前文档' : 'Current Document'}</p>
              <h3 className="mt-1 text-lg font-semibold text-gray-900 truncate">
                {selectedFile?.name || (isZh ? '请选择文档' : 'Select a document')}
              </h3>
              {dirty && <p className="mt-1 text-xs text-amber-600">{isZh ? '有未保存修改' : 'Unsaved changes'}</p>}
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setMode('edit')}
                  className={`px-3 py-1.5 rounded-md text-sm ${mode === 'edit' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
                >
                  {isZh ? '编辑' : 'Edit'}
                </button>
                <button
                  onClick={() => setMode('split')}
                  className={`px-3 py-1.5 rounded-md text-sm ${mode === 'split' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
                >
                  {isZh ? '分栏' : 'Split'}
                </button>
                <button
                  onClick={() => setMode('preview')}
                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm ${mode === 'preview' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  {isZh ? '预览' : 'Preview'}
                </button>
              </div>

              <button
                onClick={() => setShowAIModal(true)}
                disabled={!selectedFile}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-50 text-indigo-700 text-sm font-medium hover:bg-indigo-100 disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" />
                {isZh ? 'AI 润色' : 'AI Assist'}
              </button>

              <button
                onClick={() => void handleRenameDocument()}
                disabled={!selectedFile || isRenamingDoc}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {isRenamingDoc ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />}
                {isZh ? '重命名' : 'Rename'}
              </button>

              <button
                onClick={() => void handleDeleteDocument()}
                disabled={!selectedFile || isDeletingDoc}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-red-200 bg-white text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {isDeletingDoc ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                {isZh ? '删除' : 'Delete'}
              </button>

              <button
                onClick={() => void handleSave()}
                disabled={!selectedFile || isSaving || !dirty}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {isZh ? '保存' : 'Save'}
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 bg-white">
            {!selectedFile ? (
              <div className="h-full flex items-center justify-center text-center px-8">
                <div>
                  <BookOpen className="w-12 h-12 mx-auto text-gray-300" />
                  <p className="mt-4 text-base font-medium text-gray-900">{isZh ? '从左侧选择一个文档' : 'Choose a document from the left'}</p>
                  <p className="mt-2 text-sm text-gray-500">
                    {isZh
                      ? '你可以先生成咨询售前模板，或者新建一个 Markdown 文档。'
                      : 'Create the consulting pre-sales template or start a new Markdown document.'}
                  </p>
                </div>
              </div>
            ) : isLoadingDoc ? (
              <div className="h-full flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : (
              <div className="h-full flex gap-4 p-4">
                {showEdit && (
                  <div className={`${mode === 'split' ? 'w-1/2' : 'w-full'} min-w-0`}>
                    <textarea
                      value={content}
                      onChange={(event) => {
                        const nextValue = event.target.value
                        setContent(nextValue)
                        setDirty(nextValue !== lastLoadedContentRef.current)
                      }}
                      placeholder={isZh ? '在这里编辑 Markdown 文档...' : 'Edit your Markdown document here...'}
                      className="w-full h-full min-h-[calc(100vh-340px)] rounded-xl border border-gray-200 bg-white px-4 py-4 text-sm font-mono leading-7 text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                      spellCheck={false}
                    />
                  </div>
                )}

                {showPreview && (
                  <div className={`${mode === 'split' ? 'w-1/2' : 'w-full'} min-w-0`}>
                    <div className="h-full min-h-[calc(100vh-340px)] rounded-xl border border-gray-200 bg-gray-50 px-5 py-4 overflow-auto">
                      {content.trim() ? (
                        <div className="md-root">
                          <MarkdownRenderer content={content} />
                        </div>
                      ) : (
                        <div className="h-full flex items-center justify-center text-sm text-gray-400">
                          {isZh ? '预览区' : 'Preview area'}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {showAIModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-indigo-600" />
                <h3 className="font-semibold text-gray-900">{isZh ? 'AI 辅助写作' : 'AI Writing Assistant'}</h3>
              </div>
              <button
                onClick={() => {
                  setShowAIModal(false)
                  setAiDraft('')
                  setAiResult('')
                }}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="flex flex-col gap-3">
                  <label className="text-sm font-medium text-gray-700">{isZh ? '草稿或补充说明' : 'Draft or instruction'}</label>
                  <textarea
                    value={aiDraft}
                    onChange={(event) => setAiDraft(event.target.value)}
                    placeholder={isZh ? '输入补充说明，留空则直接基于当前文档润色。' : 'Add guidance here, or leave empty to polish the current document.'}
                    className="min-h-[220px] px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                  />
                  <button
                    onClick={() => void handleAIGenerate()}
                    disabled={aiLoading}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {isZh ? '生成内容' : 'Generate'}
                  </button>
                </div>

                <div className="flex flex-col gap-3">
                  <label className="text-sm font-medium text-gray-700">{isZh ? '生成结果' : 'Generated result'}</label>
                  <div className="min-h-[220px] px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl overflow-auto">
                    {aiResult.trim() ? (
                      <div className="md-root text-sm">
                        <MarkdownRenderer content={aiResult} />
                      </div>
                    ) : (
                      <div className="h-full flex items-center justify-center text-sm text-gray-400">
                        {isZh ? '生成结果会出现在这里' : 'The generated result will appear here'}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => applyAIResult('replace')}
                      disabled={!aiResult.trim()}
                      className="flex-1 px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                    >
                      {isZh ? '替换当前文档' : 'Replace'}
                    </button>
                    <button
                      onClick={() => applyAIResult('append')}
                      disabled={!aiResult.trim()}
                      className="flex-1 px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {isZh ? '追加到文档' : 'Append'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
