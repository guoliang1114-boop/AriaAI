import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Dashboard } from './Dashboard'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

describe('Dashboard', () => {
  it('renders hero section with title and subtitle', () => {
    render(<Dashboard />)
    expect(screen.getByText('dashboard.hero.title')).toBeInTheDocument()
    expect(screen.getByText('dashboard.hero.subtitle')).toBeInTheDocument()
  })

  it('renders deep tasks section', () => {
    render(<Dashboard />)
    expect(screen.getByText('dashboard.deepTasks.title')).toBeInTheDocument()
    expect(screen.getByText('dashboard.deepTasks.description')).toBeInTheDocument()
  })

  it('renders quick tools section', () => {
    render(<Dashboard />)
    expect(screen.getByText('dashboard.quickTools.title')).toBeInTheDocument()
    expect(screen.getByText('dashboard.quickTools.description')).toBeInTheDocument()
  })

  it('renders project space section with project cards', () => {
    render(<Dashboard />)
    expect(screen.getByText('dashboard.projectSpace.title')).toBeInTheDocument()
    expect(screen.getByText('dashboard.projectSpace.description')).toBeInTheDocument()
    expect(screen.getByText('Global Logistics Q4')).toBeInTheDocument()
    expect(screen.getByText('Retail Expansion')).toBeInTheDocument()
  })

  it('renders recent intelligence section with items', () => {
    render(<Dashboard />)
    expect(screen.getByText('dashboard.recentIntelligence.title')).toBeInTheDocument()
    expect(screen.getByText('Automotive EV Trends 2025')).toBeInTheDocument()
    expect(screen.getByText('Series B - FinTech Narrative')).toBeInTheDocument()
    expect(screen.getByText('Product Alignment Sync')).toBeInTheDocument()
  })
})
