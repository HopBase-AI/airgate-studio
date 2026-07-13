export async function downloadImage(url: string, alt: string) {
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    const contentType = resp.headers.get('content-type') || '';
    const ext = contentType.includes('video')
      ? '.mp4'
      : url.includes('.png') ? '.png' : url.includes('.webp') ? '.webp' : url.includes('.mp4') ? '.mp4' : '.jpg';
    a.download = (alt || (ext === '.mp4' ? 'video' : 'image')) + ext;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch {
    window.open(url, '_blank');
  }
}
