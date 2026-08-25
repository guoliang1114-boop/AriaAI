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

  it('does not resolve stakeholders for a stale client match', async () => {
    const firstClients = deferred<Array<{ id: number; name: string }>>()
    const secondClients = deferred<Array<{ id: number; name: string }>>()
    mockGet.mockImplementation((url: string) => {
      if (url === '/clients') {
        return mockGet.mock.calls.filter(([calledUrl]) => calledUrl === '/clients').length === 1
          ? firstClients.promise
          : secondClients.promise
      }
      if (url === '/clients/2/stakeholders') return Promise.resolve([stakeholder(20, 2)])
      return Promise.resolve([stakeholder(10, 1)])
    })

    const { result, rerender } = renderHook(
      ({ clientName }) => useClientStakeholders(clientName),
      { initialProps: { clientName: '旧客户' } },
    )
    rerender({ clientName: '新客户' })

    await act(async () => secondClients.resolve([{ id: 2, name: '新客户' }]))
    await waitFor(() => expect(result.current.matchedClientId).toBe(2))
    await act(async () => firstClients.resolve([{ id: 1, name: '旧客户' }]))
    expect(result.current.matchedClientId).toBe(2)
    expect(mockGet).not.toHaveBeenCalledWith('/clients/1/stakeholders')
  })
})
