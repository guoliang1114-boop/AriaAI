import { describe, it, expect } from 'vitest'
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_OPTIONS,
  PROJECT_STATUS_COLORS,
  UI_SUB_STAGES,
  toBackendStatus,
  getStageLabel,
  PROJECT_STAGE_CONFIGS,
  PROJECT_STAGE_IDS,
  resolveProjectStage,
  PROVIDER_LABELS,
  PRIORITY_LABELS,
  PAYMENT_TYPE_LABELS,
  VECTOR_STATUS_LABELS,
} from './enums'

describe('PROJECT_STATUS_LABELS', () => {
  it('contains all 5 backend statuses', () => {
    expect(Object.keys(PROJECT_STATUS_LABELS)).toEqual(
      expect.arrayContaining(['lead', 'opportunity', 'won', 'delivering', 'archived'])
    )
    expect(Object.keys(PROJECT_STATUS_LABELS)).toHaveLength(5)
  })

  it('all labels are non-empty strings', () => {
    Object.values(PROJECT_STATUS_LABELS).forEach(label => {
      expect(typeof label).toBe('string')
      expect(label.length).toBeGreaterThan(0)
    })
  })
})

describe('PROJECT_STATUS_OPTIONS', () => {
  it('has 5 options matching all statuses', () => {
    expect(PROJECT_STATUS_OPTIONS).toHaveLength(5)
  })

  it('each option has value and label', () => {
    PROJECT_STATUS_OPTIONS.forEach(opt => {
      expect(opt).toHaveProperty('value')
      expect(opt).toHaveProperty('label')
      expect(typeof opt.label).toBe('string')
    })
  })
})

describe('PROJECT_STATUS_COLORS', () => {
  it('has color config for every status', () => {
    Object.keys(PROJECT_STATUS_LABELS).forEach(status => {
      expect(PROJECT_STATUS_COLORS[status as keyof typeof PROJECT_STATUS_COLORS]).toBeDefined()
      expect(PROJECT_STATUS_COLORS[status as keyof typeof PROJECT_STATUS_COLORS]).toHaveProperty('text')
      expect(PROJECT_STATUS_COLORS[status as keyof typeof PROJECT_STATUS_COLORS]).toHaveProperty('bg')
      expect(PROJECT_STATUS_COLORS[status as keyof typeof PROJECT_STATUS_COLORS]).toHaveProperty('border')
    })
  })
})

describe('UI_SUB_STAGES', () => {
  it('maps all sub-stages to valid backend statuses', () => {
    Object.values(UI_SUB_STAGES).forEach(status => {
      expect(Object.keys(PROJECT_STATUS_LABELS)).toContain(status)
    })
  })

  it('contains expected sub-stages', () => {
    expect(UI_SUB_STAGES).toHaveProperty('lead_discovery')
    expect(UI_SUB_STAGES).toHaveProperty('opportunity_qualified')
    expect(UI_SUB_STAGES).toHaveProperty('proposal')
    expect(UI_SUB_STAGES).toHaveProperty('negotiation')
    expect(UI_SUB_STAGES).toHaveProperty('contracting')
    expect(UI_SUB_STAGES).toHaveProperty('kickoff')
    expect(UI_SUB_STAGES).toHaveProperty('execution')
    expect(UI_SUB_STAGES).toHaveProperty('delivery')
    expect(UI_SUB_STAGES).toHaveProperty('support')
    expect(UI_SUB_STAGES).toHaveProperty('archived')
  })
})

describe('toBackendStatus', () => {
  it('maps known sub-stages to backend status', () => {
    expect(toBackendStatus('lead_discovery')).toBe('lead')
    expect(toBackendStatus('opportunity_qualified')).toBe('opportunity')
    expect(toBackendStatus('proposal')).toBe('opportunity')
    expect(toBackendStatus('contracting')).toBe('won')
    expect(toBackendStatus('kickoff')).toBe('delivering')
    expect(toBackendStatus('execution')).toBe('delivering')
    expect(toBackendStatus('archived')).toBe('archived')
  })

  it('passes through unknown stages as-is', () => {
    expect(toBackendStatus('lead')).toBe('lead')
    expect(toBackendStatus('custom_stage')).toBe('custom_stage' as any)
  })
})

describe('getStageLabel', () => {
  it('returns sub-stage label for known sub-stages', () => {
    expect(getStageLabel('lead_discovery')).toBe('发现线索')
    expect(getStageLabel('proposal')).toBe('方案阶段')
    expect(getStageLabel('kickoff')).toBe('项目启动')
  })

  it('returns backend status label for backend statuses', () => {
    expect(getStageLabel('lead')).toBe('线索')
    expect(getStageLabel('opportunity')).toBe('机会')
    expect(getStageLabel('delivering')).toBe('交付中')
  })

  it('returns the input string for truly unknown stages', () => {
    expect(getStageLabel('totally_unknown')).toBe('totally_unknown')
  })
})

describe('PROJECT_STAGE_CONFIGS', () => {
  it('has 10 stage configs', () => {
    expect(PROJECT_STAGE_CONFIGS).toHaveLength(10)
  })

  it('each config has required fields', () => {
    PROJECT_STAGE_CONFIGS.forEach(config => {
      expect(config).toHaveProperty('id')
      expect(config).toHaveProperty('label')
      expect(config).toHaveProperty('labelZh')
      expect(config).toHaveProperty('description')
      expect(config).toHaveProperty('color')
      expect(config).toHaveProperty('bgColor')
      expect(config).toHaveProperty('borderColor')
      expect(config).toHaveProperty('icon')
      expect(config).toHaveProperty('phase')
      expect(['business', 'delivery', 'archived']).toContain(config.phase)
    })
  })
})

describe('PROJECT_STAGE_IDS', () => {
  it('contains all stage ids', () => {
    expect(PROJECT_STAGE_IDS).toHaveLength(10)
    expect(PROJECT_STAGE_IDS).toContain('lead_discovery')
    expect(PROJECT_STAGE_IDS).toContain('archived')
  })
})

describe('resolveProjectStage', () => {
  it('resolves known stage id directly', () => {
    const config = resolveProjectStage('lead_discovery')
    expect(config.id).toBe('lead_discovery')
    expect(config.label).toBe('Lead Discovery')
  })

  it('resolves backend status to fallback stage', () => {
    expect(resolveProjectStage('lead').id).toBe('lead_discovery')
    expect(resolveProjectStage('opportunity').id).toBe('opportunity_qualified')
    expect(resolveProjectStage('won').id).toBe('contracting')
    expect(resolveProjectStage('delivering').id).toBe('execution')
    expect(resolveProjectStage('archived').id).toBe('archived')
  })

  it('returns first config as ultimate fallback for unknown', () => {
    const config = resolveProjectStage('unknown_status')
    expect(config.id).toBe('lead_discovery')
  })
})

describe('PROVIDER_LABELS', () => {
  it('has labels for all providers', () => {
    expect(Object.keys(PROVIDER_LABELS)).toEqual(
      expect.arrayContaining(['claude', 'kimi', 'deepseek', 'bigmodel', 'mimo'])
    )
  })
})

describe('PRIORITY_LABELS', () => {
  it('has labels for low/medium/high', () => {
    expect(PRIORITY_LABELS.low).toBe('低')
    expect(PRIORITY_LABELS.medium).toBe('中')
    expect(PRIORITY_LABELS.high).toBe('高')
  })
})

describe('PAYMENT_TYPE_LABELS', () => {
  it('has labels for all payment types', () => {
    expect(Object.keys(PAYMENT_TYPE_LABELS)).toEqual(
      expect.arrayContaining(['received', 'expense', 'milestone_payment', 'invoiced'])
    )
  })
})

describe('VECTOR_STATUS_LABELS', () => {
  it('has labels for all vector statuses', () => {
    expect(Object.keys(VECTOR_STATUS_LABELS)).toEqual(
      expect.arrayContaining(['pending', 'processing', 'synced', 'failed'])
    )
  })
})
