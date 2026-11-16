import type { ExternalTeamSummary } from '@core/shared/agentTeam'
import type { ChatSession } from '@renderer/store/modules/chatSessions'
import { projectPathKey, type ConnectedProjectRef } from './chatSessionGrouping'

/** 外部驱动的对话只投影到列表，external.json 仍是唯一数据源，不另造普通对话记录。 */
export function externalTeamChats(
  teams: ExternalTeamSummary[],
  projects: ConnectedProjectRef[]
): ChatSession[] {
  return teams.map((team) => {
    const path = team.projectPath?.trim().replace(/\\/g, '/').replace(/\/+$/, '')
    const known = path
      ? projects.find((project) => projectPathKey(project.projectPath) === projectPathKey(path))
      : undefined
    // 记的可能是工程目录，也可能是 project.godot 本身：名字取工程目录那一级
    const projectName =
      known?.projectName ||
      path
        ?.replace(/\/project\.godot$/i, '')
        .split('/')
        .at(-1)
    return {
      id: team.id,
      title: team.objective,
      createdAt: team.createdAt,
      updatedAt: team.createdAt,
      ...(projectName ? { project: { ...known, projectName, projectPath: path } } : {})
    }
  })
}
