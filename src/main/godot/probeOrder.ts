const CONSOLE_BUILD = /_console\.exe$/i

/**
 * 先试哪几个文件。
 *
 * Windows 的 Godot 压缩包里有两个 exe，带 `_console` 的那个启动时多开一个黑色命令行窗口。
 * 两个都能用，但新手分不清，常常选中它；同目录下有正常版时就换成正常版。
 * 选的是文件夹时，正常版排在前面。
 */
export function godotProbeOrder(input: string, isDir: boolean, dirExes: string[]): string[] {
  if (isDir) {
    return [
      ...dirExes.filter((p) => !CONSOLE_BUILD.test(p)),
      ...dirExes.filter((p) => CONSOLE_BUILD.test(p))
    ]
  }
  if (!CONSOLE_BUILD.test(input)) return [input]
  return [input.replace(CONSOLE_BUILD, '.exe'), input]
}
