import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { manageIdle } from '@renderer/api/capabilityIdle'
import CapabilityIdle from './CapabilityIdle.vue'

vi.mock('@renderer/api/capabilityIdle', () => ({ manageIdle: vi.fn() }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key, locale: 'en-US' }) }))

it('shows the MCP reason and restores from the settings panel in one click', async () => {
  vi.mocked(manageIdle)
    .mockResolvedValueOnce({
      auto: true,
      rows: [
        {
          id: 'draw',
          since: 1,
          disabled: 'auto'
        }
      ]
    })
    .mockResolvedValueOnce({ auto: true, rows: [] })
  const panel = mount(CapabilityIdle, { props: { kind: 'mcp' } })
  await flushPromises()
  expect(panel.text()).toContain('capabilityIdle.autoOff')
  await panel.get('.app-button').trigger('click')
  await flushPromises()
  expect(manageIdle).toHaveBeenLastCalledWith('mcp', { action: 'restore', id: 'draw' })
  expect(panel.text()).not.toContain('draw')
  expect(panel.emitted('changed')).toHaveLength(1)
  panel.unmount()
})

it('offers a skill reminder with manual actions only', async () => {
  vi.mocked(manageIdle).mockResolvedValueOnce({ auto: false, rows: [{ id: 'paint', since: 1 }] })
  const panel = mount(CapabilityIdle, { props: { kind: 'skill' } })
  await flushPromises()
  expect(panel.find('[role="switch"]').exists()).toBe(false)
  expect(panel.text()).toContain('capabilityIdle.unused')
  expect(panel.text()).toContain('capabilityIdle.keep')
  expect(panel.text()).toContain('capabilityIdle.disable')
  panel.unmount()
})
