/**
 * 图标与 LOGO 上传前零依赖 1:1 适配工具。
 *
 * 用于在浏览器端读取图片真实像素尺寸，并在非正方形时按运营选择的方式
 * （透明底居中留白、白底居中留白、居中裁剪为 1:1 或保留原比例）输出待上传文件；
 * 最终尺寸（≤ 400px）、去 EXIF 与 WebP 压缩仍由后端 Pillow 权威执行。
 */

export type SquareAdaptMode =
  | "contain_transparent"
  | "contain_white"
  | "cover_crop"
  | "original";

export type ImageDimensions = {
  width: number;
  height: number;
};

const MAX_SQUARE_OUTPUT_EDGE = 800;
const NEAR_SQUARE_MAX_PIXEL_DIFF = 2;
const NEAR_SQUARE_MAX_RATIO = 1.02;
const WEBP_QUALITY = 0.9;
const JPEG_QUALITY = 0.92;

function replaceExtension(filename: string, nextExtension: string): string {
  const trimmed = filename.trim();
  if (!trimmed) return `upload.${nextExtension}`;
  const dotIndex = trimmed.lastIndexOf(".");
  if (dotIndex <= 0) return `${trimmed}.${nextExtension}`;
  return `${trimmed.slice(0, dotIndex)}.${nextExtension}`;
}

function canvasToBlob(
  canvas: globalThis.HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): Promise<globalThis.Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

/**
 * 判断图片尺寸是否已接近 1:1 正方形（允许 ≤ 2px 且比例 ≤ 1.02 的导出微小误差）。
 */
export function isNearSquare(width: number, height: number): boolean {
  if (width <= 0 || height <= 0) {
    return true;
  }
  const diff = Math.abs(width - height);
  const ratio = Math.max(width, height) / Math.min(width, height);
  return diff <= NEAR_SQUARE_MAX_PIXEL_DIFF && ratio <= NEAR_SQUARE_MAX_RATIO;
}

/**
 * 读取图片真实像素宽高；环境不支持或浏览器解码异常时返回 null 以便回落原图直传。
 */
export async function readImageDimensions(
  file: globalThis.File,
): Promise<ImageDimensions | null> {
  if (typeof globalThis.createImageBitmap !== "function") {
    return null;
  }
  let bitmap: globalThis.ImageBitmap | null = null;
  try {
    bitmap = await globalThis.createImageBitmap(file);
    if (bitmap.width <= 0 || bitmap.height <= 0) {
      return null;
    }
    return { width: bitmap.width, height: bitmap.height };
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

/**
 * 按选定模式将图片转换为 1:1 正方形文件，或保留原图直接返回。
 */
export async function adaptImageForSquareUpload(
  file: globalThis.File,
  mode: SquareAdaptMode,
): Promise<globalThis.File> {
  if (mode === "original") {
    return file;
  }
  if (
    typeof globalThis.createImageBitmap !== "function" ||
    typeof globalThis.document === "undefined"
  ) {
    throw new Error("当前浏览器不支持图片 1:1 处理，请改选“保留原比例上传”");
  }

  let bitmap: globalThis.ImageBitmap | null = null;
  try {
    bitmap = await globalThis.createImageBitmap(file);
    const { width, height } = bitmap;
    if (width <= 0 || height <= 0) {
      throw new Error("无法读取图片有效尺寸，请更换图片后重试");
    }

    const canvas = globalThis.document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("浏览器画布不可用，请改选“保留原比例上传”");
    }

    if (mode === "cover_crop") {
      // 取居中最大正方形区域并按需缩小至上限边长（只缩不放）。
      const cropSize = Math.min(width, height);
      const sx = Math.floor((width - cropSize) / 2);
      const sy = Math.floor((height - cropSize) / 2);
      const side = Math.min(cropSize, MAX_SQUARE_OUTPUT_EDGE);
      canvas.width = side;
      canvas.height = side;
      context.clearRect(0, 0, side, side);
      context.drawImage(bitmap, sx, sy, cropSize, cropSize, 0, 0, side, side);
    } else {
      // 等比完整居中放入 1:1 正方形画布，不裁切文字与主体图形。
      const longestEdge = Math.max(width, height);
      const side = Math.min(longestEdge, MAX_SQUARE_OUTPUT_EDGE);
      const scale = side / longestEdge;
      const drawWidth = Math.max(1, Math.round(width * scale));
      const drawHeight = Math.max(1, Math.round(height * scale));
      const dx = Math.round((side - drawWidth) / 2);
      const dy = Math.round((side - drawHeight) / 2);

      canvas.width = side;
      canvas.height = side;
      if (mode === "contain_white") {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, side, side);
      } else {
        context.clearRect(0, 0, side, side);
      }
      context.drawImage(bitmap, dx, dy, drawWidth, drawHeight);
    }

    const preserveAlpha = mode === "contain_transparent" || (mode === "cover_crop" && file.type === "image/png");
    let outputBlob = await canvasToBlob(canvas, "image/webp", WEBP_QUALITY);
    let outputMime = "image/webp";
    let outputExt = "webp";

    // 若浏览器不支持 Canvas WebP 编码，需保留透明通道时回落 PNG，否则回落 JPEG。
    if (!outputBlob || outputBlob.type !== "image/webp") {
      if (preserveAlpha) {
        outputBlob = await canvasToBlob(canvas, "image/png");
        outputMime = "image/png";
        outputExt = "png";
      } else {
        outputBlob = await canvasToBlob(canvas, "image/jpeg", JPEG_QUALITY);
        outputMime = "image/jpeg";
        outputExt = "jpg";
      }
    }

    if (!outputBlob || outputBlob.size === 0) {
      throw new Error("图片 1:1 适配导出失败，请改选“保留原比例上传”或更换图片");
    }

    return new globalThis.File([outputBlob], replaceExtension(file.name, outputExt), {
      type: outputMime,
      lastModified: file.lastModified,
    });
  } finally {
    bitmap?.close();
  }
}
