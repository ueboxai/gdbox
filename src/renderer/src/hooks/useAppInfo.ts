import { ref, computed } from 'vue'
import packageJson from '../../../../package.json'

/**
 * 获取应用信息的hook
 * @returns 应用信息对象
 */
export function useAppInfo() {
  // 从package.json获取应用信息
  const appName = ref(packageJson.name)
  const appVersion = ref(packageJson.version)
  const appDescription = ref(packageJson.description)
  const appAuthor = ref(packageJson.author)
  const appHomepage = ref(packageJson.homepage)

  // 对外显示的应用名（GODOT BOX）；name 是内部包名 gdbox
  const formattedAppName = computed(() => packageJson.productName)

  // 完整的应用标题
  const appTitle = computed(() => {
    return `${formattedAppName.value} v${appVersion.value}`
  })

  // 应用信息对象
  const appInfo = computed(() => ({
    name: appName.value,
    version: appVersion.value,
    description: appDescription.value,
    author: appAuthor.value,
    homepage: appHomepage.value,
    formattedName: formattedAppName.value,
    title: appTitle.value
  }))

  return {
    // 基础信息
    appName: appName.value,
    appVersion: appVersion.value,
    appDescription: appDescription.value,
    appAuthor: appAuthor.value,
    appHomepage: appHomepage.value,

    // 计算属性
    formattedAppName: formattedAppName.value,
    appTitle: appTitle.value,
    appInfo: appInfo.value
  }
}
