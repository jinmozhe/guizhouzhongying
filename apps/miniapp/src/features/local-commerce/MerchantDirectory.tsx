import { useEffect, useState, type MutableRefObject, type ReactNode } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { Button, Image, ScrollView, Text, View } from '@tarojs/components'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { PublicMerchantRead, ResponseModelPageResultPublicMerchantRead } from '@pinjie/api-client'
import { Icon } from '@/components/Icon'
import { QueryState } from '@/components/QueryState'
import { getPublic } from '@/lib/api'
import { assetUrl } from '@/platform/media'
import './merchant-directory.scss'

type MerchantScope = { categoryId?: string; keyword: string }
export type MerchantSelection = Pick<PublicMerchantRead, 'id' | 'name'>

const merchantPageSize = 20
const visibleMerchantCount = 4
export const homeMerchantQueryKey = ['catalog', 'home-merchants'] as const

function readScope(value?: string): MerchantScope | undefined {
  if (value === undefined) return { keyword: '' }
  try {
    const scope: unknown = JSON.parse(value.startsWith('[') ? value : decodeURIComponent(value))
    if (Array.isArray(scope) && scope.length === 2 && typeof scope[0] === 'string' && typeof scope[1] === 'string') {
      return { categoryId: scope[0] || undefined, keyword: scope[1] }
    }
  } catch {
    return undefined
  }
  return undefined
}

async function getMerchantPage(
  { categoryId, keyword }: MerchantScope, page: number, pageSize: number, signal: AbortSignal, openNow = false,
) {
  const query = [
    `page=${page}`,
    `page_size=${pageSize}`,
    categoryId && `category_id=${encodeURIComponent(categoryId)}`,
    keyword && `search=${encodeURIComponent(keyword)}`,
    openNow && 'open_now=true',
  ].filter(Boolean).join('&')
  const result = await getPublic<ResponseModelPageResultPublicMerchantRead>(`/merchants/browse?${query}`, signal)
  if (result.page !== page || result.page_size !== pageSize) throw new Error('商家分页响应无效，请重试')
  return result
}

function navigate(url: string, message: string) {
  void Taro.navigateTo({ url }).catch(() => Taro.showToast({ title: message, icon: 'none' }))
}

function MerchantListCard({ merchant }: { merchant: PublicMerchantRead }) {
  const hours = merchant.business_hours.trim()
  const address = merchant.address.trim()
  const phone = merchant.public_phone.trim()
  const { latitude, longitude } = merchant
  const openMerchant = () => navigate(
    `/subpackages/local/merchant/index?id=${encodeURIComponent(merchant.id)}`, '商家详情打开失败，请重试',
  )
  const hasLocation = typeof latitude === 'number' && typeof longitude === 'number'
  return <View className='merchant-list-card' onClick={openMerchant}>
    <View className='merchant-list-card-top' ariaRole='link' ariaLabel={`查看${merchant.name}`}>
      <View className='merchant-list-logo'><MerchantLogo merchant={merchant} /></View>
      <View className='merchant-list-name'>{merchant.name}</View>
      <Icon name='ArrowRight' size={20} />
    </View>
    {(address || hours || phone || hasLocation) && <View className='merchant-list-card-bottom'>
      <View className='merchant-list-facts'>
        {address && <View>{address}</View>}
        {hours && <View>营业时间 {hours}</View>}
      </View>
      {phone && <Button className='merchant-list-action merchant-list-call' ariaLabel={`拨打${merchant.name}的公开电话`}
        onClick={(event) => {
          event.stopPropagation()
          void Taro.makePhoneCall({ phoneNumber: phone })
            .catch(() => Taro.showToast({ title: '拨号未完成，可重新点击', icon: 'none' }))
        }}
      ><Icon name='Phone' size={30} /></Button>}
      {hasLocation && <Button className='merchant-list-action' ariaLabel={`导航到${merchant.name}`}
        onClick={(event) => {
          event.stopPropagation()
          void Taro.openLocation({ latitude, longitude, name: merchant.name, address })
            .catch(() => Taro.showToast({ title: '地图打开失败，请重试', icon: 'none' }))
        }}
      ><Icon name='Location' size={30} /></Button>}
    </View>}
  </View>
}

function MerchantLogo({ merchant }: { merchant: PublicMerchantRead }) {
  const [failedLogo, setFailedLogo] = useState<string>()
  let source = ''
  if (merchant.logo_url) {
    try { source = assetUrl(merchant.logo_url) } catch { /* Use the same placeholder as a missing logo. */ }
  }
  return source && source !== failedLogo
    ? <Image key={source} src={source} mode='aspectFit' lazyLoad onError={() => setFailedLogo(source)} />
    : <Text className='merchant-logo-initial' ariaHidden>{Array.from(merchant.name)[0]}</Text>
}

function MerchantLogoButton({
  merchant, selected, onSelect,
}: { merchant: PublicMerchantRead; selected: boolean; onSelect: () => void }) {
  return <Button className={`merchant-preview-logo${selected ? ' is-selected' : ''}`}
    ariaLabel={selected ? `取消筛选${merchant.name}，显示全部商品` : `只看${merchant.name}的商品`}
    onClick={onSelect}
  >
    <View className='merchant-preview-logo-image'>
      <MerchantLogo merchant={merchant} />
      {selected && <View className='merchant-preview-logo-check'><Icon name='Check' size={20} /></View>}
    </View>
    <Text className='merchant-preview-name' ariaHidden>{merchant.name}</Text>
  </Button>
}

export function HomeMerchants({ visible }: { visible: boolean }) {
  const query = useQuery({
    queryKey: homeMerchantQueryKey,
    queryFn: ({ signal }) => getMerchantPage({ keyword: '' }, 1, merchantPageSize, signal),
    enabled: visible,
  })
  const merchants = query.data?.items ?? []
  if (query.data && !merchants.length && !query.isError) return null

  return <View className='home-section home-merchants'>
    <View className='home-section-header'>
      <View className='home-section-title'>热门商家</View>
      {merchants.length > 0 && <Button className='home-merchants-all' ariaLabel='查看全部商家'
        onClick={() => navigate('/subpackages/local/merchants/index', '商家列表打开失败，请重试')}>
        全部<Icon name='ArrowRight' size={22} />
      </Button>}
    </View>
    {query.isPending && <QueryState title={query.fetchStatus === 'paused' ? '等待网络连接' : '正在加载商家'} />}
    {query.isError && <QueryState title='商家加载失败' error={query.error} retry={() => { void query.refetch() }} />}
    {merchants.length > 0 && <ScrollView className='home-merchants-scroll' scrollX enhanced showScrollbar={false}>
      <View className='home-merchants-row'>
        {merchants.map((merchant) => <Button key={merchant.id} className='home-merchant'
          ariaLabel={`查看${merchant.name}详情`}
          onClick={() => navigate(`/subpackages/local/merchant/index?id=${encodeURIComponent(merchant.id)}`, '商家详情打开失败，请重试')}>
          <View className='home-merchant-logo'><MerchantLogo merchant={merchant} /></View>
          <Text className='home-merchant-name' ariaHidden>{merchant.name}</Text>
        </Button>)}
      </View>
    </ScrollView>}
  </View>
}

function MerchantLogoRow({
  children, scrollPosition, onReachEnd,
}: { children: ReactNode; scrollPosition: MutableRefObject<number>; onReachEnd: () => void }) {
  const [initialScrollLeft] = useState(() => scrollPosition.current)
  return <ScrollView className='merchant-preview-scroll' scrollX enhanced showScrollbar={false}
    scrollLeft={initialScrollLeft} lowerThreshold={80}
    onScroll={(event) => { scrollPosition.current = event.detail.scrollLeft }}
    onScrollToLower={onReachEnd}
  >
    <View className='merchant-preview-row'>{children}</View>
  </ScrollView>
}

export function CategoryMerchants({
  categoryId, keyword, visible, revision, selectedMerchant, expanded, onSelectMerchant, onClearMerchant, onToggleExpanded, scrollPosition,
}: MerchantScope & {
  visible: boolean; revision: number; selectedMerchant?: MerchantSelection; expanded: boolean
  onSelectMerchant: (merchant: MerchantSelection) => void
  onClearMerchant: () => void
  onToggleExpanded: () => void
  scrollPosition: MutableRefObject<number>
}) {
  const scope = { categoryId, keyword }
  const query = useInfiniteQuery({
    queryKey: ['catalog', 'merchant-preview', categoryId, keyword, merchantPageSize, revision],
    initialPageParam: 1,
    queryFn: ({ signal, pageParam }) => getMerchantPage(scope, pageParam, merchantPageSize, signal),
    getNextPageParam: (page) => page.page < page.total_pages ? page.page + 1 : undefined,
    enabled: visible,
    staleTime: Infinity,
  })
  const { fetchNextPage, fetchStatus, hasNextPage, isError } = query
  const pages = query.data?.pages
  const pageCount = pages?.length ?? 0
  useEffect(() => {
    if (visible && expanded && pageCount > 0 && hasNextPage && fetchStatus === 'idle' && !isError) {
      void fetchNextPage({ cancelRefetch: false })
    }
  }, [visible, expanded, pageCount, hasNextPage, fetchStatus, isError, fetchNextPage])
  const total = pages?.[pages.length - 1]?.total ?? 0
  const merchants = Array.from(new Map(pages?.flatMap((page) => page.items.map((item) => [item.id, item] as const))).values())
  const logos = merchants.map((merchant) => <MerchantLogoButton key={merchant.id} merchant={merchant}
    selected={merchant.id === selectedMerchant?.id} onSelect={() => onSelectMerchant(merchant)}
  />)

  return <>
    {query.isPending && <View className='merchant-preview-status'>
      {query.fetchStatus === 'paused' ? '等待网络连接' : '正在读取商家'}
    </View>}
    {isError && !query.isFetchNextPageError && <QueryState title='商家读取失败' error={query.error} retry={() => { void query.refetch() }} />}
    {merchants.length > 0 && <View className='merchant-preview'>
      <View className='merchant-preview-header'>
        <View className='merchant-preview-heading'><Text className='merchant-preview-title'>本类商家</Text><Text>共 {total} 家</Text></View>
        {(expanded || total > visibleMerchantCount) && <Button className='merchant-preview-more'
          ariaLabel={expanded ? '收起商家' : '显示本类全部商家'} onClick={onToggleExpanded}
        >{expanded ? '收起' : '全部'}{!expanded && <Icon name='ArrowRight' size={20} />}</Button>}
      </View>
      {expanded ? <View className='merchant-preview-grid'>{logos}</View> : <MerchantLogoRow
        scrollPosition={scrollPosition}
        onReachEnd={() => {
          if (visible && hasNextPage && fetchStatus === 'idle' && !isError) void fetchNextPage({ cancelRefetch: false })
        }}
      >{logos}</MerchantLogoRow>}
      {query.isFetchNextPageError
        ? <Button className='merchant-preview-retry' onClick={() => { void fetchNextPage({ cancelRefetch: false }) }}>加载失败，点击重试</Button>
        : hasNextPage && !isError && (expanded || query.isFetchingNextPage) && <View className='merchant-preview-loading'>
          {fetchStatus === 'paused' ? '等待网络连接' : '正在加载更多商家'}
        </View>}
    </View>}
    {selectedMerchant && <View className='merchant-preview-active'>
      <Button className='merchant-preview-selection' ariaLabel={`取消筛选${selectedMerchant.name}，显示全部商品`}
        onClick={onClearMerchant}
      >
        <Text className='merchant-preview-selection-name'>只看 {selectedMerchant.name}</Text><Icon name='Close' size={24} />
      </Button>
    </View>}
  </>
}

function MerchantDirectoryContent({ scope }: { scope: MerchantScope }) {
  const [openNow, setOpenNow] = useState(false)
  const query = useInfiniteQuery({
    queryKey: ['catalog', 'merchant-directory', scope.categoryId, scope.keyword, openNow],
    initialPageParam: 1,
    queryFn: ({ signal, pageParam }) => getMerchantPage(scope, pageParam, merchantPageSize, signal, openNow),
    getNextPageParam: (page) => page.page < page.total_pages ? page.page + 1 : undefined,
  })
  const pages = query.data?.pages
  const last = pages?.[pages.length - 1]
  const merchants = Array.from(new Map(pages?.flatMap((page) => page.items.map((item) => [item.id, item] as const))).values())
  function loadMore(retry = false) {
    if (!query.hasNextPage || query.isFetching || query.fetchStatus === 'paused' || (!retry && query.isError)) return
    void query.fetchNextPage({ cancelRefetch: false })
  }

  return <View className='merchant-directory'>
    <View className='merchant-directory-filters'>
      <Button className={`merchant-directory-filter${openNow ? '' : ' is-selected'}`} onClick={() => setOpenNow(false)}>综合</Button>
      <Button className={`merchant-directory-filter${openNow ? ' is-selected' : ''}`} onClick={() => setOpenNow(true)}>营业中</Button>
    </View>
    <ScrollView key={String(openNow)} scrollY className='merchant-directory-scroll' lowerThreshold={120}
      onScrollToLower={() => loadMore()}
    >
      <View className='merchant-directory-list'>
        {query.isPending && <QueryState title={query.fetchStatus === 'paused' ? '等待网络连接' : '正在加载商家'} />}
        {query.isError && !query.isFetchNextPageError && <QueryState
          title='加载商家失败' error={query.error} retry={() => { void query.refetch() }}
        />}
        {last && !merchants.length && !query.isError && <QueryState title={openNow ? '暂无营业中的商家' : '暂无可售商家'} />}
        {merchants.map((merchant) => <MerchantListCard key={merchant.id} merchant={merchant} />)}
        {last && merchants.length > 0 && <View className='merchant-directory-state'>
          {query.fetchStatus === 'paused' ? '等待网络连接'
            : query.isFetchNextPageError ? <Button className='merchant-directory-retry' onClick={() => loadMore(true)}>加载失败，点击重试</Button>
            : query.isFetchingNextPage ? '正在加载更多商家…'
            : query.hasNextPage ? '向下滑动加载更多'
            : `已经到底了 · 共 ${last.total} 家商家`}
        </View>}
      </View>
    </ScrollView>
  </View>
}

export function MerchantDirectoryPage() {
  const params = useRouter().params
  const scope = readScope(params.scope)
  if (!scope) return <QueryState title='商家列表链接无效' detail='请从分类页重新进入。' />
  return <MerchantDirectoryContent scope={scope} />
}
