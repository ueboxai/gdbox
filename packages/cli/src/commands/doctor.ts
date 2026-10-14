/**
 * `gdbox doctor` —— 逐层往下查，卡在哪一层就说哪一层该怎么办。
 *
 * 四层：连接（配置与认证都在这一层暴露，靠 error.code 区分）→ 接口契约 →
 * 工具范围 → 工程。
 *
 * ## 为什么要逐层而不是「能不能用」一句话
 *
 * 「用不了」有好几种完全不同的原因，对应好几种完全不同的下一步。只报一句
 * 「连接失败」，用户（或 Agent）只能挨个试。逐层报出来之后，卡住的那一层
 * 自带解法。
 *
 * ## 编辑器没连着不算体检失败
 *
 * GDBox 的检查、试玩、截图都是起一个无头 Godot 跑的，不需要编辑器开着。
 * 所以最后一层只报「登记了几个工程、几个编辑器连着」，零个编辑器时提示
 * editor_* 工具暂时用不了，但不把整次体检判成失败 —— 那会让一个完全能干活
 * 的环境在脚本里看起来是坏的。
 */

import { failure, success, type Envelope } from '../envelope.js'
import { GdboxError, type ErrorCode } from '../errors.js'
import { requireContract } from '../connection.js'
import * as runtime from '../runtime.js'
import { supportedTools } from '../tools.js'

export interface DoctorOptions {
  configPath?: string
  timeoutSeconds?: number
  project?: string
  env?: NodeJS.ProcessEnv
}

type CheckStatus = 'ok' | 'failed' | 'skipped'

interface Check {
  name: string
  status: CheckStatus
  detail: string
  hint?: string
}

export async function runDoctor(options: DoctorOptions): Promise<Envelope> {
  const checks: Check[] = []

  let rt: runtime.Runtime | undefined
  try {
    rt = await runtime.open({
      ...(options.configPath ? { configPath: options.configPath } : {}),
      ...(options.timeoutSeconds ? { timeoutSeconds: options.timeoutSeconds } : {}),
      ...(options.env ? { env: options.env } : {})
    })
  } catch (error) {
    // 连不上就到此为止：后面几层全都依赖这一层，硬跑只会得到一串
    // 互相重复的失败，把真正的原因埋掉。
    const failed = error as GdboxError
    checks.push({
      name: 'connection',
      status: 'failed',
      detail: failed.message,
      ...(failed.hint ? { hint: failed.hint } : {})
    })
    return report(checks, failed.code)
  }

  try {
    checks.push({
      name: 'connection',
      status: 'ok',
      detail: `已连接 ${rt.host.url}（配置来源：${rt.host.source}）`
    })

    // ── 契约 ────────────────────────────────────────────────────────────
    try {
      const capability = requireContract(rt.session)
      checks.push({
        name: 'contract',
        status: 'ok',
        detail: `CLI 契约版本 ${capability.cliContractVersion}；支持指定工程：${capability.projectTargeting ? '是' : '否'}`
      })
    } catch (error) {
      const failed = error as GdboxError
      checks.push({
        name: 'contract',
        status: 'failed',
        detail: failed.message,
        ...(failed.hint ? { hint: failed.hint } : {})
      })
      // 契约不在的话工具范围和工程注册都问不出可信答案
      checks.push({ name: 'tools', status: 'skipped', detail: '契约不可用，跳过。' })
      checks.push({ name: 'projects', status: 'skipped', detail: '契约不可用，跳过。' })
      return report(checks, failed.code)
    }

    // ── 工具范围 ────────────────────────────────────────────────────────
    const all = await runtime.catalog(rt)
    const usable = supportedTools(all)
    const writable = all.filter((tool) => tool.write)
    /*
     * 命名空间那道门拆了之后，真正限制 CLI 的只剩盒子那头的开关。
     *
     * 清单里一个写工具都没有，几乎总是因为盒子的 MCP 设置没勾「同时开放写操作
     * 工具」—— 那时 `--allow-write` 敲了也没用，因为要调的那个工具压根不在
     * 清单里，报出来是一句「不在当前开放的清单里」，看不出根因在盒子的设置里。
     * 这是体检该替人说破的那种事，所以宁可在全绿时也多报一句。
     */
    checks.push({
      name: 'tools',
      status: usable.length > 0 ? 'ok' : 'failed',
      detail:
        usable.length > 0
          ? `服务开放 ${all.length} 个工具，${usable.length} 个只读，${writable.length} 个要 --allow-write。`
          : `服务开放 ${all.length} 个工具，但没有一个是 CLI 能调的。`,
      ...(usable.length === 0
        ? { hint: '在 GDBox 的「设置 → MCP」里确认暴露范围没有被命名空间白名单收得太窄。' }
        : writable.length === 0
          ? {
              hint:
                '清单里没有会改动东西的工具 —— 多半是 GDBox 的「设置 → MCP → 外部客户端的权限」' +
                '设成了只读。只读的活不受影响。'
            }
          : {})
    })

    // ── 工程 ────────────────────────────────────────────────────────────
    const projects = await runtime.listProjects(rt, all)
    const warnings: string[] = []
    if (!projects) {
      const unavailable = runtime.projectListUnavailable()
      checks.push({
        name: 'projects',
        status: 'skipped',
        detail: `${unavailable.message}用 --project 指定工程的命令不受影响。`
      })
    } else {
      const connected = projects.filter((p) => p.editorConnected)
      checks.push({
        name: 'projects',
        status: 'ok',
        detail:
          `「我的项目」登记了 ${projects.length} 个工程，${connected.length} 个 Godot 编辑器连着` +
          (connected.length ? `：${connected.map((p) => p.name).join('、')}` : '。')
      })
      if (connected.length === 0) {
        warnings.push(
          '没有连着的 Godot 编辑器：editor_* 工具现在用不了。用 Godot 编辑器打开工程，' +
            '并在「项目设置 → 插件」里启用 GDBox Link；godot_check / godot_run / godot_screenshot 不需要编辑器。'
        )
      }
    }

    // ── 这一次会发给谁 ──────────────────────────────────────────────────
    //
    // 只在能定下来的时候报。定不下来（没给 --project、不在工程目录、编辑器不止一个）
    // 不算 doctor 失败：那是「你下条命令要带 --project」，不是「环境有问题」。
    let target: { name: string; path: string; source: string } | null = null
    try {
      target = (await runtime.targetProject(rt, options.project, all)) ?? null
    } catch (error) {
      warnings.push((error as GdboxError).hint ?? (error as GdboxError).message)
    }

    return report(
      checks,
      undefined,
      {
        projects: (projects ?? []).map((p) => ({
          name: p.name,
          path: p.path,
          editorConnected: p.editorConnected
        })),
        target
      },
      warnings
    )
  } catch (error) {
    const failed = error as GdboxError
    checks.push({
      name: 'projects',
      status: 'failed',
      detail: failed.message,
      ...(failed.hint ? { hint: failed.hint } : {})
    })
    return report(checks, failed.code)
  } finally {
    await rt.close()
  }
}

/**
 * 组装信封。
 *
 * `data` 和 `error` **互斥**（§6.1）—— doctor 也不例外。为了这一个命令破例的话，
 * 每个解析输出的调用方都得为它写一段特判，而信封的全部价值就是不用特判。
 *
 * 所以失败时把逐层结果压进 `error.message`：卡住的那一层放在第一行（调用方
 * 通常只读这一行），完整清单跟在后面。要机器读的那部分 —— 哪一层、该怎么办 ——
 * 由 `error.code` 和 `error.hint` 承载，一个字都没丢。
 */
function report(
  checks: Check[],
  failedCode?: ErrorCode,
  extra: Record<string, unknown> = {},
  warnings: string[] = []
): Envelope {
  if (!failedCode) return success({ data: { checks, ...extra }, warnings })

  const broken = checks.find((check) => check.status === 'failed')
  const headline = broken?.detail ?? '体检未通过。'

  // 只有一层时不附清单：那一行会和 headline 一字不差地重复，
  // 把一条本来干净的错误信息撑成三行
  const summary =
    checks.length > 1
      ? ['', '逐层结果：', ...checks.map((c) => `  [${symbolOf(c.status)}] ${c.name}：${c.detail}`)]
      : []

  return failure({
    code: failedCode,
    message: [headline, ...summary].join('\n'),
    ...(broken?.hint ? { hint: broken.hint } : {}),
    execution: 'not_started',
    warnings
  })
}

function symbolOf(status: CheckStatus): string {
  return status === 'ok' ? '通过' : status === 'failed' ? '失败' : '跳过'
}
