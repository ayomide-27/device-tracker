import { CFG } from './config.js';

// Shrinks a camera photo to a small JPEG (phones take 4-8 MB pictures; the server accepts 600 KB).
async function loadBitmap(file) {
  if (globalThis.createImageBitmap) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fall through to the <img> route */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (canvas, quality) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

export async function compressPhoto(file) {
  const bitmap = await loadBitmap(file);
  const width = bitmap.width || bitmap.naturalWidth;
  const height = bitmap.height || bitmap.naturalHeight;

  // Try progressively smaller until it fits the size limit.
  for (const [edge, quality] of [[CFG.PHOTO_MAX_EDGE, 0.7], [800, 0.6], [600, 0.5]]) {
    const scale = Math.min(1, edge / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await toBlob(canvas, quality);
    if (blob && blob.size <= CFG.PHOTO_MAX_BYTES) return blob;
  }
  throw new Error('Photo is too large');
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
