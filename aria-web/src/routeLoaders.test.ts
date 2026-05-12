import { describe, it, expect } from 'vitest'
import {
  primaryRouteLoaders,
  warmPrimaryRoutes,
  loadWelcome,
  loadChat,
  loadSkills,
  loadProjects,
  loadProjectDetail,
  loadClients,
  loadContacts,
  loadKnowledge,
} from './routeLoaders'

describe('routeLoaders', () => {
  it('primaryRouteLoaders contains 9 primary routes', () => {
    expect(Object.keys(primaryRouteLoaders)).toHaveLength(9)
  })

  it('primaryRouteLoaders maps correct paths', () => {
    expect(primaryRouteLoaders).toHaveProperty('/')
    expect(primaryRouteLoaders).toHaveProperty('/chat')
    expect(primaryRouteLoaders).toHaveProperty('/skills')
    expect(primaryRouteLoaders).toHaveProperty('/projects')
    expect(primaryRouteLoaders).toHaveProperty('/clients')
    expect(primaryRouteLoaders).toHaveProperty('/contacts')
    expect(primaryRouteLoaders).toHaveProperty('/knowledge')
    expect(primaryRouteLoaders).toHaveProperty('/messages')
    expect(primaryRouteLoaders).toHaveProperty('/settings')
  })

  it('each loader returns a promise', () => {
    Object.values(primaryRouteLoaders).forEach(loader => {
      const result = loader()
      expect(result).toBeInstanceOf(Promise)
      // Clean up the promise to avoid unhandled rejections
      result.catch(() => {})
    })
  })

  it('warmPrimaryRoutes returns a promise', () => {
    const result = warmPrimaryRoutes()
    expect(result).toBeInstanceOf(Promise)
    return result.then(settled => {
      expect(Array.isArray(settled)).toBe(true)
    })
  })

  it('individual loaders return promises', () => {
    expect(loadWelcome()).toBeInstanceOf(Promise)
    expect(loadChat()).toBeInstanceOf(Promise)
    expect(loadSkills()).toBeInstanceOf(Promise)
    expect(loadProjects()).toBeInstanceOf(Promise)
    expect(loadProjectDetail()).toBeInstanceOf(Promise)
    expect(loadClients()).toBeInstanceOf(Promise)
    expect(loadContacts()).toBeInstanceOf(Promise)
    expect(loadKnowledge()).toBeInstanceOf(Promise)
  })
})
