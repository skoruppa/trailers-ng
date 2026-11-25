const IMDB = /^(tt\d{5,12})(?::\d+){0,2}$/;
const TMDB = /^tmdb:(\d{1,10})(?::\d+){0,2}$/;

export const ID_PREFIXES = ['tt', 'tmdb:'];

export function tmdbProperty(type) {
  return type === 'series' ? 'P4983' : 'P4947';
}

export function parseMediaId(raw, type) {
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const imdb = IMDB.exec(decoded);
  if (imdb) return { key: imdb[1], property: 'P345', value: imdb[1], imdbId: imdb[1] };
  const tmdb = TMDB.exec(decoded);
  if (!tmdb) return null;
  return { key: `tmdb:${tmdb[1]}`, property: tmdbProperty(type), value: tmdb[1], tmdbId: tmdb[1] };
}
