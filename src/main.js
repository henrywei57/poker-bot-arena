// Entry point: header, hash router, and bot-import links.

import { applyCardStyle } from './ui/cards.js';
import { h, icon, clear, modal, toast } from './ui/dom.js';
import { app, onAppChange, navigate, hasActive } from './ui/app.js';
import { renderHome } from './ui/screens/home.js';
import { renderPlaySetup, renderSimSetup, renderTournamentSetup } from './ui/screens/setup.js';
import { renderTable } from './ui/screens/table-screen.js';
import { renderLab, confirmLeaveLab } from './ui/screens/lab.js';
import { renderStyle } from './ui/screens/style.js';
import { renderOnline, renderJoin } from './ui/screens/online.js';
import { decodeShared, saveBot } from './bots/store.js';
import { compile } from './lang/interpreter.js';
import { highlightHTML } from './ui/editor.js';

applyCardStyle();

const NAV = [
  ['/play', 'Play', 'user'],
  ['/sim', 'Simulate', 'zap'],
  ['/tournament', 'Tournament', 'trophy'],
  ['/online', 'Online', 'globe'],
  ['/lab', 'Bot Lab', 'code'],
  ['/cards', 'Cards', 'palette'],
];
const TITLES = { '/': '', '/play': 'Play', '/sim': 'Simulate', '/tournament': 'Tournament', '/online': 'Online', '/lab': 'Bot Lab', '/cards': 'Cards & table', '/table': 'Table', '/join': 'Join' };

const livePill = h('button', { type: 'button', class: 'live-pill', hidden: true, onClick: () => navigate('/table') }, h('i'), h('span', null, 'Live table'));
const navLinks = NAV.map(([path, label, ic]) => h('a', { href: `#${path}`, class: 'nav-link', dataset: { path } }, icon(ic, 16), h('span', null, label)));
const menuBtn = h('button', { type: 'button', class: 'menu-btn btn ghost icon-only', 'aria-label': 'Menu', 'aria-expanded': 'false', onClick: () => {
  const open = !header.classList.contains('open');
  header.classList.toggle('open', open);
  menuBtn.setAttribute('aria-expanded', String(open));
} }, icon('menu', 20));
const header = h('header', { class: 'topbar' },
  h('a', { href: '#/', class: 'brand', 'aria-label': 'Poker Bot Arena home' }, h('span', { class: 'brand-mark' }, '♠'), h('span', { class: 'brand-name' }, 'Poker Bot ', h('b', null, 'Arena'))),
  h('nav', { class: 'nav', 'aria-label': 'Main' }, navLinks),
  livePill, menuBtn);
const main = h('main', { id: 'app', tabindex: '-1' });
const footer = h('footer', { class: 'footer' },
  h('span', null, 'Poker Bot Arena · bots written in Kicker · '),
  h('a', { href: 'https://github.com/henrywei57/poker-bot-arena', target: '_blank', rel: 'noopener' }, 'Source on GitHub'),
  h('span', null, ' · MIT License · play money only'));
document.body.prepend(header, main, footer);

function updateChrome(path) {
  for (const a of navLinks) {
    const p = a.dataset.path;
    a.classList.toggle('on', path === p || path.startsWith(`${p}/`));
  }
  livePill.hidden = !hasActive() || path === '/table';
  if (app.meta) livePill.querySelector('span').textContent = app.meta.mode === 'online' ? 'Online table' : `Live: ${app.meta.title}`;
  header.classList.remove('open');
  const key = '/' + (path.split('/')[1] || '');
  document.title = TITLES[key] ? `${TITLES[key]} · Poker Bot Arena` : 'Poker Bot Arena';
}
onAppChange(() => updateChrome(currentPath || '/'));

let cleanup = null;
let currentPath = null;

async function route() {
  const path = decodeURIComponent(location.hash.replace(/^#/, '')) || '/';
  if (currentPath && currentPath.startsWith('/lab') && !path.startsWith('/lab')) {
    if (!(await confirmLeaveLab())) { history.replaceState(null, '', `#${currentPath}`); return; }
  }
  if (path.startsWith('/import/')) { importShared(location.hash.slice('#/import/'.length)); return; }
  try { cleanup?.(); } catch (e) { console.error(e); }
  cleanup = null;
  clear(main);
  main.className = '';
  const seg = path.split('/');
  let fn;
  switch (seg[1] || '') {
    case '': fn = () => renderHome(main); break;
    case 'play': fn = () => renderPlaySetup(main); break;
    case 'sim': fn = () => renderSimSetup(main); break;
    case 'tournament': fn = () => renderTournamentSetup(main); break;
    case 'table': main.className = 'wide'; fn = () => renderTable(main); break;
    case 'lab': main.className = 'wide'; fn = () => renderLab(main, seg.slice(2).join('/')); break;
    case 'cards': fn = () => renderStyle(main); break;
    case 'online': fn = () => renderOnline(main); break;
    case 'join': fn = () => renderJoin(main, (seg[2] || '').replace(/[^A-Za-z0-9_-]/g, '')); break;
    default: navigate('/'); return;
  }
  currentPath = path;
  try {
    cleanup = fn() || null;
  } catch (e) {
    console.error(e);
    main.append(h('div', { class: 'panel error-panel' }, h('h2', null, 'Something went wrong'), h('p', null, e.message)));
  }
  updateChrome(path);
  if (seg[1] !== 'table' && seg[1] !== 'lab') window.scrollTo(0, 0);
}

function importShared(data) {
  const code = decodeShared(data);
  const back = () => { history.replaceState(null, '', '#/lab'); route(); };
  if (!code) { toast('That bot link is broken', 'bad'); back(); return; }
  const c = compile(code);
  const name = c.meta.name || 'Shared bot';
  modal({
    title: `Add “${name}” to your Bot Lab?`,
    body: h('div', null,
      h('p', { class: 'muted' }, c.ok ? 'Someone shared this bot with you. Here is its code:' : 'This bot has problems, but you can still import it and fix them.'),
      h('pre', { class: 'code-sample import-preview', html: highlightHTML(code.slice(0, 20000)) })),
    actions: [
      { label: 'Cancel', onClick: back },
      { label: 'Add bot', primary: true, onClick: () => {
        const ref = saveBot(code);
        toast(`${name} added to My bots`, 'good');
        history.replaceState(null, '', `#/lab/${ref}`);
        currentPath = null;
        route();
      } },
    ],
    onClose: () => { if (location.hash.startsWith('#/import/')) back(); },
  });
}

window.addEventListener('hashchange', route);
route();
