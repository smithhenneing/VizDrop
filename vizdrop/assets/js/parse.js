// File parsing: xlsx/xls (SheetJS), csv/tsv (PapaParse), json.
// Output: { fileName, sheets: [{ name, grid }] } where grid is row-major cells.
// Globals XLSX and Papa are loaded from CDN in app.html.

export async function parseFile(file) {
  const name = file.name || 'data';
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (['xlsx', 'xls', 'xlsm', 'xlsb', 'ods'].includes(ext)) {
    return parseWorkbook(await file.arrayBuffer(), name);
  }
  const text = await file.text();
  const trimmed = text.trim();
  if (ext === 'json' || (ext !== 'csv' && ext !== 'tsv' && (trimmed.startsWith('{') || trimmed.startsWith('[')))) {
    return parseJson(trimmed, name);
  }
  return parseDelimited(text, name);
}

function parseWorkbook(buf, name) {
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheets = [];
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn];
    if (!ws || !ws['!ref']) continue;
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    if (grid.some((r) => r.some((c) => c !== null && c !== ''))) sheets.push({ name: sn, grid });
  }
  if (!sheets.length) throw new Error('This workbook looks empty — no cells with data were found.');
  return { fileName: name, sheets };
}

function parseDelimited(text, name) {
  const res = Papa.parse(text, { delimiter: '', skipEmptyLines: 'greedy' });
  if (!res.data || !res.data.length) throw new Error('No rows could be read from this file.');
  return { fileName: name, sheets: [{ name: 'Sheet 1', grid: res.data }] };
}

function parseJson(text, name) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('This JSON file could not be parsed — is it valid JSON?'); }
  const grid = jsonToGrid(data);
  if (!grid) throw new Error('Could not find a table inside this JSON. Expected an array of objects.');
  return { fileName: name, sheets: [{ name: 'data', grid }] };
}

function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date); }

function flattenRecord(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (isPlainObject(v)) {
      for (const [k2, v2] of Object.entries(v)) {
        out[`${k}.${k2}`] = isPlainObject(v2) || Array.isArray(v2) ? JSON.stringify(v2) : v2;
      }
    } else if (Array.isArray(v)) {
      out[k] = JSON.stringify(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function jsonToGrid(data) {
  if (Array.isArray(data)) {
    if (!data.length) return null;
    if (data.every((v) => !isPlainObject(v) && !Array.isArray(v))) {
      return [['Value'], ...data.map((v) => [v])];
    }
    const records = data.filter(isPlainObject).map(flattenRecord);
    if (!records.length) return null;
    const headers = [];
    for (const r of records) for (const k of Object.keys(r)) if (!headers.includes(k)) headers.push(k);
    return [headers, ...records.map((r) => headers.map((h) => (r[h] === undefined ? null : r[h])))];
  }
  if (isPlainObject(data)) {
    // common wrappers: { data: [...] }, { rows: [...] }, { items: [...] } — or the longest array prop
    let best = null;
    for (const v of Object.values(data)) {
      if (Array.isArray(v) && v.length && (!best || v.length > best.length)) best = v;
    }
    if (best) return jsonToGrid(best);
    // object of arrays → columns
    const entries = Object.entries(data);
    if (entries.length && entries.every(([, v]) => Array.isArray(v))) {
      const len = Math.max(...entries.map(([, v]) => v.length));
      const headers = entries.map(([k]) => k);
      const rows = [];
      for (let i = 0; i < len; i++) rows.push(entries.map(([, v]) => (v[i] === undefined ? null : v[i])));
      return [headers, ...rows];
    }
    return [Object.keys(data), Object.values(flattenRecord(data))];
  }
  return null;
}

// ---- grid → table (header detection, cleanup) ----

const isEmpty = (c) => c === null || c === undefined || (typeof c === 'string' && c.trim() === '');

export function gridToTable(grid) {
  let rows = grid.filter((r) => r.some((c) => !isEmpty(c)));
  if (!rows.length) throw new Error('This sheet looks empty.');

  // skip leading title/banner rows: a row with very few filled cells followed by a fuller row
  let skips = 0;
  while (skips < 3 && rows.length > 2) {
    const filled0 = rows[0].filter((c) => !isEmpty(c)).length;
    const filled1 = rows[1].filter((c) => !isEmpty(c)).length;
    if (filled0 <= 2 && filled1 >= Math.max(3, filled0 + 2)) { rows = rows.slice(1); skips++; } else break;
  }

  const width = Math.max(...rows.map((r) => r.length));
  const first = rows[0];
  const firstCells = [];
  for (let i = 0; i < width; i++) firstCells.push(first[i] === undefined ? null : first[i]);

  const looksLikeHeader = (() => {
    const filled = firstCells.filter((c) => !isEmpty(c));
    if (!filled.length) return false;
    const stringy = filled.filter((c) => typeof c === 'string' && !/^\s*-?[\d.,]+\s*$/.test(c) && !(c instanceof Date)).length;
    return stringy / filled.length >= 0.6;
  })();

  let headers, dataRows;
  if (looksLikeHeader) {
    headers = firstCells.map((c, i) => (isEmpty(c) ? `Column ${i + 1}` : String(c).trim()));
    dataRows = rows.slice(1);
  } else {
    headers = firstCells.map((_, i) => `Column ${i + 1}`);
    dataRows = rows;
  }

  // de-duplicate header names
  const seen = new Map();
  headers = headers.map((h) => {
    const n = (seen.get(h) || 0) + 1;
    seen.set(h, n);
    return n === 1 ? h : `${h} (${n})`;
  });

  // normalize row length
  dataRows = dataRows.map((r) => {
    const out = new Array(width);
    for (let i = 0; i < width; i++) out[i] = r[i] === undefined ? null : r[i];
    return out;
  });

  // drop columns that are entirely empty
  const keep = [];
  for (let i = 0; i < width; i++) {
    const hasData = dataRows.some((r) => !isEmpty(r[i]));
    if (hasData) keep.push(i);
  }
  if (!keep.length) throw new Error('This sheet looks empty.');
  headers = keep.map((i) => headers[i]);
  dataRows = dataRows.map((r) => keep.map((i) => r[i]));

  return { headers, rows: dataRows };
}
