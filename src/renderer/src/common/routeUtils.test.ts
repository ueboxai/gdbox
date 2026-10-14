import { describe, expect, it } from 'vitest'
import { isReactive, ref } from 'vue'
import type { RouteRecordRaw } from 'vue-router'
import {
  findMenuTargetByKey,
  generateMenuFromRoutes,
  getOpenMenuKeys,
  getSelectedMenuKeys,
  type MenuItem
} from './routeUtils'

describe('routeUtils', () => {
  it('keeps icons raw in reactive menus, including nested items and regenerated labels', () => {
    const routes = [
      {
        path: '/',
        children: [
          {
            path: '/notebooks',
            name: 'Notebooks',
            meta: { title: 'menu.notebooks' },
            children: [{ path: '', name: 'NotebookList', meta: { title: 'menu.notebooks' } }]
          },
          { path: '/asset-management', name: 'Assets', meta: { title: 'menu.assets' } }
        ]
      }
    ] as unknown as RouteRecordRaw[]
    const menu = ref<MenuItem[]>([])

    for (const locale of ['zh-CN', 'en-US']) {
      const generated = generateMenuFromRoutes(routes, (key) => `${locale}:${key}`)
      menu.value = generated
      expect(isReactive(menu.value[0])).toBe(true)
      const items = [menu.value[0], menu.value[0].children![0], menu.value[1]]
      const originals = [generated[0], generated[0].children![0], generated[1]]
      items.forEach((item, index) => {
        expect(isReactive(item.icon)).toBe(false)
        expect(item.icon).toBe(originals[index].icon)
        expect(item.label).toBe(`${locale}:${index === 2 ? 'menu.assets' : 'menu.notebooks'}`)
      })
    }
  })

  it('normalizes generated child paths without duplicate trailing separators', () => {
    const routes = [
      {
        path: '/',
        children: [
          {
            path: '/notebooks',
            name: 'Notebooks',
            meta: {
              title: 'menu.notebooks',
              isShowInMenu: true
            },
            children: [
              {
                path: '',
                name: 'NotebookList',
                meta: {
                  title: 'menu.notebooks',
                  isShowInMenu: true
                }
              }
            ]
          }
        ]
      }
    ] as unknown as RouteRecordRaw[]

    const menu = generateMenuFromRoutes(routes, (key) => key)

    expect(menu[0]?.children?.[0]?.path).toBe('/notebooks')
  })

  it('keeps top-level libraries selected on nested detail paths', () => {
    const menuItems: MenuItem[] = [
      {
        key: 'Notebooks',
        icon: null,
        label: 'Notebooks',
        path: '/notebooks'
      },
      {
        key: 'AIGCStudio',
        icon: null,
        label: 'AI Studio',
        path: '/aigc-studio'
      }
    ]

    expect(getSelectedMenuKeys('/notebooks/notebook-123', menuItems)).toEqual(['Notebooks'])
    expect(getSelectedMenuKeys('/aigc-studio/item-123', menuItems)).toEqual(['AIGCStudio'])
  })

  it('matches dynamic child menu routes when computing selected and open keys', () => {
    const menuItems: MenuItem[] = [
      {
        key: 'Workspace',
        icon: null,
        label: 'Workspace',
        path: '/workspace',
        children: [
          {
            key: 'WorkspaceProjectDetail',
            icon: null,
            label: 'Project Detail',
            path: '/workspace/projects/:id'
          }
        ]
      }
    ]

    expect(getSelectedMenuKeys('/workspace/projects/project-a', menuItems)).toEqual([
      'WorkspaceProjectDetail'
    ])
    expect(getOpenMenuKeys('/workspace/projects/project-a', menuItems)).toEqual(['Workspace'])
  })

  it('resolves the canonical navigation target from a menu key', () => {
    const menuItems: MenuItem[] = [
      {
        key: 'Notebooks',
        icon: null,
        label: 'Notebooks',
        path: '/notebooks'
      },
      {
        key: 'Workspace',
        icon: null,
        label: 'Workspace',
        path: '/workspace',
        children: [
          {
            key: 'WorkspaceProjects',
            icon: null,
            label: 'Projects',
            path: '/workspace/projects'
          }
        ]
      }
    ]

    expect(findMenuTargetByKey(menuItems, 'Notebooks')).toBe('/notebooks')
    expect(findMenuTargetByKey(menuItems, 'WorkspaceProjects')).toBe('/workspace/projects')
    expect(findMenuTargetByKey(menuItems, 'Missing')).toBeNull()
  })
})
