// Export: per-chart PNG, full-dashboard PNG, PowerPoint (Pro).
// Exports always render on the light surface — presentation decks are light.

import { renderChart, THEMES, FONT } from './charts.js';
import { prepareChart } from './auto.js';

const NS = 'http://www.w3.org/2000/svg';
const WATERMARK = 'Made with VizDrop';

function E(tag, attrs = {}, parent = null) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}
function T(parent, str, attrs) { const t = E('text', attrs, parent); t.textContent = str; return t; }

// Build a standalone, share-ready SVG card for one chart (title + chart + chrome).
export function buildExportSvg(chart, profile, makeOpts, { width = 640, watermark = false } = {}) {
  const th = THEMES.light;
  const prep = prepareChart(chart, profile);
  if (!prep) return null;
  const holder = document.createElement('div');
  const opts = { ...makeOpts(chart, prep), theme: th, width: width - 40 };
  opts.color = th.series[chart.colorSlot % th.series.length];
  const inner = renderChart(holder, prep, opts);
  if (!inner) return null;
  const chartH = +inner.getAttribute('height');
  const headH = 58;
  const footH = watermark ? 26 : 12;
  const H = headH + chartH + footH;
  const svg = E('svg', {
    xmlns: NS, viewBox: `0 0 ${width} ${H}`, width, height: H, 'font-family': FONT,
  });
  E('rect', { x: 0.5, y: 0.5, width: width - 1, height: H - 1, rx: 14, fill: th.surface, stroke: th.border }, svg);
  T(svg, chart.title, { x: 20, y: 30, fill: th.ink, 'font-size': 15, 'font-weight': 600 });
  const sub = prep.note || `${prep.yName}${prep.xName ? ' · by ' + prep.xName : ''}`;
  T(svg, sub, { x: 20, y: 47, fill: th.muted, 'font-size': 11 });
  const g = E('g', { transform: `translate(20, ${headH})` }, svg);
  for (const child of [...inner.childNodes]) g.appendChild(child);
  if (watermark) {
    T(svg, WATERMARK, { x: width - 16, y: H - 10, 'text-anchor': 'end', fill: th.muted, 'font-size': 9.5 });
  }
  return svg;
}

export async function svgToCanvas(svg, scale = 2) {
  const w = +svg.getAttribute('width'), h = +svg.getAttribute('height');
  const xml = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('SVG render failed')); img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const c = canvas.getContext('2d');
    c.scale(scale, scale);
    c.drawImage(img, 0, 0, w, h);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadCanvas(canvas, filename) {
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, 'image/png');
}

const rr = (c, x, y, w, h, r) => {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
};

// Full dashboard PNG: header + KPI tiles + all charts in a 2-col grid.
export async function buildDashboardCanvas(state, makeOpts, { watermark = false, scale = 2 } = {}) {
  const th = THEMES.light;
  const W = 1240, pad = 32, gap = 20;
  const colW = (W - pad * 2 - gap) / 2;

  const cards = [];
  for (const chart of state.charts) {
    const svg = buildExportSvg(chart, state.profile, makeOpts, { width: colW, watermark: false });
    if (!svg) continue;
    cards.push({ svg, h: +svg.getAttribute('height') });
  }

  const kpis = state.kpiValues || [];
  const kpiH = kpis.length ? 92 : 0;
  const headerH = 96;
  let yCursor = headerH + kpiH + (kpiH ? gap : 0);
  const positions = [];
  for (let i = 0; i < cards.length; i += 2) {
    const rowH = Math.max(cards[i].h, cards[i + 1] ? cards[i + 1].h : 0);
    positions.push({ y: yCursor, i });
    yCursor += rowH + gap;
  }
  const H = yCursor + (watermark ? 20 : 4);

  const canvas = document.createElement('canvas');
  canvas.width = W * scale; canvas.height = H * scale;
  const c = canvas.getContext('2d');
  c.scale(scale, scale);
  c.fillStyle = th.page;
  c.fillRect(0, 0, W, H);

  c.fillStyle = th.ink;
  c.font = `600 24px ${FONT}`;
  c.fillText(state.title, pad, 46);
  c.fillStyle = th.muted;
  c.font = `12.5px ${FONT}`;
  c.fillText(state.subtitle || '', pad, 68);

  if (kpis.length) {
    const n = kpis.length;
    const tw = (W - pad * 2 - (n - 1) * 16) / n;
    kpis.forEach((k, i) => {
      const x = pad + i * (tw + 16);
      c.fillStyle = th.surface;
      rr(c, x, headerH, tw, 84, 12);
      c.fill();
      c.strokeStyle = th.border; c.lineWidth = 1;
      rr(c, x + 0.5, headerH + 0.5, tw - 1, 83, 12);
      c.stroke();
      c.fillStyle = th.muted;
      c.font = `11.5px ${FONT}`;
      c.fillText(k.label, x + 16, headerH + 28);
      c.fillStyle = th.ink;
      c.font = `600 25px ${FONT}`;
      c.fillText(k.display, x + 16, headerH + 62);
    });
  }

  for (const { y, i } of positions) {
    for (const j of [i, i + 1]) {
      if (!cards[j]) continue;
      const img = await svgToCanvas(cards[j].svg, scale);
      c.drawImage(img, (pad + (j - i) * (colW + gap)) * 1, y, colW, cards[j].h);
    }
  }

  if (watermark) {
    c.fillStyle = th.muted;
    c.font = `10.5px ${FONT}`;
    c.textAlign = 'right';
    c.fillText(WATERMARK, W - pad, H - 10);
    c.textAlign = 'left';
  }
  return canvas;
}

// ---- PowerPoint (Pro) ----

let pptxLoading = null;
function loadPptx() {
  if (window.PptxGenJS) return Promise.resolve();
  if (!pptxLoading) {
    pptxLoading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'assets/vendor/pptxgen.bundle.js';
      s.onload = res;
      s.onerror = () => { pptxLoading = null; rej(new Error('Could not load the PowerPoint library. Please reload and try again.')); };
      document.head.appendChild(s);
    });
  }
  return pptxLoading;
}

export async function exportPptx(state, makeOpts) {
  await loadPptx();
  const pptx = new window.PptxGenJS();
  pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
  pptx.layout = 'WIDE';
  const INK = '0B0B0B', MUTED = '898781', SURFACE = 'FCFCFB';

  const title = pptx.addSlide();
  title.background = { color: SURFACE };
  title.addText(state.title, { x: 0.8, y: 2.6, w: 11.7, h: 1.2, fontSize: 40, bold: true, color: INK, fontFace: 'Segoe UI' });
  title.addText(state.subtitle || '', { x: 0.8, y: 3.8, w: 11.7, h: 0.6, fontSize: 16, color: MUTED, fontFace: 'Segoe UI' });
  title.addText(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), {
    x: 0.8, y: 6.6, w: 6, h: 0.4, fontSize: 12, color: MUTED, fontFace: 'Segoe UI',
  });

  if ((state.kpiValues || []).length) {
    const s = pptx.addSlide();
    s.background = { color: SURFACE };
    s.addText('Key numbers', { x: 0.8, y: 0.5, w: 11.7, h: 0.7, fontSize: 24, bold: true, color: INK, fontFace: 'Segoe UI' });
    const n = state.kpiValues.length;
    const tw = (11.73 - (n - 1) * 0.3) / n;
    state.kpiValues.forEach((k, i) => {
      const x = 0.8 + i * (tw + 0.3);
      s.addShape('roundRect', { x, y: 2.4, w: tw, h: 1.9, rectRadius: 0.08, fill: { color: 'FFFFFF' }, line: { color: 'E1E0D9', width: 1 } });
      s.addText(k.label, { x: x + 0.15, y: 2.6, w: tw - 0.3, h: 0.4, fontSize: 12, color: MUTED, fontFace: 'Segoe UI' });
      s.addText(k.display, { x: x + 0.15, y: 3.1, w: tw - 0.3, h: 0.8, fontSize: 28, bold: true, color: INK, fontFace: 'Segoe UI' });
    });
  }

  for (const chart of state.charts) {
    const svg = buildExportSvg(chart, state.profile, makeOpts, { width: 900, watermark: false });
    if (!svg) continue;
    const canvas = await svgToCanvas(svg, 2);
    const data = canvas.toDataURL('image/png');
    const s = pptx.addSlide();
    s.background = { color: SURFACE };
    const w = +svg.getAttribute('width'), h = +svg.getAttribute('height');
    const maxW = 11.9, maxH = 6.5;
    let dw = maxW, dh = (h / w) * maxW;
    if (dh > maxH) { dh = maxH; dw = (w / h) * maxH; }
    s.addImage({ data, x: (13.33 - dw) / 2, y: 0.55 + (maxH - dh) / 2, w: dw, h: dh });
  }

  const safe = state.title.replace(/[^\w\- ]+/g, '').trim() || 'dashboard';
  await pptx.writeFile({ fileName: `${safe}.pptx` });
}
