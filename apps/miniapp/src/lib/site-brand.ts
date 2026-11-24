import { useQuery } from '@tanstack/react-query'
import type { ResponseModelSiteProfileRead } from '@pinjie/api-client'
import { getPublic } from './api'

export const DEFAULT_SITE_NAME = '众赢生活'
export const SITE_PROFILE_QUERY_KEY = ['public', 'site-profile'] as const

// 读取公开站点资料中的站点名称；加载中或异常时回退默认品牌名，不阻断页面交互。
export function useSiteName(): string {
  const { data } = useQuery({
    queryKey: SITE_PROFILE_QUERY_KEY,
    queryFn: ({ signal }) => getPublic<ResponseModelSiteProfileRead>('/system/site-profile', signal),
    staleTime: 60_000,
    retry: false,
  })
  return data?.name?.trim() || DEFAULT_SITE_NAME
}
