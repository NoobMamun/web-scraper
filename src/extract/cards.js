/**
 * Content-card detection that does not rely on any particular HTML layout.
 *
 * 1. Find "title-like" links (headline-length text, not boilerplate, not in page chrome).
 * 2. For each, climb to the largest ancestor that contains no title-link to a *different*
 *    URL — that ancestor is the item's card (teaser, list row, tile...).
 * 3. Read title / description / date / author / image from inside the card.
 */
import { HEADING_TAGS } from './dom.js';
import { absUrl, cleanText, findDateInText, normalizeDate, normalizeUrl, sameSite, truncate, wordCount } from './utils.js';

const BOILERPLATE = /^(read more|read full|continue reading|learn more|click here|view all|see all|see more|show more|load more|more (news|stories|articles|posts)|sign (in|up)|log ?in|log ?out|subscribe|privacy|terms|cookie|skip to|back to top|share (on|this|via)|follow us|download (the )?app|next|previous|older|newer|page \d+)/i;
const SKIP_URL = /\/(sharer|share|intent\/tweet|login|signin|sign-in|signup|register|subscribe|cart|checkout|account|wp-login)\b|[?&](share|replytocom)=/i;
const NON_SPACED_SCRIPT = /[぀-ヿ㐀-鿿가-힯฀-๿]/;
const STOP_TAGS = new Set(['body', 'html', 'main']);
const DESC_SEL = 'p, [class*="desc"], [class*="summary"], [class*="excerpt"], [class*="dek"], [class*="teaser"], [class*="standfirst"], [class*="snippet"], [class*="intro"], [class*="lead"], [class*="subtitle"], [class*="blurb"]';
const DATE_SEL = 'time, [datetime], [class*="date"], [class*="time"], [class*="publish"], [class*="posted"], [itemprop="datePublished"]';
const AUTHOR_SEL = '[rel="author"], [itemprop="author"], [class*="author"], [class*="byline"], [class*="writer"], [class*="contributor"]';
const MAX_CARD_TEXT = 2500;

export function isTitleLike(text) {
  if (!text || text.length > 300) return false;
  if (BOILERPLATE.test(text)) return false;
  if (/^[\p{N}\p{P}\p{S}\s]+$/u.test(text)) return false; // digits/punctuation only (Unicode-aware)
  const words = wordCount(text);
  if (words >= 3 && text.length >= 15) return true;
  return NON_SPACED_SCRIPT.test(text) && text.length >= 8;
}

function linkText($, a) {
  const $a = $(a);
  return cleanText($a.text()) || cleanText($a.attr('aria-label')) || cleanText($a.attr('title')) || '';
}

/** Links embedded in running text (article prose, wiki pages) are references, not content items. */
function isInlineProseLink($, a, text) {
  // Words directly beside the link — at its own level or around inline wrappers (<b><a/></b>).
  const hasWords = (n) => n && n.type === 'text' && /\p{L}{2,}/u.test(n.data);
  let node = a;
  let adjacent = hasWords(node.prev) || hasWords(node.next);
  while (!adjacent && node.parent && /^(b|strong|i|em|span|u|mark|small|sup|sub)$/.test(node.parent.name)) {
    node = node.parent;
    adjacent = hasWords(node.prev) || hasWords(node.next);
  }
  if (!adjacent) return false;
  const block = $(a).closest('p, li, dd, td, div, blockquote, figcaption');
  if (!block.length) return false;
  const blockText = cleanText(block.text());
  return blockText.length - text.length >= 40 && blockText.length > text.length * 2;
}

function collectTitleLinks(ctx) {
  const { $, pageUrl } = ctx;
  const pageKey = normalizeUrl(pageUrl);
  const links = [];
  $('a[href]').each((_, a) => {
    if (ctx.isChrome(a)) return;
    const url = absUrl($(a).attr('href'), pageUrl);
    if (!url || SKIP_URL.test(url)) return;
    const key = normalizeUrl(url);
    if (key === pageKey) return;
    const u = new URL(url);
    if (u.pathname === '/' && !u.search && sameSite(url, pageUrl)) return;
    const text = linkText($, a);
    if (!isTitleLike(text)) return;
    if (isInlineProseLink($, a, text)) return;
    links.push({ el: a, url, key, text });
  });
  return links;
}

/**
 * Fallback for pages whose headlines aren't wrapped in links in the served HTML
 * (links attached by JavaScript): headline-like headings become card anchors.
 */
function collectHeadingAnchors(ctx) {
  const { $ } = ctx;
  const anchors = [];
  $('h2, h3, h4, [class*="headline"]').each((_, h) => {
    if (ctx.isChrome(h)) return;
    if ($(h).find('a[href]').length || $(h).closest('a[href]').length) return;
    if ($(h).parents('h2, h3, h4, [class*="headline"]').length) return;
    const text = cleanText($(h).text());
    if (!isTitleLike(text)) return;
    anchors.push({ el: h, url: '', key: `h:${text.toLowerCase()}`, text });
  });
  return anchors;
}

/** node -> Set of distinct title-link keys beneath it (capped at 2: we only need "one" vs "many"). */
function buildUrlSets(links) {
  const sets = new Map();
  for (const l of links) {
    for (let n = l.el.parent; n && n.type === 'tag'; n = n.parent) {
      let s = sets.get(n);
      if (!s) sets.set(n, (s = new Set()));
      if (s.size >= 2) break; // every ancestor above already has >= 2
      s.add(l.key);
    }
  }
  return sets;
}

function hasForeignHeading(ctx, parent, current, title) {
  const $ = ctx.$;
  let foreign = false;
  $(parent).find('h1, h2, h3, h4, h5, h6').each((_, h) => {
    if (h === current || ctx.contains(current, h) || ctx.contains(h, current)) return;
    const t = cleanText($(h).text());
    if (t && t !== title && !title.includes(t) && !$(h).find('a').length) {
      foreign = true;
      return false;
    }
  });
  return foreign;
}

function climbToCard(ctx, link, urlSets) {
  let node = link.el;
  for (let depth = 0; depth < 12; depth++) {
    const parent = node.parent;
    if (!parent || parent.type !== 'tag' || STOP_TAGS.has(parent.name)) break;
    if ((urlSets.get(parent)?.size || 0) > 1) break;
    if (ctx.textLen(parent) > MAX_CARD_TEXT) break;
    if (hasForeignHeading(ctx, parent, node, link.text)) break;
    node = parent;
  }
  return node;
}

/** A link wrapping a whole card holds several text blocks; the headline is the heading or longest block. */
function titleFromLinkBlocks($, a) {
  const inner = $(a).find('h1, h2, h3, h4, h5, h6, [role="heading"]').first();
  if (inner.length && cleanText(inner.text())) return cleanText(inner.text());
  const leaves = $(a).find('p, span, div').toArray()
    .filter((el) => !$(el).find('p, span, div').length)
    .map((el) => cleanText($(el).text()))
    .filter(Boolean);
  const titleLike = leaves.filter(isTitleLike);
  return leaves.length > 1 && titleLike.length ? titleLike[0] : '';
}

function pickTitle($, card, links) {
  for (const l of links) {
    const h = $(l.el).closest('h1, h2, h3, h4, h5, h6');
    if (h.length) return cleanText(h.text()) || l.text;
  }
  for (const l of links) {
    const t = titleFromLinkBlocks($, l.el);
    if (t) return t;
  }
  const heading = $(card).find('h1, h2, h3, h4, h5, h6').filter((_, h) => $(h).find('a').length > 0).first();
  if (heading.length) return cleanText(heading.text());
  return links.reduce((best, l) => (l.text.length > best.length && l.text.length < 250 ? l.text : best), links[0].text);
}

function pickDescription(ctx, card, title, urlSets) {
  const $ = ctx.$;
  let best = '';
  $(card).find(DESC_SEL).each((_, el) => {
    if ($(el).is('a') || $(el).find(DESC_SEL).length > 2) return;
    const t = cleanText($(el).text());
    if (t.length < 25 || t === title || title.includes(t) || t.includes(title) || /^by\s/i.test(t)) return;
    if (findDateInText(t) === t) return;
    best = t;
    return false;
  });
  if (!best && (HEADING_TAGS.has(card.name) || card.name === 'a')) {
    // Flat layouts: <h3><a/></h3><p>summary</p>
    const next = $(card).next();
    if (next.length && next.is('p, div, span') && !urlSets.has(next[0])) {
      const t = cleanText(next.text());
      if (t.length >= 40 && t.length < 1200) best = t;
    }
  }
  if (!best) {
    const all = cleanText($(card).text()).replace(title, '').trim();
    if (all.length >= 80 && all.length < 800) best = all;
  }
  return truncate(best, 500);
}

function pickDate($, card) {
  let raw = '';
  $(card).find(DATE_SEL).each((_, el) => {
    const $el = $(el);
    const cand = $el.attr('datetime') || $el.attr('content') || $el.attr('data-timestamp') || $el.attr('data-date') || cleanText($el.text());
    if (cand && cand.length <= 80 && (findDateInText(cand) || /^\d{9,13}$/.test(cand) || /^\d{4}-\d{2}-\d{2}/.test(cand))) {
      raw = cand;
      return false;
    }
  });
  if (!raw) raw = findDateInText(cleanText($(card).text()));
  return normalizeDate(raw);
}

function pickAuthor($, card) {
  let author = '';
  $(card).find(AUTHOR_SEL).each((_, el) => {
    const t = cleanText($(el).attr('content') || $(el).text()).replace(/^by\s+/i, '').replace(/\s*[|•·].*$/, '');
    if (t && t.length <= 80 && wordCount(t) <= 8 && !findDateInText(t)) {
      author = t;
      return false;
    }
  });
  if (!author) {
    const m = cleanText($(card).text()).match(/\bBy\s+(\p{Lu}[\p{L}.'-]+(?:\s+(?:and\s+)?\p{Lu}[\p{L}.'-]+){0,4})/u);
    if (m) author = m[1];
  }
  return author;
}

function srcFromSrcset(srcset) {
  return srcset ? srcset.split(',')[0].trim().split(/\s+/)[0] : '';
}

export function pickImage($, node, base) {
  const $node = $(node);
  let src = '';
  $node.find('img').each((_, img) => {
    const a = img.attribs || {};
    if ((a.width && Number(a.width) < 40) || (a.height && Number(a.height) < 40)) return;
    const cand = a['data-src'] || a['data-lazy-src'] || a['data-original'] || a['data-url'] ||
      srcFromSrcset(a['data-srcset']) || (a.src && !a.src.startsWith('data:') ? a.src : '') || srcFromSrcset(a.srcset);
    if (cand && !/\.(svg)(\?|$)|spacer|pixel|blank\.gif|logo/i.test(cand)) {
      src = cand;
      return false;
    }
  });
  if (!src) src = srcFromSrcset($node.find('source[srcset]').first().attr('srcset'));
  if (!src) {
    const style = $node.find('[style*="background"]').first().attr('style') || $node.attr('style') || '';
    src = /url\(["']?([^"')]+)["']?\)/.exec(style)?.[1] || '';
  }
  return absUrl(src, base) || '';
}

/**
 * @returns {Array<{title, description, date, author, url, image, _node, _order}>}
 */
export function detectCards(ctx) {
  const { $, pageUrl } = ctx;
  const links = collectTitleLinks(ctx);
  if (links.length < 5) links.push(...collectHeadingAnchors(ctx));
  const urlSets = buildUrlSets(links);

  const cards = new Map(); // card node -> { key, links: [] }
  for (const link of links) {
    const card = climbToCard(ctx, link, urlSets);
    const entry = cards.get(card) || { key: link.key, url: link.url, links: [] };
    entry.links.push(link);
    cards.set(card, entry);
  }

  const items = [];
  for (const [card, { url, links: cardLinks }] of cards) {
    const title = pickTitle($, card, cardLinks);
    if (!isTitleLike(title)) continue;
    items.push({
      title,
      description: pickDescription(ctx, card, title, urlSets),
      date: pickDate($, card),
      author: pickAuthor($, card),
      url,
      image: pickImage($, card, pageUrl),
      _node: card,
      _order: ctx.pre.get(card),
    });
  }
  return items.sort((a, b) => a._order - b._order);
}
