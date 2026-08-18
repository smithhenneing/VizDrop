// Shared formatting and scale helpers. No DOM access here.

export function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

const compactFmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const fullFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

// unit: prefix string like '$' / 'Rp ' / '€', or '%' (suffix)
export function fmtValue(v, unit, { compact = false } = {}) {
  if (v == null || Number.isNaN(v)) return '—';
  const abs = Math.abs(v);
  let core;
  if (compact && abs >= 10000) core = compactFmt.format(v);
  else if (Number.isInteger(v) || abs >= 1000) core = intFmt.format(Math.round(v) === v ? v : +v.toFixed(2));
  else core = fullFmt.format(v);
  if (!Number.isInteger(v) && abs < 1000 && !compact) core = fullFmt.format(v);
  if (!unit) return core;
  if (unit === '%') return core + '%';
  return unit + core;
}

export function fmtTick(v, unit) {
  if (v == null) return '';
  const core = Math.abs(v) >= 10000 ? compactFmt.format(v) : intFmt.format(v);
  const fine = Math.abs(v) < 10 && v !== 0 && !Number.isInteger(v) ? fullFmt.format(v) : core;
  if (!unit) return fine;
  if (unit === '%') return fine + '%';
  return unit + fine;
}

export function truncate(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s;
}

// "Nice numbers" tick generator.
export function niceTicks(min, max, count = 5) {
  if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
  if (min === max) {
    if (min === 0) { max = 1; } else { min = min > 0 ? 0 : min * 1.2; max = max > 0 ? max * 1.2 : 0; }
  }
  const span = max - min;
  const step0 = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  let step;
  if (norm <= 1) step = 1;
  else if (norm <= 2) step = 2;
  else if (norm <= 2.5) step = 2.5;
  else if (norm <= 5) step = 5;
  else step = 10;
  step *= mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let t = lo; t <= hi + step / 1e6; t += step) {
    ticks.push(Math.abs(t) < step / 1e6 ? 0 : +t.toPrecision(12));
  }
  return { ticks, lo, hi, step };
}

// ---- time bucketing ----

export function pickGranularity(minDate, maxDate) {
  const days = (maxDate - minDate) / 86400000;
  if (days <= 95) return 'day';
  if (days <= 1130) return 'month';
  return 'year';
}

const p2 = (n) => String(n).padStart(2, '0');

export function bucketKey(d, g) {
  if (g === 'day') return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  if (g === 'month') return `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;
  return String(d.getFullYear());
}

export function keyToDate(key, g) {
  const parts = key.split('-').map(Number);
  if (g === 'day') return new Date(parts[0], parts[1] - 1, parts[2]);
  if (g === 'month') return new Date(parts[0], parts[1] - 1, 1);
  return new Date(parts[0], 0, 1);
}

export function nextKey(key, g) {
  const d = keyToDate(key, g);
  if (g === 'day') d.setDate(d.getDate() + 1);
  else if (g === 'month') d.setMonth(d.getMonth() + 1);
  else d.setFullYear(d.getFullYear() + 1);
  return bucketKey(d, g);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtBucket(key, g, { withYear = true } = {}) {
  const d = keyToDate(key, g);
  if (g === 'day') return `${d.getDate()} ${MONTHS[d.getMonth()]}` + (withYear ? ` ${String(d.getFullYear()).slice(2)}` : '');
  if (g === 'month') return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return String(d.getFullYear());
}

export const MONTH_ORDER = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// If labels are all months / weekdays / numbers, return a natural sort comparator; else null.
export function naturalOrder(labels) {
  const l3 = labels.map((s) => String(s).trim().toLowerCase().slice(0, 3));
  if (l3.every((s) => MONTH_ORDER.includes(s))) return (a, b) => MONTH_ORDER.indexOf(String(a).trim().toLowerCase().slice(0, 3)) - MONTH_ORDER.indexOf(String(b).trim().toLowerCase().slice(0, 3));
  if (l3.every((s) => DAY_ORDER.includes(s))) return (a, b) => DAY_ORDER.indexOf(String(a).trim().toLowerCase().slice(0, 3)) - DAY_ORDER.indexOf(String(b).trim().toLowerCase().slice(0, 3));
  if (labels.every((s) => /^-?\d+(\.\d+)?$/.test(String(s).trim()))) return (a, b) => parseFloat(a) - parseFloat(b);
  return null;
}
