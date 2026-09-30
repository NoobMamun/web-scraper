import ExcelJS from 'exceljs';
import { COLUMNS, toRows } from './rows.js';

const CELL_LIMIT = 32000; // Excel's hard limit is 32,767 chars per cell

function sheetName(name, used) {
  let base = (name || 'Section').replace(/[[\]:*?/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 28) || 'Section';
  if (/^history$/i.test(base)) base = `${base} 1`;
  let candidate = base;
  for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${base.slice(0, 26)} ${i}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

function styleHeader(ws) {
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  header.alignment = { vertical: 'middle' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
}

function addItemsSheet(wb, name, rows, cols) {
  const ws = wb.addWorksheet(name);
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  for (const r of rows) {
    const row = ws.addRow(Object.fromEntries(cols.map((c) => [c.key, String(r[c.key] ?? '').slice(0, CELL_LIMIT)])));
    for (const key of ['url', 'image']) {
      const idx = cols.findIndex((c) => c.key === key);
      if (idx >= 0 && r[key]) {
        row.getCell(idx + 1).value = { text: r[key], hyperlink: r[key] };
        row.getCell(idx + 1).font = { color: { argb: 'FF2563EB' }, underline: true };
      }
    }
    row.alignment = { vertical: 'top', wrapText: true };
  }
  styleHeader(ws);
  return ws;
}

export async function toXlsx(data) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Site Scraper';
  wb.created = new Date();
  const rows = toRows(data);
  const hasContent = rows.some((r) => r.content);
  const cols = COLUMNS.filter((c) => c.key !== 'content' || hasContent);
  const used = new Set();

  // Summary sheet
  const summary = wb.addWorksheet(sheetName('Summary', used));
  summary.columns = [{ width: 28 }, { width: 80 }];
  summary.addRow(['Website', data.site.title]).font = { bold: true, size: 14 };
  summary.addRow(['URL', { text: data.site.finalUrl || data.site.url, hyperlink: data.site.finalUrl || data.site.url }]);
  summary.addRow(['Scraped at', data.scrapedAt]);
  summary.addRow(['Total items', rows.length]);
  summary.addRow([]);
  const h = summary.addRow(['Section', 'Items']);
  h.font = { bold: true };
  for (const s of data.sections) summary.addRow([s.name, s.items.length]);

  addItemsSheet(wb, sheetName('All Items', used), rows, cols);
  for (const s of data.sections) {
    const sectionRows = rows.filter((r) => r.section === s.name);
    addItemsSheet(wb, sheetName(s.name, used), sectionRows, cols.filter((c) => c.key !== 'section'));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
