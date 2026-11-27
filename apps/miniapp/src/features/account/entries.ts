import type { IconName } from '@/components/Icon'

type Entry = { label: string; icon: IconName; path: string }
export const orderEntries: Entry[] = [
  { label: '待付款', icon: 'ToPay', path: '/subpackages/trade/orders/index?status=pending_payment' },
  { label: '待核销', icon: 'ToReceive', path: '/subpackages/trade/orders/index?status=awaiting_delivery' },
  { label: '已完成', icon: 'Check', path: '/subpackages/trade/orders/index?status=delivered' },
  { label: '售后服务', icon: 'Refund', path: '/subpackages/service/refunds/index' },
  { label: '全部订单', icon: 'Order', path: '/subpackages/trade/orders/index' },
]

type ServiceEntry = Entry & { tone: 'brand' | 'reward' | 'info'; access: 'phone' | 'identity' | 'public' }
export const serviceEntries: ServiceEntry[] = [
  { label: '会员中心', icon: 'User', tone: 'brand', path: '/subpackages/finance/membership/index', access: 'phone' },
  { label: '推荐分享', icon: 'Share', tone: 'brand', path: '/subpackages/finance/referral/index', access: 'phone' },
  { label: '我的积分', icon: 'Star', tone: 'reward', path: '/subpackages/finance/points/index', access: 'phone' },
  { label: '钱包与流水', icon: 'Wallet', tone: 'brand', path: '/subpackages/finance/wallets/index', access: 'phone' },
  { label: '佣金记录', icon: 'Prices', tone: 'brand', path: '/subpackages/finance/commissions/index', access: 'phone' },
  { label: '历史提现', icon: 'Clock', tone: 'info', path: '/subpackages/finance/withdrawals/index', access: 'phone' },
  { label: '继续结算', icon: 'ToPay', tone: 'brand', path: '/subpackages/trade/checkout/index', access: 'phone' },
  { label: '个人资料', icon: 'Edit', tone: 'info', path: '/subpackages/account/profile/index', access: 'identity' },
  { label: '账户安全', icon: 'ShieldCheck', tone: 'brand', path: '/subpackages/account/settings/index', access: 'public' },
  { label: '隐私说明', icon: 'ShieldCheck', tone: 'info', path: '/subpackages/account/privacy/index', access: 'public' },
  { label: '帮助支持', icon: 'Service', tone: 'info', path: '/subpackages/service/help/index', access: 'public' },
]
