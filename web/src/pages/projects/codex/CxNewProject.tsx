import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../../api/client'
import { useToast } from '../../../contexts/ToastContext'
import type { Project } from '../../../types/api'
import type { ProjectStatus } from '../../../types/enums'
import { CxIcon } from './CxIcons'

/** New-project form — replaces the legacy NewProject. Codex-styled,
 * single-column, posts to /projects and routes to the new project
 * detail on success. */

const INPUT_STYLE = {
  width: '100%',
  padding: '9px 11px',
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
  color: 'var(--ink-mute)',
  marginBottom: 6,
  fontWeight: 500,
} as const

const STATUS_OPTIONS: Array<{ value: ProjectStatus; label: string; hint: string }> = [
  { value: 'lead', label: '线索期', hint: '初步接触 · 需求挖掘' },
  { value: 'opportunity', label: '机会期', hint: '商机确认 · 方案投标 · 谈判' },
  { value: 'won', label: '已签约', hint: '合同已签 · 准备启动' },
  { value: 'delivering', label: '交付中', hint: '正在执行' },
]

export function CxNewProject() {
  const navigate = useNavigate()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    name: '',
    client: '',
    description: '',
    status: 'lead' as ProjectStatus,
    contract_amount: 0,
  })

  const update =
    (k: keyof typeof form) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const value =
        k === 'contract_amount' ? Number(e.target.value || 0) : e.target.value
      setForm((s) => ({ ...s, [k]: value }))
    }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!form.name.trim()) {
      toast.warning({ title: '项目名称不能为空' })
      return
    }
    if (!form.client.trim()) {
      toast.warning({ title: '客户不能为空' })
      return
    }
    setBusy(true)
    try {
      const created = await api.post<Project>('/projects', {
        name: form.name.trim(),
        client: form.client.trim(),
        description: form.description.trim(),
        status: form.status,
        contract_amount: form.contract_amount,
      })
      toast.success({ title: '项目已创建', description: created.name })
      navigate(`/projects/${created.id}/overview`)
    } catch (err) {
      toast.error({
        title: '创建失败',
        description: err instanceof Error ? err.message : '请稍后重试',
      })
      setBusy(false)
    }
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
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '36px 32px 48px' }}>
        <button
          type="button"
          onClick={() => navigate('/projects')}
          className="row-hov"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 12.5,
            color: 'var(--ink-mute)',
            padding: '4px 8px',
            marginLeft: -8,
            borderRadius: 'var(--r-sm)',
            marginBottom: 18,
          }}
        >
          <CxIcon name="chevron-right" size={11} style={{ transform: 'rotate(180deg)' }} />{' '}
          返回项目空间
        </button>

        <h1
          className="ui"
          style={{
            margin: 0,
            fontSize: 24,
            fontWeight: 500,
            color: 'var(--ink)',
            letterSpacing: '-0.02em',
          }}
        >
          新建项目
        </h1>
        <p
          style={{
            margin: '6px 0 28px',
            fontSize: 13,
            color: 'var(--ink-mute)',
            lineHeight: 1.65,
          }}
        >
          创建后会自动生成初始项目记忆,你可以在「项目对话」中继续沉淀客户背景、痛点、决策链等关键信息。
        </p>

        <form
          onSubmit={submit}
          style={{
            background: 'var(--bg-elev)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-md)',
            padding: '24px 28px',
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          }}
        >
          <div>
            <label style={LABEL_STYLE}>项目名称</label>
            <input
              type="text"
              value={form.name}
              onChange={update('name')}
              required
              autoFocus
              placeholder="例:鼎和保险 · 数字化转型咨询"
              className="codex-input"
              style={INPUT_STYLE}
            />
          </div>

          <div>
            <label style={LABEL_STYLE}>客户</label>
            <input
              type="text"
              value={form.client}
              onChange={update('client')}
              required
              placeholder="例:鼎和保险股份有限公司"
              className="codex-input"
              style={INPUT_STYLE}
            />
            <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4 }}>
              客户名会用于匹配「客户空间」中的档案,以便联动干系人和客户记忆。
            </div>
          </div>

          <div>
            <label style={LABEL_STYLE}>当前阶段</label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 8,
              }}
            >
              {STATUS_OPTIONS.map((o) => {
                const selected = form.status === o.value
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() =>
                      setForm((s) => ({ ...s, status: o.value }))
                    }
                    style={{
                      textAlign: 'left',
                      padding: '11px 13px',
                      borderRadius: 'var(--r-sm)',
                      border: `1px solid ${
                        selected ? 'var(--accent)' : 'var(--line)'
                      }`,
                      background: selected ? 'var(--accent-bg)' : 'var(--bg)',
                      cursor: 'pointer',
                    }}
                  >
                    <div
                      className="ui"
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: selected ? 'var(--accent-ink)' : 'var(--ink)',
                      }}
                    >
                      {o.label}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 3 }}>
                      {o.hint}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label style={LABEL_STYLE}>合同金额(元)</label>
            <input
              type="number"
              min={0}
              step={1000}
              value={form.contract_amount}
              onChange={update('contract_amount')}
              placeholder="0"
              className="codex-input"
              style={INPUT_STYLE}
            />
            <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4 }}>
              可留 0,签约前再补。
            </div>
          </div>

          <div>
            <label style={LABEL_STYLE}>简介(可选)</label>
            <textarea
              rows={4}
              value={form.description}
              onChange={update('description')}
              placeholder="一两句话讲清楚:做什么、为什么做、对客户的价值。"
              className="codex-input"
              style={{ ...INPUT_STYLE, resize: 'vertical' }}
            />
          </div>

          <div
            style={{
              display: 'flex',
              gap: 8,
              justifyContent: 'flex-end',
              paddingTop: 8,
              borderTop: '1px solid var(--line-soft)',
            }}
          >
            <button
              type="button"
              onClick={() => navigate('/projects')}
              disabled={busy}
              style={{
                padding: '8px 16px',
                fontSize: 13,
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-sm)',
                color: 'var(--ink-soft)',
                background: 'transparent',
                cursor: busy ? 'not-allowed' : 'pointer',
              }}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={busy}
              style={{
                padding: '8px 20px',
                fontSize: 13,
                fontWeight: 500,
                borderRadius: 'var(--r-sm)',
                background: 'var(--ink)',
                color: 'var(--bg-elev)',
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? '创建中…' : '创建项目'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
