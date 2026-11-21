import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { AgentEvent, AgentMessage, BeforeToolCallContext } from '@earendil-works/pi-agent-core'
import { defineTool, effectiveRisk, type UnrealAgentTool } from '../defineTool'
import { CALL_TOOL_NAME, createToolSearch } from './toolSearch'

function tool(
  name: string,
  namespace = 'ue.material',
  options: {
    description?: string
    risk?: 'safe' | 'mutating' | 'destructive'
    execute?: (args: { value: number }) => Promise<{ text: string }>
  } = {}
): UnrealAgentTool<never> {
  return defineTool({
    name,
    namespace,
    description: options.description ?? '材质颜色 roughness',
    risk: options.risk ?? 'safe',
    input: z.object({ value: z.number().default(1) }),
    riskFor: ({ value }) => (value === 0 ? 'safe' : (options.risk ?? 'safe')),
    execute: options.execute ?? (async ({ value }) => ({ text: `ok ${value}` }))
  }) as unknown as UnrealAgentTool<never>
}

function names(controller: ReturnType<typeof createToolSearch>): string[] {
  return controller.getTools().map((t) => t.name)
}

async function run(
  target: UnrealAgentTool<never> | undefined,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const result = await target!.execute('id', args as never)
  const first = result.content[0]
  if (first.type !== 'text') throw new Error('expected text')
  return JSON.parse(first.text)
}

function beforeCtx(name: string, args: Record<string, unknown>): BeforeToolCallContext {
  return {
    toolCall: { type: 'toolCall', id: 'call-1', name, arguments: args },
    args
  } as unknown as BeforeToolCallContext
}

describe('工具搜索：固定清单模式', () => {
  it('搜索、技能点名、按名取定义之后，请求里的工具清单一个字都不变', async () => {
    const color = tool('set_surface_color')
    const open = tool('open_project', 'project', { description: '打开工程' })
    const catalog = [color, open, tool('result_query', 'core', { description: '查存档' })]
    const controller = createToolSearch(catalog, () => catalog, {}, { fixed: true })
    const before = names(controller)
    expect(before).toEqual(['search_tools', CALL_TOOL_NAME, 'result_query'])

    await run(controller.tool, { query: '材质颜色' })
    await run(controller.tool, { names: ['open_project'] })
    controller.loadFromSkill('先调 set_surface_color 再 open_project')
    controller.restore([
      {
        role: 'toolResult',
        details: { toolSearch: { loadedToolNames: ['set_surface_color'] } }
      } as unknown as AgentMessage
    ])

    expect(names(controller)).toEqual(before)
  })

  it('搜索回完整定义；这一轮再命中只回名字', async () => {
    const color = tool('set_surface_color', 'ue.material', {
      description: '设置表面颜色。'.repeat(40)
    })
    const controller = createToolSearch([color], () => [color], {}, { fixed: true })

    const first = await run(controller.tool, { names: ['set_surface_color'] })
    expect(first.definitions).toEqual([
      { name: color.name, description: color.description, parameters: color.parameters }
    ])

    const again = await run(controller.tool, { query: '表面颜色' })
    expect(again.definitions).toEqual([])
    expect(again.seen).toEqual(['set_surface_color'])
  })

  it('技能正文点名的工具，定义跟着 load_skill 的结果回来', () => {
    const color = tool('set_surface_color')
    const controller = createToolSearch([color], () => [color], {}, { fixed: true })
    const outcome = controller.loadFromSkill('用 set_surface_color 改颜色')
    expect(JSON.parse(outcome.text!).definitions.map((d: { name: string }) => d.name)).toEqual([
      'set_surface_color'
    ])
  })

  it('call_tool 按目标 schema 校验并执行，默认值照常补上', async () => {
    const seen: number[] = []
    const color = tool('set_surface_color', 'ue.material', {
      execute: async ({ value }) => {
        seen.push(value)
        return { text: `done ${value}` }
      }
    })
    const controller = createToolSearch([color], () => [color], {}, { fixed: true })
    const result = await controller.callTool!.execute('id', {
      name: 'set_surface_color',
      arguments: {}
    } as never)
    expect(result.content[0]).toEqual({ type: 'text', text: 'done 1' })
    expect(seen).toEqual([1])
  })

  it('call_tool 拿不到被过滤掉的工具，参数不对时报错里带 schema', async () => {
    const color = tool('set_surface_color')
    const hidden = tool('ue_delete_everything')
    const controller = createToolSearch([color, hidden], () => [color], {}, { fixed: true })
    const call = controller.callTool!

    await expect(
      call.execute('id', { name: 'ue_delete_everything', arguments: {} } as never)
    ).rejects.toThrow(/没有可用的工具/)
    await expect(
      call.execute('id', { name: 'set_surface_color', arguments: { value: 'x' } } as never)
    ).rejects.toThrow(/参数 schema/)
    await expect(
      call.execute('id', { name: CALL_TOOL_NAME, arguments: {} } as never)
    ).rejects.toThrow(/不能调用它自己/)
  })

  it('钩子看到的是真实工具名和校验过的参数，调用 id 不变', () => {
    const color = tool('set_surface_color')
    const controller = createToolSearch([color], () => [color], {}, { fixed: true })

    const unwrapped = controller.unwrap(
      beforeCtx(CALL_TOOL_NAME, { name: 'set_surface_color', arguments: {} })
    )
    expect(unwrapped.ok).toBe(true)
    if (!unwrapped.ok) return
    expect(unwrapped.ctx.toolCall.id).toBe('call-1')
    expect(unwrapped.ctx.toolCall.name).toBe('set_surface_color')
    // 和直接调用一致：pi 的校验不补默认值，默认值在工具执行时由 zod 补
    expect(unwrapped.ctx.args).toEqual({})

    const direct = beforeCtx('search_tools', { query: 'x' })
    expect(controller.unwrap(direct)).toEqual({ ok: true, ctx: direct })

    const bad = controller.unwrap(beforeCtx(CALL_TOOL_NAME, { name: 'nope', arguments: {} }))
    expect(bad.ok).toBe(false)
  })

  it('call_tool 的执行事件换成真实工具名和参数，界面和台账认得出来', () => {
    const color = tool('set_surface_color', 'ue.material', { risk: 'mutating' })
    const controller = createToolSearch([color], () => [color], {}, { fixed: true })
    const args = { name: 'set_surface_color', arguments: { value: 2 } }
    const start = controller.unwrapEvent({
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: CALL_TOOL_NAME,
      args
    })
    expect(start).toMatchObject({ toolName: 'set_surface_color', args: { value: 2 } })
    const update = controller.unwrapEvent({
      type: 'tool_execution_update',
      toolCallId: 'c1',
      toolName: CALL_TOOL_NAME,
      args,
      partialResult: {}
    })
    expect(update).toMatchObject({ toolName: 'set_surface_color', args: { value: 2 } })
    const end: AgentEvent = {
      type: 'tool_execution_end',
      toolCallId: 'c1',
      toolName: CALL_TOOL_NAME,
      result: {},
      isError: false
    }
    expect(controller.unwrapEvent(end)).toMatchObject({ toolName: 'set_surface_color' })
    // 结束后忘掉这次调用；别的事件和直接调用的工具原样放行
    expect(controller.unwrapEvent(end)).toBe(end)
    const direct: AgentEvent = {
      type: 'tool_execution_start',
      toolCallId: 'c2',
      toolName: 'search_tools',
      args: {}
    }
    expect(controller.unwrapEvent(direct)).toBe(direct)
  })

  it('call_tool 的风险跟着目标走，读原样事件的地方也算得对', () => {
    const remove = tool('ue_content_delete', 'ue.content', { risk: 'destructive' })
    const read = tool('ue_content_search', 'ue.content', { risk: 'safe' })
    const controller = createToolSearch([remove, read], () => [remove, read], {}, { fixed: true })
    const meta = controller.callTool!.unrealBox

    expect(effectiveRisk(meta, { name: 'ue_content_search', arguments: {} })).toBe('safe')
    expect(effectiveRisk(meta, { name: 'ue_content_delete', arguments: { value: 2 } })).toBe(
      'destructive'
    )
    expect(effectiveRisk(meta, { name: 'ue_content_delete', arguments: { value: 0 } })).toBe('safe')
    expect(effectiveRisk(meta, { name: 'nope', arguments: {} })).toBe('destructive')
  })

  it('加载模式不受影响：没有 call_tool，unwrap 原样放行', async () => {
    const color = tool('set_surface_color')
    const controller = createToolSearch([color], () => [color])
    expect(controller.callTool).toBeUndefined()
    await run(controller.tool, { names: ['set_surface_color'] })
    expect(names(controller)).toEqual(['search_tools', 'set_surface_color'])
    const ctx = beforeCtx(CALL_TOOL_NAME, { name: 'set_surface_color', arguments: {} })
    expect(controller.unwrap(ctx)).toEqual({ ok: true, ctx })
  })
})
