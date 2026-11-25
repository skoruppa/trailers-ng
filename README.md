# Trailers NG

A trailer provider addon for Stremio-compatible apps. It returns direct trailer video files (MP4, WebM and HLS) as Stream Objects in `meta.trailerStreams`, with a title, language, source and thumbnail for each trailer, best quality first. YouTube trailers are added only as a fallback.

It is meant to be used as a trailer source for a metadata addon such as AIOMetadata, which merges these trailers into its own metadata. The addon itself returns no other metadata.

## Features

- Several trailers per title from several sources, with real titles, descriptions and thumbnails.
- Deduplication: the same trailer found in more than one source is listed once, in the best available quality.
- Trailers in the preferred language: direct files first, then YouTube trailers in that language. English is an optional fallback for titles with no trailer in the preferred language.
- YouTube trailers (Stream Objects with `ytId`) come from TMDB in the preferred language when the instance has a TMDB API key, after the direct files. Without a key, Cinemeta provides English YouTube trailers when no direct English trailer exists.
- A configuration page that builds the manifest URL.
- Runs on Cloudflare Workers or self-hosted with Node.js or Docker.
- Persistent shared cache: results are cached per title and source, so every user benefits from lookups made by others. Stale entries are served right away and refreshed in the background.

## Sources

| Source | Languages | Notes |
| --- | --- | --- |
| Plex (Internet Video Archive) | English | Several trailers per title, thumbnails, durations |
| Rotten Tomatoes (Fandango) | English | Titles, descriptions, thumbnails, durations |
| Apple TV | Depends on the title | Uses the storefront of the chosen language. Some trailers carry many dubbed audio tracks; the addon serves a playlist with only the chosen language |
| Filmweb | Polish | Polish trailers |
| AlloCiné, Filmstarts, SensaCine, AdoroCinema, Beyazperde | French, German, Spanish, Portuguese, Turkish | The Webedia sites share one id. Dubbed and subtitled versions count as the site's language, original versions as the film's original language. Movies only |

Titles are matched by IMDb id (`tt…`) or TMDB id (`tmdb:…`); TMDB ids are mapped through Wikidata. Note that AIOMetadata only asks trailer addons by IMDb id. YouTube trailers are added after the direct files, at most four per language. Plex is queried by IMDb id directly; the ids of the other services come from Wikidata (through Wikidata Hub and `Special:EntityData`). Wikidata requests go through a queue: at most 2 at a time and 4 per second, and a request that waits longer than 4 seconds is dropped for that lookup.

Resolved ids are cached for a year when all of them were found, and refreshed monthly when some are missing, since Wikidata entries can gain ids later.

Known limits:

- Apple TV exposes a trailer on its public pages for movies and for Apple TV+ series only, so other series get no Apple TV trailer.
- A title without the matching id in Wikidata gets nothing from that source.

## Configuration

Open `/configure` on your instance, pick the options and copy the manifest URL.

- **Preferred language**: listed first.
- **Fall back to English**: when there is no trailer in the preferred language, English trailers are shown instead, so there is always a trailer. Without it, titles with no trailer in the preferred language get none. Not shown when English is the preferred language.
- **YouTube trailers** (on by default): YouTube trailers in the preferred language, added after the direct files when there are fewer than two of them. Turn it off to get direct files only.

The configuration is part of the URL, for example `/pl+en/manifest.json` (Polish with English fallback) or `/pl+noyt/manifest.json` (Polish, no YouTube). Nothing is stored on the server.

## Response formats

Every response carries `meta.trailerStreams`. Requests from anything other than AIOMetadata also get `meta.links` in the Fusion trailer format (`trailers`, `provider`). AIOMetadata reads both fields, so it gets only `trailerStreams` to avoid duplicates. It is recognised by its `User-Agent` header (`AIOMetadata/...`).

## Using it with AIOMetadata

In AIOMetadata, set the trailer provider to a trailer addon and paste the manifest URL of this addon. AIOMetadata forwards `trailerStreams` to the apps that use it.

The manifest marks the addon with `behaviorHints.trailerProvider: true`, so apps can recognise it as a trailer provider rather than a metadata source.

## Optional keys

Both keys are optional and are set per instance, never per user.

| Key | What it enables | How to get it |
| --- | --- | --- |
| `TMDB_API_KEY` | YouTube trailers in the preferred language | Create a free account on [themoviedb.org](https://www.themoviedb.org/), then in Settings, API request an API key. Either the v3 API key or the v4 read access token works |
| `PLEX_TOKEN` | Plex trailers on hosts where Plex rate limits anonymous tokens, such as Cloudflare Workers | A free Plex account is enough. Sign in on [app.plex.tv](https://app.plex.tv/), open any movie, choose Get Info, then View XML, and copy the value of `X-Plex-Token` from the address of the page that opens |

A Plex token gives access to your Plex account, so keep it secret: set it only as a Worker secret or an environment variable, never in a file you commit.

## Deploy on Cloudflare Workers

The free Workers plan is enough. You need a Cloudflare account and Node.js 22.13 or newer.

1. Get the code and install Wrangler:

   ```sh
   git clone https://github.com/skoruppa/trailers-ng.git
   cd trailers-ng
   npm install
   ```

2. Sign in to Cloudflare:

   ```sh
   npx wrangler login
   ```

3. Set up the persistent cache. `wrangler.toml` in this repository points to the author's D1 database, which your account cannot use, so either create your own:

   ```sh
   npx wrangler d1 create trailers-ng-cache
   ```

   and replace `database_id` in `wrangler.toml` with the id it prints, or delete the whole `[[d1_databases]]` block to run with the per data center Cache API only. D1 is free within the usual limits and makes cached results shared by all data centers and persistent; the table is created on first use.

4. Optionally add the keys as secrets (see [Optional keys](#optional-keys)):

   ```sh
   npx wrangler secret put TMDB_API_KEY
   npx wrangler secret put PLEX_TOKEN
   ```

5. Deploy:

   ```sh
   npx wrangler deploy
   ```

   Wrangler prints the address, for example `https://trailers-ng.<your-subdomain>.workers.dev`.

6. Check it: `https://<your address>/health` should return `"status":"ok"`, and `https://<your address>/configure` builds the manifest URL to paste into AIOMetadata.

To use your own domain, add it in the Cloudflare dashboard under Workers, trailers-ng, Settings, Domains and Routes. To update, pull the latest code and run `npx wrangler deploy` again; secrets and the D1 data are kept.

Meta responses are also cached whole in the Cache API for an hour, so a repeated request returns without resolving anything. Workers always run before the Cloudflare cache, so every request still invokes the Worker; a cached one is just very cheap. AIOMetadata caches trailer addon results for a day per title, so each AIOMetadata instance asks for a title at most once a day.

## Self-host

The addon has no runtime dependencies. Results are cached in a SQLite file, so keep it on persistent storage. The addon must be reachable over HTTPS for AIOMetadata and the players, usually behind a reverse proxy; set `PUBLIC_URL` to that public address, because it is used to build the Apple TV playlist links.

### Node.js

Requires Node.js 22.13 or newer.

```sh
git clone https://github.com/skoruppa/trailers-ng.git
cd trailers-ng
PUBLIC_URL=https://trailers.example.com TMDB_API_KEY=... npm start
```

The server listens on `127.0.0.1:7000` and keeps its cache in `data/cache.sqlite`.

### Docker

```sh
git clone https://github.com/skoruppa/trailers-ng.git
cd trailers-ng
docker build -t trailers-ng .
docker run -d --name trailers-ng --restart unless-stopped \
  -p 127.0.0.1:7000:7000 -v trailers-ng-data:/data \
  -e PUBLIC_URL=https://trailers.example.com \
  -e TMDB_API_KEY=... \
  trailers-ng
```

### Docker Compose

```yaml
services:
  trailers-ng:
    build: .
    restart: unless-stopped
    ports:
      - "127.0.0.1:7000:7000"
    volumes:
      - trailers-ng-data:/data
    environment:
      PUBLIC_URL: https://trailers.example.com
      TMDB_API_KEY: ${TMDB_API_KEY:-}
      PLEX_TOKEN: ${PLEX_TOKEN:-}

volumes:
  trailers-ng-data:
```

### Reverse proxy

Point your domain at the server and proxy HTTPS to port 7000. With Caddy:

```caddyfile
trailers.example.com {
  reverse_proxy 127.0.0.1:7000
}
```

Then open `https://trailers.example.com/configure` to build the manifest URL. To update, pull the latest code and rebuild or restart; the cache file is kept.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUBLIC_URL` | taken from the request | Public address of the addon, used for Apple TV playlist links. Set it when running behind a reverse proxy |
| `HOST` | `127.0.0.1` (`0.0.0.0` in Docker) | Listen address |
| `PORT` | `7000` | Listen port |
| `CACHE_PATH` | `data/cache.sqlite` (`/data/cache.sqlite` in Docker) | SQLite cache file |
| `TMDB_API_KEY` | none | Optional, see [Optional keys](#optional-keys) |
| `PLEX_TOKEN` | none | Optional, see [Optional keys](#optional-keys). Without it the addon requests an anonymous Plex token, which works from most home and VPS addresses |

## Response

```json
{
  "meta": {
    "id": "tt15398776",
    "type": "movie",
    "name": "Oppenheimer",
    "trailerStreams": [
      {
        "url": "https://video.internetvideoarchive.net/video.mp4?...",
        "title": "Trailer 2 · EN",
        "description": "Oppenheimer (Trailer 2)\nPlex",
        "thumbnail": "https://metadata-static.plex.tv/extras/iva/..."
      }
    ]
  }
}
```

## Development

```sh
npm test            # unit tests, no network
npm run check:live  # checks 40 popular titles against the real sources
```

`npm run check:live -- en` runs the live check with English as the preferred language.

## Attribution

YouTube fallback trailers in the preferred language come from [TMDB](https://www.themoviedb.org/) when the instance has a TMDB API key. This product uses the TMDB API but is not endorsed or certified by TMDB.

## Disclaimer

None of the sources offer an official public API for trailer files. This addon reads publicly available pages and endpoints, which may be against the terms of service of those sites, and any of them can change or block access at any time. The addon does not host or proxy video files; players load them directly from the original CDNs. You are responsible for how you run and use your instance.

## License

[MIT](LICENSE)
