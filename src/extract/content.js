/**
 * Extraction for pages that are not lists of links:
 *  - a single article/blog post (full body text)
 *  - ordinary pages (company sites, docs) → heading-delimited content blocks
 */
import { pickImage } from './cards.js';
import { cleanText, findDateInText, normalizeDate, truncate } from './utils.js';

const ARTICLE_CANDIDATES = '[itemprop="articleBody"], article, [class*="article-body"], [class*="articleBody"], [class*="article-content"], [class*="post-content"], [class*="entry-content"], [class*="story-body"], [class*="post-body"], [class*="content-body"], main, [role="main"], body';

function paragraphText(ctx, root) {
  const { $ } = ctx;
  const out = [];
  $(root).find('p, h2, h3, li, blockquote').each((_, el) => {
    if (ctx.isChrome(el)) return;
    if (el.name !== 'li' && $(el).parents('li').length) return;
    if (el.name === 'li' && $(el).find('p').length) return;
    const t = cleanText($(el).text());
    if (!t) return;
    if (el.name === 'h2' || el.name === 'h3') { if (t.length < 150) out.push(`## ${t}`); return; }
    if (t.length >= 30) out.push(t);
  });
  // Drop trailing heading lines that have no text after them.
  while (out.length && out[out.length - 1].startsWith('## ')) out.pop();
  return out;
}

export function isArticlePage(meta, structured) {
  return meta.ogType === 'article' || Boolean(structured.pageArticle);
}

/** Full single-article extraction. Returns one item with a `content` field. */
export function extractArticle(ctx, meta, structured) {
  const { $, pageUrl } = ctx;
  const candidates = $(ARTICLE_CANDIDATES).toArray().map((el) => {
    const paras = paragraphText(ctx, el);
    return { el, paras, len: paras.reduce((n, p) => n + p.length, 0) };
  });
  const best = Math.max(0, ...candidates.map((c) => c.len));
  // Most specific element that still holds most of the text.
  const chosen = candidates.filter((c) => c.len >= best * 0.8).sort((a, b) => ctx.textLen(a.el) - ctx.textLen(b.el))[0];
  const ld = structured.pageArticle || {};
  const paras = chosen?.paras || [];
  const firstPara = paras.find((p) => !p.startsWith('## ')) || '';
  let content = paras.join('\n\n');
  if (!content && ld._body) content = cleanText(ld._body);
  const root = chosen?.el || $('body')[0];
  const timeEl = $(root).find('time[datetime]').first().attr('datetime') || $('time[datetime]').first().attr('datetime');
  return {
    title: cleanText($('h1').first().text()) || ld.title || meta.title,
    description: truncate(ld.description || meta.description || firstPara, 600),
    date: ld.date || normalizeDate(meta.publishedTime) || normalizeDate(timeEl || findDateInText(cleanText($(root).text()).slice(0, 3000))),
    author: ld.author || meta.author || cleanText($('[rel="author"], [itemprop="author"], [class*="byline"], [class*="author"]').first().text()).replace(/^by\s+/i, '').slice(0, 80),
    url: pageUrl,
    image: ld.image || meta.image || pickImage($, root, pageUrl),
    content: truncate(content, 30000),
  };
}

/** Heading-delimited blocks: h1/h2 open a section; h3/h4 open an item within it. */
export function extractContentBlocks(ctx, cardNodes = new Set(), defaultName = 'Page Content') {
  const { $, pageUrl } = ctx;
  const inCard = (n) => {
    for (let p = n; p && p.type === 'tag'; p = p.parent) if (cardNodes.has(p)) return true;
    return false;
  };
  const root = $('main').first()[0] || $('[role="main"]').first()[0] || $('body')[0];
  if (!root) return [];
  const sections = [];
  let section = null;
  let item = null;
  const ensureSection = () => {
    if (!section) sections.push((section = { name: defaultName || 'Page Content', items: [] }));
    return section;
  };

  $(root).find('h1, h2, h3, h4, p, li, blockquote, dd, figcaption').each((_, el) => {
    if (ctx.isChrome(el) || inCard(el)) return;
    const t = cleanText($(el).text());
    if (!t) return;
    if (/^h[1-4]$/.test(el.name)) {
      if (t.length > 150) return;
      if (el.name === 'h1' || el.name === 'h2') {
        sections.push((section = { name: t, items: [] }));
        item = null;
      } else {
        item = { title: t, description: '', date: '', author: '', url: pageUrl, image: '' };
        ensureSection().items.push(item);
      }
      return;
    }
    if (el.name !== 'li' && $(el).parents('li, blockquote, dd').length) return;
    if (t.length < 20) return;
    if (!item) {
      item = { title: ensureSection().name, description: '', date: '', author: '', url: pageUrl, image: '' };
      section.items.push(item);
    }
    if (item.description.length < 1500) item.description += (item.description ? '\n' : '') + t;
  });

  for (const s of sections) {
    s.items = s.items.filter((it) => it.description);
    for (const it of s.items) it.description = truncate(it.description, 1500);
  }
  return sections.filter((s) => s.items.length);
}
