import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ThemeToggle } from './ThemeToggle'
import { ThemeProvider } from '../contexts/ThemeContext'

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  )
}

describe('ThemeToggle', () => {
  it('renders three theme buttons', () => {
    renderToggle()
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(3)
  })

  it('buttons have correct title attributes', () => {
    renderToggle()
    expect(screen.getByTitle('浅色')).toBeInTheDocument()
    expect(screen.getByTitle('深色')).toBeInTheDocument()
    expect(screen.getByTitle('系统')).toBeInTheDocument()
  })

  it('clicking dark button sets dark theme', async () => {
    renderToggle()
    const user = (await import('@testing-library/user-event')).default.setup()
    await user.click(screen.getByTitle('深色'))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('clicking light button sets light theme', async () => {
    document.documentElement.classList.add('dark')
    renderToggle()
    const user = (await import('@testing-library/user-event')).default.setup()
    await user.click(screen.getByTitle('浅色'))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
