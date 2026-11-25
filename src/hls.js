function parseAttributes(line) {
  const body = line.slice(line.indexOf(':') + 1);
  return new Map(Array.from(body.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g), ([, name, value]) => [name, value]));
}

function attribute(attributes, name) {
  return attributes.get(name)?.replace(/^"|"$/g, '');
}

function formatAttributes(attributes) {
  return Array.from(attributes, ([name, value]) => `${name}=${value}`).join(',');
}

export function nominalHeight(width, height) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (w >= 3800 || h >= 2000) return 2160;
  if (w >= 1900 || h >= 1000) return 1080;
  if (w >= 1260 || h >= 700) return 720;
  return h || null;
}

export function baseLanguage(code) {
  return typeof code === 'string' ? code.split('-')[0].toLowerCase() : '';
}

function absoluteUri(value, baseUrl) {
  if (!value || value.startsWith('#')) return null;
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function lines(playlist) {
  return typeof playlist === 'string' ? playlist.trim().split(/\r?\n/) : [];
}

export function describePlaylist(playlist) {
  const all = lines(playlist);
  if (all[0] !== '#EXTM3U') return null;
  const audio = new Set();
  let height = 0;
  for (const line of all) {
    if (line.startsWith('#EXT-X-MEDIA:')) {
      const attributes = parseAttributes(line);
      if (attribute(attributes, 'TYPE') === 'AUDIO') {
        const language = baseLanguage(attribute(attributes, 'LANGUAGE'));
        if (language) audio.add(language);
      }
    } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const [width, rawHeight] = (attribute(parseAttributes(line), 'RESOLUTION') ?? '').split('x');
      const value = nominalHeight(width, rawHeight) ?? 0;
      if (value > height) height = value;
    }
  }
  return {
    audio: [...audio],
    height: height || null,
    protected: all.some(line => line.startsWith('#EXT-X-SESSION-KEY:'))
  };
}

export function playlistForLanguage(playlist, baseUrl, language) {
  const all = lines(playlist);
  if (all[0] !== '#EXTM3U' || all.some(line => line.startsWith('#EXT-X-SESSION-KEY:'))) return null;

  const renditions = new Map();
  for (const line of all) {
    if (!line.startsWith('#EXT-X-MEDIA:')) continue;
    const attributes = parseAttributes(line);
    if (attribute(attributes, 'TYPE') !== 'AUDIO') continue;
    if (baseLanguage(attribute(attributes, 'LANGUAGE')) !== language) continue;
    if (attribute(attributes, 'CHARACTERISTICS')?.includes('public.accessibility.describes-video')) continue;
    const group = attribute(attributes, 'GROUP-ID');
    const uri = absoluteUri(attribute(attributes, 'URI'), baseUrl);
    if (!group || !uri || renditions.has(group)) continue;
    attributes.set('URI', `"${uri}"`);
    attributes.set('DEFAULT', 'YES');
    attributes.set('AUTOSELECT', 'YES');
    attributes.delete('PATHWAY-ID');
    attributes.delete('STABLE-RENDITION-ID');
    renditions.set(group, attributes);
  }

  const variants = [];
  const usedGroups = new Set();
  for (const [index, line] of all.entries()) {
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
    const attributes = parseAttributes(line);
    const group = attribute(attributes, 'AUDIO');
    const uri = absoluteUri(all[index + 1]?.trim(), baseUrl);
    if (!renditions.has(group) || !uri || !attributes.has('BANDWIDTH')) continue;
    attributes.delete('SUBTITLES');
    attributes.delete('CLOSED-CAPTIONS');
    attributes.delete('PATHWAY-ID');
    attributes.delete('STABLE-VARIANT-ID');
    variants.push(`#EXT-X-STREAM-INF:${formatAttributes(attributes)}`, uri);
    usedGroups.add(group);
  }
  if (!variants.length) return null;

  const header = all.filter(line => /^#EXT-X-VERSION:\d+$/.test(line) || line === '#EXT-X-INDEPENDENT-SEGMENTS');
  const media = Array.from(usedGroups, group => `#EXT-X-MEDIA:${formatAttributes(renditions.get(group))}`);
  return ['#EXTM3U', ...header, ...media, ...variants, ''].join('\n');
}
