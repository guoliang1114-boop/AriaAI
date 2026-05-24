import { Compass, ArrowLeft, Home, MessageSquare, Search } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export function NotFound() {
  const navigate = useNavigate()
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const copy = isZh
    ? {
        title: '这个页面不存在',
        description:
          '这个链接可能已过期，页面位置可能已变更，也可能是地址不完整。您可以直接返回下方的主工作区，不用从头开始。',
        dashboard: '首页',
        goBack: '返回上一页',
        keepMoving: '继续工作',
        keepMovingLine1: '可以使用下面的快捷路径，快速回到项目、对话或知识工作区。',
        keepMovingLine2: '如果这条链接来自收藏或历史记录，可能需要更新一下。',
        quickRoutes: '常用路径',
        projects: '项目',
        projectsHint: '返回您的项目交付与商机看板。',
        chat: '对话',
        chatHint: '打开最近对话，继续当前工作。',
        knowledge: '知识库',
        knowledgeHint: '搜索文档、笔记和客户上下文。',
      }
    : {
        title: "This page doesn't exist",
        description:
          'The link may be outdated, the page may have moved, or the address may be incomplete. You can jump back to your main workspaces below instead of starting over.',
        dashboard: 'Dashboard',
        goBack: 'Go back',
        keepMoving: 'Keep moving',
        keepMovingLine1: 'Use the shortcuts below to get back to a project, chat, or client workspace quickly.',
        keepMovingLine2: 'If this came from a saved link, it may need to be updated.',
        quickRoutes: 'Quick routes',
        projects: 'Projects',
        projectsHint: 'Return to your delivery and pipeline view.',
        chat: 'Chat',
        chatHint: 'Open recent conversations and continue working.',
        knowledge: 'Knowledge',
        knowledgeHint: 'Search files, notes, and client context.',
      }

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(0,63,177,0.14),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(17,130,245,0.12),transparent_28%)] bg-surface">
      <div className="mx-auto flex min-h-[calc(100vh-56px)] max-w-5xl items-center px-6 py-12">
        <div className="grid w-full gap-10 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-[28px] border border-outline/20 bg-surface-container-lowest/90 p-8 shadow-[0_20px_60px_rgba(0,63,177,0.08)] backdrop-blur">
            <div className="inline-flex items-center gap-2 rounded-full bg-secondary-container/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              404
            </div>
            <h1 className="mt-6 font-manrope text-4xl font-bold tracking-tight text-on-surface">
              {copy.title}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-on-surface-muted">{copy.description}</p>

            <div className="mt-8 flex flex-wrap gap-3">
              <button
                onClick={() => navigate('/')}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:opacity-95"
              >
                <Home className="h-4 w-4" />
                {copy.dashboard}
              </button>
              <button
                onClick={() => navigate(-1)}
                className="inline-flex items-center gap-2 rounded-xl border border-outline px-4 py-2.5 text-sm font-medium text-on-surface transition hover:bg-surface-container-low"
              >
                <ArrowLeft className="h-4 w-4" />
                {copy.goBack}
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-[28px] border border-outline/20 bg-surface-container-low p-6 shadow-sm">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary-container text-primary">
                <Compass className="h-6 w-6" />
              </div>
              <h2 className="text-lg font-semibold text-on-surface">{copy.keepMoving}</h2>
              <div className="mt-4 space-y-3 text-sm text-on-surface-muted">
                <p>{copy.keepMovingLine1}</p>
                <p>{copy.keepMovingLine2}</p>
              </div>
            </div>

            <div className="rounded-[28px] border border-outline/20 bg-surface-container-low p-6 shadow-sm">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-on-surface-muted">
                {copy.quickRoutes}
              </h3>
              <div className="mt-4 grid gap-3">
                <button
                  onClick={() => navigate('/projects')}
                  className="rounded-2xl border border-outline/20 bg-surface px-4 py-4 text-left transition hover:bg-surface-container-lowest"
                >
                  <div className="text-sm font-medium text-on-surface">{copy.projects}</div>
                  <div className="mt-1 text-xs text-on-surface-muted">{copy.projectsHint}</div>
                </button>
                <button
                  onClick={() => navigate('/chat')}
                  className="rounded-2xl border border-outline/20 bg-surface px-4 py-4 text-left transition hover:bg-surface-container-lowest"
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-on-surface">
                    <MessageSquare className="h-4 w-4" />
                    {copy.chat}
                  </div>
                  <div className="mt-1 text-xs text-on-surface-muted">{copy.chatHint}</div>
                </button>
                <button
                  onClick={() => navigate('/knowledge')}
                  className="rounded-2xl border border-outline/20 bg-surface px-4 py-4 text-left transition hover:bg-surface-container-lowest"
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-on-surface">
                    <Search className="h-4 w-4" />
                    {copy.knowledge}
                  </div>
                  <div className="mt-1 text-xs text-on-surface-muted">{copy.knowledgeHint}</div>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
