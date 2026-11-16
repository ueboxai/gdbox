import { describe, expect, it } from 'vitest'
import type { RouteLocationMatched, RouteMeta, RouteLocationNormalizedLoaded } from 'vue-router'
import { getTabIdFromQuery, normalizeStoredTabKey, resolveTabRoute } from './tabRoute'

type TestRoute = Pick<RouteLocationNormalizedLoaded, 'path' | 'fullPath' | 'meta' | 'query'> & {
  matched?: Array<Pick<RouteLocationMatched, 'path' | 'meta'>>
}

function createRoute(route: Partial<TestRoute> & Pick<TestRoute, 'path' | 'fullPath'>): TestRoute {
  return {
    meta: {} as RouteMeta,
    query: {},
    matched: [],
    ...route
  }
}

describe('resolveTabRoute', () => {
  it('uses the parent route key for nested detail routes that share a tab', () => {
    const route = createRoute({
      path: '/notebooks/notebook-1',
      fullPath: '/notebooks/notebook-1',
      meta: { isShowInTab: false, title: 'menu.notebookDetail' } as RouteMeta,
      matched: [
        {
          path: '/notebooks',
          meta: { isShowInTab: true, title: 'menu.notebooks' } as RouteMeta
        },
        {
          path: '/notebooks/:id',
          meta: { isShowInTab: false, title: 'menu.notebookDetail' } as RouteMeta
        }
      ]
    })

    expect(resolveTabRoute(route)).toEqual({
      key: '/notebooks',
      meta: { isShowInTab: true, title: 'menu.notebooks' }
    })
  })

  it('keeps dedicated tab instances keyed by fullPath when _tab_id is present', () => {
    const route = createRoute({
      path: '/asset-management',
      fullPath: '/asset-management?_tab_id=123',
      meta: { isShowInTab: true, title: 'menu.assetLib' } as RouteMeta,
      query: { _tab_id: '123' }
    })

    expect(resolveTabRoute(route)).toEqual({
      key: '/asset-management?_tab_id=123',
      meta: { isShowInTab: true, title: 'menu.assetLib' }
    })
  })

  it('returns null for spotlight routes', () => {
    const route = createRoute({
      path: '/spotlight',
      fullPath: '/spotlight',
      meta: { isShowInTab: false } as RouteMeta
    })

    expect(resolveTabRoute(route)).toBeNull()
  })
})

describe('getTabIdFromQuery', () => {
  it('falls back to the default tab when _tab_id is missing or blank', () => {
    expect(getTabIdFromQuery({})).toBe('default')
    expect(getTabIdFromQuery({ _tab_id: '  ' })).toBe('default')
    expect(getTabIdFromQuery({ _tab_id: ['t1'] })).toBe('default')
  })

  it('returns the dedicated tab id', () => {
    expect(getTabIdFromQuery({ _tab_id: 't1' })).toBe('t1')
  })
})

describe('preferences tab keyed by path', () => {
  it('opens one preferences tab whatever ?tab= is requested', () => {
    const meta = { isShowInTab: true, title: 'common.preferences' } as RouteMeta
    const a = resolveTabRoute(createRoute({ path: '/preferences', fullPath: '/preferences', meta }))
    const b = resolveTabRoute(
      createRoute({ path: '/preferences', fullPath: '/preferences?tab=models', meta })
    )
    expect(a?.key).toBe('/preferences')
    expect(b?.key).toBe('/preferences')
  })

  it('merges stored preferences keys but leaves other query-keyed tabs alone', () => {
    expect(normalizeStoredTabKey('/preferences?tab=models')).toBe('/preferences')
    expect(normalizeStoredTabKey('/dev-assistant?sid=s1')).toBe('/dev-assistant?sid=s1')
  })
})
