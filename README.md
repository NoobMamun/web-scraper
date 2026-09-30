# Site Scraper

Paste a URL → scrape → organize into sections → export (DOCX / XLSX / CSV / JSON).

## Run

```bash
npm install
npm start          # http://localhost:3000  (PORT env var to change)
```

Requires Node.js 20+.

## How it works

```
server.js                 Express: POST /api/scrape (streams NDJSON progress), POST /api/export
src/scraper.js            Pipeline orchestrator
src/net/fetcher.js        Safe fetch: timeouts, size cap, redirect + private-IP (SSRF) checks, anti-bot detection
src/net/robots.js         robots.txt (RFC 9309) + Crawl-delay
src/extract/
  metadata.js             Title, description, favicon, nav categories
  structured.js           JSON-LD (Article, NewsArticle, ItemList, ...)
  cards.js                Layout-independent item detection (see below)
  sections.js             Section naming/grouping
  content.js              Single-article pages and heading-based content blocks
  pagination.js           "Next page" discovery
  feeds.js                RSS/Atom (enrichment + fallback)
src/export/               One file per format; register new formats in export/index.js
public/                   Plain HTML/CSS/JS frontend, no build step
```

**Item detection.** Headline-like links (not in nav/footer/ads, not inline prose links)
are anchors. Each climbs to the largest ancestor containing no headline link to a
*different* URL: that ancestor is the item's "card". Title, description, date, author and
image are read from inside it. If the served HTML has headlines without links (JS-attached),
headline headings are used as anchors instead.

**Sections.** Each item takes the nearest preceding section heading whose scope covers it,
or an `aria-label`led region. Items with no heading are grouped by URL category
(`/sports/...` → "Sports"). Nothing is hardcoded.

**Enrichment & fallbacks.** Missing dates/authors/summaries are filled from JSON-LD and the
site's RSS feed (matched by URL or title). Thin pages fall back to feed items, JSON-LD lists,
then heading-delimited page content. Duplicates are removed by normalized URL and title.

## Politeness & limits

- robots.txt is checked for every page fetched; Crawl-delay honoured (capped at 10s), min 0.8s between requests.
- Identifies as `SiteScraperBot`; no challenge/CAPTCHA bypass. Blocked sites return a clear error.
- Private/local network addresses are refused (set `ALLOW_PRIVATE_HOSTS=1` for local testing).
- Content rendered purely client-side (JavaScript) is only partially visible. A headless-browser
  fetcher could be added behind `fetchUrl` without touching the extractors.

Tunables live in `src/config.js`.
