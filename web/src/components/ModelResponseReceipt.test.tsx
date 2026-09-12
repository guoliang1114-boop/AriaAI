import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ModelResponseReceipt } from './ModelResponseReceipt'

describe('ModelResponseReceipt', () => {
  it('distinguishes connection, reasoning and text onset without adding durations', () => {
    render(<ModelResponseReceipt metadataJson={JSON.stringify({ stage_timings: {
      provider_headers_ms: 100, provider_reasoning_ms: 800, provider_text_ms: 4000,
    }, model_response_policy: { scope: 'bounded_readonly_rewrite', reasoning_effort: 'low' } })} />)
    expect(screen.getByText('简短改写 · low · 连接响应 0.1s · 开始思考 0.8s · 开始正文 4.0s')).toBeInTheDocument()
  })
  it.each(['bad', '{}', 'null', '{"stage_timings":{"provider_text_ms":"120"}}', '{"stage_timings":{"provider_text_ms":-1}}'])('ignores missing and invalid timing %s', value => {
    const { container } = render(<ModelResponseReceipt metadataJson={value} />)
    expect(container).toBeEmptyDOMElement()
  })
})
