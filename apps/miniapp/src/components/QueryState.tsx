import { View } from '@tarojs/components'
import { Button } from './Button'
import { ApiError } from '@/lib/api'

export function QueryState({ title, detail, error, retry }: { title: string; detail?: string; error?: Error | null; retry?: () => void }) {
  return <View className={`state${error ? ' state-error' : ''}`}>
    <View className='state-title'>{title}</View>
    <View className='muted'>{error?.message ?? detail}</View>
    {error instanceof ApiError && error.requestId && <View className='muted'>追踪编号：{error.requestId}</View>}
    {retry && <Button fill='outline' onClick={retry}>重新加载</Button>}
  </View>
}
