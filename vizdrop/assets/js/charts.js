// SVG chart renderer. Design rules: thin marks (bars ≤24px, 4px rounded data-end,
// square baseline), 2px lines with ≥8px end markers ringed in surface color,
// hairline solid gridlines, text in ink tokens (never series color), hover layer
// with crosshair (lines) or per-mark tooltips (bars/slices/dots).

import { niceTicks, truncate, fmtBucket, clamp } from './format.js';

export const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

export const THEMES = {
  light: {
    surface: '#fcfcfb', page: '#f9f9f7', ink: '#0b0b0b', ink2: '#52514e',
    muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', other: '#aeaca4',
    border: 'rgba(11,11,11,0.10)',
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  },
  dark: {
    surface: '#1a1a19', page: '#0d0d0d', ink: '#ffffff', ink2: '#c3c2b7',
    muted: '#898781', grid: '#2c2c2a', axis: '#383835', other: '#4e4d49',
    border: 'rgba(255,255,255,0.10)',
    series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
  },
};

const NS = 'http://www.w3.org/2000/svg';

function E(tag, attrs = {}, parent = null) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

function T(parent, str, attrs) {
  const t = E('text', attrs, parent);
  t.textContent = str;
  return t;
}

// ---- tooltip singleton (content always via textContent — labels are untrusted) ----

export const tooltip = (() => {
  let node = null;
  function ensure() {
    if (!node) {
      node = document.createElement('div');
      node.className = 'viz-tooltip';
      node.setAttribute('role', 'status');
      document.body.appendChild(node);
    }
    return node;
  }
  return {
    show(x, y, lines) {
      const n = ensure();
      n.textContent = '';
      for (const ln of lines) {
        const d = document.createElement('div');
        d.className = 'vt-' + (ln.kind || 'label');
        d.textContent = ln.text;
        n.appendChild(d);
      }
      n.style.display = 'block';
      const r = n.getBoundingClientRect();
      let left = x + 14, top = y + 14;
      if (left + r.width > window.innerWidth - 8) left = Math.max(8, x - r.width - 14);
      if (top + r.height > window.innerHeight - 8) top = Math.max(8, y - r.height - 14);
      n.style.left = left + 'px';
      n.style.top = top + 'px';
    },
    hide() { if (node) node.style.display = 'none'; },
  };
})();

function attachMark(elm, linesFn) {
  const move = (ev) => tooltip.show(ev.clientX, ev.clientY, linesFn());
  elm.addEventListener('pointerenter', move);
  elm.addEventListener('pointermove', move);
  elm.addEventListener('pointerleave', () => tooltip.hide());
  elm.addEventListener('focus', () => {
    const r = elm.getBoundingClientRect();
    tooltip.show(r.left + r.width / 2, r.top, linesFn());
  });
  elm.addEventListener('blur', () => tooltip.hide());
}

// ---- shape helpers ----

function roundedColumn(x, y, w, h, r, roundTop) {
  h = Math.max(h, 0.5);
  r = Math.min(r, w / 2, h);
  if (roundTop) {
    return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
  }
  return `M${x},${y} L${x + w},${y} L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} L${x + r},${y + h} Q${x},${y + h} ${x},${y + h - r} Z`;
}

function roundedBarH(x, y, w, h, r, roundRight) {
  w = Math.max(w, 0.5);
  r = Math.min(r, h / 2, w);
  if (roundRight) {
    return `M${x},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} L${x},${y + h} Z`;
  }
  return `M${x + w},${y} L${x + r},${y} Q${x},${y} ${x},${y + r} L${x},${y + h - r} Q${x},${y + h} ${x + r},${y + h} L${x + w},${y + h} Z`;
}

function arcPath(cx, cy, r0, r1, a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (r, a) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
  return `M${p(r1, a0)} A${r1} ${r1} 0 ${large} 1 ${p(r1, a1)} L${p(r0, a1)} A${r0} ${r0} 0 ${large} 0 ${p(r0, a0)} Z`;
}

function svgRoot(W, H, aria) {
  return E('svg', {
    viewBox: `0 0 ${W} ${H}`, width: W, height: H,
    'font-family': FONT, role: 'img', 'aria-label': aria || 'chart',
  });
}

// ---- main entry ----
// prep: output of prepareChart. opts: { type, theme, color, fmtVal(v, compact), fmtTick(v), width?, aria }
export function renderChart(container, prep, opts) {
  container.textContent = '';
  if (!prep) {
    const msg = document.createElement('div');
    msg.className = 'chart-empty';
    msg.textContent = 'Not enough data for this chart — try different fields.';
    container.appendChild(msg);
    return null;
  }
  const W = opts.width || Math.max(300, container.clientWidth || 560);
  let svg;
  if (prep.kind === 'category') {
    svg = opts.type === 'bar' ? renderBar(W, prep, opts) : renderColumn(W, prep, opts);
  } else if (prep.kind === 'time') {
    svg = renderLine(W, prep, opts, opts.type === 'area');
  } else if (prep.kind === 'donut') {
    svg = renderDonut(W, prep, opts);
  } else if (prep.kind === 'scatter') {
    svg = renderScatter(W, prep, opts);
  }
  if (svg) container.appendChild(svg);
  return svg;
}

// ---- column (vertical bars) ----

function renderColumn(W, prep, o) {
  const th = o.theme;
  const items = prep.items;
  const labelAll = items.length <= 8 && !prep.histogram;
  const vals = items.map((i) => i.value);
  const { ticks, lo, hi } = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 4);
  const hasNeg = Math.min(...vals) < 0;
  const mT = labelAll ? 26 : 16;
  const mB = 26, mR = 8;
  const mL = labelAll ? 10 : Math.max(...ticks.map((t) => o.fmtTick(t).length)) * 6.6 + 16;
  const H = 248;
  const pw = W - mL - mR, ph = H - mT - mB;
  const y = (v) => mT + ph - ((v - lo) / (hi - lo)) * ph;
  const svg = svgRoot(W, H, o.aria);

  if (!labelAll) {
    for (const t of ticks) {
      E('line', { x1: mL, x2: W - mR, y1: y(t), y2: y(t), stroke: t === 0 ? th.axis : th.grid, 'stroke-width': 1 }, svg);
      T(svg, o.fmtTick(t), { x: mL - 8, y: y(t) + 3.5, 'text-anchor': 'end', fill: th.muted, 'font-size': 10.5 });
    }
  } else {
    E('line', { x1: mL, x2: W - mR, y1: y(0), y2: y(0), stroke: th.axis, 'stroke-width': 1 }, svg);
  }

  const band = pw / items.length;
  const bw = Math.min(24, Math.max(6, band * 0.62));
  items.forEach((it, i) => {
    const cx = mL + band * i + band / 2;
    const y0 = y(0), yv = y(it.value);
    const top = Math.min(y0, yv), hgt = Math.abs(y0 - yv);
    const p = E('path', {
      d: roundedColumn(cx - bw / 2, top, bw, hgt, 4, it.value >= 0),
      fill: o.color, class: 'mark', tabindex: 0,
    }, svg);
    attachMark(p, () => [
      { kind: 'value', text: o.fmtVal(it.value) },
      { kind: 'label', text: String(it.label) },
    ]);
    if (labelAll) {
      T(svg, o.fmtVal(it.value, true), {
        x: cx, y: it.value >= 0 ? top - 7 : top + hgt + 13,
        'text-anchor': 'middle', fill: th.ink2, 'font-size': 11, 'font-weight': 600,
      });
    }
  });

  if (labelAll) {
    // every category named — truncate each label to fit its band
    const chars = Math.min(14, Math.max(4, Math.floor(band / 6.2)));
    items.forEach((it, i) => {
      T(svg, truncate(it.label, chars), {
        x: mL + band * i + band / 2, y: H - 8, 'text-anchor': 'middle', fill: th.muted, 'font-size': 10.5,
      });
    });
  } else {
    const maxLabels = Math.max(2, Math.floor(pw / 72));
    const every = Math.ceil(items.length / maxLabels);
    items.forEach((it, i) => {
      if (i % every) return;
      T(svg, truncate(it.label, 12), {
        x: mL + band * i + band / 2, y: H - 8, 'text-anchor': 'middle', fill: th.muted, 'font-size': 10.5,
      });
    });
  }
  if (hasNeg && labelAll) {
    // baseline sits mid-chart; re-draw so it stays visible above marks
    E('line', { x1: mL, x2: W - mR, y1: y(0), y2: y(0), stroke: th.axis, 'stroke-width': 1 }, svg);
  }
  return svg;
}

// ---- bar (horizontal, ranked) ----

function renderBar(W, prep, o) {
  const th = o.theme;
  const items = prep.items;
  const n = items.length;
  const rowH = 32;
  const H = n * rowH + 18;
  const labelW = clamp(Math.max(...items.map((i) => String(i.label).length)) * 6.6 + 12, 56, Math.min(170, W * 0.34));
  const valW = Math.max(...items.map((i) => o.fmtVal(i.value, true).length)) * 6.8 + 14;
  const mL = labelW, mR = valW, mT = 8, mB = 10;
  const pw = W - mL - mR;
  const vals = items.map((i) => i.value);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals) || 1;
  const x = (v) => mL + ((v - lo) / (hi - lo)) * pw;
  const svg = svgRoot(W, H, o.aria);
  const x0 = x(0);
  E('line', { x1: x0, x2: x0, y1: mT, y2: H - mB, stroke: th.axis, 'stroke-width': 1 }, svg);

  items.forEach((it, i) => {
    const yTop = mT + i * rowH + (rowH - 20) / 2;
    const xv = x(it.value);
    const bx = Math.min(x0, xv), bwd = Math.abs(xv - x0);
    const p = E('path', {
      d: roundedBarH(bx, yTop, bwd, 20, 4, it.value >= 0),
      fill: o.color, class: 'mark', tabindex: 0,
    }, svg);
    attachMark(p, () => [
      { kind: 'value', text: o.fmtVal(it.value) },
      { kind: 'label', text: String(it.label) },
    ]);
    T(svg, truncate(it.label, 24), {
      x: mL - 8, y: yTop + 14, 'text-anchor': 'end', fill: th.ink2, 'font-size': 11,
    });
    T(svg, o.fmtVal(it.value, true), {
      x: it.value >= 0 ? xv + 7 : xv - 7, y: yTop + 14,
      'text-anchor': it.value >= 0 ? 'start' : 'end', fill: th.ink, 'font-size': 11, 'font-weight': 600,
    });
  });
  return svg;
}

// ---- line / area (time series) ----

function renderLine(W, prep, o, isArea) {
  const th = o.theme;
  const pts = prep.points;
  const n = pts.length;
  const vals = pts.map((p) => p.value);
  const minV = Math.min(...vals), maxV = Math.max(...vals);
  const pad = (maxV - minV) * 0.08;
  const { ticks, lo, hi } = niceTicks(Math.min(minV, isArea ? 0 : minV) - (minV > 0 && (isArea || minV === maxV) ? 0 : pad), maxV + pad, 4);
  const endLabel = o.fmtVal(pts[n - 1].value, true);
  const mL = Math.max(...ticks.map((t) => o.fmtTick(t).length)) * 6.6 + 16;
  const mR = endLabel.length * 6.8 + 18;
  const mT = 14, mB = 26, H = 248;
  const pw = W - mL - mR, ph = H - mT - mB;
  const t0 = pts[0].t.getTime(), t1 = pts[n - 1].t.getTime() || t0 + 1;
  const x = (t) => mL + ((t - t0) / Math.max(1, t1 - t0)) * pw;
  const y = (v) => mT + ph - ((v - lo) / (hi - lo)) * ph;
  const svg = svgRoot(W, H, o.aria);

  for (const t of ticks) {
    E('line', { x1: mL, x2: W - mR, y1: y(t), y2: y(t), stroke: t === 0 ? th.axis : th.grid, 'stroke-width': 1 }, svg);
    T(svg, o.fmtTick(t), { x: mL - 8, y: y(t) + 3.5, 'text-anchor': 'end', fill: th.muted, 'font-size': 10.5 });
  }

  const spanYears = pts[0].t.getFullYear() !== pts[n - 1].t.getFullYear();
  const tickCount = Math.max(2, Math.min(6, Math.floor(pw / 90)));
  const stepI = Math.max(1, Math.round((n - 1) / (tickCount - 1)));
  for (let i = 0; i < n; i += stepI) {
    T(svg, fmtBucket(pts[i].key, prep.granularity, { withYear: spanYears }), {
      x: x(pts[i].t.getTime()), y: H - 8, 'text-anchor': i === 0 ? 'start' : 'middle', fill: th.muted, 'font-size': 10.5,
    });
  }

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t.getTime()).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  if (isArea) {
    E('path', {
      d: `${line}L${x(t1).toFixed(1)},${y(lo).toFixed(1)}L${x(t0).toFixed(1)},${y(lo).toFixed(1)}Z`,
      fill: o.color, 'fill-opacity': 0.1,
    }, svg);
  }
  E('path', { d: line, fill: 'none', stroke: o.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);

  const ex = x(pts[n - 1].t.getTime()), ey = y(pts[n - 1].value);
  E('circle', { cx: ex, cy: ey, r: 4.5, fill: o.color, stroke: th.surface, 'stroke-width': 2 }, svg);
  T(svg, endLabel, { x: ex + 9, y: ey + 3.5, fill: th.ink, 'font-size': 11, 'font-weight': 600 });

  // hover layer: crosshair snaps to nearest bucket
  const cross = E('line', { y1: mT, y2: mT + ph, stroke: th.axis, 'stroke-width': 1, visibility: 'hidden' }, svg);
  const dot = E('circle', { r: 5, fill: o.color, stroke: th.surface, 'stroke-width': 2, visibility: 'hidden' }, svg);
  const overlay = E('rect', { x: mL, y: mT, width: pw, height: ph, fill: 'transparent' }, svg);
  overlay.addEventListener('pointermove', (ev) => {
    const rect = overlay.getBoundingClientRect();
    const fx = (ev.clientX - rect.left) / rect.width;
    const idx = clamp(Math.round(fx * (n - 1)), 0, n - 1);
    const px = x(pts[idx].t.getTime()), py = y(pts[idx].value);
    cross.setAttribute('x1', px); cross.setAttribute('x2', px);
    cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', px); dot.setAttribute('cy', py);
    dot.setAttribute('visibility', 'visible');
    tooltip.show(ev.clientX, ev.clientY, [
      { kind: 'value', text: o.fmtVal(pts[idx].value) },
      { kind: 'label', text: fmtBucket(pts[idx].key, prep.granularity) },
    ]);
  });
  overlay.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    tooltip.hide();
  });
  return svg;
}

// ---- donut ----

function renderDonut(W, prep, o) {
  const th = o.theme;
  const H = 236;
  const size = H - 20;
  const cx = 10 + size / 2, cy = H / 2;
  const r1 = size / 2, r0 = r1 * 0.63;
  const svg = svgRoot(W, H, o.aria);
  const items = prep.items;
  const total = prep.total;

  let angle = -Math.PI / 2;
  items.forEach((it, i) => {
    const frac = it.value / total;
    const a0 = angle, a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const color = it.isOther ? th.other : th.series[i % th.series.length];
    let p;
    if (items.length === 1) {
      p = E('circle', { cx, cy, r: (r0 + r1) / 2, fill: 'none', stroke: color, 'stroke-width': r1 - r0, class: 'mark' }, svg);
    } else {
      p = E('path', {
        d: arcPath(cx, cy, r0, r1, a0, Math.min(a1, a0 + Math.PI * 2 - 0.0001)),
        fill: color, stroke: th.surface, 'stroke-width': 2, 'stroke-linejoin': 'round', class: 'mark', tabindex: 0,
      }, svg);
    }
    const pct = (frac * 100).toFixed(frac < 0.1 ? 1 : 0);
    attachMark(p, () => [
      { kind: 'value', text: o.fmtVal(it.value) },
      { kind: 'label', text: `${it.label} · ${pct}%` },
    ]);
  });

  T(svg, o.fmtVal(total, true), { x: cx, y: cy - 1, 'text-anchor': 'middle', fill: th.ink, 'font-size': 17, 'font-weight': 600 });
  T(svg, 'Total', { x: cx, y: cy + 15, 'text-anchor': 'middle', fill: th.muted, 'font-size': 10.5 });

  // legend (identity channel — always present for multi-slice)
  const lx = size + 34;
  const availW = W - lx - 10;
  const rowStep = Math.min(24, (H - 20) / items.length);
  let ly = cy - ((items.length - 1) / 2) * rowStep;
  items.forEach((it, i) => {
    const color = it.isOther ? th.other : th.series[i % th.series.length];
    const pct = ((it.value / total) * 100).toFixed(it.value / total < 0.1 ? 1 : 0);
    const valTxt = `${o.fmtVal(it.value, true)} · ${pct}%`;
    E('rect', { x: lx, y: ly - 9, width: 10, height: 10, rx: 2, fill: color }, svg);
    const labelChars = Math.max(4, Math.floor((availW - 16 - valTxt.length * 6.4 - 12) / 6.2));
    T(svg, truncate(it.label, labelChars), { x: lx + 16, y: ly, fill: th.ink2, 'font-size': 11 });
    T(svg, valTxt, { x: W - 10, y: ly, 'text-anchor': 'end', fill: th.ink, 'font-size': 11, 'font-weight': 600 });
    ly += rowStep;
  });
  return svg;
}

// ---- scatter ----

function renderScatter(W, prep, o) {
  const th = o.theme;
  const pts = prep.points;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const tx = niceTicks(Math.min(...xs), Math.max(...xs), 5);
  const ty = niceTicks(Math.min(...ys), Math.max(...ys), 4);
  const mL = Math.max(...ty.ticks.map((t) => o.fmtTick(t).length)) * 6.6 + 16;
  const mR = 12, mT = 18, mB = 44, H = 272;
  const pw = W - mL - mR, ph = H - mT - mB;
  const x = (v) => mL + ((v - tx.lo) / (tx.hi - tx.lo)) * pw;
  const y = (v) => mT + ph - ((v - ty.lo) / (ty.hi - ty.lo)) * ph;
  const svg = svgRoot(W, H, o.aria);

  for (const t of ty.ticks) {
    E('line', { x1: mL, x2: W - mR, y1: y(t), y2: y(t), stroke: th.grid, 'stroke-width': 1 }, svg);
    T(svg, o.fmtTick(t), { x: mL - 8, y: y(t) + 3.5, 'text-anchor': 'end', fill: th.muted, 'font-size': 10.5 });
  }
  for (const t of tx.ticks) {
    T(svg, o.fmtTickX ? o.fmtTickX(t) : o.fmtTick(t), { x: x(t), y: H - 28, 'text-anchor': 'middle', fill: th.muted, 'font-size': 10.5 });
  }
  E('line', { x1: mL, x2: W - mR, y1: mT + ph, y2: mT + ph, stroke: th.axis, 'stroke-width': 1 }, svg);
  T(svg, truncate(prep.xName, 30), { x: W - mR, y: H - 8, 'text-anchor': 'end', fill: th.ink2, 'font-size': 10.5, 'font-weight': 600 });
  T(svg, truncate(prep.yName, 30), { x: mL, y: 10, fill: th.ink2, 'font-size': 10.5, 'font-weight': 600 });

  const screen = pts.map((p) => ({ sx: x(p.x), sy: y(p.y), p }));
  for (const s of screen) {
    E('circle', { cx: s.sx.toFixed(1), cy: s.sy.toFixed(1), r: 4.5, fill: o.color, stroke: th.surface, 'stroke-width': 2, 'fill-opacity': 0.92 }, svg);
  }

  // nearest-point hover (pinpoint targets are unusable — search within 26px)
  const halo = E('circle', { r: 6.5, fill: o.color, stroke: th.surface, 'stroke-width': 2, visibility: 'hidden' }, svg);
  const overlay = E('rect', { x: mL, y: mT, width: pw, height: ph, fill: 'transparent' }, svg);
  overlay.addEventListener('pointermove', (ev) => {
    const rect = overlay.getBoundingClientRect();
    const px = mL + (ev.clientX - rect.left) * (pw / rect.width);
    const py = mT + (ev.clientY - rect.top) * (ph / rect.height);
    let best = null, bestD = 26 * 26;
    for (const s of screen) {
      const d = (s.sx - px) ** 2 + (s.sy - py) ** 2;
      if (d < bestD) { bestD = d; best = s; }
    }
    if (best) {
      halo.setAttribute('cx', best.sx); halo.setAttribute('cy', best.sy);
      halo.setAttribute('visibility', 'visible');
      tooltip.show(ev.clientX, ev.clientY, [
        { kind: 'title', text: String(best.p.label || '') },
        { kind: 'value', text: `${o.fmtVal(best.p.y)} — ${truncate(prep.yName, 18)}` },
        { kind: 'label', text: `${o.fmtValX ? o.fmtValX(best.p.x) : o.fmtVal(best.p.x)} — ${truncate(prep.xName, 18)}` },
      ]);
    } else {
      halo.setAttribute('visibility', 'hidden');
      tooltip.hide();
    }
  });
  overlay.addEventListener('pointerleave', () => {
    halo.setAttribute('visibility', 'hidden');
    tooltip.hide();
  });
  return svg;
}
