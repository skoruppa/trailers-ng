import { fetchJson, SourceUnavailableError } from '../http.js';
import { tmdbProperty } from '../ids.js';
import { createLimiter, limitFetcher } from '../limiter.js';

const API = 'https://www.wikidata.org/w/api.php';
const ENTITY_DATA = 'https://www.wikidata.org/wiki/Special:EntityData';
const HUB = 'https://hub.toolforge.org';
const HEADERS = { 'User-Agent': 'trailers-ng/0.1 (self-hosted Stremio trailer addon)' };
const ENTITY_ID = /^Q[1-9]\d*$/;
const APPLE_ID = /^umc\.cmc\.[a-z0-9]+$/i;
const NUMERIC_ID = /^\d+$/;
const schedule = createLimiter({ concurrency: 2, intervalMs: 250, maxWaitMs: 4000 });

const LANGUAGE_CODES = {
  Q1860: 'en', Q809: 'pl', Q150: 'fr', Q188: 'de', Q1321: 'es', Q652: 'it', Q5146: 'pt', Q750553: 'pt',
  Q9056: 'cs', Q9067: 'hu', Q256: 'tr', Q5287: 'ja', Q9176: 'ko', Q7850: 'zh', Q9192: 'zh', Q7737: 'ru',
  Q7411: 'nl', Q9027: 'sv', Q9035: 'da', Q9043: 'no', Q25167: 'nb', Q1412: 'fi', Q1568: 'hi', Q9288: 'he',
  Q13955: 'ar', Q9168: 'fa', Q9217: 'th', Q8798: 'uk', Q9129: 'el', Q7913: 'ro', Q9240: 'id'
};

function claimValues(entity, property) {
  const claims = entity?.claims?.[property];
  if (!Array.isArray(claims)) return [];
  return claims
    .filter(claim => claim?.rank !== 'deprecated')
    .sort((a, b) => Number(b.rank === 'preferred') - Number(a.rank === 'preferred'))
    .map(claim => claim?.mainsnak?.datavalue?.value)
    .filter(value => value !== undefined && value !== null);
}

function firstString(entity, property, pattern) {
  return claimValues(entity, property).find(value => typeof value === 'string' && (!pattern || pattern.test(value)));
}

async function entityData(fetcher, id) {
  const data = await fetchJson(fetcher, `${ENTITY_DATA}/${id}.json`, { headers: HEADERS, strict: true });
  const entities = data?.entities ?? {};
  return entities[id] ?? Object.values(entities)[0] ?? null;
}

async function entityIdFromHub(fetcher, { property, value }) {
  const data = await fetchJson(fetcher, `${HUB}/${property}:${encodeURIComponent(value)}?site=wikidata&format=json`, {
    headers: HEADERS,
    strict: true
  });
  const id = data?.origin?.qid;
  return ENTITY_ID.test(id ?? '') ? id : null;
}

async function entityIdsFromSearch(fetcher, { property, value }) {
  const url = new URL(API);
  url.search = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: `haswbstatement:${property}=${value}`,
    srnamespace: '0',
    srlimit: '3',
    srprop: '',
    format: 'json',
    formatversion: '2'
  });
  const search = await fetchJson(fetcher, url.href, { headers: HEADERS, strict: true });
  if (!search || search.error || !Array.isArray(search.query?.search)) {
    throw new SourceUnavailableError(`Wikidata search failed: ${search?.error?.code ?? 'no results list'}`);
  }
  return search.query.search.map(item => item?.title).filter(id => typeof id === 'string' && ENTITY_ID.test(id));
}

async function findEntity(fetcher, ref) {
  const matches = entity => claimValues(entity, ref.property).map(String).includes(String(ref.value));
  let hubFailed = false;
  const hubId = await entityIdFromHub(fetcher, ref).catch(() => {
    hubFailed = true;
    return null;
  });
  if (hubId) {
    const entity = await entityData(fetcher, hubId);
    if (matches(entity)) return entity;
  }
  for (const id of await entityIdsFromSearch(fetcher, ref)) {
    const entity = await entityData(fetcher, id);
    if (matches(entity)) return entity;
  }
  if (hubFailed) throw new SourceUnavailableError(`Wikidata Hub failed and search found nothing for ${ref.key}`);
  return null;
}

async function languageCode(fetcher, entity) {
  const languageId = claimValues(entity, 'P364').map(value => value?.id).find(id => ENTITY_ID.test(id ?? ''));
  if (!languageId) return null;
  if (LANGUAGE_CODES[languageId]) return LANGUAGE_CODES[languageId];
  const language = await entityData(fetcher, languageId).catch(() => null);
  return firstString(language, 'P218', /^[a-z]{2}$/) ?? null;
}

function releaseDate(entity) {
  const released = claimValues(entity, 'P577')
    .map(value => (typeof value?.time === 'string' ? Date.parse(value.time.replace(/^\+/, '').replace(/-00/g, '-01')) : NaN))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];
  return released ? new Date(released).toISOString().slice(0, 10) : null;
}

export async function lookupIds(fetcher, ref, type) {
  if (typeof ref === 'string') ref = { key: ref, property: 'P345', value: ref, imdbId: ref };
  fetcher = limitFetcher(fetcher, schedule);
  const entity = await findEntity(fetcher, ref);
  if (!entity) return null;

  const appleMovie = firstString(entity, 'P9586', APPLE_ID);
  const appleShow = firstString(entity, 'P9751', APPLE_ID);
  const labels = entity.labels ?? {};
  const titles = [labels.pl?.value, labels.en?.value, labels.mul?.value].filter(
    (value, index, all) => typeof value === 'string' && value.trim() && all.indexOf(value) === index
  );
  return {
    imdbId: ref.imdbId ?? firstString(entity, 'P345', /^tt\d{5,12}$/) ?? null,
    tmdbId: ref.tmdbId ?? firstString(entity, tmdbProperty(type), NUMERIC_ID) ?? null,
    title: labels.en?.value ?? labels.mul?.value ?? null,
    titles,
    originalLanguage: await languageCode(fetcher, entity),
    released: releaseDate(entity),
    apple: appleMovie ? { id: appleMovie, kind: 'movie' } : appleShow ? { id: appleShow, kind: 'show' } : null,
    rottenTomatoes: firstString(entity, 'P1258', /^(m|tv)\/[\w-]+$/) ?? null,
    filmweb: firstString(entity, 'P5032', NUMERIC_ID) ?? null,
    allocine: type === 'series' ? null : (firstString(entity, 'P1265', NUMERIC_ID) ?? null)
  };
}
