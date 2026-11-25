import { createCachedLookup, createMemoryStore } from './cache.js';
import { decodeConfig, LANGUAGES } from './config.js';
import { configurePage } from './configure.js';
import { toFusionLinks, toTrailerStreams } from './format.js';
import { fetchText } from './http.js';
import { playlistForLanguage } from './hls.js';
import { applePreview } from './providers/apple.js';
import { appleCacheKey, resolveTrailers, sourcePolicy } from './resolve.js';
import { ID_PREFIXES, parseMediaId } from './ids.js';

export const VERSION = '0.1.0';

export function isAioClient(userAgent) {
  return /^AIOMetadata\b/i.test(userAgent ?? '');
}

const TYPES = ['movie', 'series'];
const RESERVED = new Set(['manifest.json', 'meta', 'configure', 'hls', 'health']);
const APPLE_ID = /^umc\.cmc\.[a-z0-9]+$/i;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*'
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', ...headers }
  });
}

function manifest(config) {
  const language = config.lang.toUpperCase();
  return {
    id: 'community.trailers-ng',
    version: VERSION,
    name: `Trailers NG (${language})`,
    description: `Trailer provider only: returns meta.trailerStreams (and links for Fusion) with direct trailer files from Plex, Rotten Tomatoes, Apple TV and Filmweb, with YouTube trailers as a fallback, and no other metadata. Preferred language: ${LANGUAGES[config.lang].name}.`,
    resources: [{ name: 'meta', types: TYPES, idPrefixes: ID_PREFIXES }],
    types: TYPES,
    idPrefixes: ID_PREFIXES,
    catalogs: [],
    behaviorHints: { configurable: true, configurationRequired: false, trailerProvider: true }
  };
}

export function createAddon({ fetcher = (...args) => fetch(...args), store = createMemoryStore(), tmdbApiKey, plexToken } = {}) {
  const cached = createCachedLookup(store);

  async function serveMeta(type, rawId, config, origin, waitUntil, userAgent) {
    const ref = TYPES.includes(type) ? parseMediaId(rawId, type) : null;
    if (!ref) return json({ error: 'Not found' }, 404);
    const id = ref.key;
    const { title, trailers } = await resolveTrailers({ fetcher, cached, waitUntil, ref, type, config, origin, tmdbApiKey, plexToken });
    const meta = { id, type, name: title ?? id, trailerStreams: toTrailerStreams(trailers) };
    if (!isAioClient(userAgent)) meta.links = toFusionLinks(trailers);
    return json({ meta }, 200, { 'Cache-Control': 'public, max-age=3600', Vary: 'User-Agent' });
  }

  async function serveHls([language, storefront, kind, file], waitUntil) {
    const id = file?.replace(/\.m3u8$/, '');
    if (!/^[a-z]{2}$/.test(language ?? '') || !/^[a-z]{2}$/.test(storefront ?? '')) return null;
    if (!['movie', 'show'].includes(kind) || !APPLE_ID.test(id ?? '') || !file.endsWith('.m3u8')) return null;
    const apple = { id, kind };
    const preview = await cached(appleCacheKey(storefront, apple), sourcePolicy(null), () => applePreview(fetcher, apple, storefront), {
      waitUntil
    });
    if (!preview) return null;
    const playlist = playlistForLanguage(await fetchText(fetcher, preview.url), preview.url, language);
    if (!playlist) return null;
    return new Response(playlist, {
      headers: { ...CORS, 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'public, max-age=300' }
    });
  }

  return async function handle(request, { waitUntil, origin } = {}) {
    const url = new URL(request.url);
    const base = origin ?? url.origin;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'Method not allowed' }, 405, { Allow: 'GET, HEAD, OPTIONS' });
    }

    const segments = url.pathname.split('/').filter(Boolean);
    let config = decodeConfig(null);
    if (segments.length && !RESERVED.has(segments[0])) {
      config = decodeConfig(segments.shift());
      if (!config) return json({ error: 'Invalid configuration' }, 400);
    }
    const [head, ...rest] = segments;

    if (!head) return new Response(null, { status: 302, headers: { ...CORS, Location: `${base}/configure` } });
    if (head === 'health' && !rest.length) return json({ status: 'ok', version: VERSION });
    if (head === 'manifest.json' && !rest.length) return json(manifest(config));
    if (head === 'configure' && !rest.length) {
      return new Response(configurePage(config, base, VERSION), {
        headers: { ...CORS, 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    if (head === 'meta' && rest.length === 2 && rest[1].endsWith('.json')) {
      return serveMeta(rest[0], rest[1].slice(0, -'.json'.length), config, base, waitUntil, request.headers.get('User-Agent'));
    }
    if (head === 'hls' && rest.length === 4) {
      const response = await serveHls(rest, waitUntil);
      if (response) return response;
    }
    return json({ error: 'Not found' }, 404);
  };
}
