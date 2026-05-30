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

  it('renders 403 numeral', () => {
    render(<Forbidden />)
    expect(screen.getByText('403')).toBeInTheDocument()
  })

  it('renders Chinese title when language is zh', () => {
    render(<Forbidden />)
    expect(screen.getByText('暂时没有访问权限')).toBeInTheDocument()
  })

  it('navigates back when go-back is clicked', () => {
    render(<Forbidden />)
    const btn = screen.getByText('返回上一页')
    fireEvent.click(btn)
    expect(mockNavigate).toHaveBeenCalledWith(-1)
  })

  it('navigates to workspace when the workspace CTA is clicked', () => {
    render(<Forbidden />)
    const btn = screen.getByText('回到工作台')
    fireEvent.click(btn)
    expect(mockNavigate).toHaveBeenCalledWith('/')
  })

})
