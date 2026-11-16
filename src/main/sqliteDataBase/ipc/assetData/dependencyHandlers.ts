import { ipcMain } from 'electron'

import { getVaultDatabase } from '../../index'
import {
  findAssetsPossiblyImporting,
  getAssetDataByKey,
  getAssetsBySoftPaths,
  type AssetData
} from '../../models/assetData'
import type { AssetImportStatusSummary } from '../../../../shared/assetDependency'
import { buildImportStatusSummary, parseImports } from '../../../utils/assetDependency/importStatus'

/**
 * 找出「谁引用了这个 softPath」。
 *
 * imports 是 JSON 文本列，建不了索引，只能扫。但扫要在 SQLite 里扫（instr 预筛），
 * 不能把整张表捞进 JS 再逐行 parse：52 万行的镜像库上后者 50 秒、堆 1.5 GB 起，
 * 前者约 7 秒、内存只装命中的几十行。仍然是 O(全库)。
 */
function findReferencingAssets(
  db: ReturnType<typeof getVaultDatabase>,
  targetSoftPath: string,
  excludeAssetKey: string
): AssetData[] {
  if (!targetSoftPath) return []
  return findAssetsPossiblyImporting(db, targetSoftPath, excludeAssetKey).filter((asset) =>
    parseImports(asset.imports).includes(targetSoftPath)
  )
}

export function registerAssetDependencyIPC(): void {
  ipcMain.handle('db:assetData:getAssetReferences', async (_, assetKey: string) => {
    void _
    try {
      const db = getVaultDatabase()
      const currentAsset = getAssetDataByKey(db, assetKey)

      if (!currentAsset || !currentAsset.softPath) {
        return { success: true, data: [] }
      }

      return {
        success: true,
        data: findReferencingAssets(db, currentAsset.softPath, assetKey)
      }
    } catch (error) {
      console.error('查询资产引用失败:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  /**
   * 详情面板用的轻量接口：这个资产引用的每一条依赖，在不在当前保管库里。
   *
   * 只做一次带 idx_assetData_softPath 索引的批量查询，不全表扫、不碰磁盘 ——
   * 用户每点一个资产就会调一次，必须便宜。
   */
  ipcMain.handle('db:assetData:getAssetImportStatus', async (_, assetKey: string) => {
    void _
    try {
      const db = getVaultDatabase()
      const currentAsset = getAssetDataByKey(db, assetKey)

      const empty: AssetImportStatusSummary = { total: 0, unresolvedCount: 0, items: [] }
      if (!currentAsset) return { success: true, data: empty }

      const softPaths = parseImports(currentAsset.imports)
      if (softPaths.length === 0) return { success: true, data: empty }

      return {
        success: true,
        data: buildImportStatusSummary(softPaths, getAssetsBySoftPaths(db, softPaths))
      }
    } catch (error) {
      console.error('查询资产导入依赖状态失败:', error)
      return { success: false, error: (error as Error).message }
    }
  })
}
