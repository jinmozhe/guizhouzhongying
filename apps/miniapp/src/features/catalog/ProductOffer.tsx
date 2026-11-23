import { Text, View } from '@tarojs/components'
import { Icon } from '@/components/Icon'
import type { productPrice } from './domain'
import './product-offer.scss'

type Offer = ReturnType<typeof productPrice>

export function ProductTags({ multiple, points }: Pick<Offer, 'multiple' | 'points'>) {
  if (!multiple && points <= 0) return null

  return <View className='catalog-product-tags'>
    {multiple && <Text className='catalog-product-tag'>多规格</Text>}
    {points > 0 && <View className='catalog-product-tag catalog-points-tag'>
      <Icon name='Jingdou' size={20} />
      <Text>{`${multiple ? '最高抵' : '可抵'} ${points} 积分`}</Text>
    </View>}
  </View>
}

export function ProductPrices({ amount, startsAt, market }: Pick<Offer, 'amount' | 'startsAt' | 'market'>) {
  const [whole, fraction = ''] = amount?.split('.') ?? []

  return <View className='catalog-product-prices'>
    {amount !== undefined
      ? <Text className='catalog-product-price'>
        <Text className='catalog-price-small'>¥</Text>{whole}
        <Text className='catalog-price-small'>.{fraction.padEnd(2, '0')}{startsAt ? ' 起' : ''}</Text>
      </Text>
      : <Text className='catalog-price-unavailable'>暂无可售规格</Text>}
    {market && <Text className='catalog-market-price'>¥{market}</Text>}
  </View>
}
