// CSV for spreadsheets. Cells starting with = + - @ are prefixed so Excel never runs them as formulas.
const cell = (value) => {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const toCsv = (header, rows) => [header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';

export function sendCsv(res, filename, header, rows) {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + toCsv(header, rows)); // BOM so Excel reads accents correctly
}
