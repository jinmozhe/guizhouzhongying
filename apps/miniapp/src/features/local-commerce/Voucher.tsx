import { Image, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useQuery } from '@tanstack/react-query'
import type { ResponseModelVoucherRead } from '@pinjie/api-client'
import { privateRequest, useSession } from '@/lib/session'
import { QueryState } from '@/components/QueryState'
import { Button } from '@/components/Button'
import { useEffect, useState } from 'react'

const labels: Record<string, string> = { available: '待到店核销', expired: '已到期，等待自动退款', redeemed: '整单已核销', refunding: '整单退款中', refunded: '已退还原积分及金额' }
export function Voucher({ orderId }: { orderId: string }) {
  const session = useSession()
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = globalThis.setInterval(() => setNow(Date.now()), 1000); return () => globalThis.clearInterval(timer) }, [])
  const query = useQuery({ queryKey: ['private', 'redemption', session.epoch, orderId], gcTime: 0, queryFn: ({ signal }) => privateRequest<ResponseModelVoucherRead>(`/orders/${orderId}/redemption`, { signal }) })
  if (query.isPending) return <QueryState title='正在读取核销凭证' />
  if (query.isError) return <QueryState title='核销凭证读取失败' error={query.error} retry={() => { void query.refetch() }} />
  const row = query.data
  const expired = Date.parse(row.expires_at) <= now
  return <View className='surface'>
    <View className='section-title'>{labels[expired && row.status === 'available' ? 'expired' : row.status] ?? row.status}</View>
    {row.status === 'available' && !expired && row.code && <>
      {row.qr_data_url && <Image src={row.qr_data_url} mode='aspectFit' style={{ width: '400rpx', height: '400rpx', display: 'block', margin: '0 auto' }} />}
      <View className='muted wrap'>{row.code}</View>
      <Button block fill='outline' onClick={() => { if (row.code) void Taro.setClipboardData({ data: row.code }) }}>复制核销码</Button>
      <View className='note'>到店后向商家出示二维码。本码一次核销整单商品，请勿提前泄露。</View>
    </>}
    <View className='muted'>有效期至 {new Date(row.expires_at).toLocaleString()}，未使用七天自动退回原积分及现金。</View>
    {row.redeemed_at && <View>核销时间：{new Date(row.redeemed_at).toLocaleString()}</View>}
    <Button fill='outline' loading={query.isFetching} onClick={() => { void query.refetch() }}>刷新凭证状态</Button>
  </View>
}
