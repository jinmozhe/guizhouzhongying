import { Button, Input, View } from '@tarojs/components'
import { Icon } from '@/components/Icon'

export function CatalogSearch({ draft, keyword, scope, onInput, onSubmit, onClear }: {
  draft: string
  keyword?: string
  scope: string
  onInput: (value: string) => void
  onSubmit: (value: string) => void
  onClear: () => void
}) {
  return <View className='category-search'>
    <View className='category-search-field'>
      <Icon name='Search' size={32} />
      <Input placeholderClass='input-placeholder' className='category-search-input' ariaLabel={`在${scope}中搜索商品名称`} value={draft} maxlength={200}
        confirmType='search' placeholder='搜索全部商品'
        onInput={(event) => onInput(event.detail.value)} onConfirm={(event) => onSubmit(event.detail.value)} />
      {(draft || keyword) && <Button className='category-clear' ariaLabel='清空搜索' onClick={onClear}>
        <Icon name='Close' size={28} />
      </Button>}
      <Button className='category-search-submit' hoverClass='category-search-submit-pressed' onClick={() => onSubmit(draft)}>搜索</Button>
    </View>
  </View>
}
