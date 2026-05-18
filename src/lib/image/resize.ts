/**
 * Client-side image downscaler. Reads a File, draws it to a canvas at a
 * max dimension, exports as JPEG. ≤800px / quality 0.85 → typically
 * 40-150 KB per photo. Returns a Blob.
 *
 * Why not just upload the original?
 *   - Parents upload from their phones; originals are 4-8 MB.
 *   - We have 100 kids × 1 photo each. At 100 KB each that's 10 MB total.
 *   - Wristband print needs ~200px ID-card sized images max; 800 is plenty.
 */

export type ResizeOptions = {
  maxDimension?: number;   // default 800
  quality?: number;        // 0..1, default 0.85
  mimeType?: string;       // default "image/jpeg"
};

export async function resizeImageFile(
  file: File,
  opts: ResizeOptions = {},
): Promise<Blob> {
  const maxDim = opts.maxDimension ?? 800;
  const quality = opts.quality ?? 0.85;
  const mime = opts.mimeType ?? "image/jpeg";

  if (!file.type.startsWith("image/")) {
    throw new Error("Not an image file");
  }

  const img = await loadImage(file);
  const { width, height } = scaledDimensions(img.naturalWidth, img.naturalHeight, maxDim);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");
  // White background in case the source has transparency and target is JPEG
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error("canvas.toBlob returned null"));
        resolve(blob);
      },
      mime,
      quality,
    );
  });
}

export function scaledDimensions(
  srcW: number,
  srcH: number,
  maxDim: number,
): { width: number; height: number } {
  if (srcW <= maxDim && srcH <= maxDim) return { width: srcW, height: srcH };
  if (srcW >= srcH) {
    return { width: maxDim, height: Math.round((srcH * maxDim) / srcW) };
  }
  return { width: Math.round((srcW * maxDim) / srcH), height: maxDim };
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not decode image"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
