import { useEffect, useState } from 'react'
import Taro, { useDidHide, useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { Image, Text, View } from '@tarojs/components'
import { useQuery } from '@tanstack/react-query'
import type { ResponseModelListCategoryRead, ResponseModelListPublicProductRead } from '@pinjie/api-client'
import { getPublic } from '@/lib/api'
import { queryClient } from '@/lib/query'
import { QueryState } from '@/components/QueryState'
import { Button } from '@/components/Button'
import { ProductImage } from '@/components/ProductImage'
import { HomeMerchants, homeMerchantQueryKey } from '@/features/local-commerce'
import { assetUrl } from '@/platform/media'
import { CatalogSearch } from './CatalogSearch'
import { CategoryPage } from './CategoryPage'
import { productPrice } from './domain'
import { openCategoryTab } from './navigation'
import { ProductPrices, ProductTags } from './ProductOffer'
import './home.scss'

const homeRecommendationsKey = ['catalog', 'home-recommendations'] as const

function CategoryIcon({
  url,
  className = 'category-icon',
  fallbackText,
}: {
  url?: string | null
  className?: string
  fallbackText?: string
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [url])
  if (!url || failed) {
    return fallbackText ? <View className='home-category-fallback'>{fallbackText.slice(0, 1)}</View> : null
  }
  let source: string
  try {
    source = assetUrl(url)
  } catch {
    return fallbackText ? <View className='home-category-fallback'>{fallbackText.slice(0, 1)}</View> : <Text className='muted'>图标来源无效</Text>
  }
  return <Image className={className} src={source} mode='aspectFit' webp onError={() => setFailed(true)} />
}

function HomeRecommendations({ visible }: { visible: boolean }) {
  const query = useQuery({
    queryKey: homeRecommendationsKey,
    queryFn: ({ signal }) => getPublic<ResponseModelListPublicProductRead>('/products/recommended', signal),
    enabled: visible,
    gcTime: 0,
  })
  const data = query.data
  return <View className='home-section'>
    <View className='home-section-header'><View className='home-section-title'>推荐商品</View></View>
    {query.isPending && <QueryState title={query.fetchStatus === 'paused' ? '等待网络连接' : '正在加载商品'} />}
    {query.isError && <QueryState title='商品加载失败' error={query.error} retry={() => { void query.refetch() }} />}
    {data && !query.isError && <>
      {!data.length ? <View className='state'>
        <View className='state-title'>暂无推荐商品</View>
        <Button fill='outline' type='primary' onClick={() => { void openCategoryTab({}) }}>去分类逛逛</Button>
      </View> : <View className='home-product-grid'>
        {data.map((product) => {
          const price = productPrice(product)
          return <View key={product.id} className='home-product' role='button' ariaLabel={`查看${product.name}详情`}
            onClick={() => {
              void Taro.navigateTo({ url: `/subpackages/catalog/detail/index?id=${encodeURIComponent(product.id)}` })
                .catch(() => Taro.showToast({ title: '打开商品失败，请重试', icon: 'none' }))
            }}>
            <View className='home-product-image'><ProductImage url={product.cover_thumb_url ?? product.images[0]} /></View>
            <View className='home-product-body'>
              <View className='home-product-name'>{product.name}</View>
              <ProductTags multiple={price.multiple} points={price.points} />
              <ProductPrices amount={price.amount} startsAt={price.startsAt} market={price.market} />
            </View>
          </View>
        })}
      </View>}
    </>}
  </View>
}

export function CatalogPage({ categoryMode = false, initialCategory }: { categoryMode?: boolean; initialCategory?: string }) {
  return categoryMode ? <CategoryPage initialCategory={initialCategory} /> : <HomeCatalogPage />
}

function HomeCatalogPage() {
  const [visible, setVisible] = useState(true)
  const [draft, setDraft] = useState('')
  useDidShow(() => { setVisible(true) })
  useDidHide(() => {
    setVisible(false)
    void queryClient.cancelQueries({ queryKey: homeRecommendationsKey })
    void queryClient.cancelQueries({ queryKey: homeMerchantQueryKey })
  })
  const categories = useQuery({ queryKey: ['catalog', 'categories'], queryFn: ({ signal }) => getPublic<ResponseModelListCategoryRead>('/product-categories', signal), enabled: visible })
  usePullDownRefresh(() => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: homeRecommendationsKey }),
      queryClient.invalidateQueries({ queryKey: homeMerchantQueryKey }),
      queryClient.invalidateQueries({ queryKey: ['catalog', 'categories'] }),
    ]).finally(() => Taro.stopPullDownRefresh())
  })
  const homeCategories = categories.data?.filter((item) => !item.parent_id).slice(0, 8) ?? []

  return <View className='home-catalog'>
    <CatalogSearch draft={draft} scope='全部商品' onInput={setDraft} onClear={() => setDraft('')}
      onSubmit={(value) => {
        const keyword = value.trim()
        setDraft(keyword)
        void openCategoryTab({ keyword })
      }} />
    <View className='home-catalog-content'>
      {categories.isPending && <QueryState title={categories.fetchStatus === 'paused' ? '等待网络连接' : '正在加载分类'} />}
      {categories.isError && <QueryState title='分类加载失败' error={categories.error} retry={() => { void categories.refetch() }} />}
      {categories.data && !categories.isError && <>
        {!homeCategories.length ? <View className='note'>暂无启用分类，商品上架后可在这里浏览。</View> : <View className='home-category-card'>
          <View className='home-category-grid'>
            {homeCategories.map((category) => <View key={category.id} className='home-category-item'
              onClick={() => { void openCategoryTab({ categoryId: category.id }) }}>
              <View className='home-category-icon-wrap'>
                <CategoryIcon url={category.icon_url} className='home-category-icon' fallbackText={category.name} />
              </View>
              <Text className='home-category-name'>{category.name}</Text>
            </View>)}
          </View>
        </View>}
      </>}
      <HomeMerchants visible={visible} />
      <HomeRecommendations visible={visible} />
    </View>
  </View>
}
