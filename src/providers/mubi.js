import { BROWSER_USER_AGENT, fetchJson, httpsUrl } from '../http.js';

const API = 'https://api.mubi.com/v3/films';
const COUNTRIES = { en: 'US', pl: 'PL', fr: 'FR', de: 'DE', es: 'ES', it: 'IT', pt: 'BR', cs: 'CZ', hu: 'HU', tr: 'TR', ja: 'JP' };

export function mubiCountry(language) {
  return COUNTRIES[language] ?? null;
}

export function trailerLanguage(url) {
  return /_([a-z]{2})_[a-z]{2}_[\d.]+_\d+_\d+_\d+\.mp4$/.exec(url ?? '')?.[1] ?? null;
}

function bestTrailer(film) {
  const options = (Array.isArray(film?.optimised_trailers) ? film.optimised_trailers : [])
    .map(item => ({ url: httpsUrl(item?.url), height: Number(/^(\d+)p$/.exec(item?.profile ?? '')?.[1]) || 0 }))
    .filter(item => item.url);
  options.sort((a, b) => b.height - a.height);
  if (options.length) return options[0];
  const url = httpsUrl(film?.trailer_url);
  return url ? { url, height: Number(/\/(\d+)p-/.exec(url)?.[1]) || 0 } : null;
}

export function mubiFilmToTrailer(film, language) {
  const trailer = bestTrailer(film);
  if (!trailer || new URL(trailer.url).hostname !== 'trailers.mubicdn.net') return null;
  if (trailerLanguage(trailer.url) !== language) return null;
  return {
    source: 'mubi',
    url: trailer.url,
    title: 'Trailer',
    thumbnail: httpsUrl(film?.stills?.retina) ?? httpsUrl(film?.stills?.standard),
    durationSec: null,
    height: trailer.height || null,
    lang: language,
    kind: 'trailer'
  };
}

export async function mubiTrailer(fetcher, mubi, language) {
  const country = mubiCountry(language);
  if (!mubi || !country) return [];
  const film = await fetchJson(fetcher, `${API}/${mubi}`, {
    headers: { 'User-Agent': BROWSER_USER_AGENT, Client: 'web', 'Client-Country': country },
    strict: true
  });
  const trailer = mubiFilmToTrailer(film, language);
  return trailer ? [trailer] : [];
}
