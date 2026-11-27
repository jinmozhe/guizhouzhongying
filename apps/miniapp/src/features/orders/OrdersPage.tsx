import { colors, dangerModalColors, modalColors } from '@/styles/colors'
import { useCallback, useEffect, useState } from 'react'
import Taro, { useDidHide, useDidShow, usePullDownRefresh, useReachBottom, useRouter } from '@tarojs/taro'
import { Button as NativeButton, Image, Text, View } from '@tarojs/components'
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import type {
  ConsumerTradeOrderRead,
  ResponseModelConsumerOrderSummaryRead,
  ResponseModelConsumerTradeOrderRead,
  ResponseModelFulfillmentRead,
  ResponseModelOrderRead,
  ResponseModelPageResultConsumerRefundRead,
  ResponseModelPageResultConsumerTradeOrderRead,
  ResponseModelPublicMerchantDetailRead,
  ResponseModelVoucherRead,
} from '@pinjie/api-client'
import { AuthGate } from '@/components/AuthGate'
import { Button } from '@/components/Button'
import { Icon } from '@/components/Icon'
import { QueryState } from '@/components/QueryState'
import { ApiError, getPublic } from '@/lib/api'
import { privateRequest, sessionScope, useSession } from '@/lib/session'
import { queryClient } from '@/lib/query'
import { assetUrl } from '@/platform/media'
import { startCheckout } from '@/features/checkout'
import { useOrderPayment } from './PaymentPanel'
import { WechatReceipt } from './WechatReceipt'
import { Voucher } from '@/features/local-commerce'
import './order-detail.scss'
import './order-list.scss'

type MerchantInfo = {
  id: string | null
  name: string
  logoUrl: string | null
  address: string
  businessHours: string
  publicPhone: string
  latitude: number | null
  longitude: number | null
  isActive: boolean
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

function formatDateTimeMinute(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

function formatVoucherRemain(expiresAt: string, nowMs: number): string {
  const target = Date.parse(expiresAt)
  if (!Number.isFinite(target)) return ''
  const diffMs = target - nowMs
  if (diffMs <= 0) return '已到期'
  const dayMs = 24 * 60 * 60 * 1000
  if (diffMs >= dayMs) {
    const days = Math.min(7, Math.ceil(diffMs / dayMs))
    return `还剩 ${days} 天`
  }
  const hours = Math.max(1, Math.ceil(diffMs / (60 * 60 * 1000)))
  return `还剩 ${hours} 小时`
}

function formatHourMinute(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

function formatHourMinuteSecond(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

function formatInteger(value: number): string {
  return String(Math.max(0, Math.trunc(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function pickProductGlyph(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '商'
  const cjkChars = trimmed.match(/[\u4e00-\u9fff]/g)
  if (cjkChars?.length) return cjkChars[cjkChars.length - 1]
  return Array.from(trimmed)[0] ?? '商'
}

function readStringField(record: Record<string, unknown> | null | undefined, key: string): string {
  const value = record?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function readNumberField(record: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function extractMerchantSnapshot(order: ConsumerTradeOrderRead): MerchantInfo | null {
  const snapshot = order.merchant_snapshot
  const name = readStringField(snapshot, 'name')
  if (!order.merchant_id && !name) return null
  return {
    id: order.merchant_id,
    name: name || '到店商家',
    logoUrl: readStringField(snapshot, 'logo_url') || null,
    address: readStringField(snapshot, 'address'),
    businessHours: readStringField(snapshot, 'business_hours'),
    publicPhone: readStringField(snapshot, 'public_phone'),
    latitude: readNumberField(snapshot, 'latitude'),
    longitude: readNumberField(snapshot, 'longitude'),
    isActive: typeof snapshot?.is_active === 'boolean' ? snapshot.is_active : true,
  }
}

function PendingMerchantCard({ order }: { order: ConsumerTradeOrderRead }) {
  const fallback = extractMerchantSnapshot(order)
  const merchantId = order.merchant_id ?? ''
  const [logoFailed, setLogoFailed] = useState(false)
  const merchantQuery = useQuery({
    queryKey: ['merchant-public', merchantId],
    enabled: !!merchantId,
    queryFn: ({ signal }) => getPublic<ResponseModelPublicMerchantDetailRead>(`/merchants/${merchantId}`, signal),
  })
  const live = merchantQuery.data
  const merchant: MerchantInfo | null = live
    ? {
      id: live.id,
      name: live.name.trim() || fallback?.name || '到店商家',
      logoUrl: live.logo_url ?? fallback?.logoUrl ?? null,
      address: live.address.trim() || fallback?.address || '',
      businessHours: live.business_hours.trim() || fallback?.businessHours || '',
      publicPhone: live.public_phone.trim() || fallback?.publicPhone || '',
      latitude: typeof live.latitude === 'number' ? live.latitude : fallback?.latitude ?? null,
      longitude: typeof live.longitude === 'number' ? live.longitude : fallback?.longitude ?? null,
      isActive: live.is_active,
    }
    : fallback
  const logoRaw = merchant?.logoUrl ?? ''
  useEffect(() => { setLogoFailed(false) }, [logoRaw])
  if (!merchant) return null
  let logoSource = ''
  if (logoRaw && !logoFailed) {
    try { logoSource = assetUrl(logoRaw) } catch { logoSource = '' }
  }
  const hasLocation = typeof merchant.latitude === 'number' && typeof merchant.longitude === 'number'
  const hasPhone = !!merchant.publicPhone
  const openMerchant = () => {
    if (!merchant.id) return
    void Taro.navigateTo({ url: `/subpackages/local/merchant/index?id=${encodeURIComponent(merchant.id)}` })
      .catch(() => Taro.showToast({ title: '商家详情打开失败，请重试', icon: 'none' }))
  }
  return <View className='order-pending-card'>
    <View className='order-merchant-head' onClick={openMerchant}>
      <View className='order-merchant-logo-box'>
        {logoSource
          ? <Image className='order-merchant-logo-image' src={logoSource} mode='aspectFit' webp onError={() => setLogoFailed(true)} />
          : <View className='order-merchant-logo-fallback'>{Array.from(merchant.name)[0] ?? '商'}</View>}
      </View>
      <View className='order-merchant-main'>
        <View className='order-merchant-title-row'>
          <Text className='order-merchant-name'>{merchant.name}</Text>
          <Text className={`order-merchant-badge ${merchant.isActive ? 'order-merchant-badge--open' : 'order-merchant-badge--closed'}`}>
            {merchant.isActive ? '营业中' : '暂停服务'}
          </Text>
        </View>
        {merchant.address && <View className='order-merchant-meta'>
          <Icon name='Location' className='order-merchant-meta-icon' size={26} />
          <Text className='order-merchant-meta-text'>{merchant.address}</Text>
        </View>}
      </View>
    </View>
    {merchant.businessHours && <View className='order-merchant-meta order-merchant-hours'>
      <Icon name='Clock' className='order-merchant-meta-icon' size={26} />
      <Text className='order-merchant-meta-text'>营业时间 {merchant.businessHours}</Text>
    </View>}
    {(hasLocation || hasPhone) && <View className='order-merchant-actions'>
      {hasLocation && <NativeButton
        className='order-merchant-btn'
        onClick={() => {
          void Taro.openLocation({
            latitude: merchant.latitude as number,
            longitude: merchant.longitude as number,
            name: merchant.name,
            address: merchant.address,
          }).catch(() => Taro.showToast({ title: '地图打开失败，请重试', icon: 'none' }))
        }}
      >
        <Icon name='Location' className='order-merchant-btn-icon' size={28} />
        <Text>导航</Text>
      </NativeButton>}
      {hasPhone && <NativeButton
        className='order-merchant-btn'
        onClick={() => {
          void Taro.makePhoneCall({ phoneNumber: merchant.publicPhone })
            .catch(() => Taro.showToast({ title: '拨号未完成，可重新点击', icon: 'none' }))
        }}
      >
        <Icon name='Phone' className='order-merchant-btn-icon' size={28} />
        <Text>联系商家</Text>
      </NativeButton>}
    </View>}
  </View>
}

function PendingOrderDetail({ order, refreshOrder }: { order: ConsumerTradeOrderRead; refreshOrder: () => Promise<unknown> }) {
  const { pay, attempt, blocked, notice, statusText, buttonText } = useOrderPayment(order.id, refreshOrder)
  const deadlineTime = formatHourMinute(order.expires_at)
  const showFreight = order.fulfillment_mode !== 'local' || Number(order.freight_amount) > 0
  const descModifier = attempt?.status === 'succeeded'
    ? ' order-pay-method-desc--success'
    : attempt?.status === 'created' || attempt?.status === 'unknown'
      ? ' order-pay-method-desc--warning'
      : ''

  return <View className='order-pending-page'>
    <View className='order-pending-banner'>
      <View className='order-pending-banner-title'>
        <Icon name='Clock' className='order-pending-banner-icon' size={42} />
        <Text>待付款</Text>
      </View>
      <View className='order-pending-banner-sub'>
        {deadlineTime ? `请在 ${deadlineTime} 前完成微信支付，超时订单将自动关闭` : '请尽快完成微信支付，超时订单将自动关闭'}
      </View>
    </View>

    {order.fulfillment_mode === 'local' && <PendingMerchantCard order={order} />}

    <View className='order-pending-card'>
      {order.items.map((item) => {
        const specText = Object.values(item.specifications).join(' · ') || '默认规格'
        return <View className='order-goods-row' key={item.id}>
          <View className='order-goods-glyph'>{pickProductGlyph(item.product_name)}</View>
          <View className='order-goods-body'>
            <View className='order-goods-name'>{item.product_name}</View>
            <View className='order-goods-sub'>
              <Text className='order-goods-spec'>{specText}</Text>
              <Text className='order-goods-qty'>× {item.quantity} 件</Text>
            </View>
          </View>
          <View className='order-goods-price'>¥{item.line_amount}</View>
        </View>
      })}
    </View>

    <View className='order-pending-card'>
      <View className='order-summary-row'>
        <Text className='order-summary-label'>商品金额</Text>
        <Text className='order-summary-value'>¥{order.items_amount}</Text>
      </View>
      {showFreight && <View className='order-summary-row'>
        <Text className='order-summary-label'>运费</Text>
        <Text className='order-summary-value'>¥{order.freight_amount}</Text>
      </View>}
      <View className='order-summary-row'>
        <Text className='order-summary-label'>积分抵扣</Text>
        {order.points_deduction > 0
          ? <Text className='order-summary-points-badge'>已抵扣 {formatInteger(order.points_deduction)} 积分</Text>
          : <Text className='order-summary-label'>未使用积分</Text>}
      </View>
      <View className='order-summary-divider' />
      <View className='order-summary-total'>
        <Text className='order-summary-total-label'>微信应付</Text>
        <View className='order-summary-payable'>
          <Text className='order-summary-payable-symbol'>¥</Text>
          <Text className='order-summary-payable-value'>{order.total_amount}</Text>
        </View>
      </View>
    </View>

    <View className='order-pending-card'>
      <View
        className='order-info-row'
        onClick={() => {
          void Taro.setClipboardData({ data: order.id })
            .catch(() => undefined)
        }}
      >
        <Text className='order-info-label'>订单号</Text>
        <Text className='order-info-value'>{order.id}</Text>
      </View>
      <View className='order-info-row'>
        <Text className='order-info-label'>创建时间</Text>
        <Text className='order-info-value'>{formatDateTime(order.created_at)}</Text>
      </View>
      <View className='order-info-row'>
        <Text className='order-info-label'>付款截止</Text>
        <Text className='order-info-value order-info-value--deadline'>{formatDateTime(order.expires_at)}</Text>
      </View>
    </View>

    <View className='order-pending-card'>
      <View className='order-pay-card-title'>支付方式</View>
      <View className='order-pay-method'>
        <View className='order-pay-method-icon-box'>
          <Icon name='Weixin' size={36} />
        </View>
        <View className='order-pay-method-body'>
          <Text className='order-pay-method-name'>微信支付</Text>
          <Text className={`order-pay-method-desc${descModifier}`}>{statusText}</Text>
        </View>
        <View className='order-pay-method-check'>
          <Icon name='Check' size={26} />
        </View>
      </View>
      {notice && <View className='order-pay-notice'>{notice}</View>}
    </View>

    <View className='order-pending-tip-box'>
      未核销可随时申请整单自动退款；成交确认七天未使用将自动退款。付款、关单及到期状态以服务端为准。
    </View>

    <View className='order-pending-footer'>
      <View className='order-pending-footer-amount'>
        <Text className='order-pending-footer-label'>微信应付</Text>
        <View className='order-pending-footer-price'>
          <Text className='order-pending-footer-symbol'>¥</Text>
          <Text className='order-pending-footer-value'>{order.total_amount}</Text>
        </View>
      </View>
      <NativeButton
        className={`order-pending-pay-btn ${blocked ? 'order-pending-pay-btn--disabled' : ''}`}
        disabled={blocked}
        loading={pay.isPending}
        onClick={() => pay.mutate()}
      >
        {buttonText}
      </NativeButton>
    </View>
  </View>
}

function useMerchantDetailInfo(order: ConsumerTradeOrderRead) {
  const fallback = extractMerchantSnapshot(order)
  const merchantId = order.merchant_id ?? ''
  const merchantQuery = useQuery({
    queryKey: ['merchant-public', merchantId],
    enabled: !!merchantId,
    queryFn: ({ signal }) => getPublic<ResponseModelPublicMerchantDetailRead>(`/merchants/${merchantId}`, signal),
  })
  const live = merchantQuery.data
  if (!live) return fallback
  return {
    id: live.id,
    name: live.name.trim() || fallback?.name || '到店商家',
    logoUrl: live.logo_url ?? fallback?.logoUrl ?? null,
    address: live.address.trim() || fallback?.address || '',
    businessHours: live.business_hours.trim() || fallback?.businessHours || '',
    publicPhone: live.public_phone.trim() || fallback?.publicPhone || '',
    latitude: typeof live.latitude === 'number' ? live.latitude : fallback?.latitude ?? null,
    longitude: typeof live.longitude === 'number' ? live.longitude : fallback?.longitude ?? null,
    isActive: live.is_active,
  }
}

function VerifyMerchantCard({ order }: { order: ConsumerTradeOrderRead }) {
  const merchant = useMerchantDetailInfo(order)
  const [logoFailed, setLogoFailed] = useState(false)
  const logoRaw = merchant?.logoUrl ?? ''
  useEffect(() => { setLogoFailed(false) }, [logoRaw])
  if (!merchant) return null
  let logoSource = ''
  if (logoRaw && !logoFailed) {
    try { logoSource = assetUrl(logoRaw) } catch { logoSource = '' }
  }
  const hasLocation = typeof merchant.latitude === 'number' && typeof merchant.longitude === 'number'
  const hasPhone = !!merchant.publicPhone
  const openMerchant = () => {
    if (!merchant.id) return
    void Taro.navigateTo({ url: `/subpackages/local/merchant/index?id=${encodeURIComponent(merchant.id)}` })
      .catch(() => Taro.showToast({ title: '商家详情打开失败，请重试', icon: 'none' }))
  }

  return <View className='order-pending-card'>
    <View className='order-verify-merchant-top'>
      <View className='order-verify-merchant-left' onClick={openMerchant}>
        <View className='order-verify-merchant-logo'>
          {logoSource
            ? <Image className='order-merchant-logo-image' src={logoSource} mode='aspectFit' webp onError={() => setLogoFailed(true)} />
            : <View className='order-merchant-logo-fallback'>{Array.from(merchant.name)[0] ?? '商'}</View>}
        </View>
        <View className='order-verify-merchant-info'>
          <View className='order-merchant-title-row'>
            <Text className='order-merchant-name'>{merchant.name}</Text>
            <Text className={`order-merchant-badge ${merchant.isActive ? 'order-merchant-badge--open' : 'order-merchant-badge--closed'}`}>
              {merchant.isActive ? '营业中' : '暂停服务'}
            </Text>
          </View>
          {merchant.businessHours && <Text className='order-verify-merchant-hours'>营业时间 {merchant.businessHours}</Text>}
        </View>
      </View>
      {(hasLocation || hasPhone) && <>
        <View className='order-verify-merchant-sep' />
        <View className='order-verify-merchant-actions'>
          {hasLocation && <View
            className='order-verify-merchant-action'
            onClick={() => {
              void Taro.openLocation({
                latitude: merchant.latitude as number,
                longitude: merchant.longitude as number,
                name: merchant.name,
                address: merchant.address,
              }).catch(() => Taro.showToast({ title: '地图打开失败，请重试', icon: 'none' }))
            }}
          >
            <Icon name='Location' size={32} />
            <Text>导航</Text>
          </View>}
          {hasPhone && <View
            className='order-verify-merchant-action'
            onClick={() => {
              void Taro.makePhoneCall({ phoneNumber: merchant.publicPhone })
                .catch(() => Taro.showToast({ title: '拨号未完成，可重新点击', icon: 'none' }))
            }}
          >
            <Icon name='Phone' size={32} />
            <Text>电话</Text>
          </View>}
        </View>
      </>}
    </View>
    {merchant.address && <View className='order-verify-merchant-address'>
      <Icon name='Location' className='order-merchant-meta-icon' size={26} />
      <Text className='order-merchant-meta-text'>{merchant.address}</Text>
    </View>}
  </View>
}

const voucherStatusLabel: Record<string, string> = {
  available: '待核销',
  expired: '已到期',
  redeemed: '已核销',
  refunding: '退款中',
  refunded: '已退款',
}

function VerifyOrderDetail({ order, refreshOrder }: { order: ConsumerTradeOrderRead; refreshOrder: () => Promise<unknown> }) {
  const session = useSession()
  const [nowMs, setNowMs] = useState(() => Date.now())
  const voucherQuery = useQuery({
    queryKey: ['private', 'redemption', session.epoch, order.id],
    gcTime: 0,
    queryFn: ({ signal }) => privateRequest<ResponseModelVoucherRead>(`/orders/${order.id}/redemption`, { signal }),
  })

  // 进入待核销订单详情时将原生导航栏切换为深钴蓝配白字，离页时恢复默认白底黑字
  useEffect(() => {
    void Taro.setNavigationBarColor({ frontColor: '#ffffff', backgroundColor: colors.primary }).catch(() => undefined)
    return () => {
      void Taro.setNavigationBarColor({ frontColor: '#000000', backgroundColor: colors.surface }).catch(() => undefined)
    }
  }, [])

  useDidShow(() => {
    setNowMs(Date.now())
    void voucherQuery.refetch()
  })

  const voucher = voucherQuery.data
  const expired = !!voucher && Date.parse(voucher.expires_at) <= nowMs
  const effectiveStatus = voucher ? (expired && voucher.status === 'available' ? 'expired' : voucher.status) : 'available'
  const statusText = voucherStatusLabel[effectiveStatus] ?? effectiveStatus
  const statusPillClass = effectiveStatus === 'redeemed' || effectiveStatus === 'refunded'
    ? 'order-voucher-status-pill--success'
    : effectiveStatus === 'expired' || effectiveStatus === 'refunding'
      ? 'order-voucher-status-pill--warning'
      : 'order-voucher-status-pill--info'
  const remainText = voucher ? formatVoucherRemain(voucher.expires_at, nowMs) : ''
  const showQr = !!voucher && voucher.status === 'available' && !expired && !!voucher.qr_data_url
  const refreshing = voucherQuery.isFetching

  const handleRefresh = () => {
    if (refreshing) return
    setNowMs(Date.now())
    void Promise.all([voucherQuery.refetch(), refreshOrder()])
      .then(() => Taro.showToast({ title: '核销状态已刷新', icon: 'none', duration: 1500 }).catch(() => undefined))
      .catch(() => undefined)
  }

  return <View className='order-verify-page'>
    <View className='order-verify-hero'>
      <View className='order-voucher-ticket'>
        <View className='order-voucher-top'>
          <View className='order-voucher-head'>
            <View className='order-voucher-title-group'>
              <Icon name='ShieldCheck' size={38} />
              <Text>{statusText}</Text>
            </View>
            {remainText && <Text className='order-voucher-remain'>{remainText}</Text>}
          </View>

          <View className='order-voucher-qr-wrap'>
            {voucherQuery.isPending ? (
              <View className='order-voucher-qr-placeholder'>正在读取核销二维码…</View>
            ) : voucherQuery.isError ? (
              <View className='order-voucher-qr-placeholder' onClick={handleRefresh}>
                核销凭证读取失败，点击重试
              </View>
            ) : showQr ? (
              <Image className='order-voucher-qr' src={voucher.qr_data_url as string} mode='aspectFit' />
            ) : (
              <View className='order-voucher-qr-placeholder'>
                {effectiveStatus === 'expired'
                  ? '凭证已到期，等待系统自动退款'
                  : effectiveStatus === 'refunding'
                    ? '整单退款处理中'
                    : '当前状态无需出示核销码'}
              </View>
            )}
            <View className='order-voucher-hint'>
              <View>到店出示二维码，商家扫码即可核销</View>
              <View>请勿提前泄露给他人</View>
            </View>
          </View>
        </View>

        <View className='order-voucher-divider'>
          <View className='order-voucher-dashed' />
        </View>

        <View className='order-voucher-meta'>
          <View className='order-voucher-row'>
            <Text className='order-voucher-label'>有效期至</Text>
            <Text className='order-voucher-value'>{voucher ? formatDateTimeMinute(voucher.expires_at) : '加载中…'}</Text>
          </View>
          <View className='order-voucher-row'>
            <Text className='order-voucher-label'>核销方式</Text>
            <Text className='order-voucher-value'>商家扫码 · 整单一次核销</Text>
          </View>
          <View className='order-voucher-row'>
            <Text className='order-voucher-label'>核销状态</Text>
            <View className='order-voucher-status-wrap'>
              <Text className={`order-voucher-status-pill ${statusPillClass}`}>{statusText}</Text>
              <View
                className={`order-voucher-refresh ${refreshing ? 'order-voucher-refresh--busy' : ''}`}
                onClick={handleRefresh}
              >
                <Icon name='Refresh' size={32} />
              </View>
            </View>
          </View>
        </View>
      </View>

      <View className='order-verify-hero-footer'>
        <View className='order-verify-hero-tip'>
          <View>未核销可随时申请整单自动退款；</View>
          <View>7 天未使用将自动退回原积分及现金。</View>
        </View>
        <NativeButton
          className='order-verify-refund-btn'
          onClick={() => {
            void Taro.navigateTo({ url: `/subpackages/service/refund-apply/index?orderId=${order.id}` })
              .catch(() => Taro.showToast({ title: '退款页面打开失败，请重试', icon: 'none' }))
          }}
        >
          {order.can_refund ? '申请整单退款' : '退款进度'}
        </NativeButton>
      </View>
    </View>

    <View className='order-verify-body'>
      <VerifyMerchantCard order={order} />

      <View className='order-pending-card'>
        {order.items.map((item) => {
          const specText = Object.values(item.specifications).join(' · ') || '默认规格'
          return <View className='order-goods-row' key={item.id}>
            <View className='order-goods-glyph'>{pickProductGlyph(item.product_name)}</View>
            <View className='order-goods-body'>
              <View className='order-goods-name'>{item.product_name}</View>
              <View className='order-goods-sub'>
                <Text className='order-goods-spec'>{specText}</Text>
                <Text className='order-goods-qty'>× {item.quantity} 件</Text>
              </View>
            </View>
            <View className='order-goods-price'>¥{item.line_amount}</View>
          </View>
        })}
      </View>

      <View className='order-pending-card'>
        <View className='order-summary-row'>
          <Text className='order-summary-label'>商品金额</Text>
          <Text className='order-summary-value'>¥{order.items_amount}</Text>
        </View>
        <View className='order-summary-row'>
          <Text className='order-summary-label'>积分抵扣</Text>
          {order.points_deduction > 0
            ? <Text className='order-summary-points-badge'>已抵扣 {formatInteger(order.points_deduction)} 积分</Text>
            : <Text className='order-summary-label'>未使用积分</Text>}
        </View>
        <View className='order-summary-divider' />
        <View className='order-summary-total'>
          <Text className='order-summary-total-label'>微信实付</Text>
          <View className='order-summary-payable'>
            <Text className='order-summary-payable-symbol'>¥</Text>
            <Text className='order-summary-payable-value'>{order.total_amount}</Text>
          </View>
        </View>
      </View>

      <View className='order-pending-card'>
        <View
          className='order-info-row'
          onClick={() => {
            void Taro.setClipboardData({ data: order.id }).catch(() => undefined)
          }}
        >
          <Text className='order-info-label'>订单号</Text>
          <Text className='order-info-value'>{order.id}</Text>
        </View>
        <View className='order-info-row'>
          <Text className='order-info-label'>创建时间</Text>
          <Text className='order-info-value'>{formatDateTime(order.created_at)}</Text>
        </View>
        {order.paid_at && <View className='order-info-row'>
          <Text className='order-info-label'>成交时间</Text>
          <Text className='order-info-value'>{formatDateTime(order.paid_at)}</Text>
        </View>}
        <View className='order-verified-fact'>
          <View className='order-verified-fact-badge'>
            <Icon name='Check' size={18} />
          </View>
          <Text>{order.settlement_kind === 'zero_amount' ? '服务端零金额成交，无渠道付款' : '服务端已确认成交'}</Text>
        </View>
      </View>
    </View>
  </View>
}

function CompletedOrderDetail({ order }: { order: ConsumerTradeOrderRead }) {
  // 进入已完成（已核销）订单详情时同步原生导航栏为深钴蓝白字，离页恢复白底黑字
  useEffect(() => {
    void Taro.setNavigationBarColor({ frontColor: '#ffffff', backgroundColor: colors.primary }).catch(() => undefined)
    return () => {
      void Taro.setNavigationBarColor({ frontColor: '#000000', backgroundColor: colors.surface }).catch(() => undefined)
    }
  }, [])

  const reorder = useMutation({
    mutationFn: async () => {
      const items = order.items.map((item) => ({ sku_id: item.sku_id, quantity: item.quantity }))
      if (!items.length) throw new Error('原订单商品信息为空，无法再来一单')
      const productType = order.product_type === 'virtual' ? 'virtual' : 'physical'
      await startCheckout(items, productType)
    },
    onError: (error) => {
      showOrderErrorModal('无法再来一单', error, '原商品可能已下架或库存不足，请重新选购')
    },
  })

  const reviewTargets = order.item_reviews.filter((item) => item.can_review || item.review)
  const hasPendingReview = reviewTargets.some((item) => item.can_review && !item.review)
  const redeemedTime = order.fulfillment?.delivered_at ?? order.paid_at ?? order.created_at

  const openReview = () => {
    if (!reviewTargets.length) return
    if (reviewTargets.length === 1) {
      void Taro.navigateTo({ url: `/subpackages/service/review/index?orderId=${order.id}&itemId=${reviewTargets[0].order_item_id}` })
        .catch(() => Taro.showToast({ title: '评价页面打开失败，请重试', icon: 'none' }))
      return
    }
    const labels = reviewTargets.map((item) => {
      const name = order.items.find((line) => line.id === item.order_item_id)?.product_name ?? '订单商品'
      return `${name}（${item.review ? '查看评价' : '去评价'}）`
    })
    void Taro.showActionSheet({ itemList: labels })
      .then((res) => {
        const picked = reviewTargets[res.tapIndex]
        if (!picked) return
        void Taro.navigateTo({ url: `/subpackages/service/review/index?orderId=${order.id}&itemId=${picked.order_item_id}` })
          .catch(() => Taro.showToast({ title: '评价页面打开失败，请重试', icon: 'none' }))
      })
      .catch(() => undefined)
  }

  return <View className='order-verify-page'>
    <View className='order-verify-hero'>
      <View className='order-voucher-ticket'>
        <View className='order-voucher-top'>
          <View className='order-voucher-head'>
            <View className='order-voucher-title-group order-voucher-title-group--success'>
              <Icon name='ShieldCheck' size={38} />
              <Text>已完成</Text>
            </View>
            <Text className='order-voucher-status-pill order-voucher-status-pill--success'>已核销</Text>
          </View>

          <View className='order-completed-badge-wrap'>
            <View className='order-completed-circle-outer'>
              <View className='order-completed-circle-inner'>
                <Icon name='Check' size={60} />
              </View>
            </View>
            <View className='order-completed-title'>订单已核销</View>
            <View className='order-completed-sub'>感谢光临，期待您再次到店</View>
          </View>
        </View>

        <View className='order-voucher-divider'>
          <View className='order-voucher-dashed' />
        </View>

        <View className='order-voucher-meta'>
          <View className='order-voucher-row'>
            <Text className='order-voucher-label'>核销时间</Text>
            <Text className='order-voucher-value'>{formatDateTimeMinute(redeemedTime)}</Text>
          </View>
          <View className='order-voucher-row'>
            <Text className='order-voucher-label'>核销方式</Text>
            <Text className='order-voucher-value'>商家扫码 · 整单一次核销</Text>
          </View>
          <View className='order-voucher-row'>
            <Text className='order-voucher-label'>核销状态</Text>
            <Text className='order-voucher-status-pill order-voucher-status-pill--success'>已核销</Text>
          </View>
        </View>
      </View>

      <View className='order-completed-actions'>
        {reviewTargets.length > 0 && <NativeButton
          className='order-completed-btn order-completed-btn--ghost'
          onClick={openReview}
        >
          {hasPendingReview ? '去评价' : '查看评价'}
        </NativeButton>}
        <NativeButton
          className='order-completed-btn order-completed-btn--solid'
          disabled={reorder.isPending}
          loading={reorder.isPending}
          onClick={() => reorder.mutate()}
        >
          再来一单
        </NativeButton>
      </View>
    </View>

    <View className='order-verify-body'>
      <VerifyMerchantCard order={order} />

      <View className='order-pending-card'>
        {order.items.map((item) => {
          const specText = Object.values(item.specifications).join(' · ') || '默认规格'
          return <View className='order-goods-row' key={item.id}>
            <View className='order-goods-glyph'>{pickProductGlyph(item.product_name)}</View>
            <View className='order-goods-body'>
              <View className='order-goods-name'>{item.product_name}</View>
              <View className='order-goods-sub'>
                <Text className='order-goods-spec'>{specText}</Text>
                <Text className='order-goods-qty'>× {item.quantity} 件</Text>
              </View>
            </View>
            <View className='order-goods-price'>¥{item.line_amount}</View>
          </View>
        })}
      </View>

      <View className='order-pending-card'>
        <View className='order-summary-row'>
          <Text className='order-summary-label'>商品金额</Text>
          <Text className='order-summary-value'>¥{order.items_amount}</Text>
        </View>
        <View className='order-summary-row'>
          <Text className='order-summary-label'>积分抵扣</Text>
          {order.points_deduction > 0
            ? <Text className='order-summary-points-badge'>已抵扣 {formatInteger(order.points_deduction)} 积分</Text>
            : <Text className='order-summary-label'>未使用积分</Text>}
        </View>
        <View className='order-summary-divider' />
        <View className='order-summary-total'>
          <Text className='order-summary-total-label'>微信实付</Text>
          <View className='order-summary-payable'>
            <Text className='order-summary-payable-symbol'>¥</Text>
            <Text className='order-summary-payable-value'>{order.total_amount}</Text>
          </View>
        </View>
      </View>

      <View className='order-pending-card'>
        <View
          className='order-info-row'
          onClick={() => {
            void Taro.setClipboardData({ data: order.id }).catch(() => undefined)
          }}
        >
          <Text className='order-info-label'>订单号</Text>
          <Text className='order-info-value'>{order.id}</Text>
        </View>
        <View className='order-info-row'>
          <Text className='order-info-label'>创建时间</Text>
          <Text className='order-info-value'>{formatDateTime(order.created_at)}</Text>
        </View>
        {order.paid_at && <View className='order-info-row'>
          <Text className='order-info-label'>成交时间</Text>
          <Text className='order-info-value'>{formatDateTime(order.paid_at)}</Text>
        </View>}
        <View className='order-verified-fact'>
          <View className='order-verified-fact-badge'>
            <Icon name='Check' size={18} />
          </View>
          <Text>{order.settlement_kind === 'zero_amount' ? '服务端零金额成交，无渠道付款' : '服务端已确认成交'}</Text>
        </View>
      </View>
    </View>
  </View>
}

function formatCancelReason(reason: string | null | undefined): string {
  const raw = (reason ?? '').trim()
  if (!raw) return '订单已关闭'
  if (raw === '待付款超时' || raw === '可信支付超时') return '超时未支付，系统自动关闭'
  if (raw === '用户取消' || raw === '用户请求关单已确认') return '用户主动取消订单'
  return raw
}

function CancelledOrderDetail({ order }: { order: ConsumerTradeOrderRead }) {
  // 进入已取消订单详情时同步原生导航栏为深灰蓝白字，离页恢复白底黑字
  useEffect(() => {
    void Taro.setNavigationBarColor({ frontColor: '#ffffff', backgroundColor: colors.secondary }).catch(() => undefined)
    return () => {
      void Taro.setNavigationBarColor({ frontColor: '#000000', backgroundColor: colors.surface }).catch(() => undefined)
    }
  }, [])

  const reorder = useMutation({
    mutationFn: async () => {
      const items = order.items.map((item) => ({ sku_id: item.sku_id, quantity: item.quantity }))
      if (!items.length) throw new Error('原订单商品信息为空，无法再来一单')
      const productType = order.product_type === 'virtual' ? 'virtual' : 'physical'
      await startCheckout(items, productType)
    },
    onError: (error) => {
      showOrderErrorModal('无法再来一单', error, '原商品可能已下架或库存不足，请重新选购')
    },
  })

  const cancelledTime = order.cancelled_at ?? order.expires_at ?? order.created_at
  const showFreight = order.fulfillment_mode !== 'local' || Number(order.freight_amount) > 0

  return <View className='order-verify-page'>
    <View className='order-cancelled-hero'>
      <View className='order-voucher-ticket'>
        <View className='order-voucher-top'>
          <View className='order-voucher-head'>
            <View className='order-voucher-title-group order-voucher-title-group--muted'>
              <View className='order-voucher-title-circle'>
                <Icon name='Close' size={20} />
              </View>
              <Text>已取消</Text>
            </View>
            <Text className='order-voucher-status-pill order-voucher-status-pill--muted'>订单已关闭</Text>
          </View>

          <View className='order-completed-badge-wrap'>
            <View className='order-cancelled-circle-outer'>
              <View className='order-cancelled-circle-inner'>
                <Icon name='Close' size={52} />
              </View>
            </View>
            <View className='order-completed-title'>订单已取消</View>
            <View className='order-completed-sub'>该订单已关闭，如需购买请重新下单</View>
          </View>
        </View>

        <View className='order-voucher-divider order-voucher-divider--muted'>
          <View className='order-voucher-dashed' />
        </View>

        <View className='order-voucher-meta'>
          <View className='order-voucher-row'>
            <Text className='order-voucher-label'>取消时间</Text>
            <Text className='order-voucher-value'>{formatDateTimeMinute(cancelledTime)}</Text>
          </View>
          <View className='order-voucher-row'>
            <Text className='order-voucher-label'>取消原因</Text>
            <Text className='order-voucher-value'>{formatCancelReason(order.cancel_reason)}</Text>
          </View>
          <View className='order-voucher-row'>
            <Text className='order-voucher-label'>订单状态</Text>
            <Text className='order-voucher-status-pill order-voucher-status-pill--muted'>已取消</Text>
          </View>
        </View>
      </View>

      <View className='order-cancelled-action-wrap'>
        <NativeButton
          className='order-completed-btn order-completed-btn--solid'
          disabled={reorder.isPending}
          loading={reorder.isPending}
          onClick={() => reorder.mutate()}
        >
          再来一单
        </NativeButton>
      </View>
    </View>

    <View className='order-verify-body'>
      {order.fulfillment_mode === 'local' && <VerifyMerchantCard order={order} />}

      <View className='order-pending-card'>
        {order.items.map((item) => {
          const specText = Object.values(item.specifications).join(' · ') || '默认规格'
          return <View className='order-goods-row' key={item.id}>
            <View className='order-goods-glyph order-goods-glyph--muted'>{pickProductGlyph(item.product_name)}</View>
            <View className='order-goods-body'>
              <View className='order-goods-name'>{item.product_name}</View>
              <View className='order-goods-sub'>
                <Text className='order-goods-spec order-goods-spec--muted'>{specText}</Text>
                <Text className='order-goods-qty'>× {item.quantity} 件</Text>
              </View>
            </View>
            <View className='order-goods-price order-goods-price--muted'>¥{item.line_amount}</View>
          </View>
        })}
      </View>

      <View className='order-pending-card'>
        <View className='order-summary-row'>
          <Text className='order-summary-label'>商品金额</Text>
          <Text className='order-summary-value'>¥{order.items_amount}</Text>
        </View>
        {showFreight && <View className='order-summary-row'>
          <Text className='order-summary-label'>运费</Text>
          <Text className='order-summary-value'>¥{order.freight_amount}</Text>
        </View>}
        {order.points_deduction > 0 && <View className='order-summary-row'>
          <Text className='order-summary-label'>积分抵扣</Text>
          <Text className='order-summary-unpaid-tag'>已释放 {formatInteger(order.points_deduction)} 积分</Text>
        </View>}
        <View className='order-summary-divider' />
        <View className='order-summary-total'>
          <View className='order-summary-total-group'>
            <Text className='order-summary-total-label'>应付金额</Text>
            <Text className='order-summary-unpaid-tag'>未支付</Text>
          </View>
          <View className='order-summary-payable order-summary-payable--muted'>
            <Text className='order-summary-payable-symbol'>¥</Text>
            <Text className='order-summary-payable-value'>{order.total_amount}</Text>
          </View>
        </View>
      </View>

      <View className='order-pending-card'>
        <View
          className='order-info-row'
          onClick={() => {
            void Taro.setClipboardData({ data: order.id }).catch(() => undefined)
          }}
        >
          <Text className='order-info-label'>订单号</Text>
          <Text className='order-info-value'>{order.id}</Text>
        </View>
        <View className='order-info-row'>
          <Text className='order-info-label'>创建时间</Text>
          <Text className='order-info-value'>{formatDateTime(order.created_at)}</Text>
        </View>
      </View>
    </View>
  </View>
}

function RefundedOrderDetail({ order }: { order: ConsumerTradeOrderRead }) {
  const session = useSession()
  // 进入已退款订单详情时同步原生导航栏为深钴蓝白字，离页恢复白底黑字
  useEffect(() => {
    void Taro.setNavigationBarColor({ frontColor: '#ffffff', backgroundColor: colors.primary }).catch(() => undefined)
    return () => {
      void Taro.setNavigationBarColor({ frontColor: '#000000', backgroundColor: colors.surface }).catch(() => undefined)
    }
  }, [])

  const refundsQuery = useQuery({
    queryKey: ['private', 'order-refunds', session.epoch, order.id],
    gcTime: 0,
    queryFn: ({ signal }) => privateRequest<ResponseModelPageResultConsumerRefundRead>(
      `/refunds?order_id=${order.id}&page=1&page_size=10`,
      { signal },
    ),
  })

  const reorder = useMutation({
    mutationFn: async () => {
      const items = order.items.map((item) => ({ sku_id: item.sku_id, quantity: item.quantity }))
      if (!items.length) throw new Error('原订单商品信息为空，无法再来一单')
      const productType = order.product_type === 'virtual' ? 'virtual' : 'physical'
      await startCheckout(items, productType)
    },
    onError: (error) => {
      showOrderErrorModal('无法再来一单', error, '原商品可能已下架或库存不足，请重新选购')
    },
  })

  const refund = refundsQuery.data?.items.find((item) => item.status === 'completed') ?? refundsQuery.data?.items[0]
  const cashAmountText = refund?.amount ?? order.total_amount
  const cashAmount = Number(cashAmountText)
  const pointsReturned = refund ? refund.points_returned : order.points_deduction
  const completedTime = refund?.completed_at ?? refund?.funds_confirmed_at ?? order.fulfillment?.cancelled_at ?? order.paid_at ?? order.created_at
  const submittedTime = refund?.created_at ?? completedTime
  const reviewedTime = refund?.reviewed_at ?? submittedTime
  const refundReason = refund?.reason?.trim() || '申请整单退款'
  const returnAccountText = cashAmount > 0 && pointsReturned > 0
    ? '已原路退回微信和积分账户'
    : pointsReturned > 0
      ? '已原路退回积分账户'
      : '已原路退回微信账户'
  const refundTotalParts: string[] = []
  if (cashAmount > 0) refundTotalParts.push(`¥${cashAmountText}`)
  if (pointsReturned > 0) refundTotalParts.push(`${formatInteger(pointsReturned)} 积分`)
  const refundTotalText = refundTotalParts.length ? refundTotalParts.join(' + ') : `¥${cashAmountText}`

  return <View className='order-verify-page'>
    <View className='order-verify-hero'>
      <View className='order-voucher-ticket'>
        <View className='order-voucher-top'>
          <View className='order-voucher-head'>
            <View className='order-voucher-title-group'>
              <Icon name='Refund' size={38} />
              <Text>已退款</Text>
            </View>
            <Text className='order-voucher-status-pill order-voucher-status-pill--success'>退款成功</Text>
          </View>

          <View className='order-completed-badge-wrap'>
            <View className='order-refund-circle-outer'>
              <View className='order-refund-circle-inner'>
                <Icon name='Refund' size={56} />
              </View>
            </View>
            <View className='order-completed-title'>退款成功</View>
            <View className='order-refund-amount-row'>
              {(cashAmount > 0 || pointsReturned === 0) && <View className='order-refund-cash'>
                <Text className='order-refund-cash-symbol'>¥</Text>
                <Text className='order-refund-cash-value'>{cashAmountText}</Text>
              </View>}
              {pointsReturned > 0 && <Text className='order-refund-points-pill'>+ {formatInteger(pointsReturned)} 积分</Text>}
            </View>
            <View className='order-completed-sub'>{returnAccountText}</View>
          </View>
        </View>

        <View className='order-voucher-divider'>
          <View className='order-voucher-dashed' />
        </View>

        <View className='order-voucher-meta'>
          <View className='order-voucher-row'>
            <Text className='order-voucher-label'>退款时间</Text>
            <Text className='order-voucher-value'>{formatDateTimeMinute(completedTime)}</Text>
          </View>
          <View className='order-voucher-row'>
            <Text className='order-voucher-label'>退款原因</Text>
            <Text className='order-voucher-value'>{refundReason}</Text>
          </View>
          <View className='order-voucher-row'>
            <Text className='order-voucher-label'>退回方式</Text>
            <Text className='order-voucher-value'>原路退回</Text>
          </View>
        </View>
      </View>

      <View className='order-cancelled-action-wrap'>
        <NativeButton
          className='order-completed-btn order-completed-btn--solid'
          disabled={reorder.isPending}
          loading={reorder.isPending}
          onClick={() => reorder.mutate()}
        >
          再来一单
        </NativeButton>
      </View>
    </View>

    <View className='order-verify-body'>
      <View className='order-pending-card'>
        <View className='order-refund-timeline-title'>退款进度</View>
        <View className='order-refund-timeline'>
          <View className='order-refund-step'>
            <View className='order-refund-step-left'>
              <View className='order-refund-dot order-refund-dot--ring' />
              <Text className='order-refund-step-label'>提交退款申请</Text>
            </View>
            <Text className='order-refund-step-time'>{formatHourMinuteSecond(submittedTime)}</Text>
          </View>
          <View className='order-refund-step'>
            <View className='order-refund-step-left'>
              <View className='order-refund-dot order-refund-dot--ring' />
              <Text className='order-refund-step-label'>{refund?.review_mode === 'manual' ? '平台审核通过' : '系统自动处理'}</Text>
            </View>
            <Text className='order-refund-step-time'>{formatHourMinuteSecond(reviewedTime)}</Text>
          </View>
          <View className='order-refund-step'>
            <View className='order-refund-step-left'>
              <View className='order-refund-dot order-refund-dot--done'>
                <Icon name='Check' size={18} />
              </View>
              <Text className='order-refund-step-label'>退款成功</Text>
            </View>
            <Text className='order-refund-step-time'>{formatHourMinuteSecond(completedTime)}</Text>
          </View>
        </View>
      </View>

      {order.fulfillment_mode === 'local' && <VerifyMerchantCard order={order} />}

      <View className='order-pending-card'>
        {order.items.map((item) => {
          const specText = Object.values(item.specifications).join(' · ') || '默认规格'
          return <View className='order-goods-row' key={item.id}>
            <View className='order-goods-glyph'>{pickProductGlyph(item.product_name)}</View>
            <View className='order-goods-body'>
              <View className='order-goods-name'>{item.product_name}</View>
              <View className='order-goods-sub'>
                <Text className='order-goods-spec'>{specText}</Text>
                <Text className='order-goods-qty'>× {item.quantity} 件</Text>
              </View>
            </View>
            <View className='order-goods-price order-goods-price--muted'>¥{item.line_amount}</View>
          </View>
        })}
      </View>

      <View className='order-pending-card'>
        <View className='order-summary-row'>
          <Text className='order-summary-label'>商品金额</Text>
          <Text className='order-summary-value'>¥{order.items_amount}</Text>
        </View>
        <View className='order-summary-row'>
          <Text className='order-summary-label'>积分抵扣</Text>
          {order.points_deduction > 0
            ? <Text className='order-summary-points-badge'>已抵扣 {formatInteger(order.points_deduction)} 积分</Text>
            : <Text className='order-summary-label'>未使用积分</Text>}
        </View>
        <View className='order-summary-divider' />
        <View className='order-summary-row'>
          <Text className='order-summary-label'>微信实付</Text>
          <Text className='order-refund-paid-value'>¥{order.total_amount}</Text>
        </View>
        <View className='order-refund-total-bar'>
          <Text>退款合计</Text>
          <Text>{refundTotalText}</Text>
        </View>
      </View>

      <View className='order-pending-card'>
        <View
          className='order-info-row'
          onClick={() => {
            void Taro.setClipboardData({ data: order.id }).catch(() => undefined)
          }}
        >
          <Text className='order-info-label'>订单号</Text>
          <Text className='order-info-value'>{order.id}</Text>
        </View>
        <View className='order-info-row'>
          <Text className='order-info-label'>创建时间</Text>
          <Text className='order-info-value'>{formatDateTime(order.created_at)}</Text>
        </View>
        {order.paid_at && <View className='order-info-row'>
          <Text className='order-info-label'>成交时间</Text>
          <Text className='order-info-value'>{formatDateTime(order.paid_at)}</Text>
        </View>}
      </View>
    </View>
  </View>
}

const statusLabel: Record<ConsumerTradeOrderRead['display_status'], string> = { pending_payment: '待付款', cancelled: '已取消', awaiting_fulfillment: '履约待确认', awaiting_shipment: '待发货', awaiting_delivery: '待交付', shipped: '待收货', delivered: '已完成', refund_completed: '已退款' }
const listTabs = [
  { value: '', label: '全部' },
  { value: 'pending_payment', label: '待付款' },
  { value: 'awaiting_delivery', label: '待核销' },
  { value: 'delivered', label: '已完成' },
  { value: 'cancelled', label: '已取消' },
  { value: 'refund_completed', label: '已退款' },
] as const

function formatRefundSummary(order: ConsumerTradeOrderRead): string {
  const cash = Number(order.total_amount)
  const points = order.points_deduction
  const parts: string[] = []
  if (cash > 0) parts.push(`¥${order.total_amount}`)
  if (points > 0) parts.push(`${formatInteger(points)} 积分`)
  if (!parts.length) return `已原路退回 ¥${order.total_amount}`
  return `已原路退回 ${parts.join(' + ')}`
}

function formatShortDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

function formatCountdown(expiresAt: string, nowMs: number): string {
  const target = Date.parse(expiresAt)
  if (!Number.isFinite(target)) return '请尽快完成支付，超时将自动关闭'
  const remainSeconds = Math.floor((target - nowMs) / 1000)
  if (remainSeconds <= 0) return '付款已超时，订单即将自动关闭'
  const hours = Math.floor(remainSeconds / 3600)
  const minutes = Math.floor((remainSeconds % 3600) / 60)
  const seconds = remainSeconds % 60
  const clock = hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(seconds)}` : `${pad2(minutes)}:${pad2(seconds)}`
  return `剩余 ${clock} 内未支付将自动关闭`
}

function formatBadgeCount(count: number | undefined): string {
  if (!count || count <= 0) return ''
  return count > 99 ? '99+' : String(count)
}

function showOrderErrorModal(title: string, error: unknown, fallback: string) {
  const message = error instanceof Error && error.message.trim() ? error.message.trim() : fallback
  const content = error instanceof ApiError && error.requestId ? `${message}\n追踪编号：${error.requestId}` : message
  void Taro.showModal({ ...modalColors, title, content, showCancel: false, confirmText: '我知道了' }).catch(() => undefined)
}

function Summary({ order }: { order: ConsumerTradeOrderRead }) {
  const tone = order.display_status === 'delivered' || order.display_status === 'refund_completed' ? 'success' : order.display_status === 'awaiting_fulfillment' ? 'warning' : order.display_status === 'cancelled' ? '' : 'info'
  return <><View className='trade-row spread'><Text className={`label label-${tone}`}>{order.fulfillment_mode === 'local' && order.display_status === 'awaiting_delivery' ? '待到店核销' : statusLabel[order.display_status]}</Text><Text className='muted'>{order.created_at.slice(0, 10)}</Text></View>{order.items.map((item) => <View className='order-line' key={item.id}><View>{item.product_name}</View><View className='muted'>{Object.values(item.specifications).join(' / ') || '默认规格'} · {item.quantity} 件</View><View>¥{item.unit_price} / 件</View></View>)}<View className='trade-row spread'><Text>订单金额</Text><Text className='price-small'>¥{order.order_gross_amount}</Text></View></>
}

function OrderListMerchantLogo({ logoUrl, name }: { logoUrl: string | null; name: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [logoUrl])
  let source = ''
  if (logoUrl && !failed) {
    try { source = assetUrl(logoUrl) } catch { source = '' }
  }
  return <View className='order-card-logo-box'>
    {source
      ? <Image className='order-card-logo-image' src={source} mode='aspectFit' lazyLoad webp onError={() => setFailed(true)} />
      : <View className='order-card-logo-fallback'>{Array.from(name)[0] ?? '商'}</View>}
  </View>
}

function OrderListCard({
  order,
  nowMs,
  cancelling,
  reordering,
  onCancel,
  onReorder,
}: {
  order: ConsumerTradeOrderRead
  nowMs: number
  cancelling: boolean
  reordering: boolean
  onCancel: (orderId: string) => void
  onReorder: (order: ConsumerTradeOrderRead) => void
}) {
  const merchant = extractMerchantSnapshot(order)
  const merchantName = merchant?.name || '到店消费'
  const isPending = order.status === 'pending_payment'
  const isVerify = order.fulfillment_mode === 'local' && order.display_status === 'awaiting_delivery'
  const isDone = order.display_status === 'delivered'
  const isRefunded = order.display_status === 'refund_completed'
  const isCancelled = order.display_status === 'cancelled'
  const isMutedAmount = isCancelled || isRefunded
  const statusText = isVerify ? '待核销' : statusLabel[order.display_status]
  const statusModifier = isPending
    ? 'order-card-status--pending'
    : isVerify || isRefunded
      ? 'order-card-status--verify'
      : isDone
        ? 'order-card-status--done'
        : isCancelled
          ? 'order-card-status--cancelled'
          : 'order-card-status--verify'
  const totalQuantity = order.items.reduce((sum, item) => sum + item.quantity, 0)
  const timeLabel = isRefunded
    ? `退款 ${formatShortDateTime(order.fulfillment?.cancelled_at ?? order.paid_at ?? order.created_at)}`
    : isDone && order.fulfillment?.delivered_at
      ? `核销 ${formatShortDateTime(order.fulfillment.delivered_at)}`
      : `下单 ${formatShortDateTime(order.created_at)}`
  const amountLabel = isPending || isCancelled ? '应付' : '实付'
  const hasLocation = typeof merchant?.latitude === 'number' && typeof merchant?.longitude === 'number'

  const openDetail = () => {
    void Taro.navigateTo({ url: `/subpackages/trade/order-detail/index?id=${order.id}` })
      .catch(() => Taro.showToast({ title: '订单详情打开失败，请重试', icon: 'none' }))
  }
  const openMerchant = () => {
    if (!merchant?.id) {
      openDetail()
      return
    }
    void Taro.navigateTo({ url: `/subpackages/local/merchant/index?id=${encodeURIComponent(merchant.id)}` })
      .catch(() => Taro.showToast({ title: '商家详情打开失败，请重试', icon: 'none' }))
  }

  return <View className='order-card'>
    <View className='order-card-head'>
      <View className='order-card-merchant' onClick={openMerchant}>
        <OrderListMerchantLogo logoUrl={merchant?.logoUrl ?? null} name={merchantName} />
        <Text className='order-card-merchant-name'>{merchantName}</Text>
        <Icon name='ArrowRight' className='order-card-merchant-arrow' size={22} />
      </View>
      <View className={`order-card-status ${statusModifier}`}>
        {isRefunded && <Icon name='Refund' size={22} />}
        <Text>{statusText}</Text>
      </View>
    </View>

    <View className='order-card-items' onClick={openDetail}>
      {order.items.map((item) => {
        const specText = Object.values(item.specifications).join(' · ') || '默认规格'
        return <View className='order-card-item' key={item.id}>
          <View className={`order-card-glyph ${isCancelled ? 'order-card-glyph--muted' : ''}`}>
            {pickProductGlyph(item.product_name)}
          </View>
          <View className='order-card-item-body'>
            <View className='order-card-item-name'>{item.product_name}</View>
            <View className='order-card-item-sub'>
              <Text className={`order-card-item-spec ${isCancelled ? 'order-card-item-spec--muted' : ''}`}>{specText}</Text>
              <Text className='order-card-item-qty'>× {item.quantity}</Text>
            </View>
          </View>
          <View className={`order-card-item-price ${isMutedAmount ? 'order-card-item-price--muted' : ''}`}>
            ¥{item.unit_price}
          </View>
        </View>
      })}
    </View>

    {isPending && <View className='order-card-banner order-card-banner--countdown' onClick={openDetail}>
      <Icon name='Clock' className='order-card-banner-icon' size={28} />
      <Text>{formatCountdown(order.expires_at, nowMs)}</Text>
    </View>}

    {isVerify && <View className='order-card-banner order-card-banner--verify' onClick={openDetail}>
      <Icon name='Coupon' className='order-card-banner-icon order-card-banner-icon--info' size={28} />
      <Text>一单一码，到店整单核销；7 天未使用自动退款</Text>
    </View>}

    {isRefunded && <View className='order-card-banner order-card-banner--refunded' onClick={openDetail}>
      <View className='order-card-banner-check'>
        <Icon name='Check' size={16} />
      </View>
      <Text>{formatRefundSummary(order)}</Text>
    </View>}

    <View className='order-card-meta' onClick={openDetail}>
      <Text className='order-card-time'>{timeLabel}</Text>
      <View className='order-card-summary-right'>
        {order.points_deduction > 0 && <Text className='order-card-points'>已抵 {formatInteger(order.points_deduction)} 积分</Text>}
        <Text className='order-card-count'>共 {totalQuantity} 件</Text>
        <Text className='order-card-pay-label'>{amountLabel}</Text>
        <View className={`order-card-pay-amount ${isMutedAmount ? 'order-card-pay-amount--muted' : ''}`}>
          <Text className='order-card-pay-symbol'>¥</Text>
          <Text className='order-card-pay-value'>{order.total_amount}</Text>
        </View>
      </View>
    </View>

    <View className='order-card-divider' />

    <View className='order-card-actions'>
      {isPending && <>
        <NativeButton
          className='order-card-btn order-card-btn--neutral'
          disabled={cancelling}
          loading={cancelling}
          onClick={() => onCancel(order.id)}
        >
          取消订单
        </NativeButton>
        <NativeButton className='order-card-btn order-card-btn--primary' onClick={openDetail}>
          微信付款
        </NativeButton>
      </>}
      {isVerify && <>
        {hasLocation && merchant && <NativeButton
          className='order-card-btn order-card-btn--info'
          onClick={() => {
            void Taro.openLocation({
              latitude: merchant.latitude as number,
              longitude: merchant.longitude as number,
              name: merchant.name,
              address: merchant.address,
            }).catch(() => Taro.showToast({ title: '地图打开失败，请重试', icon: 'none' }))
          }}
        >
          导航
        </NativeButton>}
        <NativeButton className='order-card-btn order-card-btn--primary' onClick={openDetail}>
          查看核销码
        </NativeButton>
      </>}
      {(isDone || isRefunded || isCancelled) && <NativeButton
        className='order-card-btn order-card-btn--info'
        disabled={reordering}
        loading={reordering}
        onClick={() => onReorder(order)}
      >
        再来一单
      </NativeButton>}
      {!isPending && !isVerify && !isDone && !isRefunded && !isCancelled && <NativeButton
        className='order-card-btn order-card-btn--info'
        onClick={openDetail}
      >
        查看详情
      </NativeButton>}
    </View>
  </View>
}

function List() {
  const session = useSession()
  const route = useRouter()
  const initialStatus = listTabs.some((tab) => tab.value === route.params.status) ? route.params.status ?? '' : ''
  const [status, setStatus] = useState(initialStatus)
  const [visible, setVisible] = useState(true)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const summaryQuery = useQuery({
    queryKey: ['private', 'orders', 'summary', session.epoch],
    gcTime: 0,
    queryFn: ({ signal }) => privateRequest<ResponseModelConsumerOrderSummaryRead>('/orders/summary', { signal }),
  })

  const query = useInfiniteQuery({
    queryKey: ['private', 'orders', session.epoch, status],
    initialPageParam: 1,
    gcTime: 0,
    queryFn: ({ pageParam, signal }) => privateRequest<ResponseModelPageResultConsumerTradeOrderRead>(
      `/orders?page=${pageParam}&page_size=10${status ? `&status=${status}` : ''}`,
      { signal },
    ),
    getNextPageParam: (lastPage) => (lastPage.page < lastPage.total_pages ? lastPage.page + 1 : undefined),
  })

  const orders = query.data ? query.data.pages.flatMap((page) => page.items) : []
  const hasPendingOrders = orders.some((item) => item.status === 'pending_payment')

  useEffect(() => {
    if (!visible || !hasPendingOrders) return
    setNowMs(Date.now())
    const timer = globalThis.setInterval(() => {
      setNowMs(Date.now())
    }, 1000)
    return () => { globalThis.clearInterval(timer) }
  }, [visible, hasPendingOrders])

  const cancel = useMutation({
    mutationFn: async (orderId: string) => {
      const answer = await Taro.showModal({ ...dangerModalColors, title: '取消订单', content: '确认取消这笔待付款订单并释放占用库存？' })
      if (!answer.confirm || session.epoch !== sessionScope()) return false
      await privateRequest<ResponseModelOrderRead>(`/orders/${orderId}/cancel`, { method: 'POST' })
      return true
    },
    onSuccess: (cancelled) => {
      if (cancelled) void Taro.showToast({ title: '订单已取消', icon: 'success', duration: 1500 }).catch(() => undefined)
    },
    onError: (error) => {
      showOrderErrorModal('取消订单未完成', error, '取消订单未完成，请稍后重试')
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['private', 'orders'] })
      await Promise.all([query.refetch(), summaryQuery.refetch()])
    },
  })

  const reorder = useMutation({
    mutationFn: async (order: ConsumerTradeOrderRead) => {
      const items = order.items.map((item) => ({ sku_id: item.sku_id, quantity: item.quantity }))
      if (!items.length) throw new Error('原订单商品信息为空，无法再来一单')
      const productType = order.product_type === 'virtual' ? 'virtual' : 'physical'
      await startCheckout(items, productType)
    },
    onError: (error) => {
      showOrderErrorModal('无法再来一单', error, '原商品可能已下架或库存不足，请重新选购')
    },
  })

  useDidShow(() => {
    setVisible(true)
    setNowMs(Date.now())
    void query.refetch()
    void summaryQuery.refetch()
  })
  useDidHide(() => { setVisible(false) })
  usePullDownRefresh(() => {
    void Promise.all([query.refetch(), summaryQuery.refetch()])
      .finally(() => Taro.stopPullDownRefresh())
  })
  useReachBottom(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage()
    }
  })

  return <View className='order-list-page'>
    <View className='order-tabs'>
      {listTabs.map((tab) => {
        const active = tab.value === status
        const badgeText = tab.value === 'pending_payment'
          ? formatBadgeCount(summaryQuery.data?.pending_payment)
          : tab.value === 'awaiting_delivery'
            ? formatBadgeCount(summaryQuery.data?.awaiting_delivery)
            : ''
        return <View
          key={tab.value || 'all'}
          className={`order-tab ${active ? 'order-tab--active' : ''}`}
          onClick={() => {
            if (tab.value !== status) setStatus(tab.value)
          }}
        >
          <Text>{tab.label}</Text>
          {badgeText && <Text className='order-tab-badge'>{badgeText}</Text>}
        </View>
      })}
    </View>

    {query.isPending && <QueryState title='正在读取订单' />}
    {query.isError && <QueryState title='订单读取失败' error={query.error} retry={() => { void query.refetch() }} />}

    {!query.isPending && !query.isError && <>
      {!orders.length && <QueryState title='暂无相关订单' />}
      {orders.map((order) => <OrderListCard
        key={order.id}
        order={order}
        nowMs={nowMs}
        cancelling={cancel.isPending && cancel.variables === order.id}
        reordering={reorder.isPending && reorder.variables?.id === order.id}
        onCancel={(orderId) => cancel.mutate(orderId)}
        onReorder={(targetOrder) => reorder.mutate(targetOrder)}
      />)}
      {orders.length > 0 && <View className='order-list-footer'>
        {query.isFetchingNextPage ? <Text>正在加载更多订单…</Text> : query.hasNextPage ? <Text>上拉加载更多</Text> : <>
          <View className='order-list-footer-line' />
          <Text>没有更多订单了</Text>
          <View className='order-list-footer-line' />
        </>}
      </View>}
    </>}
  </View>
}
function Detail() {
  const session = useSession()
  const id = useRouter().params.id
  const valid = !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  const query = useQuery({ queryKey: ['private', 'order-detail', session.epoch, id], enabled: valid, gcTime: 0, queryFn: ({ signal }) => privateRequest<ResponseModelConsumerTradeOrderRead>(`/orders/${id}`, { signal }) })
  const { refetch } = query
  const refreshOrder = useCallback(() => refetch(), [refetch])
  useDidShow(() => { if (valid) void query.refetch() })
  const receipt = useMutation({ mutationFn: async () => {
    const fulfillment = query.data?.fulfillment
    if (!query.data?.can_confirm_receipt || !fulfillment) throw new Error('当前订单不能确认收货，请刷新')
    const answer = await Taro.showModal({ ...modalColors, title: '确认收货', content: '请确认已收到全部商品。提交后以服务端履约事实为准。' })
    if (!answer.confirm || session.epoch !== sessionScope()) return
    await privateRequest<ResponseModelFulfillmentRead>(`/orders/${id}/fulfillment/confirm-receipt`, { method: 'POST', data: { revision: fulfillment.revision } })
  }, onSettled: async () => { await queryClient.invalidateQueries({ queryKey: ['private', 'orders'] }); await query.refetch() } })
  if (!valid) return <QueryState title='订单链接无效' />
  if (query.isPending) return <QueryState title='正在读取订单' />
  if (query.isError) return <QueryState title='订单读取失败' error={query.error} retry={() => { void query.refetch() }} />
  const order = query.data
  if (order.status === 'pending_payment') {
    return <PendingOrderDetail order={order} refreshOrder={refreshOrder} />
  }
  if (order.fulfillment_mode === 'local' && order.status === 'paid' && order.display_status === 'awaiting_delivery') {
    return <VerifyOrderDetail order={order} refreshOrder={refreshOrder} />
  }
  if (order.fulfillment_mode === 'local' && order.status === 'paid' && order.display_status === 'delivered') {
    return <CompletedOrderDetail order={order} />
  }
  if (order.status === 'cancelled') {
    return <CancelledOrderDetail order={order} />
  }
  if (order.display_status === 'refund_completed') {
    return <RefundedOrderDetail order={order} />
  }
  const address = order.address_snapshot
  const addressText = (name: string) => typeof address?.[name] === 'string' ? address[name] : ''
  const fulfillment = order.fulfillment
  return <View className='page'><View className='title'>订单详情</View>{receipt.error && <QueryState title='收货结果未确认，请刷新履约事实' error={receipt.error} />}
    <View className='surface'><Summary order={order} /></View>
    {order.fulfillment_mode === 'local' && order.status === 'paid' && <Voucher orderId={order.id} />}
    {order.fulfillment_mode === 'local' && <View className='surface'><View>成交总额 ¥{order.order_gross_amount}</View><View>积分抵扣 {order.points_deduction} 积分</View><View>微信应付 ¥{order.total_amount}</View><View className='note'>未核销可随时申请整单自动退款，成交确认七天未使用自动退款。</View></View>}
    {address && <View className='surface'><View className='section-title'>收货信息</View><View>{addressText('receiver_name')} · {addressText('mobile')}</View><View className='muted'>{addressText('province')}{addressText('city')}{addressText('district')}{addressText('street_address')}</View></View>}
    {fulfillment && <View className='surface'><View className='section-title'>{order.fulfillment_mode === 'local' ? '到店消费' : order.product_type === 'physical' ? '配送与履约' : '虚拟交付'}</View><View>{order.fulfillment_mode === 'local' && order.display_status === 'awaiting_delivery' ? '待到店核销' : statusLabel[order.display_status]}</View>{fulfillment.carrier && <View className='muted'>承运人：{fulfillment.carrier}</View>}{fulfillment.tracking_number && <><View className='muted wrap'>运单号：{fulfillment.tracking_number}</View><Button fill='outline' onClick={() => { void Taro.setClipboardData({ data: fulfillment.tracking_number ?? '' }) }}>复制运单号</Button><View className='muted'>暂不提供实时物流轨迹</View></>}{fulfillment.shipped_at && <View className='muted'>发货时间：{new Date(fulfillment.shipped_at).toLocaleString()}</View>}{fulfillment.delivered_at && <View className='muted'>完成时间：{new Date(fulfillment.delivered_at).toLocaleString()}</View>}{order.fulfillment_mode !== 'local' && order.product_type === 'virtual' && fulfillment.status === 'delivered' && fulfillment.delivery_reference && <View className='wrap'>交付信息：{fulfillment.delivery_reference}</View>}{fulfillment.auto_confirm_at && fulfillment.status === 'shipped' && <View className='note'>预计自动确认：{new Date(fulfillment.auto_confirm_at).toLocaleString()}，实际结果以服务端为准</View>}</View>}
    {order.paid_at && <View className='surface'><View className='section-title'>成交事实</View><View className='muted'>{order.settlement_kind === 'zero_amount' ? '服务端零金额成交，无渠道付款' : '服务端已确认成交'} · {new Date(order.paid_at).toLocaleString()}</View></View>}
    <View className='surface'><View className='trade-row spread'><Text>商品金额</Text><Text>¥{order.items_amount}</Text></View>{(order.fulfillment_mode !== 'local' || Number(order.freight_amount) > 0) && <View className='trade-row spread'><Text>运费</Text><Text>¥{order.freight_amount}</Text></View>}<View className='field-label'>订单号</View><View className='muted wrap'>{order.id}</View><View className='muted'>创建时间 {new Date(order.created_at).toLocaleString()}</View>{order.settlement_kind === 'zero_amount' && <View className='note'>零金额订单由服务端确认成交</View>}</View>
    {order.can_confirm_receipt && <Button block disabled={receipt.isPending} loading={receipt.isPending} onClick={() => receipt.mutate()}>确认收货</Button>}
    {order.status === 'paid' && order.settlement_kind === 'channel' && fulfillment && ['shipped', 'delivered'].includes(fulfillment.status) && <WechatReceipt orderId={order.id} />}
    {order.can_refund && <Button block fill='outline' onClick={() => { void Taro.navigateTo({ url: `/subpackages/service/refund-apply/index?orderId=${order.id}` }) }}>申请整单退款</Button>}
    {!order.can_refund && order.status === 'paid' && <Button block fill='outline' onClick={() => { void Taro.navigateTo({ url: `/subpackages/service/refund-apply/index?orderId=${order.id}` }) }}>退款资格与申请恢复</Button>}
    {order.item_reviews.some((item) => item.can_review || item.review) && <View className='surface'><View className='section-title'>商品评价</View>{order.item_reviews.map((item) => (item.can_review || item.review) && <View className='order-line' key={item.order_item_id}><View>{order.items.find((line) => line.id === item.order_item_id)?.product_name}</View><Button block fill='outline' onClick={() => { void Taro.navigateTo({ url: `/subpackages/service/review/index?orderId=${order.id}&itemId=${item.order_item_id}` }) }}>{item.review ? '查看我的评价' : '评价商品'}</Button></View>)}</View>}
  </View>
}
export function OrdersPage() { const session = useSession(); return <AuthGate><List key={session.epoch} /></AuthGate> }
export function OrderDetailPage() { const session = useSession(); return <AuthGate><Detail key={session.epoch} /></AuthGate> }
