import { modalColors } from '@/styles/colors'
import { useEffect, useRef, useState } from 'react'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { View } from '@tarojs/components'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { PaymentAttemptRead, ResponseModelOperationIntentRead, ResponseModelPaymentAttemptRead, ResponseModelPaymentStatusRead } from '@pinjie/api-client'
import { Button } from '@/components/Button'
import { QueryState } from '@/components/QueryState'
import { ApiError } from '@/lib/api'
import { privateRequest, sessionScope, useSession } from '@/lib/session'
import { canInvokePayment, isPaymentRequestId, shouldPollPayment } from './payment-domain'

const labels: Record<string, string> = {
  created: '支付准备中，请稍候', pending: '由微信收银台完成付款',
  unknown: '支付结果确认中，请勿重复付款', succeeded: '渠道已确认付款，订单正在更新',
  unavailable: '微信支付尚未开放', closed: '本次支付已关闭，可重新付款',
}

function showPaymentErrorModal(error: unknown) {
  const message = error instanceof Error && error.message.trim() ? error.message.trim() : '支付发起未完成，请稍后重试'
  const content = error instanceof ApiError && error.requestId
    ? `${message}\n追踪编号：${error.requestId}`
    : message
  void Taro.showModal({
    ...modalColors,
    title: '支付未完成',
    content,
    showCancel: false,
    confirmText: '我知道了',
  }).catch(() => undefined)
}

export function useOrderPayment(orderId: string, refreshOrder: () => Promise<unknown>) {
  const session = useSession()
  const userId = session.user?.id
  const storageKey = `guizhouzhongying.payment.${userId}.${orderId}`
  const [visible, setVisible] = useState(true)
  const [pollUntil, setPollUntil] = useState(() => Date.now() + 60000)
  const [notice, setNotice] = useState('')
  const lock = useRef(false)
  const mounted = useRef(true)
  const foreground = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; foreground.current = false }
  }, [])
  const query = useQuery({
    queryKey: ['private', 'payment', session.epoch, orderId], gcTime: 0,
    queryFn: ({ signal }) => privateRequest<ResponseModelPaymentStatusRead>(`/orders/${orderId}/payment-status`, { signal }),
    refetchInterval: (state) => shouldPollPayment(state.state.data?.attempt?.status, visible, pollUntil, Date.now()) ? 3000 : false,
  })
  useDidShow(() => { foreground.current = true; setVisible(true); setPollUntil(Date.now() + 60000); void query.refetch(); void refreshOrder() })
  useDidHide(() => { foreground.current = false; setVisible(false) })
  useEffect(() => {
    if (visible && query.data?.attempt?.status === 'succeeded') void refreshOrder()
  }, [visible, query.dataUpdatedAt, query.data?.attempt?.status, refreshOrder])
  const pay = useMutation({
    mutationFn: async () => {
      if (lock.current || !userId) return
      lock.current = true
      const epoch = session.epoch
      const assertIdentity = () => {
        if (!mounted.current || epoch !== sessionScope()) throw new Error('页面或登录身份已变化，请重新读取订单')
      }
      const assertForeground = () => {
        assertIdentity()
        if (!foreground.current) throw new Error('请返回订单页面查询原支付结果')
      }
      try {
        setNotice('')
        const latest = await privateRequest<ResponseModelPaymentStatusRead>(`/orders/${orderId}/payment-status`)
        assertIdentity()
        if (!latest.enabled) throw new Error('微信支付尚未开放')
        let attempt: PaymentAttemptRead | null | undefined = latest.attempt
        if (attempt?.status === 'succeeded') { await refreshOrder(); return }
        if (attempt?.status === 'unknown' || attempt?.status === 'created') throw new Error('支付结果确认中，请稍候核对')
        if (!attempt || attempt.status === 'closed' || attempt.status === 'unavailable') {
          const saved: unknown = Taro.getStorageSync(storageKey)
          let requestId: string | undefined
          if (saved) {
            if (!isPaymentRequestId(saved)) throw new Error('原支付请求记录无效，请联系支持核对')
            requestId = saved
            const previous = await privateRequest<ResponseModelPaymentStatusRead>(`/orders/${orderId}/payment-attempts/by-request/${requestId}`)
            assertIdentity()
            if (previous.attempt && !['closed', 'unavailable'].includes(previous.attempt.status)) attempt = previous.attempt
            else if (previous.attempt) requestId = undefined
          }
          if (!attempt || ['closed', 'unavailable'].includes(attempt.status)) {
            if (!requestId) {
              const ticket = await privateRequest<ResponseModelOperationIntentRead>('/payments/intent')
              assertIdentity()
              requestId = ticket.request_id
            }
            Taro.setStorageSync(storageKey, requestId)
            assertForeground()
            attempt = await privateRequest<ResponseModelPaymentAttemptRead>(`/orders/${orderId}/payment-attempts`, {
              method: 'POST', data: { request_id: requestId, channel: 'wechat' },
            })
            assertIdentity()
          }
        }
        if (!canInvokePayment(attempt) || !attempt?.payment_parameters) {
          setNotice(labels[attempt?.status ?? 'unknown'] ?? '请稍候核对支付结果')
          return
        }
        assertForeground()
        try {
          await Taro.requestPayment(attempt.payment_parameters)
          assertIdentity()
          setNotice('正在向服务端确认付款结果')
        } catch {
          assertIdentity()
          setNotice('收银台已返回，正在核对服务端支付结果')
        }
      } finally {
        lock.current = false
        if (mounted.current && foreground.current && epoch === sessionScope()) {
          setPollUntil(Date.now() + 60000)
          await query.refetch()
          await refreshOrder()
        }
      }
    },
    onError: (error) => {
      showPaymentErrorModal(error)
    },
  })
  const attempt = query.data?.attempt
  const enabled = !!query.data?.enabled
  const blocked = !enabled || query.isFetching || pay.isPending
    || ['created', 'unknown', 'succeeded'].includes(attempt?.status ?? '')
    || (attempt?.status === 'pending' && !attempt.payment_parameters)
  const statusText = query.isPending
    ? '正在读取支付状态…'
    : query.isError
      ? '支付状态读取失败，请重新进入重试'
      : attempt
        ? labels[attempt.status] ?? '支付状态待核对'
        : enabled
          ? '由微信收银台完成付款'
          : '微信支付尚未开放'
  const buttonText = pay.isPending
    ? '正在调起支付…'
    : !query.isPending && !enabled
      ? '微信支付尚未开放'
      : attempt?.status === 'pending'
        ? '继续付款'
        : '微信付款'
  return {
    query,
    pay,
    attempt,
    enabled,
    blocked,
    notice,
    statusText,
    buttonText,
  }
}

export function PaymentPanel({ orderId, refreshOrder }: { orderId: string; refreshOrder: () => Promise<unknown> }) {
  const { query, pay, attempt, enabled, blocked, notice, statusText, buttonText } = useOrderPayment(orderId, refreshOrder)
  return <View className='surface'>
    <View className='section-title'>微信支付</View>
    {query.isPending && <QueryState title='正在读取支付状态' />}
    {(query.error || pay.error) && <QueryState title='支付结果未确认，请稍候核对' error={query.error ?? pay.error} />}
    {query.data && <View className={`note ${attempt?.status === 'succeeded' ? 'note-success' : attempt?.status === 'created' || attempt?.status === 'unknown' ? 'note-warning' : ''}`}>{statusText}</View>}
    {notice && <View className='note note-warning'>{notice}</View>}
    {enabled && <Button block type='primary' disabled={blocked} loading={pay.isPending} onClick={() => pay.mutate()}>{buttonText}</Button>}
  </View>
}
