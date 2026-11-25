import { fetchJson, httpsUrl, SourceUnavailableError } from '../http.js';

const CLIENT_HEADERS = {
  'X-Plex-Client-Identifier': 'trailers-ng',
  'X-Plex-Product': 'Plex Web',
  'X-Plex-Version': '4.141.1'
};
const METADATA = 'https://metadata.provider.plex.tv/library/metadata';
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const TOKEN_FAILURE_TTL_SECONDS = 10 * 60;

async function anonymousToken(fetcher, cached) {
  return cached('plex:token:v2', token => (token ? TOKEN_TTL_SECONDS : TOKEN_FAILURE_TTL_SECONDS), async () => {
    try {
      const data = await fetchJson(fetcher, 'https://plex.tv/api/v2/users/anonymous', {
        method: 'POST',
        headers: CLIENT_HEADERS,
        strict: true
      });
      return typeof data?.authToken === 'string' ? data.authToken : null;
    } catch {
      return null;
    }
  });
}

function seconds(milliseconds) {
  return Number.isFinite(milliseconds) && milliseconds > 0 ? Math.round(milliseconds / 1000) : null;
}

export function plexExtrasToTrailers(extras) {
  if (!Array.isArray(extras)) return [];
  return extras
    .filter(extra => extra?.subtype === 'trailer')
    .map(extra => {
      const media = Array.isArray(extra.Media) ? extra.Media[0] : null;
      const url = httpsUrl(media?.url);
      if (!url) return null;
      const title = typeof extra.title === 'string' ? extra.title.trim() : '';
      return {
        source: 'plex',
        url,
        title: title || 'Trailer',
        thumbnail: httpsUrl(extra.thumb),
        durationSec: seconds(media.duration) ?? seconds(extra.duration),
        height: Number(media.videoResolution) || null,
        lang: 'en',
        kind: /teaser/i.test(title) ? 'teaser' : 'trailer'
      };
    })
    .filter(Boolean);
}

export async function plexTrailers(fetcher, cached, { imdbId, type }, { plexToken } = {}) {
  const token = plexToken || (await anonymousToken(fetcher, cached));
  if (!token) throw new SourceUnavailableError('No Plex token available');
  const headers = { ...CLIENT_HEADERS, 'X-Plex-Token': token };
  const plexType = type === 'series' ? 2 : 1;
  const matches = await fetchJson(fetcher, `${METADATA}/matches?type=${plexType}&guid=imdb://${imdbId}`, { headers, strict: true });
  const ratingKey = matches?.MediaContainer?.Metadata?.[0]?.ratingKey;
  if (typeof ratingKey !== 'string' || !/^[\w-]+$/.test(ratingKey)) return [];
  const extras = await fetchJson(fetcher, `${METADATA}/${ratingKey}/extras`, { headers, strict: true });
  return plexExtrasToTrailers(extras?.MediaContainer?.Metadata);
}
