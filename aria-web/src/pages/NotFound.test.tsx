import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NotFound } from './NotFound'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh' } }),
}))

describe('NotFound', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
  })

  it('renders 404 badge', () => {
    render(<NotFound />)
    expect(screen.getByText('404')).toBeInTheDocument()
  })

  it('renders Chinese title when language is zh', () => {
    render(<NotFound />)
    expect(screen.getByText('这个页面不存在')).toBeInTheDocument()
  })

  it('navigates to dashboard when dashboard button clicked', () => {
    render(<NotFound />)
    const btn = screen.getByText('首页')
    fireEvent.click(btn)
    expect(mockNavigate).toHaveBeenCalledWith('/')
  })

  it('navigates back when go back button clicked', () => {
    render(<NotFound />)
    const btn = screen.getByText('返回上一页')
    fireEvent.click(btn)
    expect(mockNavigate).toHaveBeenCalledWith(-1)
  })

  it('renders quick route buttons', () => {
    render(<NotFound />)
    expect(screen.getByText('项目')).toBeInTheDocument()
    expect(screen.getByText('对话')).toBeInTheDocument()
    expect(screen.getByText('知识库')).toBeInTheDocument()
  })
})
