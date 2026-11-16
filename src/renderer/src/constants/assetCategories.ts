import {
  PhCode,
  PhFileImage,
  PhHeadphones,
  PhPaintBrush,
  PhPackage,
  PhSquaresFour,
  PhTextAa,
  PhTreeStructure,
  PhVideoCamera
} from '@phosphor-icons/vue'

/**
 * 资产的格式分类（按 Godot 项目里常见的文件类型分组）。
 *
 * **这里没有 label。** 两个消费者（`AssetFilterBar.vue`、`AssetManagement/index.vue`）
 * 都不用它 —— 前者按 key 拼 `assetLib.filter.format*` 去查语言包，后者只读 extensions。
 * 新增分类时，两份语言包要同时补上对应的 `format*` key。
 */
export const ASSET_CATEGORIES = [
  {
    key: 'image',
    icon: PhFileImage,
    extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'bmp', 'tga', 'gif', 'psd', 'exr', 'hdr']
  },
  {
    key: 'audio',
    icon: PhHeadphones,
    extensions: ['wav', 'ogg', 'mp3', 'flac']
  },
  {
    key: 'model',
    icon: PhSquaresFour,
    extensions: ['glb', 'gltf', 'fbx', 'obj', 'blend', 'dae']
  },
  {
    key: 'scene',
    icon: PhTreeStructure,
    extensions: ['tscn', 'scn']
  },
  {
    key: 'resource',
    icon: PhPackage,
    extensions: ['tres', 'res']
  },
  {
    key: 'script',
    icon: PhCode,
    extensions: ['gd', 'cs']
  },
  {
    key: 'shader',
    icon: PhPaintBrush,
    extensions: ['gdshader', 'gdshaderinc']
  },
  {
    key: 'font',
    icon: PhTextAa,
    extensions: ['ttf', 'otf', 'woff', 'woff2', 'fnt']
  },
  {
    key: 'video',
    icon: PhVideoCamera,
    extensions: ['ogv', 'mp4', 'webm', 'mov', 'avi', 'mkv']
  }
]
