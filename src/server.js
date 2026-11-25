import { createServer } from 'node:http';
import { createAddon } from './addon.js';
import { createLayeredStore, createMemoryStore } from './cache.js';
import { createSqliteStore } from './node/sqlite-store.js';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 7000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');

const publicOrigin = process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL).origin : null;
const cachePath = process.env.CACHE_PATH || 'data/cache.sqlite';
const sqlite = createSqliteStore(cachePath);
const handle = createAddon({
  store: createLayeredStore([createMemoryStore(), sqlite]),
  tmdbApiKey: process.env.TMDB_API_KEY || undefined,
  plexToken: process.env.PLEX_TOKEN || undefined
});
const background = new Set();

function track(promise) {
  background.add(promise);
  promise.catch(() => {}).finally(() => background.delete(promise));
}

const server = createServer(async (incoming, outgoing) => {
  try {
    const origin = publicOrigin ?? `http://${incoming.headers.host || `${host}:${port}`}`;
    const request = new Request(new URL(incoming.url, origin), {
      method: incoming.method,
      headers: incoming.headers['user-agent'] ? { 'User-Agent': incoming.headers['user-agent'] } : {}
    });
    const response = await handle(request, { origin, waitUntil: track });
    const body = incoming.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer());
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(body);
  } catch {
    outgoing.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    outgoing.end(JSON.stringify({ error: 'Internal error' }));
  }
});

server.listen(port, host, () => console.log(`Trailers NG listening on http://${host}:${port}`));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    server.close();
    await Promise.allSettled([...background]);
    sqlite.close();
    process.exit(0);
  });
}
