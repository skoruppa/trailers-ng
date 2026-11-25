const SOURCE_LABELS = {
  adorocinema: 'AdoroCinema',
  allocine: 'AlloCiné',
  apple: 'Apple TV',
  beyazperde: 'Beyazperde',
  filmstarts: 'Filmstarts',
  sensacine: 'SensaCine',
  filmweb: 'Filmweb',
  plex: 'Plex',
  rottentomatoes: 'Rotten Tomatoes',
  youtube: 'YouTube'
};

function sourceLine(trailer) {
  return SOURCE_LABELS[trailer.source] ?? trailer.source;
}

const LABELS = {
  pl: { trailer: 'Zwiastun', teaser: 'Teaser' },
  fr: { trailer: 'Bande-annonce', teaser: 'Teaser' },
  es: { trailer: 'Tráiler', teaser: 'Teaser' },
  pt: { trailer: 'Trailer', teaser: 'Teaser' },
  tr: { trailer: 'Fragman', teaser: 'Teaser' },
  default: { trailer: 'Trailer', teaser: 'Teaser' }
};

function label(trailer) {
  const labels = LABELS[trailer.lang] ?? LABELS.default;
  return labels[trailer.kind] ?? labels.trailer;
}

export function numberTrailers(trailers) {
  const totals = new Map();
  for (const trailer of trailers) {
    const group = `${trailer.lang}:${label(trailer)}`;
    totals.set(group, (totals.get(group) ?? 0) + 1);
  }
  const counters = new Map();
  return trailers.map(trailer => {
    const group = `${trailer.lang}:${label(trailer)}`;
    const index = (counters.get(group) ?? 0) + 1;
    counters.set(group, index);
    const name = totals.get(group) > 1 ? `${label(trailer)} ${index}` : label(trailer);
    return { ...trailer, displayName: name };
  });
}

function displayTitle(trailer) {
  return `${trailer.displayName ?? trailer.title} · ${trailer.lang.toUpperCase()}`;
}

function originalName(trailer) {
  return trailer.title && trailer.title !== 'Trailer' && trailer.title !== trailer.displayName ? trailer.title : null;
}

export function toTrailerStreams(trailers) {
  return numberTrailers(trailers).map(trailer => {
    const stream = trailer.ytId ? { ytId: trailer.ytId } : { url: trailer.url };
    stream.title = displayTitle(trailer);
    stream.description = [originalName(trailer), sourceLine(trailer), trailer.description]
      .filter(Boolean)
      .join('\n');
    if (trailer.thumbnail) stream.thumbnail = trailer.thumbnail;
    return stream;
  });
}

export function toFusionLinks(trailers) {
  return numberTrailers(trailers)
    .filter(trailer => trailer.url)
    .map(trailer => ({
      trailers: trailer.url,
      provider: `${displayTitle(trailer)} · ${sourceLine(trailer)}`
    }));
}
