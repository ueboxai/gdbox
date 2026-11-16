import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'

// 真实的处理器会一路 import 到 electron 和原生 sqlite，这里只要它给出 res:// 路径就够了
vi.mock('../fileProcessor/GodotAssetProcessor', () => ({
  GodotAssetProcessor: class {
    async processFile(filePath: string): Promise<{ metadata: Record<string, unknown> }> {
      const name = path.basename(filePath, path.extname(filePath))
      return {
        metadata: {
          imports: [],
          classKey: 'Resource',
          name,
          softPath: `res://chars/${path.basename(filePath)}`
        }
      }
    }
  }
}))

const { AssetDependencyResolver } = await import('./AssetDependencyResolver')
type AssetDependencyInfo = import('./AssetDependencyResolver').AssetDependencyInfo

describe('AssetDependencyResolver 的跨次调用状态', () => {
  let root = ''
  let animRun = ''
  let animWalk = ''
  let skeleton = ''

  beforeEach(async () => {
    // 依赖的 res:// 路径相对 project.godot 所在的工程根换算
    root = await mkdtemp(path.join(tmpdir(), 'godot-dep-'))
    await writeFile(path.join(root, 'project.godot'), 'config_version=5\n')
    const anims = path.join(root, 'anims')
    const chars = path.join(root, 'chars')
    await mkdir(anims, { recursive: true })
    await mkdir(chars, { recursive: true })

    animRun = path.join(anims, 'run.tscn')
    animWalk = path.join(anims, 'walk.tscn')
    skeleton = path.join(chars, 'hero.tres')
    await Promise.all([writeFile(animRun, 'x'), writeFile(animWalk, 'x'), writeFile(skeleton, 'x')])
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const makeAsset = (realPath: string, softPath: string): AssetDependencyInfo => ({
    assetKey: path.basename(realPath),
    name: path.basename(realPath, '.tscn'),
    softPath,
    realPath,
    originPath: realPath,
    imports: ['res://chars/hero.tres'],
    classKey: 'PackedScene'
  })

  it('默认每次调用都重新解析共享依赖', async () => {
    const found: string[] = []
    const resolver = new AssetDependencyResolver({
      onAssetFound: (asset) => {
        found.push(asset.originPath)
      }
    })

    await resolver.resolveDependencies([makeAsset(animRun, 'res://anims/run.tscn')])
    await resolver.resolveDependencies([makeAsset(animWalk, 'res://anims/walk.tscn')])

    // 同一个共享资源被搬了两遍
    expect(found.filter((p) => p === skeleton)).toHaveLength(2)
  })

  it('打开 persistStateAcrossRuns 后共享依赖只解析一次', async () => {
    const found: string[] = []
    const resolver = new AssetDependencyResolver({
      persistStateAcrossRuns: true,
      onAssetFound: (asset) => {
        found.push(asset.originPath)
      }
    })

    await resolver.resolveDependencies([makeAsset(animRun, 'res://anims/run.tscn')])
    await resolver.resolveDependencies([makeAsset(animWalk, 'res://anims/walk.tscn')])

    expect(found.filter((p) => p === skeleton)).toHaveLength(1)
    // 两个主资产本身照样各自交付一次，不能被去重吃掉
    expect(found).toContain(animRun)
    expect(found).toContain(animWalk)
  })

  it('批量再大也要解析依赖，不许按数量整批跳过', async () => {
    // 这里曾经有一条「初始资产超过 200 个就跳过递归解析」的保护。它跟
    // localBackupSession「硬引用缺失就判整组失败」是矛盾的：按素材包分别导入时
    // 跨包引用是常态，跳过解析等于让几百个文件直接导不进去。
    const many: AssetDependencyInfo[] = []
    for (let i = 0; i < 250; i++) {
      const file = path.join(root, 'anims', `bulk_${i}.tscn`)
      await writeFile(file, 'x')
      many.push(makeAsset(file, `res://anims/bulk_${i}.tscn`))
    }

    const found: string[] = []
    const resolver = new AssetDependencyResolver({
      onAssetFound: (asset) => {
        found.push(asset.originPath)
      }
    })
    await resolver.resolveDependencies(many)

    expect(found).toContain(skeleton)
  })

  it('主资产的 classKey 是库里的分类（scene）时照样解析依赖', async () => {
    // 导入到工程时主资产取自资产库记录，classKey 是库里的分类而不是引擎类型。
    // 是否带依赖按扩展名（.tscn/.tres/.gd/.gdshader）认，不能看 classKey
    const found: string[] = []
    const resolver = new AssetDependencyResolver({
      onAssetFound: (asset) => {
        found.push(asset.originPath)
      }
    })
    await resolver.resolveDependencies([
      { ...makeAsset(animRun, 'res://anims/run.tscn'), classKey: 'scene' }
    ])

    expect(found).toContain(skeleton)
  })

  describe('缺失的依赖只按硬引用拦截', () => {
    // Godot 的 ext_resource 都是硬引用，但库里的记录可以带强弱信息（importsStrong）：
    // 只被软引用、素材包里本来就没有的文件不该把整组导入拦下
    const run = async (
      importsStrong: string[] | undefined,
      extra: AssetDependencyInfo[] = []
    ): Promise<{ found: string[]; missing: string[] }> => {
      const found: string[] = []
      const missing: string[] = []
      const resolver = new AssetDependencyResolver({
        persistStateAcrossRuns: true,
        onAssetFound: (asset) => {
          found.push(asset.originPath)
        },
        errorCallback: (error) => {
          if (error.type === 'file_not_found') missing.push(...error.affectedPaths)
        }
      })
      const main = {
        ...makeAsset(animRun, 'res://anims/run.tscn'),
        imports: ['res://chars/hero.tres', 'res://chars/gone.tres'],
        importsStrong
      }
      await resolver.resolveDependencies([main])
      for (const asset of extra) await resolver.resolveDependencies([asset])
      return { found, missing }
    }

    it('只被软引用的依赖缺了不报，存在的依赖照常拷', async () => {
      const { found, missing } = await run(['res://chars/hero.tres'])
      expect(missing).toEqual([])
      expect(found).toContain(skeleton)
    })

    it('硬引用的依赖缺了照样报', async () => {
      const { missing } = await run(['res://chars/hero.tres', 'res://chars/gone.tres'])
      expect(missing.map((p) => path.basename(p))).toEqual(['gone.tres'])
    })

    it('没有强弱信息的老记录按老行为全部拦截', async () => {
      const { missing } = await run(undefined)
      expect(missing.map((p) => path.basename(p))).toEqual(['gone.tres'])
    })

    it('先被软引用放过、后被别的资产硬引用时补报', async () => {
      const later = {
        ...makeAsset(animWalk, 'res://anims/walk.tscn'),
        imports: ['res://chars/gone.tres'],
        importsStrong: ['res://chars/gone.tres']
      }
      const { missing } = await run(['res://chars/hero.tres'], [later])
      expect(missing.map((p) => path.basename(p))).toEqual(['gone.tres'])
    })
  })

  it('clearCache 之后重新解析', async () => {
    const found: string[] = []
    const resolver = new AssetDependencyResolver({
      persistStateAcrossRuns: true,
      onAssetFound: (asset) => {
        found.push(asset.originPath)
      }
    })

    await resolver.resolveDependencies([makeAsset(animRun, 'res://anims/run.tscn')])
    resolver.clearCache()
    await resolver.resolveDependencies([makeAsset(animWalk, 'res://anims/walk.tscn')])

    expect(found.filter((p) => p === skeleton)).toHaveLength(2)
  })
})
