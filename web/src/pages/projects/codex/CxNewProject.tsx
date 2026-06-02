import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../../api/client'
import { useToast } from '../../../contexts/ToastContext'
import type { Project, SkillSummary, User } from '../../../types/api'
import type { ProjectStatus } from '../../../types/enums'
import { CxIcon } from './CxIcons'
import { useClientsList, useProjectsList, formatAmountWan, firstGlyph } from './useProjectsApi'

/** New-project wizard (Codex redesign · cx-new-project).
 *
 * Two-column layout: left = stepped form (基础信息 / 客户与阶段 /
 * 项目团队 + footer with 保存为草稿 + 创建项目), right = Aria
 * assist panel (gradient card with live status, 推荐 Skill,
 * 相似项目).
 *
 * Single-page form with a 4-step progress indicator — the design
 * shows all 3 form panels on one page rather than literal wizard
 * pages, so the steps are a visual progress affordance derived
 * from form completeness. The 「确认」 step lights up once every
 * required field is filled.
 *
 * Backend gaps the wizard works around:
 *   - 项目编号 / 预计签约 / 团队成员 aren't in the ProjectCreate
 *     schema, so they render as preview / TODO panels but the
 *     submit only sends fields the backend accepts.
 *   - No real skill-recommendation or similar-project endpoint;
 *     右栏 pulls the latest skills and the user's most recent
 *     projects as a placeholder. */

const INPUT_STYLE = {
  width: '100%',
  padding: '9px 12px',
  fontSize: 13.5,
  background: 'var(--bg)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--r-sm)',
  color: 'var(--ink)',
  outline: 'none',
} as const

const LABEL_STYLE = {
  display: 'block',
  fontSize: 11.5,
  color: 'var(--ink-soft)',
  marginBottom: 6,
  fontWeight: 500,
} as const

const STATUS_OPTIONS: Array<{ value: ProjectStatus; label: string }> = [
  { value: 'lead', label: '线索期' },
  { value: 'opportunity', label: '机会期' },
  { value: 'won', label: '已签约' },
  { value: 'delivering', label: '交付中' },
]

interface FormState {
  name: string
  code: string
  description: string
  contract_amount: number | ''
  signing_date: string
  client: string
  status: ProjectStatus
}

const INITIAL_FORM: FormState = {
  name: '',
  code: '',
  description: '',
  contract_amount: '',
  signing_date: '',
  client: '',
  status: 'lead',
}

export function CxNewProject() {
  const navigate = useNavigate()
  const toast = useToast()

  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [busy, setBusy] = useState<false | 'draft' | 'create'>(false)

  const { data: clients } = useClientsList()
  const { data: existingProjects } = useProjectsList()
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [me, setMe] = useState<User | null>(null)
  // Skill ids the user has flagged for association via "+ 关联". We
  // collect them up front; once /projects accepts a skill_ids array
  // (or a /projects/:id/skills endpoint lands) we can POST these on
  // create.
  const [associatedSkillIds, setAssociatedSkillIds] = useState<Set<number>>(
    () => new Set<number>(),
  )

  useEffect(() => {
    let cancelled = false
    api
      .get<SkillSummary[]>('/skills/meta/summary')
      .then((rows) => {
        if (!cancelled) setSkills(rows)
      })
      .catch(() => {
        if (!cancelled) setSkills([])
      })
    api
      .get<User>('/auth/me')
      .then((u) => {
        if (!cancelled) setMe(u)
      })
      .catch(() => {
        if (!cancelled) setMe(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Match the client field against the known client list — drives
  // the AI assist panel's "已识别客户" affordance.
  const matchedClient = useMemo(() => {
    const q = form.client.trim().toLowerCase()
    if (!q) return null
    return clients.find((c) => c.name.toLowerCase() === q) || null
  }, [clients, form.client])

  const clientSuggestions = useMemo(() => {
    const q = form.client.trim().toLowerCase()
    if (!q || matchedClient) return [] as Array<{ id: number; name: string }>
    return clients.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 5)
  }, [clients, form.client, matchedClient])

  const similarProjects = useMemo(() => {
    const q = form.client.trim().toLowerCase()
    const all = existingProjects ?? []
    const liveProjects = all.filter((p) => p.status !== 'archived')
    if (q) {
      const sameClient = liveProjects.filter((p) =>
        (p.client || '').toLowerCase().includes(q),
      )
      if (sameClient.length > 0) return sameClient.slice(0, 3)
    }
    return liveProjects.slice(0, 3)
  }, [existingProjects, form.client])

  const recommendedSkills = skills.slice(0, 3)

  // Step indicator: derive an active step from completeness so the
  // user sees progress as they fill in. Step 4 (确认) lights up
  // once name + client are present.
  const activeStep = useMemo(() => {
    if (!form.name.trim() || !form.description.trim()) return 0
    if (!form.client.trim()) return 1
    return 3
  }, [form.name, form.description, form.client])

  const update =
    (k: keyof FormState) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const raw = e.target.value
      const next = k === 'contract_amount' ? (raw === '' ? '' : Number(raw)) : raw
      setForm((s) => ({ ...s, [k]: next } as FormState))
    }

  const pickClient = (name: string) => {
    setForm((s) => ({ ...s, client: name }))
  }

  const toggleSkillAssociation = (skillId: number) => {
    setAssociatedSkillIds((prev) => {
      const next = new Set(prev)
      if (next.has(skillId)) next.delete(skillId)
      else next.add(skillId)
      return next
    })
  }

  const submit = async (mode: 'draft' | 'create') => {
    if (busy) return
    if (!form.name.trim()) {
      toast.warning({ title: '项目名称不能为空' })
      return
    }
    if (!form.client.trim()) {
      toast.warning({ title: '请选择或填写关联客户' })
      return
    }
    setBusy(mode)
    try {
      // Drafts get pinned to "lead" so they land in the earliest
      // pipeline column regardless of what the user picked for
      // status. The notes field carries the non-schema extras
      // (编号 / 预计签约) so they aren't lost on the round-trip.
      const status: ProjectStatus = mode === 'draft' ? 'lead' : form.status
      const notesParts: string[] = []
      if (form.code.trim()) notesParts.push(`编号: ${form.code.trim()}`)
      if (form.signing_date.trim())
        notesParts.push(`预计签约: ${form.signing_date.trim()}`)

      const created = await api.post<Project>('/projects', {
        name: form.name.trim(),
        client: form.client.trim(),
        description: form.description.trim(),
        status,
        contract_amount: typeof form.contract_amount === 'number' ? form.contract_amount : 0,
        notes: notesParts.join(' · '),
      })
      toast.success({
        title: mode === 'draft' ? '草稿已保存' : '项目已创建',
        description: created.name,
      })
      navigate(`/projects/${created.id}/overview`)
    } catch (err) {
      toast.error({
        title: mode === 'draft' ? '保存失败' : '创建失败',
        description: err instanceof Error ? err.message : '请稍后重试',
      })
      setBusy(false)
    }
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    void submit('create')
  }

  return (
    <div
      className="theme-codex"
      style={{
        height: '100%',
        overflow: 'auto',
        background: 'var(--bg)',
        color: 'var(--ink)',
        fontFamily: 'var(--font-ui)',
        fontSize: 13.5,
      }}
    >
      <div
        style={{
          maxWidth: 1440,
          margin: '0 auto',
          padding: '28px 56px 48px',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 340px',
          gap: 32,
          minWidth: 0,
        }}
      >
        {/* ── Left: form column ────────────────────────────── */}
        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: 22, minWidth: 0 }}
        >
          {/* Crumb + title */}
          <div>
            <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 10 }}>
              <a
                onClick={() => navigate('/projects')}
                style={{ color: 'var(--ink-faint)', cursor: 'pointer' }}
              >
                项目
              </a>
              <span style={{ margin: '0 6px', color: 'var(--ink-faint)' }}>/</span>
              <span>新建</span>
            </div>
            <h1
              className="ui"
              style={{
                margin: 0,
                fontSize: 28,
                fontWeight: 500,
                color: 'var(--ink)',
                letterSpacing: '-0.02em',
              }}
            >
              新建项目
            </h1>
            <p
              style={{
                margin: '8px 0 0',
                fontSize: 13.5,
                color: 'var(--ink-mute)',
                lineHeight: 1.6,
                maxWidth: 540,
              }}
            >
              先填关键信息 — Aria 会自动生成项目记忆初稿、识别相关客户记忆、推荐适用的 Skill。
            </p>
          </div>

          <StepIndicator active={activeStep} />

          {/* 基础信息 */}
          <Panel title="基础信息">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Field label="项目名称 *">
                <input
                  type="text"
                  value={form.name}
                  onChange={update('name')}
                  required
                  autoFocus
                  placeholder="例: 鼎和保险 · 数字化转型咨询"
                  className="codex-input"
                  style={INPUT_STYLE}
                />
              </Field>
              <Field label="项目编号">
                <input
                  type="text"
                  value={form.code}
                  onChange={update('code')}
                  placeholder="选填 · 例: DH-2026-001"
                  className="codex-input num"
                  style={INPUT_STYLE}
                />
              </Field>
              <Field label="项目简述 · 一句话" colSpan={2}>
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={update('description')}
                  placeholder="围绕续保与理赔两个高频场景搭建数据闭环,Q3 完成首批试点。"
                  className="codex-input"
                  style={{
                    ...INPUT_STYLE,
                    resize: 'none',
                    fontFamily: 'var(--font-ui)',
                    lineHeight: 1.55,
                  }}
                />
              </Field>
              <Field label="预估金额 (元)">
                <input
                  type="number"
                  min={0}
                  step={10000}
                  value={form.contract_amount}
                  onChange={update('contract_amount')}
                  placeholder="2800000"
                  className="codex-input num"
                  style={INPUT_STYLE}
                />
                {typeof form.contract_amount === 'number' && form.contract_amount > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 4 }}>
                    ≈ {formatAmountWan(form.contract_amount)}
                  </div>
                )}
              </Field>
              <Field label="预计签约">
                <input
                  type="date"
                  value={form.signing_date}
                  onChange={update('signing_date')}
                  className="codex-input num"
                  style={INPUT_STYLE}
                />
              </Field>
            </div>
          </Panel>

          {/* 客户与阶段 */}
          <Panel title="客户与阶段">
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
              <Field label="关联客户 *">
                <ClientPicker
                  value={form.client}
                  matched={matchedClient}
                  suggestions={clientSuggestions}
                  onChange={(v) => setForm((s) => ({ ...s, client: v }))}
                  onPick={pickClient}
                />
                {matchedClient && (
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--ink-mute)',
                      marginTop: 6,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <CxIcon
                      name="sparkle"
                      size={10}
                      stroke={1.5}
                      style={{ color: 'var(--accent)' }}
                    />
                    Aria 已识别该客户档案 · 新建后会自动带入客户记忆与历史联系人
                  </div>
                )}
              </Field>
              <Field label="项目阶段">
                <select
                  value={form.status}
                  onChange={update('status')}
                  className="codex-input"
                  style={{ ...INPUT_STYLE, appearance: 'none' }}
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </Panel>

          {/* 项目团队. ProjectCreate doesn't accept a members list,
            so the current user gets pinned as 负责人 inline and the
            「+ 添加成员」 button is a hand-off to the post-create
            members panel (toast). The visual mirrors the design's
            member rows so the wizard reads as complete. */}
          <Panel title="项目团队">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <MemberRow
                name={me?.display_name || '当前账号'}
                role="项目经理"
                owner
              />
              <button
                type="button"
                onClick={() =>
                  toast.info({
                    title: '可在创建后继续邀请',
                    description: '到「概览 → 项目成员」面板添加更多成员',
                  })
                }
                style={{
                  padding: '8px 12px',
                  fontSize: 12.5,
                  color: 'var(--ink-mute)',
                  border: '1px dashed var(--line-strong)',
                  borderRadius: 'var(--r-sm)',
                  background: 'transparent',
                  cursor: 'pointer',
                  textAlign: 'center',
                }}
              >
                + 添加成员
              </button>
            </div>
          </Panel>

          {/* Footer actions */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingTop: 8,
            }}
          >
            <button
              type="button"
              onClick={() => navigate('/projects')}
              style={{
                padding: '9px 14px',
                fontSize: 13,
                color: 'var(--ink-mute)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              取消
            </button>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                disabled={busy !== false}
                onClick={() => void submit('draft')}
                style={{
                  padding: '9px 16px',
                  fontSize: 13,
                  color: 'var(--ink-soft)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r-sm)',
                  background: 'var(--bg-elev)',
                  cursor: busy ? 'not-allowed' : 'pointer',
                  opacity: busy ? 0.6 : 1,
                }}
              >
                {busy === 'draft' ? '保存中…' : '保存为草稿'}
              </button>
              <button
                type="submit"
                disabled={busy !== false}
                style={{
                  padding: '9px 18px',
                  fontSize: 13,
                  background: 'var(--ink)',
                  color: 'var(--bg-elev)',
                  borderRadius: 'var(--r-sm)',
                  border: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  opacity: busy ? 0.6 : 1,
                }}
              >
                {busy === 'create' ? '创建中…' : '创建项目'}{' '}
                <CxIcon name="arrow-right" size={11} stroke={1.8} />
              </button>
            </div>
          </div>
        </form>

        {/* ── Right: Aria assist column ────────────────────── */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <AriaAssistCard
            clientName={form.client.trim()}
            matchedClient={matchedClient}
            recommendedSkillsCount={recommendedSkills.length}
            similarProjectsCount={similarProjects.length}
          />
          <SidePanel title="推荐 Skill" subtitle="根据项目类型与客户行业">
            {recommendedSkills.length === 0 ? (
              <EmptyHint>暂无 Skill 数据</EmptyHint>
            ) : (
              recommendedSkills.map((s, i) => {
                const linked = associatedSkillIds.has(s.id)
                return (
                  <div
                    key={s.id}
                    style={{
                      display: 'flex',
                      gap: 10,
                      padding: '9px 0',
                      alignItems: 'center',
                      borderBottom:
                        i === recommendedSkills.length - 1
                          ? 'none'
                          : '1px solid var(--line-soft)',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        className="ui"
                        style={{
                          fontSize: 12.5,
                          color: 'var(--ink)',
                          fontWeight: 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {s.name}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--ink-mute)',
                          marginTop: 2,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {s.category} · {s.estimated_time || '—'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleSkillAssociation(s.id)}
                      style={{
                        fontSize: 11,
                        padding: '3px 9px',
                        height: 22,
                        borderRadius: 'var(--r-sm)',
                        background: linked
                          ? 'var(--accent)'
                          : 'var(--accent-bg)',
                        color: linked ? 'var(--bg-elev)' : 'var(--accent)',
                        border: linked
                          ? 'none'
                          : '1px solid var(--accent-bg)',
                        cursor: 'pointer',
                        flexShrink: 0,
                        fontWeight: 500,
                      }}
                    >
                      {linked ? '✓ 已关联' : '+ 关联'}
                    </button>
                  </div>
                )
              })
            )}
          </SidePanel>
          <SidePanel
            title="相似项目"
            subtitle={form.client.trim() ? '匹配客户名' : '近期项目'}
          >
            {similarProjects.length === 0 ? (
              <EmptyHint>暂无可对照项目</EmptyHint>
            ) : (
              similarProjects.map((p) => (
                <a
                  key={p.id}
                  onClick={() => navigate(`/projects/${p.id}/overview`)}
                  className="row-hov"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '7px 8px',
                    margin: '0 -8px',
                    borderRadius: 'var(--r-sm)',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      className="ui"
                      style={{
                        color: 'var(--ink)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {p.name}
                    </div>
                    <div
                      style={{
                        color: 'var(--ink-mute)',
                        fontSize: 11,
                        marginTop: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {p.client || '—'}
                    </div>
                  </div>
                  <CxIcon
                    name="arrow-up-right"
                    size={11}
                    stroke={1.5}
                    style={{ color: 'var(--ink-faint)', flexShrink: 0 }}
                  />
                </a>
              ))
            )}
          </SidePanel>
        </aside>
      </div>
    </div>
  )
}

/* ── Step indicator ────────────────────────────────────── */

const STEPS = [
  { n: '01', l: '基础信息' },
  { n: '02', l: '客户与阶段' },
  { n: '03', l: '团队成员' },
  { n: '04', l: '确认' },
] as const

function StepIndicator({ active }: { active: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      {STEPS.map((s, i) => {
        const done = i < active
        const isCurrent = i === active
        const reached = done || isCurrent
        return (
          <div
            key={s.n}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: reached ? 'var(--ink)' : 'var(--ink-mute)',
              flexShrink: 0,
            }}
          >
            <span
              className="num"
              style={{
                width: 22,
                height: 22,
                borderRadius: 99,
                background: reached ? 'var(--accent)' : 'transparent',
                color: reached ? 'var(--bg-elev)' : 'var(--ink-mute)',
                border: reached ? 'none' : '1px solid var(--line-strong)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10.5,
                fontWeight: 500,
              }}
            >
              {s.n}
            </span>
            <span>{s.l}</span>
            {i < STEPS.length - 1 && (
              <span
                aria-hidden
                style={{
                  display: 'inline-block',
                  width: 36,
                  height: 1,
                  background: done ? 'var(--accent)' : 'var(--line)',
                  marginLeft: 6,
                }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ── Form panel ─────────────────────────────────────────── */

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-md)',
        padding: '20px 22px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <h3
          className="ui"
          style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}
        >
          {title}
        </h3>
        {subtitle && (
          <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{subtitle}</span>
        )}
      </div>
      {children}
    </section>
  )
}

function Field({
  label,
  colSpan,
  children,
}: {
  label: string
  colSpan?: number
  children: React.ReactNode
}) {
  return (
    <div style={colSpan ? { gridColumn: `span ${colSpan}` } : undefined}>
      <label style={LABEL_STYLE}>{label}</label>
      {children}
    </div>
  )
}

/* ── Team member row ───────────────────────────────────── */

function MemberRow({
  name,
  role,
  owner,
}: {
  name: string
  role: string
  owner?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 10px',
        background: 'var(--bg-tint)',
        borderRadius: 'var(--r-sm)',
      }}
    >
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: 99,
          background: 'var(--accent-bg)',
          color: 'var(--accent-ink)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: 500,
          flexShrink: 0,
        }}
      >
        {firstGlyph(name)}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="ui"
          style={{
            fontSize: 13,
            color: 'var(--ink)',
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{role}</div>
      </div>
      {owner && (
        <span
          style={{
            fontSize: 11,
            color: 'var(--accent-ink)',
            background: 'var(--accent-bg)',
            padding: '2px 8px',
            borderRadius: 'var(--r-pill)',
            flexShrink: 0,
          }}
        >
          ● 负责人
        </span>
      )}
    </div>
  )
}

/* ── Client picker with typeahead ──────────────────────── */

function ClientPicker({
  value,
  matched,
  suggestions,
  onChange,
  onPick,
}: {
  value: string
  matched: { id: number; name: string } | null
  suggestions: Array<{ id: number; name: string }>
  onChange: (v: string) => void
  onPick: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  if (matched) {
    return (
      <div
        style={{
          ...INPUT_STYLE,
          border: '1px solid var(--accent)',
          background: 'var(--accent-bg)',
          color: 'var(--accent-ink)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            overflow: 'hidden',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 99,
              background: 'var(--accent)',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {matched.name}
          </span>
        </span>
        <button
          type="button"
          onClick={() => onChange('')}
          style={{
            fontSize: 11,
            color: 'var(--accent)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          更换
        </button>
      </div>
    )
  }

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder="搜索现有客户,或直接填写新客户名称"
        className="codex-input"
        style={INPUT_STYLE}
      />
      {open && suggestions.length > 0 && (
        <ul
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            padding: 4,
            background: 'var(--bg-elev)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-sm)',
            boxShadow: '0 10px 28px -10px rgba(0,0,0,0.18)',
            listStyle: 'none',
            zIndex: 5,
            maxHeight: 220,
            overflowY: 'auto',
          }}
        >
          {suggestions.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(c.name)
                  setOpen(false)
                }}
                className="row-hov"
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '7px 10px',
                  fontSize: 12.5,
                  color: 'var(--ink)',
                  border: 'none',
                  background: 'transparent',
                  borderRadius: 'var(--r-sm)',
                  cursor: 'pointer',
                }}
              >
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ── Aria assist card ──────────────────────────────────── */

function AriaAssistCard({
  clientName,
  matchedClient,
  recommendedSkillsCount,
  similarProjectsCount,
}: {
  clientName: string
  matchedClient: { id: number; name: string } | null
  recommendedSkillsCount: number
  similarProjectsCount: number
}) {
  const hasClient = clientName.length > 0
  return (
    <div
      style={{
        background:
          'linear-gradient(135deg, var(--accent-bg) 0%, var(--bg-elev) 100%)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-md)',
        padding: '16px 18px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span
          style={{
            width: 24,
            height: 24,
            borderRadius: 'var(--r-sm)',
            background: 'var(--accent)',
            color: 'var(--bg-elev)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CxIcon name="sparkle" size={12} stroke={1.5} />
        </span>
        <h3
          className="ui"
          style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}
        >
          Aria 协助
        </h3>
      </div>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.65 }}>
        {matchedClient ? (
          <>
            已识别客户{' '}
            <strong style={{ color: 'var(--accent-ink)' }}>{matchedClient.name}</strong>
            ,创建后将自动:
          </>
        ) : hasClient ? (
          <>
            将基于客户{' '}
            <strong style={{ color: 'var(--accent-ink)' }}>{clientName}</strong>{' '}
            搭建项目记忆草稿:
          </>
        ) : (
          '填入客户名称后,Aria 会自动:'
        )}
      </p>
      <div
        style={{
          marginTop: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          fontSize: 12.5,
          color: 'var(--ink-soft)',
        }}
      >
        <AssistRow
          tone={hasClient ? 'good' : 'idle'}
          label={
            matchedClient
              ? `基于客户记忆生成项目记忆 v1 草稿`
              : '生成项目记忆 v1 草稿'
          }
        />
        <AssistRow
          tone={recommendedSkillsCount > 0 ? 'good' : 'idle'}
          label={
            recommendedSkillsCount > 0
              ? `找到 ${recommendedSkillsCount} 个可推荐 Skill`
              : '推荐适用的 Skill'
          }
        />
        <AssistRow
          tone={similarProjectsCount > 0 ? 'good' : 'pulse'}
          label={
            similarProjectsCount > 0
              ? `汇总 ${similarProjectsCount} 个相似项目供参考`
              : '汇总相似项目经验'
          }
        />
      </div>
    </div>
  )
}

function AssistRow({ tone, label }: { tone: 'good' | 'idle' | 'pulse'; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, lineHeight: 1.65 }}>
      {tone === 'good' ? (
        <CxIcon name="check" size={11} stroke={2} style={{ color: 'var(--good)' }} />
      ) : tone === 'pulse' ? (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 99,
            background: 'var(--accent)',
            animation: 'pulse 1.2s ease-in-out infinite',
            display: 'inline-block',
          }}
        />
      ) : (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 99,
            background: 'var(--ink-faint)',
            display: 'inline-block',
          }}
        />
      )}
      <span>{label}</span>
    </div>
  )
}

/* ── Side panel + empty hint ───────────────────────────── */

function SidePanel({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-md)',
        padding: '14px 16px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <h3
          className="ui"
          style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}
        >
          {title}
        </h3>
        {subtitle && (
          <span style={{ fontSize: 10.5, color: 'var(--ink-mute)' }}>{subtitle}</span>
        )}
      </div>
      {children}
    </section>
  )
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-faint)', lineHeight: 1.55 }}>
      {children}
    </p>
  )
}
