// Central tunables. Everything the scraper decides "how much" about lives here.
export const config = {
  port: Number(process.env.PORT) || 3000,
  // Identify honestly; robots.txt rules are evaluated against BOT_TOKEN.
  botToken: 'SiteScraperBot',
  userAgent: 'Mozilla/5.0 (compatible; SiteScraperBot/1.0; +https://example.com/bot)',
  requestTimeoutMs: 15000,
  maxBytes: 6 * 1024 * 1024,
  maxRedirects: 5,
  maxPagesLimit: 5,        // upper bound for pagination the UI may request
  defaultMaxPages: 3,
  maxFeeds: 2,
  minDelayMs: 800,         // politeness delay between requests to the same site
  maxCrawlDelayMs: 10000,  // cap on robots.txt Crawl-delay we will honour by waiting
  allowPrivateHosts: process.env.ALLOW_PRIVATE_HOSTS === '1',
};
