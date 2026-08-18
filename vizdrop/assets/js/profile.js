// Column profiling: type detection (number / date / category / text) with
// tolerant parsing for real-world business data — currency symbols, Indonesian
// and European number formats, mixed date formats.

const CURRENCY_PREFIX = /^(rp\.?|idr|us\$|usd|s\$|au\$|\$|€|£|¥|₹)\s*/i;
const CURRENCY_SUFFIX = /\s*(usd|idr|eur|gbp)$/i;

const UNIT_MAP = {
  rp: 'Rp ', 'rp.': 'Rp ', idr: 'Rp ', usd: '$', 'us$': '$', 's$': 'S$', 'au$': 'A$',
  $: '$', '€': '€', eur: '€', '£': '£', gbp: '£', '¥': '¥', '₹': '₹',
};

// Parse one cell into a number, tolerating "Rp 1.234.567", "$1,234.56",
// "1.234,56", "12%", "(500)". Returns { value, unit } or null.
export function coerceNumber(v) {
  if (typeof v === 'number') return isFinite(v) ? { value: v, unit: null } : null;
  if (typeof v !== 'string') return null;
  let s = v.trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  let unit = null;
  const pre = s.match(CURRENCY_PREFIX);
  if (pre) { unit = UNIT_MAP[pre[1].toLowerCase()] || pre[1]; s = s.slice(pre[0].length); }
  const suf = s.match(CURRENCY_SUFFIX);
  if (suf) { unit = unit || UNIT_MAP[suf[1].toLowerCase()] || null; s = s.slice(0, s.length - suf[0].length); }
  if (/%$/.test(s)) { unit = '%'; s = s.slice(0, -1).trim(); }
  if (/^[+-]/.test(s)) { if (s[0] === '-') neg = !neg; s = s.slice(1).trim(); }
  s = s.replace(/\s/g, '');
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot !== -1 && lastComma !== -1) {
    // both present: the rightmost is the decimal separator
    if (lastDot > lastComma) s = s.replace(/,/g, '');
    else s = s.replace(/\./g, '').replace(',', '.');
  } else if (lastComma !== -1) {
    const parts = s.split(',');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3)) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
  } else if (lastDot !== -1) {
    const parts = s.split('.');
    // "1.234.567" or "1.234" (Indonesian thousands) vs "3.14"
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3)) s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  if (!isFinite(n)) return null;
  return { value: neg ? -n : n, unit };
}

const DMY = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/;
const YMD = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/;
const ISO = /^\d{4}-\d{2}-\d{2}([T ].*)?$/;

function makeDate(y, m, d) {
  if (y < 100) y += y >= 70 ? 1900 : 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  const dt = new Date(y, m - 1, d);
  return dt.getMonth() === m - 1 ? dt : null;
}

// dayFirst: column-level decision for ambiguous 01/02/2026 style values
export function coerceDate(v, { dayFirst = true } = {}) {
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === 'number') {
    // Excel serial dates that escaped cellDates (rough plausible window 1970–2100)
    if (v > 25569 && v < 73415 && Number.isInteger(v)) {
      return new Date(Math.round((v - 25569) * 86400000));
    }
    return null;
  }
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  let m = s.match(ISO);
  if (m) { const d = new Date(s.length === 10 ? s + 'T00:00:00' : s.replace(' ', 'T')); return isNaN(d) ? null : d; }
  m = s.match(YMD);
  if (m) return makeDate(+m[1], +m[2], +m[3]);
  m = s.match(DMY);
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3];
    if (a > 12 && b <= 12) return makeDate(y, b, a);
    if (b > 12 && a <= 12) return makeDate(y, a, b);
    return dayFirst ? makeDate(y, b, a) : makeDate(y, a, b);
  }
  if (/[a-zA-Z]{3}/.test(s) && /\d/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d) && d.getFullYear() >= 1900 && d.getFullYear() <= 2100) return d;
  }
  return null;
}

const ID_NAME = /(^|[^a-z])(id|code|sku|phone|zip|postal|nik|npwp)s?$/i;
const AVG_NAME = /price|rate|ratio|percent|pct|margin|score|rating|age|avg|average|mean|per[\s_-]/i;

export function profileTable(table) {
  const { headers, rows } = table;
  const n = rows.length;
  const columns = headers.map((name, idx) => profileColumn(name, idx, rows, n));
  return { rowCount: n, columns };
}

function profileColumn(name, idx, rows, n) {
  const raw = rows.map((r) => r[idx]);
  const nonNull = raw.filter((v) => v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === ''));
  const filled = nonNull.length;
  const base = { name, idx, filled };
  if (!filled) return { ...base, type: 'empty', values: raw.map(() => null) };

  const sample = filled > 600 ? nonNull.filter((_, i) => i % Math.ceil(filled / 600) === 0) : nonNull;

  // date detection (Date objects from SheetJS, or parseable strings)
  const dayFirst = decideDayFirst(sample);
  const dateHits = sample.filter((v) => coerceDate(v, { dayFirst }) !== null).length;
  const numHits = sample.filter((v) => coerceNumber(v) !== null).length;

  // prefer date when both plausible (e.g. Excel serials remain numbers)
  if (dateHits / sample.length >= 0.85 && dateHits >= numHits) {
    const values = raw.map((v) => coerceDate(v, { dayFirst }));
    const times = values.filter(Boolean).map((d) => d.getTime());
    return {
      ...base, type: 'date', values,
      min: new Date(Math.min(...times)), max: new Date(Math.max(...times)),
    };
  }

  if (numHits / sample.length >= 0.85) {
    const parsed = raw.map((v) => coerceNumber(v));
    const values = parsed.map((p) => (p ? p.value : null));
    const nums = values.filter((v) => v !== null);
    const distinct = new Set(nums).size;
    const allInt = nums.every(Number.isInteger);
    // integer columns named like identifiers are labels, not measures
    if (ID_NAME.test(name.trim()) && allInt) {
      return categoryProfile(base, raw.map((v) => (v === null || v === undefined ? null : String(v).trim() || null)));
    }
    const unitCounts = new Map();
    for (const p of parsed) if (p && p.unit) unitCounts.set(p.unit, (unitCounts.get(p.unit) || 0) + 1);
    const unit = [...unitCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const sum = nums.reduce((a, b) => a + b, 0);
    return {
      ...base, type: 'number', values, unit, distinct,
      min: Math.min(...nums), max: Math.max(...nums), sum, mean: sum / nums.length,
      aggHint: unit === '%' || AVG_NAME.test(name) ? 'avg' : 'sum',
    };
  }

  // boolean-ish → category
  const strVals = raw.map((v) => {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = String(v).trim();
    return s === '' ? null : s;
  });
  return categoryProfile(base, strVals);
}

function categoryProfile(base, strVals) {
  const nonNull = strVals.filter((v) => v !== null);
  const counts = new Map();
  for (const v of nonNull) counts.set(v, (counts.get(v) || 0) + 1);
  const distinct = counts.size;
  const type = distinct <= Math.max(12, Math.min(50, nonNull.length * 0.6)) ? 'category' : 'text';
  return { ...base, type, values: strVals, distinct, counts };
}

function decideDayFirst(sample) {
  let dayFirst = true; // Indonesian / most-of-world default
  for (const v of sample) {
    if (typeof v !== 'string') continue;
    const m = v.trim().match(DMY);
    if (!m) continue;
    if (+m[1] > 12) return true;
    if (+m[2] > 12) dayFirst = false;
  }
  return dayFirst;
}
