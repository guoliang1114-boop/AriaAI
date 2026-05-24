import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ThemeProvider, useTheme } from './ThemeContext'

function TestComponent() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button onClick={() => setTheme('dark')}>Dark</button>
      <button onClick={() => setTheme('light')}>Light</button>
      <button onClick={() => setTheme('system')}>System</button>
    </div>
  )
}

function renderWithProvider() {
  return render(
    <ThemeProvider>
      <TestComponent />
    </ThemeProvider>,
  )
}

describe('ThemeContext', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  it('defaults to system theme when nothing stored', () => {
    renderWithProvider()
    expect(screen.getByTestId('theme')).toHaveTextContent('system')
  })

  it('reads stored theme from localStorage', () => {
    localStorage.setItem('theme', 'dark')
    renderWithProvider()
    expect(screen.getByTestId('theme')).toHaveTextContent('dark')
  })

  it('sets dark theme and applies class to html', async () => {
    renderWithProvider()
    const user = (await import('@testing-library/user-event')).default.setup()
    await user.click(screen.getByText('Dark'))

    expect(screen.getByTestId('theme')).toHaveTextContent('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('theme')).toBe('dark')
  })

  it('sets light theme and removes dark class from html', async () => {
    document.documentElement.classList.add('dark')
    localStorage.setItem('theme', 'dark')
    renderWithProvider()
    const user = (await import('@testing-library/user-event')).default.setup()
    await user.click(screen.getByText('Light'))

    expect(screen.getByTestId('theme')).toHaveTextContent('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('theme')).toBe('light')
  })

  it('resolvedTheme is light for system theme when matchMedia returns false', () => {
    renderWithProvider()
    // Our mock matchMedia returns matches: false, so system resolves to light
    expect(screen.getByTestId('resolved')).toHaveTextContent('light')
  })

  it('resolvedTheme matches explicit dark theme', async () => {
    renderWithProvider()
    const user = (await import('@testing-library/user-event')).default.setup()
    await user.click(screen.getByText('Dark'))
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark')
  })

  it('useTheme throws when used outside ThemeProvider', () => {
    function BadComponent() {
      useTheme()
      return null
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<BadComponent />)).toThrow('useTheme must be used within a ThemeProvider')
    spy.mockRestore()
  })
})
