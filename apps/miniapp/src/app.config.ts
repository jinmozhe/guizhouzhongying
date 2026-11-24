import tabBar from './tab-bar.json'
import colors from './styles/palette.json'

export default defineAppConfig({
  lazyCodeLoading: 'requiredComponents',
  pages: ['pages/home/index', 'pages/category/index', 'pages/cart/index', 'pages/account/index'],
  subPackages: [
    { root: 'subpackages/local', pages: ['merchant/index', 'merchants/index', 'property/index', 'redemption/index', 'finance/index'] },
    { root: 'subpackages/catalog', pages: ['detail/index'] },
    { root: 'subpackages/account', pages: ['auth/index', 'addresses/index', 'privacy/index', 'profile/index', 'settings/index', 'sessions/index', 'closure/index'] },
    { root: 'subpackages/finance', pages: ['membership/index', 'wallets/index', 'ledgers/index', 'commissions/index', 'withdrawals/index', 'referral/index', 'points/index'] },
    { root: 'subpackages/trade', pages: ['checkout/index', 'orders/index', 'order-detail/index'] },
    { root: 'subpackages/service', pages: ['refund-apply/index', 'refunds/index', 'refund-detail/index', 'review/index', 'help/index'] },
  ],
  window: { navigationBarTitleText: '众赢生活', navigationBarBackgroundColor: colors.surface, navigationBarTextStyle: 'black', backgroundColor: colors.background, backgroundTextStyle: 'dark' },
  tabBar: {
    color: colors.secondary, selectedColor: colors.primary, backgroundColor: colors.surface, borderStyle: 'white',
    list: tabBar.items.map(({ pagePath, text, asset }) => ({
      pagePath, text, iconPath: `assets/tab-${asset}.png`, selectedIconPath: `assets/tab-${asset}-active.png`,
    })),
  },
})
