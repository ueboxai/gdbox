import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { parseProjectFile } from './projectFile'

/**
 * 主场景有没有问题。没问题返回 null。
 *
 * 没设主场景时，编辑器的运行按钮、项目库的「运行游戏」都会停下来让用户自己挑场景，
 * 新手不知道选哪个；而无头检查照样跑完、报不出错。所以检查时单独说一句。
 * uid:// 的路径这里不解析，只认没设和 res:// 文件不存在两种。
 */
export function mainSceneProblem(projectDir: string): string | null {
  let text: string
  try {
    text = readFileSync(join(projectDir, 'project.godot'), 'utf8')
  } catch {
    return null
  }
  const scene = parseProjectFile(text).mainScene
  if (!scene) {
    return 'No main scene is set (application/run/main_scene in project.godot). The Run button and "Play game" will ask the user to pick a scene. Set the scene the game starts from as the main scene.'
  }
  if (scene.startsWith('res://') && !existsSync(join(projectDir, scene.slice('res://'.length)))) {
    return `The main scene ${scene} does not exist. Point application/run/main_scene at the scene the game starts from.`
  }
  return null
}
