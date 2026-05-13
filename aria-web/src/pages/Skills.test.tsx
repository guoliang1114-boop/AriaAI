import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Skills } from './Skills'

describe('Skills', () => {
  it('renders category filter buttons', () => {
    render(<Skills />)
    expect(screen.getByRole('button', { name: 'All Capabilities' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Strategy & Growth' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Finance' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Digital & Tech' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Risk & Compliance' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Org & People' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Market & Client' })).toBeInTheDocument()
  })

  it('filters skills when a category is clicked', () => {
    render(<Skills />)
    const financeBtn = screen.getByRole('button', { name: 'Finance' })
    fireEvent.click(financeBtn)
    expect(screen.getByText('Automated CAPEX Modeling')).toBeInTheDocument()
    expect(screen.queryByText('Market Penetration Matrix')).not.toBeInTheDocument()
  })

  it('renders skill cards with title and description', () => {
    render(<Skills />)
    expect(screen.getByText('Market Penetration Matrix')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Advanced analysis for expansion strategies. Automatically calculates TAM/SAM/SOM based on real-time competitor data streams and regulatory hurdles.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('Automated CAPEX Modeling')).toBeInTheDocument()
  })

  it('renders CTA section', () => {
    render(<Skills />)
    expect(screen.getByText("Can't find a specific skill?")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Request Custom Workflow' })).toBeInTheDocument()
  })
})
