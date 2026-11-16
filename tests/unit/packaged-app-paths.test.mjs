// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { packagedAppPaths } from '../../scripts/packaged-app-paths.mjs'
import { unexpectedPackagedFiles } from '../../scripts/check-packaged-content.mjs'

describe('packaged application layout', () => {
  it('retains the Windows executable and resource paths', () => {
    expect(packagedAppPaths('/project', 'win32', 'x64')).toEqual({
      exe: join('/project', 'dist/win-unpacked/gdbox.exe'),
      asar: join('/project', 'dist/win-unpacked/resources/app.asar')
    })
  })
  it.each([
    ['x64', 'mac'],
    ['arm64', 'mac-arm64']
  ])('finds the %s Mac bundle', (arch, directory) => {
    const paths = packagedAppPaths('/project', 'darwin', arch)
    expect(paths.exe).toBe(
      join('/project', 'dist', directory, 'GODOT BOX.app/Contents/MacOS/GODOT BOX')
    )
    expect(paths.asar).toBe(
      join('/project', 'dist', directory, 'GODOT BOX.app/Contents/Resources/app.asar')
    )
  })
  it('rejects archives under resources/ — the Godot addon ships via extraResources, not app.asar', () => {
    const entries = [
      'resources/plugins/UnrealAgentLink55.zip',
      'resources/godot/addons/gdbox_link.zip',
      'resources/plugins/unrelated.zip'
    ]
    expect(unexpectedPackagedFiles(entries)).toEqual(entries)
  })
})
