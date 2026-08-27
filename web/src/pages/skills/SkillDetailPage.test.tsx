import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Skill } from '../../types/api'
import { SkillDetailPage } from './Skills'

const mockGet = vi.fn()
let mockSkillId = 'invalid'

vi.mock('../../api/client', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
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
    mockSkillId = 'invalid'
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
})
