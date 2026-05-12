import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ServiceErrorState } from './ServiceErrorState'

const baseProps = {
  badge: 'Service Unavailable',
  title: 'Something went wrong',
  description: 'The server is not responding.',
  hintTitle: 'What you can do',
  hints: ['Check your connection', 'Try again later'],
  actions: [
    { label: 'Retry', onClick: vi.fn() },
    { label: 'Go Back', onClick: vi.fn(), variant: 'secondary' as const },
  ],
}

describe('ServiceErrorState', () => {
  it('renders badge, title, and description', () => {
    render(<ServiceErrorState {...baseProps} />)
    expect(screen.getByText('Service Unavailable')).toBeInTheDocument()
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('The server is not responding.')).toBeInTheDocument()
  })

  it('renders hints', () => {
    render(<ServiceErrorState {...baseProps} />)
    expect(screen.getByText('What you can do')).toBeInTheDocument()
    expect(screen.getByText('Check your connection')).toBeInTheDocument()
    expect(screen.getByText('Try again later')).toBeInTheDocument()
  })

  it('renders action buttons', () => {
    render(<ServiceErrorState {...baseProps} />)
    expect(screen.getByText('Retry')).toBeInTheDocument()
    expect(screen.getByText('Go Back')).toBeInTheDocument()
  })

  it('calls onClick when action button is clicked', async () => {
    const retryFn = vi.fn()
    render(<ServiceErrorState {...baseProps} actions={[{ label: 'Retry', onClick: retryFn }]} />)
    const user = (await import('@testing-library/user-event')).default.setup()
    await user.click(screen.getByText('Retry'))
    expect(retryFn).toHaveBeenCalledOnce()
  })

  it('renders detail block when detail is provided', () => {
    render(<ServiceErrorState {...baseProps} detail="500 Internal Server Error" detailLabel="Error Code" />)
    expect(screen.getByText('500 Internal Server Error')).toBeInTheDocument()
    expect(screen.getByText('Error Code')).toBeInTheDocument()
  })

  it('does not render detail block when detail is null', () => {
    const { container } = render(<ServiceErrorState {...baseProps} detail={null} />)
    expect(container.textContent).not.toContain('Error detail')
  })

  it('renders links section when links are provided', () => {
    const links = [
      { label: 'Go to Projects', description: 'View your projects', onClick: vi.fn() },
    ]
    render(<ServiceErrorState {...baseProps} links={links} linksTitle="Quick Links" />)
    expect(screen.getByText('Quick Links')).toBeInTheDocument()
    expect(screen.getByText('Go to Projects')).toBeInTheDocument()
    expect(screen.getByText('View your projects')).toBeInTheDocument()
  })

  it('does not render links section when links is empty', () => {
    render(<ServiceErrorState {...baseProps} links={[]} />)
    expect(screen.queryByText('Quick links')).not.toBeInTheDocument()
  })

  it('uses default linksTitle "Quick links"', () => {
    const links = [{ label: 'Test', description: 'Desc', onClick: vi.fn() }]
    render(<ServiceErrorState {...baseProps} links={links} />)
    expect(screen.getByText('Quick links')).toBeInTheDocument()
  })
})
