import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ClientStakeholder,
  Conversation,
  Message,
  ProjectDetail,
  ProjectMeetingBriefing,
} from '../../../types/api'
import {
  useClientStakeholders,
  useConversationMessages,
  useProjectBriefing,
  useProjectConversations,
  useProjectDetail,
} from './useProjectsApi'

const mockGet = vi.fn()

vi.mock('../../../api/client', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function projectDetail(id: number): ProjectDetail {
  return { project: { id, name: `项目${id}` } } as ProjectDetail
}

function briefing(id: number): ProjectMeetingBriefing {
  return { project: { id, name: `项目${id}` } } as ProjectMeetingBriefing
}

function conversation(id: number, projectId: number): Conversation {
  return {
    id,
    project_id: projectId,
    title: `会话${id}`,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function message(id: number, conversationId: number): Message {
  return {
    id,
    conversation_id: conversationId,
    role: 'assistant',
    content: `消息${id}`,
    metadata_json: '{}',
    created_at: '2026-01-01T00:00:00Z',
  }
}

function stakeholder(id: number, clientId: number): ClientStakeholder {
  return {
    id,
    client_id: clientId,
    name: `联系人${id}`,
    role: '',
    organization_level: '',
    influence_type: '',
    relationship_status: '',
    concerns: '',
    sensitivities: '',
    communication_preference: '',
    contact: '',
    last_action: '',
    personality_profile: '',
    decision_style: '',
    communication_strategy: '',
    trust_signals: '',
    note: '',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

describe('project data hooks', () => {
  beforeEach(() => {
    mockGet.mockReset()
  })

  it('keeps the newest project detail when route requests finish out of order', async () => {
    const first = deferred<ProjectDetail>()
    const second = deferred<ProjectDetail>()
    mockGet.mockImplementation((url: string) => url === '/projects/1/detail' ? first.promise : second.promise)

    const { result, rerender } = renderHook(
      ({ projectId }) => useProjectDetail(projectId),
      { initialProps: { projectId: 1 } },
    )
    rerender({ projectId: 2 })

    await act(async () => second.resolve(projectDetail(2)))
    await waitFor(() => expect(result.current.data?.project.id).toBe(2))
    await act(async () => first.resolve(projectDetail(1)))
    expect(result.current.data?.project.id).toBe(2)
  })

  it('keeps the newest project conversation list', async () => {
    const first = deferred<Conversation[]>()
    const second = deferred<Conversation[]>()
    mockGet.mockImplementation((url: string) => url.includes('project_id=1') ? first.promise : second.promise)

    const { result, rerender } = renderHook(
      ({ projectId }) => useProjectConversations(projectId),
      { initialProps: { projectId: 1 } },
    )
    rerender({ projectId: 2 })

    await act(async () => second.resolve([conversation(20, 2)]))
    await waitFor(() => expect(result.current.data[0]?.project_id).toBe(2))
    await act(async () => first.resolve([conversation(10, 1)]))
    expect(result.current.data[0]?.project_id).toBe(2)
  })

  it('keeps the newest conversation messages', async () => {
    const first = deferred<Message[]>()
    const second = deferred<Message[]>()
    mockGet.mockImplementation((url: string) => url.includes('/1/') ? first.promise : second.promise)

    const { result, rerender } = renderHook(
      ({ conversationId }) => useConversationMessages(conversationId),
      { initialProps: { conversationId: 1 } },
    )
    rerender({ conversationId: 2 })

    await act(async () => second.resolve([message(20, 2)]))
    await waitFor(() => expect(result.current.data[0]?.conversation_id).toBe(2))
    await act(async () => first.resolve([message(10, 1)]))
    expect(result.current.data[0]?.conversation_id).toBe(2)
  })

  it('keeps the newest project briefing', async () => {
    const first = deferred<ProjectMeetingBriefing>()
    const second = deferred<ProjectMeetingBriefing>()
    mockGet.mockImplementation((url: string) => url === '/projects/1/briefing' ? first.promise : second.promise)

    const { result, rerender } = renderHook(
      ({ projectId }) => useProjectBriefing(projectId),
      { initialProps: { projectId: 1 } },
    )
    rerender({ projectId: 2 })

    await act(async () => second.resolve(briefing(2)))
    await waitFor(() => expect(result.current.data?.project.id).toBe(2))
    await act(async () => first.resolve(briefing(1)))
    expect(result.current.data?.project.id).toBe(2)
  })

  it('loads stakeholders directly from the stable client id', async () => {
    mockGet.mockResolvedValue([stakeholder(20, 2)])

    const { result } = renderHook(() => useClientStakeholders(2, '同名客户'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.matchedClientId).toBe(2)
    expect(result.current.matchedClientName).toBe('同名客户')
    expect(result.current.stakeholders).toEqual([stakeholder(20, 2)])
    expect(mockGet).toHaveBeenCalledTimes(1)
    expect(mockGet).toHaveBeenCalledWith('/clients/2/stakeholders')
    expect(mockGet).not.toHaveBeenCalledWith('/clients')
  })

  it('does not scan clients or load stakeholders when client id is missing', async () => {
    const { result } = renderHook(() => useClientStakeholders(null, '同名客户'))

    expect(result.current.loading).toBe(false)
    expect(result.current.matchedClientId).toBeNull()
    expect(result.current.matchedClientName).toBeNull()
    expect(result.current.stakeholders).toEqual([])
    expect(result.current.error).toBeNull()
    await act(async () => result.current.refetch())
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('does not apply stale stakeholders after the linked client changes', async () => {
    const firstStakeholders = deferred<ClientStakeholder[]>()
    const secondStakeholders = deferred<ClientStakeholder[]>()
    mockGet.mockImplementation((url: string) => {
      if (url === '/clients/1/stakeholders') return firstStakeholders.promise
      if (url === '/clients/2/stakeholders') return secondStakeholders.promise
      return Promise.resolve([])
    })

    const { result, rerender } = renderHook(
      ({ clientId, clientName }) => useClientStakeholders(clientId, clientName),
      { initialProps: { clientId: 1, clientName: '旧客户' } },
    )
    rerender({ clientId: 2, clientName: '新客户' })

    await act(async () => secondStakeholders.resolve([stakeholder(20, 2)]))
    await waitFor(() => expect(result.current.matchedClientId).toBe(2))
    await act(async () => firstStakeholders.resolve([stakeholder(10, 1)]))
    expect(result.current.matchedClientId).toBe(2)
    expect(result.current.stakeholders).toEqual([stakeholder(20, 2)])
  })
})
