import { useRef, useState } from 'react'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { Button, ScrollView, Text, View } from '@tarojs/components'
import { useQuery } from '@tanstack/react-query'
import type { ResponseModelListCategoryRead } from '@pinjie/api-client'
import { QueryState } from '@/components/QueryState'
import { CategoryMerchants, type MerchantSelection } from '@/features/local-commerce'
import { getPublic } from '@/lib/api'
import { queryClient } from '@/lib/query'
import { CategoryProducts } from './CategoryProducts'
import { CatalogSearch } from './CatalogSearch'
import { categoryPath } from './domain'
import { takePendingCategorySelection } from './navigation'

export function CategoryPage({ initialCategory }: { initialCategory?: string }) {
  const [visible, setVisible] = useState(true)
  const [initialSelection] = useState(takePendingCategorySelection)
  const [selected, setSelected] = useState(initialSelection ? initialSelection.categoryId : initialCategory)
  const [merchant, setMerchant] = useState<MerchantSelection>()
  const [merchantsExpanded, setMerchantsExpanded] = useState(false)
  const merchantScrollLeft = useRef(0)
  const [draft, setDraft] = useState(initialSelection?.keyword ?? '')
  const [keyword, setKeyword] = useState(initialSelection?.keyword ?? '')
  const [revision, setRevision] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const categories = useQuery({
    queryKey: ['catalog', 'categories'],
    queryFn: ({ signal }) => getPublic<ResponseModelListCategoryRead>('/product-categories', signal),
    enabled: visible,
  })
  useDidShow(() => {
    setVisible(true)
    const pending = takePendingCategorySelection()
    if (pending) {
      setSelected(pending.categoryId)
      setMerchant(undefined)
      setMerchantsExpanded(false)
      merchantScrollLeft.current = 0
      setDraft(pending.keyword ?? '')
      setKeyword(pending.keyword ?? '')
      setRevision((value) => value + 1)
    }
  })
  useDidHide(() => {
    setVisible(false)
    void queryClient.cancelQueries({ queryKey: ['catalog', 'category-products'] })
    void queryClient.cancelQueries({ queryKey: ['catalog', 'merchant-preview'] })
  })

  const rows = categories.data ?? []
  const path = categoryPath(rows, selected)
  const root = path[0]
  const second = path[1]
  const roots = rows.filter((category) => !category.parent_id)
  const children = root ? rows.filter((category) => category.parent_id === root.id) : []
  const grandchildren = second ? rows.filter((category) => category.parent_id === second.id) : []
  const missing = Boolean(selected && !rows.some((category) => category.id === selected))
  const scope = path.map((category) => category.name).join(' / ') || (selected ? '所选分类' : '全部商品')

  function selectCategory(categoryId?: string) {
    if (categoryId === selected) return
    setSelected(categoryId)
    setMerchant(undefined)
    setMerchantsExpanded(false)
    merchantScrollLeft.current = 0
  }

  function submitSearch(value: string) {
    const next = value.trim()
    if (next !== keyword) {
      setMerchant(undefined)
      setMerchantsExpanded(false)
      merchantScrollLeft.current = 0
    }
    setDraft(next)
    setKeyword(next)
    setRevision((value) => value + 1)
    void Taro.hideKeyboard().catch(() => { void Taro.showToast({ title: '请手动收起键盘', icon: 'none' }) })
  }

  function searchAll() {
    setDraft(keyword)
    setSelected(undefined)
    setMerchant(undefined)
    setMerchantsExpanded(false)
    merchantScrollLeft.current = 0
  }

  function toggleMerchant({ id, name }: MerchantSelection) {
    setMerchant((current) => current?.id === id ? undefined : { id, name })
  }

  async function refresh() {
    if (refreshing) return
    setRefreshing(true)
    merchantScrollLeft.current = 0
    await queryClient.cancelQueries({ queryKey: ['catalog', 'category-products'] })
    await categories.refetch()
    setRevision((value) => value + 1)
    setRefreshing(false)
  }

  const filters = <>
    {children.length > 0 && <ScrollView scrollX className='category-subnav' scrollIntoView={`subcategory-${second?.id ?? 'all'}`}>
      <View className='category-subnav-items'>
        <Button id='subcategory-all' className={`category-filter ${!second ? 'is-selected' : ''}`} ariaLabel={`${root.name}全部商品`} onClick={() => selectCategory(root.id)}>全部</Button>
        {children.map((category) => <Button id={`subcategory-${category.id}`} key={category.id} className={`category-filter ${second?.id === category.id ? 'is-selected' : ''}`} onClick={() => selectCategory(category.id)}>{category.name}</Button>)}
      </View>
    </ScrollView>}
    {grandchildren.length > 0 && <ScrollView scrollX className='category-subnav' scrollIntoView={`leafcategory-${path[2]?.id ?? 'all'}`}>
      <View className='category-subnav-items'>
        <Button id='leafcategory-all' className={`category-filter ${!path[2] ? 'is-selected' : ''}`} ariaLabel={`${second.name}全部商品`} onClick={() => selectCategory(second.id)}>全部</Button>
        {grandchildren.map((category) => <Button id={`leafcategory-${category.id}`} key={category.id} className={`category-filter ${selected === category.id ? 'is-selected' : ''}`} onClick={() => selectCategory(category.id)}>{category.name}</Button>)}
      </View>
    </ScrollView>}
  </>
  return <View className='category-page'>
    <CatalogSearch draft={draft} keyword={keyword} scope={scope} onInput={setDraft} onSubmit={submitSearch} onClear={() => submitSearch('')} />
    {!categories.data ? <QueryState
      title={categories.isError ? '分类加载失败' : categories.fetchStatus === 'paused' ? '等待网络连接' : '正在加载分类'}
      error={categories.isError ? categories.error : undefined}
      retry={categories.isError ? () => { void categories.refetch() } : undefined}
    /> : <>
      {categories.isError && <View className='category-warning'>分类更新失败，当前显示上次内容。<Button className='category-text-action' onClick={() => { void categories.refetch() }}>重试</Button></View>}
      <View className='category-columns'>
        <ScrollView className='category-sidebar' scrollY scrollIntoView={`category-${root?.id ?? 'all'}`}>
          <Button id='category-all' className={`category-menu-item ${!selected ? 'is-selected' : ''}`} onClick={() => selectCategory()}>全部商品</Button>
          {roots.map((category) => <Button id={`category-${category.id}`} key={category.id}
            className={`category-menu-item ${root?.id === category.id ? 'is-selected' : ''}`}
            onClick={() => selectCategory(category.id)}>{category.name}</Button>)}
        </ScrollView>
        <View className='category-main'>
          {missing ? <QueryState title='该分类已不可用' detail='分类可能已停用，请选择其他分类。' retry={() => selectCategory()} /> : <CategoryProducts
            key={JSON.stringify([selected, keyword, merchant?.id, revision])}
            categoryId={selected} merchantId={merchant?.id} keyword={keyword} scope={scope} visible={visible} revision={revision}
            merchantPreview={<CategoryMerchants categoryId={selected} keyword={keyword} visible={visible} revision={revision}
              selectedMerchant={merchant} onSelectMerchant={toggleMerchant} onClearMerchant={() => setMerchant(undefined)}
              expanded={merchantsExpanded} onToggleExpanded={() => setMerchantsExpanded((expanded) => !expanded)}
              scrollPosition={merchantScrollLeft}
            />}
            filters={filters} refreshing={refreshing} onRefresh={() => { void refresh() }}
            clearSearch={() => submitSearch('')} searchAll={searchAll}
          />}
          {!roots.length && <Text className='category-no-categories'>暂无启用分类</Text>}
        </View>
      </View>
    </>}
  </View>
}
