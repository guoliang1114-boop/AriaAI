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

  it('renders 404 numeral', () => {
    render(<NotFound />)
    expect(screen.getByText('404')).toBeInTheDocument()
  })

  it('renders Chinese title when language is zh', () => {
    render(<NotFound />)
    expect(screen.getByText('这里什么也没有')).toBeInTheDocument()
  })

  it('navigates to workspace when the workspace CTA is clicked', () => {
    render(<NotFound />)
    const btn = screen.getByText('回到工作台')
    fireEvent.click(btn)
    expect(mockNavigate).toHaveBeenCalledWith('/')
  })

  it('navigates back when go-back is clicked', () => {
    render(<NotFound />)
    const btn = screen.getByText('返回上一页')
    fireEvent.click(btn)
    expect(mockNavigate).toHaveBeenCalledWith(-1)
  })

  it('renders the search hint with ⌘K shortcut', () => {
    render(<NotFound />)
    expect(screen.getByText('搜索项目、对话、Skill')).toBeInTheDocument()
    expect(screen.getByText('⌘K')).toBeInTheDocument()
  })
})
