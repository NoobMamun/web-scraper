/**
 * Groups detected cards into sections named after the page's own structure:
 * the nearest preceding section heading, or an aria-labelled region, or — when the
 * page has no headings — the URL category segment the items share (/sports/..., /tech/...).
 */
import { cleanText, titleCase, wordCount } from './utils.js';

const HEADING_SEL = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', '[role="heading"]',
  '[class*="section-title"]', '[class*="section-heading"]', '[class*="sectionTitle"]', '[class*="section__title"]',
  '[class*="block-title"]', '[class*="widget-title"]', '[class*="module-title"]', '[class*="category-title"]',
  '[class*="heading"]',
].join(', ');
const LABEL_TAGS = new Set(['section', 'aside', 'div', 'ul', 'ol']);
const BAD_NAME = /^(advertisement|advert|sponsored( content)?|ads?|share|comments?|menu|search|©.*|copyright.*)$/i;
const IGNORED_SEGMENTS = /^(article|articles|story|stories|post|posts|p|news|amp|www|index|item|items|content|details?|view|read|blog|a|s|b|c|v|id|\d+|[a-z]{2}(-[a-z]{2})?)$/i;

export function cleanSectionName(raw) {
  let t = cleanText(raw)
    .replace(/\[\s*[^\]]{0,20}\]/g, '') // Wikipedia-style "[ edit ]" markers
    .replace(/\s*(view|see|show|read|explore)\s+(all|more)\b.*$/i, '')
    .replace(/\s*(more)\s*[›»→>]*$/i, '')
    .replace(/[\s›»→>:|•·-]+$/g, '')
    .replace(/^[\s›»→>:|•·-]+/g, '')
    .trim();
  if (t.length < 2 || t.length > 60 || wordCount(t) > 8 || BAD_NAME.test(t)) return '';
  return t;
}

function ariaLabel($, node) {
  if (!LABEL_TAGS.has(node.name)) return '';
  const a = node.attribs || {};
  if (a['aria-label']) return cleanSectionName(a['aria-label']);
  if (a['aria-labelledby']) {
    const ref = $(`#${a['aria-labelledby'].split(/\s+/)[0].replace(/([^\w-])/g, '\\$1')}`).first();
    if (ref.length) return cleanSectionName(ref.text());
  }
  return '';
}

function urlSegment(url, pageUrl) {
  try {
    const u = new URL(url);
    if (u.hostname.replace(/^www\./, '') !== new URL(pageUrl).hostname.replace(/^www\./, '')) return '';
    const segs = u.pathname.split('/').filter(Boolean);
    // The last segment is the item slug itself; categories live before it.
    for (const s of segs.slice(0, -1).slice(0, 3)) {
      const d = decodeURIComponent(s);
      if (IGNORED_SEGMENTS.test(d) || /^\d{4}$/.test(d) || d.length > 30 || (d.match(/-/g) || []).length > 3) continue;
      return titleCase(d);
    }
  } catch { /* ignore */ }
  return '';
}

/** Index of the last element with .order < order in a sorted array, or -1. */
function lastBefore(arr, order) {
  let lo = 0, hi = arr.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < order) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

/**
 * Nearest preceding heading whose scope covers the item. A heading's "wrapper" is its
 * ancestor just below the common ancestor with the item; if that wrapper already holds
 * cards of its own (e.g. a promo banner), the heading belongs to those cards only.
 */
function headingFor(ctx, headings, headingOrders, cardOrders, item) {
  let idx = lastBefore(headingOrders, item._order);
  for (let tries = 0; idx >= 0 && tries < 12; idx--, tries++) {
    const h = headings[idx];
    let wrapper = h.el;
    while (wrapper.parent && wrapper.parent.type === 'tag' && !ctx.contains(wrapper.parent, item._node)) wrapper = wrapper.parent;
    const from = ctx.pre.get(wrapper), to = ctx.end.get(wrapper);
    const c = lastBefore(cardOrders, to + 1);
    const wrapperHasCards = c >= 0 && cardOrders[c] >= from;
    if (!wrapperHasCards) return h;
  }
  return null;
}

/**
 * @param ctx      PageContext
 * @param items    cards from detectCards()
 * @param exclude  names that must not become section names (site title etc.)
 * @returns Array<{ name, items }>
 */
export function groupIntoSections(ctx, items, exclude = []) {
  const { $ } = ctx;
  const cardNodes = new Set(items.map((i) => i._node));
  const inCard = (n) => {
    for (let p = n; p && p.type === 'tag'; p = p.parent) if (cardNodes.has(p)) return true;
    return false;
  };
  const excluded = new Set(exclude.filter(Boolean).map((s) => s.toLowerCase()));
  const titles = new Set(items.map((i) => i.title.toLowerCase()));

  const headings = [];
  $(HEADING_SEL).each((_, h) => {
    if (ctx.isChrome(h) || inCard(h)) return;
    const prev = headings[headings.length - 1];
    if (prev && ctx.contains(prev.el, h)) return; // nested heading-ish element inside an outer heading
    const text = cleanSectionName($(h).text());
    if (!text || excluded.has(text.toLowerCase()) || titles.has(text.toLowerCase())) return;
    headings.push({ el: h, text, order: ctx.pre.get(h) });
  });
  headings.sort((a, b) => a.order - b.order);
  const headingOrders = headings.map((h) => h.order);
  const cardOrders = items.map((i) => i._order).sort((a, b) => a - b);

  const named = new Map(); // lowercased name -> section
  const unnamed = [];
  for (const item of items) {
    const h = headingFor(ctx, headings, headingOrders, cardOrders, item);
    const limit = h ? h.order : -1;
    let name = '';
    // aria-labelled regions closer to the item than the heading win
    for (let a = item._node.parent; a && a.type === 'tag' && ctx.pre.get(a) > limit; a = a.parent) {
      name = ariaLabel($, a);
      if (name) break;
    }
    name = name || h?.text || '';
    if (!name) { unnamed.push(item); continue; }
    const key = name.toLowerCase();
    if (!named.has(key)) named.set(key, { name, items: [], order: item._order });
    named.get(key).items.push(item);
  }

  // No heading: split by URL category when a category clearly dominates a group of items.
  const bySeg = new Map();
  for (const item of unnamed) {
    const seg = urlSegment(item.url, ctx.pageUrl);
    if (!bySeg.has(seg)) bySeg.set(seg, []);
    bySeg.get(seg).push(item);
  }
  const rest = [];
  for (const [seg, segItems] of bySeg) {
    if (seg && segItems.length >= 3) {
      const key = seg.toLowerCase();
      if (!named.has(key)) named.set(key, { name: seg, items: [], order: segItems[0]._order });
      named.get(key).items.push(...segItems);
    } else rest.push(...segItems);
  }
  if (rest.length) {
    const firstNamed = Math.min(...[...named.values()].map((s) => s.order));
    const largestNamed = Math.max(0, ...[...named.values()].map((s) => s.items.length));
    const name = rest.length > largestNamed ? 'Main Content' : rest[0]._order < firstNamed ? 'Featured' : 'Other Content';
    named.set(`__${name}`, { name, items: rest, order: rest[0]._order });
  }

  return [...named.values()]
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ name: s.name, items: s.items.sort((a, b) => a._order - b._order) }));
}
