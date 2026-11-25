import { createAddon, isAioClient } from './addon.js';
import { createCacheApiStore, createD1Store, createLayeredStore } from './cache.js';

const RESPONSE_CACHE_SECONDS = 3600;

let handle;

function responseCacheKey(request) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || !url.pathname.includes('/meta/')) return null;
  const client = isAioClient(request.headers.get('User-Agent')) ? 'aio' : 'other';
  return new Request(`${url.origin}${url.pathname}?client=${client}`);
}

export default {
  async fetch(request, env, ctx) {
    handle ??= createAddon({
      store: createLayeredStore([
        createCacheApiStore(caches.default),
        ...(env?.CACHE_DB ? [createD1Store(env.CACHE_DB)] : [])
      ]),
      tmdbApiKey: env?.TMDB_API_KEY || undefined,
      plexToken: env?.PLEX_TOKEN || undefined
    });

    const key = responseCacheKey(request);
    if (key) {
      const hit = await caches.default.match(key).catch(() => null);
      if (hit) return hit;
    }

    const response = await handle(request, { waitUntil: promise => ctx.waitUntil(promise) });
    if (key && response.ok) {
      const headers = new Headers(response.headers);
      headers.delete('Vary');
      headers.set('Cache-Control', `public, max-age=${RESPONSE_CACHE_SECONDS}`);
      const copy = new Response(response.clone().body, { status: response.status, headers });
      ctx.waitUntil(caches.default.put(key, copy).catch(() => {}));
    }
    return response;
  }
};
