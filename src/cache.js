export function createMemoryStore(limit = 5000) {
  const entries = new Map();
  return {
    async get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    async set(key, value, ttlSeconds) {
      entries.delete(key);
      entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      if (entries.size > limit) entries.delete(entries.keys().next().value);
    }
  };
}

export function createCacheApiStore(cache, origin = 'https://trailers-ng.cache') {
  const request = key => new Request(`${origin}/${encodeURIComponent(key)}`);
  return {
    async get(key) {
      const response = await cache.match(request(key));
      return response ? response.json() : undefined;
    },
    async set(key, value, ttlSeconds) {
      const response = new Response(JSON.stringify(value), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttlSeconds}` }
      });
      await cache.put(request(key), response);
    }
  };
}

export function createD1Store(db) {
  let ready;
  const init = () => {
    ready ??= db
      .prepare('CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL)')
      .run();
    return ready;
  };
  return {
    async get(key) {
      await init();
      const row = await db.prepare('SELECT value, expires_at FROM cache WHERE key = ?').bind(key).first();
      if (!row || row.expires_at <= Date.now()) return undefined;
      return JSON.parse(row.value);
    },
    async set(key, value, ttlSeconds) {
      await init();
      await db
        .prepare('INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)')
        .bind(key, JSON.stringify(value), Date.now() + ttlSeconds * 1000)
        .run();
    }
  };
}

export function createLayeredStore(stores) {
  return {
    async get(key) {
      for (const store of stores) {
        try {
          const value = await store.get(key);
          if (value !== undefined) return value;
        } catch {
          continue;
        }
      }
      return undefined;
    },
    async set(key, value, ttlSeconds) {
      await Promise.all(stores.map(store => Promise.resolve(store.set(key, value, ttlSeconds)).catch(() => {})));
    }
  };
}

function lifetime(policy, value) {
  const resolved = typeof policy === 'function' ? policy(value) : policy;
  if (typeof resolved === 'number') return { fresh: resolved, keep: resolved };
  const fresh = Math.max(0, resolved?.fresh ?? 0);
  return { fresh, keep: Math.max(fresh, resolved?.keep ?? fresh) };
}

export function createCachedLookup(store, { now = () => Date.now() } = {}) {
  const pending = new Map();

  function refresh(key, policy, load) {
    if (pending.has(key)) return pending.get(key);
    const work = (async () => {
      const value = await load();
      const { fresh, keep } = lifetime(policy, value);
      if (keep > 0) {
        try {
          await store.set(key, { v: value, r: now() + fresh * 1000 }, keep);
        } catch {
          return value;
        }
      }
      return value;
    })();
    pending.set(key, work);
    work.finally(() => pending.delete(key)).catch(() => {});
    return work;
  }

  return async function cached(key, policy, load, { waitUntil } = {}) {
    let entry;
    try {
      entry = await store.get(key);
    } catch {
      entry = undefined;
    }
    if (entry && typeof entry === 'object' && 'v' in entry) {
      if (entry.r > now()) return entry.v;
      const background = refresh(key, policy, load).catch(() => entry.v);
      if (waitUntil) {
        waitUntil(background);
        return entry.v;
      }
      return background;
    }
    return refresh(key, policy, load);
  };
}
