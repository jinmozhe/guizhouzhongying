import type { AdminSiteSettingRead, SiteProfileRead } from "@pinjie/api-client";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { adminApi } from "./api/admin";

// 公共站点资料查询键，供布局外壳、登录页和系统设置页共享同一份服务端缓存。
export const SITE_PROFILE_QUERY_KEY = ["system", "site-profile"] as const;

const DEFAULT_SITE_NAME = "贵州众赢";

export type ResolvedSiteBrand = {
  siteName: string;
  adminTitle: string;
  footerText: string;
  copyrightText: string;
  logoUrl?: string;
};

// 按公开站点资料推导管理后台标题、页脚、版权与 LOGO，未配置时回退默认品牌。
export function resolveSiteBrand(
  profile?: Pick<SiteProfileRead, "name" | "logo_url"> | null,
): ResolvedSiteBrand {
  const siteName = profile?.name.trim() || DEFAULT_SITE_NAME;
  const adminTitle = siteName.endsWith("管理后台") ? siteName : `${siteName}管理后台`;
  return {
    siteName,
    adminTitle,
    footerText: `${adminTitle} · ${siteName}`,
    copyrightText: `${siteName} © 2026`,
    logoUrl: profile?.logo_url ?? undefined,
  };
}

// 从后台站点设置写入结果同步更新公开站点资料缓存，使界面无需刷新即可生效。
export function syncSiteProfileCache(
  queryClient: QueryClient,
  setting: AdminSiteSettingRead,
): void {
  const profile: SiteProfileRead = {
    name: setting.name,
    logo_url: setting.logo?.url ?? null,
    title: setting.title,
    keywords: setting.keywords,
    description: setting.description,
  };
  queryClient.setQueryData(SITE_PROFILE_QUERY_KEY, profile);
}

export function useSiteBrand(): ResolvedSiteBrand {
  const { data } = useQuery({
    queryKey: SITE_PROFILE_QUERY_KEY,
    queryFn: adminApi.siteProfile,
    staleTime: 60_000,
    retry: false,
  });
  return resolveSiteBrand(data);
}

// 同步更新浏览器标签页标题，与动态站点名称保持一致。
export function useDocumentBrandTitle(adminTitle: string): void {
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.title = adminTitle;
    }
  }, [adminTitle]);
}
