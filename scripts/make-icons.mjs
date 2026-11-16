#!/usr/bin/env node
/**
 * 从 build/icon.svg、build/icon-dark.svg 生成全部位图图标：
 *
 * - build/icon.png、build/icon-dark.png（1024，安装包和 macOS 用）
 * - build/icon.ico、build/icon-dark.ico（多尺寸，ICO 里直接存 PNG）
 * - resources/icon.png、resources/icon.ico、resources/icon-dark.ico（运行时窗口和托盘用）
 *
 * 不走 electron-builder 的图标转换：它在某些机器上会因为用户目录里的 package.json 出错。
 * 改了 SVG 之后跑一次：node scripts/make-icons.mjs
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const ICO_SIZES = [256, 128, 64, 48, 32, 24, 16]

async function toIco(png) {
  const pngs = await Promise.all(
    ICO_SIZES.map((size) => sharp(png).resize(size, size).png().toBuffer())
  )
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(ICO_SIZES.length, 4)
  const entries = []
  let offset = 6 + 16 * ICO_SIZES.length
  ICO_SIZES.forEach((size, i) => {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(pngs[i].length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += pngs[i].length
    entries.push(entry)
  })
  return Buffer.concat([header, ...entries, ...pngs])
}

for (const name of ['icon', 'icon-dark']) {
  const png = await sharp(readFileSync(`build/${name}.svg`), { density: 288 })
    .resize(1024, 1024)
    .png()
    .toBuffer()
  writeFileSync(`build/${name}.png`, png)
  writeFileSync(`build/${name}.ico`, await toIco(png))
  console.log(`build/${name}.png, build/${name}.ico`)
}
copyFileSync('build/icon.png', 'resources/icon.png')
copyFileSync('build/icon.ico', 'resources/icon.ico')
copyFileSync('build/icon-dark.ico', 'resources/icon-dark.ico')
console.log('resources/icon.png, resources/icon.ico, resources/icon-dark.ico')
