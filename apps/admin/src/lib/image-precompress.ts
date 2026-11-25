/**
 * 管理端超大图轻量预压缩工具。
 *
 * 仅在原始图片体积超过 3 MiB 或长边超过 2400px 时，使用浏览器原生 Canvas
 * 将长边等比预缩至 2400px 并优先导出为 WebP，加快弱网上传速度；
 * 最终尺寸、格式、去 EXIF 与 480px 缩略图仍由后端 Pillow 权威执行。
 */

const PRECOMPRESS_TRIGGER_BYTES = 3 * 1024 * 1024;
const PRECOMPRESS_MAX_EDGE = 2400;
const PRECOMPRESS_QUALITY = 0.88;
const PRECOMPRESS_SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

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
  quality: number,
): Promise<globalThis.Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

export async function precompressImageForUpload(file: globalThis.File): Promise<globalThis.File> {
  if (!PRECOMPRESS_SUPPORTED_TYPES.has(file.type)) {
    return file;
  }
  if (
    typeof globalThis.createImageBitmap !== "function" ||
    typeof globalThis.document === "undefined"
  ) {
    return file;
  }

  let bitmap: globalThis.ImageBitmap | null = null;
  try {
    bitmap = await globalThis.createImageBitmap(file);
    const { width, height } = bitmap;
    const longestEdge = Math.max(width, height);
    const needsResize = longestEdge > PRECOMPRESS_MAX_EDGE;
    const needsShrink = file.size > PRECOMPRESS_TRIGGER_BYTES;
    if (!needsResize && !needsShrink) {
      return file;
    }

    const scale = needsResize ? PRECOMPRESS_MAX_EDGE / longestEdge : 1;
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = globalThis.document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      return file;
    }
    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

    let outputBlob = await canvasToBlob(canvas, "image/webp", PRECOMPRESS_QUALITY);
    let outputMime = "image/webp";
    let outputExt = "webp";

    // 若浏览器不支持 WebP Canvas 编码，回落为 JPEG；PNG 含透明通道则优先交给后端处理。
    if (!outputBlob || outputBlob.type !== "image/webp") {
      if (file.type === "image/png") {
        return file;
      }
      outputBlob = await canvasToBlob(canvas, "image/jpeg", PRECOMPRESS_QUALITY);
      outputMime = "image/jpeg";
      outputExt = "jpg";
    }

    if (!outputBlob || outputBlob.size === 0) {
      return file;
    }
    // 若预缩既未缩小像素又未减小体积，直接上传原图由后端精压。
    if (!needsResize && outputBlob.size >= file.size) {
      return file;
    }

    return new globalThis.File([outputBlob], replaceExtension(file.name, outputExt), {
      type: outputMime,
      lastModified: file.lastModified,
    });
  } catch {
    // 浏览器解码或 Canvas 不可用时静默回落原始文件，由后端 Pillow 权威处理。
    return file;
  } finally {
    bitmap?.close();
  }
}
