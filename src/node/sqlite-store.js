import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const PURGE_EVERY_WRITES = 500;

export function createSqliteStore(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL)');
  const select = db.prepare('SELECT value, expires_at FROM cache WHERE key = ?');
  const upsert = db.prepare('INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)');
  const purge = db.prepare('DELETE FROM cache WHERE expires_at <= ?');
  let writes = 0;

  return {
    async get(key) {
      const row = select.get(key);
      if (!row || row.expires_at <= Date.now()) return undefined;
      return JSON.parse(row.value);
    },
    async set(key, value, ttlSeconds) {
      upsert.run(key, JSON.stringify(value), Date.now() + ttlSeconds * 1000);
      writes += 1;
      if (writes % PURGE_EVERY_WRITES === 0) purge.run(Date.now());
    },
    close() {
      db.close();
    }
  };
}
