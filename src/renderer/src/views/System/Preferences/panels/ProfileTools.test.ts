import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type DOMWrapper } from '@vue/test-utils'
import ProfileTools from './ProfileTools.vue'

const errorMessage = vi.hoisted(() => vi.fn())
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/utils/messageManager', () => ({ message: { error: errorMessage } }))

const getSettings = vi.fn()
const setSettings = vi.fn()
const listTools = vi.fn()

const CATALOG: AgentV3ToolSummary[] = [
  {
    name: 'godot_check',
    namespace: 'godot',
    description: '检查项目报错。【参数说明】：scene 要检查的场景（选填）',
    risk: 'mutating',
    defaultResident: false,
    tokens: 400
  },
  {
    name: 'godot_run',
    namespace: 'godot',
    description: '运行项目',
    risk: 'mutating',
    defaultResident: false,
    tokens: 400
  },
  {
    name: 'other_tool',
    namespace: 'brand-new',
    description: '没登记大类的工具',
    risk: 'mutating',
    defaultResident: false,
    tokens: 400
  },
  {
    name: 'gen_sprite',
    namespace: 'godot.asset',
    description: '生成一张精灵图',
    risk: 'mutating',
    defaultResident: false,
    tokens: 400
  },
  {
    name: 'read_local_file',
    namespace: 'local',
    description: '读本机文件',
    risk: 'safe',
    defaultResident: true,
    tokens: 300
  },
  {
    name: 'editor_delete_node',
    namespace: 'godot.editor',
    description: '删掉一个节点',
    risk: 'destructive',
    defaultResident: false,
    tokens: 100
  }
]

function panel(): ReturnType<typeof mount> {
  return mount(ProfileTools, {
    global: {
      // 带上插值参数：清单那句「已开启几个、大约多少 token」全在参数里
      mocks: {
        $t: (key: string, params?: Record<string, unknown>) =>
          params ? `${key}:${JSON.stringify(params)}` : key
      },
      stubs: { 'a-input': { template: '<input />' } }
    }
  })
}

function toolSearchToggle(wrapper: ReturnType<typeof mount>): DOMWrapper<Element> {
  return wrapper.find('[role="switch"][aria-label="profile.tools.toolSearchBeta"]')
}

function categoryHead(wrapper: ReturnType<typeof mount>, label: string): DOMWrapper<Element> {
  const heads = wrapper.findAll('.category-open')
  const found = heads.find((head) => head.text().includes(label))
  if (!found) throw new Error(`没有找到大类 ${label}`)
  return found
}

function categoryToggle(wrapper: ReturnType<typeof mount>, index: number): DOMWrapper<Element> {
  return wrapper.findAll('.category-head [role="switch"]')[index]
}

function toolToggle(wrapper: ReturnType<typeof mount>, name: string): DOMWrapper<Element> {
  const item = wrapper.findAll('.tool-item').find((entry) => entry.text().includes(name))
  if (!item) throw new Error(`没有找到工具 ${name}`)
  return item.find('[role="switch"]')
}

beforeEach(() => {
  vi.clearAllMocks()
  getSettings.mockResolvedValue({
    agentToolSearchEnabled: false,
    agentDisabledTools: [],
    agentResidentTools: {}
  })
  setSettings.mockResolvedValue({ success: true })
  listTools.mockResolvedValue({ tools: CATALOG })
  ;(window as unknown as { api: unknown }).api = {
    appSettings: { get: getSettings, set: setSettings },
    agentV3: { listTools }
  }
})

describe('工具搜索开关', () => {
  it('默认关闭，打开设置页不会覆盖用户配置', async () => {
    const wrapper = panel()
    await flushPromises()
    expect(toolSearchToggle(wrapper).attributes('aria-checked')).toBe('false')
    expect(setSettings).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('profile.tools.toolSearchOff')
    wrapper.unmount()
  })

  it('点开关走真实 API，界面跟着换成常驻/搜索的说法', async () => {
    const wrapper = panel()
    await flushPromises()
    await toolSearchToggle(wrapper).trigger('click')
    await flushPromises()
    expect(setSettings).toHaveBeenCalledWith({ agentToolSearchEnabled: true })
    expect(wrapper.text()).toContain('profile.tools.listNoteSearch')
    wrapper.unmount()
  })

  it('保存失败保留旧模式并报错', async () => {
    const wrapper = panel()
    await flushPromises()
    setSettings.mockRejectedValueOnce(new Error('disk full'))
    await toolSearchToggle(wrapper).trigger('click')
    await flushPromises()
    expect(toolSearchToggle(wrapper).attributes('aria-checked')).toBe('false')
    expect(errorMessage).toHaveBeenCalledWith('profile.tools.toolSearchSaveFailed')
    wrapper.unmount()
  })
})

describe('工具清单', () => {
  it('默认按大类折叠，全部打开', async () => {
    const wrapper = panel()
    await flushPromises()
    expect(categoryHead(wrapper, 'profile.tools.category.godot').text()).toContain('2 / 2')
    expect(wrapper.findAll('.tool-item')).toHaveLength(0)
    for (const toggle of wrapper.findAll('.category-head [role="switch"]')) {
      expect(toggle.attributes('aria-checked')).toBe('true')
    }
    wrapper.unmount()
  })

  it('小类只显示一句话简介，不铺模型看的那几百字', async () => {
    const wrapper = panel()
    await flushPromises()
    await categoryHead(wrapper, 'profile.tools.category.godot').trigger('click')

    const desc = wrapper
      .findAll('.tool-item')
      .find((item) => item.text().includes('godot_check'))!
      .find('.tool-desc')
    expect(desc.text()).toBe('检查项目报错')
    // 「会改动」几乎每个工具都有，标出来等于没标
    expect(wrapper.text()).not.toContain('profile.tools.risk.mutating')
    wrapper.unmount()
  })

  /*
   * 前缀是每一轮、不管用不用得上都要全额付的东西。不给数字，用户在这一页
   * 关掉一堆工具也不知道换来了多少 —— 只能凭感觉。
   */
  it('清单顶上写清开了几个、每次对话大约多付多少 token', async () => {
    const wrapper = panel()
    await flushPromises()
    // 六个全开：400 × 4 + 300 + 100
    expect(wrapper.text()).toContain(
      'profile.tools.listNoteFull:{"on":6,"total":6,"tokens":"2.0k"}'
    )
    wrapper.unmount()
  })

  // 搜索模式下算的是常驻那几个：其余用到才加载，不进每一轮的前缀
  it('搜索模式下只算常驻的那部分', async () => {
    getSettings.mockResolvedValue({
      agentToolSearchEnabled: true,
      agentDisabledTools: [],
      agentResidentTools: {}
    })
    const wrapper = panel()
    await flushPromises()
    expect(wrapper.text()).toContain(
      'profile.tools.listNoteSearch:{"on":1,"total":6,"tokens":"300"}'
    )
    wrapper.unmount()
  })

  it('一个 token 都不增加时不写「约增加 0 token」', async () => {
    getSettings.mockResolvedValue({
      agentToolSearchEnabled: true,
      agentDisabledTools: [],
      agentResidentTools: { read_local_file: false }
    })
    const wrapper = panel()
    await flushPromises()
    expect(wrapper.text()).toContain('profile.tools.listNoteSearchNoCost:{"on":0,"total":6')
    expect(wrapper.text()).not.toContain('profile.tools.listNoteSearch:')
    wrapper.unmount()
  })

  it('展开大类才看得到小类', async () => {
    const wrapper = panel()
    await flushPromises()
    await categoryHead(wrapper, 'profile.tools.category.aigc').trigger('click')
    expect(wrapper.findAll('.tool-item')).toHaveLength(1)
    expect(wrapper.text()).toContain('gen_sprite')
    wrapper.unmount()
  })

  it('大类开关一次关掉整组，只写这一组的工具名', async () => {
    const wrapper = panel()
    await flushPromises()
    await categoryToggle(wrapper, 0).trigger('click')
    await flushPromises()
    expect(setSettings).toHaveBeenCalledWith({
      agentDisabledTools: ['godot_check', 'godot_run']
    })
    expect(categoryToggle(wrapper, 0).attributes('aria-checked')).toBe('false')
    wrapper.unmount()
  })

  it('小类单独关掉之后，大类显示成半开且再点一次是全开', async () => {
    const wrapper = panel()
    await flushPromises()
    await categoryHead(wrapper, 'profile.tools.category.godot').trigger('click')
    await toolToggle(wrapper, 'godot_check').trigger('click')
    await flushPromises()
    expect(setSettings).toHaveBeenLastCalledWith({ agentDisabledTools: ['godot_check'] })

    const head = categoryToggle(wrapper, 0)
    expect(head.classes()).toContain('app-switch--indeterminate')
    expect(head.attributes('aria-checked')).toBe('false')

    await head.trigger('click')
    await flushPromises()
    // 半开时点一下是全开：把这一组补齐，而不是把剩下那个也关掉
    expect(setSettings).toHaveBeenLastCalledWith({ agentDisabledTools: [] })
    wrapper.unmount()
  })

  it('搜索模式下开关记的是常驻，且与默认一致时不留差量', async () => {
    getSettings.mockResolvedValue({
      agentToolSearchEnabled: true,
      agentDisabledTools: [],
      agentResidentTools: {}
    })
    const wrapper = panel()
    await flushPromises()
    // 默认常驻的 read_local_file 开着，非常驻的 gen_sprite 关着
    expect(categoryHead(wrapper, 'profile.tools.category.box').text()).toContain('1 / 1')
    expect(categoryHead(wrapper, 'profile.tools.category.aigc').text()).toContain('0 / 1')

    await categoryHead(wrapper, 'profile.tools.category.aigc').trigger('click')
    await toolToggle(wrapper, 'gen_sprite').trigger('click')
    await flushPromises()
    expect(setSettings).toHaveBeenLastCalledWith({ agentResidentTools: { gen_sprite: true } })

    // 再点回去就等于内置默认，差量整条删掉，用户以后自动跟随内置清单的调整
    await toolToggle(wrapper, 'gen_sprite').trigger('click')
    await flushPromises()
    expect(setSettings).toHaveBeenLastCalledWith({ agentResidentTools: {} })
    wrapper.unmount()
  })

  it('全量模式关掉的工具不会泄进搜索模式的开关', async () => {
    getSettings.mockResolvedValue({
      agentToolSearchEnabled: true,
      agentDisabledTools: ['gen_sprite'],
      agentResidentTools: { gen_sprite: true }
    })
    const wrapper = panel()
    await flushPromises()
    expect(categoryHead(wrapper, 'profile.tools.category.aigc').text()).toContain('1 / 1')
    wrapper.unmount()
  })

  /*
   * 不可撤销的那批列出来但关不掉。
   *
   * 拦它们的是每一步的审批弹窗，不是这份清单 —— 从清单里拿走只会让助手做不了
   * 正事，还给出一个假的安全感（Python 和 shell 照样删得掉）。
   */
  describe('不可撤销的工具', () => {
    it('开关锁在打开位置、点不动，并写明为什么', async () => {
      const wrapper = panel()
      await flushPromises()
      await categoryHead(wrapper, 'profile.tools.category.editor').trigger('click')

      const toggle = toolToggle(wrapper, 'editor_delete_node')
      expect(toggle.attributes('aria-checked')).toBe('true')
      expect(toggle.attributes('disabled')).toBeDefined()
      expect(toggle.classes()).toContain('locked')
      // 理由不摊成一段说明，挂在「不可撤销」徽章的 title 上，用到时才说
      expect(wrapper.find('.badge-destructive').attributes('title')).toBe(
        'profile.tools.lockedHint'
      )

      await toggle.trigger('click')
      await flushPromises()
      expect(setSettings).not.toHaveBeenCalled()
      wrapper.unmount()
    })

    it('大类整组关掉时把它留下，不写进名单', async () => {
      const wrapper = panel()
      await flushPromises()
      // 「编辑器」这一组只有 editor_delete_node，整组锁住，大类开关也点不动
      const scene = wrapper
        .findAll('.category-head')
        .find((head) => head.text().includes('profile.tools.category.editor'))!
        .find('[role="switch"]')
      expect(scene.attributes('disabled')).toBeDefined()
      await scene.trigger('click')
      await flushPromises()
      expect(setSettings).not.toHaveBeenCalled()
      wrapper.unmount()
    })

    it('手改过的配置里还留着它时，界面不跟着显示成关掉', async () => {
      getSettings.mockResolvedValue({
        agentToolSearchEnabled: false,
        agentDisabledTools: ['editor_delete_node'],
        agentResidentTools: {}
      })
      const wrapper = panel()
      await flushPromises()
      expect(categoryHead(wrapper, 'profile.tools.category.editor').text()).toContain('1 / 1')
      wrapper.unmount()
    })

    /*
     * 工具搜索模式下关掉不等于不可用，只是改成按需加载 ——
     * 没有「把能力拿走」这回事，也就没什么要锁的。
     */
    it('工具搜索模式下照常可切换', async () => {
      getSettings.mockResolvedValue({
        agentToolSearchEnabled: true,
        agentDisabledTools: [],
        agentResidentTools: {}
      })
      const wrapper = panel()
      await flushPromises()
      await categoryHead(wrapper, 'profile.tools.category.editor').trigger('click')

      const toggle = toolToggle(wrapper, 'editor_delete_node')
      expect(toggle.attributes('disabled')).toBeUndefined()
      expect(wrapper.find('.badge-destructive').attributes('title')).toBeUndefined()
      await toggle.trigger('click')
      await flushPromises()
      expect(setSettings).toHaveBeenLastCalledWith({
        agentResidentTools: { editor_delete_node: true }
      })
      wrapper.unmount()
    })
  })

  /*
   * 落盘写的是**整份名单**，而名单在函数开头从当前状态算出来。
   * 第二次点击如果在第一次提交之前进来，算出来的名单里就没有第一次那一笔 ——
   * 覆盖下去，用户的第一次点击无声消失，开关还会自己弹回去。
   */
  it('上一次还没写完时不受理第二次点击，改动不会被覆盖掉', async () => {
    const wrapper = panel()
    await flushPromises()
    let release: (value: { success: boolean }) => void = () => {}
    setSettings.mockReturnValueOnce(
      new Promise<{ success: boolean }>((resolve) => {
        release = resolve
      })
    )

    await categoryToggle(wrapper, 0).trigger('click')
    await flushPromises()
    // 第一次还挂在半路：整张清单都禁用，而且再点也不会再发一次写。
    // 用生成那一组（index 2）—— index 1 的「编辑器」本来就锁着，
    // 拿它当第二次点击测不出「落盘期间禁用」这件事
    expect(categoryToggle(wrapper, 2).attributes('disabled')).toBeDefined()
    await categoryToggle(wrapper, 2).trigger('click')
    await flushPromises()
    expect(setSettings).toHaveBeenCalledTimes(1)

    release({ success: true })
    await flushPromises()
    expect(setSettings).toHaveBeenCalledTimes(1)
    expect(setSettings).toHaveBeenLastCalledWith({
      agentDisabledTools: ['godot_check', 'godot_run']
    })
    expect(categoryToggle(wrapper, 0).attributes('aria-checked')).toBe('false')
    // 第二次那一组没被写进去，也没被第一次的名单顺手带上
    expect(categoryToggle(wrapper, 2).attributes('aria-checked')).toBe('true')
    wrapper.unmount()
  })

  it('读取失败时说读失败，并且不让开关去覆盖已存的配置', async () => {
    listTools.mockRejectedValue(new Error('unavailable'))
    const wrapper = panel()
    await flushPromises()
    expect(errorMessage).toHaveBeenCalledWith('profile.tools.loadFailed')
    expect(wrapper.text()).toContain('profile.tools.loadFailedDetail')
    expect(toolSearchToggle(wrapper).attributes('disabled')).toBeDefined()
    expect(setSettings).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('保存失败时开关弹回原位并报错', async () => {
    const wrapper = panel()
    await flushPromises()
    setSettings.mockRejectedValueOnce(new Error('disk full'))
    await categoryToggle(wrapper, 0).trigger('click')
    await flushPromises()
    expect(categoryToggle(wrapper, 0).attributes('aria-checked')).toBe('true')
    expect(errorMessage).toHaveBeenCalledWith('profile.tools.saveFailed')
    wrapper.unmount()
  })
})
