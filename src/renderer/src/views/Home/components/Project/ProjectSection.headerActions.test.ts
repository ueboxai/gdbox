import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/views/Home/components/Project/ProjectSection.vue'),
  'utf8'
)

describe('ProjectSection header actions', () => {
  // GDBox 没有模板市场：表头只留导入和刷新，不再有「从模板新建」入口
  it('has no template-market action in the header', () => {
    expect(source).not.toContain('createFromTemplate')
    expect(source).not.toContain('PhStorefront')
  })

  it('uses a plus icon for importing an existing project', () => {
    expect(source).toMatch(
      /id="project-import-entry"[\s\S]*?:title="t\('page\.home\.project\.importExisting'\)"[\s\S]*?<PhPlus\s*\/>/
    )
  })
})
