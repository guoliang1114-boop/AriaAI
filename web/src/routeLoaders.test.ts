import { describe, it, expect } from 'vitest'
import {
  primaryRouteLoaders,
  warmPrimaryRoutes,
  loadChat,
  loadSkills,
  loadProjects,
  loadProjectDetail,
  loadClients,
  loadContacts,
  loadKnowledge,
} from './routeLoaders'

describe('routeLoaders', () => {
  it('primaryRouteLoaders contains 11 primary routes', () => {
    expect(Object.keys(primaryRouteLoaders)).toHaveLength(11)
  })

  it('primaryRouteLoaders maps correct paths', () => {
    expect(primaryRouteLoaders).toHaveProperty('/')
    expect(primaryRouteLoaders).toHaveProperty('/workspace')
    expect(primaryRouteLoaders).toHaveProperty('/weekly')
    expect(primaryRouteLoaders).toHaveProperty('/chat')
    expect(primaryRouteLoaders).toHaveProperty('/skills')
    expect(primaryRouteLoaders).toHaveProperty('/projects')
    expect(primaryRouteLoaders).toHaveProperty('/clients')
    expect(primaryRouteLoaders).toHaveProperty('/contacts')
    expect(primaryRouteLoaders).toHaveProperty('/knowledge')
    expect(primaryRouteLoaders).toHaveProperty('/messages')
    expect(primaryRouteLoaders).toHaveProperty('/settings')
  })

  it('each loader returns a promise', async () => {
    const results = Object.values(primaryRouteLoaders).map(loader => {
      const result = loader()
      expect(result).toBeInstanceOf(Promise)
      return result
    })
    await Promise.allSettled(results)
  })

  it('warmPrimaryRoutes returns a promise', () => {
    const result = warmPrimaryRoutes()
    expect(result).toBeInstanceOf(Promise)
    return result.then(settled => {
      expect(Array.isArray(settled)).toBe(true)
    })
  })

  it('individual loaders return promises', async () => {
    const results = [
      loadChat(),
      loadSkills(),
      loadProjects(),
      loadProjectDetail(),
      loadClients(),
      loadContacts(),
      loadKnowledge(),
    ]
    results.forEach((result) => expect(result).toBeInstanceOf(Promise))
    await Promise.allSettled(results)
  })
})
