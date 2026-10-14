/**
 * project_list：「我的项目」里登记了哪些 Godot 工程，分在哪些合集里，哪个编辑器正连着。
 *
 * 只读，查的是盒子自己的数据库和编辑器连接表，不碰磁盘上的工程。
 * 用户提到一个工程但名字说不全、或要按工程整理（project_organize）之前先用它。
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

import { defineTool, type UnrealAgentTool } from '../../defineTool'
import { getPublicDatabase } from '../../../../sqliteDataBase'
import { getAllProjects } from '../../../../sqliteDataBase/models/project'
import {
  getAllProjectCollections,
  getProjectsByCollectionKey
} from '../../../../sqliteDataBase/models/projectCollection'
import { projectComparisonKey } from '../../../../utils/projectPath'

export function createProjectListTool(): UnrealAgentTool<unknown> {
  return defineTool({
    name: 'project_list',
    namespace: 'project',
    risk: 'safe',
    description:
      '列出「我的项目」里登记的 Godot 工程：projectKey、名字、Godot 版本、目录、是否还在盘上、编辑器是否正连着；' +
      '以及合集（collections，含空合集）和每个合集里的工程。只读。' +
      '用户提到一个工程但名字说不全、或要用 project_organize 整理之前先用它。',
    input: z.object({
      keyword: z.string().optional().describe('按名字或路径筛，不区分大小写')
    }),
    async execute(args) {
      const db = getPublicDatabase()
      const { projectManager } = await import('../../../../services/project/projectManager')
      const connected = new Set(
        projectManager.getInteractiveProjects().map((p) => projectComparisonKey(p.projectPath))
      )
      const needle = args.keyword?.trim().toLowerCase()
      const projects = getAllProjects(db)
        .filter(
          (p) =>
            !needle ||
            (p.projectName ?? '').toLowerCase().includes(needle) ||
            (p.projectPath ?? '').toLowerCase().includes(needle)
        )
        .map((p) => ({
          projectKey: p.projectKey,
          name: p.projectName ?? '',
          godotVersion: p.EngineAssociation ?? '',
          path: p.projectPath ?? '',
          onDisk: Boolean(p.projectPath && existsSync(join(p.projectPath, 'project.godot'))),
          editorConnected: Boolean(p.projectPath && connected.has(projectComparisonKey(p.projectPath))),
          pinned: Boolean(p.isPinned)
        }))
      const collections = getAllProjectCollections(db).map((c) => ({
        collectionKey: c.collectionKey,
        name: c.name ?? '',
        projects: getProjectsByCollectionKey(db, c.collectionKey).map((p) => p.projectKey)
      }))

      const lines = projects.length
        ? projects.map(
            (p) =>
              `- ${p.name}（${p.projectKey}）${p.godotVersion ? ` Godot ${p.godotVersion}` : ''}｜${p.path}` +
              (p.onDisk ? '' : '｜盘上找不到') +
              (p.editorConnected ? '｜编辑器已连接' : '')
          )
        : [needle ? `没有名字或路径含「${args.keyword}」的工程。` : '「我的项目」里还没有登记任何工程。']
      if (collections.length) {
        lines.push(
          '',
          '合集：',
          ...collections.map((c) => `- ${c.name}（${c.collectionKey}）：${c.projects.length} 个工程`)
        )
      }
      return { text: lines.join('\n'), details: { projects, collections } }
    }
  })
}
