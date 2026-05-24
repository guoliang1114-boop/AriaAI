import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { HelmetProvider } from 'react-helmet-async'
import { PageTitle } from './PageTitle'

function renderWithTitle(props: { title: string; suffix?: string }) {
  return render(
    <HelmetProvider>
      <PageTitle {...props} />
    </HelmetProvider>,
  )
}

describe('PageTitle', () => {
  it('renders title with default suffix', () => {
    renderWithTitle({ title: 'Dashboard' })
    expect(document.title).toBe('Dashboard · Aria AI')
  })

  it('renders title with custom suffix', () => {
    renderWithTitle({ title: 'Settings', suffix: 'MyApp' })
    expect(document.title).toBe('Settings · MyApp')
  })

  it('renders only suffix when title is empty', () => {
    renderWithTitle({ title: '' })
    expect(document.title).toBe('Aria AI')
  })
})
