import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Skill } from '../../types/api'
import { SkillDetailPage } from './Skills'

const mockGet = vi.fn()
const mockPost = vi.fn()
let mockSkillId = 'invalid'

vi.mock('../../api/client', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ skillId: mockSkillId }),
  useSearchParams: () => [new URLSearchParams()],
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'zh' },
    t: (key: string) => key,
  }),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function skill(id: number, name: string): Skill {
  return {
    id,
    name,
    category: 'strategy',
    description: `${name} 描述`,
    system_prompt: '',
    user_template: '',
    estimated_time: '5 分钟',
    tools_definition_json: '[]',
  }
}

describe('SkillDetailPage', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockPost.mockReset()
    mockSkillId = 'invalid'
    localStorage.removeItem('user')
  })

  it('rejects an invalid Skill id without sending an API request', () => {
    render(<SkillDetailPage />)

    expect(screen.getByText('这个能力暂时不可用')).toBeInTheDocument()
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('keeps the newest Skill when an older route request finishes later', async () => {
    const first = deferred<Skill>()
    const second = deferred<Skill>()
    mockGet.mockImplementation((url: string) => url === '/skills/1' ? first.promise : second.promise)
    mockSkillId = '1'
    const { rerender } = render(<SkillDetailPage />)
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/skills/1'))

    mockSkillId = '2'
    rerender(<SkillDetailPage />)
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/skills/2'))

    await act(async () => {
      second.resolve(skill(2, '最新 Skill'))
    })
    await screen.findByRole('heading', { name: '最新 Skill' })

    await act(async () => {
      first.resolve(skill(1, '过期 Skill'))
    })
    expect(screen.getByRole('heading', { name: '最新 Skill' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '过期 Skill' })).not.toBeInTheDocument()
  })

  it('shows release identity and prevents launching a deprecated Skill', async () => {
    mockSkillId = '3'
    mockGet.mockResolvedValue({
      ...skill(3, '退役 Skill'),
      package_version: '2.0.0',
      package_status: 'deprecated',
      package_sha256: 'b'.repeat(64),
    })

    render(<SkillDetailPage />)

    expect(await screen.findByText('v2.0.0')).toBeInTheDocument()
    expect(screen.getAllByText('deprecated').length).toBeGreaterThan(0)
    expect(screen.getByText('bbbbbbbbbbbb')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '已退役' })).toBeDisabled()
  })

  it('shows the live release, canary health, and immutable release history', async () => {
    mockSkillId = '4'
    mockGet.mockImplementation((url: string) => {
      if (url === '/skills/4') {
        return Promise.resolve({
          ...skill(4, '灰度 Skill'),
          package_version: '1.1.0',
          package_status: 'preview',
          package_sha256: 'c'.repeat(64),
          active_release_id: 10,
        })
      }
      if (url === '/skills/4/releases') {
        return Promise.resolve({
          active_release_id: 10,
          items: [
            { id: 11, skill_id: 4, skill_name: '灰度 Skill', version: '1.1.0', status: 'preview', sha256: 'c'.repeat(64), source: 'update', is_active: false, created_at: '2026-08-27T01:00:00' },
            { id: 10, skill_id: 4, skill_name: '灰度 Skill', version: '1.0.0', status: 'stable', sha256: 'a'.repeat(64), source: 'migration', is_active: true, created_at: '2026-08-26T01:00:00' },
          ],
        })
      }
      if (url === '/skills/4/rollouts') {
        return Promise.resolve({
          items: [{
            id: 20,
            skill_id: 4,
            baseline_release: { id: 10, skill_id: 4, skill_name: '灰度 Skill', version: '1.0.0', status: 'stable', sha256: 'a'.repeat(64), source: 'migration', is_active: false, created_at: '2026-08-26T01:00:00' },
            candidate_release: { id: 11, skill_id: 4, skill_name: '灰度 Skill', version: '1.1.0', status: 'preview', sha256: 'c'.repeat(64), source: 'update', is_active: false, created_at: '2026-08-27T01:00:00' },
            percentage: 10,
            status: 'active',
            min_sample_size: 20,
            max_failure_rate: 0.25,
            auto_stop: true,
            health: {
              baseline: { run_count: 8, terminal_count: 8, completed_count: 8, failed_count: 0, cancelled_count: 0, completion_rate: 1, failure_rate: 0 },
              candidate: { run_count: 2, terminal_count: 2, completed_count: 2, failed_count: 0, cancelled_count: 0, completion_rate: 1, failure_rate: 0 },
              privacy: { reads_message_content: false, stores_prompt_content: false, stores_user_identity: false },
            },
            created_at: '2026-08-27T01:00:00',
            updated_at: '2026-08-27T01:00:00',
          }],
        })
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`))
    })

    render(<SkillDetailPage />)

    expect(await screen.findByText('线上版本')).toBeInTheDocument()
    expect(screen.getByText('候选流量 10%')).toBeInTheDocument()
    expect(screen.getByText(/候选运行/)).toHaveTextContent('2')
    expect(screen.getAllByText(/v1\.1\.0 · preview/).length).toBeGreaterThan(0)
    expect(screen.getByText('v1.0.0')).toBeInTheDocument()
    expect(screen.getByText(/不读取消息正文或提示词/)).toBeInTheDocument()
  })

  it('lets an administrator start a stale-safe 10% canary', async () => {
    mockSkillId = '5'
    localStorage.setItem('user', JSON.stringify({ id: 1, is_admin: true }))
    mockPost.mockResolvedValue({ id: 21, status: 'active' })
    mockGet.mockImplementation((url: string) => {
      if (url === '/skills/5') {
        return Promise.resolve({
          ...skill(5, '待灰度 Skill'),
          package_version: '1.1.0',
          package_status: 'preview',
          package_sha256: 'c'.repeat(64),
          active_release_id: 10,
        })
      }
      if (url === '/skills/5/releases') {
        return Promise.resolve({
          active_release_id: 10,
          items: [
            { id: 11, skill_id: 5, skill_name: '待灰度 Skill', version: '1.1.0', status: 'preview', sha256: 'c'.repeat(64), source: 'update', is_active: false, created_at: '2026-08-27T01:00:00' },
            { id: 10, skill_id: 5, skill_name: '待灰度 Skill', version: '1.0.0', status: 'stable', sha256: 'a'.repeat(64), source: 'migration', is_active: true, created_at: '2026-08-26T01:00:00' },
          ],
        })
      }
      if (url === '/skills/5/rollouts') return Promise.resolve({ items: [] })
      return Promise.reject(new Error(`Unexpected URL: ${url}`))
    })

    render(<SkillDetailPage />)
    fireEvent.click(await screen.findByRole('button', { name: '以 10% 灰度 v1.1.0' }))

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith(
      '/skills/5/rollouts',
      {
        candidate_release_id: 11,
        percentage: 10,
        min_sample_size: 20,
        max_failure_rate: 0.25,
        auto_stop: true,
        expected_active_release_sha256: 'a'.repeat(64),
      },
    ))
  })
})
