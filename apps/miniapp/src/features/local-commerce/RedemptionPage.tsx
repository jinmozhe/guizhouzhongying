import { useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import { Input, Text, View } from '@tarojs/components'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { RedemptionConfirmInput, RedemptionPreviewRead, ResponseModelRedemptionPreviewRead, ResponseModelVoucherRead, ResponseModelPageResultVoucherRead, ResponseModelOperationIntentRead } from '@pinjie/api-client'
import { AuthGate } from '@/components/AuthGate'
import { Button } from '@/components/Button'
import { QueryState } from '@/components/QueryState'
import { privateRequest, sessionScope, useSession } from '@/lib/session'

function Content() {
  const session = useSession(); const [code, setCode] = useState(''); const [preview, setPreview] = useState<RedemptionPreviewRead>(); const [previewCode, setPreviewCode] = useState('')
  const [pending, setPending] = useState<RedemptionConfirmInput>(); const [page, setPage] = useState(1); const lock = useRef(false)
  const records = useQuery({ queryKey: ['private', 'redemptions', session.epoch, page], gcTime: 0, queryFn: ({ signal }) => privateRequest<ResponseModelPageResultVoucherRead>(`/merchant/redemptions?page=${page}&page_size=10`, { signal }) })
  const scan = useMutation({ mutationFn: async () => { const result = await Taro.scanCode({ onlyFromCamera: true, scanType: ['qrCode'] }); setCode(result.result); setPreview(undefined) } })
  const lookup = useMutation({ mutationFn: async () => {
    const value = code.trim()
    const result = await privateRequest<ResponseModelRedemptionPreviewRead>('/merchant/redemptions/preview', { method: 'POST', data: { code: value } })
    if (session.epoch !== sessionScope()) return
    setPreview(result); setPreviewCode(value)
  } })
  const confirm = useMutation({ mutationFn: async () => {
    if (lock.current || session.epoch !== sessionScope()) return
    lock.current = true
    try {
      let payload = pending
      if (!payload) {
        if (!preview || code.trim() !== previewCode) throw new Error('请先读取并核对订单')
        const answer = await Taro.showModal({ title: '确认整单核销', content: `${preview.items.join('；')}。成交额 ¥${preview.order_gross_amount}，确认顾客已消费全部商品？` })
        if (!answer.confirm || session.epoch !== sessionScope()) return
        const intent = await privateRequest<ResponseModelOperationIntentRead>('/checkout/intent')
        if (session.epoch !== sessionScope()) return
        payload = { request_id: intent.request_id, order_id: preview.order_id, code: previewCode }; setPending(payload)
      }
      await privateRequest<ResponseModelVoucherRead>('/merchant/redemptions/confirm', { method: 'POST', data: payload })
      if (session.epoch !== sessionScope()) return
      setPending(undefined); setPreview(undefined); setCode('')
      await records.refetch()
      await Taro.showToast({ title: '整单核销成功', icon: 'success' })
    } finally { lock.current = false }
  } })
  const busy = scan.isPending || lookup.isPending || confirm.isPending
  return <View className='page'><View className='title'>商家核销</View>
    {(scan.error || lookup.error || confirm.error) && <QueryState title='操作未完成，请核对原结果' error={scan.error ?? lookup.error ?? confirm.error} />}
    <View className='surface'><View className='note'>扫码或输入核销码，核对商品后整单确认。</View><Button block disabled={busy || !!pending} onClick={() => scan.mutate()}>扫描顾客核销码</Button><Input value={code} disabled={busy || !!pending} maxlength={64} placeholder='输入或粘贴核销码' onInput={(event) => { setCode(event.detail.value); setPreview(undefined) }} /><Button block fill='outline' disabled={busy || !code || !!pending} onClick={() => lookup.mutate()}>查询核销商品</Button>
      {preview && <><View className='section-title'>{preview.merchant_name}</View>{preview.items.map((item, index) => <View key={`${index}-${item}`}>{item}</View>)}<View>成交总额 ¥{preview.order_gross_amount}</View><View className='muted'>有效期至 {new Date(preview.expires_at).toLocaleString()}</View></>}
      {(preview || pending) && <Button block type='primary' disabled={busy} loading={confirm.isPending} onClick={() => confirm.mutate()}>{pending ? '查询并恢复原核销请求' : '确认整单已消费并核销'}</Button>}
    </View>
    <View className='section-title'>已核销订单</View>
    {records.isPending && <QueryState title='正在读取核销记录' />}
    {records.isError && <QueryState title='核销记录读取失败' error={records.error} retry={() => { void records.refetch() }} />}
    {records.data && !records.isError && <>{!records.data.items.length && <QueryState title='暂无核销记录' />}{records.data.items.map((row) => <View className='surface' key={row.order_id}><View className='wrap'>订单 {row.order_id}</View>{row.items?.map((item, index) => <View key={index}>{item}</View>)}<View>成交总额 ¥{row.order_gross_amount}</View><View className='muted'>{row.redeemed_at ? new Date(row.redeemed_at).toLocaleString() : ''}</View></View>)}<View className='trade-row spread'><Button disabled={page === 1 || records.isFetching} onClick={() => setPage(page - 1)}>上一页</Button><Text>{page} / {records.data.total_pages || 1}</Text><Button disabled={page >= records.data.total_pages || records.isFetching} onClick={() => setPage(page + 1)}>下一页</Button></View></>}
  </View>
}
export function RedemptionPage() { const session = useSession(); return <AuthGate><Content key={session.epoch} /></AuthGate> }
