import type { CategoryRead, PageResultPublicProductRead, PublicProductRead } from '@pinjie/api-client'
import { compareMoney } from '../../lib/money'

export const CATEGORY_PAGE_SIZE = 20
export const CATEGORY_MAX_PAGES = 5

export function categoryPath(categories: CategoryRead[], id?: string): CategoryRead[] {
  const byId = new Map(categories.map((category) => [category.id, category]))
  const path: CategoryRead[] = []
  const seen = new Set<string>()
  let current = id ? byId.get(id) : undefined
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }
  return path
}

export function nextProductPage(page: PageResultPublicProductRead) {
  return page.items.length && page.page * page.page_size < page.total ? page.page + 1 : undefined
}

export function uniqueProducts(pages: PageResultPublicProductRead[]) {
  const seen = new Set<string>()
  return pages.flatMap((page) => page.items).filter((product) => {
    if (seen.has(product.id)) return false
    seen.add(product.id)
    return true
  })
}

export function productPrice(product: PublicProductRead) {
  const skus = product.skus.filter((sku) => sku.is_active).sort((left, right) => compareMoney(left.price, right.price))
  const lowest = skus[0]
  const multiple = skus.length > 1
  const market = multiple ? undefined : lowest?.market_price
  const points = product.fulfillment_mode === 'local'
    ? skus.reduce((highest, sku) => {
      const wholeYuan = Number(sku.price.split('.')[0])
      return Math.max(highest, Math.min(sku.max_points_deduction, wholeYuan))
    }, 0)
    : 0

  return {
    amount: lowest?.price,
    startsAt: multiple && compareMoney(lowest.price, skus[skus.length - 1].price) < 0,
    multiple,
    market: market && compareMoney(market, lowest.price) > 0 ? market : undefined,
    points,
  }
}
