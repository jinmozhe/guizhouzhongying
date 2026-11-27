import { modalColors } from '@/styles/colors'
import { useCallback, useEffect, useRef, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Button as NativeButton, Image, Input, Text, View } from '@tarojs/components'
import { useMutation } from '@tanstack/react-query'
import type { CheckoutQuote, ResponseModelCheckoutQuote, ResponseModelNoneType, ResponseModelOrderRead } from '@pinjie/api-client'
import { AuthGate } from '@/components/AuthGate'
import { Button } from '@/components/Button'
import { Icon } from '@/components/Icon'
import { QueryState } from '@/components/QueryState'
import { ApiError } from '@/lib/api'
import { privateRequest, sessionScope, useSession } from '@/lib/session'
import { queryClient } from '@/lib/query'
import { assetUrl } from '@/platform/media'
import { loadDraft, removeDraft, saveDraft } from '@/features/checkout'
import type { Draft } from '@/features/checkout'
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
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loadError, setLoadError] = useState('')
  const [quote, setQuote] = useState<CheckoutQuote | null>(null)
  const [pointsMeta, setPointsMeta] = useState<{ available: string; maximum: number } | null>(null)
  const [autoFilledMax, setAutoFilledMax] = useState(false)
  const [pointsHint, setPointsHint] = useState('')
  const [notice, setNotice] = useState('')
  const [finished, setFinished] = useState(false)
  const [pointsText, setPointsText] = useState('0')
  const submitLock = useRef(false)
  const quoteSeq = useRef(0)
  const autoQuotedId = useRef('')
  const debounceTimer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null)
  const draftRef = useRef<Draft | null>(null)
  draftRef.current = draft

  const clearDebounce = useCallback(() => {
    if (debounceTimer.current !== null) {
      globalThis.clearTimeout(debounceTimer.current)
      debounceTimer.current = null
    }
  }, [])

  const preview = useMutation({ mutationFn: async ({ targetDraft, autoMax }: { targetDraft: Draft; autoMax: boolean }) => {
    if (targetDraft.submitted) throw new Error('请先确认原下单结果')
    const seq = ++quoteSeq.current
    const initialRequest = { ...targetDraft.request, address_id: null, points_to_use: targetDraft.request.points_to_use ?? 0 }
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
    const next: Draft = {
      ...targetDraft,
      request: { ...initialRequest, points_to_use: result.points_deduction, quote_fingerprint: result.fingerprint },
    }
    saveDraft(next); setDraft(next); setNotice('')
  } })
  const previewMutate = preview.mutate

  const scheduleQuote = useCallback((nextDraft: Draft, immediate: boolean) => {
    clearDebounce()
    if (immediate) {
      previewMutate({ targetDraft: nextDraft, autoMax: false })
      return
    }
    debounceTimer.current = globalThis.setTimeout(() => {
      debounceTimer.current = null
      previewMutate({ targetDraft: nextDraft, autoMax: false })
    }, 350)
  }, [clearDebounce, previewMutate])

  const restoreDraft = useCallback(() => {
    const stored = loadDraft(userId)
    const restored = stored && !stored.submitted && stored.request.address_id
      ? { ...stored, request: { ...stored.request, address_id: null, quote_fingerprint: null } } : stored
    if (restored && restored !== stored) saveDraft(restored)
    setDraft(restored); setPointsText(String(restored?.request.points_to_use ?? 0)); setLoadError('')
    if (!restored) {
      autoQuotedId.current = ''
      setQuote(null)
      setPointsMeta(null)
      setAutoFilledMax(false)
      setPointsHint('')
      return
    }
    if (!restored.submitted && autoQuotedId.current !== restored.request.request_id) {
      autoQuotedId.current = restored.request.request_id
      setQuote(null)
      setPointsMeta(null)
      setAutoFilledMax(false)
      setPointsHint('')
      previewMutate({ targetDraft: restored, autoMax: restored.request.points_to_use == null })
    }
  }, [previewMutate, userId])

  useEffect(() => {
    try { restoreDraft() } catch (error) { setLoadError(error instanceof Error ? error.message : '读取结算记录失败') }
  }, [restoreDraft])

  useDidShow(() => {
    try { restoreDraft() } catch (error) { setLoadError(error instanceof Error ? error.message : '读取结算记录失败') }
  })

  useEffect(() => () => {
    clearDebounce()
    if (userId && draftRef.current && !draftRef.current.submitted) removeDraft(userId)
  }, [clearDebounce, userId])

  function changePoints(value: string) {
    clearDebounce()
    quoteSeq.current += 1
    setAutoFilledMax(false)
    setPointsHint('')
    if (!draft || draft.submitted) return
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
    const next: Draft = { ...draft, request: { ...draft.request, points_to_use: parsed, address_id: null, quote_fingerprint: null } }
    saveDraft(next); setDraft(next)
    scheduleQuote(next, false)
  }

  function commitPointsOnBlur() {
    if (!draft || draft.submitted) return
    if (pointsText.trim() === '') {
      setPointsText('0')
      setPointsHint('')
      const next: Draft = { ...draft, request: { ...draft.request, points_to_use: 0, address_id: null, quote_fingerprint: null } }
      saveDraft(next); setDraft(next); setQuote(null)
      scheduleQuote(next, true)
      return
    }
    if (debounceTimer.current !== null && /^\d{1,13}$/.test(pointsText)) {
      scheduleQuote(draft, true)
    }
  }

  function applyPoints(points: number) {
    if (!draft || draft.submitted || preview.isPending || submit.isPending || find.isPending || finished) return
    clearDebounce()
    quoteSeq.current += 1
    setAutoFilledMax(false)
    setPointsHint('')
    setPointsText(String(points))
    const next: Draft = { ...draft, request: { ...draft.request, points_to_use: points, address_id: null, quote_fingerprint: null } }
    saveDraft(next); setDraft(next); setQuote(null)
    preview.mutate({ targetDraft: next, autoMax: false })
  }

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
    removeDraft(userId); setFinished(true)
    await queryClient.invalidateQueries({ queryKey: ['private', 'orders'] })
    if (session.epoch !== sessionScope()) return
    await Taro.redirectTo({ url: `/subpackages/trade/order-detail/index?id=${orderId}` })
  }

  const submit = useMutation({ mutationFn: async (recover: boolean) => {
    if (submitLock.current) return
    submitLock.current = true
    try {
      if (!draft || !draft.request.quote_fingerprint) throw new Error('正在核算应付金额，请稍候再提交')
      if (!recover && !quote) throw new Error('正在核算应付金额，请稍候再提交')
      const cashZero = Number(quote?.total_amount ?? 0) === 0
      const answer = await Taro.showModal({
        ...modalColors,
        title: recover ? '恢复原请求' : '确认创建订单',
        content: recover
          ? '以相同请求号和原内容恢复。报价变化时会明确拒绝，请先查询原结果。'
          : cashZero
            ? `成交总额 ¥${quote?.order_gross_amount}，使用 ${quote?.points_deduction} 积分，无需微信付款。成交后立即获得整单到店核销码。`
            : `成交总额 ¥${quote?.order_gross_amount}，使用 ${quote?.points_deduction} 积分，微信应付 ¥${quote?.total_amount}。成交后获得整单到店核销码。`,
      })
      if (!answer.confirm || session.epoch !== sessionScope()) return
      const pending = { ...draft, submitted: true }
      saveDraft(pending); setDraft(pending); setNotice('正在确认订单结果，请勿重复下单')
      try {
        const order = await privateRequest<ResponseModelOrderRead>('/orders', { method: 'POST', data: pending.request })
        await complete(order.id, pending.cartItemIds)
      } catch (error) {
        if (session.epoch !== sessionScope()) throw error
        // Only a definitive server rejection allows editing; timeout, auth loss and conflict retain the key.
        if (error instanceof ApiError && [400, 409, 422].includes(error.status) && error.code !== 'ORDER_REQUEST_CONFLICT') {
          const next: Draft = { ...pending, submitted: false, request: { ...pending.request, quote_fingerprint: null } }
          saveDraft(next); setDraft(next); setQuote(null)
          if (error.code === 'CHECKOUT_STALE_QUOTE') {
            const refreshed: Draft = { ...next, request: { ...next.request, points_to_use: undefined } }
            saveDraft(refreshed); setDraft(refreshed)
            setNotice('商品价格或可用积分有变动，已为您自动刷新最新金额，请核对后重新提交')
            previewMutate({ targetDraft: refreshed, autoMax: true })
          } else {
            setNotice('服务端拒绝本次下单，请核对信息后重试')
          }
        } else setNotice('下单结果未确认。请查询结果，勿重新选择商品创建另一笔订单')
        throw error
      }
    } finally { submitLock.current = false }
  } })

  const find = useMutation({ mutationFn: async () => {
    if (!draft) throw new Error('结算记录不存在')
    const order = await privateRequest<ResponseModelOrderRead>(`/orders/by-request/${draft.request.request_id}`)
    await complete(order.id, draft.cartItemIds)
  } })

  const busy = preview.isPending || submit.isPending || find.isPending || finished
  if (loadError) return <View className='checkout-page'><QueryState title='结算记录无法读取' detail={loadError} /></View>
  if (!draft) return <View className='checkout-page'><QueryState title='暂无结算商品' detail='请从商品详情或购物车进入结算' /></View>

  const error = preview.error ?? submit.error ?? find.error
  const canUsePoints = !!pointsMeta && pointsMeta.maximum > 0
  const usingMaxPoints = canUsePoints && /^\d+$/.test(pointsText) && Number(pointsText) === pointsMeta.maximum
  const totalKinds = quote ? quote.items.length : draft.request.items.length
  const totalPieces = quote
    ? quote.items.reduce((sum, line) => sum + line.quantity, 0)
    : draft.request.items.reduce((sum, line) => sum + line.quantity, 0)
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
    {notice && <View className='note'>{notice}</View>}
    {error && <QueryState
      title='操作未完成'
      error={error}
      retry={!draft.submitted ? () => {
        const refreshed: Draft = { ...draft, request: { ...draft.request, points_to_use: undefined, quote_fingerprint: null } }
        saveDraft(refreshed); setDraft(refreshed)
        preview.mutate({ targetDraft: refreshed, autoMax: true })
      } : undefined}
    />}
    {draft.submitted ? <View className='checkout-card'>
      <View className='checkout-card-title'>请先确认原下单结果</View>
      <View className='muted'>请求号 {draft.request.request_id}</View>
      <View className='checkout-recover-actions'>
        <Button block type='primary' disabled={busy} loading={find.isPending} onClick={() => find.mutate()}>查询订单结果</Button>
        <Button block fill='outline' disabled={busy} loading={submit.isPending} onClick={() => submit.mutate(true)}>以原请求恢复</Button>
      </View>
    </View> : <>
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
            <CheckoutThumb name={line.product_name} url={draft.previews?.[line.sku_id]} />
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
                disabled={submit.isPending || find.isPending || finished}
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
          onClick={() => submit.mutate(false)}
        >
          {submit.isPending ? '正在创建订单…' : preview.isPending ? '正在核算…' : '确认创建订单'}
        </NativeButton>
      </View>
    </>}
  </View>
}

export function CheckoutPage() { const session = useSession(); return <AuthGate><Content key={session.epoch} /></AuthGate> }
