import { BROWSER_USER_AGENT, decodeHtml, fetchText, httpsUrl } from '../http.js';
import { describePlaylist } from '../hls.js';

const PREVIEW_HOSTS = new Set(['play.itunes.apple.com', 'play-edge.itunes.apple.com']);

function metaContent(html, attribute, name) {
  const pattern = new RegExp(`<meta\\b[^>]*\\b${attribute}=["']${name}["'][^>]*\\bcontent=["']([^"']+)["']`, 'i');
  const match = html.match(pattern);
  return match ? decodeHtml(match[1]) : null;
}

export function parseApplePage(html) {
  if (typeof html !== 'string') return null;
  const video = httpsUrl(metaContent(html, 'property', 'og:video:secure_url') ?? metaContent(html, 'property', 'og:video'));
  if (!video) return null;
  const url = new URL(video);
  if (!PREVIEW_HOSTS.has(url.hostname) || !url.pathname.endsWith('.m3u8')) return null;
  return {
    url: url.href,
    title: metaContent(html, 'name', 'apple:title'),
    thumbnail: httpsUrl(metaContent(html, 'property', 'og:image'))
  };
}

export async function applePreview(fetcher, { id, kind }, storefront) {
  const html = await fetchText(fetcher, `https://tv.apple.com/${storefront}/${kind}/${id}`, {
    headers: { 'User-Agent': BROWSER_USER_AGENT },
    strict: true
  });
  const page = parseApplePage(html);
  if (!page) return null;
  const playlist = await fetchText(fetcher, page.url, { strict: true });
  const details = describePlaylist(playlist);
  if (!details || details.protected) return null;
  return { ...page, audio: details.audio, height: details.height };
}
