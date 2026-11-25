import { storefrontFor } from './config.js';
import { applePreview } from './providers/apple.js';
import { filmwebTrailers, findFilmwebId } from './providers/filmweb.js';
import { plexTrailers } from './providers/plex.js';
import { rottenTomatoesTrailers } from './providers/rottentomatoes.js';
import { lookupIds } from './providers/wikidata.js';
import { cinemetaTrailers, tmdbTrailers } from './providers/youtube.js';
import { WEBEDIA_SITES, webediaTrailers } from './providers/webedia.js';
import { selectTrailers } from './select.js';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;
const RECENT_DAYS = 180;
const ENOUGH_DIRECT_TRAILERS = 2;
const MAX_YOUTUBE_TRAILERS = 4;

export function isRecent(released, now = Date.now()) {
  const time = released ? Date.parse(released) : NaN;
  if (!Number.isFinite(time)) return true;
  return now - time < RECENT_DAYS * DAY * 1000;
}

export function sourcePolicy(released, now) {
  const recent = isRecent(released, now);
  return value => {
    const found = Array.isArray(value) ? value.length > 0 : Boolean(value);
    if (recent) return { fresh: found ? 12 * HOUR : 4 * HOUR, keep: 30 * DAY };
    return { fresh: found ? 7 * DAY : 2 * DAY, keep: 60 * DAY };
  };
}

export function idsPolicy(ids) {
  if (!ids) return { fresh: DAY, keep: DAY };
  const complete = Boolean(ids.apple && ids.rottenTomatoes && ids.filmweb);
  return complete ? { fresh: 365 * DAY, keep: 730 * DAY } : { fresh: 30 * DAY, keep: 365 * DAY };
}

export function appleCacheKey(storefront, apple) {
  return `apple:v1:${storefront}:${apple.kind}:${apple.id}`;
}

export function appleTrailers(preview, languages, storefront, apple, origin) {
  if (!preview) return [];
  return languages
    .filter(language => preview.audio.includes(language))
    .map(language => ({
      source: 'apple',
      url:
        preview.audio.length === 1
          ? preview.url
          : `${origin}/hls/${language}/${storefront}/${apple.kind}/${apple.id}.m3u8`,
      title: 'Trailer',
      thumbnail: preview.thumbnail,
      durationSec: null,
      height: preview.height,
      lang: language,
      kind: 'trailer'
    }));
}

export async function resolveTrailers({ fetcher, cached, waitUntil, ref, type, config, origin, tmdbApiKey, plexToken }) {
  const options = { waitUntil };
  const ids = await cached(`ids:v4:${type}:${ref.key}`, idsPolicy, () => lookupIds(fetcher, ref, type), options).catch(() => null);
  const imdbId = ids?.imdbId ?? ref.imdbId ?? null;
  const tmdbId = ids?.tmdbId ?? ref.tmdbId ?? null;
  const preferred = config.lang;
  const useEnglish = preferred === 'en' || config.english;
  const languages = useEnglish && preferred !== 'en' ? [preferred, 'en'] : [preferred];
  const policy = sourcePolicy(ids?.released);
  const tasks = [];

  if (useEnglish && imdbId) {
    tasks.push(cached(`plex:v1:${type}:${imdbId}`, policy, () => plexTrailers(fetcher, cached, { imdbId, type }, { plexToken }), options));
    if (ids?.rottenTomatoes) {
      tasks.push(cached(`rt:v1:${ids.rottenTomatoes}`, policy, () => rottenTomatoesTrailers(fetcher, ids), options));
    }
  }
  if (preferred === 'pl' && ids) {
    tasks.push(
      resolveFilmwebId({ fetcher, cached, options, ids, key: ref.key, type }).then(filmweb =>
        filmweb
          ? cached(`filmweb:v3:${filmweb}`, policy, () => filmwebTrailers(fetcher, { filmweb, originalLanguage: ids.originalLanguage }), options)
          : []
      )
    );
  }
  if (WEBEDIA_SITES[preferred] && ids?.allocine) {
    tasks.push(
      cached(`webedia:v1:${preferred}:${ids.allocine}`, policy, () => webediaTrailers(fetcher, ids, preferred), options)
    );
  }
  if (ids?.apple) {
    for (const language of languages) {
      const storefront = storefrontFor(language);
      tasks.push(
        cached(appleCacheKey(storefront, ids.apple), policy, () => applePreview(fetcher, ids.apple, storefront), options).then(
          preview => appleTrailers(preview, [language], storefront, ids.apple, origin)
        )
      );
    }
  }

  const [results, youtube] = await Promise.all([
    Promise.all(tasks.map(task => task.catch(() => []))),
    config.youtube ? youtubeTrailers({ fetcher, cached, options, policy, ref, imdbId, tmdbId, type, languages, tmdbApiKey }) : []
  ]);
  const direct = withOrder(results);
  const title = ids?.title ?? null;

  const preferredDirect = selectTrailers(direct, [preferred]);
  const preferredYoutube =
    preferredDirect.length >= ENOUGH_DIRECT_TRAILERS
      ? []
      : youtube.filter(trailer => trailer.lang === preferred).slice(0, MAX_YOUTUBE_TRAILERS);
  const preferredList = selectTrailers([...direct, ...withOrder([preferredYoutube])], [preferred]);
  if (preferredList.length || !useEnglish) return { title, trailers: preferredList };

  const englishDirect = selectTrailers(direct, ['en']);
  if (englishDirect.length) return { title, trailers: englishDirect };
  const englishYoutube = youtube.filter(trailer => trailer.lang === 'en').slice(0, MAX_YOUTUBE_TRAILERS);
  return { title, trailers: selectTrailers(withOrder([englishYoutube]), ['en']) };
}

const filmwebIdPolicy = id => (id ? { fresh: 365 * DAY, keep: 730 * DAY } : { fresh: 30 * DAY, keep: 30 * DAY });

function resolveFilmwebId({ fetcher, cached, options, ids, key, type }) {
  if (ids.filmweb) return Promise.resolve(ids.filmweb);
  const year = ids.released ? Number(ids.released.slice(0, 4)) : null;
  return cached(
    `filmweb-id:v1:${key}`,
    filmwebIdPolicy,
    () => findFilmwebId(fetcher, { titles: ids.titles, year, type }),
    options
  ).catch(() => null);
}

function withOrder(lists) {
  return lists.flatMap(list => (Array.isArray(list) ? list.map((trailer, order) => ({ ...trailer, order })) : []));
}

async function youtubeTrailers({ fetcher, cached, options, policy, ref, imdbId, tmdbId, type, languages, tmdbApiKey }) {
  if (tmdbApiKey && (imdbId || tmdbId)) {
    const sorted = [...languages].sort();
    const fromTmdb = await cached(
      `tmdb-videos:v1:${type}:${tmdbId ? `tmdb:${tmdbId}` : imdbId}:${sorted.join(',')}`,
      policy,
      () => tmdbTrailers(fetcher, { imdbId, tmdbId, type }, tmdbApiKey, sorted),
      options
    ).catch(() => []);
    if (fromTmdb.some(trailer => languages.includes(trailer.lang)) || !languages.includes('en')) return fromTmdb;
  }
  if (!languages.includes('en') || !imdbId) return [];
  return cached(`cinemeta:v1:${type}:${imdbId}`, policy, () => cinemetaTrailers(fetcher, { imdbId, type }), options).catch(
    () => []
  );
}
