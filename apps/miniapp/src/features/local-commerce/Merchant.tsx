import { useState } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { Text, View } from '@tarojs/components'
import { useQuery } from '@tanstack/react-query'
import type { ResponseModelPublicMerchantRead, ResponseModelPageResultPublicProductRead } from '@pinjie/api-client'
import { getPublic } from '@/lib/api'
import { ProductImage } from '@/components/ProductImage'
import { QueryState } from '@/components/QueryState'
import { Button } from '@/components/Button'

export function MerchantCard({ merchantId }: { merchantId: string }) {
  const query = useQuery({ queryKey: ['merchant-public', merchantId], queryFn: ({ signal }) => getPublic<ResponseModelPublicMerchantRead>(`/merchants/${merchantId}`, signal) })
  if (query.isPending) return <QueryState title='正在读取消费商家' />
  if (query.isError) return <QueryState title='商家资料读取失败' error={query.error} retry={() => { void query.refetch() }} />
  const merchant = query.data
  return <View className='surface' onClick={() => { void Taro.navigateTo({ url: `/subpackages/local/merchant/index?id=${merchantId}` }) }}>
    <View className='section-title'>消费商家 · {merchant.name}</View>
    <View className='trade-row'><View className='trade-thumb'><ProductImage url={merchant.logo_url ?? undefined} /></View><View><View>{merchant.address || '地址待商家补充'}</View><View className='muted'>查看商家详情 ›</View></View></View>
  </View>
}

export function MerchantPage() {
  const id = useRouter().params.id ?? ''
  const [page, setPage] = useState(1)
  const merchant = useQuery({ queryKey: ['merchant-public', id], queryFn: ({ signal }) => getPublic<ResponseModelPublicMerchantRead>(`/merchants/${id}`, signal), enabled: !!id })
  const products = useQuery({ queryKey: ['merchant-products', id, page], queryFn: ({ signal }) => getPublic<ResponseModelPageResultPublicProductRead>(`/products?merchant_id=${id}&page=${page}&page_size=20`, signal), enabled: !!id })
  if (!id) return <QueryState title='商家链接无效' />
  if (merchant.isPending) return <QueryState title='正在加载商家' />
  if (merchant.isError) return <QueryState title='商家加载失败' error={merchant.error} retry={() => { void merchant.refetch() }} />
  const row = merchant.data
  return <View className='page'>
    <View className='surface'><View className='trade-thumb'><ProductImage url={row.logo_url ?? undefined} /></View><View className='title'>{row.name}</View>
      {!row.is_active && <View className='note'>商家已暂停服务，未核销订单可申请退款。</View>}
      <View>{row.address || '消费地址待补充'}</View><View className='muted'>{row.business_hours || '营业时间待补充'}</View>
      {row.public_phone && <View>联系电话：{row.public_phone}</View>}
      {row.description_format === 'restricted_html_v1' && row.description && <mp-html content={row.description} selectable copy-link={false} use-anchor={false} />}
    </View>
    <View className='section-title'>商家商品</View>
    {products.isPending && <QueryState title='正在加载商品' />}
    {products.isError && <QueryState title='商品加载失败' error={products.error} retry={() => { void products.refetch() }} />}
    {products.data && !products.isError && <>
      {!products.data.items.length && <QueryState title='暂无可售商品' />}
      {products.data.items.map((item) => <View className='surface' key={item.id} onClick={() => { void Taro.navigateTo({ url: `/subpackages/catalog/detail/index?id=${item.id}` }) }}><View className='trade-row'><View className='trade-thumb'><ProductImage url={item.images[0]} /></View><View>{item.name}</View></View></View>)}
      {products.data.total_pages > 1 && <View className='trade-row spread'><Button disabled={page === 1 || products.isFetching} onClick={() => setPage(page - 1)}>上一页</Button><Text>{page} / {products.data.total_pages}</Text><Button disabled={page >= products.data.total_pages || products.isFetching} onClick={() => setPage(page + 1)}>下一页</Button></View>}
    </>}
  </View>
}
