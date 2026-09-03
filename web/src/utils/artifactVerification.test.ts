import { describe, expect, it } from 'vitest'
import type { ArtifactVerificationSummary } from '../types/productRunEvent'
import { artifactVerificationLabel } from './artifactVerification'

function verification(
  status: ArtifactVerificationSummary['status'],
): ArtifactVerificationSummary {
  return {
    schema_version: 1,
    verification_id: 1,
    verifier_version: 1,
    status,
    technical_status: status === 'failed' ? 'failed' : 'passed',
    skill_status: status === 'manual_required' ? 'manual_required' : 'not_declared',
    content_sha256: 'a'.repeat(64),
    evidence_sha256: 'b'.repeat(64),
    automated_check_count: 5,
    automated_passed_count: status === 'failed' ? 4 : 5,
    automated_failed_count: status === 'failed' ? 1 : 0,
    automated_skipped_count: 0,
    skill_check_count: status === 'manual_required' ? 3 : 0,
    metrics: {},
  }
}

describe('artifactVerificationLabel', () => {
  it('distinguishes automatic pass, failure and pending business acceptance', () => {
    expect(artifactVerificationLabel(verification('passed'))).toBe('技术校验通过 5/5')
    expect(artifactVerificationLabel(verification('failed'))).toBe('技术校验失败 1 项')
    expect(artifactVerificationLabel(verification('manual_required'))).toBe(
      '技术通过 · 3 项待业务验收',
    )
  })
})
