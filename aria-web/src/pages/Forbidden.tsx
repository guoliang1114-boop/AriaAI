import { ShieldAlert, ArrowLeft, Home, Settings } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export function Forbidden() {
  const navigate = useNavigate()
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const copy = isZh
    ? {
        title: '您暂时无权访问这个区域',
        description:
          '这个页面只向更高权限的用户开放。如果您认为自己应该拥有权限，请联系管理员，或者先回到当前可以使用的工作区。',
        goBack: '返回上一页',
        backToDashboard: '回到首页',
        nextTitle: '您可以接下来这样做',
        nextLine1: '回到最近使用的项目或对话，继续当前工作。',
        nextLine2: '如果这个页面是您职责所需，请联系管理员开通权限。',
        quickLinks: '快捷入口',
        projects: '项目',
        projectsHint: '返回活跃项目，继续交付工作。',
        chat: '对话',
        chatHint: '回到对话工作台，从上次进度继续。',
        profileSettings: '个人设置',
        profileHint: '您仍然可以修改自己的个人信息和偏好。',
      }
    : {
        title: "You don't have access to this area",
        description:
          'This page is available only to users with higher permissions. If you believe you should have access, contact your administrator or return to a workspace you can use right now.',
        goBack: 'Go back',
        backToDashboard: 'Back to dashboard',
        nextTitle: 'What you can do next',
        nextLine1: 'Return to your recent project or conversation and continue from there.',
        nextLine2: 'Ask an admin to grant access if this page is required for your role.',
        quickLinks: 'Quick links',
        projects: 'Projects',
        projectsHint: 'Jump back into active delivery work.',
        chat: 'Chat',
        chatHint: 'Continue where you left off in a conversation.',
        profileSettings: 'Profile settings',
        profileHint: 'You can still update your own profile and preferences.',
      }

  return (
    <div className="min-h-full bg-gradient-to-br from-surface via-surface-container-low to-surface-container">
      <div className="mx-auto flex min-h-[calc(100vh-56px)] max-w-5xl items-center px-6 py-12">
        <div className="grid w-full gap-10 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[28px] border border-outline/20 bg-surface-container-lowest/90 p-8 shadow-[0_20px_60px_rgba(0,63,177,0.08)] backdrop-blur">
            <div className="inline-flex items-center gap-2 rounded-full bg-tertiary-container/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-tertiary">
              403
            </div>
            <h1 className="mt-6 font-manrope text-4xl font-bold tracking-tight text-on-surface">
              {copy.title}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-on-surface-muted">{copy.description}</p>

            <div className="mt-8 flex flex-wrap gap-3">
              <button
                onClick={() => navigate(-1)}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:opacity-95"
              >
                <ArrowLeft className="h-4 w-4" />
                {copy.goBack}
              </button>
              <button
                onClick={() => navigate('/')}
                className="inline-flex items-center gap-2 rounded-xl border border-outline px-4 py-2.5 text-sm font-medium text-on-surface transition hover:bg-surface-container-low"
              >
                <Home className="h-4 w-4" />
                {copy.backToDashboard}
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-[28px] border border-outline/20 bg-surface-container-low p-6 shadow-sm">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-tertiary-container text-tertiary">
                <ShieldAlert className="h-6 w-6" />
              </div>
              <h2 className="text-lg font-semibold text-on-surface">{copy.nextTitle}</h2>
              <div className="mt-4 space-y-3 text-sm text-on-surface-muted">
                <p>{copy.nextLine1}</p>
                <p>{copy.nextLine2}</p>
              </div>
            </div>

            <div className="rounded-[28px] border border-outline/20 bg-surface-container-low p-6 shadow-sm">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-on-surface-muted">
                {copy.quickLinks}
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
                  <div className="text-sm font-medium text-on-surface">{copy.chat}</div>
                  <div className="mt-1 text-xs text-on-surface-muted">{copy.chatHint}</div>
                </button>
                <button
                  onClick={() => navigate('/settings')}
                  className="rounded-2xl border border-outline/20 bg-surface px-4 py-4 text-left transition hover:bg-surface-container-lowest"
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-on-surface">
                    <Settings className="h-4 w-4" />
                    {copy.profileSettings}
                  </div>
                  <div className="mt-1 text-xs text-on-surface-muted">{copy.profileHint}</div>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
