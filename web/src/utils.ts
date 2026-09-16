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
      : contentType.includes('audio')
        ? (contentType.includes('wav') ? '.wav' : contentType.includes('flac') ? '.flac' : '.mp3')
        : url.includes('.png') ? '.png' : url.includes('.webp') ? '.webp' : url.includes('.mp4') ? '.mp4' : url.includes('.mp3') ? '.mp3' : '.jpg';
    const fallbackName = ext === '.mp4' ? 'video' : (ext === '.mp3' || ext === '.wav' || ext === '.flac') ? 'audio' : 'image';
    // 语音的「alt」是整段文本，文件名截短以免超出系统限制。
    a.download = (alt ? alt.slice(0, 80) : fallbackName) + ext;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch {
    window.open(url, '_blank');
  }
}
