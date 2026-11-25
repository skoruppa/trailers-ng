import { BROWSER_USER_AGENT, decodeHtml, fetchText, httpsUrl } from '../http.js';
import { createLimiter, limitFetcher } from '../limiter.js';

const MAX_VIDEOS = 6;
const TRAILER_NAME = /bande-annonce|teaser|trailer|tr[aá]i?l?er|fragman/i;
const TEASER_NAME = /teaser/i;

export const WEBEDIA_SITES = {
  fr: {
    source: 'allocine',
    origin: 'https://www.allocine.fr',
    list: id => `/videos/fichefilm-${id}/toutes/`,
    link: id => new RegExp(`href=["'](/video/player_gen_cmedia=(\\d+)&(?:amp;)?cfilm=${id}\\.html)["']`, 'g'),
    local: /\b(VF|VOST|VOSTFR)\b/,
    original: /\bVO\b/,
    unmarked: 'original'
  },
  de: {
    source: 'filmstarts',
    origin: 'https://www.filmstarts.de',
    list: id => `/kritiken/${id}/trailers/`,
    link: id => new RegExp(`href=["'](/kritiken/${id}/trailer/(\\d+)\\.html)["']`, 'g'),
    local: /\b(DF|OmU|Deutsch)\b/,
    original: /\b(OV|OmeU)\b/,
    unmarked: 'original'
  },
  es: {
    source: 'sensacine',
    origin: 'https://www.sensacine.com',
    list: id => `/peliculas/pelicula-${id}/trailers/todas/`,
    link: id => new RegExp(`href=["'](/peliculas/pelicula-${id}/trailer-(\\d+)/)["']`, 'g'),
    local: /\b(VOSE|Subtitulado|Doblado|Español|Castellano)\b/i,
    original: /\bVO\b/,
    unmarked: 'local'
  },
  pt: {
    source: 'adorocinema',
    origin: 'https://www.adorocinema.com',
    list: id => `/filmes/filme-${id}/trailers/`,
    link: id => new RegExp(`href=["'](/filmes/filme-${id}/trailer-(\\d+)/)["']`, 'g'),
    local: /\b(Dublado|Legendado)\b/i,
    original: /\bOriginal\b/i,
    unmarked: 'original'
  },
  tr: {
    source: 'beyazperde',
    origin: 'https://www.beyazperde.com',
    list: id => `/filmler/film-${id}/fragman/tum/`,
    link: id => new RegExp(`href=["'](/filmler/film-${id}/fragman-(\\d+)/)["']`, 'g'),
    local: /(Dublajlı|Altyazılı|Türkçe)/i,
    original: /\bOrijinal\b/i,
    unmarked: 'original'
  }
};

const schedule = createLimiter({ concurrency: 2, intervalMs: 200, maxWaitMs: 4000 });

export function versionLanguage(site, name, language, originalLanguage) {
  if (site.local.test(name)) return language;
  if (site.original.test(name)) return originalLanguage ?? null;
  return site.unmarked === 'local' ? language : (originalLanguage ?? null);
}

export function parseVideoLinks(html, site, id) {
  if (typeof html !== 'string') return [];
  const seen = new Set();
  const links = [];
  for (const [, path, media] of html.matchAll(site.link(id))) {
    if (seen.has(media)) continue;
    seen.add(media);
    links.push(decodeHtml(path));
  }
  return links;
}

function isoSeconds(value) {
  const match = typeof value === 'string' ? /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value) : null;
  if (!match) return null;
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return seconds > 0 ? seconds : null;
}

export function parseVideoObject(html) {
  if (typeof html !== 'string') return null;
  for (const [, body] of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      continue;
    }
    for (const item of Array.isArray(data) ? data : [data]) {
      if (item?.['@type'] !== 'VideoObject') continue;
      const url = httpsUrl(item.contentUrl);
      if (!url || !new URL(url).hostname.endsWith('.acsta.net') || !new URL(url).pathname.endsWith('.mp4')) return null;
      const thumbnail = Array.isArray(item.thumbnailUrl) ? item.thumbnailUrl[0] : item.thumbnailUrl;
      return {
        url,
        name: typeof item.name === 'string' ? decodeHtml(item.name).trim() : '',
        thumbnail: httpsUrl(thumbnail),
        durationSec: isoSeconds(item.duration)
      };
    }
  }
  return null;
}

export async function webediaTrailers(fetcher, { allocine, originalLanguage }, language) {
  const site = WEBEDIA_SITES[language];
  if (!site || !allocine) return [];
  fetcher = limitFetcher(fetcher, schedule);
  const headers = { 'User-Agent': BROWSER_USER_AGENT };
  const listing = await fetchText(fetcher, `${site.origin}${site.list(allocine)}`, { headers, strict: true });
  const links = parseVideoLinks(listing, site, allocine).slice(0, MAX_VIDEOS * 2);

  const videos = await Promise.all(
    links.map(async path => parseVideoObject(await fetchText(fetcher, `${site.origin}${path}`, { headers })))
  );
  return videos
    .filter(video => video && TRAILER_NAME.test(video.name))
    .map(video => ({ ...video, lang: versionLanguage(site, video.name, language, originalLanguage) }))
    .filter(video => video.lang)
    .sort((a, b) => Number(b.lang === language) - Number(a.lang === language))
    .slice(0, MAX_VIDEOS)
    .map(video => ({
      source: site.source,
      url: video.url,
      title: video.name,
      thumbnail: video.thumbnail,
      durationSec: video.durationSec,
      height: null,
      lang: video.lang,
      kind: TEASER_NAME.test(video.name) ? 'teaser' : 'trailer'
    }));
}
