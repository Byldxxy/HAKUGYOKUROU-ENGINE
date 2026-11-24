const pngPrefix = 'data:image/png;base64,';
const maxEncodedLength = pngPrefix.length + 4 * Math.ceil(128 * 1024 / 3);

/** Keep the portrait and character sheet within the existing JSON request limit. */
export async function preparePortrait(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
    throw new Error('请选择 JPG、PNG、WebP 或 GIF 图片。');
  }
  const src = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error();
    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    for (let edge = Math.min(512, longest); edge > 0; edge = Math.floor(edge / 1.5)) {
      canvas.width = Math.max(1, Math.round(img.naturalWidth * edge / longest));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * edge / longest));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const portrait = canvas.toDataURL('image/png');
      if (portrait.startsWith(pngPrefix) && portrait.length <= maxEncodedLength) return portrait;
    }
    throw new Error();
  } catch {
    throw new Error('无法读取这张图片，请重新选择。');
  } finally {
    URL.revokeObjectURL(src);
  }
}
