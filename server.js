import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './src/config.js';
import { exportFilename, exporters, validateExportData } from './src/export/index.js';
import { scrapeSite } from './src/scraper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let activeScrapes = 0;
const MAX_CONCURRENT = 4;

/**
 * POST /api/scrape { url, maxPages }
 * Streams newline-delimited JSON: {type:"progress"} ... then {type:"result"} or {type:"error"}.
 */
app.post('/api/scrape', async (req, res) => {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');
  const send = (obj) => res.write(`${JSON.stringify(obj)}\n`);

  if (activeScrapes >= MAX_CONCURRENT) {
    send({ type: 'error', code: 'BUSY', message: 'The server is busy with other scrapes. Please try again in a moment.' });
    return res.end();
  }
  activeScrapes++;
  try {
    const data = await scrapeSite(req.body?.url, { maxPages: req.body?.maxPages }, (p) => send({ type: 'progress', ...p }));
    send({ type: 'result', data });
  } catch (err) {
    if (!err.code) console.error('[scrape] unexpected error:', err);
    send({ type: 'error', code: err.code || 'INTERNAL', message: err.code ? err.message : 'Something went wrong while scraping this website.' });
  } finally {
    activeScrapes--;
    res.end();
  }
});

/** POST /api/export { format, data } → file download */
app.post('/api/export', async (req, res) => {
  const { format, data } = req.body || {};
  const exporter = exporters[format];
  if (!exporter) return res.status(400).json({ message: `Unsupported format "${format}".` });
  if (!validateExportData(data)) return res.status(400).json({ message: 'Invalid export data.' });
  try {
    const buf = await exporter.render(data);
    const filename = exportFilename(data, exporter.ext);
    res.setHeader('Content-Type', exporter.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buf);
  } catch (err) {
    console.error('[export] failed:', err);
    res.status(500).json({ message: 'Export failed.' });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.listen(config.port, () => {
  console.log(`Site Scraper running at http://localhost:${config.port}`);
});
