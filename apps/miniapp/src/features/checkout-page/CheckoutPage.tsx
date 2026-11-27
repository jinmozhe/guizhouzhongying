import { modalColors } from '@/styles/colors'
import { useCallback, useEffect, useRef, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Button as NativeButton, Image, Input, Text, View } from '@tarojs/components'
import { useMutation } from '@tanstack/react-query'
import type { CheckoutQuote, ResponseModelCheckoutQuote, ResponseModelNoneType, ResponseModelOrderRead } from '@pinjie/api-client'
import { AuthGate } from '@/components/AuthGate'
import { Icon } from '@/components/Icon'
import { QueryState } from '@/components/QueryState'
import { ApiError } from '@/lib/api'
import { privateRequest, sessionScope, useSession } from '@/lib/session'
import { queryClient } from '@/lib/query'
import { assetUrl } from '@/platform/media'
import {
  clearCheckoutSession,
  clearLegacyDraft,
  loadCheckoutSession,
  requestCheckoutIntent,
  saveCheckoutSession,
} from '@/features/checkout'
import type { CheckoutSession } from '@/features/checkout'
import './checkout.scss'

function formatInteger(value: string | number): string {
  const raw = String(value).trim()
  if (!/^\d+$/.test(raw)) return raw
  return raw.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function splitMoney(amount: string): { integer: string; decimal: string } {
  const [integer = '0', fraction = '00'] = amount.split('.')
  return { integer, decimal: `.${fraction.padEnd(2, '0').slice(0, 2)}` }
}

// 复用小程序原生标准弹窗展示提交或核算提示，避免顶部卡片挤压页面布局
function showNoticeModal(title: string, content: string) {
  void Taro.showModal({
    ...modalColors,
    title,
    content,
    showCancel: false,
    confirmText: '我知道了',
  }).catch(() => undefined)
}

function showErrorModal(title: string, error: unknown, fallback = '订单提交未完成，请稍后重试') {
  const message = error instanceof Error && error.message.trim() ? error.message.trim() : fallback
  const content = error instanceof ApiError && error.requestId
    ? `${message}\n追踪编号：${error.requestId}`
    : message
  showNoticeModal(title, content)
}

// 判定是否为服务端明确拒绝（未建单，无需静默查单）
function isDefinitiveRejection(error: unknown): error is ApiError {
  if (!(error instanceof ApiError)) return false
  if ([400, 403, 404, 409, 422].includes(error.status)) return true
  return error.status === 503 && error.code === 'SERVICE_UNAVAILABLE'
}

function CheckoutThumb({ name, url }: { name: string; url?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [url])
  let source = ''
  if (url && !failed) {
    try { source = assetUrl(url) } catch { source = '' }
  }
  const initial = Array.from(name.trim())[0] ?? '商'
  return <View className='checkout-thumb'>
    {source
      ? <Image className='checkout-thumb-image' src={source} mode='aspectFill' lazyLoad webp onError={() => setFailed(true)} />
      : <Text className='checkout-thumb-char'>{initial}</Text>}
  </View>
}

function Content() {
  const session = useSession()
  const userId = session.user?.id ?? ''
  const [checkoutSession, setCheckoutSession] = useState<CheckoutSession | null>(null)
  const [quote, setQuote] = useState<CheckoutQuote | null>(null)
  const [pointsMeta, setPointsMeta] = useState<{ available: string; maximum: number } | null>(null)
  const [autoFilledMax, setAutoFilledMax] = useState(false)
  const [pointsHint, setPointsHint] = useState('')
  const [finished, setFinished] = useState(false)
  const [pointsText, setPointsText] = useState('0')
  const submitLock = useRef(false)
  const quoteSeq = useRef(0)
  const autoQuotedId = useRef('')
  // 记录已发过下单请求的幂等键与内容是否变化，保证重试复用原键、修改积分后换新键
  const attemptedRequestId = useRef('')
  const needFreshIntent = useRef(false)
  const debounceTimer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null)

  const clearDebounce = useCallback(() => {
    if (debounceTimer.current !== null) {
      globalThis.clearTimeout(debounceTimer.current)
      debounceTimer.current = null
    }
  }, [])

  const preview = useMutation({ mutationFn: async ({ targetSession, autoMax }: { targetSession: CheckoutSession; autoMax: boolean }) => {
    const seq = ++quoteSeq.current
    const initialRequest = { ...targetSession.request, address_id: null, points_to_use: targetSession.request.points_to_use ?? 0 }
    let result = await privateRequest<ResponseModelCheckoutQuote>('/checkout/preview', { method: 'POST', data: initialRequest })
    if (session.epoch !== sessionScope() || seq !== quoteSeq.current) return
    let didAutoMax = false
    if (autoMax && result.maximum_points > 0 && initialRequest.points_to_use !== result.maximum_points) {
      didAutoMax = true
      const maxRequest = { ...initialRequest, points_to_use: result.maximum_points, quote_fingerprint: null }
      result = await privateRequest<ResponseModelCheckoutQuote>('/checkout/preview', { method: 'POST', data: maxRequest })
      if (session.epoch !== sessionScope() || seq !== quoteSeq.current) return
    }
    setQuote(result)
    setPointsMeta({ available: result.available_points, maximum: result.maximum_points })
    setAutoFilledMax(didAutoMax)
    setPointsText(String(result.points_deduction))
    const next: CheckoutSession = {
      ...targetSession,
      request: { ...initialRequest, points_to_use: result.points_deduction, quote_fingerprint: result.fingerprint },
    }
    saveCheckoutSession(next)
    setCheckoutSession(next)
  } })
  const previewMutate = preview.mutate

  const scheduleQuote = useCallback((nextSession: CheckoutSession, immediate: boolean) => {
    clearDebounce()
    if (immediate) {
      previewMutate({ targetSession: nextSession, autoMax: false })
      return
    }
    debounceTimer.current = globalThis.setTimeout(() => {
      debounceTimer.current = null
      previewMutate({ targetSession: nextSession, autoMax: false })
    }, 350)
  }, [clearDebounce, previewMutate])

  const restoreSession = useCallback(() => {
    if (userId) clearLegacyDraft(userId)
    const stored = loadCheckoutSession(userId)
    const restored = stored && stored.request.address_id
      ? { ...stored, request: { ...stored.request, address_id: null, quote_fingerprint: null } }
      : stored
    if (restored && restored !== stored) saveCheckoutSession(restored)
    setCheckoutSession(restored)
    setPointsText(String(restored?.request.points_to_use ?? 0))
    if (!restored) {
      autoQuotedId.current = ''
      attemptedRequestId.current = ''
      needFreshIntent.current = false
      setQuote(null)
      setPointsMeta(null)
      setAutoFilledMax(false)
      setPointsHint('')
      return
    }
    if (autoQuotedId.current !== restored.request.request_id) {
      autoQuotedId.current = restored.request.request_id
      attemptedRequestId.current = ''
      needFreshIntent.current = false
      setQuote(null)
      setPointsMeta(null)
      setAutoFilledMax(false)
      setPointsHint('')
      previewMutate({ targetSession: restored, autoMax: restored.request.points_to_use == null })
    }
  }, [previewMutate, userId])

  useEffect(() => {
    restoreSession()
  }, [restoreSession])

  useDidShow(() => {
    restoreSession()
  })

  useEffect(() => () => {
    clearDebounce()
    if (userId) clearCheckoutSession(userId)
  }, [clearDebounce, userId])

  async function complete(orderId: string, cartItemIds?: string[]) {
    if (session.epoch !== sessionScope()) return
    clearDebounce()
    if (cartItemIds?.length) {
      for (const cartItemId of cartItemIds) {
        if (session.epoch !== sessionScope()) return
        try {
          await privateRequest<ResponseModelNoneType>(`/cart-items/${cartItemId}`, { method: 'DELETE' })
        } catch {
          // 订单已在服务端确认创建，单个已清除或瞬时失败的购物车条目不阻断进入订单详情。
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['private', 'cart'] })
    }
    if (session.epoch !== sessionScope()) return
    clearCheckoutSession(userId)
    setFinished(true)
    await queryClient.invalidateQueries({ queryKey: ['private', 'orders'] })
    if (session.epoch !== sessionScope()) return
    await Taro.redirectTo({ url: `/subpackages/trade/order-detail/index?id=${orderId}` })
  }

  const submit = useMutation({ mutationFn: async () => {
    if (submitLock.current) return
    submitLock.current = true
    try {
      if (!checkoutSession || !quote || !checkoutSession.request.quote_fingerprint) {
        throw new Error('正在核算应付金额，请稍候再提交')
      }
      let activeSession = checkoutSession
      // 仅当之前已用原请求号发过下单请求，且用户随后改过积分或发生冲突时，才申请新的幂等号
      if (needFreshIntent.current) {
        const freshRequestId = await requestCheckoutIntent()
        if (session.epoch !== sessionScope()) return
        activeSession = {
          ...checkoutSession,
          request: { ...checkoutSession.request, request_id: freshRequestId },
        }
        autoQuotedId.current = freshRequestId
        saveCheckoutSession(activeSession)
        setCheckoutSession(activeSession)
        needFreshIntent.current = false
      }
      const activeRequest = activeSession.request
      attemptedRequestId.current = activeRequest.request_id
      try {
        const order = await privateRequest<ResponseModelOrderRead>('/orders', { method: 'POST', data: activeRequest })
        await complete(order.id, activeSession.cartItemIds)
      } catch (error) {
        if (session.epoch !== sessionScope()) throw error
        // 分支 1：服务端明确拒绝（事务未落库）
        if (isDefinitiveRejection(error)) {
          if (error.code === 'CHECKOUT_STALE_QUOTE') {
            const refreshed: CheckoutSession = {
              ...activeSession,
              request: { ...activeRequest, points_to_use: undefined, quote_fingerprint: null },
            }
            needFreshIntent.current = true
            saveCheckoutSession(refreshed)
            setCheckoutSession(refreshed)
            setQuote(null)
            previewMutate({ targetSession: refreshed, autoMax: true })
            showNoticeModal('金额或积分已更新', '商品价格或可用积分有变动，已为您自动刷新最新金额，请核对后重新提交。')
            return
          }
          if (error.code === 'ORDER_REQUEST_CONFLICT') {
            needFreshIntent.current = true
          }
          throw error
        }
        // 分支 2：网络超时、断网或未知 5xx，解锁前自动静默核对一次原请求是否已建单
        try {
          const existingOrder = await privateRequest<ResponseModelOrderRead>(
            `/orders/by-request/${activeRequest.request_id}`,
            { timeoutMs: 5_000 },
          )
          await complete(existingOrder.id, activeSession.cartItemIds)
          return
        } catch (lookupError) {
          if (session.epoch !== sessionScope()) throw lookupError
          if (lookupError instanceof ApiError && lookupError.status === 404) {
            throw error instanceof Error ? error : new Error('网络异常，订单未创建成功，请重试')
          }
          throw new Error('网络异常，暂无法确认下单结果。请稍后重试，或前往「我的订单」查看是否已下单')
        }
      }
    } finally {
      submitLock.current = false
    }
  }, onError: (error) => {
    showErrorModal('订单提交未完成', error)
  } })

  function markPointsChanged() {
    if (attemptedRequestId.current) needFreshIntent.current = true
    if (submit.isError) submit.reset()
  }

  function changePoints(value: string) {
    clearDebounce()
    quoteSeq.current += 1
    setAutoFilledMax(false)
    setPointsHint('')
    if (!checkoutSession || submit.isPending || finished) return
    markPointsChanged()
    setQuote(null)
    if (value === '') {
      setPointsText('')
      setPointsHint('留空将按 0 积分计算')
      return
    }
    if (!/^\d{1,13}$/.test(value)) {
      setPointsText(value)
      setPointsHint(`请输入 0 至 ${pointsMeta?.maximum ?? 0} 的整数积分`)
      return
    }
    let parsed = Number(value)
    if (pointsMeta && parsed > pointsMeta.maximum) {
      parsed = pointsMeta.maximum
      setPointsHint(`本单最多可使用 ${formatInteger(pointsMeta.maximum)} 积分，已自动调整`)
    }
    const normalized = String(parsed)
    setPointsText(normalized)
    const next: CheckoutSession = {
      ...checkoutSession,
      request: { ...checkoutSession.request, points_to_use: parsed, address_id: null, quote_fingerprint: null },
    }
    saveCheckoutSession(next)
    setCheckoutSession(next)
    scheduleQuote(next, false)
  }

  function commitPointsOnBlur() {
    if (!checkoutSession || submit.isPending || finished) return
    if (pointsText.trim() === '') {
      markPointsChanged()
      setPointsText('0')
      setPointsHint('')
      const next: CheckoutSession = {
        ...checkoutSession,
        request: { ...checkoutSession.request, points_to_use: 0, address_id: null, quote_fingerprint: null },
      }
      saveCheckoutSession(next)
      setCheckoutSession(next)
      setQuote(null)
      scheduleQuote(next, true)
      return
    }
    if (debounceTimer.current !== null && /^\d{1,13}$/.test(pointsText)) {
      scheduleQuote(checkoutSession, true)
    }
  }

  function applyPoints(points: number) {
    if (!checkoutSession || preview.isPending || submit.isPending || finished) return
    clearDebounce()
    quoteSeq.current += 1
    markPointsChanged()
    setAutoFilledMax(false)
    setPointsHint('')
    setPointsText(String(points))
    const next: CheckoutSession = {
      ...checkoutSession,
      request: { ...checkoutSession.request, points_to_use: points, address_id: null, quote_fingerprint: null },
    }
    saveCheckoutSession(next)
    setCheckoutSession(next)
    setQuote(null)
    preview.mutate({ targetSession: next, autoMax: false })
  }

  const busy = preview.isPending || submit.isPending || finished
  if (!checkoutSession) return <View className='checkout-page'><QueryState title='暂无结算商品' detail='请从商品详情或购物车进入结算' /></View>

  const canUsePoints = !!pointsMeta && pointsMeta.maximum > 0
  const usingMaxPoints = canUsePoints && /^\d+$/.test(pointsText) && Number(pointsText) === pointsMeta.maximum
  const totalKinds = quote ? quote.items.length : checkoutSession.request.items.length
  const totalPieces = quote
    ? quote.items.reduce((sum, line) => sum + line.quantity, 0)
    : checkoutSession.request.items.reduce((sum, line) => sum + line.quantity, 0)
  const payableParts = quote ? splitMoney(quote.total_amount) : null
  const submitDisabled = busy || !quote

  const pointsStatusText = preview.isPending
    ? '核算中…'
    : usingMaxPoints
      ? (autoFilledMax ? '已自动用满' : '已用满上限')
      : quote && quote.points_deduction > 0
        ? `已抵扣 ${formatInteger(quote.points_deduction)} 积分`
        : '暂不使用'

  return <View className='checkout-page'>
    {preview.error && !quote && <QueryState
      title='金额核算失败'
      error={preview.error}
      retry={() => {
        const refreshed: CheckoutSession = {
          ...checkoutSession,
          request: { ...checkoutSession.request, points_to_use: undefined, quote_fingerprint: null },
        }
        saveCheckoutSession(refreshed)
        setCheckoutSession(refreshed)
        preview.mutate({ targetSession: refreshed, autoMax: true })
      }}
    />}
    <View className='checkout-card'>
      <View className='checkout-card-head'>
        <View className='checkout-card-title-group'>
          <Text className='checkout-card-title'>结算商品</Text>
          <Text className='checkout-badge checkout-badge--info'>到店消费</Text>
        </View>
        <Text className='checkout-card-count'>共 {totalKinds} 种 {totalPieces} 件</Text>
      </View>
      {quote ? quote.items.map((line) => {
        const specText = Object.values(line.specifications).join(' · ') || '默认规格'
        const lineMaxPoints = line.max_points_deduction ?? 0
        return <View className='checkout-item' key={line.sku_id}>
          <CheckoutThumb name={line.product_name} url={checkoutSession.previews?.[line.sku_id]} />
          <View className='checkout-item-body'>
            <View className='checkout-item-name'>{line.product_name}</View>
            <View className='checkout-item-tags'>
              <Text className='checkout-badge checkout-badge--spec'>{specText}</Text>
              {lineMaxPoints > 0 && <Text className='checkout-badge checkout-badge--reward'>可抵 {formatInteger(lineMaxPoints)} 积分</Text>}
            </View>
            <View className='checkout-item-bottom'>
              <View className='checkout-item-price'>
                <Text className='checkout-item-price-symbol'>¥</Text>
                <Text className='checkout-item-price-value'>{line.unit_price}</Text>
              </View>
              <Text className='checkout-item-qty'>× {line.quantity}</Text>
            </View>
          </View>
        </View>
      }) : <View className='checkout-points-empty'>
        {preview.isPending ? '正在自动计算商品价格与最大可抵扣积分…' : `已选 ${totalKinds} 种商品，共 ${totalPieces} 件。`}
      </View>}
    </View>

    <View className='checkout-card'>
      <View className='checkout-card-head'>
        <Text className='checkout-card-title'>积分抵扣</Text>
        <Text className='checkout-badge checkout-badge--reward'>1 积分抵 1 元</Text>
      </View>
      {canUsePoints ? <>
        <View className='checkout-points-controls'>
          <View className='checkout-points-box'>
            <Input
              className='checkout-points-field'
              placeholderClass='input-placeholder'
              type='number'
              value={pointsText}
              maxlength={13}
              disabled={submit.isPending || finished}
              placeholder='0'
              onInput={(event) => changePoints(event.detail.value)}
              onBlur={commitPointsOnBlur}
            />
            <Text className='checkout-points-unit'>积分</Text>
          </View>
          <NativeButton
            className={`checkout-points-toggle ${!usingMaxPoints ? 'checkout-points-toggle--fill' : ''} ${busy ? 'checkout-points-toggle--disabled' : ''}`}
            disabled={busy}
            onClick={() => applyPoints(usingMaxPoints ? 0 : pointsMeta.maximum)}
          >
            {usingMaxPoints ? '不使用积分' : '用满积分'}
          </NativeButton>
        </View>
        {pointsHint && <View className='checkout-points-hint'>{pointsHint}</View>}
        <View className='checkout-points-meta'>
          <Text className='checkout-points-meta-left'>
            可用积分 {formatInteger(pointsMeta.available)} · 本单最多可用 {formatInteger(pointsMeta.maximum)}
          </Text>
          <Text className={`checkout-points-status ${usingMaxPoints && !preview.isPending ? 'checkout-points-status--full' : ''}`}>
            {pointsStatusText}
          </Text>
        </View>
      </> : <View className='checkout-points-empty'>
        {pointsMeta
          ? `可用积分 ${formatInteger(pointsMeta.available)} · 本单暂不可抵扣积分`
          : '正在自动核算可用积分与抵扣额度…'}
      </View>}
    </View>

    {quote && <View className='checkout-card'>
      <View className='checkout-summary-row'>
        <Text className='checkout-summary-label'>商品总额</Text>
        <Text className='checkout-summary-value'>¥{quote.order_gross_amount}</Text>
      </View>
      <View className='checkout-summary-row'>
        <Text className='checkout-summary-label'>积分抵扣（{formatInteger(quote.points_deduction)} 积分）</Text>
        <Text className={quote.points_deduction > 0 ? 'checkout-summary-deduct' : 'checkout-summary-value'}>
          {quote.points_deduction > 0 ? `−¥${quote.points_deduction}.00` : '¥0.00'}
        </Text>
      </View>
      <View className='checkout-summary-divider' />
      <View className='checkout-summary-total'>
        <Text className='checkout-summary-total-label'>微信应付</Text>
        <View className='checkout-price-large'>
          <Text className='checkout-price-large-symbol'>¥</Text>
          <Text className='checkout-price-large-int'>{payableParts?.integer}</Text>
          <Text className='checkout-price-large-dec'>{payableParts?.decimal}</Text>
        </View>
      </View>
    </View>}

    <View className='checkout-tips'>
      <View className='checkout-tip-item'>
        <Icon name='Coupon' className='checkout-tip-icon' size={32} />
        <Text className='checkout-tip-text'>一单一码，到店整单核销；仅同商家商品可一起结算</Text>
      </View>
      <View className='checkout-tip-item'>
        <Icon name='Tips' className='checkout-tip-icon' size={32} />
        <Text className='checkout-tip-text'>金额、积分与库存以提交时实时确认为准</Text>
      </View>
      <View className='checkout-tip-item'>
        <Icon name='Refund' className='checkout-tip-icon' size={32} />
        <Text className='checkout-tip-text'>购买成功后，7天无消费自动退款。</Text>
      </View>
    </View>

    <View className='checkout-footer'>
      <View className='checkout-footer-amount'>
        <Text className='checkout-footer-label'>应付</Text>
        {quote ? <View className='checkout-footer-price'>
          <Text className='checkout-footer-price-symbol'>¥</Text>
          <Text className='checkout-footer-price-value'>{quote.total_amount}</Text>
        </View> : <Text className='checkout-footer-pending'>核算中…</Text>}
      </View>
      <NativeButton
        className={`checkout-submit-btn ${submitDisabled ? 'checkout-submit-btn--disabled' : ''}`}
        disabled={submitDisabled}
        loading={submit.isPending || preview.isPending}
        onClick={() => submit.mutate()}
      >
        {submit.isPending ? '正在提交订单…' : preview.isPending ? '正在核算…' : '确认提交订单'}
      </NativeButton>
    </View>
  </View>
}

export function CheckoutPage() { const session = useSession(); return <AuthGate><Content key={session.epoch} /></AuthGate> }
