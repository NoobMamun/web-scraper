import { absUrl, cleanText, normalizeUrl, sameSite } from './utils.js';

const NEXT_TEXT = /^(next|next page|next ›|next »|next →|older|older (posts|entries|articles|stories)|more (posts|articles|stories|news)|›|»|→|>|>>|পরবর্তী|siguiente|suivant|weiter|próxima)$/i;
const NEXT_CLASS = /(^|[\s_-])next([\s_-]|$)/i;

/** Find the "next page" URL of a paginated listing, or null. Must be same-site and unvisited. */
export function findNextPage($, pageUrl, visited) {
  const candidates = [];
  $('link[rel="next"], a[rel~="next"]').each((_, el) => candidates.push($(el).attr('href')));
  $('a[href]').each((_, a) => {
    const $a = $(a);
    const text = cleanText($a.text());
    const label = cleanText($a.attr('aria-label') || $a.attr('title') || '');
    const cls = `${$a.attr('class') || ''} ${$a.parent().attr('class') || ''}`;
    if (NEXT_TEXT.test(text) || /^(go to )?next( page)?$/i.test(label) ||
        (NEXT_CLASS.test(cls) && $a.closest('[class*="pag"], nav, [role="navigation"]').length)) {
      candidates.push($a.attr('href'));
    }
  });
  for (const href of candidates) {
    const url = absUrl(href, pageUrl);
    if (url && sameSite(url, pageUrl) && !visited.has(normalizeUrl(url))) return url;
  }
  return null;
}
