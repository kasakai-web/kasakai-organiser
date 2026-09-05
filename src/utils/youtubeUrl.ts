

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;


export function isValidYouTubeVideoUrl(value: string): boolean {
  if (typeof value !== 'string') return false;

  try {
    const url = new URL(value.trim());

    if (!['http:', 'https:'].includes(url.protocol)) return false;

    if (!['youtube.com', 'www.youtube.com'].includes(url.hostname.toLowerCase())) {
      return false;
    }

    if (url.pathname !== '/watch') return false;

    const videoId = url.searchParams.get('v');

    return VIDEO_ID_PATTERN.test(videoId || '');
  } catch {
    return false;
  }
}
