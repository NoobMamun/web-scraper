import { COLUMNS, toRows } from './rows.js';

const escape = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(data) {
  const rows = toRows(data);
  const cols = COLUMNS.filter((c) => c.key !== 'content' || rows.some((r) => r.content));
  const lines = [cols.map((c) => escape(c.header)).join(',')];
  for (const r of rows) lines.push(cols.map((c) => escape(r[c.key])).join(','));
  // BOM so Excel detects UTF-8 (non-Latin scripts such as Bengali render correctly).
  return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
}
