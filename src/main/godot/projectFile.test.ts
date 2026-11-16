import { describe, expect, it } from 'vitest'
import { parseProjectFile } from './projectFile'

const SAMPLE = `; Engine configuration file.
config_version=5

[application]

config/name="Echo \\"Cave\\""
run/main_scene="uid://b1"
config/features=PackedStringArray("4.7", "Forward Plus")
config/icon="res://icon.svg"

[rendering]

config/name="不是这个"
`

describe('parseProjectFile', () => {
  it('读出名字、版本、图标，只认 [application] 段', () => {
    expect(parseProjectFile(SAMPLE)).toEqual({
      name: 'Echo "Cave"',
      engineVersion: '4.7',
      icon: 'res://icon.svg'
    })
  })

  it('缺字段时留空，不抛错', () => {
    expect(parseProjectFile('config_version=5\n')).toEqual({})
  })
})
