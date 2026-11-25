import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAddon } from '../src/addon.js';
import { encodeConfig } from '../src/config.js';
import {
  APPLE_PAGE,
  APPLE_PLAYLIST,
  FILMWEB_PAGE,
  FILMWEB_VIDEOS,
  PLEX_EXTRAS,
  RT_PAGE,
  RT_SMIL,
  fakeFetcher,
  wikidataEntity,
  wikidataRoutes
} from './helpers.js';

const ORIGIN = 'https://trailers.test';

function routes() {
  return [
    ...wikidataRoutes(),
    ['https://plex.tv/api/v2/users/anonymous', { authToken: 'token' }],
    [/metadata\.provider\.plex\.tv\/library\/metadata\/matches/, { MediaContainer: { Metadata: [{ ratingKey: 'abc123' }] } }],
    [/metadata\.provider\.plex\.tv\/library\/metadata\/abc123\/extras/, PLEX_EXTRAS],
    ['https://www.rottentomatoes.com/m/oppenheimer_2023/videos', RT_PAGE],
    [/link\.theplatform\.com\/s\/NGweTC\/media\/PBIZ\?format=SMIL/, RT_SMIL],
    ['https://www.filmweb.pl/api/v1/film/10002817/videos', FILMWEB_VIDEOS],
    ['https://www.filmweb.pl/video/trailer/x-65242', FILMWEB_PAGE],
    [/tv\.apple\.com\/(pl|us)\/movie\/umc\.cmc\.5gylew9icuhfiifdv3oxwxen8/, APPLE_PAGE],
    [/play-edge\.itunes\.apple\.com\/WebObjects\/MZPlayLocal\.woa\/hls\/playlist\.m3u8/, APPLE_PLAYLIST]
  ];
}

async function get(addon, path) {
  const response = await addon(new Request(`${ORIGIN}${path}`), { origin: ORIGIN });
  return response;
}

test('manifest and configure page are served with and without config', async () => {
  const addon = createAddon({ fetcher: fakeFetcher([]) });
  const config = encodeConfig({ lang: 'pl', english: true });

  const manifest = await (await get(addon, `/${config}/manifest.json`)).json();
  assert.equal(manifest.name, 'Trailers NG (PL)');
  assert.deepEqual(manifest.resources, [{ name: 'meta', types: ['movie', 'series'], idPrefixes: ['tt', 'tmdb:'] }]);
  assert.equal(manifest.behaviorHints.trailerProvider, true);
  assert.match(manifest.description, /^Trailer provider only/);

  const page = await get(addon, `/${config}/configure`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<option value="pl" selected>/);

  assert.equal((await get(addon, '/manifest.json')).status, 200);
  assert.equal((await get(addon, '/bad!config/manifest.json')).status, 400);
  assert.equal((await get(addon, '/pl+en/manifest.json')).status, 200);
});

test('only preferred language trailers are returned when there are any', async () => {
  const addon = createAddon({ fetcher: fakeFetcher(routes()) });
  const response = await get(addon, `/pl+en/meta/movie/tt15398776.json`);
  assert.equal(response.status, 200);
  const { meta } = await response.json();

  assert.equal(meta.id, 'tt15398776');
  assert.equal(meta.name, 'Oppenheimer');
  assert.deepEqual(
    meta.trailerStreams.map(stream => stream.title),
    ['Zwiastun 1 · PL', 'Zwiastun 2 · PL']
  );
  assert.equal(meta.trailerStreams[1].url, `${ORIGIN}/hls/pl/pl/movie/umc.cmc.5gylew9icuhfiifdv3oxwxen8.m3u8`);
  assert.ok(meta.trailerStreams.every(stream => !('ytId' in stream)));
});

test('english trailers are merged, deduplicated and ordered by quality', async () => {
  const addon = createAddon({ fetcher: fakeFetcher(routes()) });
  const { meta } = await (await get(addon, `/en/meta/movie/tt15398776.json`)).json();
  assert.deepEqual(meta.trailerStreams.map(stream => stream.title), ['Trailer 1 · EN', 'Trailer 2 · EN', 'Trailer 3 · EN']);
  const trailer2 = meta.trailerStreams[2];
  assert.equal(trailer2.description, 'Oppenheimer (Trailer 2)\nPlex\nThe second trailer.');
  assert.equal(trailer2.thumbnail, 'https://metadata-static.plex.tv/extras/iva/2/b.jpg');
});

test('english is used as a fallback only when enabled', async () => {
  const noPolish = () => fakeFetcher(routes().filter(([pattern]) => !/filmweb|apple/.test(String(pattern))));
  const withFallback = (await (await get(createAddon({ fetcher: noPolish() }), '/pl+en/meta/movie/tt15398776.json')).json()).meta;
  assert.ok(withFallback.trailerStreams.length > 0);
  assert.ok(withFallback.trailerStreams.every(stream => stream.title.endsWith('· EN')));

  const noFallback = (await (await get(createAddon({ fetcher: noPolish() }), '/pl/meta/movie/tt15398776.json')).json()).meta;
  assert.deepEqual(noFallback.trailerStreams, []);
});

test('series episode ids resolve to the series and bad ids are rejected', async () => {
  const addon = createAddon({ fetcher: fakeFetcher(routes()) });
  assert.equal((await get(addon, '/meta/series/tt15398776:1:2.json')).status, 200);
  assert.equal((await get(addon, '/meta/movie/abc.json')).status, 404);
  assert.equal((await get(addon, '/meta/channel/tt15398776.json')).status, 404);
});

test('apple playlist endpoint rewrites the playlist for the requested language', async () => {
  const addon = createAddon({ fetcher: fakeFetcher(routes()) });
  const response = await get(addon, '/hls/pl/pl/movie/umc.cmc.5gylew9icuhfiifdv3oxwxen8.m3u8');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/vnd.apple.mpegurl');
  const body = await response.text();
  assert.match(body, /LANGUAGE="pl"/);
  assert.doesNotMatch(body, /LANGUAGE="en-US"/);
  assert.equal((await get(addon, '/hls/pl/pl/movie/not-an-id.m3u8')).status, 404);
});

test('source results are cached between requests', async () => {
  const fetcher = fakeFetcher(routes());
  const addon = createAddon({ fetcher });
  const config = encodeConfig({ lang: 'en', english: true });
  await get(addon, `/${config}/meta/movie/tt15398776.json`);
  const first = fetcher.calls.length;
  await get(addon, `/${config}/meta/movie/tt15398776.json`);
  assert.equal(fetcher.calls.length, first);
});

test('concurrent requests for the same title share one lookup per source', async () => {
  const config = encodeConfig({ lang: 'pl', english: true });
  const path = `/${config}/meta/movie/tt15398776.json`;

  const single = fakeFetcher(routes());
  await get(createAddon({ fetcher: single }), path);

  const concurrent = fakeFetcher(routes());
  const addon = createAddon({ fetcher: concurrent });
  const responses = await Promise.all([get(addon, path), get(addon, path), get(addon, path)]);
  assert.ok(responses.every(response => response.status === 200));
  assert.equal(concurrent.calls.length, single.calls.length);
});

test('youtube trailers from cinemeta fill in when no direct trailer exists', async () => {
  const fetcher = fakeFetcher([
    [/hub\.toolforge\.org/, null],
    [/wikidata\.org/, { query: { search: [] } }],
    ['https://plex.tv/api/v2/users/anonymous', { authToken: 'token' }],
    [/metadata\.provider\.plex\.tv\/library\/metadata\/matches/, { MediaContainer: { Metadata: [] } }],
    [
      'https://v3-cinemeta.strem.io/meta/movie/tt0000001.json',
      { meta: { name: 'Old Movie', trailerStreams: [{ title: 'Old Movie', ytId: 'abcdefghijk' }], trailers: [{ source: 'abcdefghijk', type: 'Trailer' }] } }
    ]
  ]);
  const { meta } = await (await get(createAddon({ fetcher }), `/pl+en/meta/movie/tt0000001.json`)).json();
  assert.deepEqual(meta.trailerStreams, [
    {
      ytId: 'abcdefghijk',
      title: 'Trailer · EN',
      description: 'Old Movie\nYouTube',
      thumbnail: 'https://img.youtube.com/vi/abcdefghijk/hqdefault.jpg'
    }
  ]);
});

test('youtube trailers in the preferred language follow the direct ones', async () => {
  const fetcher = fakeFetcher([
    ...routes().filter(([pattern]) => !/filmweb|apple/.test(String(pattern))),
    [/api\.themoviedb\.org\/3\/find\/tt15398776/, { movie_results: [{ id: 872585 }] }],
    [
      /api\.themoviedb\.org\/3\/movie\/872585\/videos/,
      {
        results: [
          { site: 'YouTube', key: 'plTrailer01', type: 'Trailer', iso_639_1: 'pl', name: 'Oppenheimer zwiastun PL', official: true },
          { site: 'YouTube', key: 'enTrailer01', type: 'Trailer', iso_639_1: 'en', name: 'Official Trailer', official: true },
          { site: 'Vimeo', key: 'vimeo', type: 'Trailer', iso_639_1: 'pl', name: 'Vimeo' }
        ]
      }
    ]
  ]);
  const config = encodeConfig({ lang: 'pl', english: true });
  const addon = createAddon({ fetcher, tmdbApiKey: 'key' });
  const { meta } = await (await get(addon, `/${config}/meta/movie/tt15398776.json`)).json();
  assert.equal(meta.trailerStreams[0].ytId, 'plTrailer01');
  assert.equal(meta.trailerStreams[0].title, 'Zwiastun · PL');
  assert.match(meta.trailerStreams[0].description, /Oppenheimer zwiastun PL/);
  assert.ok(meta.trailerStreams.slice(1).every(stream => stream.url && stream.title.endsWith('· EN')));
  assert.equal(meta.trailerStreams.some(stream => stream.ytId === 'enTrailer01'), false);
});

test('fusion links are added for other clients but not for AIOMetadata', async () => {
  const config = encodeConfig({ lang: 'en', english: true });
  const path = `${ORIGIN}/${config}/meta/movie/tt15398776.json`;
  const addon = createAddon({ fetcher: fakeFetcher(routes()) });

  const fusion = await addon(new Request(path, { headers: { 'User-Agent': 'Fusion/1.0' } }), { origin: ORIGIN });
  assert.equal(fusion.headers.get('Vary'), 'User-Agent');
  const { meta } = await fusion.json();
  assert.ok(meta.links.length > 0);
  for (const link of meta.links) {
    assert.deepEqual(Object.keys(link).sort(), ['provider', 'trailers']);
    assert.match(link.provider, / · EN · /);
  }
  assert.equal(meta.links.length, meta.trailerStreams.filter(stream => stream.url).length);

  const aio = await addon(new Request(path, { headers: { 'User-Agent': 'AIOMetadata/1.30.0' } }), { origin: ORIGIN });
  const aioMeta = (await aio.json()).meta;
  assert.equal(aioMeta.links, undefined);
  assert.ok(aioMeta.trailerStreams.length > 0);
});

function tmdbRoutes() {
  return [
    [/api\.themoviedb\.org\/3\/find\/tt15398776/, { movie_results: [{ id: 872585 }] }],
    [
      /api\.themoviedb\.org\/3\/movie\/872585\/videos/,
      { results: [{ site: 'YouTube', key: 'plTrailer01', type: 'Trailer', iso_639_1: 'pl', name: 'Zwiastun PL', official: true }] }
    ]
  ];
}

test('preferred language youtube trailers follow when there are fewer than two direct ones', async () => {
  const fetcher = fakeFetcher([...routes().filter(([pattern]) => !/apple/.test(String(pattern))), ...tmdbRoutes()]);
  const { meta } = await (await get(createAddon({ fetcher, tmdbApiKey: 'key' }), '/pl+en/meta/movie/tt15398776.json')).json();
  assert.deepEqual(
    meta.trailerStreams.map(stream => [stream.title, stream.ytId ? 'youtube' : 'direct']),
    [
      ['Zwiastun 1 · PL', 'direct'],
      ['Zwiastun 2 · PL', 'youtube']
    ]
  );
});

test('preferred language youtube trailers are skipped when there are enough direct ones', async () => {
  const fetcher = fakeFetcher([...routes(), ...tmdbRoutes()]);
  const { meta } = await (await get(createAddon({ fetcher, tmdbApiKey: 'key' }), '/pl+en/meta/movie/tt15398776.json')).json();
  assert.deepEqual(meta.trailerStreams.map(stream => stream.title), ['Zwiastun 1 · PL', 'Zwiastun 2 · PL']);
  assert.ok(meta.trailerStreams.every(stream => !stream.ytId));
});

test('youtube trailers can be turned off', async () => {
  const fetcher = fakeFetcher([
    ...routes(),
    [/api\.themoviedb\.org\/3\/find\/tt15398776/, { movie_results: [{ id: 872585 }] }],
    [/api\.themoviedb\.org\/3\/movie\/872585\/videos/, { results: [{ site: 'YouTube', key: 'plTrailer01', type: 'Trailer', iso_639_1: 'pl', name: 'Zwiastun PL' }] }]
  ]);
  const addon = createAddon({ fetcher, tmdbApiKey: 'key' });
  const { meta } = await (await get(addon, '/pl+en+noyt/meta/movie/tt15398776.json')).json();
  assert.ok(meta.trailerStreams.length > 0);
  assert.ok(meta.trailerStreams.every(stream => !stream.ytId));
  assert.equal(fetcher.calls.some(call => call.url.includes('themoviedb')), false);
});

test('tmdb ids resolve through wikidata to the same trailers', async () => {
  const hubFor = property => [
    new RegExp(`hub\\.toolforge\\.org/${property}:`),
    { origin: { qid: 'Q108839994' } }
  ];
  const entity = wikidataEntity();
  entity.entities.Q108839994.claims.P4947 = [{ rank: 'normal', mainsnak: { datavalue: { value: '872585' } } }];
  const base = routes().filter(([pattern]) => !/toolforge|EntityData/.test(String(pattern)));
  for (const [path, property] of [['tmdb:872585', 'P4947']]) {
    const fetcher = fakeFetcher([
      hubFor(property),
      ['https://www.wikidata.org/wiki/Special:EntityData/Q108839994.json', entity],
      ...base
    ]);
    const { meta } = await (await get(createAddon({ fetcher }), `/en/meta/movie/${path}.json`)).json();
    assert.equal(meta.id, path);
    assert.equal(meta.name, 'Oppenheimer');
    assert.ok(meta.trailerStreams.some(stream => stream.url?.includes('internetvideoarchive')), path);
  }
});
