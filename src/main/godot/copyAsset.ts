/**
 * 把一个 Godot 资源复制到另一处，连同它的旁挂文件。
 *
 * Godot 给每个导入的文件旁边放一个 `<文件>.import`（导入设置 + uid），4.4 起
 * 脚本和着色器旁边还有 `<文件>.uid`。只拷主文件的话，导入设置丢了、uid 变了，
 * 引用它的场景会报「找不到资源」。所以三样一起拷；目标已存在且大小相同的跳过。
 *
 * 导入缓存（`.godot/imported/`）不拷：编辑器打开工程时会照着 `.import` 重新生成。
 */
import { promises as fs } from 'fs'
import { dirname } from 'path'

const SIDECARS = ['', '.import', '.uid']

async function sizeOf(path: string): Promise<number | undefined> {
  try {
    return (await fs.stat(path)).size
  } catch {
    return undefined
  }
}

/** 返回实际复制的文件数 */
export async function copyGodotAsset(sourcePath: string, targetPath: string): Promise<number> {
  let copied = 0
  for (const suffix of SIDECARS) {
    const from = sourcePath + suffix
    const to = targetPath + suffix
    const sourceSize = await sizeOf(from)
    if (sourceSize === undefined) {
      if (suffix === '') throw new Error(`源文件不存在：${sourcePath}`)
      continue
    }
    if ((await sizeOf(to)) === sourceSize) continue
    await fs.mkdir(dirname(to), { recursive: true })
    await fs.copyFile(from, to)
    copied++
  }
  return copied
}
