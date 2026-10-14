/**
 * 文件操作 IPC 处理器
 * 提供主进程侧的通用文件操作能力
 */

import { ipcMain, dialog } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import { glob } from 'glob'
import { BrowserWindow } from 'electron'
import { projectManager } from '../services/project'
import { parseExcelBuffer } from '../utils/excelParser'
import { parseProjectFile } from '../godot/projectFile'

// ============================================================================
// 类型定义
// ============================================================================

interface FileToolParams {
  toolName: string
  params: Record<string, unknown>
}

interface IniSection {
  [key: string]: string
}

interface IniData {
  [section: string]: IniSection
}

interface FileTypeStats {
  extension: string
  count: number
}

// ============================================================================
// 工具实现
// ============================================================================

/**
 * 读取 JSON 文件并解析
 */
async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  const content = await fs.readFile(filePath, 'utf-8')
  const parsed = JSON.parse(content)
  return {
    content,
    parsed,
    fileName: path.basename(filePath)
  }
}

/**
 * 读取 INI 文件并解析
 */
async function readIniFile(
  filePath: string,
  section?: string,
  key?: string
): Promise<Record<string, unknown>> {
  const content = (await fs.readFile(filePath, 'utf8')).replace(/^\uFEFF/, '')

  const sections: IniData = {}
  let currentSection = ''

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue

    const sectionMatch = trimmed.match(/^\[(.+)\]$/)
    if (sectionMatch) {
      currentSection = sectionMatch[1]
      sections[currentSection] = {}
      continue
    }

    const kvMatch = trimmed.match(/^([^=]+)=(.*)$/)
    if (kvMatch && currentSection) {
      sections[currentSection][kvMatch[1].trim()] = kvMatch[2].trim()
    }
  }

  let value = ''
  if (section && key && sections[section]) {
    value = sections[section][key] || ''
  }

  return {
    content,
    sections,
    value,
    fileName: path.basename(filePath)
  }
}

/**
 * 扫描目录并统计文件
 */
async function scanDirectory(
  dirPath: string,
  pattern: string = '*',
  recursive: boolean = true
): Promise<Record<string, unknown>> {
  const globPattern = recursive ? `**/${pattern}` : pattern

  // glob v10+ 返回类型需要正确处理
  let files: string[] = []
  try {
    const result = await glob(globPattern, { cwd: dirPath, nodir: true })
    files = Array.isArray(result) ? result : []
  } catch (err) {
    console.error('[File IPC] glob 扫描失败:', err)
    files = []
  }

  // 统计各类型文件数量
  const statsMap = new Map<string, number>()
  for (const file of files) {
    const ext = path.extname(file).toLowerCase() || '(no ext)'
    statsMap.set(ext, (statsMap.get(ext) || 0) + 1)
  }

  const fileTypeStats: FileTypeStats[] = Array.from(statsMap.entries())
    .map(([extension, count]) => ({ extension, count }))
    .sort((a, b) => b.count - a.count)

  // 生成统计摘要
  const summary = fileTypeStats
    .slice(0, 10)
    .map((s) => `${s.extension}: ${s.count}`)
    .join(', ')

  return {
    fileCount: files.length,
    fileList: files,
    fileTypeStats,
    summary: summary || '无文件',
    dirName: path.basename(dirPath)
  }
}

/**
 * 写入文本文件
 */
/**
 * 写入文本文件
 * 自动创建父目录，支持深层路径
 */
async function writeTextFile(
  dirPath: string,
  fileName: string,
  content: string
): Promise<Record<string, unknown>> {
  const filePath = path.join(dirPath, fileName)
  const fileDir = path.dirname(filePath)

  // 确保父目录存在
  await fs.mkdir(fileDir, { recursive: true })
  await fs.writeFile(filePath, content, 'utf-8')

  return {
    filePath,
    success: true
  }
}

/**
 * 读取文本文件 (通用)
 */
async function readTextFile(filePath: string): Promise<Record<string, unknown>> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return {
      content,
      fileName: path.basename(filePath),
      success: true
    }
  } catch (error) {
    console.warn(`[File IPC] 读取文本失败: ${filePath}`, error)
    return {
      content: '',
      fileName: path.basename(filePath),
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * 智能路径拼接
 * 自动处理分隔符，适配不同 OS
 */
async function joinPaths(paths: string[]): Promise<string> {
  // 过滤空路径
  const validPaths = paths.filter((p) => p && typeof p === 'string' && p.trim() !== '')
  if (validPaths.length === 0) return ''
  return path.join(...validPaths)
}

/**
 * 打开文件选择对话框
 */
async function pickFile(
  filters?: { name: string; extensions: string[] }[]
): Promise<Record<string, unknown>> {
  const win = BrowserWindow.getFocusedWindow()
  const result = await dialog.showOpenDialog(win!, {
    properties: ['openFile'],
    filters: filters || [{ name: 'All Files', extensions: ['*'] }]
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { filePath: '', canceled: true }
  }

  return {
    filePath: result.filePaths[0],
    fileName: path.basename(result.filePaths[0]),
    canceled: false
  }
}

/**
 * 打开目录选择对话框
 */
async function pickDirectory(): Promise<Record<string, unknown>> {
  const win = BrowserWindow.getFocusedWindow()
  const result = await dialog.showOpenDialog(win!, {
    properties: ['openDirectory']
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { dirPath: '', canceled: true }
  }

  return {
    dirPath: result.filePaths[0],
    dirName: path.basename(result.filePaths[0]),
    canceled: false
  }
}

/**
 * 获取当前连着的 Godot 工程
 * 从 ProjectManager 获取当前已连接的项目
 */
async function getCurrentUEProject(): Promise<Record<string, unknown>> {
  const currentProject = projectManager.getCurrentProject()

  if (currentProject) {
    return {
      projectPath: currentProject.projectPath || '',
      projectName: currentProject.projectName || '',
      engineVersion: currentProject.engineVersion || '',
      hasProject: true
    }
  }

  // 没有已连接的项目
  return {
    projectPath: '',
    projectName: '',
    engineVersion: '',
    hasProject: false
  }
}

/**
 * 读 Godot 工程信息（通道名沿用历史的 getUEProjectInfo）
 * @param projectPath 工程目录或 project.godot 的路径
 */
async function getUEProjectInfo(projectPath: string): Promise<Record<string, unknown>> {
  const empty = { projectName: '', engineVersion: '', description: '', modules: [], plugins: [] }
  if (!projectPath) {
    return { success: false, error: '未提供工程路径', ...empty, projectPath: '' }
  }
  try {
    const stat = await fs.stat(projectPath)
    const projectDir = stat.isDirectory() ? projectPath : path.dirname(projectPath)
    const projectFile = path.join(projectDir, 'project.godot')
    const text = await fs.readFile(projectFile, 'utf8')
    const summary = parseProjectFile(text)
    const description = /^config\/description="((?:[^"\\]|\\.)*)"/m.exec(text)?.[1] ?? ''
    const plugins = /^enabled=PackedStringArray\(([^)]*)\)/m.exec(text)?.[1]
    return {
      success: true,
      projectName: summary.name || path.basename(projectDir),
      engineVersion: summary.engineVersion || '',
      description,
      modules: [],
      plugins: plugins ? [...plugins.matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [],
      projectPath: projectDir,
      uprojectPath: projectFile
    }
  } catch (error) {
    console.warn(`[File IPC] 读取工程信息失败: ${projectPath}`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      ...empty,
      projectPath
    }
  }
}

// ============================================================================
// IPC 注册
// ============================================================================

/**
 * 注册文件操作 IPC 处理器
 */
export function registerFileIPC(): void {
  ipcMain.handle('file:execute', async (_event, args: FileToolParams) => {
    const { toolName, params } = args

    try {
      switch (toolName) {
        case 'readJson':
          return await readJsonFile(params.filePath as string)
        case 'readIni':
          return await readIniFile(
            params.filePath as string,
            params.section as string | undefined,
            params.key as string | undefined
          )
        case 'scanDirectory':
          return await scanDirectory(
            params.dirPath as string,
            params.pattern as string | undefined,
            params.recursive as boolean | undefined
          )
        case 'writeText':
          return await writeTextFile(
            params.dirPath as string,
            params.fileName as string,
            params.content as string
          )
        case 'pickFile':
          return await pickFile(params.filters as { name: string; extensions: string[] }[])
        case 'pickDirectory':
          return await pickDirectory()
        case 'readText':
          return await readTextFile(params.filePath as string)
        case 'pathJoin':
          return await joinPaths((params.paths as string[]) || [])
        case 'getCurrentUEProject':
          return await getCurrentUEProject()
        case 'getUEProjectInfo':
          return await getUEProjectInfo(params.projectPath as string)
        case 'parseExcel': {
          // 接收 ArrayBuffer 数据而非文件路径
          const bufferData = params.buffer as ArrayBuffer
          const fileName = params.fileName as string
          const buffer = Buffer.from(bufferData)
          return parseExcelBuffer(buffer, fileName)
        }
        case 'parseDocument': {
          // 解析 PDF/Word 文档
          // 接收 ArrayBuffer 数据，保存为临时文件后调用 documentLoader
          const docBuffer = params.buffer as number[]
          const docFileName = params.fileName as string

          // 动态导入 os 模块获取临时目录
          const os = await import('os')
          const tempDir = os.tmpdir()
          const tempFilePath = path.join(tempDir, `uaagent_${Date.now()}_${docFileName}`)

          try {
            // 保存临时文件
            await fs.writeFile(tempFilePath, Buffer.from(docBuffer))

            // 复用 documentLoader 的实现。
            //
            // 这里原先把 PDF / DOCX / DOC 三条分支各自又写了一遍（连注释都写着
            // 「已有的 loadDocument 函数」却没调它），于是两处的支持格式、
            // 空内容判定、超时策略会各自漂移。现在只留一个真相源。
            const { loadDocument } = await import('../sqliteDataBase/ipc/documentLoader')
            const result = await loadDocument(tempFilePath)

            // 删除临时文件
            await fs.unlink(tempFilePath).catch(() => {})

            if (!result.success || !result.content?.trim()) {
              return { success: false, error: result.error || '文档内容为空' }
            }

            return {
              success: true,
              content: result.content,
              fileName: docFileName
            }
          } catch (error) {
            // 尝试删除临时文件
            await fs.unlink(tempFilePath).catch(() => {})
            console.error('[File IPC] 文档解析失败:', error)
            return {
              success: false,
              error: error instanceof Error ? error.message : '文档解析失败'
            }
          }
        }
        default:
          throw new Error(`未知工具: ${toolName}`)
      }
    } catch (error) {
      console.error(`[File IPC] 工具 ${toolName} 执行失败:`, error)
      throw error
    }
  })

  console.log('[File IPC] 已注册 file:execute 处理器')
}
