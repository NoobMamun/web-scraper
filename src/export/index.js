import { toCsv } from './csv.js';
import { toDocx } from './docx.js';
import { toJson } from './json.js';
import { toXlsx } from './xlsx.js';

export { COLUMNS, toRows } from './rows.js';

/** Registry: add a format here and it becomes available to the API. */
export const exporters = {
  json: { ext: 'json', mime: 'application/json; charset=utf-8', render: toJson },
  csv: { ext: 'csv', mime: 'text/csv; charset=utf-8', render: toCsv },
  xlsx: { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', render: toXlsx },
  docx: { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', render: toDocx },
};

export function exportFilename(data, ext) {
  let host = 'website';
  try { host = new URL(data.site.finalUrl || data.site.url).hostname.replace(/^www\./, ''); } catch { /* keep default */ }
  const date = (data.scrapedAt || new Date().toISOString()).slice(0, 10);
  return `${host.replace(/[^\w.-]/g, '_')}-${date}.${ext}`;
}

/** Validate the (client-supplied) payload's shape before rendering it. */
export function validateExportData(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.sections) || !data.site) return false;
  return data.sections.every((s) => s && typeof s.name === 'string' && Array.isArray(s.items));
}
