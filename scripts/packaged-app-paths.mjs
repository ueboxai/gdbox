import { join } from 'node:path'

/** Keep Windows layout unchanged; macOS binaries live inside the app bundle. */
export function packagedAppPaths(root, platform = process.platform, arch = process.arch) {
  if (platform === 'darwin') {
    const folder = arch === 'x64' ? 'mac' : `mac-${arch}`
    const contents = join(root, 'dist', folder, 'GDBox.app', 'Contents')
    return {
      exe: join(contents, 'MacOS', 'GDBox'),
      asar: join(contents, 'Resources', 'app.asar')
    }
  }
  return {
    exe: join(root, 'dist', 'win-unpacked', 'gdbox.exe'),
    asar: join(root, 'dist', 'win-unpacked', 'resources', 'app.asar')
  }
}
