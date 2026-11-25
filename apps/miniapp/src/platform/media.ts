import Taro from '@tarojs/taro'

const PREVIEW_OPEN_WINDOW_MS = 3000

let previewRequestedAt: number | null = null
let previewActive = false

/** 标记即将通过原生 previewImage 暂时离开当前页，防止关闭预览返回时误触发全局重拉。 */
function beginImagePreview(): void {
  previewRequestedAt = Date.now()
  previewActive = false
}

function resetImagePreview(): void {
  previewRequestedAt = null
  previewActive = false
}

/** 若本次 App.onHide 由原生图片预览触发，则转入预览态并返回 true 以跳过全局失焦处理。 */
export function consumePreviewAppHide(): boolean {
  if (previewRequestedAt !== null && Date.now() - previewRequestedAt <= PREVIEW_OPEN_WINDOW_MS) {
    previewRequestedAt = null
    previewActive = true
    return true
  }
  previewRequestedAt = null
  return false
}

/** 若本次 App.onShow 由关闭原生图片预览返回触发，则清理标记并返回 true 以跳过全局聚焦重拉。 */
export function consumePreviewAppShow(): boolean {
  const fromPreview =
    previewActive || (previewRequestedAt !== null && Date.now() - previewRequestedAt <= PREVIEW_OPEN_WINDOW_MS)
  resetImagePreview()
  return fromPreview
}

export function assetUrl(value: string): string {
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return `${__ASSET_BASE_URL__}${value}`
  const match = /^(https?:\/\/[^/?#]+)(\/[^#]*)?$/.exec(value)
  if (match && match[1] === __ASSET_BASE_URL__) return value
  throw new Error('图片地址未通过资源源站校验')
}

export async function previewImages(urls: string[], current: string): Promise<void> {
  let resolvedUrls: string[]
  let resolvedCurrent: string
  try {
    resolvedUrls = urls.map(assetUrl)
    resolvedCurrent = assetUrl(current)
  } catch {
    await Taro.showToast({ title: '图片预览失败，请重试', icon: 'none' })
    return
  }
  beginImagePreview()
  try {
    await Taro.previewImage({ urls: resolvedUrls, current: resolvedCurrent })
  } catch {
    resetImagePreview()
    await Taro.showToast({ title: '图片预览失败，请重试', icon: 'none' })
  }
}
