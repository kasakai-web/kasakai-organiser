const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function isValidYouTubeVideoUrl(value: string): boolean {
  if (typeof value !== 'string') return false;

  try {
    const url = new URL(value.trim());

    if (!['http:', 'https:'].includes(url.protocol)) return false;

    const hostname = url.hostname.toLowerCase();

    if (hostname === 'youtu.be') {
      const videoId = url.pathname.slice(1);

      return VIDEO_ID_PATTERN.test(videoId);
    }
// link copied when someone watching a video and copy from the address bar of the browser
    if (['youtube.com', 'www.youtube.com'].includes(hostname)) {
      if (url.pathname !== '/watch') return false;

      const videoId = url.searchParams.get('v');

      return VIDEO_ID_PATTERN.test(videoId || '');
    }

    return false;
  } catch {
    return false;
  }
}