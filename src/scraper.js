/**
 * Scrape pipeline:
 *   validate URL → robots.txt → fetch → metadata/JSON-LD → cards → sections
 *   → pagination → feeds (enrichment / fallback) → content fallback → dedupe → result
 *
 * Each stage lives in its own module under ./extract so it can be improved independently.
 */
import * as cheerio from 'cheerio';
import { config } from './config.js';
import { ScrapeError } from './errors.js';
import { fetchUrl, isHtml, looksLikeBotChallenge } from './net/fetcher.js';
import { RobotsPolicy } from './net/robots.js';
import { detectCards } from './extract/cards.js';
import { extractArticle, extractContentBlocks, isArticlePage } from './extract/content.js';
import { PageContext, stripNoise } from './extract/dom.js';
import { discoverFeeds, guessFeedUrls, parseFeed } from './extract/feeds.js';
import { extractCategories, extractMetadata } from './extract/metadata.js';
import { findNextPage } from './extract/pagination.js';
import { groupIntoSections, cleanSectionName } from './extract/sections.js';
import { extractStructuredData } from './extract/structured.js';
import { cleanText, normalizeUrl, slugify, sleep } from './extract/utils.js';

const FIELDS = ['title', 'description', 'date', 'author', 'url', 'image'];

export function parseInputUrl(input) {
  let raw = cleanText(input);
  if (!raw) throw new ScrapeError('INVALID_URL', 'Please enter a website URL.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new ScrapeError('INVALID_URL', 'That doesn\'t look like a valid URL. Example: https://example.com');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new ScrapeError('INVALID_URL', 'Only http:// and https:// URLs are supported.');
  }
  if (!u.hostname.includes('.') && u.hostname !== 'localhost' && !config.allowPrivateHosts) {
    throw new ScrapeError('INVALID_URL', 'That doesn\'t look like a valid website address. Example: https://example.com');
  }
  u.hash = '';
  return u.href;
}

/** Sequential, robots-aware fetching with a politeness delay between requests. */
class PoliteClient {
  constructor() {
    this.robots = new RobotsPolicy();
    this.lastRequestAt = 0;
  }

  async get(url, opts) {
    if (!(await this.robots.isAllowed(url))) {
      throw new ScrapeError('ROBOTS_DISALLOWED', 'This page is disallowed for crawlers by the website\'s robots.txt, so it was not scraped.');
    }
    const wait = this.lastRequestAt + (await this.robots.delayMs(url)) - Date.now();
    if (this.lastRequestAt && wait > 0) await sleep(wait);
    try {
      return await fetchUrl(url, opts);
    } finally {
      this.lastRequestAt = Date.now();
    }
  }
}

function analyzePage(html, pageUrl) {
  const $ = cheerio.load(html);
  const meta = extractMetadata($, pageUrl);
  const structured = extractStructuredData($, pageUrl);
  const categories = extractCategories($, pageUrl);
  const feeds = discoverFeeds($, pageUrl);
  const scriptCount = $('script').length;
  stripNoise($);
  const ctx = new PageContext($, pageUrl);
  const cards = detectCards(ctx);
  const exclude = [meta.title, meta.siteName, ...meta.title.split(/\s[|\-–—:]\s/)];
  const sections = groupIntoSections(ctx, cards, exclude);
  const bodyTextLen = cleanText($('body').text()).length;
  return { $, ctx, meta, structured, categories, feeds, cards, sections, scriptCount, bodyTextLen };
}

/** Accumulates sections across pages/sources, merging same-named sections and de-duplicating items. */
class ResultBuilder {
  constructor() {
    this.sections = new Map(); // lower name -> { name, source, items }
    this.seen = new Set();
    this.duplicates = 0;
  }

  itemKeys(item) {
    const keys = [];
    if (item.content || item._contentBlock) keys.push(`c:${item.title.toLowerCase()}:${(item.description || '').slice(0, 80)}`);
    else {
      if (item.url) keys.push(`u:${normalizeUrl(item.url)}`);
      if (item.title) keys.push(`t:${item.title.toLowerCase()}`);
    }
    return keys;
  }

  add(sectionName, source, items) {
    const name = cleanSectionName(sectionName) || sectionName || 'Content';
    const key = name.toLowerCase();
    if (!this.sections.has(key)) this.sections.set(key, { name, source, items: [] });
    const section = this.sections.get(key);
    for (const item of items) {
      const keys = this.itemKeys(item);
      if (keys.some((k) => this.seen.has(k))) { this.duplicates++; continue; }
      keys.forEach((k) => this.seen.add(k));
      section.items.push(item);
    }
  }

  get itemCount() {
    let n = 0;
    for (const s of this.sections.values()) n += s.items.length;
    return n;
  }

  build() {
    const used = new Set();
    return [...this.sections.values()]
      .filter((s) => s.items.length)
      .map((s) => {
        let id = slugify(s.name);
        while (used.has(id)) id += '-x';
        used.add(id);
        return {
          id,
          name: s.name,
          source: s.source,
          items: s.items.map((it) => {
            const clean = {};
            for (const f of FIELDS) clean[f] = cleanText(it[f] || '') || '';
            clean.description = (it.description || '').trim();
            if (it.content) clean.content = it.content;
            return clean;
          }),
        };
      });
  }
}

/** Lookup map keyed by normalized URL and by lowercased title (for items whose URL is unknown). */
function indexItems(items, map = new Map()) {
  for (const it of items) {
    if (it.url && !map.has(normalizeUrl(it.url))) map.set(normalizeUrl(it.url), it);
    if (it.title && !map.has(`t:${it.title.toLowerCase()}`)) map.set(`t:${it.title.toLowerCase()}`, it);
  }
  return map;
}

/** Fill missing fields from other sources (JSON-LD, feeds) that describe the same item. */
function enrich(items, lookups) {
  for (const item of items) {
    const key = item.url ? normalizeUrl(item.url) : `t:${(item.title || '').toLowerCase()}`;
    for (const map of lookups) {
      const extra = map.get(key);
      if (!extra) continue;
      for (const f of ['url', 'description', 'date', 'author', 'image']) if (!item[f] && extra[f]) item[f] = extra[f];
    }
  }
}

/**
 * @param {string} inputUrl
 * @param {{ maxPages?: number }} options
 * @param {(p: {message: string, percent: number}) => void} onProgress
 */
export async function scrapeSite(inputUrl, options = {}, onProgress = () => {}) {
  const startUrl = parseInputUrl(inputUrl);
  const maxPages = Math.min(Math.max(Number(options.maxPages) || config.defaultMaxPages, 1), config.maxPagesLimit);
  const client = new PoliteClient();
  const notes = [];
  const progress = (message, percent) => onProgress({ message, percent });

  progress('Checking robots.txt…', 5);
  if (!(await client.robots.isAllowed(startUrl))) {
    throw new ScrapeError('ROBOTS_DISALLOWED', 'The website\'s robots.txt disallows crawling this page, so it was not scraped.');
  }

  progress('Fetching page…', 12);
  const first = await client.get(startUrl);
  if (!isHtml(first.contentType, first.text)) {
    const feed = parseFeed(first.text, first.url);
    if (!feed) throw new ScrapeError('NOT_HTML', `This URL returned "${first.contentType || 'unknown content'}", not a web page.`);
    // The user pasted a feed URL directly — still useful.
    const rb = new ResultBuilder();
    rb.add(feed.title || 'Feed', 'feed', feed.items);
    return finalize({ url: startUrl, finalUrl: first.url, title: feed.title, siteName: feed.title, description: '', categories: [] }, rb, 1, notes);
  }
  if (looksLikeBotChallenge(null, first.text)) {
    throw new ScrapeError('BLOCKED', 'The website showed an anti-bot challenge instead of its content.');
  }

  progress('Analyzing page structure…', 30);
  const page = analyzePage(first.text, first.url);
  const { meta, structured } = page;
  const rb = new ResultBuilder();
  const lookups = [indexItems(structured.byUrl.values())];

  if (isArticlePage(meta, structured)) {
    rb.add('Article', 'article', [extractArticle(page.ctx, meta, structured)]);
  }
  for (const s of page.sections) {
    enrich(s.items, lookups);
    rb.add(s.name, 'layout', s.items);
  }

  // Pagination: follow "next" links and merge into matching sections.
  const visited = new Set([normalizeUrl(startUrl), normalizeUrl(first.url)]);
  let pagesScanned = 1;
  let nextUrl = maxPages > 1 ? findNextPage(page.$, first.url, visited) : null;
  while (nextUrl && pagesScanned < maxPages) {
    visited.add(normalizeUrl(nextUrl));
    progress(`Following pagination (page ${pagesScanned + 1})…`, 30 + pagesScanned * (30 / maxPages));
    let res;
    try {
      res = await client.get(nextUrl);
    } catch (err) {
      notes.push(`Stopped pagination at page ${pagesScanned + 1}: ${err.message}`);
      break;
    }
    if (!isHtml(res.contentType, res.text)) break;
    visited.add(normalizeUrl(res.url));
    const p = analyzePage(res.text, res.url);
    lookups.push(indexItems(p.structured.byUrl.values()));
    const before = rb.itemCount;
    for (const s of p.sections) {
      enrich(s.items, lookups);
      rb.add(s.name, 'layout', s.items);
    }
    pagesScanned++;
    if (rb.itemCount === before) break; // page added nothing new
    nextUrl = findNextPage(p.$, res.url, visited);
  }
  if (pagesScanned > 1) notes.push(`Followed pagination across ${pagesScanned} pages.`);

  // Feeds: enrich dates/authors/summaries, and act as a fallback for thin pages.
  const thin = rb.itemCount < 5;
  const feedUrls = page.feeds.slice(0, config.maxFeeds);
  if (!feedUrls.length && thin) feedUrls.push(...guessFeedUrls(first.url).slice(0, 2));
  const feeds = [];
  for (const [i, feedUrl] of feedUrls.entries()) {
    progress('Reading RSS/Atom feeds…', 65 + i * 5);
    try {
      const res = await client.get(feedUrl, { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' });
      const feed = parseFeed(res.text, res.url);
      if (feed?.items.length) feeds.push(feed);
    } catch {
      // Feeds are optional; ignore failures.
    }
  }
  if (feeds.length) {
    const feedMap = indexItems(feeds.flatMap((f) => f.items));
    for (const s of rb.sections.values()) enrich(s.items, [feedMap]);
    if (thin) {
      for (const f of feeds) rb.add(f.title || 'Latest from feed', 'feed', f.items);
      notes.push('Page content was limited, so items from the site\'s RSS/Atom feed were included.');
    }
  }

  // JSON-LD item lists as another fallback.
  if (rb.itemCount < 5) {
    for (const list of structured.lists) rb.add(list.name || 'Featured', 'structured', list.items);
  }

  // Ordinary (non-listing) pages: heading-delimited content blocks.
  if (rb.itemCount < 8 && !isArticlePage(meta, structured)) {
    progress('Extracting page content…', 85);
    const cardNodes = new Set(page.cards.map((c) => c._node));
    for (const s of extractContentBlocks(page.ctx, cardNodes, meta.title)) {
      rb.add(s.name, 'content', s.items.map((it) => ({ ...it, _contentBlock: true })));
    }
  }

  if (page.bodyTextLen < 800 && page.scriptCount > 5) {
    notes.push('This site appears to build its content with JavaScript; only content present in the initial HTML could be extracted.');
  }
  if (rb.duplicates) notes.push(`Removed ${rb.duplicates} duplicate item${rb.duplicates === 1 ? '' : 's'}.`);

  if (!rb.itemCount) {
    throw new ScrapeError('NO_CONTENT', page.bodyTextLen < 800
      ? 'No content could be extracted. The site likely renders its content with JavaScript or requires a login.'
      : 'No structured content could be detected on this page.');
  }

  progress('Organizing sections…', 95);
  return finalize({ ...meta, finalUrl: first.url, url: startUrl, categories: page.categories }, rb, pagesScanned, notes);
}

function finalize(site, rb, pagesScanned, notes) {
  const sections = rb.build();
  return {
    site: {
      url: site.url,
      finalUrl: site.finalUrl,
      title: site.title || site.siteName || new URL(site.finalUrl).hostname,
      siteName: site.siteName || '',
      description: site.description || '',
      language: site.language || '',
      favicon: site.favicon || '',
      categories: site.categories || [],
    },
    scrapedAt: new Date().toISOString(),
    pagesScanned,
    stats: { sections: sections.length, items: sections.reduce((n, s) => n + s.items.length, 0) },
    notes,
    sections,
  };
}
