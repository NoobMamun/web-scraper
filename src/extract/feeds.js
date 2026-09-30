import * as cheerio from 'cheerio';
import { absUrl, cleanText, normalizeDate, truncate } from './utils.js';

/** RSS/Atom links advertised in the page head. */
export function discoverFeeds($, pageUrl) {
  const urls = [];
  $('link[rel="alternate"]').each((_, el) => {
    const type = ($(el).attr('type') || '').toLowerCase();
    if (!/rss|atom|feed\+json|xml/.test(type) || /json/.test(type)) return;
    const u = absUrl($(el).attr('href'), pageUrl);
    if (u && !urls.includes(u)) urls.push(u);
  });
  return urls;
}

/** Common feed locations to probe when a page yields little content. */
export function guessFeedUrls(pageUrl) {
  const { origin } = new URL(pageUrl);
  return [`${origin}/feed`, `${origin}/rss.xml`, `${origin}/feed.xml`, `${origin}/atom.xml`];
}

const stripHtml = (html) => cleanText(cheerio.load(`<div>${html || ''}</div>`).text());

function imageFromHtml(html, base) {
  if (!html || !/<img/i.test(html)) return '';
  const src = cheerio.load(html)('img').first().attr('src');
  return absUrl(src, base) || '';
}

/** Parse an RSS 2.0 / Atom / RDF document. Returns null if it isn't a feed. */
export function parseFeed(xml, feedUrl) {
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml.slice(0, 3000))) return null;
  const $ = cheerio.load(xml, { xml: true });
  const title = cleanText($('channel > title, feed > title').first().text());
  const items = [];
  $('item, entry').each((_, el) => {
    const $el = $(el);
    const pick = (sel) => cleanText($el.children(sel).first().text());
    const link =
      $el.children('link[rel="alternate"]').attr('href') ||
      $el.children('link[href]').first().attr('href') ||
      pick('link') || pick('guid');
    const rawDesc = $el.children('description').first().text() || $el.children('summary').first().text() ||
      $el.children('content\\:encoded, content').first().text();
    const image =
      $el.find('media\\:content[url], media\\:thumbnail[url]').first().attr('url') ||
      $el.children('enclosure[type^="image"]').attr('url') ||
      imageFromHtml(rawDesc, feedUrl);
    items.push({
      title: pick('title'),
      description: (() => { const d = stripHtml(rawDesc); return d.length >= 25 ? truncate(d, 600) : ''; })(),
      date: normalizeDate(pick('pubDate') || pick('published') || pick('updated') || pick('dc\\:date')),
      author: pick('dc\\:creator') || cleanText($el.find('author > name').first().text()) || pick('author'),
      url: absUrl(link, feedUrl) || '',
      image: absUrl(image, feedUrl) || '',
    });
  });
  return { title, url: feedUrl, items: items.filter((it) => it.title || it.url) };
}
