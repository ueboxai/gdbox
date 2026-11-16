import { app } from 'electron'
import { join } from 'path'

/**
 * 对外名是 GODOT BOX（productName），但 userData 必须留在原来的 `GDBox` 目录：
 * Electron 默认按 productName 取 userData，不钉住的话改名后老用户的设置、数据库全都「消失」，
 * gdbox CLI 也按 `GDBox` 这个目录名找 mcp-server.json（packages/cli/src/config.ts）。
 *
 * 单例锁、日志在启动早期就会用到 userData，所以这个模块必须是 index.ts 的第一个 import。
 */
// 端到端测试另起一份数据：用户自己的 GDBox 开着时，两个实例共用一份 userData 会互相写坏会话和数据库
app.setPath('userData', process.env.GDBOX_USER_DATA_DIR || join(app.getPath('appData'), 'GDBox'))
