/** Timings contain no provider reasoning, prompt text, or tool arguments. */
export function ModelResponseReceipt({ metadataJson }: { metadataJson: string }) {
  let metadata
  try { metadata = JSON.parse(metadataJson || '{}') } catch { return null }
  const timing = metadata?.stage_timings
  if (!timing || typeof timing !== 'object') return null
  const labels: [string, string][] = [
    ['provider_headers_ms', '连接响应'], ['provider_reasoning_ms', '开始思考'],
    ['provider_text_ms', '开始正文'], ['provider_tool_ms', '开始工具计划'],
  ]
  const entries = labels.flatMap(([key, label]) => {
    const value = timing[key]
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 600_000
      ? [`${label} ${(value / 1000).toFixed(1)}s`] : []
  })
  if (!entries.length) return null
  const policy = metadata?.model_response_policy
  const shortRewrite = policy?.scope === 'bounded_readonly_rewrite' && policy.reasoning_effort === 'low'
  return <p style={{ fontSize: 11, color: 'var(--color-codex-ink-mute)', marginTop: 6 }}
    title="首个模型调用的阶段起始时刻，从发起调用算起，不相加；后续重试单独记录。开始正文不等于正文已通过字数校验。未记录的阶段不作推断。">
    {shortRewrite ? '简短改写 · low · ' : ''}{entries.join(' · ')}
  </p>
}
