const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$|cmpid$|ocid$)/i;

export function cleanText(s) {
  return (s || '').replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
}

export function truncate(s, n) {
  if (!s || s.length <= n) return s || '';
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut) + '…';
}

export function wordCount(s) {
  return s ? s.split(/\s+/).filter(Boolean).length : 0;
}

/** Resolve href against base; only http(s); drops the fragment. */
export function absUrl(href, base) {
  if (!href) return null;
  href = href.trim();
  if (!href || href.startsWith('#') || /^(javascript|mailto|tel|data|sms):/i.test(href)) return null;
  try {
    const u = new URL(href, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

/** Canonical key for de-duplication: no www, no tracking params, no trailing slash. */
export function normalizeUrl(href) {
  try {
    const u = new URL(href);
    u.hash = '';
    u.hostname = u.hostname.replace(/^www\./, '');
    for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAM.test(k)) u.searchParams.delete(k);
    u.protocol = 'https:';
    let s = u.href;
    if (u.pathname !== '/' && s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch {
    return href || '';
  }
}

export function sameSite(a, b) {
  try {
    const strip = (h) => h.replace(/^www\./, '');
    return strip(new URL(a).hostname) === strip(new URL(b).hostname);
  } catch {
    return false;
  }
}

const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const DATE_PATTERNS = [
  /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/,
  new RegExp(`\b(?:${MONTHS})\.? \d{1,2}(?:st|nd|rd|th)?,? \d{4}\b`, 'i'),
  new RegExp(`\b\d{1,2}(?:st|nd|rd|th)? (?:${MONTHS})\.?,? \d{4}\b`, 'i'),
  /\b\d{1,2}[/.]\d{1,2}[/.]\d{4}\b/,
  /\b\d+\s+(?:second|minute|min|hour|hr|day|week|month|year)s?\s+ago\b/i,
  /\b(?:yesterday|today)\b/i,
];

export function findDateInText(text) {
  if (!text) return '';
  for (const re of DATE_PATTERNS) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return '';
}

/** Normalise a date string to YYYY-MM-DD[ HH:MM] when parseable; else keep the short raw text. */
export function normalizeDate(raw) {
  raw = cleanText(raw).replace(/^(published|posted|updated|last updated|date)\s*:?\s*/i, '');
  if (!raw) return '';
  if (/^\d{9,13}$/.test(raw)) { // unix timestamp
    const n = Number(raw);
    const d = new Date(raw.length > 10 ? n : n * 1000);
    return isNaN(d) ? '' : formatDate(d, true);
  }
  const rel = resolveRelative(raw);
  if (rel) return rel;
  const looksAbsolute = /\d{4}/.test(raw) && !/\bago\b/i.test(raw);
  if (looksAbsolute) {
    const d = new Date(raw.replace(/(\d)(st|nd|rd|th)\b/, '$1'));
    const year = d.getFullYear();
    if (!isNaN(d) && year > 1990 && year <= new Date().getFullYear() + 1) {
      return formatDate(d, /\d{1,2}:\d{2}/.test(raw));
    }
  }
  return raw.length <= 60 ? raw : '';
}

const UNIT_MS = { second: 1e3, sec: 1e3, minute: 6e4, min: 6e4, hour: 36e5, hr: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 };

/** "3 hours ago" / "yesterday" → absolute date relative to now. */
function resolveRelative(raw) {
  const m = /^(\d+)\s*(second|sec|minute|min|hour|hr|day|week|month|year)s?\s+ago$/i.exec(raw);
  if (m) {
    const unit = m[2].toLowerCase();
    const d = new Date(Date.now() - Number(m[1]) * UNIT_MS[unit]);
    return formatDate(d, UNIT_MS[unit] < UNIT_MS.day);
  }
  if (/^today$/i.test(raw)) return formatDate(new Date(), false);
  if (/^yesterday$/i.test(raw)) return formatDate(new Date(Date.now() - UNIT_MS.day), false);
  return '';
}

function formatDate(d, withTime) {
  const iso = d.toISOString();
  return withTime ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : iso.slice(0, 10);
}

export function titleCase(s) {
  return s.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

export function slugify(s) {
  return cleanText(s).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
