import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createCachedLookup, createMemoryStore } from '../src/cache.js';
import { normalizeConfig } from '../src/config.js';
import { toTrailerStreams } from '../src/format.js';
import { fetchText } from '../src/http.js';
import { playlistForLanguage } from '../src/hls.js';
import { applePreview } from '../src/providers/apple.js';
import { filmwebTrailers } from '../src/providers/filmweb.js';
import { plexTrailers } from '../src/providers/plex.js';
import { rottenTomatoesTrailers } from '../src/providers/rottentomatoes.js';
import { lookupIds } from '../src/providers/wikidata.js';
import { resolveTrailers } from '../src/resolve.js';
import { parseMediaId } from '../src/ids.js';

const TITLES = [
  ['movie', 'tt15398776', 'Oppenheimer'],
  ['movie', 'tt15239678', 'Dune: Part Two'],
  ['movie', 'tt22022452', 'Inside Out 2'],
  ['movie', 'tt1517268', 'Barbie'],
  ['movie', 'tt6263850', 'Deadpool & Wolverine'],
  ['movie', 'tt9362722', 'Spider-Man: Across the Spider-Verse'],
  ['movie', 'tt0133093', 'The Matrix'],
  ['movie', 'tt0816692', 'Interstellar'],
  ['movie', 'tt1375666', 'Inception'],
  ['movie', 'tt0111161', 'The Shawshank Redemption'],
  ['series', 'tt0903747', 'Breaking Bad'],
  ['series', 'tt0944947', 'Game of Thrones'],
  ['series', 'tt4574334', 'Stranger Things'],
  ['series', 'tt11280740', 'Severance'],
  ['series', 'tt14452776', 'The Bear'],
  ['series', 'tt5180504', 'The Witcher'],
  ['series', 'tt13443470', 'Wednesday'],
  ['series', 'tt7366338', 'Chernobyl'],
  ['series', 'tt10919420', 'Squid Game'],
  ['series', 'tt3581920', 'The Last of Us'],
  ['movie', 'tt8649186', 'Corpus Christi'],
  ['movie', 'tt6543652', 'Cold War'],
  ['movie', 'tt2718492', 'Ida'],
  ['movie', 'tt2096673', 'Inside Out'],
  ['movie', 'tt0114709', 'Toy Story'],
  ['movie', 'tt2294629', 'Frozen'],
  ['movie', 'tt2953050', 'Encanto'],
  ['movie', 'tt0126029', 'Shrek'],
  ['movie', 'tt6718170', 'The Super Mario Bros. Movie'],
  ['movie', 'tt9218128', 'Gladiator II'],
  ['movie', 'tt1262426', 'Wicked'],
  ['movie', 'tt7286456', 'Joker'],
  ['movie', 'tt1745960', 'Top Gun: Maverick'],
  ['series', 'tt0108778', 'Friends'],
  ['series', 'tt0386676', 'The Office'],
  ['series', 'tt2788316', 'Shogun'],
  ['series', 'tt11198330', 'House of the Dragon'],
  ['series', 'tt10986410', 'Ted Lasso'],
  ['series', 'tt8111088', 'The Mandalorian'],
  ['series', 'tt12637874', 'Fallout']
];

const ORIGIN = 'https://trailers-ng.local';
const CONFIG = normalizeConfig({ lang: process.argv[2] ?? 'pl', english: true });
const fetcher = (...args) => fetch(...args);
const cached = createCachedLookup(createMemoryStore());

async function reachable(url) {
  try {
    const response = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(10000) });
    await response.body?.cancel();
    return response.status === 200 || response.status === 206;
  } catch {
    return false;
  }
}

async function appleReachable(url) {
  const [, language, storefront, kind, file] = new URL(url).pathname.split('/').filter(Boolean);
  const preview = await applePreview(fetcher, { id: file.replace(/\.m3u8$/, ''), kind }, storefront);
  if (!preview) return false;
  return Boolean(playlistForLanguage(await fetchText(fetcher, preview.url), preview.url, language));
}

function problems(streams, trailers) {
  const issues = [];
  for (const stream of streams) {
    if (stream.ytId ? !/^[A-Za-z0-9_-]{11}$/.test(stream.ytId) : !/^https:\/\//.test(stream.url)) {
      issues.push(`bad url: ${stream.url ?? stream.ytId}`);
    }
    if (!stream.title || /^ · /.test(stream.title)) issues.push(`empty title: ${stream.url}`);
  }
  for (const [index, a] of trailers.entries()) {
    for (const b of trailers.slice(index + 1)) {
      if (a.lang === b.lang && a.durationSec && b.durationSec && Math.abs(a.durationSec - b.durationSec) <= 1) {
        issues.push(`duplicate left: ${a.title} / ${b.title}`);
      }
    }
  }
  return issues;
}

async function checkTitle([type, imdbId, name]) {
  let idsError = null;
  const ref = parseMediaId(imdbId, type);
  const ids = await cached(`ids:v4:${type}:${ref.key}`, 3600, () => lookupIds(fetcher, ref, type)).catch(error => {
    idsError = String(error);
    return null;
  });
  const [plex, rt, filmweb, appleUs, applePl] = await Promise.all([
    plexTrailers(fetcher, cached, { imdbId, type }).catch(error => ({ error: String(error) })),
    rottenTomatoesTrailers(fetcher, ids ?? {}).catch(error => ({ error: String(error) })),
    filmwebTrailers(fetcher, ids ?? {}).catch(error => ({ error: String(error) })),
    ids?.apple ? applePreview(fetcher, ids.apple, 'us').catch(() => null) : null,
    ids?.apple ? applePreview(fetcher, ids.apple, 'pl').catch(() => null) : null
  ]);
  const count = list => (Array.isArray(list) ? list.length : 'ERR');
  const size = list => (Array.isArray(list) ? list.length : 0);
  const { trailers } = await resolveTrailers({ fetcher, cached, ref, type, config: CONFIG, origin: ORIGIN, tmdbApiKey: process.env.TMDB_API_KEY || undefined });
  const streams = toTrailerStreams(trailers);
  const reach = await Promise.all(
    streams.map(stream =>
      stream.ytId ? reachable(stream.thumbnail) : stream.url.startsWith(ORIGIN) ? appleReachable(stream.url) : reachable(stream.url)
    )
  );
  const issues = problems(streams, trailers);
  if (idsError) issues.push(`id lookup failed: ${idsError}`);
  reach.forEach((ok, index) => {
    if (!ok) issues.push(`unreachable: ${streams[index].url ?? streams[index].ytId}`);
  });

  return {
    type,
    imdbId,
    name,
    ids,
    idsError,
    sourceErrors: [plex, rt, filmweb].filter(list => !Array.isArray(list)).map(list => list.error),
    sources: {
      plex: count(plex),
      rottenTomatoes: count(rt),
      filmweb: count(filmweb),
      appleUs: appleUs ? appleUs.audio : null,
      applePl: applePl ? applePl.audio : null
    },
    result: {
      total: streams.length,
      byLanguage: Object.fromEntries(
        [...new Set(trailers.map(trailer => trailer.lang))].map(lang => [lang, trailers.filter(t => t.lang === lang).length])
      ),
      withThumbnail: streams.filter(stream => stream.thumbnail).length,
      withDuration: trailers.filter(trailer => trailer.durationSec).length,
      dedupedAway: size(plex) + size(rt) + size(filmweb) - trailers.filter(t => t.source !== 'apple').length
    },
    streams,
    issues
  };
}

const reports = [];
for (const [index, title] of TITLES.entries()) {
  if (index) await new Promise(resolve => setTimeout(resolve, Number(process.env.DELAY_MS ?? 1500)));
  try {
    reports.push(await checkTitle(title));
  } catch (error) {
    reports.push({ type: title[0], imdbId: title[1], name: title[2], error: String(error) });
  }
}

const rows = reports.map(report =>
  report.error
    ? { title: report.name, error: report.error }
    : {
        title: report.name,
        type: report.type,
        plex: report.sources.plex,
        rt: report.sources.rottenTomatoes,
        filmweb: report.sources.filmweb,
        appleUs: report.sources.appleUs?.join(',') ?? '-',
        applePl: report.sources.applePl?.join(',') ?? '-',
        result: report.result.total,
        languages: Object.entries(report.result.byLanguage).map(([lang, count]) => `${lang}:${count}`).join(' '),
        youtube: report.streams.filter(stream => stream.ytId).length,
        thumbs: `${report.result.withThumbnail}/${report.result.total}`,
        merged: report.result.dedupedAway,
        issues: report.issues.length
      }
);
console.table(rows);
const preferred = CONFIG.lang;
const valid = reports.filter(report => !report.error);
const inPreferred = report => report.streams.filter(stream => stream.title.endsWith(` · ${preferred.toUpperCase()}`));
const directPreferred = valid.filter(report => inPreferred(report).some(stream => !stream.ytId));
const youtubeOnlyPreferred = valid.filter(report => inPreferred(report).length && inPreferred(report).every(stream => stream.ytId));
const anything = valid.filter(report => report.streams.length);
const bySource = {};
for (const report of directPreferred) {
  for (const stream of inPreferred(report).filter(item => !item.ytId)) {
    const source = stream.description.split('\n').find(line => /^(Apple|Filmweb|Plex|Rotten|YouTube)/.test(line))?.split(' ')[0] ?? '?';
    bySource[source] = (bySource[source] ?? 0) + 1;
  }
}
console.log(`Titles with any trailer: ${anything.length}/${valid.length}`);
console.log(`Titles with a direct ${preferred.toUpperCase()} trailer: ${directPreferred.length}/${valid.length} (${directPreferred.map(report => report.name).join(', ')})`);
console.log(`Titles with only YouTube ${preferred.toUpperCase()} trailers: ${youtubeOnlyPreferred.length}/${valid.length}`);
console.log(`Direct ${preferred.toUpperCase()} trailers by source: ${JSON.stringify(bySource)}`);
for (const report of reports) {
  for (const issue of report.issues ?? []) console.log(`${report.name}: ${issue}`);
}

const reportPath = process.env.REPORT_PATH ?? 'data/live-check.json';
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify({ config: CONFIG, reports }, null, 2));
console.log(`Full report: ${reportPath}`);
process.exitCode = reports.some(report => report.error || report.issues?.length) ? 1 : 0;
