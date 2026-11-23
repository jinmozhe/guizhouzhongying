import Taro from '@tarojs/taro'

// switchTab does not carry query parameters. Consume this intent only on category entry.
type CategorySelection = { categoryId?: string; keyword?: string }
let pendingCategorySelection: CategorySelection | undefined

export function takePendingCategorySelection() {
  const selection = pendingCategorySelection
  pendingCategorySelection = undefined
  return selection
}

export async function openCategoryTab(selection: CategorySelection) {
  pendingCategorySelection = selection
  try {
    await Taro.switchTab({ url: '/pages/category/index' })
  } catch {
    if (pendingCategorySelection === selection) pendingCategorySelection = undefined
    void Taro.showToast({ title: '切换分类失败，请重试', icon: 'none' })
  }
}
