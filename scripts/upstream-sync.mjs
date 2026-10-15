#!/usr/bin/env node
/**
 * 从虚幻盒子（uebox-pub）挑提交过来。
 *
 * GDBox 是 uebox-pub b6b4aab 整体复制出来的，两边的外壳、组件、agent-v3、服务商层大部分还是同一份代码，
 * 上游的修复和提效多数能直接 cherry-pick。这个脚本只管三件事：
 *
 *   status            拉上游，列出台账里还没定论的提交，并对每条做一次不落盘的试合并（git merge-tree），
 *                     告诉你能不能干净落地、冲突在哪几个文件、有几个文件 GDBox 里已经没有了
 *   pick <sha...>     按顺序 git cherry-pick -x，成功就记进台账；冲突时停下，解完后用 mark 记账
 *   mark <sha> <ported|skip|todo> [说明] [--local <本仓提交>]
 *                     手工记账：手工移植的、判定不要的、留着以后做的
 *
 * 台账在 scripts/upstream-sync.json：每条上游提交一个结论，status 只列没结论的和 todo 的。
 * 上游仓库默认在 ../uebox-pub，可用环境变量 GDBOX_UPSTREAM 指到别处；拉下来的提交放在
 * refs/upstream/uebox，不加 remote、不改 .git/config。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LEDGER_PATH = resolve(ROOT, 'scripts/upstream-sync.json')
const REF = 'refs/upstream/uebox'

function git(args, { allowFail = false } = {}) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
  if (r.status !== 0 && !allowFail) {
    process.stderr.write(r.stderr || r.stdout)
    process.exit(r.status ?? 1)
  }
  return { code: r.status, out: (r.stdout || '').trimEnd(), err: (r.stderr || '').trimEnd() }
}

function loadLedger() {
  return JSON.parse(readFileSync(LEDGER_PATH, 'utf8'))
}

function saveLedger(ledger) {
  const sorted = Object.fromEntries(
    Object.entries(ledger.entries).sort(([a], [b]) => a.localeCompare(b))
  )
  writeFileSync(LEDGER_PATH, JSON.stringify({ ...ledger, entries: sorted }, null, 2) + '\n')
}

function fetchUpstream(ledger) {
  const dir = resolve(ROOT, process.env.GDBOX_UPSTREAM || ledger.upstream.path)
  if (!existsSync(dir)) {
    console.error(`找不到上游仓库：${dir}（设 GDBOX_UPSTREAM 指过去）`)
    process.exit(1)
  }
  git(['fetch', '--no-tags', '-q', dir, `+${ledger.upstream.branch}:${REF}`])
}

const short = (sha) => sha.slice(0, 8)

/** 把用户给的短 sha 解析成上游的完整 sha */
function resolveSha(s) {
  const r = git(['rev-parse', '--verify', '--quiet', `${s}^{commit}`], { allowFail: true })
  if (r.code !== 0) {
    console.error(`上游没有这个提交：${s}（先跑一次 status 拉取）`)
    process.exit(1)
  }
  return r.out
}

/** 本仓历史里 cherry-pick -x 留下的来源，免得忘了记账的也被当成没做 */
function pickedFromLog() {
  const out = git(['log', '--format=%B', 'HEAD']).out
  return new Set(
    [...out.matchAll(/cherry picked from commit ([0-9a-f]{40})/g)].map((m) => short(m[1]))
  )
}

function trial(sha) {
  const r = git(
    [
      'merge-tree',
      '--write-tree',
      '--name-only',
      '--no-messages',
      `--merge-base=${sha}^`,
      'HEAD',
      sha
    ],
    { allowFail: true }
  )
  const conflicts = r.code === 1 ? r.out.split('\n').slice(1).filter(Boolean) : []
  const files = git(['diff-tree', '--no-commit-id', '--name-only', '-r', sha])
    .out.split('\n')
    .filter(Boolean)
  const missing = files.filter((f) => !existsSync(resolve(ROOT, f)))
  // 本仓早就有了：合完跟 HEAD 一样，或者碰到的文件跟上游改完后的那版逐字相同
  const present = files.filter((f) => !missing.includes(f))
  const already =
    (r.code === 0 && r.out.split('\n')[0] === git(['rev-parse', 'HEAD^{tree}']).out) ||
    (present.length > 0 &&
      git(['diff', '--quiet', 'HEAD', sha, '--', ...present], { allowFail: true }).code === 0)
  return { clean: r.code === 0, already, conflicts, files, missing }
}

function cmdStatus(ledger, all) {
  fetchUpstream(ledger)
  const picked = pickedFromLog()
  const shas = git(['rev-list', '--reverse', '--no-merges', `${ledger.base}..${REF}`])
    .out.split('\n')
    .filter(Boolean)
  const rows = []
  for (const sha of shas) {
    const key = short(sha)
    const entry =
      ledger.entries[key] ??
      (picked.has(key) ? { status: 'ported', note: '日志里有 cherry-pick 记录' } : null)
    if (!all && entry && entry.status !== 'todo') continue
    const subject = git(['log', '-1', '--format=%s', sha]).out
    const t = trial(sha)
    rows.push({ key, subject, entry, t })
  }
  if (!rows.length) {
    console.log(`上游 ${short(git(['rev-parse', REF]).out)} 之前的提交都有结论了。`)
    return
  }
  for (const { key, subject, entry, t } of rows) {
    const verdict = t.already ? '本仓已有' : t.clean ? '干净' : `冲突 ${t.conflicts.length}`
    const gone = t.missing.length ? `，本仓没有 ${t.missing.length}/${t.files.length} 个文件` : ''
    console.log(`${key}  [${entry?.status ?? '新'}] ${verdict}${gone}  ${subject}`)
    if (entry?.note) console.log(`          ${entry.note}`)
    for (const f of t.conflicts) console.log(`          ! ${f}`)
  }
  const fresh = rows.filter((r) => !r.entry).length
  console.log(
    `\n共 ${rows.length} 条（新 ${fresh}）。挑：node scripts/upstream-sync.mjs pick <sha>；不要：mark <sha> skip "理由"`
  )
}

function cmdPick(ledger, args) {
  fetchUpstream(ledger)
  for (const s of args) {
    const sha = resolveSha(s)
    const r = git(['cherry-pick', '-x', sha], { allowFail: true })
    // 落地后是空的：本仓早有同样的改动（分叉时连上游没提交的改动一起拷过来了）
    if (r.code !== 0 && /cherry-pick is now empty/.test(r.out + r.err)) {
      git(['cherry-pick', '--skip'])
      ledger.entries[short(sha)] = { status: 'ported', note: '本仓已有同样的改动' }
      saveLedger(ledger)
      console.log(`${short(sha)} 本仓已有，跳过`)
      continue
    }
    if (r.code !== 0) {
      console.error(r.out + '\n' + r.err)
      console.error(
        `\n${short(sha)} 冲突，停在这里。解完冲突 → git cherry-pick --continue → ` +
          `node scripts/upstream-sync.mjs mark ${short(sha)} ported "改了什么"；放弃用 git cherry-pick --abort`
      )
      process.exit(1)
    }
    const local = short(git(['rev-parse', 'HEAD']).out)
    ledger.entries[short(sha)] = { status: 'ported', local, note: ledger.entries[short(sha)]?.note }
    saveLedger(ledger)
    console.log(`${short(sha)} → ${local}`)
  }
}

function cmdMark(ledger, args) {
  const [s, status, ...rest] = args
  if (!s || !['ported', 'skip', 'todo'].includes(status)) {
    console.error('用法：mark <sha> <ported|skip|todo> [说明] [--local <本仓提交>]')
    process.exit(1)
  }
  const li = rest.indexOf('--local')
  const local = li >= 0 ? rest.splice(li, 2)[1] : undefined
  const note = rest.join(' ') || ledger.entries[short(resolveSha(s))]?.note
  ledger.entries[short(resolveSha(s))] = {
    status,
    ...(local ? { local } : {}),
    ...(note ? { note } : {})
  }
  saveLedger(ledger)
}

const [cmd = 'status', ...args] = process.argv.slice(2)
const ledger = loadLedger()
if (cmd === 'status') cmdStatus(ledger, args.includes('--all'))
else if (cmd === 'pick') cmdPick(ledger, args)
else if (cmd === 'mark') cmdMark(ledger, args)
else {
  console.error(`不认识的命令：${cmd}（status / pick / mark）`)
  process.exit(1)
}
