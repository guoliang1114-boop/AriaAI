import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Projects } from './Projects'

describe('Projects', () => {
  it('renders portfolio title', () => {
    render(<Projects />)
    expect(screen.getByText('Consulting Portfolio')).toBeInTheDocument()
  })

  it('renders active and archived tabs', () => {
    render(<Projects />)
    expect(screen.getByRole('button', { name: 'Active' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Archived' })).toBeInTheDocument()
  })

  it('switches to archived tab', () => {
    render(<Projects />)
    const archivedBtn = screen.getByRole('button', { name: 'Archived' })
    fireEvent.click(archivedBtn)
    expect(archivedBtn).toHaveClass('bg-blue-600')
  })

  it('renders project cards', () => {
    render(<Projects />)
    expect(screen.getByText('Risk Mitigation Protocol')).toBeInTheDocument()
    expect(screen.getByText('AI Patient Diagnostics')).toBeInTheDocument()
    expect(screen.getByText('Omnichannel Strategy')).toBeInTheDocument()
  })

  it('renders new project card', () => {
    render(<Projects />)
    expect(screen.getByText('Initiate New Consulting Project')).toBeInTheDocument()
  })

  it('renders sidebar panels', () => {
    render(<Projects />)
    expect(screen.getByText('AI CONTEXT INTELLIGENCE')).toBeInTheDocument()
    expect(screen.getByText('Global Milestones')).toBeInTheDocument()
    expect(screen.getByText('Recent Library')).toBeInTheDocument()
  })
})
