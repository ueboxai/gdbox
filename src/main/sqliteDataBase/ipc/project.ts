import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { getPublicDatabase } from '../index'
import {
  createProject,
  getProjectByKey,
  getProjectById,
  getAllProjects,
  updateProject,
  projectExists,
  searchProjects,
  getProjectByPath,
  type ProjectRecord
} from '../models/project'
import { GodotAssetProcessor } from '../../utils/fileProcessor/GodotAssetProcessor'
import { appSettingsManager } from '../../appSettingsManager'
import { toNativeProjectPath } from '../../utils/projectPath'
import {
  godotResourcesDir,
  installEditorLink,
  isEditorLinkInstalled
} from '../../godot/editorLinkAddon'
import { projectDirOf } from '../../services/project/openProject'
import { getProjectCoverService } from '../../services/project/projectCoverRuntime'
import {
  notifyProjectLibraryChanged,
  notifyProjectLibraryListeners
} from '../../services/project/projectLibraryEvents'

const ADDON_DIR = path.join('addons', 'gdbox_link')

/** plugin.cfg 里的 version="…"。读不到就是 null */
function readAddonVersion(pluginCfgPath: string): string | null {
  try {
    const text = fs.readFileSync(pluginCfgPath, 'utf8')
    return /^version="([^"]*)"/m.exec(text)?.[1] ?? null
  } catch {
    return null
  }
}

function bundledAddonVersion(): string {
  return readAddonVersion(path.join(godotResourcesDir(), ADDON_DIR, 'plugin.cfg')) ?? ''
}

/**
 * 确保工程里装着并启用了 GDBox Link 插件。用户在这个工程上点过「移除」就不装。
 *
 * 装不上不抛：原因写在 `pluginFailure` 里交给调用方提示用户。
 *
 * @param projectPath 工程目录或 `project.godot` 路径
 */
export async function ensureEditorLinkPlugin(
  projectPath: string
): Promise<{ pluginFailure: string | null }> {
  const projectDir = projectDirOf(projectPath)
  if (appSettingsManager.isEditorLinkOptedOut(projectDir)) return { pluginFailure: null }
  try {
    installEditorLink(projectDir)
    return { pluginFailure: null }
  } catch (error) {
    return { pluginFailure: error instanceof Error ? error.message : String(error) }
  }
}

/** 工程里 GDBox Link 的当前状态。字段名和渲染层的契约保持一致 */
export interface EditorLinkStatus {
  /** 插件目录在、有 plugin.cfg */
  installed: boolean
  /** 已安装的版本号，读不到就是 null */
  version: string | null
  /** 随应用分发的版本号 */
  bundledVersion: string
  /** 用户是否明确拒绝过这个工程 */
  optedOut: boolean
  /** project.godot 里是否已启用 */
  enabledInProject: boolean
}

/** 界面上要靠它决定右键菜单显示「安装」还是「移除」 */
export async function getEditorLinkStatus(projectPath: string): Promise<EditorLinkStatus> {
  const projectDir = projectDirOf(projectPath)
  const pluginCfg = path.join(projectDir, ADDON_DIR, 'plugin.cfg')
  const installed = fs.existsSync(pluginCfg)
  return {
    installed,
    version: installed ? readAddonVersion(pluginCfg) : null,
    bundledVersion: bundledAddonVersion(),
    optedOut: appSettingsManager.isEditorLinkOptedOut(projectDir),
    enabledInProject: isEditorLinkInstalled(projectDir)
  }
}

/** 从工程里移除 GDBox Link，并记住这个工程不再自动安装 */
export async function removeEditorLinkPlugin(
  projectPath: string
): Promise<{ success: boolean; error?: string }> {
  const projectDir = projectDirOf(projectPath)
  try {
    const projectFile = path.join(projectDir, 'project.godot')
    if (fs.existsSync(projectFile)) {
      const text = fs.readFileSync(projectFile, 'utf8')
      const next = text.replace(/"res:\/\/addons\/gdbox_link\/plugin\.cfg",?\s*/g, '')
      if (next !== text) fs.writeFileSync(projectFile, next)
    }
    fs.rmSync(path.join(projectDir, ADDON_DIR), { recursive: true, force: true })
    appSettingsManager.setEditorLinkOptOut(projectDir, true)
    return { success: true }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}

/** 把 GDBox Link 装回工程（撤销之前的「不要装」） */
export async function installEditorLinkPlugin(
  projectPath: string
): Promise<{ success: boolean; error?: string }> {
  const projectDir = projectDirOf(projectPath)
  appSettingsManager.setEditorLinkOptOut(projectDir, false)
  const { pluginFailure } = await ensureEditorLinkPlugin(projectDir)
  return pluginFailure ? { success: false, error: pluginFailure } : { success: true }
}

/**
 * 启动时把库里各工程已装的 GDBox Link 升到随包版本。
 *
 * 只升已经装着的：没装的工程用户可能是有意不装，打开时再按设置决定。
 */
export async function upgradeAllProjectPlugins(): Promise<void> {
  if (!appSettingsManager.getAutoEnableEditorLink()) return
  const bundled = bundledAddonVersion()
  for (const project of getAllProjects(getPublicDatabase())) {
    const projectDir = project.projectPath
    if (!projectDir || appSettingsManager.isEditorLinkOptedOut(projectDir)) continue
    const pluginCfg = path.join(projectDir, ADDON_DIR, 'plugin.cfg')
    if (!fs.existsSync(pluginCfg) || readAddonVersion(pluginCfg) === bundled) continue
    try {
      installEditorLink(projectDir)
    } catch (error) {
      console.warn(`[GDBox Link] 升级 ${projectDir} 失败:`, error)
    }
  }
}

export interface RegisterProjectResult {
  success: boolean
  error?: string
  /** 库里本来就有这个工程（按目录判重），没有新建记录 */
  alreadyRegistered?: boolean
  /**
   * 工程进库了，但 GDBox Link 没装上，以及为什么。
   *
   * 导入本身仍然算成功 —— 插件只是可选能力，为它把整次导入判失败不成比例。
   * 但必须说出来：不说的话，用户之后只会遇到「AI 连不上引擎」，而那时他已经
   * 想不起来这跟导入那一步有关系。
   */
  pluginFailure?: string
  data?: ProjectRecord
}

/**
 * 把一个 Godot 工程登记进项目库。
 *
 * ## 为什么要抽出来
 *
 * 工程进库的入口不止「用户在首页点导入」一个：agent 用 `project_manage`
 * 建的工程要进库，编辑器连上盒子时发现库里没有的工程也要补登记。这三条路
 * 各写一遍的结果是**同一个工程从不同入口进来长得不一样** —— 曾经的实际情况是
 * agent 那条路自己 `crypto.randomUUID()` 造 key、不抽封面、不装插件，
 * 于是首页上它是一张没有缩略图的空白卡片，用户一眼就看出「这个和别的不一样」。
 *
 * 抽成一个函数之后，「怎么算登记好了」只有一个定义。
 *
 * @param filePath 工程目录或 `project.godot` 的绝对路径
 */
export async function registerProjectByUproject(filePath: string): Promise<RegisterProjectResult> {
  try {
    const db = getPublicDatabase()
    // 统一成本机写法再入库：编辑器插件上报的是 `I:/Games/X`，
    // 文件对话框给的是 `I:\Games\X`，同一个工程两种写法
    const projectDir = toNativeProjectPath(projectDirOf(filePath))
    const projectFile = path.join(projectDir, 'project.godot')
    const processor = new GodotAssetProcessor()
    const projectMeta = await processor.processProject(projectFile, { includeThumbnail: false })

    const record: ProjectRecord = {
      projectKey: String(projectMeta.assetKey),
      projectName: String(projectMeta.name || ''),
      EngineAssociation: String(projectMeta.engineVersion || ''),
      projectData: '',
      projectPath: projectDir,
      originPath: projectFile,
      projectConfig: '',
      image: '',
      coverMode: 'auto',
      note: ''
    }

    // 基于项目路径的唯一性：同一路径已存在就不再建第二条记录
    const existing = getProjectByPath(db, record.projectPath!)
    if (existing) {
      return {
        success: false,
        alreadyRegistered: true,
        error: '项目已存在',
        data: existing
      }
    }

    const id = createProject(db, record)
    // 不等封面：后台扫描可能正排着别的工程的截图解码，登记不能跟着卡住；封面好了会再发库变更通知
    void getProjectCoverService().syncProject(record.projectKey)
    const saved = getProjectById(db, id)
    notifyProjectLibraryChanged()

    // 根据设置决定是否把 GDBox Link 装进工程
    let pluginFailure: string | undefined
    if (appSettingsManager.getAutoEnableEditorLink()) {
      pluginFailure = (await ensureEditorLinkPlugin(projectDir)).pluginFailure ?? undefined
    }

    return { success: true, data: saved, ...(pluginFailure ? { pluginFailure } : {}) }
  } catch (error) {
    console.error('导入项目失败:', error)
    return { success: false, error: (error as Error).message }
  }
}

/**
 * 注册项目数据相关的IPC处理函数（公共数据库）
 */
export const registerProjectIPC = (): void => {
  ipcMain.handle('db:project:saveCover', async (_, projectKey: string, image: Uint8Array) => {
    try {
      if (
        !(image instanceof Uint8Array) ||
        image.byteLength === 0 ||
        image.byteLength > 32 * 1024 * 1024
      ) {
        throw new Error('Invalid cover image')
      }
      const data = await getProjectCoverService().save(projectKey, image)
      return { success: true, data }
    } catch (error) {
      return { success: false, data: '', error: (error as Error).message }
    }
  })

  ipcMain.handle('db:project:restoreAutomaticCover', async (_, projectKey: string) => {
    try {
      await getProjectCoverService().restoreAutomatic(projectKey)
      return { success: true, data: true }
    } catch (error) {
      return { success: false, data: false, error: (error as Error).message }
    }
  })

  // 导入单个工程并写入数据库
  ipcMain.handle('db:project:importByFilePath', async (_, filePath: string) => {
    void _
    const result = await registerProjectByUproject(filePath)
    // alreadyRegistered 也带出去：首页在分组里导入一个已在库里的工程时，
    // 要拿 data 里那条现成记录把它放进分组，而不是报一句「已存在」了事
    return {
      success: result.success,
      error: result.error,
      data: result.data,
      alreadyRegistered: result.alreadyRegistered
    }
  })

  // 扫描目录中的 project.godot（仅扫描，不导入）
  ipcMain.handle('db:project:scanDirectory', async (_, startPath: string) => {
    void _
    try {
      const processor = new GodotAssetProcessor()
      const files = await processor.findAllProjects(startPath)
      return { success: true, data: files }
    } catch (error) {
      console.error('目录扫描项目失败:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // 扫描目录中的 project.godot 并批量导入
  ipcMain.handle('db:project:importByDirectory', async (_, startPath: string) => {
    void _
    try {
      const processor = new GodotAssetProcessor()
      const files = await processor.findAllProjects(startPath)

      // 逐个走 registerProjectByUproject，不在这里自己拼记录：判重、封面、
      // 插件安装这些「怎么算登记好了」的定义只能有一份，各写一遍必然漂
      const results: Array<{ filePath: string; id?: number; error?: string }> = []
      for (const filePath of files) {
        const result = await registerProjectByUproject(filePath)
        if (result.success) {
          results.push({ filePath, id: result.data?.id })
        } else {
          results.push({
            filePath,
            error: result.alreadyRegistered ? '项目已存在，跳过导入' : result.error
          })
        }
      }

      return { success: true, data: { total: files.length, results } }
    } catch (error) {
      console.error('目录导入项目失败:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // CRUD/查询
  ipcMain.handle('db:project:create', async (_, record: ProjectRecord) => {
    void _
    try {
      const db = getPublicDatabase()
      const id = createProject(db, record)
      notifyProjectLibraryListeners()
      return { success: true, data: id }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(
    'db:project:update',
    async (_, projectKey: string, updates: Partial<ProjectRecord>) => {
      void _
      try {
        const db = getPublicDatabase()
        // 封面只能走 saveCover / restoreAutomaticCover：直接改索引会被封面服务的磁盘记录悄悄改回去
        const safeUpdates = { ...updates }
        delete safeUpdates.image
        delete safeUpdates.coverMode
        const ok = updateProject(db, projectKey, safeUpdates)
        if (ok) notifyProjectLibraryListeners()
        return { success: true, data: ok }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle('db:project:getAll', async () => {
    try {
      const db = getPublicDatabase()
      const list = getAllProjects(db)
      return { success: true, data: list }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('db:project:getByKey', async (_, projectKey: string) => {
    void _
    try {
      const db = getPublicDatabase()
      const row = getProjectByKey(db, projectKey)
      return { success: true, data: row }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('db:project:delete', async (_, projectKey: string) => {
    void _
    try {
      const ok = await getProjectCoverService().remove(projectKey)
      return { success: true, data: ok }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('db:project:exists', async (_, projectKey: string) => {
    void _
    try {
      const db = getPublicDatabase()
      const exists = projectExists(db, projectKey)
      return { success: true, data: exists }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('db:project:search', async (_, keyword: string) => {
    void _
    try {
      const db = getPublicDatabase()
      const list = searchProjects(db, keyword)
      return { success: true, data: list }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // 查询某个工程的 GDBox Link 状态（右键菜单靠它决定显示「安装」还是「移除」）
  ipcMain.handle('db:project:editorLinkStatus', async (_, projectPath: string) => {
    void _
    try {
      if (!projectPath || !fs.existsSync(projectPath)) {
        return { success: false, error: '工程不存在' }
      }
      return { success: true, data: await getEditorLinkStatus(projectPath) }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // 从工程里移除 GDBox Link，并记住不再自动安装
  ipcMain.handle('db:project:editorLinkRemove', async (_, projectPath: string) => {
    void _
    if (!projectPath) return { success: false, error: '缺少工程路径' }
    return await removeEditorLinkPlugin(projectPath)
  })

  // 把 GDBox Link 装回工程（撤销之前的「不要装」）
  ipcMain.handle('db:project:editorLinkInstall', async (_, projectPath: string) => {
    void _
    if (!projectPath || !fs.existsSync(projectPath)) {
      return { success: false, error: '工程不存在' }
    }
    return await installEditorLinkPlugin(projectPath)
  })

  /**
   * 检测工程目录下是否有 .sln 文件（判断是否为 C# 工程）
   * Godot 的 C# 工程会在工程目录下生成一个 .sln 文件
   * @param projectDir - 工程目录路径（project.godot 所在目录）
   * @returns 如果找到 .sln 文件，返回其完整路径；否则返回 null
   */
  ipcMain.handle('db:project:findSlnFile', async (_, projectDir: string) => {
    void _
    try {
      if (!projectDir || typeof projectDir !== 'string') {
        return { success: false, error: '无效的项目路径' }
      }

      // 检查目录是否存在
      try {
        await fs.promises.access(projectDir, fs.constants.R_OK)
      } catch {
        return { success: true, data: null }
      }

      // 读取目录内容，查找 .sln 文件
      const entries = await fs.promises.readdir(projectDir, { withFileTypes: true })
      const slnFile = entries.find(
        (entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.sln')
      )

      if (slnFile) {
        const slnPath = path.join(projectDir, slnFile.name)
        return { success: true, data: slnPath }
      }

      return { success: true, data: null }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}

export type { ProjectRecord }
