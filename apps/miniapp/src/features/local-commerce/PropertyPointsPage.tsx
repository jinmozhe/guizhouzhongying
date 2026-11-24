import { modalColors } from '@/styles/colors'
import { useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import { Input, Text, View } from '@tarojs/components'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { PropertyGrantCreate, PropertyTargetRead, ResponseModelPropertyTargetRead, ResponseModelPropertyGrantRead, ResponseModelOperationIntentRead, ResponseModelPageResultPropertyGrantRead } from '@pinjie/api-client'
import { privateRequest, sessionScope, useSession } from '@/lib/session'
import { AuthGate } from '@/components/AuthGate'
import { Button } from '@/components/Button'
import { QueryState } from '@/components/QueryState'
import { ApiError } from '@/lib/api'

function phoneValue(value: string) { const text = value.trim(); return /^1[0-9]{10}$/.test(text) ? `+86${text}` : text }
function readPending(key: string): PropertyGrantCreate | null {
  const value: unknown = Taro.getStorageSync(key)
  if (!value) return null
  if (typeof value !== 'object' || !('request_id' in value) || typeof value.request_id !== 'string' || !('user_id' in value) || typeof value.user_id !== 'string' || !('phone_e164' in value) || typeof value.phone_e164 !== 'string' || !('phone_verified_at' in value) || typeof value.phone_verified_at !== 'string' || !('points' in value) || typeof value.points !== 'string' || !('note' in value) || typeof value.note !== 'string') throw new Error('原发放请求无法读取，请联系平台核对记录')
  return { request_id: value.request_id, user_id: value.user_id, phone_e164: value.phone_e164, phone_verified_at: value.phone_verified_at, points: value.points, note: value.note }
}
function Content() {
  const session = useSession()
  const storageKey = `guizhouzhongying.property-pending.${session.user?.id}`
  const [loaded] = useState(() => { try { return { value: readPending(storageKey), error: '' } } catch (error) { return { value: null, error: error instanceof Error ? error.message : '读取请求失败' } } })
  const [pending, setPending] = useState<PropertyGrantCreate | null>(loaded.value)
  const [phone, setPhone] = useState(''); const [points, setPoints] = useState(''); const [note, setNote] = useState('')
  const [target, setTarget] = useState<PropertyTargetRead>(); const [targetPhone, setTargetPhone] = useState('')
  const [page, setPage] = useState(1); const lock = useRef(false)
  const records = useQuery({ queryKey: ['private', 'property-grants', session.epoch, page], gcTime: 0, queryFn: ({ signal }) => privateRequest<ResponseModelPageResultPropertyGrantRead>(`/property/points/grants?page=${page}&page_size=10`, { signal }) })
  const lookup = useMutation({ mutationFn: async () => {
    const normalized = phoneValue(phone)
    const result = await privateRequest<ResponseModelPropertyTargetRead>('/property/points/lookup-user', { method: 'POST', data: { phone_e164: normalized } })
    if (session.epoch !== sessionScope()) return
    setTarget(result); setTargetPhone(normalized)
  } })
  const grant = useMutation({ mutationFn: async (findOnly: boolean) => {
    if (lock.current || session.epoch !== sessionScope()) return
    lock.current = true
    try {
      let payload = pending
      if (!payload) {
        if (!target || phoneValue(phone) !== targetPhone || !/^[1-9][0-9]{0,18}$/.test(points) || BigInt(points) > 9223372036854775807n) throw new Error('请先查询会员，填写合法正整数积分并确认')
        const answer = await Taro.showModal({ ...modalColors, title: '确认发放积分', content: `向 ${target.display_name ?? '会员'}（${target.phone_masked}）发放 ${points} 积分？` })
        if (!answer.confirm || session.epoch !== sessionScope()) return
        const intent = await privateRequest<ResponseModelOperationIntentRead>('/checkout/intent')
        if (session.epoch !== sessionScope()) return
        payload = { request_id: intent.request_id, user_id: target.id, phone_e164: targetPhone, phone_verified_at: target.phone_verified_at, points, note }
        Taro.setStorageSync(storageKey, payload); setPending(payload)
      }
      const result = findOnly
        ? await privateRequest<ResponseModelPropertyGrantRead>(`/property/points/grants/by-request/${payload.request_id}`)
        : await privateRequest<ResponseModelPropertyGrantRead>('/property/points/grants', { method: 'POST', data: payload })
      if (session.epoch !== sessionScope()) return
      Taro.removeStorageSync(storageKey); setPending(null); setTarget(undefined); setPoints(''); setNote('')
      await records.refetch()
      await Taro.showModal({ ...modalColors, title: '发放成功', content: `已记录发放 ${result.points} 积分，请以用户积分流水核对到账及欠款抵扣。`, showCancel: false })
    } catch (error) {
      if (!findOnly && session.epoch === sessionScope() && error instanceof ApiError && (error.status === 422 || error.code === 'PHONE_BINDING_CONFLICT')) {
        Taro.removeStorageSync(storageKey); setPending(null); setTarget(undefined)
      }
      throw error
    } finally { lock.current = false }
  } })
  const busy = lookup.isPending || grant.isPending
  if (loaded.error) return <QueryState title='发放记录需核对' detail={loaded.error} />
  return <View className='page'><View className='title'>物业发放积分</View><View className='note'>仅向有效已注册并绑定手机号的会员发放，授予积分不参与升级。</View>
    {(lookup.error || grant.error) && <QueryState title='操作未完成' error={lookup.error ?? grant.error} />}
    {pending ? <View className='surface'><View>原请求：{pending.request_id}</View><View>发放积分：{pending.points}</View><View className='note'>结果未确认，先查询原请求，勿建立新的发放请求。</View><Button block disabled={busy} onClick={() => grant.mutate(true)}>查询原结果</Button><Button block disabled={busy} onClick={() => grant.mutate(false)}>使用原请求恢复发放</Button></View> : <View className='surface'>
      <View className='field-label'>会员手机号</View><Input placeholderClass='input-placeholder' value={phone} disabled={busy} maxlength={16} placeholder='请输入会员手机号' onInput={(event) => { setPhone(event.detail.value); setTarget(undefined) }} />
      <Button block disabled={busy} loading={lookup.isPending} onClick={() => lookup.mutate()}>查询会员</Button>
      {target && <><View>{target.display_name ?? '会员'} · {target.phone_masked}</View><View className='field-label'>发放积分</View><Input placeholderClass='input-placeholder' type='number' maxlength={19} value={points} disabled={busy} onInput={(event) => setPoints(event.detail.value)} /><View className='field-label'>发放说明</View><Input placeholderClass='input-placeholder' maxlength={200} value={note} disabled={busy} onInput={(event) => setNote(event.detail.value)} /><Button block type='primary' disabled={busy || !points} loading={grant.isPending} onClick={() => grant.mutate(false)}>确认发放</Button></>}
    </View>}
    <View className='section-title'>本人发放记录</View>
    {records.isPending && <QueryState title='正在读取发放记录' />}
    {records.isError && <QueryState title='发放记录读取失败' error={records.error} retry={() => { void records.refetch() }} />}
    {records.data && !records.isError && <>{!records.data.items.length && <QueryState title='暂无发放记录' />}{records.data.items.map((row) => <View className='surface' key={row.id}><View>发放 {row.points} 积分</View><View className='muted wrap'>会员 {row.user_id}</View><View>{row.note}</View><View className='muted'>{new Date(row.created_at).toLocaleString()}</View></View>)}<View className='trade-row spread'><Button disabled={page === 1 || records.isFetching} onClick={() => setPage(page - 1)}>上一页</Button><Text>{page} / {records.data.total_pages || 1}</Text><Button disabled={page >= records.data.total_pages || records.isFetching} onClick={() => setPage(page + 1)}>下一页</Button></View></>}
  </View>
}
export function PropertyPointsPage() { const session = useSession(); return <AuthGate><Content key={session.epoch} /></AuthGate> }
