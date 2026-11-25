export function fakeFetcher(routes) {
  const calls = [];
  const fetcher = async (input, options = {}) => {
    const url = String(input);
    calls.push({ url, options });
    for (const [pattern, body] of routes) {
      const matches = typeof pattern === 'string' ? url === pattern : pattern.test(url);
      if (!matches) continue;
      if (body === null) return new Response('', { status: 404 });
      const text = typeof body === 'string' ? body : JSON.stringify(body);
      return new Response(text, { status: 200 });
    }
    return new Response('', { status: 404 });
  };
  fetcher.calls = calls;
  return fetcher;
}

export const APPLE_PAGE = `<html><head>
<meta name="apple:title" content="The Matrix">
<meta property="og:image" content="https://is1-ssl.mzstatic.com/image/thumb/x/1200x675.jpg">
<meta property="og:video:secure_url" content="https://play-edge.itunes.apple.com/WebObjects/MZPlayLocal.woa/hls/playlist.m3u8?cc=PL&amp;a=1&amp;id=2">
</head></html>`;

export const APPLE_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",LANGUAGE="en-US",NAME="English",DEFAULT=YES,AUTOSELECT=YES,URI="audio/en.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",LANGUAGE="pl",NAME="Polski",DEFAULT=NO,AUTOSELECT=YES,URI="audio/pl.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",LANGUAGE="pl",NAME="Polski AD",CHARACTERISTICS="public.accessibility.describes-video",URI="audio/pl-ad.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="pl",NAME="Polski",URI="subs/pl.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=1920x804,AUDIO="aac",SUBTITLES="subs"
video/1080.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x536,AUDIO="aac",SUBTITLES="subs"
video/720.m3u8
`;

export const PLEX_EXTRAS = {
  MediaContainer: {
    Metadata: [
      {
        subtype: 'trailer',
        title: 'Oppenheimer',
        thumb: 'https://metadata-static.plex.tv/extras/iva/1/a.jpg',
        duration: 111000,
        Media: [{ url: 'https://video.internetvideoarchive.net/video.mp4?publishedid=1', duration: 111000, videoResolution: '1080' }]
      },
      {
        subtype: 'trailer',
        title: 'Oppenheimer (Trailer 2)',
        thumb: 'https://metadata-static.plex.tv/extras/iva/2/b.jpg',
        Media: [{ url: 'https://video.internetvideoarchive.net/video.mp4?publishedid=2', duration: 184000, videoResolution: '1080' }]
      },
      {
        subtype: 'trailer',
        title: 'Oppenheimer (UK Trailer 1)',
        thumb: 'https://metadata-static.plex.tv/extras/iva/3/c.jpg',
        Media: [{ url: 'https://video.internetvideoarchive.net/video.mp4?publishedid=3', duration: 111000, videoResolution: '1080' }]
      },
      {
        subtype: 'behindTheScenes',
        title: 'Score',
        Media: [{ url: 'https://video.internetvideoarchive.net/video.mp4?publishedid=4', duration: 199000 }]
      }
    ]
  }
};

export const RT_PAGE = `<html><script id="videos" type="application/json">${JSON.stringify([
  { videoType: 'FEATURETTE', title: 'Featurette', file: 'https://link.theplatform.com/s/x/media/a?formats=MPEG4' },
  {
    videoType: 'TRAILER',
    title: 'Oppenheimer: Trailer 2',
    description: 'The second trailer.',
    file: 'https://link.theplatform.com/s/NGweTC/media/PBIZ?formats=MPEG4',
    durationInSeconds: '183.642',
    image: 'https://statcdn.fandango.com/thumb.jpg'
  }
])}</script></html>`;

export const RT_SMIL = `<smil><body><seq>
<video src="https://video.fandango.com/MPX/a/low.mp4" system-bitrate="2000000" height="720" width="1280"/>
<video src="https://video.fandango.com/MPX/a/high.mp4" system-bitrate="13381605" height="1080" width="1920"/>
</seq></body></smil>`;

export const FILMWEB_VIDEOS = [
  { id: 65242, name: 'nr 2', type: 'trailer', thumbnail: '/52/42/65242/65242.$.jpg' },
  { id: 70000, name: 'kulisy', type: 'making_of', thumbnail: '/70/00/70000/70000.$.jpg' }
];

export const FILMWEB_PAGE = `<div data-video-name="Zwiastun nr 2 (polski)"></div>
<span itemprop="contentUrl" content="https://fwcdn.pl/video/trailer/Oppenheimer___New_Trailer.h265.1080p.mp4" style="display: none;"></span>`;

export function wikidataEntity({ imdbId = 'tt15398776', languageId = 'Q1860' } = {}) {
  return {
    entities: {
      Q108839994: {
        labels: { en: { value: 'Oppenheimer' } },
        claims: {
          P345: [{ rank: 'normal', mainsnak: { datavalue: { value: imdbId } } }],
          P364: [{ rank: 'normal', mainsnak: { datavalue: { value: { id: languageId } } } }],
          P577: [{ rank: 'normal', mainsnak: { datavalue: { value: { time: '+2023-07-21T00:00:00Z' } } } }],
          P9586: [{ rank: 'normal', mainsnak: { datavalue: { value: 'umc.cmc.5gylew9icuhfiifdv3oxwxen8' } } }],
          P1258: [{ rank: 'normal', mainsnak: { datavalue: { value: 'm/oppenheimer_2023' } } }],
          P5032: [{ rank: 'normal', mainsnak: { datavalue: { value: '10002817' } } }]
        }
      }
    }
  };
}

export function wikidataRoutes(options) {
  return [
    [/hub\.toolforge\.org\/P345:/, { origin: { qid: 'Q108839994' } }],
    [/wikidata\.org\/w\/api\.php\?.*list=search/, { query: { search: [{ title: 'Q108839994' }] } }],
    ['https://www.wikidata.org/wiki/Special:EntityData/Q108839994.json', wikidataEntity(options)]
  ];
}
