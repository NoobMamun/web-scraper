import { absUrl, cleanText, normalizeDate, normalizeUrl, truncate } from './utils.js';

const ARTICLE_TYPES = /^(Article|NewsArticle|BlogPosting|Report|ScholarlyArticle|TechArticle|AnalysisNewsArticle|OpinionNewsArticle|ReviewNewsArticle|LiveBlogPosting|Posting|SocialMediaPosting|VideoObject|Event|Product|Recipe|Course|JobPosting|CreativeWork|WebPage)$/;

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const typesOf = (node) => asArray(node?.['@type']).map(String);

function nameOf(v) {
  if (!v) return '';
  if (typeof v === 'string') return cleanText(v);
  if (Array.isArray(v)) return v.map(nameOf).filter(Boolean).join(', ');
  return cleanText(v.name || '');
}

function imageOf(v, base) {
  const first = asArray(v)[0];
  if (!first) return '';
  return absUrl(typeof first === 'string' ? first : first.url || first.contentUrl, base) || '';
}

function toItem(node, base) {
  const url = absUrl(node.url || node['@id'] || (typeof node.mainEntityOfPage === 'string' ? node.mainEntityOfPage : node.mainEntityOfPage?.['@id']), base);
  const title = cleanText(node.headline || node.name || '');
  if (!title && !url) return null;
  return {
    title,
    description: truncate(cleanText(node.description || node.abstract || ''), 600),
    date: normalizeDate(node.datePublished || node.startDate || node.uploadDate || node.dateCreated || node.datePosted || ''),
    author: nameOf(node.author || node.creator || node.organizer || node.publisher),
    url: url || '',
    image: imageOf(node.image || node.thumbnailUrl, base),
    type: typesOf(node)[0] || '',
  };
}

/** Walk every JSON-LD blob; returns article-like entries and any named ItemLists. */
export function extractStructuredData($, pageUrl) {
  const items = [];
  const lists = [];
  const visit = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 6) return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, depth + 1));
    if (node['@graph']) visit(node['@graph'], depth + 1);
    const types = typesOf(node);
    if (types.includes('ItemList') && node.itemListElement) {
      const listItems = asArray(node.itemListElement)
        .map((el) => (el.item && typeof el.item === 'object' ? el.item : el.url ? el : null))
        .filter(Boolean)
        .map((el) => toItem(el, pageUrl))
        .filter((it) => it?.title);
      if (listItems.length) lists.push({ name: cleanText(node.name || ''), items: listItems });
      return;
    }
    if (types.some((t) => ARTICLE_TYPES.test(t)) && !types.includes('WebSite')) {
      const it = toItem(node, pageUrl);
      if (it) items.push({ ...it, _body: node.articleBody || '' });
    }
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try {
      visit(JSON.parse(raw));
    } catch {
      // Some sites ship invalid JSON-LD (trailing commas, control chars) — skip it.
    }
  });

  const byUrl = new Map();
  for (const it of [...items, ...lists.flatMap((l) => l.items)]) {
    if (it.url && !byUrl.has(normalizeUrl(it.url))) byUrl.set(normalizeUrl(it.url), it);
  }
  const pageKey = normalizeUrl(pageUrl);
  const pageArticle = items.find((it) => /Article|BlogPosting|Posting|Report/.test(it.type) && (!it.url || normalizeUrl(it.url) === pageKey)) || null;
  return { byUrl, lists, pageArticle };
}
