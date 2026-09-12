/** A receipt is about the saved answer, never a claim about model intelligence. */
export function AnswerLengthReceipt({ metadataJson, only }: { metadataJson: string; only?: 'passed' | 'warning' }) {
  let value: Record<string, unknown>
  try {
    const raw = JSON.parse(metadataJson || '{}')?.answer_length
    if (!raw || typeof raw !== 'object') return null
    value = raw
  } catch { return null }
  const { max_chars: max, actual_chars: actual, repair_count: repairs, status, unit } = value
  if (typeof max !== 'number' || !Number.isSafeInteger(max) || max < 32 || max > 4000
    || typeof actual !== 'number' || !Number.isSafeInteger(actual) || actual < 0
    || typeof repairs !== 'number' || !Number.isSafeInteger(repairs) || repairs < 0 || repairs > 1
    || unit !== 'non_whitespace_unicode_codepoints' || !['passed', 'exceeded'].includes(String(status))) return null
  const passed = status === 'passed' && actual > 0 && actual <= max
  if ((only === 'passed' && !passed) || (only === 'warning' && passed)) return null
  return <p role={passed ? undefined : 'status'} style={{ fontSize: 11, color: passed ? 'var(--color-codex-ink-mute)' : 'var(--color-codex-warn)', marginTop: 6 }}
    title="按最终保存正文统计非空白 Unicode 字符，包含标点、Markdown 标记和引用；不含界面标签。安全提示优先，不会为满足长度而删掉必要提示。">
    {passed ? '字数已核验' : '字数校验未通过'} · {actual}/{max}{repairs > 0 ? ' · 已修正一次' : ''}
  </p>
}
