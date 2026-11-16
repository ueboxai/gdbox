// @vitest-environment node
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { classify, createSync } from '../../scripts/upstream-sync.mjs'
import policy from '../../scripts/upstream-policy.json'
import {
  commitAll,
  git,
  initTempGitRepo,
  removeTempRepos,
  writeRepoFile
} from '../support/temp-git-repo'

const repos: string[] = []
const file = 'src/main/ai/provider.ts'
const other = 'src/main/ai/另一个 文件.ts'
const ledgerPath = 'scripts/upstream-sync.json'
const write = writeRepoFile
const commit = commitAll

afterEach(() => removeTempRepos(repos))

interface Fixture {
  root: string
  upstream: string
  base: string
  sync: ReturnType<typeof createSync>
  ledger: () => { entries: Record<string, Record<string, string>> }
  change: (text: string, path?: string) => string
}

function fixture(): Fixture {
  const upstream = initTempGitRepo(repos, 'gdbox-source-')
  const root = initTempGitRepo(repos, 'gdbox-port-')
  for (const dir of [upstream, root]) write(dir, file, 'base\n')
  const base = commit(upstream, 'source base')
  write(
    root,
    ledgerPath,
    JSON.stringify({ upstream: { path: upstream, branch: 'main' }, base, entries: {} })
  )
  write(root, 'scripts/upstream-policy.json', JSON.stringify(policy))
  commit(root, 'independent GDBox root')
  const sync = createSync({ root, upstreamPath: upstream })
  const ledger: Fixture['ledger'] = () => JSON.parse(readFileSync(join(root, ledgerPath), 'utf8'))
  const change = (text: string, path = file): string => {
    write(upstream, path, text)
    return commit(upstream, `source ${text.trim()}`)
  }
  return { root, upstream, base, sync, ledger, change }
}

describe('upstream path policy', () => {
  it('keeps unknown, protected and mixed changes out of automatic picking', () => {
    const paths = (names: string[]): Array<{ path: string; status: string }> =>
      names.map((path) => ({ path, status: 'M' }))
    expect(classify(paths([file]), policy).category).toBe('shared-candidate')
    expect(classify(paths(['src/main/godot/run.ts']), policy).category).toBe('engine-only')
    for (const path of [
      'package.json',
      'new/feature.ts',
      'src/main/agent-v3/core/team/teamTools.ts'
    ]) {
      expect(classify(paths([file, path]), policy).category).toBe('needs-review')
    }
    expect(classify(paths(['src/main/ai-lookalike/a.ts']), policy).paths[0].kind).toBe('unknown')
  })
})

describe('one-way porting against real independent Git repositories', () => {
  it('pins committed source, excludes dirty source files, and works offline after fetching', () => {
    const f = fixture()
    const selected = f.change('selected\n')
    write(f.upstream, file, 'uncommitted source\n')
    const sourceBefore = git(f.upstream, ['status', '--porcelain'])
    const targetBefore = git(f.root, ['rev-parse', 'HEAD'])
    const ledgerBefore = readFileSync(join(f.root, ledgerPath), 'utf8')
    const report = f.sync.status()
    expect(report.snapshot).toBe(selected)
    expect(report.rows[0].trial.clean).toBe(true)
    expect(git(f.root, ['rev-parse', 'HEAD'])).toBe(targetBefore)
    expect(readFileSync(join(f.root, ledgerPath), 'utf8')).toBe(ledgerBefore)
    const offline = createSync({ root: f.root, upstreamPath: join(f.root, 'missing-source') })
    expect(offline.status({ refresh: false }).snapshot).toBe(selected)
    offline.pick([selected], { snapshot: selected })
    expect(readFileSync(join(f.root, file), 'utf8')).toBe('selected\n')
    expect(git(f.upstream, ['status', '--porcelain'])).toBe(sourceBefore)
    expect(readFileSync(join(f.upstream, file), 'utf8')).toBe('uncommitted source\n')
    expect(f.ledger().entries[selected]).toMatchObject({
      status: 'ported',
      snapshot: selected,
      verification: 'not-run'
    })
    expect(offline.status({ refresh: false }).rows[0].entry.verification).toBe('not-run')
    expect(git(f.root, ['log', '-1', '--format=%B'])).toContain(
      `cherry picked from commit ${selected}`
    )
  }, 30000)

  it('keeps an explicit old snapshot and applies selected dependencies in upstream order', () => {
    const f = fixture()
    const first = f.change('first\n')
    const second = f.change('second\n')
    f.sync.fetch()
    const third = f.change('third\n')
    f.sync.fetch()
    expect(f.sync.status({ refresh: false, snapshot: second }).rows.map((r) => r.sha)).toEqual([
      first,
      second
    ])
    expect(() => f.sync.pick([third], { snapshot: second })).toThrow('快照范围')
    expect(f.sync.pick([second, first, first], { snapshot: second }).map((r) => r.sha)).toEqual([
      first,
      second
    ])
    expect(readFileSync(join(f.root, file), 'utf8')).toBe('second\n')
  }, 30000)

  it('rejects dirty, staged and untracked target state without losing any work', () => {
    const f = fixture()
    const sha = f.change('source\n')
    f.sync.fetch()
    write(f.root, file, 'local unfinished\n')
    expect(() => f.sync.pick([sha])).toThrow('工作区不干净')
    git(f.root, ['add', '--', file])
    expect(() => f.sync.pick([sha])).toThrow('工作区不干净')
    commit(f.root, 'local work')
    write(f.root, 'untracked.txt', 'keep me')
    expect(() => f.sync.pick([sha])).toThrow('工作区不干净')
    expect(readFileSync(join(f.root, 'untracked.txt'), 'utf8')).toBe('keep me')
    expect(f.sync.status({ refresh: false }).dirty).toBe(true)
  }, 30000)

  it('validates the whole selection before applying and rejects local or protected commits', () => {
    const f = fixture()
    const common = f.change('common\n')
    const protectedSha = f.change('{}\n', 'package.json')
    f.sync.fetch()
    const before = git(f.root, ['rev-parse', 'HEAD'])
    expect(() => f.sync.pick([common, protectedSha])).toThrow('需要手工适配')
    expect(() => f.sync.pick([before])).toThrow('快照范围')
    expect(() => f.sync.pick([])).toThrow('用法')
    expect(git(f.root, ['rev-parse', 'HEAD'])).toBe(before)
    expect(f.ledger().entries).toEqual({})
  }, 30000)

  it('does not mark a patch already-present when a new file from the patch is missing', () => {
    const f = fixture()
    write(f.upstream, file, 'common\n')
    const sha = f.change('new file\n', other)
    write(f.root, file, 'common\n')
    commit(f.root, 'only one part already ported')
    const row = f.sync.status().rows[0]
    expect(row.trial.already).toBe(false)
    expect(row.paths).toContainEqual({ path: other, status: 'A', kind: 'shared' })
    f.sync.pick([sha])
    expect(readFileSync(join(f.root, other), 'utf8')).toBe('new file\n')
  }, 30000)

  it('records a truly already-present patch without creating an empty commit', () => {
    const f = fixture()
    const sha = f.change('same\n')
    write(f.root, file, 'same\n')
    const before = commit(f.root, 'same local behavior')
    expect(f.sync.status().rows[0].trial.already).toBe(true)
    f.sync.pick([sha])
    expect(git(f.root, ['rev-parse', 'HEAD'])).toBe(before)
    expect(f.ledger().entries[sha].mode).toBe('already-present')
  }, 30000)

  it('inspects both sides of renames and engine deletions', () => {
    const f = fixture()
    const engine = 'src/main/godot/engine.ts'
    f.change('engine\n', engine)
    git(f.upstream, ['mv', engine, other])
    const sha = commit(f.upstream, 'move engine to shared path')
    const row = f.sync.status().rows.find((row) => row.sha === sha)
    expect(row.category).toBe('needs-review')
    expect(row.paths).toEqual(
      expect.arrayContaining([
        { path: engine, status: 'D', kind: 'engine' },
        { path: other, status: 'A', kind: 'shared' }
      ])
    )
  }, 30000)

  it('includes merge-only changes and refuses to pick merge commits automatically', () => {
    const f = fixture()
    git(f.upstream, ['checkout', '-b', 'feature'])
    f.change('feature\n', other)
    git(f.upstream, ['checkout', 'main'])
    f.change('main\n')
    git(f.upstream, ['merge', '--no-ff', '--no-commit', 'feature'])
    const sha = f.change('merge-only resolution\n', 'new/resolution.txt')
    const row = f.sync.status().rows.find((row) => row.sha === sha)
    expect(row.merge).toBe(true)
    expect(row.trial).toBeNull()
    expect(row.paths.some((item) => item.path === 'new/resolution.txt')).toBe(true)
    expect(() => f.sync.pick([sha])).toThrow('需要手工适配')
  }, 30000)

  it('preserves successful predecessors and the conflict, then refuses another operation', () => {
    const f = fixture()
    const first = f.change('independent\n', other)
    const conflict = f.change('upstream edit\n')
    const later = f.change('later\n', 'src/main/ai/later.ts')
    write(f.root, file, 'Godot-specific edit\n')
    commit(f.root, 'Godot divergence')
    f.sync.fetch()
    expect(() => f.sync.pick([later, conflict, first])).toThrow('1 条已记录')
    expect(f.ledger().entries[first].status).toBe('ported')
    expect(f.ledger().entries[conflict]).toBeUndefined()
    expect(git(f.root, ['rev-parse', 'CHERRY_PICK_HEAD'])).toBe(conflict)
    expect(git(f.root, ['ls-files', '-u'])).toContain(file)
    expect(() => f.sync.pick([later])).toThrow('未结束的 Git 操作')
    expect(() => f.sync.mark(conflict, 'ported', 'not done', { local: 'HEAD' })).toThrow(
      '未结束的 Git 操作'
    )
  }, 30000)

  it('retains partial work as pending and validates the local evidence before recording completion', () => {
    const f = fixture()
    const sha = f.change('source\n')
    f.sync.fetch()
    expect(() => f.sync.mark(sha, 'skip', '')).toThrow('非空说明')
    expect(() => f.sync.mark(sha, 'ported', 'done')).toThrow('--local')
    expect(() => f.sync.mark(sha, 'ported', 'done', { local: sha })).toThrow('当前 GDBox 历史')
    f.sync.mark(sha, 'partial', 'some behavior; remainder pending', { local: 'HEAD' })
    expect(f.sync.status({ refresh: false }).rows[0].entry.status).toBe('partial')
    f.sync.mark(sha, 'ported', 'finished; UE-specific part excluded', {
      local: 'HEAD',
      verification: 'focused tests passed'
    })
    expect(f.sync.status({ refresh: false }).rows).toHaveLength(0)
    expect(f.sync.status({ refresh: false, all: true }).rows[0].entry.verification).toBe(
      'focused tests passed'
    )
  }, 30000)

  it('reads legacy ledger keys and prevents duplicate picks, while retaining unrecorded provenance', () => {
    const f = fixture()
    const sha = f.change('source\n')
    f.sync.fetch()
    git(f.root, ['cherry-pick', '-x', sha])
    expect(f.sync.status({ refresh: false }).rows[0].unrecordedPick).toBe(true)
    expect(() => f.sync.pick([sha])).toThrow('已有挑取记录')
    const legacy = f.ledger()
    legacy.entries[sha.slice(0, 8)] = { status: 'todo', note: 'legacy' }
    write(f.root, ledgerPath, JSON.stringify(legacy))
    f.sync.mark(sha, 'ported', 'recorded after review', {
      local: 'HEAD',
      verification: 'tests passed'
    })
    expect(Object.keys(f.ledger().entries)).toEqual([sha.slice(0, 8)])
    expect(f.sync.status({ refresh: false }).rows).toHaveLength(0)
    commit(f.root, 'ledger')
    expect(() => f.sync.pick([sha])).toThrow('已处理')
  }, 30000)

  it('refuses a second writer without removing its lock', () => {
    const f = fixture()
    const sha = f.change('source\n')
    f.sync.fetch()
    write(f.root, '.git/gdbox-upstream.lock', 'another writer')
    expect(() => f.sync.pick([sha])).toThrow('同步正在运行')
    expect(readFileSync(join(f.root, '.git/gdbox-upstream.lock'), 'utf8')).toBe('another writer')
    rmSync(join(f.root, '.git/gdbox-upstream.lock'))
  }, 30000)
})
