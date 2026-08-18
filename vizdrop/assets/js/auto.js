// Dashboard composition: pick KPIs and charts from a profiled table,
// and prepare (aggregate) the data each chart needs.

import { pickGranularity, bucketKey, keyToDate, nextKey, naturalOrder, clamp } from './format.js';

let chartSeq = 0;
const newId = () => `c${++chartSeq}`;

export function buildDashboard(profile) {
  const cats = profile.columns
    .filter((c) => c.type === 'category' && c.distinct >= 2)
    .sort((a, b) => score(a) - score(b));
  const nums = profile.columns.filter((c) => c.type === 'number');
  const dates = profile.columns.filter((c) => c.type === 'date');

  const date = dates[0] || null;
  const num0 = nums[0] || null;
  const num1 = nums[1] || null;

  const kpis = [];
  kpis.push({ label: 'Records', kind: 'count' });
  for (const nc of nums.slice(0, 3)) {
    kpis.push({
      label: (nc.aggHint === 'avg' ? 'Avg ' : 'Total ') + nc.name,
      kind: nc.aggHint === 'avg' ? 'avg' : 'sum',
      col: nc.name,
    });
  }

  const charts = [];
  if (date && num0) {
    charts.push(spec('line', { x: date.name, y: num0.name, agg: num0.aggHint === 'avg' ? 'avg' : 'sum' },
      `${num0.name} over time`));
  }
  if (cats[0] && num0) {
    charts.push(spec('bar', { x: cats[0].name, y: num0.name, agg: num0.aggHint === 'avg' ? 'avg' : 'sum' },
      `${num0.name} by ${cats[0].name}`));
  }
  const donutCat = cats.find((c) => c.distinct >= 2 && c.distinct <= 8 && c !== cats[0]) ||
    (cats[0] && cats[0].distinct <= 8 ? cats[0] : null);
  if (donutCat) {
    charts.push(spec('donut', { x: donutCat.name, y: num0 ? num0.name : null, agg: num0 ? 'sum' : 'count' },
      num0 ? `${num0.name} share by ${donutCat.name}` : `Breakdown by ${donutCat.name}`));
  }
  const cat2 = cats.find((c) => c !== cats[0] && c !== donutCat);
  if (cat2 && num0) {
    charts.push(spec('column', { x: cat2.name, y: num0.name, agg: num0.aggHint === 'avg' ? 'avg' : 'sum' },
      `${num0.name} by ${cat2.name}`));
  }
  if (date && num1) {
    charts.push(spec('area', { x: date.name, y: num1.name, agg: num1.aggHint === 'avg' ? 'avg' : 'sum' },
      `${num1.name} over time`));
  }
  if (num0 && num1 && charts.length < 6) {
    charts.push(spec('scatter', { x: num0.name, y: num1.name }, `${num1.name} vs ${num0.name}`));
  }
  if (!charts.length && num0) {
    charts.push(spec('histogram', { x: num0.name }, `Distribution of ${num0.name}`));
  }
  if (!charts.length && cats[0]) {
    charts.push(spec('bar', { x: cats[0].name, y: null, agg: 'count' }, `Count by ${cats[0].name}`));
  }
  return { kpis, charts: charts.slice(0, 6) };
}

function spec(type, fields, title) {
  return { id: newId(), type, title, colorSlot: 0, ...fields };
}

function score(c) {
  // lower is better: prefer 3–12 distinct values, well-filled
  const d = c.distinct;
  const ideal = d >= 3 && d <= 12 ? 0 : d === 2 ? 2 : d <= 20 ? 1 : 3;
  return ideal * 1000 - c.filled;
}

export function addChartDefaults(profile) {
  const cats = profile.columns.filter((c) => c.type === 'category');
  const nums = profile.columns.filter((c) => c.type === 'number');
  const dates = profile.columns.filter((c) => c.type === 'date');
  if (dates[0] && nums[0]) return spec('line', { x: dates[0].name, y: nums[0].name, agg: 'sum' }, `${nums[0].name} over time`);
  if (cats[0] && nums[0]) return spec('column', { x: cats[0].name, y: nums[0].name, agg: 'sum' }, `${nums[0].name} by ${cats[0].name}`);
  if (cats[0]) return spec('bar', { x: cats[0].name, y: null, agg: 'count' }, `Count by ${cats[0].name}`);
  if (nums[0]) return spec('histogram', { x: nums[0].name }, `Distribution of ${nums[0].name}`);
  return null;
}

export function colByName(profile, name) {
  return profile.columns.find((c) => c.name === name) || null;
}

// ---- data preparation ----

export function prepareChart(chart, profile) {
  const xc = colByName(profile, chart.x);
  const yc = chart.y ? colByName(profile, chart.y) : null;
  const t = chart.type;
  if (t === 'line' || t === 'area') return prepTime(chart, xc, yc);
  if (t === 'donut') return prepDonut(chart, xc, yc);
  if (t === 'scatter') return prepScatter(chart, xc, yc, profile);
  if (t === 'histogram') return prepHistogram(chart, xc);
  return prepCategory(chart, xc, yc); // bar, column
}

function groupAgg(xc, yc, agg) {
  const groups = new Map();
  const n = xc.values.length;
  for (let i = 0; i < n; i++) {
    const label = xc.values[i];
    if (label === null) continue;
    const key = label instanceof Date ? label.toISOString().slice(0, 10) : String(label);
    let g = groups.get(key);
    if (!g) { g = { sum: 0, count: 0 }; groups.set(key, g); }
    if (yc) {
      const v = yc.values[i];
      if (v === null) continue;
      g.sum += v;
      g.count++;
    } else {
      g.count++;
    }
  }
  const items = [];
  for (const [label, g] of groups) {
    let value;
    if (agg === 'count' || !yc) value = g.count;
    else if (agg === 'avg') value = g.count ? g.sum / g.count : null;
    else value = g.sum;
    if (value !== null) items.push({ label, value });
  }
  return items;
}

function prepCategory(chart, xc, yc) {
  if (!xc) return null;
  const agg = yc ? chart.agg || 'sum' : 'count';
  let items = groupAgg(xc, yc, agg);
  if (!items.length) return null;
  const nat = naturalOrder(items.map((i) => i.label));
  const total = items.length;
  if (nat) items.sort((a, b) => nat(a.label, b.label));
  else items.sort((a, b) => b.value - a.value);
  const limit = chart.type === 'bar' ? 10 : 12;
  let clipped = 0;
  if (items.length > limit && !nat) { clipped = items.length - limit; items = items.slice(0, limit); }
  else if (items.length > 24 && nat) { clipped = items.length - 24; items = items.slice(0, 24); }
  return {
    kind: 'category', items, unit: yc ? yc.unit : null, agg,
    xName: xc.name, yName: yc ? yc.name : 'Count',
    note: clipped ? `Top ${items.length} of ${total}` : null,
  };
}

function prepDonut(chart, xc, yc) {
  if (!xc) return null;
  const agg = yc ? chart.agg || 'sum' : 'count';
  let items = groupAgg(xc, yc, agg === 'avg' ? 'sum' : agg);
  if (!items.length) return null;
  items.sort((a, b) => b.value - a.value);
  if (items.some((i) => i.value < 0)) return null; // shares need non-negative values
  if (items.length > 6) {
    const head = items.slice(0, 5);
    const other = items.slice(5).reduce((a, b) => a + b.value, 0);
    items = [...head, { label: 'Other', value: other, isOther: true }];
  }
  const total = items.reduce((a, b) => a + b.value, 0);
  if (!total) return null;
  return { kind: 'donut', items, total, unit: yc ? yc.unit : null, xName: xc.name, yName: yc ? yc.name : 'Count' };
}

function prepTime(chart, xc, yc) {
  if (!xc || xc.type !== 'date') return null;
  const dates = xc.values.filter(Boolean);
  if (!dates.length) return null;
  const g = pickGranularity(xc.min, xc.max);
  const agg = yc ? chart.agg || 'sum' : 'count';
  const groups = new Map();
  const n = xc.values.length;
  for (let i = 0; i < n; i++) {
    const d = xc.values[i];
    if (!d) continue;
    const key = bucketKey(d, g);
    let gr = groups.get(key);
    if (!gr) { gr = { sum: 0, count: 0 }; groups.set(key, gr); }
    if (yc) {
      const v = yc.values[i];
      if (v === null) continue;
      gr.sum += v; gr.count++;
    } else gr.count++;
  }
  const keys = [...groups.keys()].sort();
  if (keys.length < 2) return null;
  // fill gaps: for additive measures a missing bucket means zero activity
  const points = [];
  const fillZero = agg === 'sum' || agg === 'count';
  let k = keys[0];
  const last = keys[keys.length - 1];
  let guard = 0;
  while (k <= last && guard++ < 4000) {
    const gr = groups.get(k);
    if (gr) {
      const value = agg === 'count' || !yc ? gr.count : agg === 'avg' ? (gr.count ? gr.sum / gr.count : null) : gr.sum;
      if (value !== null) points.push({ key: k, t: keyToDate(k, g), value });
    } else if (fillZero) {
      points.push({ key: k, t: keyToDate(k, g), value: 0 });
    }
    k = nextKey(k, g);
  }
  if (points.length < 2) return null;
  return { kind: 'time', points, granularity: g, unit: yc ? yc.unit : null, agg, xName: xc.name, yName: yc ? yc.name : 'Count' };
}

function prepScatter(chart, xc, yc, profile) {
  if (!xc || !yc || xc.type !== 'number' || yc.type !== 'number') return null;
  const labelCol = profile.columns.find((c) => c.type === 'category' || c.type === 'text');
  const pts = [];
  const n = xc.values.length;
  for (let i = 0; i < n; i++) {
    const x = xc.values[i], y = yc.values[i];
    if (x === null || y === null) continue;
    pts.push({ x, y, label: labelCol ? labelCol.values[i] : `Row ${i + 1}` });
  }
  if (pts.length < 3) return null;
  let sampled = pts;
  if (pts.length > 400) {
    const step = pts.length / 400;
    sampled = [];
    for (let i = 0; i < 400; i++) sampled.push(pts[Math.floor(i * step)]);
  }
  return {
    kind: 'scatter', points: sampled, totalPoints: pts.length,
    xName: xc.name, yName: yc.name, xUnit: xc.unit, unit: yc.unit,
    note: sampled.length < pts.length ? `Showing ${sampled.length} of ${pts.length} points` : null,
  };
}

function prepHistogram(chart, xc) {
  if (!xc || xc.type !== 'number') return null;
  const vals = xc.values.filter((v) => v !== null);
  if (vals.length < 5) return null;
  const min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) return null;
  const binCount = clamp(Math.ceil(Math.sqrt(vals.length)), 6, 14);
  const rawStep = (max - min) / binCount;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const bins = [];
  for (let b = lo; b <= max; b += step) bins.push({ lo: b, hi: b + step, count: 0 });
  for (const v of vals) {
    let idx = Math.floor((v - lo) / step);
    if (idx >= bins.length) idx = bins.length - 1;
    if (idx < 0) idx = 0;
    bins[idx].count++;
  }
  const items = bins.map((b) => ({ label: `${short(b.lo)}–${short(b.hi)}`, value: b.count }));
  return { kind: 'category', items, unit: null, agg: 'count', xName: xc.name, yName: 'Count', histogram: true };
}

const short = (v) => (Math.abs(v) >= 10000 ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v) : +v.toFixed(2) + '');
