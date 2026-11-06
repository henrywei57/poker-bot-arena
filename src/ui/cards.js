// Card artwork, drawn as SVG so it stays sharp at any size and can be
// restyled live: four face themes, a four-colour option, three fonts, six
// back designs with custom colours and a monogram, and the table felt.

import { RANKS, SUIT_NAMES, RANK_NAMES } from '../engine/cards.js';
import { h, storage, store, $$ } from './dom.js';

const KEY = 'pba.cardstyle.v1';
export const DEFAULT_STYLE = {
  face: 'midnight', fourColor: false, font: 'modern',
  back: 'lattice', backA: '#123a8a', backB: '#59c8ff', monogram: '♠',
  felt: 'navy', feltCustom: '#1a5aa6', size: 'm',
};

export const FACE_THEMES = {
  midnight: { label: 'Midnight', bg: ['#1b2e59', '#0b1631'], border: 'rgba(170,200,255,.34)', frame: 'rgba(140,175,255,.20)',
    two: { s: '#ecf3ff', h: '#ff5d7a', d: '#ff5d7a', c: '#ecf3ff' }, four: { s: '#ecf3ff', h: '#ff5d7a', d: '#58bdff', c: '#4ee3a3' } },
  classic: { label: 'Classic', bg: ['#fffdf7', '#efe9dc'], border: '#d4ccba', frame: 'rgba(20,20,40,.10)',
    two: { s: '#141a28', h: '#d21f3c', d: '#d21f3c', c: '#141a28' }, four: { s: '#141a28', h: '#d21f3c', d: '#1561d4', c: '#128648' } },
  neon: { label: 'Neon', bg: ['#081327', '#02060f'], border: 'rgba(80,215,255,.7)', frame: 'rgba(80,215,255,.18)', glow: true,
    two: { s: '#46d9ff', h: '#ff4fa8', d: '#ff4fa8', c: '#46d9ff' }, four: { s: '#46d9ff', h: '#ff4fa8', d: '#ffb84a', c: '#63ffa6' } },
  minimal: { label: 'Minimal', bg: ['#f2f6ff', '#e2eafb'], border: '#c5d2ec', frame: 'rgba(30,50,100,.08)', minimal: true,
    two: { s: '#131d36', h: '#e2294c', d: '#e2294c', c: '#131d36' }, four: { s: '#131d36', h: '#e2294c', d: '#1d6fe0', c: '#16915a' } },
};

export const FONTS = {
  modern: { label: 'Modern', family: "Inter, 'Segoe UI', system-ui, sans-serif", weight: 800 },
  serif: { label: 'Serif', family: "'Playfair Display', Georgia, 'Times New Roman', serif", weight: 700 },
  mono: { label: 'Mono', family: "'JetBrains Mono', ui-monospace, Consolas, monospace", weight: 700 },
};

export const FELTS = {
  navy: { label: 'Navy', c: ['#1b5cab', '#0d3270', '#06173d'] },
  midnight: { label: 'Midnight', c: ['#24375f', '#131f3f', '#090f22'] },
  ocean: { label: 'Ocean', c: ['#11809e', '#0a4a68', '#05283b'] },
  royal: { label: 'Royal', c: ['#4b52d6', '#2a2e8c', '#151750'] },
  violet: { label: 'Violet', c: ['#6b47c4', '#41287e', '#201343'] },
  emerald: { label: 'Emerald', c: ['#1f8c5b', '#125738', '#0a301f'] },
};

export const BACK_PRESETS = [
  ['#123a8a', '#59c8ff'], ['#0b1f4a', '#f2c14e'], ['#2a1458', '#c48bff'], ['#062b3a', '#3fe0c5'],
  ['#3a0d22', '#ff6b8f'], ['#101418', '#e6edf7'], ['#14306b', '#ffffff'], ['#0b2d1d', '#7dffb2'],
];

let style = { ...DEFAULT_STYLE, ...storage(KEY, {}) };
const faceCache = new Map();
const listeners = new Set();

export const getCardStyle = () => ({ ...style });
export function onCardStyle(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function setCardStyle(patch) {
  style = { ...style, ...patch };
  if (!FACE_THEMES[style.face]) style.face = DEFAULT_STYLE.face;
  if (!FONTS[style.font]) style.font = DEFAULT_STYLE.font;
  if (!BACKS[style.back]) style.back = DEFAULT_STYLE.back;
  style.monogram = [...String(style.monogram ?? '')].slice(0, 3).join('');
  store(KEY, style);
  faceCache.clear();
  applyCardStyle();
  for (const el of $$('.card[data-card]')) el.querySelector('.card-front').innerHTML = faceSVG(Number(el.dataset.card));
  listeners.forEach((fn) => fn(style));
}

export function resetCardStyle() { setCardStyle({ ...DEFAULT_STYLE }); }

// ----------------------------------------------------------- colours
function hexToRgb(hex) {
  let x = hex.replace('#', '');
  if (x.length === 3) x = x.split('').map((c) => c + c).join('');
  const n = parseInt(x, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
/** amt > 0 lightens toward white, < 0 darkens toward black. */
export function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
  return toHex(r + (t - r) * p, g + (t - g) * p, b + (t - b) * p);
}
const safeHex = (c, fb) => (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(c || '') ? c : fb);

export function feltColors(s = style) {
  if (s.felt === 'custom') { const c = safeHex(s.feltCustom, '#1b5cab'); return [shade(c, 0.12), shade(c, -0.35), shade(c, -0.7)]; }
  return (FELTS[s.felt] || FELTS.navy).c;
}

// ------------------------------------------------------------- suits
const SUIT_PATHS = {
  h: '<path d="M50 91C46 86 6 61 6 33 6 16 18 6 31 6c9 0 16 5 19 13 3-8 10-13 19-13 13 0 25 10 25 27 0 28-40 53-44 58z"/>',
  d: '<path d="M50 4c10 17 24 33 40 46-16 13-30 29-40 46C40 79 26 63 10 50 26 37 40 21 50 4z"/>',
  s: '<path d="M50 4c6 15 44 34 44 59 0 13-10 21-22 21-8 0-14-4-18-10 1 10 5 17 14 22H32c9-5 13-12 14-22-4 6-10 10-18 10C16 84 6 76 6 63 6 38 44 19 50 4z"/>',
  c: '<circle cx="50" cy="28" r="19"/><circle cx="28" cy="57" r="19"/><circle cx="72" cy="57" r="19"/><circle cx="50" cy="51" r="12"/><path d="M45 52c0 22-5 34-14 44h38c-9-10-14-22-14-44z"/>',
};
const SUIT_KEYS = ['s', 'h', 'd', 'c'];

function suit(sk, cx, cy, size, color, flip = false, extra = '') {
  const k = size / 100;
  const rot = flip ? ` rotate(180 50 50)` : '';
  return `<g transform="translate(${(cx - size / 2).toFixed(2)} ${(cy - size / 2).toFixed(2)}) scale(${k.toFixed(4)})${rot}" fill="${color}" ${extra}>${SUIT_PATHS[sk]}</g>`;
}

const EMBLEMS = {
  K: '<path d="M6 52L12 14l20 20L50 4l18 30 20-20 6 38z"/><rect x="6" y="56" width="88" height="8" rx="3"/>',
  Q: '<path d="M8 54C14 30 22 18 30 30c6-18 14-26 20-26s14 8 20 26c8-12 16 0 22 24z"/><circle cx="50" cy="4" r="5"/><rect x="8" y="56" width="84" height="8" rx="3"/>',
  J: '<path d="M50 2l11 34h36L68 57l11 35-29-21-29 21 11-35L3 36h36z"/>',
};

const PIPS = {
  2: [[125, 78], [125, 272]],
  3: [[125, 78], [125, 175], [125, 272]],
  4: [[82, 78], [168, 78], [82, 272], [168, 272]],
  5: [[82, 78], [168, 78], [125, 175], [82, 272], [168, 272]],
  6: [[82, 78], [168, 78], [82, 175], [168, 175], [82, 272], [168, 272]],
  7: [[82, 78], [168, 78], [125, 126], [82, 175], [168, 175], [82, 272], [168, 272]],
  8: [[82, 78], [168, 78], [125, 126], [82, 175], [168, 175], [125, 224], [82, 272], [168, 272]],
  9: [[82, 78], [168, 78], [82, 143], [168, 143], [125, 175], [82, 207], [168, 207], [82, 272], [168, 272]],
  10: [[82, 78], [168, 78], [125, 111], [82, 143], [168, 143], [82, 207], [168, 207], [125, 239], [82, 272], [168, 272]],
};
const PIP_SIZE = { 2: 54, 3: 52, 4: 50, 5: 48, 6: 46, 7: 44, 8: 43, 9: 41, 10: 40 };

export function cardLabel(c) {
  return `${RANK_NAMES[c >> 2]} of ${SUIT_NAMES[c & 3]}`;
}

/** SVG markup for one card face in the current style. */
export function faceSVG(card, s = style) {
  const key = `${card}|${s.face}|${s.fourColor}|${s.font}`;
  const hit = faceCache.get(key);
  if (hit) return hit;
  const th = FACE_THEMES[s.face] || FACE_THEMES.midnight;
  const font = FONTS[s.font] || FONTS.modern;
  const r = card >> 2, sk = SUIT_KEYS[card & 3];
  const color = (s.fourColor ? th.four : th.two)[sk];
  const rankText = RANKS[r] === 'T' ? '10' : RANKS[r];
  const gid = `g${card}${s.face}`;
  const glow = th.glow ? ` filter="url(#f${gid})"` : '';
  let body = '';

  const corner = (() => {
    const fs = rankText === '10' ? 38 : 44;
    const ls = rankText === '10' ? ' letter-spacing="-3"' : '';
    const one = `<text x="31" y="54" text-anchor="middle" font-family="${font.family}" font-weight="${font.weight}" font-size="${fs}"${ls} fill="${color}">${rankText}</text>${suit(sk, 31, 81, 28, color)}`;
    return `<g${glow}>${one}<g transform="rotate(180 125 175)">${one}</g></g>`;
  })();

  if (th.minimal) {
    body = `<text x="125" y="205" text-anchor="middle" font-family="${font.family}" font-weight="${font.weight}" font-size="${rankText === '10' ? 104 : 124}" fill="${color}"${rankText === '10' ? ' letter-spacing="-6"' : ''}>${rankText}</text>${suit(sk, 125, 262, 56, color)}`;
  } else if (r === 12) {
    const ring = `<circle cx="125" cy="175" r="74" fill="none" stroke="${color}" stroke-opacity=".28" stroke-width="2"/><circle cx="125" cy="175" r="66" fill="none" stroke="${color}" stroke-opacity=".14" stroke-width="1.5"/>`;
    body = `${ring}<g${glow}>${suit(sk, 125, 175, sk === 's' ? 112 : 100, color)}</g>`;
  } else if (r >= 9) {
    const letter = RANKS[r];
    body = `<rect x="58" y="58" width="134" height="234" rx="12" fill="${color}" fill-opacity=".09" stroke="${color}" stroke-opacity=".55" stroke-width="2"/>
      <rect x="66" y="66" width="118" height="218" rx="8" fill="none" stroke="${color}" stroke-opacity=".22" stroke-width="1.2"/>
      <g transform="translate(95 88) scale(.6)" fill="${color}"${glow}>${EMBLEMS[letter]}</g>
      <text x="125" y="232" text-anchor="middle" font-family="${font.family}" font-weight="${font.weight}" font-size="112" fill="${color}"${glow}>${letter}</text>
      ${suit(sk, 125, 262, 26, color)}`;
  } else {
    const n = r + 2;
    body = `<g${glow}>${PIPS[n].map(([x, y]) => suit(sk, x, y, PIP_SIZE[n], color, y > 175)).join('')}</g>`;
  }

  const defs = `<defs><linearGradient id="b${gid}" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="${th.bg[0]}"/><stop offset="1" stop-color="${th.bg[1]}"/></linearGradient>${
    th.glow ? `<filter id="f${gid}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` : ''}</defs>`;
  const svg = `<svg viewBox="0 0 250 350" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${defs}
    <rect x="1.5" y="1.5" width="247" height="347" rx="18" fill="url(#b${gid})" stroke="${th.border}" stroke-width="3"/>
    <rect x="10" y="10" width="230" height="330" rx="12" fill="none" stroke="${th.frame}" stroke-width="1.5"/>
    ${body}${corner}</svg>`;
  faceCache.set(key, svg);
  return svg;
}

// ------------------------------------------------------------- backs
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

const BACKS = {
  lattice: { label: 'Lattice', pattern: (A, B) => `<pattern id="p" width="20" height="20" patternUnits="userSpaceOnUse" patternTransform="rotate(45 125 175)"><path d="M0 0H20M0 0V20" stroke="${B}" stroke-opacity=".38" stroke-width="1.6"/><circle cx="10" cy="10" r="1.6" fill="${B}" fill-opacity=".55"/></pattern>` },
  hex: { label: 'Honeycomb', pattern: (A, B) => `<pattern id="p" width="27.71" height="48" patternUnits="userSpaceOnUse"><path d="M13.86 0L27.71 8V24L13.86 32 0 24V8zM13.86 32V48" fill="none" stroke="${B}" stroke-opacity=".34" stroke-width="1.5"/></pattern>` },
  stripes: { label: 'Stripes', pattern: (A, B) => `<pattern id="p" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="6" height="16" fill="${B}" fill-opacity=".2"/><rect x="9" width="1.5" height="16" fill="${B}" fill-opacity=".3"/></pattern>` },
  circuit: { label: 'Circuit', pattern: (A, B) => `<pattern id="p" width="50" height="50" patternUnits="userSpaceOnUse"><g fill="none" stroke="${B}" stroke-opacity=".4" stroke-width="1.6"><path d="M0 25H16L23 18V0M25 50V36L34 27H50M8 50V40H18M42 0V10L36 16"/></g><g fill="${B}" fill-opacity=".7"><circle cx="16" cy="25" r="2.4"/><circle cx="34" cy="27" r="2.4"/><circle cx="18" cy="40" r="2"/><circle cx="36" cy="16" r="2"/></g></pattern>` },
  waves: { label: 'Waves', pattern: (A, B) => `<pattern id="p" width="250" height="350" patternUnits="userSpaceOnUse"><g fill="none" stroke="${B}">${
    Array.from({ length: 17 }, (_, i) => `<circle cx="125" cy="175" r="${12 + i * 13}" stroke-opacity="${(i % 2 ? 0.16 : 0.34).toFixed(2)}" stroke-width="${i % 2 ? 1 : 2}"/>`).join('')}</g></pattern>` },
  nebula: { label: 'Nebula', pattern: (A, B) => {
    let stars = '', seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) stars += `<circle cx="${(rnd() * 250).toFixed(1)}" cy="${(rnd() * 350).toFixed(1)}" r="${(rnd() * 1.6 + 0.3).toFixed(2)}" fill="${B}" fill-opacity="${(rnd() * 0.6 + 0.25).toFixed(2)}"/>`;
    return `<radialGradient id="n1" cx=".25" cy=".25" r=".6"><stop offset="0" stop-color="${B}" stop-opacity=".45"/><stop offset="1" stop-color="${B}" stop-opacity="0"/></radialGradient><radialGradient id="n2" cx=".8" cy=".8" r=".55"><stop offset="0" stop-color="${shade(B, 0.3)}" stop-opacity=".35"/><stop offset="1" stop-color="${B}" stop-opacity="0"/></radialGradient><pattern id="p" width="250" height="350" patternUnits="userSpaceOnUse"><rect width="250" height="350" fill="url(#n1)"/><rect width="250" height="350" fill="url(#n2)"/>${stars}</pattern>`;
  } },
};
export const BACK_DESIGNS = Object.fromEntries(Object.entries(BACKS).map(([k, v]) => [k, v.label]));

export function backSVG(s = style) {
  const A = safeHex(s.backA, DEFAULT_STYLE.backA), B = safeHex(s.backB, DEFAULT_STYLE.backB);
  const design = BACKS[s.back] || BACKS.lattice;
  const mono = [...String(s.monogram || '')].slice(0, 3).join('');
  const fs = mono.length >= 3 ? 25 : mono.length === 2 ? 32 : 42;
  const badge = mono ? `<circle cx="125" cy="175" r="42" fill="${shade(A, -0.35)}" stroke="${B}" stroke-width="2.5"/><circle cx="125" cy="175" r="35" fill="none" stroke="${B}" stroke-opacity=".35" stroke-width="1"/><text x="125" y="175" dy=".36em" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="${fs}" fill="${B}">${esc(mono)}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 350"><defs><linearGradient id="g" x1="0" y1="0" x2="0.7" y2="1"><stop offset="0" stop-color="${shade(A, 0.12)}"/><stop offset="1" stop-color="${shade(A, -0.45)}"/></linearGradient>${design.pattern(A, B)}<clipPath id="c"><rect x="16" y="16" width="218" height="318" rx="10"/></clipPath></defs><rect x="1" y="1" width="248" height="348" rx="18" fill="url(#g)" stroke="${shade(B, -0.2)}" stroke-opacity=".6" stroke-width="2"/><g clip-path="url(#c)"><rect width="250" height="350" fill="url(#p)"/></g><rect x="16" y="16" width="218" height="318" rx="10" fill="none" stroke="${B}" stroke-opacity=".75" stroke-width="2.5"/><rect x="9" y="9" width="232" height="332" rx="14" fill="none" stroke="${B}" stroke-opacity=".25" stroke-width="1"/>${badge}</svg>`;
}

export const svgDataUri = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

export function applyCardStyle(s = style) {
  const root = document.documentElement;
  root.style.setProperty('--card-back', svgDataUri(backSVG(s)));
  const [f1, f2, f3] = feltColors(s);
  root.style.setProperty('--felt-1', f1);
  root.style.setProperty('--felt-2', f2);
  root.style.setProperty('--felt-3', f3);
  root.style.setProperty('--card-scale', { s: 0.86, m: 1, l: 1.16 }[s.size] || 1);
  root.dataset.face = s.face;
}

// ------------------------------------------------------------ elements
/** A card element. card: 0..51 face up, -1 face down. */
export function cardEl(card, cls = '') {
  const el = h('div', { class: `card ${cls}`.trim(), role: 'img' },
    h('div', { class: 'card-inner' }, h('div', { class: 'card-face card-front' }), h('div', { class: 'card-face card-back' })));
  el._card = null;
  setCard(el, card);
  return el;
}

export function setCard(el, card) {
  if (el._card === card) return;
  if (card >= 0) {
    el.querySelector('.card-front').innerHTML = faceSVG(card);
    el.dataset.card = String(card);
    el.setAttribute('aria-label', cardLabel(card));
    el.classList.remove('down');
  } else {
    el.classList.add('down');
    delete el.dataset.card;
    el.setAttribute('aria-label', 'Face-down card');
  }
  el._card = card;
}

/** A few face-up cards fanned out (home page, settings preview). */
export function fan(cards, cls = '') {
  return h('div', { class: `fan ${cls}`.trim() }, cards.map((c, i) => {
    const el = cardEl(c);
    const off = i - (cards.length - 1) / 2;
    el.style.setProperty('--i', off);
    el.style.setProperty('--ai', Math.abs(off));
    return el;
  }));
}
