import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Forbidden } from './Forbidden'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh' } }),
}))

describe('Forbidden', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
  })

  it('renders 403 badge', () => {
    render(<Forbidden />)
    expect(screen.getByText('403')).toBeInTheDocument()
  })

  it('renders Chinese title when language is zh', () => {
    render(<Forbidden />)
    expect(screen.getByText('您暂时无权访问这个区域')).toBeInTheDocument()
  })

  it('navigates back when go back button clicked', () => {
    render(<Forbidden />)
    const btn = screen.getByText('返回上一页')
    fireEvent.click(btn)
    expect(mockNavigate).toHaveBeenCalledWith(-1)
  })

  it('navigates to dashboard when home button clicked', () => {
    render(<Forbidden />)
    const btn = screen.getByText('回到首页')
    fireEvent.click(btn)
    expect(mockNavigate).toHaveBeenCalledWith('/')
  })

  it('renders quick links', () => {
    render(<Forbidden />)
    expect(screen.getByText('项目')).toBeInTheDocument()
    expect(screen.getByText('对话')).toBeInTheDocument()
    expect(screen.getByText('个人设置')).toBeInTheDocument()
  })
})
