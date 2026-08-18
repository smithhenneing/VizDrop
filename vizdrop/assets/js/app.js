// VizDrop app shell: state, screens, chart cards, exports, licensing.

import { parseFile, gridToTable } from './parse.js';
import { profileTable } from './profile.js';
import { buildDashboard, prepareChart, addChartDefaults, colByName } from './auto.js';
import { renderChart, THEMES, tooltip } from './charts.js';
import { fmtValue, fmtTick, fmtBucket, truncate } from './format.js';
import { buildExportSvg, svgToCanvas, downloadCanvas, buildDashboardCanvas, exportPptx } from './export.js';
import { DONATE_URL, donateConfigured } from './config.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  fileName: '', parsed: null, sheetIdx: 0,
  table: null, profile: null,
  title: 'My dashboard', subtitle: '',
  kpis: [], kpiValues: [], charts: [],
  theme: localStorage.getItem('vizdrop.theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
};

const cards = new Map(); // chart.id → { chart, el, body, prep, tableMode }

// ---- theme ----

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  localStorage.setItem('vizdrop.theme', state.theme);
  $('#theme-btn').textContent = state.theme === 'dark' ? '☀' : '☾';
  for (const card of cards.values()) drawCard(card);
}

// ---- options factory shared with export ----

function makeOpts(chart, prep) {
  const th = THEMES[state.theme];
  const unit = prep.unit || null;
  const opts = {
    type: chart.type,
    theme: th,
    color: th.series[chart.colorSlot % th.series.length],
    fmtVal: (v, compact) => fmtValue(v, unit, { compact: !!compact }),
    fmtTick: (v) => fmtTick(v, unit),
    aria: chart.title,
  };
  if (prep.kind === 'scatter') {
    opts.fmtValX = (v) => fmtValue(v, prep.xUnit, {});
    opts.fmtTickX = (v) => fmtTick(v, prep.xUnit);
  }
  return opts;
}

// ---- loading files ----

async function handleFile(file) {
  try {
    showBusy(true);
    const parsed = await parseFile(file);
    state.parsed = parsed;
    state.fileName = parsed.fileName;
    state.sheetIdx = 0;
    state.title = parsed.fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'My dashboard';
    buildFromSheet();
  } catch (err) {
    toast(err.message || 'Sorry — that file could not be read.', true);
  } finally {
    showBusy(false);
  }
}

function buildFromSheet() {
  const sheet = state.parsed.sheets[state.sheetIdx];
  const table = gridToTable(sheet.grid);
  state.table = table;
  state.profile = profileTable(table);
  const dash = buildDashboard(state.profile);
  state.kpis = dash.kpis;
  state.charts = dash.charts;
  state.subtitle = `${state.profile.rowCount.toLocaleString('en-US')} rows · ${state.profile.columns.length} columns · ${state.fileName}`;
  renderDashboard();
}

// ---- dashboard rendering ----

function renderDashboard() {
  $('#drop-screen').hidden = true;
  $('#dash-screen').hidden = false;
  $('#export-wrap').hidden = false;
  $('#new-btn').hidden = false;

  $('#dash-title').textContent = state.title;
  $('#dash-subtitle').textContent = state.subtitle;

  const sheetSel = $('#sheet-select');
  if (state.parsed.sheets.length > 1) {
    sheetSel.hidden = false;
    sheetSel.textContent = '';
    state.parsed.sheets.forEach((s, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `Sheet: ${s.name}`;
      if (i === state.sheetIdx) opt.selected = true;
      sheetSel.appendChild(opt);
    });
  } else {
    sheetSel.hidden = true;
  }

  renderKpis();

  const grid = $('#charts');
  grid.textContent = '';
  cards.clear();
  for (const chart of state.charts) grid.appendChild(makeCard(chart));

  const add = document.createElement('button');
  add.className = 'add-card';
  add.type = 'button';
  add.textContent = '+ Add chart';
  add.addEventListener('click', () => {
    const spec = addChartDefaults(state.profile);
    if (!spec) return toast('No chartable columns were found in this file.', true);
    state.charts.push(spec);
    const el = makeCard(spec);
    grid.insertBefore(el, add);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    openConfig(cards.get(spec.id));
  });
  grid.appendChild(add);

  renderPreviewTable();
}

function renderKpis() {
  const wrap = $('#kpis');
  wrap.textContent = '';
  state.kpiValues = [];
  for (const k of state.kpis) {
    let value, unit = null;
    if (k.kind === 'count') value = state.profile.rowCount;
    else {
      const col = colByName(state.profile, k.col);
      if (!col || col.type !== 'number') continue;
      value = k.kind === 'avg' ? col.mean : col.sum;
      unit = col.unit;
    }
    const display = fmtValue(value, unit, { compact: true });
    state.kpiValues.push({ label: k.label, display });
    const tile = document.createElement('div');
    tile.className = 'kpi';
    const lab = document.createElement('div');
    lab.className = 'kpi-label';
    lab.textContent = k.label;
    const val = document.createElement('div');
    val.className = 'kpi-value';
    val.textContent = display;
    tile.append(lab, val);
    wrap.appendChild(tile);
  }
}

const ICONS = {
  table: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 3h12v10H2z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2 6.5h12M6.5 6.5V13" stroke="currentColor" stroke-width="1.4"/></svg>',
  download: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 2v8m0 0L5 7m3 3 3-3M3 13h10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  gear: '<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6 11 5M5 11l-1.4 1.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  x: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
};

function iconBtn(icon, label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon-btn';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = ICONS[icon];
  return b;
}

function makeCard(chart) {
  const el = document.createElement('section');
  el.className = 'card chart-card';

  const head = document.createElement('div');
  head.className = 'card-head';
  const title = document.createElement('h3');
  title.className = 'chart-title';
  makeEditable(title);
  title.spellcheck = false;
  title.textContent = chart.title;
  title.addEventListener('input', () => { chart.title = title.textContent.trim() || 'Untitled chart'; });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });

  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const tableBtn = iconBtn('table', 'Toggle table view');
  const dlBtn = iconBtn('download', 'Download this chart as PNG');
  const gearBtn = iconBtn('gear', 'Edit this chart');
  const delBtn = iconBtn('x', 'Remove this chart');
  actions.append(tableBtn, dlBtn, gearBtn, delBtn);
  head.append(title, actions);

  const note = document.createElement('div');
  note.className = 'chart-note';

  const body = document.createElement('div');
  body.className = 'chart-body';

  const config = document.createElement('div');
  config.className = 'chart-config';
  config.hidden = true;

  el.append(head, note, config, body);

  const card = { chart, el, body, note, config, tableMode: false, configOpen: false };
  cards.set(chart.id, card);
  drawCard(card);

  tableBtn.addEventListener('click', () => { card.tableMode = !card.tableMode; drawCard(card); });
  gearBtn.addEventListener('click', () => { card.configOpen ? closeConfig(card) : openConfig(card); });
  delBtn.addEventListener('click', () => {
    state.charts = state.charts.filter((c) => c !== chart);
    cards.delete(chart.id);
    el.remove();
  });
  dlBtn.addEventListener('click', async () => {
    try {
      const svg = buildExportSvg(chart, state.profile, makeOpts, { width: 640 });
      if (!svg) return toast('This chart has no data to export yet.', true);
      const canvas = await svgToCanvas(svg, 3);
      downloadCanvas(canvas, slug(chart.title) + '.png');
      supportNudge();
    } catch (e) { toast('Export failed: ' + e.message, true); }
  });
  return el;
}

function drawCard(card) {
  const prep = prepareChart(card.chart, state.profile);
  card.prep = prep;
  card.note.textContent = prep && prep.note ? prep.note : '';
  card.note.hidden = !(prep && prep.note);
  if (card.tableMode && prep) {
    card.body.textContent = '';
    card.body.appendChild(prepTable(prep));
  } else {
    renderChart(card.body, prep, makeOpts(card.chart, prep || { unit: null }));
  }
}

function prepTable(prep) {
  const t = document.createElement('table');
  t.className = 'mini-table';
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  const cols = prep.kind === 'scatter' ? ['#', prep.xName, prep.yName] : [prep.xName, prep.yName];
  for (const c of cols) {
    const th = document.createElement('th');
    th.textContent = c;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  const tbody = document.createElement('tbody');
  const addRow = (cells) => {
    const tr = document.createElement('tr');
    cells.forEach((c, i) => {
      const td = document.createElement('td');
      td.textContent = c;
      if (i > 0 || prep.kind !== 'scatter') td.className = i === cells.length - 1 ? 'num' : '';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  };
  if (prep.kind === 'scatter') {
    prep.points.slice(0, 100).forEach((p) => addRow([String(p.label || ''), fmtValue(p.x, prep.xUnit), fmtValue(p.y, prep.unit)]));
  } else if (prep.kind === 'time') {
    prep.points.forEach((p) => addRow([fmtBucket(p.key, prep.granularity), fmtValue(p.value, prep.unit)]));
  } else {
    prep.items.forEach((it) => addRow([String(it.label), fmtValue(it.value, prep.unit)]));
  }
  t.append(thead, tbody);
  const wrap = document.createElement('div');
  wrap.className = 'table-scroll';
  wrap.appendChild(t);
  return wrap;
}

// ---- chart config panel ----

function selectEl(labelText, options, value, onChange) {
  const wrap = document.createElement('label');
  wrap.className = 'cfg-field';
  const span = document.createElement('span');
  span.textContent = labelText;
  const sel = document.createElement('select');
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.value === value) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  wrap.append(span, sel);
  return wrap;
}

const TYPE_OPTIONS = [
  { value: 'column', label: 'Columns' }, { value: 'bar', label: 'Bars (ranked)' },
  { value: 'line', label: 'Line' }, { value: 'area', label: 'Area' },
  { value: 'donut', label: 'Donut' }, { value: 'scatter', label: 'Scatter' },
  { value: 'histogram', label: 'Histogram' },
];

function xOptionsFor(type) {
  const cols = state.profile.columns;
  if (type === 'line' || type === 'area') return cols.filter((c) => c.type === 'date');
  if (type === 'scatter' || type === 'histogram') return cols.filter((c) => c.type === 'number');
  return cols.filter((c) => c.type === 'category' || c.type === 'text');
}

function openConfig(card) {
  card.configOpen = true;
  buildConfig(card);
  card.config.hidden = false;
}
function closeConfig(card) {
  card.configOpen = false;
  card.config.hidden = true;
}

function buildConfig(card) {
  const { chart, config } = card;
  config.textContent = '';
  const refresh = () => { buildConfig(card); drawCard(card); };

  config.appendChild(selectEl('Chart', TYPE_OPTIONS, chart.type, (v) => {
    chart.type = v;
    const xs = xOptionsFor(v);
    if (!xs.find((c) => c.name === chart.x)) chart.x = xs[0] ? xs[0].name : null;
    if (v === 'scatter') {
      const nums = state.profile.columns.filter((c) => c.type === 'number' && c.name !== chart.x);
      chart.y = nums[0] ? nums[0].name : chart.y;
    }
    if (v === 'histogram') chart.y = null;
    refresh();
  }));

  const xs = xOptionsFor(chart.type);
  if (xs.length) {
    const xLabel = chart.type === 'scatter' ? 'X value' : chart.type === 'histogram' ? 'Values' : chart.type === 'line' || chart.type === 'area' ? 'Date' : 'Group by';
    config.appendChild(selectEl(xLabel, xs.map((c) => ({ value: c.name, label: c.name })), chart.x, (v) => { chart.x = v; refresh(); }));
  }

  if (chart.type !== 'histogram') {
    const nums = state.profile.columns.filter((c) => c.type === 'number');
    const yOpts = nums.map((c) => ({ value: c.name, label: c.name }));
    if (chart.type !== 'scatter') yOpts.push({ value: '', label: 'Count of rows' });
    config.appendChild(selectEl(chart.type === 'scatter' ? 'Y value' : 'Measure', yOpts, chart.y || '', (v) => {
      chart.y = v || null;
      const col = v ? colByName(state.profile, v) : null;
      if (col && col.aggHint) chart.agg = col.aggHint === 'avg' ? 'avg' : 'sum';
      refresh();
    }));
    if (chart.y && chart.type !== 'scatter') {
      config.appendChild(selectEl('Show', [
        { value: 'sum', label: 'Total (sum)' }, { value: 'avg', label: 'Average' },
      ], chart.agg || 'sum', (v) => { chart.agg = v; refresh(); }));
    }
  }

  // color slots (validated palette — swatch picker)
  const colorWrap = document.createElement('div');
  colorWrap.className = 'cfg-field cfg-colors';
  const span = document.createElement('span');
  span.textContent = 'Color';
  colorWrap.appendChild(span);
  const row = document.createElement('div');
  row.className = 'swatches';
  THEMES[state.theme].series.forEach((hex, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (chart.colorSlot === i ? ' on' : '');
    b.style.background = hex;
    b.setAttribute('aria-label', `Color ${i + 1}`);
    b.addEventListener('click', () => { chart.colorSlot = i; refresh(); });
    row.appendChild(b);
  });
  colorWrap.appendChild(row);
  config.appendChild(colorWrap);

  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'btn btn-small';
  done.textContent = 'Done';
  done.addEventListener('click', () => closeConfig(card));
  config.appendChild(done);
}

// ---- data preview ----

function renderPreviewTable() {
  const wrap = $('#preview-body');
  wrap.textContent = '';
  const { headers, rows } = state.table;
  const shown = rows.slice(0, 100);
  $('#preview-title').textContent = `Data preview — first ${shown.length.toLocaleString('en-US')} of ${state.profile.rowCount.toLocaleString('en-US')} rows`;
  const t = document.createElement('table');
  t.className = 'mini-table';
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const h of headers) {
    const th = document.createElement('th');
    th.textContent = h;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  const tbody = document.createElement('tbody');
  shown.forEach((r, ri) => {
    const tr = document.createElement('tr');
    r.forEach((c, i) => {
      const td = document.createElement('td');
      const col = state.profile.columns[i];
      const v = col ? col.values[ri] : c;
      td.textContent = cellText(c, v, col);
      if (col && col.type === 'number') td.className = 'num';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  t.append(thead, tbody);
  wrap.appendChild(t);
}

function cellText(raw, coerced, col) {
  if (raw === null || raw === undefined) return '';
  if (col && col.type === 'date' && coerced instanceof Date) {
    return coerced.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  if (raw instanceof Date) return raw.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return String(raw);
}

// ---- exports ----

async function doDashboardPng() {
  try {
    showBusy(true, 'Building your image…');
    const canvas = await buildDashboardCanvas(state, makeOpts, { scale: 2 });
    downloadCanvas(canvas, slug(state.title) + '.png');
    supportNudge();
  } catch (e) { toast('Export failed: ' + e.message, true); }
  finally { showBusy(false); }
}

async function doAllChartsPng() {
  for (const chart of state.charts) {
    const svg = buildExportSvg(chart, state.profile, makeOpts, { width: 640 });
    if (!svg) continue;
    const canvas = await svgToCanvas(svg, 3);
    downloadCanvas(canvas, slug(chart.title) + '.png');
    await new Promise((r) => setTimeout(r, 450));
  }
  supportNudge();
}

async function doPptx() {
  try {
    showBusy(true, 'Building your slides…');
    await exportPptx(state, makeOpts);
    supportNudge();
  } catch (e) { toast('Export failed: ' + e.message, true); }
  finally { showBusy(false); }
}

// ---- support / donations ----

function supportNudge() {
  if (!donateConfigured()) return;
  toast('Export ready! If VizDrop saved you time, you can help keep it free ♥', false, DONATE_URL);
}

function setupDonateUi() {
  if (!donateConfigured()) return;
  const btn = $('#donate-btn');
  btn.href = DONATE_URL;
  btn.hidden = false;
  const foot = $('#foot-donate');
  if (foot) { foot.href = DONATE_URL; foot.parentElement.hidden = false; }
}

// ---- misc ui ----

function toast(msg, isError = false, href = null) {
  const t = $('#toast');
  t.textContent = '';
  if (href) {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = msg;
    t.appendChild(a);
  } else {
    t.textContent = msg;
  }
  t.className = 'toast show' + (isError ? ' err' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = 'toast'; }, href ? 7000 : 4200);
}

function showBusy(on, msg) {
  const b = $('#busy');
  b.hidden = !on;
  if (msg) $('#busy-text').textContent = msg;
  else $('#busy-text').textContent = 'Reading your file…';
}

const slug = (s) => (String(s).toLowerCase().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '') || 'chart');

function makeEditable(el) {
  try { el.contentEditable = 'plaintext-only'; }
  catch { el.contentEditable = 'true'; }
}

function resetToDrop() {
  state.parsed = null;
  state.table = null;
  state.charts = [];
  cards.clear();
  $('#dash-screen').hidden = true;
  $('#export-wrap').hidden = true;
  $('#new-btn').hidden = true;
  $('#drop-screen').hidden = false;
}

// ---- wiring ----

function init() {
  applyTheme();
  setupDonateUi();

  $('#theme-btn').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
  });

  const dz = $('#dropzone');
  const fileInput = $('#file-input');
  dz.addEventListener('click', () => fileInput.click());
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('over');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleFile(fileInput.files[0]);
    fileInput.value = '';
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  $('#sample-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      showBusy(true);
      const resp = await fetch('assets/samples/sample-sales.csv');
      const text = await resp.text();
      await handleFile(new File([text], 'sample-sales.csv', { type: 'text/csv' }));
    } catch { toast('Could not load the sample.', true); }
    finally { showBusy(false); }
  });

  $('#new-btn').addEventListener('click', () => {
    if (!state.charts.length || confirm('Start over with a new file? Your current dashboard will be discarded.')) resetToDrop();
  });

  $('#sheet-select').addEventListener('change', (e) => {
    state.sheetIdx = +e.target.value;
    buildFromSheet();
  });

  makeEditable($('#dash-title'));
  $('#dash-title').addEventListener('input', () => {
    state.title = $('#dash-title').textContent.trim() || 'My dashboard';
  });
  $('#dash-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });

  // export menu
  const menu = $('#export-menu');
  $('#export-btn').addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener('click', () => { menu.hidden = true; });
  menu.addEventListener('click', (e) => e.stopPropagation());
  $('#exp-dash').addEventListener('click', () => { menu.hidden = true; doDashboardPng(); });
  $('#exp-charts').addEventListener('click', () => { menu.hidden = true; doAllChartsPng(); });
  $('#exp-pptx').addEventListener('click', () => { menu.hidden = true; doPptx(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $('#export-menu').hidden = true;
  });

  if (new URLSearchParams(location.search).has('demo')) $('#sample-btn').click();

  // responsive re-render
  let rt;
  new ResizeObserver(() => {
    clearTimeout(rt);
    rt = setTimeout(() => { for (const card of cards.values()) if (!card.tableMode) drawCard(card); }, 140);
  }).observe($('#charts'));
}

init();

// exposed for automated testing; harmless in production
window.VizDropDebug = { state, makeOpts, handleFile };
