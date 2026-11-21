import { useCallback, useEffect, useRef, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Input, Text, View } from '@tarojs/components'
import { useMutation } from '@tanstack/react-query'
import type { CheckoutQuote, ResponseModelCheckoutQuote, ResponseModelOrderRead } from '@pinjie/api-client'
import { AuthGate } from '@/components/AuthGate'
import { Button } from '@/components/Button'
import { QueryState } from '@/components/QueryState'
import { ApiError } from '@/lib/api'
import { privateRequest, sessionScope, useSession } from '@/lib/session'
import { queryClient } from '@/lib/query'
import { loadDraft, removeDraft, saveDraft } from '@/features/checkout'
import type { Draft } from '@/features/checkout'

function Content() {
  const session = useSession()
  const userId = session.user?.id ?? ''
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loadError, setLoadError] = useState('')
  const [quote, setQuote] = useState<CheckoutQuote | null>(null)
  const [notice, setNotice] = useState('')
  const [finished, setFinished] = useState(false)
  const [pointsText, setPointsText] = useState('0')
  const submitLock = useRef(false)
  const restoreDraft = useCallback(() => {
    const stored = loadDraft(userId)
    const restored = stored && !stored.submitted && stored.request.address_id
      ? { ...stored, request: { ...stored.request, address_id: null, quote_fingerprint: null } } : stored
    if (restored && restored !== stored) saveDraft(restored)
    setDraft(restored); setPointsText(String(restored?.request.points_to_use ?? 0)); setLoadError('')
  }, [userId])
  useEffect(() => {
    try { restoreDraft() } catch (error) { setLoadError(error instanceof Error ? error.message : '读取结算记录失败') }
  }, [restoreDraft])
  useDidShow(() => {
    try { restoreDraft() } catch (error) { setLoadError(error instanceof Error ? error.message : '读取结算记录失败') }
  })
  function changePoints(value: string) {
    setPointsText(value)
    if (!draft || draft.submitted) return
    setQuote(null)
    if (!/^\d{1,13}$/.test(value)) return
    const next = { ...draft, request: { ...draft.request, points_to_use: Number(value), address_id: null, quote_fingerprint: null } }
    saveDraft(next); setDraft(next); setQuote(null)
  }
  const preview = useMutation({ mutationFn: async () => {
    if (!draft || draft.submitted) throw new Error('请先确认原下单结果')
    if (!/^\d{1,13}$/.test(pointsText)) throw new Error('请输入合法整数积分')
    const result = await privateRequest<ResponseModelCheckoutQuote>('/checkout/preview', { method: 'POST', data: draft.request })
    if (session.epoch !== sessionScope()) return
    setQuote(result)
    const next = { ...draft, request: { ...draft.request, quote_fingerprint: result.fingerprint } }
    saveDraft(next); setDraft(next); setNotice('')
  } })
  async function complete(orderId: string) {
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
    if (!draft || !draft.request.quote_fingerprint) throw new Error('请先获取服务端报价')
    if (!recover && (!quote || Date.parse(quote.expires_at) <= Date.now())) throw new Error('报价已过期，请重新获取后确认')
    const answer = await Taro.showModal({ title: recover ? '恢复原请求' : '确认创建订单', content: recover ? '以相同请求号和原内容恢复。报价变化时会明确拒绝，请先查询原结果。' : `成交总额 ¥${quote?.order_gross_amount}，使用 ${quote?.points_deduction} 积分，微信应付 ¥${quote?.total_amount}。成交后获得整单到店核销码。` })
    if (!answer.confirm || session.epoch !== sessionScope()) return
    const pending = { ...draft, submitted: true }
    saveDraft(pending); setDraft(pending); setNotice('正在确认订单结果，请勿重复下单')
    try {
      const order = await privateRequest<ResponseModelOrderRead>('/orders', { method: 'POST', data: pending.request })
      await complete(order.id)
    } catch (error) {
      if (session.epoch !== sessionScope()) throw error
      // Only a definitive server rejection allows editing; timeout, auth loss and conflict retain the key.
      if (error instanceof ApiError && [400, 409, 422].includes(error.status) && error.code !== 'ORDER_REQUEST_CONFLICT') {
        const next = { ...pending, submitted: false, request: { ...pending.request, quote_fingerprint: null } }
        saveDraft(next); setDraft(next); setQuote(null)
        setNotice('服务端拒绝本次下单，请调整信息并重新获取报价')
      } else setNotice('下单结果未确认。请查询结果，勿重新选择商品创建另一笔订单')
      throw error
    }
    } finally { submitLock.current = false }
  } })
  const find = useMutation({ mutationFn: async () => {
    if (!draft) throw new Error('结算记录不存在')
    const order = await privateRequest<ResponseModelOrderRead>(`/orders/by-request/${draft.request.request_id}`)
    await complete(order.id)
  } })
  const busy = preview.isPending || submit.isPending || find.isPending || finished
  if (loadError) return <QueryState title='结算记录无法读取' detail={loadError} />
  if (!draft) return <QueryState title='暂无结算商品' detail='请从购物车或商品详情进入' />
  const error = preview.error ?? submit.error ?? find.error
  return <View className='page trade-page'>
    <View className='title'>确认订单</View>
    {notice && <View className='note'>{notice}</View>}
    {error && <QueryState title='操作未完成' error={error} />}
    {draft.submitted ? <View className='surface'>
      <View className='section-title'>请先确认原下单结果</View><View className='muted'>请求号 {draft.request.request_id}</View>
      <Button block type='primary' disabled={busy} loading={find.isPending} onClick={() => find.mutate()}>查询订单结果</Button>
      <Button block fill='outline' disabled={busy} loading={submit.isPending} onClick={() => submit.mutate(true)}>以原请求恢复</Button>
    </View> : <>
      <View className='surface'><View className='section-title'>到店消费 · 无需配送</View><View className='note'>仅同商家商品可一起结算，一单一码，整单核销。</View>
        <View className='field-label'>本次使用积分，1积分抵1元</View><Input type='number' value={pointsText} maxlength={13} disabled={busy} onInput={(event) => changePoints(event.detail.value)} />
        {quote && <View className='muted'>可用积分 {quote.available_points}，本单最多使用 {quote.maximum_points} 积分。<Button fill='outline' disabled={busy} onClick={() => changePoints(String(quote.maximum_points))}>使用本单最大积分</Button></View>}
      </View>
      <View className='surface'><View className='section-title'>结算商品</View>{quote ? quote.items.map((line) => <View className='order-line' key={line.sku_id}><View>{line.product_name}</View><View className='muted'>{Object.values(line.specifications).join(' / ') || '默认规格'} · {line.quantity} 件</View><View>¥{line.unit_price} / 件 · 小计 ¥{line.line_amount}</View></View>) : <View className='muted'>已选 {draft.request.items.length} 种商品，共 {draft.request.items.reduce((total, line) => total + line.quantity, 0)} 件。获取报价后显示名称与成交价格。</View>}</View>
      {quote && <View className='surface'><View className='trade-row spread'><Text>成交总额</Text><Text>¥{quote.order_gross_amount}</Text></View><View className='trade-row spread'><Text>积分抵扣</Text><Text>{quote.points_deduction} 积分</Text></View><View className='trade-row spread'><Text>微信应付</Text><Text className='price'>¥{quote.total_amount}</Text></View><View className='muted'>报价有效至 {new Date(quote.expires_at).toLocaleString()}，提交时由服务端复核。</View></View>}
      <View className='trade-footer'><Button block fill='outline' disabled={busy} loading={preview.isPending} onClick={() => preview.mutate()}>获取最新报价</Button><Button block type='primary' disabled={busy || !quote} loading={submit.isPending} onClick={() => submit.mutate(false)}>确认创建订单</Button></View>
    </>}
    <View className='note'>商品金额、会员价格、积分抵扣和库存由服务端确认。订单创建后可在“我的订单”查看。购物车保留原商品，可自行移除。</View>
  </View>
}
export function CheckoutPage() { const session = useSession(); return <AuthGate><Content key={session.epoch} /></AuthGate> }
