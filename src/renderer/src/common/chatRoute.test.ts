import { describe, expect, it } from 'vitest'

import { chatSessionRoute, newChatRoute, projectChatRoute } from './chatRoute'

describe('chatSessionRoute', () => {
  it('已经开着这条会话的标签页就复用它', () => {
    const tabs = ['/home', '/dev-assistant?sid=abc', '/dev-assistant?sid=xyz']
    expect(chatSessionRoute('xyz', tabs)).toBe('/dev-assistant?sid=xyz')
  })

  it('没开过就新开一个', () => {
    expect(chatSessionRoute('xyz', ['/home', '/dev-assistant?sid=abc'])).toEqual({
      name: 'AssistantWelcome',
      query: { sid: 'xyz' }
    })
  })

  it('别的页面上带同名 sid 不算数 —— 那是另一件事的参数', () => {
    expect(chatSessionRoute('xyz', ['/note-editor?sid=xyz'])).toEqual({
      name: 'AssistantWelcome',
      query: { sid: 'xyz' }
    })
  })

  it('认 /dev-assistant/chat 这个别名', () => {
    const tabs = ['/dev-assistant/chat?sid=xyz']
    expect(chatSessionRoute('xyz', tabs)).toBe('/dev-assistant/chat?sid=xyz')
  })

  it('助手标签页没带 sid（新会话还没落号）时不会被当成任意会话', () => {
    expect(chatSessionRoute('xyz', ['/dev-assistant'])).toEqual({
      name: 'AssistantWelcome',
      query: { sid: 'xyz' }
    })
  })

  // 空 id 撞上「这个标签页没带 sid」也是空，一视同仁的话它能匹配上列表里的
  // 第一个标签页 —— 用户点「任务完成」会被送到素材库
  it('空会话 id 不匹配任何标签页', () => {
    expect(chatSessionRoute('', ['/asset-management', '/dev-assistant?sid=abc'])).toEqual({
      name: 'AssistantWelcome',
      query: { sid: '' }
    })
    expect(chatSessionRoute('', ['/dev-assistant', ''])).toEqual({
      name: 'AssistantWelcome',
      query: { sid: '' }
    })
  })
})

describe('newChatRoute', () => {
  const tabs = [
    '/',
    '/dev-assistant?sid=used',
    '/dev-assistant?sid=blank',
    '/dev-assistant?sid=p&project=A'
  ]
  const blank = new Set(['blank', 'p'])

  it('已有空白的新对话标签时切过去', () => {
    expect(newChatRoute(tabs, (sid) => blank.has(sid))).toBe('/dev-assistant?sid=blank')
  })

  it('带项目归属的空标签不复用；没有空白标签就新开', () => {
    const route = newChatRoute(['/dev-assistant?sid=p&project=A'], (sid) => blank.has(sid))
    expect(route).toMatchObject({ name: 'AssistantWelcome' })
    expect((route as { query: { sid: string } }).query.sid).toBeTruthy()
  })
})

describe('projectChatRoute', () => {
  it('带上项目名和路径，对话第一条消息就归到这个项目下', () => {
    const route = projectChatRoute(' CatBoat ', 'D:/CatBoat') as {
      name: string
      query: Record<string, string>
    }
    expect(route.name).toBe('AssistantWelcome')
    expect(route.query.project).toBe('CatBoat')
    expect(route.query.projectPath).toBe('D:/CatBoat')
    expect(route.query.sid).toBeTruthy()
  })

  it('没有路径时不带空的 projectPath', () => {
    const route = projectChatRoute('CatBoat') as { query: Record<string, string> }
    expect(route.query).not.toHaveProperty('projectPath')
  })

  it('每次都是新对话，不复用别的标签', () => {
    const a = projectChatRoute('CatBoat') as { query: Record<string, string> }
    const b = projectChatRoute('CatBoat') as { query: Record<string, string> }
    expect(a.query.sid).not.toBe(b.query.sid)
  })
})
