export const LANGUAGES = {
  en: { name: 'English', storefront: 'us' },
  pl: { name: 'Polski', storefront: 'pl' },
  fr: { name: 'Français', storefront: 'fr' },
  de: { name: 'Deutsch', storefront: 'de' },
  es: { name: 'Español', storefront: 'es' },
  it: { name: 'Italiano', storefront: 'it' },
  pt: { name: 'Português', storefront: 'br' },
  cs: { name: 'Čeština', storefront: 'cz' },
  hu: { name: 'Magyar', storefront: 'hu' },
  tr: { name: 'Türkçe', storefront: 'tr' },
  ja: { name: '日本語', storefront: 'jp' }
};

export const DEFAULT_CONFIG = Object.freeze({ lang: 'en', english: true, youtube: true });

export function storefrontFor(language) {
  return LANGUAGES[language]?.storefront ?? 'us';
}

function fromBase64Url(text) {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  return atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
}

export function encodeConfig(config) {
  const normalized = normalizeConfig(config);
  const parts = [normalized.lang];
  if (normalized.english && normalized.lang !== 'en') parts.push('en');
  if (!normalized.youtube) parts.push('noyt');
  return parts.join('+');
}

const READABLE_CONFIG = /^([a-z]{2})((?:\+(?:en|noyt))*)$/;

export function decodeConfig(segment) {
  if (!segment) return { ...DEFAULT_CONFIG };
  const readable = READABLE_CONFIG.exec(decodeURIComponent(segment));
  if (readable) {
    if (!Object.hasOwn(LANGUAGES, readable[1])) return null;
    const flags = readable[2].split('+').filter(Boolean);
    return normalizeConfig({
      lang: readable[1],
      english: flags.includes('en') || readable[1] === 'en',
      youtube: !flags.includes('noyt')
    });
  }
  try {
    const raw = JSON.parse(fromBase64Url(segment));
    if (!raw || typeof raw !== 'object') return null;
    return normalizeConfig({ lang: raw.l, english: raw.e === 1, youtube: true });
  } catch {
    return null;
  }
}

export function normalizeConfig(config) {
  return {
    lang: Object.hasOwn(LANGUAGES, config?.lang) ? config.lang : DEFAULT_CONFIG.lang,
    english: config?.english !== false,
    youtube: config?.youtube !== false
  };
}
