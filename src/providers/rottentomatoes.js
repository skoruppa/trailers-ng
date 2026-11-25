import { BROWSER_USER_AGENT, fetchText, httpsUrl } from '../http.js';
import { nominalHeight } from '../hls.js';

const KINDS = { TRAILER: 'trailer', TEASER: 'teaser' };
const MAX_VIDEOS = 6;

export function parseVideoList(html) {
  const match = html?.match(/<script\s+id="videos"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return [];
  try {
    const videos = JSON.parse(match[1]);
    return Array.isArray(videos) ? videos : [];
  } catch {
    return [];
  }
}

function attributes(tag) {
  return Object.fromEntries(Array.from(tag.matchAll(/([\w-]+)="([^"]*)"/g), ([, name, value]) => [name, value]));
}

export function bestSmilVideo(smil) {
  const videos = Array.from(smil?.matchAll(/<video\b[^>]*>/gi) ?? [], ([tag]) => attributes(tag))
    .map(video => ({ url: httpsUrl(video.src), height: nominalHeight(video.width, video.height) ?? 0 }))
    .filter(video => video.url && new URL(video.url).hostname === 'video.fandango.com' && video.url.endsWith('.mp4'));
  videos.sort((a, b) => b.height - a.height);
  return videos[0] ?? null;
}

async function resolveFile(fetcher, file) {
  const url = httpsUrl(file);
  if (!url) return null;
  const host = new URL(url).hostname;
  if (host === 'link.theplatform.com') {
    const smil = await fetchText(fetcher, `${url.split('?')[0]}?format=SMIL`, {
      headers: { Accept: 'application/smil+xml' }
    });
    return bestSmilVideo(smil);
  }
  if (host === 'video.fandango.com' && url.split('?')[0].endsWith('.mp4')) return { url, height: null };
  return null;
}

function cleanTitle(title) {
  return typeof title === 'string' ? title.trim() : '';
}

export async function rottenTomatoesTrailers(fetcher, { rottenTomatoes }) {
  if (!rottenTomatoes) return [];
  const html = await fetchText(fetcher, `https://www.rottentomatoes.com/${rottenTomatoes}/videos`, {
    headers: { 'User-Agent': BROWSER_USER_AGENT },
    strict: true
  });
  const videos = parseVideoList(html)
    .filter(video => KINDS[video?.videoType])
    .slice(0, MAX_VIDEOS);

  const trailers = await Promise.all(
    videos.map(async video => {
      const file = await resolveFile(fetcher, video.file);
      if (!file) return null;
      const duration = Number(video.durationInSeconds);
      const description = cleanTitle(video.description);
      return {
        source: 'rottentomatoes',
        url: file.url,
        title: cleanTitle(video.title) || 'Trailer',
        description: description || null,
        thumbnail: httpsUrl(video.image) ?? httpsUrl(video.thumbnail),
        durationSec: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
        height: file.height,
        lang: 'en',
        kind: KINDS[video.videoType]
      };
    })
  );
  return trailers.filter(Boolean);
}
