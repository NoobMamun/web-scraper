import { absUrl, cleanText, normalizeUrl, sameSite, wordCount } from './utils.js';

const meta = ($, ...names) => {
  for (const n of names) {
    const v = $(`meta[property="${n}"], meta[name="${n}"], meta[itemprop="${n}"]`).first().attr('content');
    if (v && cleanText(v)) return cleanText(v);
  }
  return '';
};

/** Site-level information: title, description, language, favicon, image. */
export function extractMetadata($, pageUrl) {
  const title = meta($, 'og:title', 'twitter:title') || cleanText($('title').first().text()) || cleanText($('h1').first().text());
  const siteName = meta($, 'og:site_name', 'application-name') || new URL(pageUrl).hostname.replace(/^www\./, '');
  const favicon = absUrl($('link[rel~="icon"]').first().attr('href') || '/favicon.ico', pageUrl);
  return {
    url: pageUrl,
    title: cleanText($('title').first().text()) || title,
    siteName,
    description: meta($, 'description', 'og:description', 'twitter:description'),
    language: $('html').attr('lang') || '',
    image: absUrl(meta($, 'og:image', 'twitter:image'), pageUrl) || '',
    favicon: favicon || '',
    ogType: meta($, 'og:type').toLowerCase(),
    publishedTime: meta($, 'article:published_time', 'datePublished', 'pubdate', 'date', 'dc.date'),
    author: meta($, 'author', 'article:author', 'dc.creator'),
  };
}

/** Main site sections/categories, taken from navigation menus. */
export function extractCategories($, pageUrl) {
  const seen = new Set();
  const out = [];
  $('nav a, header a, [role="navigation"] a, [class*="menu"] a, [class*="nav"] a').each((_, el) => {
    const name = cleanText($(el).text());
    const url = absUrl($(el).attr('href'), pageUrl);
    if (!url || !name || name.length > 32 || wordCount(name) > 4) return;
    if (!sameSite(url, pageUrl) || new URL(url).pathname === '/') return;
    if (/^(home|login|log in|sign in|sign up|register|subscribe|search|menu|more|contact( us)?|about( us)?|privacy.*|terms.*|cookies?.*|skip.*|close|account|my account|cart|help)$/i.test(name)) return;
    const key = normalizeUrl(url);
    if (seen.has(key) || seen.has(name.toLowerCase())) return;
    seen.add(key);
    seen.add(name.toLowerCase());
    out.push({ name, url });
  });
  return out.slice(0, 40);
}
