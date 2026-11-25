import { BROWSER_USER_AGENT, decodeHtml, fetchJson, fetchText, httpsUrl } from '../http.js';
import { createLimiter, limitFetcher } from '../limiter.js';

const ORIGIN = 'https://www.filmweb.pl';
const IMAGE_ORIGIN = 'https://fwcdn.pl/webv';
const HEADERS = { 'User-Agent': BROWSER_USER_AGENT, 'x-locale': 'pl_PL' };
const MAX_VIDEOS = 6;
const POLISH_VERSION = /\bpolsk(?:i|ie)\b/i;

export function isPolishVersion(name) {
  return POLISH_VERSION.test(name ?? '');
}
const FOREIGN_VERSION = /\b(francuski|niemiecki|angielski|hiszpa[nń]ski|w[lł]oski|japo[nń]ski|korea[nń]ski|rosyjski|chi[nń]ski|czeski|szwedzki|du[nń]ski|norweski|ukrai[nń]ski|portugalski|turecki|w[eę]gierski|holenderski|fi[nń]ski)\b/i;
const MAX_SEARCH_CANDIDATES = 5;
const schedule = createLimiter({ concurrency: 2, intervalMs: 200, maxWaitMs: 4000 });

export function parseFilmwebVideoPage(html) {
  if (typeof html !== 'string') return null;
  const content = html.match(/itemprop=["']contentUrl["'][^>]*\bcontent=["']([^"']+)["']/i);
  const url = httpsUrl(content ? decodeHtml(content[1]) : null);
  if (!url || new URL(url).hostname !== 'fwcdn.pl' || !/\.(mp4|webm)$/i.test(new URL(url).pathname)) return null;
  const name = html.match(/data-video-name=["']([^"']+)["']/i);
  const thumbnail = html.match(/itemprop=["']thumbnailUrl["'][^>]*\bcontent=["']([^"']+)["']/i);
  const height = Number(url.match(/\.(\d{3,4})p\.(?:mp4|webm)$/i)?.[1]);
  return {
    url,
    name: name ? decodeHtml(name[1]).trim() : null,
    thumbnail: httpsUrl(thumbnail ? decodeHtml(thumbnail[1]) : null),
    height: height || null
  };
}

function thumbnailUrl(path) {
  return typeof path === 'string' && /^\/[\w/.$-]+\.jpg$/.test(path) ? `${IMAGE_ORIGIN}${path.replace('$', '6')}` : null;
}

export function parseFilmwebVideoList(html) {
  if (typeof html !== 'string') return [];
  const seen = new Set();
  const videos = [];
  for (const [, category, slug, id] of html.matchAll(/href=["']\/video\/(Zwiastun|Teaser)\/([^"'#]+)-(\d+)["']/g)) {
    if (seen.has(id)) continue;
    seen.add(id);
    let name;
    try {
      name = decodeURIComponent(slug.replace(/\+/g, ' '));
    } catch {
      name = slug;
    }
    if (FOREIGN_VERSION.test(name)) continue;
    videos.push({ id: Number(id), kind: category === 'Teaser' ? 'teaser' : 'trailer', name });
  }
  return videos
    .sort(
      (a, b) =>
        Number(isPolishVersion(b.name)) - Number(isPolishVersion(a.name)) ||
        Number(a.kind === 'teaser') - Number(b.kind === 'teaser')
    )
    .slice(0, MAX_VIDEOS);
}

async function listVideos(fetcher, filmweb) {
  const html = await fetchText(fetcher, `${ORIGIN}/film/x-0-${filmweb}/video`, { headers: HEADERS, strict: true });
  const fromPage = parseFilmwebVideoList(html);
  if (fromPage.length) return fromPage;
  const videos = await fetchJson(fetcher, `${ORIGIN}/api/v1/film/${filmweb}/videos`, { headers: HEADERS, strict: true });
  if (!Array.isArray(videos)) return [];
  return videos
    .filter(video => video?.type === 'trailer' && Number.isSafeInteger(video.id))
    .slice(0, MAX_VIDEOS)
    .map(video => ({ id: video.id, kind: 'trailer', name: null, thumbnail: thumbnailUrl(video.thumbnail) }));
}

export async function filmwebTrailers(fetcher, { filmweb, originalLanguage }) {
  if (!filmweb) return [];
  fetcher = limitFetcher(fetcher, schedule);
  const videos = await listVideos(fetcher, filmweb);
  const trailers = await Promise.all(
    videos.map(async video => {
      const html = await fetchText(fetcher, `${ORIGIN}/video/trailer/x-${video.id}`, { headers: HEADERS });
      const page = parseFilmwebVideoPage(html);
      if (!page) return null;
      const title = page.name || video.name || 'Zwiastun';
      const lang = isPolishVersion(title) || isPolishVersion(video.name) ? 'pl' : originalLanguage;
      if (!lang) return null;
      return {
        source: 'filmweb',
        url: page.url,
        title,
        thumbnail: page.thumbnail ?? video.thumbnail ?? null,
        durationSec: null,
        height: page.height,
        lang,
        kind: video.kind
      };
    })
  );
  return trailers.filter(Boolean);
}

export function normalizeTitle(value) {
  return typeof value === 'string'
    ? value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'l').toLowerCase().replace(/[^a-z0-9]+/g, '')
    : '';
}

function matchesTitle(info, titles) {
  const wanted = new Set(titles.map(normalizeTitle).filter(Boolean));
  return [info?.title, info?.originalTitle].some(title => wanted.has(normalizeTitle(title)));
}

export async function findFilmwebId(fetcher, { titles, year, type }) {
  if (!Array.isArray(titles) || !titles.length || !Number.isInteger(year)) return null;
  fetcher = limitFetcher(fetcher, schedule);
  const kind = type === 'series' ? 'serial' : 'film';
  const checked = new Set();
  for (const title of titles) {
    const search = await fetchJson(fetcher, `${ORIGIN}/api/v1/live/search?query=${encodeURIComponent(title)}`, {
      headers: HEADERS,
      strict: true
    });
    const candidates = (search?.searchHits ?? [])
      .filter(hit => hit?.type === kind && Number.isSafeInteger(hit.id) && !checked.has(hit.id))
      .slice(0, MAX_SEARCH_CANDIDATES);
    for (const candidate of candidates) {
      checked.add(candidate.id);
      const info = await fetchJson(fetcher, `${ORIGIN}/api/v1/film/${candidate.id}/info`, { headers: HEADERS, strict: true });
      if (Number.isInteger(info?.year) && Math.abs(info.year - year) <= 1 && matchesTitle(info, titles)) {
        return String(candidate.id);
      }
    }
  }
  return null;
}
