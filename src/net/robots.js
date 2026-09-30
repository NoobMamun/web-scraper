import robotsParser from 'robots-parser';
import { config } from '../config.js';
import { fetchUrl } from './fetcher.js';

/**
 * Per-scrape robots.txt cache. Follows RFC 9309:
 * 4xx / missing => allow everything; 5xx => disallow everything.
 */
export class RobotsPolicy {
  constructor() {
    this.cache = new Map(); // origin -> { parser | null, disallowAll }
  }

  async load(origin) {
    if (this.cache.has(origin)) return this.cache.get(origin);
    const robotsUrl = `${origin}/robots.txt`;
    let entry;
    try {
      const res = await fetchUrl(robotsUrl, { accept: 'text/plain,*/*;q=0.5', allowErrorStatus: true });
      if (res.status >= 500) entry = { parser: null, disallowAll: true };
      else if (res.status >= 400) entry = { parser: null, disallowAll: false };
      else entry = { parser: robotsParser(robotsUrl, res.text), disallowAll: false };
    } catch (err) {
      // Host-level problems are real errors; anything else means "no usable robots.txt".
      if (err.code === 'BLOCKED_HOST' || err.code === 'DNS_FAILED') throw err;
      entry = { parser: null, disallowAll: false };
    }
    this.cache.set(origin, entry);
    return entry;
  }

  async isAllowed(url) {
    const entry = await this.load(new URL(url).origin);
    if (entry.disallowAll) return false;
    if (!entry.parser) return true;
    return entry.parser.isAllowed(url, config.botToken) !== false;
  }

  async delayMs(url) {
    const entry = await this.load(new URL(url).origin);
    const secs = entry.parser?.getCrawlDelay(config.botToken);
    const ms = secs ? secs * 1000 : 0;
    return Math.min(Math.max(ms, config.minDelayMs), config.maxCrawlDelayMs);
  }
}
