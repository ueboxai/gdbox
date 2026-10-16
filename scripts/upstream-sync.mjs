#!/usr/bin/env node
/** One-way source porting. Only this repository is written; see docs/upstream-sync.md. */
import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REF = 'refs/upstream/uebox'
const LEDGER = 'scripts/upstream-sync.json'
const POLICY = 'scripts/upstream-policy.json'
const lines = (text) => text.trim().split('\n').filter(Boolean)
const short = (sha) => sha.slice(0, 8)

/** Prefixes end in /; all other rules match one exact path. Unknowns never auto-pass. */
export function classify(files, policy) {
  const paths = files.map(({ path, status }) => ({
    path,
    status,
    kind:
      ['protected', 'engine', 'review', 'shared'].find((kind) =>
        policy[kind].some((rule) => (rule.endsWith('/') ? path.startsWith(rule) : path === rule))
      ) ?? 'unknown'
  }))
  const kinds = new Set(paths.map((file) => file.kind))
  const category =
    kinds.size === 1 && kinds.has('shared')
      ? 'shared-candidate'
      : kinds.size === 1 && kinds.has('engine')
        ? 'engine-only'
        : 'needs-review'
  return { category, paths }
}

export function createSync({ root = ROOT, upstreamPath = process.env.GDBOX_UPSTREAM } = {}) {
  function git(args, allowFail = false) {
    const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })
    if (result.error) throw result.error
    if (result.status !== 0 && !allowFail) {
      throw new Error(result.stderr || result.stdout || `git ${args[0]} failed: ${result.status}`)
    }
    return { code: result.status, out: result.stdout || '', err: result.stderr || '' }
  }

  const read = (file) => JSON.parse(readFileSync(resolve(root, file), 'utf8'))
  const commit = (ref) =>
    git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).out.trim()
  const ancestor = (a, b) => {
    const result = git(['merge-base', '--is-ancestor', a, b], true)
    if (![0, 1].includes(result.code)) throw new Error(result.err || '无法检查提交关系')
    return result.code === 0
  }
  const gitPath = (name) => resolve(root, git(['rev-parse', '--git-path', name]).out.trim())

  function assertIdle() {
    for (const name of [
      'CHERRY_PICK_HEAD',
      'MERGE_HEAD',
      'rebase-merge',
      'rebase-apply',
      'sequencer'
    ]) {
      if (existsSync(gitPath(name)))
        throw new Error(`还有未结束的 Git 操作：${name}，先完成或自行中止。`)
    }
  }

  function locked(action) {
    const path = gitPath('gdbox-upstream.lock')
    let fd
    try {
      fd = openSync(path, 'wx')
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      throw new Error(`同步正在运行：${path}；若进程已退出，确认后手工移除该锁。`)
    }
    try {
      return action()
    } finally {
      closeSync(fd)
      unlinkSync(path)
    }
  }

  function save(ledger, sha, entry) {
    // Preserve legacy eight-character keys, but use full SHAs for new records.
    const key = ledger.entries[sha] ? sha : ledger.entries[short(sha)] ? short(sha) : sha
    ledger.entries[key] = entry
    writeFileSync(resolve(root, LEDGER), JSON.stringify(ledger, null, 2) + '\n')
  }

  function snapshot(ledger, requested) {
    const tip = commit(requested || REF)
    const base = commit(ledger.base)
    if (!ancestor(base, tip)) throw new Error('快照不是登记基点的后代；不要自动更改 base。')
    // A requested snapshot must belong to the fetched upstream, not a local GDBox commit.
    if (requested && !ancestor(tip, commit(REF))) throw new Error('快照不属于已获取的上游。')
    const shas = lines(git(['rev-list', '--reverse', '--topo-order', `${base}..${tip}`]).out)
    return { tip, base, shas }
  }

  function sourceSha(value, range) {
    if (!/^[a-f0-9]{7,40}$/i.test(value)) throw new Error(`请使用上游提交 SHA：${value}`)
    const sha = commit(value)
    if (!range.shas.includes(sha)) throw new Error(`提交不在本批快照范围内：${value}`)
    return sha
  }

  function entryFor(ledger, sha) {
    return ledger.entries[sha] ?? ledger.entries[short(sha)] ?? null
  }

  function pickedFromLog() {
    return new Set(
      [
        ...git(['log', '--format=%B', 'HEAD']).out.matchAll(
          /cherry picked from commit ([a-f0-9]{40})/g
        )
      ].map((match) => match[1])
    )
  }

  function describe(sha, policy) {
    const parents = git(['show', '-s', '--format=%P', sha]).out.trim().split(' ')
    // Diff against the first parent so merge-only resolutions are visible too.
    // Disable rename detection: inspect both old and new paths, including deleted engine files.
    const tokens = git(['diff', '--name-status', '--no-renames', '-z', parents[0], sha]).out.split(
      '\0'
    )
    const files = []
    for (let i = 0; i < tokens.length - 1; i += 2) {
      files.push({ status: tokens[i], path: tokens[i + 1] })
    }
    return {
      sha,
      subject: git(['show', '-s', '--format=%s', sha]).out.trim(),
      merge: parents.length > 1,
      ...classify(files, policy)
    }
  }

  function trial(sha) {
    const result = git(
      [
        'merge-tree',
        '--write-tree',
        '--name-only',
        '--no-messages',
        `--merge-base=${sha}^`,
        'HEAD',
        sha
      ],
      true
    )
    if (![0, 1].includes(result.code)) throw new Error(result.err || `试合并失败：${sha}`)
    const output = lines(result.out)
    return {
      clean: result.code === 0,
      // Only the complete resulting tree can prove the patch is already present.
      already: result.code === 0 && output[0] === git(['rev-parse', 'HEAD^{tree}']).out.trim(),
      conflicts: result.code === 1 ? output.slice(1) : []
    }
  }

  function fetch() {
    return locked(() => {
      assertIdle()
      const ledger = read(LEDGER)
      const dir = resolve(root, upstreamPath || ledger.upstream.path)
      if (!existsSync(dir))
        throw new Error(`找不到上游：${dir}；设置 GDBOX_UPSTREAM 或使用 --no-fetch。`)
      // Local committed objects only. No command, checkout, pull or write in the source repo.
      git([
        'fetch',
        '--no-tags',
        '--no-write-fetch-head',
        '-q',
        dir,
        `+refs/heads/${ledger.upstream.branch}:${REF}`
      ])
      return snapshot(ledger).tip
    })
  }

  function status({ refresh = true, all = false, snapshot: requested } = {}) {
    if (refresh && requested) throw new Error('--snapshot 必须搭配 --no-fetch，避免改变评估范围。')
    if (refresh) fetch()
    const ledger = read(LEDGER)
    const policy = read(POLICY)
    const range = snapshot(ledger, requested)
    const picked = pickedFromLog()
    const rows = []
    for (const sha of range.shas) {
      const entry = entryFor(ledger, sha)
      if (
        !all &&
        (entry?.status === 'skip' ||
          (entry?.status === 'ported' && entry.verification !== 'not-run'))
      )
        continue
      const item = describe(sha, policy)
      rows.push({
        ...item,
        entry,
        unrecordedPick: !entry && picked.has(sha),
        trial: item.merge ? null : trial(sha)
      })
    }
    return {
      snapshot: range.tip,
      base: range.base,
      head: commit('HEAD'),
      dirty: Boolean(git(['status', '--porcelain', '--untracked-files=all']).out),
      rows
    }
  }

  function pick(values, { snapshot: requested } = {}) {
    return locked(() => {
      assertIdle()
      if (!values.length) throw new Error('用法：pick <sha...> [--snapshot <sha>]')
      if (git(['status', '--porcelain', '--untracked-files=all']).out) {
        throw new Error(
          '工作区不干净（包含台账或未跟踪文件）。在干净的 GDBox 隔离工作区执行，不自动 stash/reset。'
        )
      }
      const ledger = read(LEDGER)
      const policy = read(POLICY)
      const range = snapshot(ledger, requested)
      const selected = new Set(values.map((value) => sourceSha(value, range)))
      const ordered = range.shas.filter((sha) => selected.has(sha))
      const picked = pickedFromLog()
      // Validate the whole selection before the first mutation. Dependencies still need review.
      for (const sha of ordered) {
        const item = describe(sha, policy)
        if (item.merge || item.category !== 'shared-candidate') {
          throw new Error(
            `${short(sha)} 需要手工适配（${item.category}${item.merge ? ', merge' : ''}），见 docs/upstream-sync.md。`
          )
        }
        if (
          ['ported', 'partial', 'skip'].includes(entryFor(ledger, sha)?.status) ||
          picked.has(sha)
        ) {
          throw new Error(`${short(sha)} 已处理或已有挑取记录，请核对台账，不重复挑取。`)
        }
      }
      const applied = []
      for (const sha of ordered) {
        const before = trial(sha)
        if (!before.already) {
          const result = git(['cherry-pick', '-x', sha], true)
          if (result.code !== 0) {
            throw new Error(
              `${applied.length} 条已记录，${short(sha)} 未完成，后续未执行。\n${result.err}${result.out}\n` +
                '保留现场；解决后 git cherry-pick --continue，再用 mark 记录。放弃当前挑取可 git cherry-pick --abort（不会撤回前面已成功的提交）。'
            )
          }
        }
        const local = commit('HEAD')
        save(ledger, sha, {
          status: 'ported',
          local,
          snapshot: range.tip,
          mode: before.already ? 'already-present' : 'cherry-pick',
          note: before.already ? '完整试合并树与 HEAD 相同' : '已挑取，尚未验证',
          verification: 'not-run'
        })
        applied.push({ sha, local, already: before.already })
      }
      return applied
    })
  }

  function mark(value, state, note, { local, verification, snapshot: requested } = {}) {
    return locked(() => {
      assertIdle()
      if (!['ported', 'partial', 'skip', 'todo'].includes(state) || !note?.trim()) {
        throw new Error(
          'mark 需要 ported|partial|skip|todo 和非空说明；partial 必须说明已迁入及剩余部分。'
        )
      }
      const ledger = read(LEDGER)
      const range = snapshot(ledger, requested)
      const sha = sourceSha(value, range)
      if (['ported', 'partial'].includes(state) && !local)
        throw new Error('ported/partial 必须用 --local 指定本仓提交。')
      const localSha = local ? commit(local) : undefined
      if (localSha && !ancestor(localSha, commit('HEAD')))
        throw new Error('--local 必须是当前 GDBox 历史中的提交。')
      save(ledger, sha, {
        status: state,
        ...(localSha ? { local: localSha } : {}),
        snapshot: range.tip,
        note,
        verification: verification || 'not-run'
      })
    })
  }

  return { fetch, status, pick, mark }
}

const HELP = `GDBox 单向移植（不会修改 UEBox）
  pnpm upstream [status] [--no-fetch] [--all] [--json] [--snapshot <sha>]
  pnpm upstream fetch
  pnpm upstream pick <sha...> [--snapshot <sha>]
  pnpm upstream mark <sha> <ported|partial|skip|todo> "说明" [--local <sha>] [--verification "结果"] [--snapshot <sha>]
status 默认获取本地上游已提交的分支；pick/mark 永远不重新获取。
路径分类仅供筛选，shared-candidate 仍需检查依赖和行为；trial.clean 不代表验收通过。
pick 只接受通用候选，在当前 GDBox 分支创建提交并留下待提交的台账；其他改动由移植技能适配。
详见 docs/upstream-sync.md 和 docs/gdbox-differences.md。`

export function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) return console.log(HELP)
  const [command = 'status', ...rest] = args
  const allowed = {
    status: ['--no-fetch', '--all', '--json', '--snapshot'],
    fetch: [],
    pick: ['--snapshot'],
    mark: ['--snapshot', '--local', '--verification']
  }
  if (!allowed[command]) throw new Error(`未知命令：${command}\n${HELP}`)
  const positional = []
  const options = {}
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    if (!allowed[command].includes(arg) || arg in options)
      throw new Error(`无效或重复的参数：${arg}`)
    if (['--snapshot', '--local', '--verification'].includes(arg)) {
      const value = rest[++i]
      if (!value || value.startsWith('--')) throw new Error(`${arg} 缺少值`)
      options[arg] = value
    } else options[arg] = true
  }
  if (['status', 'fetch'].includes(command) && positional.length)
    throw new Error('此命令不接受位置参数')
  const sync = createSync()
  const target = { snapshot: options['--snapshot'] }
  if (command === 'fetch') console.log(`固定上游快照：${sync.fetch()}`)
  else if (command === 'pick') {
    for (const item of sync.pick(positional, target))
      console.log(`${short(item.sha)} → ${item.local}${item.already ? '（已有）' : ''}`)
    console.log('代码已记录；验证尚未运行。验证后更新并单独提交台账。')
  } else if (command === 'mark') {
    const [sha, state, ...note] = positional
    sync.mark(sha, state, note.join(' '), {
      ...target,
      local: options['--local'],
      verification: options['--verification']
    })
    console.log('台账已更新，尚未提交。')
  } else {
    const report = sync.status({
      ...target,
      refresh: !options['--no-fetch'],
      all: Boolean(options['--all'])
    })
    if (options['--json']) return console.log(JSON.stringify(report, null, 2))
    console.log(
      `上游快照：${report.snapshot}\nGDBox：${report.head}${report.dirty ? '（有未提交改动；试合并仅针对 HEAD）' : ''}`
    )
    for (const row of report.rows) {
      const trial = row.merge
        ? '合并提交，检查独有改动'
        : row.trial.already
          ? '补丁已存在'
          : row.trial.clean
            ? '文本可合并'
            : `冲突 ${row.trial.conflicts.length}`
      console.log(
        `${short(row.sha)} [${row.entry?.status ?? 'new'}] ${row.category} | ${trial} | ${row.subject}`
      )
      if (row.unrecordedPick) console.log('  已有挑取记录但未记账，请核对后 mark。')
      if (row.entry)
        console.log(
          `  ${row.entry.note || ''}；验证：${row.entry.verification || '历史记录未注明'}`
        )
      for (const file of row.paths) console.log(`  ${file.status} [${file.kind}] ${file.path}`)
      for (const path of row.trial?.conflicts ?? []) console.log(`  ! ${path}`)
    }
    console.log(`共 ${report.rows.length} 条；分类不等于批准迁入，依赖与 Godot 行为仍需核对。`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
