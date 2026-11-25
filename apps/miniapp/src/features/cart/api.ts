import { useQuery } from '@tanstack/react-query'
import type { CartItemInput, ResponseModelCartItemRead, ResponseModelListConsumerCartItemRead } from '@pinjie/api-client'
import { privateRequest, sessionScope, useSession } from '@/lib/session'
import { queryClient } from '@/lib/query'

function cartQueryKey(epoch: number) { return ['private', 'cart', epoch] as const }

export function useCart() {
  const session = useSession()
  return useQuery({
    queryKey: cartQueryKey(session.epoch),
    enabled: !!session.user?.phone_bound,
    // 登录后仅首次拉取用于点亮初始角标，后续由加购、购物车页操作与进入购物车页按需刷新。
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    queryFn: ({ signal }) => privateRequest<ResponseModelListConsumerCartItemRead>('/cart-items', { signal }),
  })
}

export function useCartBadge() {
  const { data, isError, refetch } = useCart()
  const quantity = data?.reduce((total, item) => total + item.quantity, 0)
  const badge = quantity ? (quantity > 99 ? '99+' : String(quantity)) : undefined
  return { badge, isError, refetch }
}

export async function addToCart(data: CartItemInput) {
  const queryKey = cartQueryKey(sessionScope())
  const item = await privateRequest<ResponseModelCartItemRead>('/cart-items', { method: 'POST', data })
  const cartRefreshed = await queryClient.invalidateQueries({ queryKey, exact: true }, { throwOnError: true })
    .then(() => queryClient.getQueryState(queryKey)?.isInvalidated === false, () => false)
  return { item, cartRefreshed }
}
