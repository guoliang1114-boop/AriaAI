import type { ContextReceiptEvent } from '../../../types/productRunEvent'

interface SkillCandidateButtonsProps {
  candidates: NonNullable<ContextReceiptEvent['skill']['candidates']>
  onSelect: (skillId: number, name: string) => void
}

export function SkillCandidateButtons({ candidates, onSelect }: SkillCandidateButtonsProps) {
  const selectable = candidates.flatMap((candidate) => {
    const skillId = Number(candidate.id)
    return Number.isSafeInteger(skillId) && skillId > 0
      ? [{ ...candidate, skillId }]
      : []
  })
  if (selectable.length === 0) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
      {selectable.map((candidate) => (
        <button
          key={candidate.skillId}
          type="button"
          onClick={() => onSelect(candidate.skillId, candidate.name)}
          style={{
            padding: '3px 7px',
            color: 'var(--accent)',
            background: 'var(--accent-bg)',
            border: '1px solid color-mix(in oklch, var(--accent) 24%, var(--line))',
            borderRadius: 'var(--r-sm)',
            fontSize: 10.5,
          }}
        >
          下一轮使用 {candidate.name}
        </button>
      ))}
    </div>
  )
}
