export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const DEFAULT_TIMEOUT_MS = 6000;

export class SourceUnavailableError extends Error {}

const MAX_RETRY_WAIT_MS = 3000;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function retryDelay(response) {
  const seconds = Number(response.headers.get('Retry-After'));
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, MAX_RETRY_WAIT_MS) : MAX_RETRY_WAIT_MS;
}

export async function fetchText(fetcher, url, { timeout = DEFAULT_TIMEOUT_MS, strict = false, ...options } = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response;
    try {
      response = await fetcher(url, { ...options, signal: AbortSignal.timeout(timeout) });
    } catch (error) {
      if (strict) throw new SourceUnavailableError(`${url}: ${error?.message ?? error}`);
      return null;
    }
    if (response.ok) {
      try {
        return await response.text();
      } catch (error) {
        if (strict) throw new SourceUnavailableError(`${url}: ${error?.message ?? error}`);
        return null;
      }
    }
    await response.body?.cancel().catch(() => {});
    if (response.status === 429 && attempt === 0) {
      await wait(retryDelay(response));
      continue;
    }
    if (!strict || response.status === 404 || response.status === 410) return null;
    throw new SourceUnavailableError(`${url}: HTTP ${response.status}`);
  }
  if (strict) throw new SourceUnavailableError(`${url}: HTTP 429`);
  return null;
}

export async function fetchJson(fetcher, url, { headers, ...options } = {}) {
  const text = await fetchText(fetcher, url, { ...options, headers: { Accept: 'application/json', ...headers } });
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    if (options.strict) throw new SourceUnavailableError(`${url}: invalid JSON`);
    return null;
  }
}

export function decodeHtml(value) {
  const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', '#39': "'", '#38': '&' };
  return value.replace(/&(amp|quot|apos|lt|gt|nbsp|#39|#38);/g, (_, entity) => entities[entity]);
}

export function httpsUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
