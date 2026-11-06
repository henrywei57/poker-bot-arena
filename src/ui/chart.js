// A small canvas line chart: net chips per player over hands, with a hover
// readout. Redraws on resize.

import { h } from './dom.js';
import { formatChips } from '../util.js';

export function lineChart(series, { height = 260, yLabel = 'Net chips', xLabel = 'Hands' } = {}) {
  const canvas = h('canvas', { class: 'chart-canvas', role: 'img', 'aria-label': `${yLabel} by ${xLabel.toLowerCase()} for each player` });
  const tip = h('div', { class: 'chart-tip' });
  const wrap = h('div', { class: 'chart', style: { height: `${height}px` } }, canvas, tip);
  let hoverX = null;
  const pad = { l: 58, r: 14, t: 12, b: 28 };

  const bounds = () => {
    let xMax = 1, yMin = 0, yMax = 0;
    for (const s of series) for (const [x, y] of s.points) {
      xMax = Math.max(xMax, x); yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
    }
    if (yMax === yMin) { yMax += 1; yMin -= 1; }
    const span = yMax - yMin;
    return { xMax, yMin: yMin - span * 0.06, yMax: yMax + span * 0.06 };
  };

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth, hgt = wrap.clientHeight;
    if (!w || !hgt) return;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr);
    canvas.style.width = `${w}px`; canvas.style.height = `${hgt}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const css = getComputedStyle(document.documentElement);
    const grid = css.getPropertyValue('--chart-grid').trim() || 'rgba(140,170,230,.12)';
    const text = css.getPropertyValue('--muted').trim() || '#7f93b8';
    const { xMax, yMin, yMax } = bounds();
    const X = (x) => pad.l + (x / xMax) * (w - pad.l - pad.r);
    const Y = (y) => pad.t + (1 - (y - yMin) / (yMax - yMin)) * (hgt - pad.t - pad.b);
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.fillStyle = text;
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    const ticks = niceTicks(yMin, yMax, 5);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const t of ticks) {
      const y = Y(t);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillText(formatChips(t), pad.l - 8, y);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const t of niceTicks(0, xMax, 6)) {
      if (t < 0 || t > xMax) continue;
      ctx.fillText(String(t), X(t), hgt - pad.b + 8);
    }
    if (yMin < 0 && yMax > 0) {
      ctx.strokeStyle = 'rgba(200,215,255,.35)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(pad.l, Y(0)); ctx.lineTo(w - pad.r, Y(0)); ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const s of series) {
      if (!s.points.length) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const step = Math.max(1, Math.floor(s.points.length / (w * 1.5)));
      ctx.moveTo(X(0), Y(0));
      for (let i = 0; i < s.points.length; i += step) ctx.lineTo(X(s.points[i][0]), Y(s.points[i][1]));
      const last = s.points[s.points.length - 1];
      ctx.lineTo(X(last[0]), Y(last[1]));
      ctx.stroke();
    }
    if (hoverX != null) {
      const x = Math.round(((hoverX - pad.l) / (w - pad.l - pad.r)) * xMax);
      if (x >= 1 && x <= xMax) {
        ctx.strokeStyle = 'rgba(220,230,255,.4)';
        ctx.beginPath(); ctx.moveTo(X(x), pad.t); ctx.lineTo(X(x), hgt - pad.b); ctx.stroke();
        const rows = series.map((s) => {
          const pt = nearest(s.points, x);
          return pt ? { name: s.name, color: s.color, y: pt[1] } : null;
        }).filter(Boolean).sort((a, b) => b.y - a.y);
        tip.replaceChildren(h('div', { class: 'chart-tip-head' }, `${xLabel.replace(/s$/, '')} ${x}`),
          ...rows.map((r) => h('div', null, h('i', { style: { background: r.color } }), r.name, h('b', null, formatChips(r.y)))));
        tip.classList.add('show');
        const tx = X(x) + 14;
        tip.style.left = `${tx + 190 > w ? X(x) - 200 : tx}px`;
      }
    } else tip.classList.remove('show');
  }

  canvas.addEventListener('mousemove', (e) => { hoverX = e.offsetX; draw(); });
  canvas.addEventListener('mouseleave', () => { hoverX = null; draw(); });
  const ro = new ResizeObserver(() => draw());
  ro.observe(wrap);
  wrap.update = (next) => { series = next; draw(); };
  wrap.destroy = () => ro.disconnect();
  requestAnimationFrame(draw);
  return wrap;
}

function nearest(points, x) {
  let lo = 0, hi = points.length - 1, best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid][0] <= x) { best = points[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

function niceTicks(min, max, count) {
  const span = max - min;
  if (span <= 0) return [min];
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || mag * 10;
  const out = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) out.push(Math.round(t * 1e6) / 1e6);
  return out;
}
