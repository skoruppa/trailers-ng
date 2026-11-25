import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCachedLookup, createMemoryStore } from '../src/cache.js';
import { decodeConfig, encodeConfig } from '../src/config.js';
import { toTrailerStreams } from '../src/format.js';
import { describePlaylist, playlistForLanguage } from '../src/hls.js';
import { dedupe, selectTrailers } from '../src/select.js';
import { APPLE_PLAYLIST } from './helpers.js';

test('config uses a readable url segment', () => {
  assert.equal(encodeConfig({ lang: 'pl', english: true }), 'pl+en');
  assert.equal(encodeConfig({ lang: 'pl', english: false }), 'pl');
  assert.equal(encodeConfig({ lang: 'en', english: false }), 'en');
  assert.deepEqual(decodeConfig('pl+en'), { lang: 'pl', english: true, youtube: true });
  assert.deepEqual(decodeConfig('pl+en+noyt'), { lang: 'pl', english: true, youtube: false });
  assert.deepEqual(decodeConfig('en+noyt'), { lang: 'en', english: true, youtube: false });
  assert.equal(encodeConfig({ lang: 'pl', english: false, youtube: false }), 'pl+noyt');
  assert.deepEqual(decodeConfig('pl%2Ben'), { lang: 'pl', english: true, youtube: true });
  assert.deepEqual(decodeConfig('pl'), { lang: 'pl', english: false, youtube: true });
  assert.deepEqual(decodeConfig(null), { lang: 'en', english: true, youtube: true });
  assert.equal(decodeConfig('xx'), null);
  assert.equal(decodeConfig('not a config!'), null);
});

test('old base64 config urls still work', () => {
  assert.deepEqual(decodeConfig('eyJsIjoicGwiLCJlIjoxfQ'), { lang: 'pl', english: true, youtube: true });
  assert.deepEqual(decodeConfig('eyJsIjoicGwiLCJlIjoxLCJvIjoxfQ'), { lang: 'pl', english: true, youtube: true });
});

test('playlist description lists audio languages and nominal height', () => {
  assert.deepEqual(describePlaylist(APPLE_PLAYLIST), { audio: ['en', 'pl'], height: 1080, protected: false });
});

test('playlist rewrite keeps only the chosen audio language', () => {
  const base = 'https://play-edge.itunes.apple.com/hls/master.m3u8';
  const playlist = playlistForLanguage(APPLE_PLAYLIST, base, 'pl');
  assert.match(playlist, /LANGUAGE="pl".*DEFAULT=YES/);
  assert.doesNotMatch(playlist, /LANGUAGE="en-US"/);
  assert.doesNotMatch(playlist, /describes-video/);
  assert.doesNotMatch(playlist, /SUBTITLES/);
  assert.match(playlist, /https:\/\/play-edge\.itunes\.apple\.com\/hls\/audio\/pl\.m3u8/);
  assert.match(playlist, /^https:\/\/play-edge\.itunes\.apple\.com\/hls\/video\/1080\.m3u8$/m);
  assert.equal(playlistForLanguage(APPLE_PLAYLIST, base, 'de'), null);
});

const trailer = overrides => ({
  source: 'plex',
  url: `https://example.test/${Math.random()}`,
  title: 'Trailer',
  durationSec: null,
  height: 1080,
  lang: 'en',
  kind: 'trailer',
  order: 0,
  ...overrides
});

test('dedupe merges the same trailer from different sources and keeps the better copy', () => {
  const plex = trailer({ source: 'plex', durationSec: 184, height: 1080, thumbnail: 'https://t/plex.jpg' });
  const rt = trailer({ source: 'rottentomatoes', durationSec: 183, height: 720, description: 'From RT' });
  const result = dedupe([rt, plex]);
  assert.equal(result.length, 1);
  assert.equal(result[0].url, plex.url);
  assert.equal(result[0].description, 'From RT');
});

test('dedupe keeps trailers in different languages apart', () => {
  const english = trailer({ durationSec: 120, lang: 'en' });
  const polish = trailer({ durationSec: 120, lang: 'pl', source: 'filmweb' });
  assert.equal(dedupe([english, polish]).length, 2);
});

test('selection filters by language and orders by language, kind, source and position', () => {
  const result = selectTrailers(
    [
      trailer({ title: 'EN teaser', kind: 'teaser', order: 0 }),
      trailer({ title: 'EN trailer 2', order: 2, durationSec: 150 }),
      trailer({ title: 'EN trailer 1', order: 1, durationSec: 120 }),
      trailer({ title: 'PL', lang: 'pl', source: 'filmweb' }),
      trailer({ title: 'DE', lang: 'de', source: 'apple' })
    ],
    ['pl', 'en']
  );
  assert.deepEqual(
    result.map(item => item.title),
    ['PL', 'EN trailer 1', 'EN trailer 2', 'EN teaser']
  );
});

test('trailer streams carry title, language, source and thumbnail', () => {
  const [stream] = toTrailerStreams([
    trailer({ title: 'Trailer 2', url: 'https://cdn.test/a.mp4', thumbnail: 'https://cdn.test/a.jpg', description: 'Desc' })
  ]);
  assert.deepEqual(stream, {
    url: 'https://cdn.test/a.mp4',
    title: 'Trailer · EN',
    description: 'Trailer 2\nPlex\nDesc',
    thumbnail: 'https://cdn.test/a.jpg'
  });
  const [filmweb] = toTrailerStreams([trailer({ title: 'Zwiastun', lang: 'pl', source: 'filmweb', url: 'https://f/a.mp4' })]);
  assert.equal('name' in filmweb, false);
  assert.equal(filmweb.title, 'Zwiastun · PL');
  assert.equal(filmweb.description, 'Filmweb');
  assert.equal('thumbnail' in filmweb, false);
});

test('cached lookup serves stale values while refreshing in the background', async () => {
  let now = 0;
  let calls = 0;
  const cached = createCachedLookup(createMemoryStore(), { now: () => now });
  const policy = { fresh: 10, keep: 1000 };
  const load = async () => ++calls;
  assert.equal(await cached('k', policy, load), 1);
  assert.equal(await cached('k', policy, load), 1);

  now = 20_000;
  const background = [];
  assert.equal(await cached('k', policy, load, { waitUntil: promise => background.push(promise) }), 1);
  await Promise.all(background);
  assert.equal(await cached('k', policy, load), 2);
});

test('limiter runs at most the allowed number of tasks at once and spaces their starts', async () => {
  const { createLimiter } = await import('../src/limiter.js');
  const schedule = createLimiter({ concurrency: 2, intervalMs: 20, maxWaitMs: 5000 });
  let running = 0;
  let peak = 0;
  const starts = [];
  const task = () => async () => {
    starts.push(Date.now());
    running += 1;
    peak = Math.max(peak, running);
    await new Promise(resolve => setTimeout(resolve, 30));
    running -= 1;
  };
  await Promise.all(Array.from({ length: 6 }, () => schedule(task())));
  assert.equal(peak, 2);
  for (let index = 1; index < starts.length; index += 1) assert.ok(starts[index] - starts[index - 1] >= 15);
});

test('limiter rejects tasks that waited too long in the queue', async () => {
  const { createLimiter } = await import('../src/limiter.js');
  const schedule = createLimiter({ concurrency: 1, intervalMs: 0, maxWaitMs: 20 });
  const slow = schedule(() => new Promise(resolve => setTimeout(resolve, 60)));
  const late = schedule(async () => 'ran');
  await assert.rejects(late, /queue wait exceeded/);
  await slow;
});

test('resolved ids are kept for a year when complete and refreshed monthly when partial', async () => {
  const { idsPolicy } = await import('../src/resolve.js');
  const DAY = 24 * 60 * 60;
  assert.deepEqual(idsPolicy(null), { fresh: DAY, keep: DAY });
  assert.equal(idsPolicy({ apple: {}, rottenTomatoes: 'm/x', filmweb: '1' }).fresh, 365 * DAY);
  assert.equal(idsPolicy({ apple: null, rottenTomatoes: 'm/x', filmweb: '1' }).fresh, 30 * DAY);
});

test('filmweb search accepts only a candidate with matching type, year and title', async () => {
  const { findFilmwebId } = await import('../src/providers/filmweb.js');
  const { fakeFetcher } = await import('./helpers.js');
  const fetcher = fakeFetcher([
    [
      /live\/search\?query=Bo%C5%BCe%20Cia%C5%82o/,
      {
        searchHits: [
          { id: 306715, type: 'film' },
          { id: 999, type: 'serial' },
          { id: 808863, type: 'film' }
        ]
      }
    ],
    [/film\/306715\/info/, { title: 'Boże Ciało', year: 2006, type: 'film' }],
    [/film\/808863\/info/, { title: 'Boże Ciało', originalTitle: 'Boże Ciało', year: 2019, type: 'film' }]
  ]);
  assert.equal(await findFilmwebId(fetcher, { titles: ['Boże Ciało', 'Corpus Christi'], year: 2019, type: 'movie' }), '808863');
  assert.equal(fetcher.calls.some(call => call.url.includes('/999/')), false);
  assert.equal(await findFilmwebId(fetcher, { titles: ['Boże Ciało'], year: 1990, type: 'movie' }), null);
});

test('wikidata failures are errors, not missing titles', async () => {
  const { lookupIds } = await import('../src/providers/wikidata.js');
  const { fakeFetcher } = await import('./helpers.js');
  const throttledSearch = fakeFetcher([
    [/hub\.toolforge\.org/, null],
    [/wikidata\.org\/w\/api\.php/, { error: { code: 'ratelimited' } }]
  ]);
  await assert.rejects(lookupIds(throttledSearch, 'tt0000001'), /Wikidata search failed: ratelimited/);

  const hubDown = fakeFetcher([
    [/wikidata\.org\/w\/api\.php/, { query: { search: [] } }]
  ]);
  const failingHub = async (url, options) => (String(url).includes('hub.toolforge.org') ? Promise.reject(new Error('down')) : hubDown(url, options));
  await assert.rejects(lookupIds(failingHub, 'tt0000001'), /Hub failed/);

  const notFound = fakeFetcher([
    [/hub\.toolforge\.org/, { origin: {} }],
    [/wikidata\.org\/w\/api\.php/, { query: { search: [] } }]
  ]);
  assert.equal(await lookupIds(notFound, 'tt0000001'), null);
});

test('plex token failures are remembered briefly and a configured token skips the anonymous one', async () => {
  const { plexTrailers } = await import('../src/providers/plex.js');
  const { fakeFetcher, PLEX_EXTRAS } = await import('./helpers.js');
  const cached = createCachedLookup(createMemoryStore());
  const failing = fakeFetcher([['https://plex.tv/api/v2/users/anonymous', null]]);
  await assert.rejects(plexTrailers(failing, cached, { imdbId: 'tt1', type: 'movie' }), /No Plex token/);
  await assert.rejects(plexTrailers(failing, cached, { imdbId: 'tt1', type: 'movie' }), /No Plex token/);
  assert.equal(failing.calls.length, 1);

  const withToken = fakeFetcher([
    [/matches/, { MediaContainer: { Metadata: [{ ratingKey: 'abc' }] } }],
    [/abc\/extras/, PLEX_EXTRAS]
  ]);
  const trailers = await plexTrailers(withToken, cached, { imdbId: 'tt1', type: 'movie' }, { plexToken: 'mine' });
  assert.equal(trailers.length, 3);
  assert.equal(withToken.calls.some(call => call.url.includes('users/anonymous')), false);
  assert.equal(withToken.calls[0].options.headers['X-Plex-Token'], 'mine');
});

test('trailers are numbered per language and kind in final order', async () => {
  const { numberTrailers } = await import('../src/format.js');
  const named = numberTrailers([
    trailer({ lang: 'pl', title: 'a' }),
    trailer({ lang: 'pl', title: 'b' }),
    trailer({ lang: 'pl', kind: 'teaser', title: 'c' }),
    trailer({ lang: 'en', title: 'd' }),
    trailer({ lang: 'fr', title: 'e' }),
    trailer({ lang: 'fr', title: 'f' })
  ]);
  assert.deepEqual(
    named.map(item => item.displayName),
    ['Zwiastun 1', 'Zwiastun 2', 'Teaser', 'Trailer', 'Bande-annonce 1', 'Bande-annonce 2']
  );
});

test('selection puts the highest quality first within a language', () => {
  const result = selectTrailers(
    [
      trailer({ title: '720', height: 720, source: 'apple' }),
      trailer({ title: 'youtube', height: null, source: 'youtube', ytId: 'aaaaaaaaaaa', url: undefined }),
      trailer({ title: '4k', height: 2160, source: 'rottentomatoes', durationSec: 90 }),
      trailer({ title: '1080 teaser', height: 1080, kind: 'teaser', durationSec: 30 }),
      trailer({ title: '1080', height: 1080, durationSec: 60 })
    ],
    ['en']
  );
  assert.deepEqual(result.map(item => item.title), ['4k', '1080', '1080 teaser', '720', 'youtube']);
});

test('filmweb video list keeps polish trailers and teasers from the film page', async () => {
  const { parseFilmwebVideoList } = await import('../src/providers/filmweb.js');
  const html = `
    <a href="/video/Hot+Shots/Nolan+lepszy-67754">x</a>
    <a href="/video/Teaser/Oppenheimer+Teaser+nr+1+francuski-62085">x</a>
    <a href="/video/Teaser/Oppenheimer+Teaser+nr+2%2C+polski-62090">x</a>
    <a href="/video/Zwiastun/Oppenheimer+Zwiastun+nr+1-63619">x</a>
    <a href="/video/Zwiastun/Oppenheimer+Zwiastun+nr+1-63619#komentarze">x</a>
    <a href="/video/Zwiastun/Oppenheimer+Zwiastun+nr+2-65242">x</a>`;
  assert.deepEqual(parseFilmwebVideoList(html), [
    { id: 62090, kind: 'teaser', name: 'Oppenheimer Teaser nr 2, polski' },
    { id: 63619, kind: 'trailer', name: 'Oppenheimer Zwiastun nr 1' },
    { id: 65242, kind: 'trailer', name: 'Oppenheimer Zwiastun nr 2' }
  ]);
});

test('filmweb video page accepts webm files', async () => {
  const { parseFilmwebVideoPage } = await import('../src/providers/filmweb.js');
  const page = parseFilmwebVideoPage(
    '<span itemprop="contentUrl" content="https://fwcdn.pl/video/trailer/Oppenheimer___Official_Trailer.vp9.1080p.webm"></span>' +
      '<span itemprop="thumbnailUrl" content="https://fwcdn.pl/webv/36/19/63619/63619.6.jpg"></span>'
  );
  assert.equal(page.url, 'https://fwcdn.pl/video/trailer/Oppenheimer___Official_Trailer.vp9.1080p.webm');
  assert.equal(page.height, 1080);
  assert.equal(page.thumbnail, 'https://fwcdn.pl/webv/36/19/63619/63619.6.jpg');
  assert.equal(parseFilmwebVideoPage('<span itemprop="contentUrl" content="https://fwcdn.pl/video/a.mov"></span>'), null);
});

test('filmweb trailers are polish only when marked, otherwise in the original language', async () => {
  const { filmwebTrailers, isPolishVersion } = await import('../src/providers/filmweb.js');
  const { fakeFetcher } = await import('./helpers.js');
  assert.equal(isPolishVersion('Zwiastun nr 3 (polski dubbing)'), true);
  assert.equal(isPolishVersion('Zwiastun nr 2 (polskie napisy)'), true);
  assert.equal(isPolishVersion('Zwiastun nr 9 (sezon 5, polski)'), true);
  assert.equal(isPolishVersion('Zwiastun nr 1'), false);

  const page = name => `<div data-video-name="${name}"></div><span itemprop="contentUrl" content="https://fwcdn.pl/video/trailer/${encodeURIComponent(name)}.vp9.1080p.webm"></span>`;
  const routes = [
    [
      'https://www.filmweb.pl/film/x-0-1/video',
      '<a href="/video/Zwiastun/X+Zwiastun+nr+1-11">a</a><a href="/video/Zwiastun/X+Zwiastun+nr+2+polski-12">b</a>'
    ],
    ['https://www.filmweb.pl/video/trailer/x-11', page('Zwiastun nr 1')],
    ['https://www.filmweb.pl/video/trailer/x-12', page('Zwiastun nr 2 (polski)')]
  ];
  const english = await filmwebTrailers(fakeFetcher(routes), { filmweb: '1', originalLanguage: 'en' });
  assert.deepEqual(english.map(t => [t.title, t.lang]), [['Zwiastun nr 2 (polski)', 'pl'], ['Zwiastun nr 1', 'en']]);
  const polishFilm = await filmwebTrailers(fakeFetcher(routes), { filmweb: '1', originalLanguage: 'pl' });
  assert.deepEqual(polishFilm.map(t => t.lang), ['pl', 'pl']);
  const unknown = await filmwebTrailers(fakeFetcher(routes), { filmweb: '1', originalLanguage: null });
  assert.deepEqual(unknown.map(t => t.lang), ['pl']);
});

test('media ids are parsed with their wikidata property', async () => {
  const { parseMediaId } = await import('../src/ids.js');
  assert.deepEqual(parseMediaId('tt0133093:1:2', 'series'), { key: 'tt0133093', property: 'P345', value: 'tt0133093', imdbId: 'tt0133093' });
  assert.deepEqual(parseMediaId('tmdb:603', 'movie'), { key: 'tmdb:603', property: 'P4947', value: '603', tmdbId: '603' });
  assert.deepEqual(parseMediaId('tmdb%3A1396', 'series'), { key: 'tmdb:1396', property: 'P4983', value: '1396', tmdbId: '1396' });
  assert.equal(parseMediaId('kitsu:1', 'series'), null);
  assert.equal(parseMediaId('mal:5114', 'series'), null);
  assert.equal(parseMediaId('%E0%A4%A', 'movie'), null);
});

test('webedia versions are classified per site', async () => {
  const { WEBEDIA_SITES, versionLanguage } = await import('../src/providers/webedia.js');
  const cases = [
    ['fr', 'Oppenheimer Bande-annonce VF', 'fr'],
    ['fr', 'Oppenheimer Bande-annonce VOST', 'fr'],
    ['fr', 'Oppenheimer Bande-annonce (2) VO', 'en'],
    ['de', 'Oppenheimer Trailer (2) DF', 'de'],
    ['de', 'Oppenheimer Trailer (3) OV', 'en'],
    ['es', 'Oppenheimer Tráiler (2)', 'es'],
    ['es', 'Oppenheimer Teaser VO', 'en'],
    ['pt', 'Oppenheimer Trailer Legendado', 'pt'],
    ['pt', 'Divertida Mente 2 Teaser Trailer Dublado', 'pt'],
    ['pt', 'Oppenheimer Teaser Original', 'en'],
    ['pt', 'Duna: Parte 2 Trailer Oficial', 'en'],
    ['tr', 'Ters Yüz 2 Dublajlı Fragman', 'tr'],
    ['tr', 'Oppenheimer Altyazılı Fragman', 'tr'],
    ['tr', 'Oppenheimer Fragman', 'en']
  ];
  for (const [language, name, expected] of cases) {
    assert.equal(versionLanguage(WEBEDIA_SITES[language], name, language, 'en'), expected, `${language}: ${name}`);
  }
  assert.equal(versionLanguage(WEBEDIA_SITES.fr, 'Bande-annonce VO', 'fr', null), null);
});

test('webedia trailers are read from the listing and video pages', async () => {
  const { webediaTrailers } = await import('../src/providers/webedia.js');
  const { fakeFetcher } = await import('./helpers.js');
  const page = (name, file, duration = 'PT00H02M03S') =>
    `<script type="application/ld+json">${JSON.stringify({
      '@type': 'VideoObject',
      name,
      contentUrl: file ? `https://fr.vid.web.acsta.net/nmedia/${file}.mp4?source=www` : '',
      thumbnailUrl: 'https://fr.web.img6.acsta.net/thumb.jpg',
      duration
    })}</script>`;
  const fetcher = fakeFetcher([
    [
      'https://www.allocine.fr/videos/fichefilm-296168/toutes/',
      ['1', '2', '3', '4', '1'].map(id => `<a href="/video/player_gen_cmedia=${id}&amp;cfilm=296168.html">x</a>`).join('')
    ],
    ['https://www.allocine.fr/video/player_gen_cmedia=1&cfilm=296168.html', page('Oppenheimer Bande-annonce VO', 'a')],
    ['https://www.allocine.fr/video/player_gen_cmedia=2&cfilm=296168.html', page('Oppenheimer Bande-annonce VF', 'b')],
    ['https://www.allocine.fr/video/player_gen_cmedia=3&cfilm=296168.html', page('Oppenheimer Teaser VF', '')],
    ['https://www.allocine.fr/video/player_gen_cmedia=4&cfilm=296168.html', page('Oppenheimer Interview', 'd')]
  ]);
  const trailers = await webediaTrailers(fetcher, { allocine: '296168', originalLanguage: 'en' }, 'fr');
  assert.deepEqual(
    trailers.map(t => [t.source, t.title, t.lang, t.kind, t.durationSec]),
    [
      ['allocine', 'Oppenheimer Bande-annonce VF', 'fr', 'trailer', 123],
      ['allocine', 'Oppenheimer Bande-annonce VO', 'en', 'trailer', 123]
    ]
  );
  assert.equal(trailers[0].thumbnail, 'https://fr.web.img6.acsta.net/thumb.jpg');
  assert.deepEqual(await webediaTrailers(fetcher, { allocine: '296168', originalLanguage: 'en' }, 'pl'), []);
});

test('direct trailers always come before youtube ones in the same language', () => {
  const result = selectTrailers(
    [
      trailer({ title: 'youtube trailer', source: 'youtube', height: null, ytId: 'aaaaaaaaaaa', url: undefined }),
      trailer({ title: 'direct teaser', source: 'sensacine', height: null, kind: 'teaser', durationSec: 40 })
    ],
    ['en']
  );
  assert.deepEqual(result.map(item => item.title), ['direct teaser', 'youtube trailer']);
});

test('mubi trailers are kept only in the requested language', async () => {
  const { mubiFilmToTrailer, trailerLanguage } = await import('../src/providers/mubi.js');
  const film = lang => ({
    trailer_url: `https://trailers.mubicdn.net/317388/optimised/720p-t-oppenheimer-2022_${lang}_1507.238_1280_720_1671412979.mp4`,
    optimised_trailers: [
      { profile: '240p', url: `https://trailers.mubicdn.net/317388/optimised/240p-t-oppenheimer-2022_${lang}_1507.238_1280_720_1671412979.mp4` },
      { profile: '720p', url: `https://trailers.mubicdn.net/317388/optimised/720p-t-oppenheimer-2022_${lang}_1507.238_1280_720_1671412979.mp4` }
    ],
    stills: { retina: 'https://assets.mubicdn.net/images/film/317388/image-w1280.jpg' }
  });
  assert.equal(trailerLanguage(film('fr_fr').trailer_url), 'fr');
  const french = mubiFilmToTrailer(film('fr_fr'), 'fr');
  assert.equal(french.height, 720);
  assert.match(french.url, /720p-.*_fr_fr_/);
  assert.equal(french.thumbnail, 'https://assets.mubicdn.net/images/film/317388/image-w1280.jpg');
  assert.equal(mubiFilmToTrailer(film('en_us'), 'pl'), null);
  assert.equal(mubiFilmToTrailer({}, 'fr'), null);
});
