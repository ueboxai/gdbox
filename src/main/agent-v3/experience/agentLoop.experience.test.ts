/**
 * 端到端：经验挂在错误结果后面，真的进了模型上下文。
 *
 * 单测证明了 `runtime.after` 会回一段话，但那段话要靠 `afterToolCall` 的
 * `content` 覆盖才进得了上下文 —— 而 `godot_check` 查出脚本错误时**不算工具失败**，
 * 只是返回的文字里写着几条错误。经验系统要自己认出这是一次失败，挂法照抄 `createAgent.ts`。
 */

import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { Agent } from '@earendil-works/pi-agent-core'
import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core'
import { createModels } from '@earendil-works/pi-ai'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall
} from '@earendil-works/pi-ai/providers/faux'

import { defineTool, type UnrealAgentTool } from '../tools/defineTool'
import { createSessionExperience } from './session'
import { ExperienceStore, experienceDir } from './store'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'exp-e2e-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('经验进上下文', () => {
  it('检查报了本工程见过的错，模型下一轮看得到上次怎么过的', async () => {
    const store = new ExperienceStore(experienceDir(root)!)
    await store.updateTool('godot_check', () => [
      {
        id: 'e-1',
        title: 'PackedScene 用 instantiate()',
        tool: 'godot_check',
        errorPattern: "nonexistent function 'instance' in base 'packedscene'",
        advice: 'Godot 4 里改用 instantiate()',
        expect: { tool: 'edit_local_file' },
        source: 'test',
        status: 'proven'
      }
    ])

    const tool = defineTool({
      name: 'godot_check',
      namespace: 'godot',
      risk: 'safe',
      description: '检查工程',
      input: z.object({ frames: z.number().optional() }),
      // 和真的 godot_check 一样：查出错误照常返回，不抛
      execute: async () => ({
        text: "1 error(s):\n\nSCRIPT ERROR: Invalid call. Nonexistent function 'instance' in base 'PackedScene'.\nat: _ready (res://main.gd:5)"
      })
    }) as unknown as UnrealAgentTool<never>

    const experience = createSessionExperience({
      sessionId: 's1',
      projectRoot: root,
      skillLearning: 'ask',
      tools: [tool],
      // 抽签固定落在出场那一支（对照组的行为在 runtime.test.ts 里测）
      random: () => 0.99
    })!

    const faux = fauxProvider({ tokensPerSecond: 100_000 })
    const models = createModels()
    models.setProvider(faux.provider)
    const agent = new Agent({
      streamFn: (model, context, options) => models.streamSimple(model, context, options),
      sessionId: 's1',
      initialState: {
        model: faux.getModel(),
        systemPrompt: 'test',
        tools: [tool] as unknown as AgentTool<never>[]
      },
      convertToLlm: (messages: AgentMessage[]) => messages as never[],
      afterToolCall: async (hookCtx) => {
        const content = hookCtx.result.content ?? []
        const note = await experience.after({
          tool: hookCtx.toolCall.name,
          args: hookCtx.args,
          isError: hookCtx.isError,
          text: content.map((part) => (part.type === 'text' ? part.text : '')).join('\n')
        })
        return note ? { content: [...content, { type: 'text', text: note }] } : undefined
      }
    })

    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('godot_check', {}, { id: 'c1' })]),
      fauxAssistantMessage('好的')
    ])
    await agent.prompt('生成敌人')
    const text = JSON.stringify(agent.state.messages)
    expect(text).toContain("Nonexistent function 'instance'")
    expect(text).toContain('Experience from earlier runs')
    expect(text).toContain('instantiate()')
    await experience.flush()
  })
})
