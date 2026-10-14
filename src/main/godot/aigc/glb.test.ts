import { describe, expect, it } from 'vitest'
import { glbInfo, wrapperScene } from './glb'

function makeGlb(json: object): Buffer {
  let text = JSON.stringify(json)
  while (text.length % 4) text += ' '
  const chunk = Buffer.from(text, 'utf8')
  const header = Buffer.alloc(20)
  header.write('glTF', 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(20 + chunk.length, 8)
  header.writeUInt32LE(chunk.length, 12)
  header.write('JSON', 16)
  return Buffer.concat([header, chunk])
}

const glb = makeGlb({
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [
    { children: [1], scale: [2, 2, 2] },
    { mesh: 0, translation: [1, 0, 0] }
  ],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  accessors: [{ count: 8, min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] }, { count: 36 }],
  images: [{}, {}]
})

describe('glbInfo', () => {
  it('按节点变换算出世界空间包围盒、面数、贴图数', () => {
    const info = glbInfo(glb)
    expect(info.min).toEqual([1, -1, -1])
    expect(info.max).toEqual([3, 1, 1])
    expect(info.size).toEqual([2, 2, 2])
    expect(info.triangles).toBe(12)
    expect(info.images).toBe(2)
  })
})

describe('wrapperScene', () => {
  it('缩放到目标高度、脚底落地、水平居中', () => {
    const scene = wrapperScene({
      glbResPath: 'res://m.glb',
      nodeName: 'Crate',
      info: glbInfo(glb),
      targetHeight: 1,
      collision: true
    })
    // 高 2 → 1，缩放 0.5；中心 x=2 → 平移 -1；底 y=-1 → 抬 0.5
    expect(scene).toContain('transform = Transform3D(0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5, -1, 0.5, 0)')
    expect(scene).toContain('size = Vector3(1, 1, 1)')
    expect(scene).toContain('[node name="Crate" type="Node3D"]')
  })
})
