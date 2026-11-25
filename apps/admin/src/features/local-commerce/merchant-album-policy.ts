import type { AssetRead, MerchantAlbumImageRead } from "@pinjie/api-client";

export const MERCHANT_ALBUM_MAX_COUNT = 20;
export const MERCHANT_ALBUM_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MERCHANT_ALBUM_MAX_TOTAL_BYTES = 50 * 1024 * 1024;

/** 将统一资产转换为商家相册展示项。 */
export function assetToAlbumImage(asset: AssetRead): MerchantAlbumImageRead {
  return {
    asset_id: asset.id,
    url: asset.url,
    thumb_url: asset.thumb_url ?? null,
    original_name: asset.original_name,
    file_size: asset.file_size,
    width: asset.width ?? null,
    height: asset.height ?? null,
    frame_count: asset.frame_count ?? null,
  };
}

/** 校验商家相册集合的数量、唯一性、静态图尺寸元数据及体积预算。 */
export function validateMerchantAlbum(images: MerchantAlbumImageRead[]): string | undefined {
  if (images.length > MERCHANT_ALBUM_MAX_COUNT) {
    return `商家相册最多支持 ${MERCHANT_ALBUM_MAX_COUNT} 张图片`;
  }
  if (new Set(images.map((image) => image.asset_id)).size !== images.length) {
    return "该图片已在相册中，请勿重复选择";
  }
  let totalBytes = 0;
  for (const image of images) {
    if (!image.width || !image.height || !image.frame_count) {
      return "图片尺寸未核验，请先完成资产尺寸回填或重新上传";
    }
    if (image.frame_count !== 1) {
      return "商家相册仅支持静态图片，不支持动图";
    }
    if (image.file_size > MERCHANT_ALBUM_MAX_FILE_BYTES) {
      return "商家相册单张图片不能超过 5 MiB";
    }
    totalBytes += image.file_size;
  }
  if (totalBytes > MERCHANT_ALBUM_MAX_TOTAL_BYTES) {
    return "商家相册整组图片总大小不能超过 50 MiB";
  }
  return undefined;
}
