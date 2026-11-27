import Taro from '@tarojs/taro'
import type { CheckoutLine, CheckoutRequest, ResponseModelOperationIntentRead, ResponseModelConsumerUserRead } from '@pinjie/api-client'
import { privateRequest, sessionScope } from '@/lib/session'

// 内存结算会话：仅在当前结算页面生命周期内有效，不写入本地持久化缓存
export type CheckoutSession = {
  userId: string
  productType: 'physical' | 'virtual'
  request: CheckoutRequest
  previews?: Record<string, string>
  cartItemIds?: string[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let currentSession: CheckoutSession | null = null

function legacyDraftKey(userId: string) {
  return `guizhouzhongying.checkout.${userId}`
}

function sanitizePreviews(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const result: Record<string, string> = {}
  for (const [skuId, url] of Object.entries(raw)) {
    if (UUID.test(skuId) && typeof url === 'string' && url.trim()) result[skuId] = url
  }
  return Object.keys(result).length ? result : undefined
}

function sanitizeCartItemIds(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const unique = Array.from(new Set(raw.filter((id): id is string => typeof id === 'string' && UUID.test(id))))
  return unique.length ? unique : undefined
}

// 清理历史版本遗留的本地结算草稿缓存，避免旧记录残留
export function clearLegacyDraft(userId: string) {
  if (!userId) return
  try {
    Taro.removeStorageSync(legacyDraftKey(userId))
  } catch {
    // 忽略旧缓存清理异常，不阻断正常结算流程
  }
}

export function loadCheckoutSession(userId: string): CheckoutSession | null {
  if (!currentSession || currentSession.userId !== userId) return null
  return currentSession
}

export function saveCheckoutSession(session: CheckoutSession) {
  currentSession = session
}

export function clearCheckoutSession(userId?: string) {
  if (!userId || currentSession?.userId === userId) currentSession = null
}

export async function requestCheckoutIntent(): Promise<string> {
  const intent = await privateRequest<ResponseModelOperationIntentRead>('/checkout/intent')
  return intent.request_id
}

export async function startCheckout(
  items: CheckoutLine[],
  productType: 'physical' | 'virtual',
  options?: { previews?: Record<string, string>; cartItemIds?: string[] },
) {
  if (!items.length || items.length > 50) throw new Error('请选择 1 至 50 种商品')
  const epoch = sessionScope()
  // 从认证服务端读取当前用户，禁止信任客户端传入身份
  const me = await privateRequest<ResponseModelConsumerUserRead>('/users/me')
  clearLegacyDraft(me.id)
  const requestId = await requestCheckoutIntent()
  if (epoch !== sessionScope()) throw new Error('登录状态已改变，请重新选择商品')
  saveCheckoutSession({
    userId: me.id,
    productType,
    request: { request_id: requestId, items },
    previews: sanitizePreviews(options?.previews),
    cartItemIds: sanitizeCartItemIds(options?.cartItemIds),
  })
  await Taro.navigateTo({ url: '/subpackages/trade/checkout/index' })
}
