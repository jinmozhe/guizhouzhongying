import { useRef, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { useQuery } from '@tanstack/react-query'
import type { ResponseModelLocalRolesRead } from '@pinjie/api-client'
import { Button, View } from '@tarojs/components'
import { Icon } from '@/components/Icon'
import { AccountFrame } from '@/components/AccountFrame'
import { beginAuthentication } from '@/lib/auth-navigation'
import { privateRequest, useSession } from '@/lib/session'
import { useSiteName } from '@/lib/site-brand'
import { QueryState } from '@/components/QueryState'
import { AccountSummary, SignedInSummary } from './AccountSummary'
import { orderEntries, serviceEntries } from './entries'
import './account.scss'

export function AccountPage() {
  const session = useSession()
  const siteName = useSiteName()
  const loggedIn = !!session.user?.phone_bound
  const [error, setError] = useState('')
  const navigating = useRef(false)
  const roles = useQuery({ queryKey: ['private', 'business-roles', session.epoch], enabled: loggedIn, gcTime: 0, queryFn: ({ signal }) => privateRequest<ResponseModelLocalRolesRead>('/users/me/business-roles', { signal }) })
  useDidShow(() => { if (loggedIn) void roles.refetch() })

  async function open(target: string, access: 'phone' | 'public' | 'identity' = 'phone') {
    if (navigating.current) return
    navigating.current = true
    setError('')
    try {
      if (access === 'phone' && !loggedIn) await beginAuthentication(target)
      else if (access === 'identity' && !session.user) await beginAuthentication(target, false)
      else await Taro.navigateTo({ url: target })
    } catch { setError('页面打开失败，请点击原入口重试。') }
    finally { navigating.current = false }
  }

  return <AccountFrame title='我的' className='account-screen' bodyClassName='account-body'>
    {loggedIn
      ? <SignedInSummary key={session.epoch} roles={roles.data} open={(target) => { void open(target) }} />
      : <AccountSummary open={(target) => { void open(target) }} />}
    {(error || session.error) && <View className='account-feedback' role='alert'>{error || session.error}</View>}
    <View className='account-orders'>
      {orderEntries.map((entry) => <Button className='account-order' key={entry.label} onClick={() => { void open(entry.path) }}>
        <Icon className='account-order-icon' name={entry.icon} size={42} />
        <View>{entry.label}</View>
      </Button>)}
    </View>
    <View className='account-services'>
      <View className='account-section-title' role='heading'>我的服务</View>
      <View className='account-service-grid'>
        {roles.data?.merchant_id && <>
          <Button className='account-service' onClick={() => { void open('/subpackages/local/redemption/index') }}><View className='account-service-icon account-service-icon--brand'><Icon name='Check' /></View><View>核销与记录</View></Button>
          <Button className='account-service' onClick={() => { void open('/subpackages/local/finance/index') }}><View className='account-service-icon account-service-icon--brand'><Icon name='Wallet' /></View><View>商家应收</View></Button>
        </>}
        {roles.data?.property_operator_id && <Button className='account-service' onClick={() => { void open('/subpackages/local/property/index') }}><View className='account-service-icon account-service-icon--reward'><Icon name='Star' /></View><View>物业发放积分</View></Button>}
        {serviceEntries.map((entry) => <Button className='account-service' key={entry.label} onClick={() => { void open(entry.path, entry.access) }}>
          <View className={`account-service-icon account-service-icon--${entry.tone}`}><Icon name={entry.icon} /></View>
          <View>{entry.label}</View>
        </Button>)}
      </View>
    </View>
    {loggedIn && roles.isPending && <View className='muted'>正在读取业务身份</View>}
    {roles.isError && <QueryState title='业务身份读取失败' error={roles.error} retry={() => { void roles.refetch() }} />}
    <View className='account-brand'><View /><View>{siteName}</View><View /></View>
  </AccountFrame>
}
