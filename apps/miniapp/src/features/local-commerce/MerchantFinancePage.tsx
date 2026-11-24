import { useState } from 'react'
import { Text, View } from '@tarojs/components'
import { useQuery } from '@tanstack/react-query'
import type { ResponseModelPageResultReceivableRead, ResponseModelPageResultSettlementRead } from '@pinjie/api-client'
import { AuthGate } from '@/components/AuthGate'
import { Button } from '@/components/Button'
import { QueryState } from '@/components/QueryState'
import { privateRequest, useSession } from '@/lib/session'

function Content() {
  const session = useSession(); const [page, setPage] = useState(1); const [batchPage, setBatchPage] = useState(1)
  const receipts = useQuery({ queryKey: ['private', 'merchant-receivables', session.epoch, page], gcTime: 0, queryFn: ({ signal }) => privateRequest<ResponseModelPageResultReceivableRead>(`/merchant/receivables?page=${page}&page_size=10`, { signal }) })
  const batches = useQuery({ queryKey: ['private', 'merchant-settlements', session.epoch, batchPage], gcTime: 0, queryFn: ({ signal }) => privateRequest<ResponseModelPageResultSettlementRead>(`/merchant/settlements?page=${batchPage}&page_size=10`, { signal }) })
  return <View className='page'><View className='title'>商家应收与结算</View><View className='note'>核销后按含积分全额登记应收，平台另承担积分补贴和推荐佣金，打款在线下处理。</View>
    <View className='section-title'>核销应收</View>
    {receipts.isPending && <QueryState title='正在读取应收' />}
    {receipts.isError && <QueryState title='应收读取失败' error={receipts.error} retry={() => { void receipts.refetch() }} />}
    {receipts.data && !receipts.isError && <>{!receipts.data.items.length && <QueryState title='暂无应收' />}{receipts.data.items.map((row) => <View className='surface' key={row.id}><View className='balance-secondary finance-amount'>应收 ¥{row.gross_amount}</View><View className='muted'>消费者现金 ¥{row.cash_amount} · 平台积分补贴 ¥{row.points_amount}</View><View className='wrap'>订单 {row.order_id}</View><View>{row.settlement_id ? `已对账，批次 ${row.settlement_id}` : '待对账'}</View></View>)}<View className='trade-row spread'><Button disabled={page === 1 || receipts.isFetching} onClick={() => setPage(page - 1)}>上一页</Button><Text>{page} / {receipts.data.total_pages || 1}</Text><Button disabled={page >= receipts.data.total_pages || receipts.isFetching} onClick={() => setPage(page + 1)}>下一页</Button></View></>}
    <View className='section-title'>结算批次</View>
    {batches.isPending && <QueryState title='正在读取结算' />}
    {batches.isError && <QueryState title='结算读取失败' error={batches.error} retry={() => { void batches.refetch() }} />}
    {batches.data && !batches.isError && <>{!batches.data.items.length && <QueryState title='暂无结算' />}{batches.data.items.map((row) => <View className='surface' key={row.id}><View className='balance-secondary finance-amount'>¥{row.amount} · {row.status === 'paid' ? '已线下结清' : '待线下打款'}</View><View className='muted wrap'>批次 {row.id}</View>{row.payment_reference && <View>付款凭据 {row.payment_reference}</View>}{row.paid_at && <View>{new Date(row.paid_at).toLocaleString()}</View>}</View>)}<View className='trade-row spread'><Button disabled={batchPage === 1 || batches.isFetching} onClick={() => setBatchPage(batchPage - 1)}>上一页</Button><Text>{batchPage} / {batches.data.total_pages || 1}</Text><Button disabled={batchPage >= batches.data.total_pages || batches.isFetching} onClick={() => setBatchPage(batchPage + 1)}>下一页</Button></View></>}
  </View>
}
export function MerchantFinancePage() { const session = useSession(); return <AuthGate><Content key={session.epoch} /></AuthGate> }
