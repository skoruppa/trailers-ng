const SOURCE_PRIORITY = { filmweb: 0, apple: 1, plex: 2, rottentomatoes: 3, youtube: 8 };
const KIND_PRIORITY = { trailer: 0, teaser: 1 };
const DURATION_TOLERANCE_SEC = 1;

const sourceRank = trailer => SOURCE_PRIORITY[trailer.source] ?? 9;
const kindRank = trailer => KIND_PRIORITY[trailer.kind] ?? 2;

const identity = trailer => trailer.url ?? `youtube:${trailer.ytId}`;

function sameTrailer(a, b) {
  if (identity(a) === identity(b)) return true;
  if (a.lang !== b.lang) return false;
  return Boolean(a.durationSec && b.durationSec && Math.abs(a.durationSec - b.durationSec) <= DURATION_TOLERANCE_SEC);
}

export function dedupe(trailers) {
  const ranked = [...trailers].sort(
    (a, b) => (b.height ?? 0) - (a.height ?? 0) || sourceRank(a) - sourceRank(b) || (a.order ?? 0) - (b.order ?? 0)
  );
  const kept = [];
  for (const trailer of ranked) {
    const match = kept.find(existing => sameTrailer(existing, trailer));
    if (!match) {
      kept.push({ ...trailer });
      continue;
    }
    match.description ??= trailer.description ?? null;
    match.thumbnail ??= trailer.thumbnail ?? null;
    if ((trailer.order ?? 0) < (match.order ?? 0) && trailer.source === match.source) match.order = trailer.order;
  }
  return kept;
}

export function selectTrailers(trailers, wanted) {
  const languageRank = new Map(wanted.map((language, index) => [language, index]));
  return dedupe(trailers.filter(trailer => languageRank.has(trailer.lang))).sort(
    (a, b) =>
      languageRank.get(a.lang) - languageRank.get(b.lang) ||
      (b.height ?? 0) - (a.height ?? 0) ||
      kindRank(a) - kindRank(b) ||
      sourceRank(a) - sourceRank(b) ||
      (a.order ?? 0) - (b.order ?? 0)
  );
}
