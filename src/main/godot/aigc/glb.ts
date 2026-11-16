/**
 * 不开引擎读 glb 的基本信息：包围盒、面数、贴图。
 * 用来把 AI 生成的模型规整成统一大小、脚底落地、水平居中（实验里每个人都手写过这个）。
 */

type Mat4 = number[] // 列主序，16 个数

interface GltfNode {
  children?: number[]
  mesh?: number
  matrix?: number[]
  translation?: number[]
  rotation?: number[]
  scale?: number[]
}

interface Gltf {
  scene?: number
  scenes?: { nodes?: number[] }[]
  nodes?: GltfNode[]
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number }[] }[]
  accessors?: { count: number; min?: number[]; max?: number[] }[]
  images?: unknown[]
}

export interface GlbInfo {
  min: [number, number, number]
  max: [number, number, number]
  size: [number, number, number]
  triangles: number
  images: number
}

export function readGlbJson(glb: Buffer): Gltf {
  if (glb.toString('ascii', 0, 4) !== 'glTF') throw new Error('Not a .glb file.')
  const length = glb.readUInt32LE(12)
  const type = glb.toString('ascii', 16, 20)
  if (type !== 'JSON') throw new Error('Malformed .glb: first chunk is not JSON.')
  return JSON.parse(glb.toString('utf8', 20, 20 + length)) as Gltf
}

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return out
}

function localMatrix(node: GltfNode): Mat4 {
  if (node.matrix) return node.matrix
  const [tx, ty, tz] = node.translation ?? [0, 0, 0]
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1]
  const [sx, sy, sz] = node.scale ?? [1, 1, 1]
  const xx = qx * qx,
    yy = qy * qy,
    zz = qz * qz
  const xy = qx * qy,
    xz = qx * qz,
    yz = qy * qz
  const wx = qw * qx,
    wy = qw * qy,
    wz = qw * qz
  return [
    (1 - 2 * (yy + zz)) * sx,
    2 * (xy + wz) * sx,
    2 * (xz - wy) * sx,
    0,
    2 * (xy - wz) * sy,
    (1 - 2 * (xx + zz)) * sy,
    2 * (yz + wx) * sy,
    0,
    2 * (xz + wy) * sz,
    2 * (yz - wx) * sz,
    (1 - 2 * (xx + yy)) * sz,
    0,
    tx,
    ty,
    tz,
    1
  ]
}

function transformPoint(m: Mat4, p: number[]): number[] {
  return [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r])
}

export function glbInfo(glb: Buffer): GlbInfo {
  const gltf = readGlbJson(glb)
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  let triangles = 0

  const visit = (index: number, parent: Mat4): void => {
    const node = gltf.nodes?.[index]
    if (!node) return
    const world = multiply(parent, localMatrix(node))
    if (node.mesh !== undefined) {
      for (const prim of gltf.meshes?.[node.mesh]?.primitives ?? []) {
        const pos = gltf.accessors?.[prim.attributes.POSITION]
        if (pos?.min && pos.max) {
          for (const x of [pos.min[0], pos.max[0]])
            for (const y of [pos.min[1], pos.max[1]])
              for (const z of [pos.min[2], pos.max[2]]) {
                const p = transformPoint(world, [x, y, z])
                for (let i = 0; i < 3; i++) {
                  min[i] = Math.min(min[i], p[i])
                  max[i] = Math.max(max[i], p[i])
                }
              }
        }
        const count =
          prim.indices !== undefined ? gltf.accessors?.[prim.indices]?.count : pos?.count
        triangles += Math.floor((count ?? 0) / 3)
      }
    }
    for (const child of node.children ?? []) visit(child, world)
  }
  const roots = gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? (gltf.nodes ?? []).map((_, i) => i)
  for (const r of roots) visit(r, IDENTITY)
  if (!Number.isFinite(min[0])) throw new Error('The model has no mesh with position bounds.')
  const size = [0, 1, 2].map((i) => max[i] - min[i]) as [number, number, number]
  return {
    min: min as GlbInfo['min'],
    max: max as GlbInfo['max'],
    size,
    triangles,
    images: gltf.images?.length ?? 0
  }
}

const f = (n: number): string => (Math.abs(n) < 1e-6 ? '0' : Number(n.toFixed(5)).toString())

/**
 * 包一层场景：模型按目标高度等比缩放、脚底落在 y=0、水平居中，可选绕 Y 轴转向、加一个盒子碰撞体。
 * 不改 glb 本身，换模型或调参数只改这个小场景。
 */
export function wrapperScene(options: {
  glbResPath: string
  nodeName: string
  info: GlbInfo
  targetHeight: number
  rotateYDegrees?: number
  collision?: boolean
}): string {
  const { info, targetHeight } = options
  const s = targetHeight / Math.max(info.size[1], 1e-6)
  const cx = (info.min[0] + info.max[0]) / 2
  const cz = (info.min[2] + info.max[2]) / 2
  const rad = ((options.rotateYDegrees ?? 0) * Math.PI) / 180
  const c = Math.cos(rad)
  const sn = Math.sin(rad)
  // 先平移到原点（居中、落地），再缩放，再绕 Y 转
  const tx0 = -cx * s
  const ty0 = -info.min[1] * s
  const tz0 = -cz * s
  const tx = c * tx0 + sn * tz0
  const tz = -sn * tx0 + c * tz0
  const basis = [c * s, 0, -sn * s, 0, s, 0, sn * s, 0, c * s]
  const lines = [
    `[gd_scene format=3]`,
    '',
    `[ext_resource type="PackedScene" path="${options.glbResPath}" id="1_model"]`,
    ''
  ]
  if (options.collision) {
    lines.push(`[sub_resource type="BoxShape3D" id="box"]`)
    const w = info.size[0] * s
    const d = info.size[2] * s
    const rw = Math.abs(c) * w + Math.abs(sn) * d
    const rd = Math.abs(sn) * w + Math.abs(c) * d
    lines.push(`size = Vector3(${f(rw)}, ${f(targetHeight)}, ${f(rd)})`, '')
  }
  lines.push(`[node name="${options.nodeName}" type="Node3D"]`, '')
  lines.push(`[node name="Model" parent="." instance=ExtResource("1_model")]`)
  lines.push(
    `transform = Transform3D(${basis.map(f).join(', ')}, ${f(tx)}, ${f(ty0)}, ${f(tz)})`,
    ''
  )
  if (options.collision) {
    lines.push(`[node name="Body" type="StaticBody3D" parent="."]`, '')
    lines.push(`[node name="Shape" type="CollisionShape3D" parent="Body"]`)
    lines.push(`transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, ${f(targetHeight / 2)}, 0)`)
    lines.push(`shape = SubResource("box")`, '')
  }
  return lines.join('\n')
}
