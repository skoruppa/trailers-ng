import { fetchJson } from '../http.js';

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const TMDB = 'https://api.themoviedb.org/3';
const CINEMETA = 'https://v3-cinemeta.strem.io';
const KINDS = { Trailer: 'trailer', Teaser: 'teaser' };

function thumbnail(ytId) {
  return `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
}

function youtubeTrailer({ ytId, title, lang, kind }) {
  return { source: 'youtube', ytId, title: title || 'Trailer', thumbnail: thumbnail(ytId), durationSec: null, height: null, lang, kind };
}

function tmdbRequest(path, apiKey, params = {}) {
  const url = new URL(`${TMDB}/${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  if (apiKey.length > 40) return { url: url.href, headers: { Authorization: `Bearer ${apiKey}` } };
  url.searchParams.set('api_key', apiKey);
  return { url: url.href, headers: {} };
}

export function tmdbVideosToTrailers(videos) {
  if (!Array.isArray(videos)) return [];
  return videos
    .filter(video => video?.site === 'YouTube' && YOUTUBE_ID.test(video.key ?? '') && KINDS[video.type])
    .filter(video => typeof video.iso_639_1 === 'string' && /^[a-z]{2}$/.test(video.iso_639_1))
    .sort(
      (a, b) =>
        Number(b.type === 'Trailer') - Number(a.type === 'Trailer') ||
        Number(b.official === true) - Number(a.official === true) ||
        String(b.published_at ?? '').localeCompare(String(a.published_at ?? ''))
    )
    .map(video => youtubeTrailer({ ytId: video.key, title: video.name?.trim(), lang: video.iso_639_1, kind: KINDS[video.type] }));
}

export async function tmdbTrailers(fetcher, { imdbId, tmdbId, type }, apiKey, languages) {
  const media = type === 'series' ? 'tv' : 'movie';
  let id = Number(tmdbId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    if (!imdbId) return [];
    const find = tmdbRequest(`find/${imdbId}`, apiKey, { external_source: 'imdb_id' });
    const found = await fetchJson(fetcher, find.url, { headers: find.headers, strict: true });
    id = (type === 'series' ? found?.tv_results : found?.movie_results)?.[0]?.id;
    if (!Number.isSafeInteger(id)) return [];
  }
  const videos = tmdbRequest(`${media}/${id}/videos`, apiKey, {
    include_video_language: languages.join(',')
  });
  const data = await fetchJson(fetcher, videos.url, { headers: videos.headers, strict: true });
  return tmdbVideosToTrailers(data?.results);
}

export function cinemetaToTrailers(meta) {
  const name = typeof meta?.name === 'string' ? meta.name.trim() : '';
  const fromStreams = (Array.isArray(meta?.trailerStreams) ? meta.trailerStreams : [])
    .filter(stream => YOUTUBE_ID.test(stream?.ytId ?? ''))
    .map(stream => ({ ytId: stream.ytId, title: stream.title?.trim() || name }));
  const fromLegacy = (Array.isArray(meta?.trailers) ? meta.trailers : [])
    .filter(trailer => YOUTUBE_ID.test(trailer?.source ?? '') && trailer.type !== 'Clip')
    .map(trailer => ({ ytId: trailer.source, title: name }));
  const seen = new Set();
  return [...fromStreams, ...fromLegacy]
    .filter(item => !seen.has(item.ytId) && seen.add(item.ytId))
    .map(item => youtubeTrailer({ ...item, lang: 'en', kind: 'trailer' }));
}

export async function cinemetaTrailers(fetcher, { imdbId, type }) {
  const data = await fetchJson(fetcher, `${CINEMETA}/meta/${type}/${imdbId}.json`, { strict: true });
  return cinemetaToTrailers(data?.meta);
}
