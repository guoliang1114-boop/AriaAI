import type { ArtifactVerificationSummary } from '../types/productRunEvent'

export function artifactVerificationLabel(
  verification?: ArtifactVerificationSummary,
): string {
  if (!verification) return ''
  switch (verification.status) {
    case 'passed':
      return `技术校验通过 ${verification.automated_passed_count}/${verification.automated_check_count}`
    case 'failed':
      return `技术校验失败 ${verification.automated_failed_count} 项`
    case 'manual_required':
      return `技术通过 · ${verification.skill_check_count} 项待业务验收`
    case 'partial':
      return verification.skill_status === 'context_incomplete'
        ? '部分校验 · Skill 上下文不完整'
        : '部分校验 · 含未支持格式'
  }
}
