import { dangerModalColors, modalColors } from '@/styles/colors'
import { useEffect, useState } from 'react'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { Button as NativeButton, Image, Text, View } from '@tarojs/components'
import { Icon } from '@/components/Icon'
import { useMutation } from '@tanstack/react-query'
import type { ConsumerCartItemRead, CartItemUpdate, ResponseModelCartItemRead, ResponseModelNoneType } from '@pinjie/api-client'
import { Button } from '@/components/Button'
import { QueryState } from '@/components/QueryState'
import { queryClient } from '@/lib/query'
import { privateRequest, useSession } from '@/lib/session'
import { beginAuthentication } from '@/lib/auth-navigation'
import { assetUrl } from '@/platform/media'
import { startCheckout } from '@/features/checkout'
import { useCart, useCartBadge } from './api'

type MerchantGroup = {
  key: string
  merchantId: string | null
  merchantName: string
  merchantLogoUrl: string | null
  items: ConsumerCartItemRead[]
  selectable: ConsumerCartItemRead[]
  selected: ConsumerCartItemRead[]
}

function toCents(price: string | null | undefined): number {
  if (!price) return 0
  const trimmed = price.trim()
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed)
  if (!match) return 0
  const whole = Number(match[1])
  const fraction = Number((match[2] ?? '').padEnd(2, '0'))
  return whole * 100 + fraction
}

function formatCents(cents: number): string {
  const safe = Math.max(0, Math.round(cents))
  const whole = Math.floor(safe / 100)
  const fraction = String(safe % 100).padStart(2, '0')
  return `${String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`
}

function formatInteger(value: number): string {
  return String(Math.max(0, Math.trunc(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function showNoticeModal(title: string, content: string) {
  void Taro.showModal({
    ...modalColors,
    title,
    content,
    showCancel: false,
    confirmText: '我知道了',
  })
}

function showActionError(title: string, error: unknown) {
  const message = error instanceof Error && error.message.trim() ? error.message.trim() : '操作未完成，请稍后重试'
  if (message.length <= 16) {
    void Taro.showToast({ title: message, icon: 'none', duration: 2400 })
    return
  }
  showNoticeModal(title, message)
}

function groupCartItems(items: ConsumerCartItemRead[]): MerchantGroup[] {
  const order: string[] = []
  const map = new Map<string, MerchantGroup>()
  for (const item of items) {
    const merchantId = item.merchant_id ?? null
    const key = merchantId ?? '__unavailable__'
    let group = map.get(key)
    if (!group) {
      group = {
        key,
        merchantId,
        merchantName: merchantId ? (item.merchant_name?.trim() || '合作商家') : '不可结算商品',
        merchantLogoUrl: merchantId ? (item.merchant_logo_url ?? null) : null,
        items: [],
        selectable: [],
        selected: [],
      }
      map.set(key, group)
      order.push(key)
    } else {
      if (!group.merchantLogoUrl && item.merchant_logo_url) group.merchantLogoUrl = item.merchant_logo_url
      if (group.merchantName === '合作商家' && item.merchant_name?.trim()) group.merchantName = item.merchant_name.trim()
    }
    group.items.push(item)
    if (merchantId && !item.invalid_reason) {
      group.selectable.push(item)
      if (item.selected) group.selected.push(item)
    }
  }
  return order.map((key) => map.get(key)!).sort((a, b) => {
    if (a.merchantId && !b.merchantId) return -1
    if (!a.merchantId && b.merchantId) return 1
    return 0
  })
}

function MerchantAvatar({ name, logoUrl }: { name: string; logoUrl?: string | null }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [logoUrl])
  let source = ''
  if (logoUrl && !failed) {
    try { source = assetUrl(logoUrl) } catch { source = '' }
  }
  const initial = Array.from(name.trim())[0] ?? '商'
  return <View className='cart-merchant-avatar'>
    {source
      ? <Image className='cart-merchant-avatar-image' src={source} mode='aspectFit' lazyLoad webp onError={() => setFailed(true)} />
      : <Text className='cart-merchant-avatar-char'>{initial}</Text>}
  </View>
}

function CartThumb({ name, url, onClick }: { name: string; url?: string | null; onClick: () => void }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [url])
  let source = ''
  if (url && !failed) {
    try { source = assetUrl(url) } catch { source = '' }
  }
  return <View className={`cart-thumb ${source ? '' : 'cart-thumb--fallback'}`} onClick={onClick}>
    {source
      ? <Image className='cart-thumb-image' src={source} mode='aspectFill' lazyLoad webp onError={() => setFailed(true)} />
      : <Text className='cart-thumb-text'>{name}</Text>}
  </View>
}

function CartEmptyState({ needsLogin = false }: { needsLogin?: boolean }) {
  const session = useSession()
  const navigation = useMutation({
    mutationFn: async () => {
      if (needsLogin) await beginAuthentication('/pages/cart/index')
      else await Taro.switchTab({ url: '/pages/home/index' })
    },
    onError: async () => {
      await Taro.showModal({
        ...modalColors,
        title: '页面打开失败',
        content: needsLogin ? '登录页面暂时无法打开，请重试。' : '首页暂时无法打开，请重试。',
        showCancel: false,
      })
    },
  })
  const busy = navigation.isPending || needsLogin && session.busy
  return <View className='cart-empty'>
    <View className='cart-empty__illustration'><Icon name='Cart' size={240} /></View>
    <Button className='cart-empty__button' type='primary' shape='round' loading={busy} disabled={busy} onClick={() => navigation.mutate()}>
      {needsLogin ? '登录' : '再逛逛'}
    </Button>
  </View>
}

export function CartBadge() {
  const session = useSession()
  const { badge, isError } = useCartBadge()
  useEffect(() => {
    const operation = session.user?.phone_bound && !isError && badge
      ? Taro.setTabBarBadge({ index: 2, text: badge })
      : Taro.removeTabBarBadge({ index: 2 })
    void operation.catch(() => { /* App startup can precede the native tab bar. */ })
  }, [badge, isError, session.user])
  return null
}

function Content() {
  const query = useCart()
  const mutation = useMutation({
    mutationFn: async (action: { item: ConsumerCartItemRead; patch?: CartItemUpdate; switchedMerchant?: boolean }) => {
      if (action.patch) {
        await privateRequest<ResponseModelCartItemRead>(`/cart-items/${action.item.id}`, { method: 'PATCH', data: action.patch })
        return action.switchedMerchant ?? false
      }
      await privateRequest<ResponseModelNoneType>(`/cart-items/${action.item.id}`, { method: 'DELETE' })
      return false
    },
    onSuccess: (switched) => {
      if (switched) void Taro.showToast({ title: '已切换结算商家', icon: 'none', duration: 1500 })
    },
    onError: (error) => showActionError('购物车更新失败', error),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['private', 'cart'] }),
  })
  const toggleGroup = useMutation({
    mutationFn: async ({ targets, nextSelected, switchedMerchant }: { targets: ConsumerCartItemRead[]; nextSelected: boolean; switchedMerchant?: boolean }) => {
      for (const item of targets) {
        if (item.selected === nextSelected) continue
        await privateRequest<ResponseModelCartItemRead>(`/cart-items/${item.id}`, {
          method: 'PATCH',
          data: { revision: item.revision, selected: nextSelected },
        })
      }
      return Boolean(nextSelected && switchedMerchant)
    },
    onSuccess: (switched) => {
      if (switched) void Taro.showToast({ title: '已切换结算商家', icon: 'none', duration: 1500 })
    },
    onError: (error) => showActionError('选择操作未完成', error),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['private', 'cart'] }),
  })
  const checkout = useMutation({
    mutationFn: async () => {
      const items = (query.data ?? []).filter((item) => item.selected && !item.invalid_reason)
      const type = items[0]?.product_type
      if (!type) {
        void Taro.showToast({ title: '请先选择要结算的商品', icon: 'none', duration: 2000 })
        return
      }
      if (items.length > 50) {
        showNoticeModal('超出单次结算上限', '单次最多支持结算 50 种商品，请取消部分商品后再试。')
        return
      }
      const merchant = items[0]?.merchant_id
      if (!merchant || items.some((item) => item.merchant_id !== merchant)) {
        showNoticeModal('请按商家分开结算', '当前已选商品属于不同商家。到店消费一单一码，仅支持同一商家的商品一起结算，请取消其他商家商品后再试。')
        return
      }
      const previews: Record<string, string> = {}
      for (const item of items) {
        if (item.image_url) previews[item.sku_id] = item.image_url
      }
      await startCheckout(
        items.map((item) => ({ sku_id: item.sku_id, quantity: item.quantity })),
        type,
        { previews, cartItemIds: items.map((item) => item.id) },
      )
    },
    onError: (error) => showActionError('无法进入结算', error),
  })
  useDidShow(() => { void query.refetch() })
  usePullDownRefresh(() => { void query.refetch().finally(() => Taro.stopPullDownRefresh()) })

  if (query.isPending) return <View className='cart-page'><QueryState title='正在读取购物车' /></View>
  if (query.isError) return <View className='cart-page'><QueryState title='购物车读取失败' error={query.error} retry={() => { void query.refetch() }} /></View>
  if (!query.data.length) return <CartEmptyState />

  const busy = mutation.isPending || toggleGroup.isPending || checkout.isPending
  const groups = groupCartItems(query.data)
  const validGroups = groups.filter((group) => group.merchantId !== null)
  const selected = query.data.filter((item) => item.selected && !item.invalid_reason)
  const selectedMerchantIds = Array.from(new Set(selected.map((item) => item.merchant_id).filter((id): id is string => !!id)))
  const activeMerchantId = selectedMerchantIds.length === 1 ? selectedMerchantIds[0] : null
  const activeGroup = (activeMerchantId ? validGroups.find((group) => group.merchantId === activeMerchantId) : null)
    ?? validGroups.find((group) => group.selectable.length > 0)
    ?? null
  const activeAllSelected = !!activeGroup && activeGroup.selectable.length > 0 && activeGroup.selected.length === activeGroup.selectable.length
  const selectedPieces = selected.reduce((total, item) => total + item.quantity, 0)
  const itemsCents = selected.reduce((total, item) => total + toCents(item.unit_price) * item.quantity, 0)
  const maxPointsTotal = selected.reduce((total, item) => total + (item.max_points_deduction ?? 0) * item.quantity, 0)
  const pointsCents = Math.min(itemsCents, maxPointsTotal * 100)
  const payableCents = Math.max(0, itemsCents - pointsCents)
  const checkoutDisabled = !selected.length || busy

  return <View className='cart-page'>
    <View className='cart-rule-bar'>
      <Icon name='Tips' className='cart-rule-icon' size={32} />
      <Text className='cart-rule-text'>到店消费一单一码，每次仅可结算同一商家的商品；勾选其他商家商品时，会自动切换结算商家。</Text>
    </View>

    <View className='cart-groups'>
      {groups.map((group) => {
        const isGroupSelectedAll = group.selectable.length > 0 && group.selected.length === group.selectable.length
        const isGroupActive = group.selected.length > 0
        const groupCheckDisabled = busy || !group.selectable.length
        const willSwitchMerchant = Boolean(group.merchantId && selectedMerchantIds.some((id) => id !== group.merchantId))
        const showBadge = group.merchantId !== null && (isGroupActive || validGroups.length > 1)
        const openMerchant = () => {
          if (group.merchantId) void Taro.navigateTo({ url: `/subpackages/local/merchant/index?id=${group.merchantId}` })
        }

        return <View className='cart-merchant-card' key={group.key}>
          <View className='cart-merchant-head'>
            <NativeButton
              className='cart-check-btn'
              ariaLabel={isGroupSelectedAll ? `取消全选 ${group.merchantName}` : `全选 ${group.merchantName}`}
              disabled={groupCheckDisabled}
              onClick={() => toggleGroup.mutate({
                targets: group.selectable,
                nextSelected: !isGroupSelectedAll,
                switchedMerchant: !isGroupSelectedAll && willSwitchMerchant,
              })}
            >
              <View className={`cart-check ${isGroupSelectedAll ? 'cart-check--active' : ''} ${groupCheckDisabled ? 'cart-check--disabled' : ''}`}>
                {isGroupSelectedAll && <Icon name='Check' className='cart-check-icon' size={26} />}
              </View>
            </NativeButton>
            <View className='cart-merchant-info' onClick={openMerchant}>
              <MerchantAvatar name={group.merchantName} logoUrl={group.merchantLogoUrl} />
              <Text className='cart-merchant-name'>{group.merchantName}</Text>
              {group.merchantId && <Icon name='ArrowRight' className='cart-merchant-arrow' size={26} />}
            </View>
            {showBadge && (
              <Text className={`cart-merchant-badge ${isGroupActive ? 'cart-merchant-badge--active' : ''}`}>
                {isGroupActive ? '本次结算' : '需单独结算'}
              </Text>
            )}
          </View>

          <View className='cart-merchant-items'>
            {group.items.map((item) => {
              const specText = Object.values(item.specifications).join(' · ') || '默认规格'
              const lineMaxPoints = (item.max_points_deduction ?? 0) * item.quantity
              const checkDisabled = busy || (!!item.invalid_reason && !item.selected)
              const minusDisabled = busy || item.quantity <= 1 || item.available_quantity < 1
              const plusDisabled = busy || !!item.invalid_reason || item.quantity >= Math.min(999, item.available_quantity)
              const openDetail = () => {
                if (item.product_id) void Taro.navigateTo({ url: `/subpackages/catalog/detail/index?id=${item.product_id}` })
              }
              const confirmDelete = () => {
                void Taro.showModal({
                  ...dangerModalColors,
                  title: '移除商品',
                  content: `确认从购物车移除 ${item.product_name}？`,
                }).then((result) => {
                  if (result.confirm) mutation.mutate({ item })
                })
              }
              const nextSelected = !item.selected
              return <View className='cart-item' key={item.id}>
                <NativeButton
                  className='cart-check-btn'
                  ariaLabel={item.selected ? `取消选择 ${item.product_name}` : `选择 ${item.product_name}`}
                  disabled={checkDisabled}
                  onClick={() => mutation.mutate({
                    item,
                    patch: { revision: item.revision, selected: nextSelected },
                    switchedMerchant: nextSelected && willSwitchMerchant,
                  })}
                >
                  <View className={`cart-check ${item.selected ? 'cart-check--active' : ''} ${checkDisabled ? 'cart-check--disabled' : ''}`}>
                    {item.selected && <Icon name='Check' className='cart-check-icon' size={26} />}
                  </View>
                </NativeButton>
                <CartThumb name={item.product_name} url={item.image_url} onClick={openDetail} />
                <View className='cart-card-body'>
                  <View className='cart-card-top'>
                    <View className='cart-card-name' onClick={openDetail}>{item.product_name}</View>
                    <NativeButton
                      className='cart-delete-btn'
                      ariaLabel={`移除 ${item.product_name}`}
                      disabled={busy}
                      onClick={confirmDelete}
                    >
                      <Icon name='Del' size={34} />
                    </NativeButton>
                  </View>
                  <View className='cart-card-tags'>
                    <Text className='cart-tag cart-tag--spec'>{specText}</Text>
                    {lineMaxPoints > 0 && <View className='cart-tag cart-tag--points'>
                      <Icon name='Jingdou' className='cart-tag-icon' size={22} />
                      <Text>最高抵 {formatInteger(lineMaxPoints)} 积分</Text>
                    </View>}
                  </View>
                  {item.invalid_reason && <View className='cart-invalid-note'>{item.invalid_reason}</View>}
                  <View className='cart-card-bottom'>
                    {item.unit_price == null
                      ? <Text className='cart-price-unavailable'>当前不可售</Text>
                      : <View className='cart-price'>
                          <Text className='cart-price-symbol'>¥</Text>
                          <Text className='cart-price-value'>{item.unit_price}</Text>
                        </View>}
                    <View className='cart-stepper'>
                      <NativeButton
                        className={`cart-stepper-btn ${minusDisabled ? 'cart-stepper-btn--disabled' : ''}`}
                        ariaLabel='减少数量'
                        disabled={minusDisabled}
                        onClick={() => mutation.mutate({
                          item,
                          patch: { revision: item.revision, quantity: Math.min(item.quantity - 1, item.available_quantity, 999) },
                        })}
                      >
                        <Icon name='Minus' size={24} />
                      </NativeButton>
                      <Text className='cart-stepper-value'>{item.quantity}</Text>
                      <NativeButton
                        className={`cart-stepper-btn ${plusDisabled ? 'cart-stepper-btn--disabled' : ''}`}
                        ariaLabel='增加数量'
                        disabled={plusDisabled}
                        onClick={() => mutation.mutate({ item, patch: { revision: item.revision, quantity: item.quantity + 1 } })}
                      >
                        <Icon name='Plus' size={24} />
                      </NativeButton>
                    </View>
                  </View>
                </View>
              </View>
            })}
          </View>
        </View>
      })}
    </View>

    <View className='cart-footer'>
      {selected.length > 0 && <View className='cart-summary-bar'>
        <View className='cart-summary-left'>
          <Text className='cart-summary-label'>商品合计</Text>
          <Text className='cart-summary-total'>¥{formatCents(itemsCents)}</Text>
        </View>
        <View className='cart-summary-right'>
          {maxPointsTotal > 0 ? <>
            <Text className='cart-summary-label'>积分最多可抵</Text>
            <Text className='cart-summary-points'>{formatInteger(maxPointsTotal)} 积分 · −¥{formatCents(pointsCents)}</Text>
          </> : <Text className='cart-summary-label'>暂无积分抵扣</Text>}
        </View>
      </View>}
      <View className='cart-footer-bar'>
        <NativeButton
          className='cart-select-all'
          disabled={busy || !activeGroup?.selectable.length}
          onClick={() => {
            if (!activeGroup) return
            toggleGroup.mutate({ targets: activeGroup.selectable, nextSelected: !activeAllSelected })
          }}
        >
          <View className={`cart-check ${activeAllSelected ? 'cart-check--active' : ''} ${!activeGroup?.selectable.length ? 'cart-check--disabled' : ''}`}>
            {activeAllSelected && <Icon name='Check' className='cart-check-icon' size={26} />}
          </View>
          <Text className='cart-select-all-label'>{validGroups.length > 1 ? '全选本店' : '全选'}</Text>
        </NativeButton>
        <View className='cart-footer-summary'>
          <Text className='cart-footer-hint'>预计应付（已选 {selectedPieces} 件）</Text>
          <View className='cart-footer-payable'>
            <Text className='cart-footer-symbol'>¥</Text>
            <Text className='cart-footer-amount'>{formatCents(payableCents)}</Text>
          </View>
        </View>
        <NativeButton
          className={`cart-checkout-btn ${checkoutDisabled ? 'cart-checkout-btn--disabled' : ''}`}
          disabled={checkoutDisabled}
          loading={checkout.isPending}
          onClick={() => checkout.mutate()}
        >
          {selectedPieces > 0 ? `去结算 (${selectedPieces})` : '去结算'}
        </NativeButton>
      </View>
    </View>
  </View>
}

export function CartPage() {
  const session = useSession()
  return session.user?.phone_bound ? <Content /> : <CartEmptyState needsLogin />
}
