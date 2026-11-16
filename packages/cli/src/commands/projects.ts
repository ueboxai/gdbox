/**
 * `gdbox projects list` —— 「我的项目」里登记了哪些 Godot 工程，哪些编辑器连着。
 *
 * 没有工程时**成功返回空数组**，不是失败（§4）。「我问一下有没有」和
 * 「我要用但没有」是两回事：前者的正确答案就是「零个」，把它报成错会让
 * 脚本里一句普通的探测变成需要 try/catch 的东西。
 *
 * 判断「能不能干活」是 `doctor` 的职责。
 */

import { success, type Envelope } from '../envelope.js'
import * as runtime from '../runtime.js'

export interface ProjectsOptions {
  configPath?: string
  timeoutSeconds?: number
  env?: NodeJS.ProcessEnv
}

export async function runProjectsList(options: ProjectsOptions): Promise<Envelope> {
  const rt = await runtime.open({
    ...(options.configPath ? { configPath: options.configPath } : {}),
    ...(options.timeoutSeconds ? { timeoutSeconds: options.timeoutSeconds } : {}),
    ...(options.env ? { env: options.env } : {})
  })

  try {
    const projects = await runtime.listProjects(rt)
    if (!projects) throw runtime.projectListUnavailable()

    const connected = projects.filter((project) => project.editorConnected).length

    return success({
      data: {
        projects: projects.map((project) => ({
          name: project.name,
          // 脚本里要长期指代一个工程，用 path（--project 收的就是它）
          path: project.path,
          godotVersion: project.godotVersion,
          onDisk: project.onDisk,
          editorConnected: project.editorConnected,
          projectKey: project.projectKey
        })),
        count: projects.length,
        editorConnectedCount: connected
      },
      warnings:
        projects.length === 0
          ? [
              '「我的项目」里还没有登记工程。在 GDBox 里添加工程，' +
                '或者直接用 --project 指定工程目录。'
            ]
          : connected === 0
            ? [
                '没有连着的 Godot 编辑器：editor_* 工具现在用不了。' +
                  '用 Godot 编辑器打开工程并启用 GDBox Link 插件后再试；' +
                  'godot_check / godot_run / godot_screenshot 不需要编辑器。'
              ]
            : []
    })
  } finally {
    await rt.close()
  }
}
