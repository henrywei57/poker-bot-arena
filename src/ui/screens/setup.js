// Setup forms for Play, Simulate and Tournament.

import { h, icon, btn, segmented, toggle, field, select, storage, store, toast, modal } from '../dom.js';
import { builtinBots, myBots, getBot } from '../../bots/store.js';
import { launchPlay, launchSim, launchTournament, tournamentEntrants } from '../launch.js';
import { getProfile, saveProfile, displayName, AVATARS, navigate } from '../app.js';
import { Tournament, payouts } from '../../sim/tournament.js';
import { playHandSync } from '../../sim/headless.js';
import { formatChips, randomSeed } from '../../util.js';

const BLINDS = [[5, 10], [10, 20], [25, 50], [50, 100]];
const DEFAULTS = {
  play: { seats: ['you', 'builtin:shark', 'builtin:rock', 'builtin:maniac', 'builtin:station', 'builtin:chameleon'], blinds: 1, stackBB: 100, rebuy: true, speed: 1 },
  sim: { seats: ['builtin:shark', 'builtin:rock', 'builtin:maniac', 'builtin:station', 'builtin:math', 'builtin:trickster'], blinds: 1, stackBB: 100, rebuy: true, speed: 16, hands: 50, reveal: true, seed: '' },
  tournament: { entrants: { 'builtin:shark': 1, 'builtin:rock': 1, 'builtin:maniac': 1, 'builtin:station': 1, 'builtin:math': 1, 'builtin:trickster': 1, 'builtin:chameleon': 1, 'builtin:monkey': 1 },
    includeMe: false, tableSize: 9, stack: 1500, handsPerLevel: 10, speed: 8, reveal: true, seriesCount: 50 },
};

function loadSetup(mode) {
  const saved = storage(`pba.setup.${mode}`, null);
  return { ...structuredClone(DEFAULTS[mode]), ...(saved && typeof saved === 'object' ? saved : {}) };
}
const saveSetup = (mode, s) => store(`pba.setup.${mode}`, s);

function validRef(ref) {
  if (ref === 'you') return true;
  const b = getBot(ref);
  return !!(b && b.ok);
}

export function botOptions(allowYou) {
  const out = [];
  if (allowYou) { const nm = getProfile().name; out.push({ value: 'you', label: nm ? `🙂 You (${nm})` : '🙂 You' }); }
  out.push({ group: 'Built-in personalities', options: builtinBots().map((b) => ({ value: b.ref, label: `${b.avatar}  ${b.name}` })) });
  const mine = myBots().filter((b) => b.ok);
  if (mine.length) out.push({ group: 'My bots', options: mine.map((b) => ({ value: b.ref, label: `${b.avatar}  ${b.name}` })) });
  return out;
}

function seatEditor(state, { allowYou, onChange }) {
  const root = h('div', { class: 'seat-list' });
  const render = () => {
    root.replaceChildren();
    state.seats.forEach((ref, i) => {
      const b = ref === 'you' ? null : getBot(ref);
      const sel = select(botOptions(allowYou), ref, (v) => {
        if (v === 'you') state.seats = state.seats.map((r) => (r === 'you' ? 'builtin:shark' : r));
        state.seats[i] = v;
        onChange(); render();
      }, { 'aria-label': `Seat ${i + 1}` });
      root.append(h('div', { class: 'seat-row', style: { '--seat-color': b ? b.color : '#f2c14e' } },
        h('span', { class: 'seat-num' }, String(i + 1)),
        h('span', { class: 'avatar sm' }, ref === 'you' ? getProfile().avatar : b ? b.avatar : '?'),
        sel,
        btn('', { icon: 'x', kind: 'ghost', small: true, aria: `Remove seat ${i + 1}`, disabled: state.seats.length <= 2,
          onClick: () => { state.seats.splice(i, 1); onChange(); render(); } })));
    });
    root.append(h('div', { class: 'seat-actions' },
      btn('Add seat', { icon: 'plus', small: true, disabled: state.seats.length >= 9, onClick: () => {
        const pool = builtinBots().map((x) => x.ref);
        state.seats.push(pool[state.seats.length % pool.length]);
        onChange(); render();
      } }),
      h('span', { class: 'muted' }, `${state.seats.length} of 9 seats`)));
  };
  render();
  return root;
}

function profileEditor() {
  const prof = getProfile();
  const name = h('input', { type: 'text', value: prof.name, maxlength: 18, placeholder: 'You', 'aria-label': 'Your name',
    onChange: () => saveProfile({ name: name.value }) });
  const avatars = h('div', { class: 'avatar-pick' }, AVATARS.map((a) => h('button', {
    type: 'button', class: `avatar-opt ${a === prof.avatar ? 'on' : ''}`, 'aria-label': `Avatar ${a}`,
    onClick: (e) => { saveProfile({ avatar: a }); avatars.querySelectorAll('.on').forEach((x) => x.classList.remove('on')); e.currentTarget.classList.add('on'); },
  }, a)));
  return h('div', { class: 'profile-edit' }, field('Your name', name), field('Your avatar', avatars));
}

function blindsControl(state, onChange) {
  return segmented(BLINDS.map(([s, b], i) => ({ value: i, label: `${s}/${b}` })), state.blinds, (v) => { state.blinds = v; onChange(); });
}

function stackControl(state, onChange) {
  return segmented([50, 100, 200, 500].map((v) => ({ value: v, label: `${v} BB` })), state.stackBB, (v) => { state.stackBB = v; onChange(); });
}

function shell(title, subtitle, left, right, startBtn) {
  return h('section', { class: 'setup' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, title), h('p', { class: 'muted' }, subtitle))),
    h('div', { class: 'setup-grid' },
      h('div', { class: 'panel' }, left),
      h('div', { class: 'panel' }, right, h('div', { class: 'setup-start' }, startBtn))));
}

const tryStart = (fn) => { try { fn(); } catch (e) { toast(e.message, 'bad', 4000); } };

// ------------------------------------------------------------- play
export function renderPlaySetup(main) {
  const st = loadSetup('play');
  st.seats = st.seats.filter(validRef);
  if (!st.seats.includes('you')) st.seats.unshift('you');
  while (st.seats.length < 2) st.seats.push('builtin:shark');
  const save = () => saveSetup('play', st);
  const start = btn('Deal me in', { icon: 'play', kind: 'primary lg', onClick: () => tryStart(() => {
    const [sb, bb] = BLINDS[st.blinds];
    if (!st.seats.includes('you')) throw new Error('Pick a seat for yourself ("You") or use Simulate instead');
    launchPlay({ seats: st.seats.slice(), sb, bb, stack: st.stackBB * bb, rebuy: st.rebuy, speed: st.speed });
  }) });
  main.append(shell('Play vs bots', 'Take a seat. Pick who sits where; your seat is shown at the bottom of the table.',
    [h('h2', null, 'Seats'), seatEditor(st, { allowYou: true, onChange: save })],
    [h('h2', null, 'You'), profileEditor(),
      h('h2', null, 'Table'),
      field('Blinds', blindsControl(st, save)),
      field('Starting stack', stackControl(st, save)),
      field('Bot speed', segmented([0.5, 1, 2, 4].map((v) => ({ value: v, label: `${v}×` })), st.speed, (v) => { st.speed = v; save(); })),
      toggle('Auto-rebuy when anyone busts', st.rebuy, (v) => { st.rebuy = v; save(); })],
    start));
}

// -------------------------------------------------------------- sim
export function renderSimSetup(main) {
  const st = loadSetup('sim');
  st.seats = st.seats.filter((r) => r !== 'you' && validRef(r));
  while (st.seats.length < 2) st.seats.push('builtin:shark');
  const save = () => saveSetup('sim', st);
  const handsInput = h('input', { type: 'number', min: 1, max: 100000, value: st.hands, 'aria-label': 'Number of hands',
    onChange: () => { st.hands = Math.max(1, Math.min(100000, Math.round(Number(handsInput.value) || 50))); handsInput.value = st.hands; seg.setValue(st.hands); save(); } });
  const seg = segmented([50, 100, 250, 1000, 5000].map((v) => ({ value: v, label: String(v) })), st.hands, (v) => { st.hands = v; handsInput.value = v; save(); });
  const seedInput = h('input', { type: 'text', value: st.seed, placeholder: 'random', maxlength: 32, 'aria-label': 'Seed',
    onChange: () => { st.seed = seedInput.value.trim(); save(); } });
  const start = btn('Run simulation', { icon: 'zap', kind: 'primary lg', onClick: () => tryStart(() => {
    const [sb, bb] = BLINDS[st.blinds];
    launchSim({ seats: st.seats.slice(), sb, bb, stack: st.stackBB * bb, rebuy: st.rebuy, speed: st.speed, hands: st.hands, reveal: st.reveal, seed: st.seed });
  }) });
  main.append(shell('Simulate', 'Bots only. Watch at up to 16× or run instantly, then compare win rates and styles.',
    [h('h2', null, 'Bots at the table'), seatEditor(st, { allowYou: false, onChange: save })],
    [h('h2', null, 'Run'),
      field('Hands', h('div', { class: 'row-wrap' }, seg, handsInput)),
      field('Speed', segmented([1, 2, 4, 8, 16, 'instant'].map((v) => ({ value: v, label: v === 'instant' ? 'Instant' : `${v}×` })), st.speed, (v) => { st.speed = v; save(); }), 'You can change speed while it runs.'),
      field('Blinds', blindsControl(st, save)),
      field('Starting stack', stackControl(st, save)),
      toggle('Rebuy busted bots', st.rebuy, (v) => { st.rebuy = v; save(); }, 'Off: play until one bot has every chip'),
      toggle('Show every bot’s cards', st.reveal, (v) => { st.reveal = v; save(); }),
      field('Seed', seedInput, 'Same seed + same bots = the exact same cards and results.')],
    start));
}

// ------------------------------------------------------- tournament
export function renderTournamentSetup(main) {
  const st = loadSetup('tournament');
  for (const ref of Object.keys(st.entrants)) if (!validRef(ref)) delete st.entrants[ref];
  const save = () => saveSetup('tournament', st);
  const totalEl = h('b');
  const tablesEl = h('span', { class: 'muted' });
  const updateTotal = () => {
    const n = Object.values(st.entrants).reduce((a, b) => a + b, 0) + (st.includeMe ? 1 : 0);
    totalEl.textContent = String(n);
    const tables = Math.ceil(n / st.tableSize) || 0;
    tablesEl.textContent = n ? ` · ${tables} table${tables === 1 ? '' : 's'} · ${payouts(n).length} paid` : '';
    return n;
  };
  const list = h('div', { class: 'entrant-list' });
  const bots = [...builtinBots(), ...myBots().filter((b) => b.ok)];
  for (const b of bots) {
    const count = h('span', { class: 'count' }, String(st.entrants[b.ref] || 0));
    const setCount = (n) => {
      n = Math.max(0, Math.min(30, n));
      if (n) st.entrants[b.ref] = n; else delete st.entrants[b.ref];
      count.textContent = String(n);
      row.classList.toggle('on', n > 0);
      updateTotal(); save();
    };
    const row = h('div', { class: `entrant ${st.entrants[b.ref] ? 'on' : ''}`, style: { '--seat-color': b.color } },
      h('span', { class: 'avatar sm' }, b.avatar),
      h('div', { class: 'entrant-name' }, h('b', null, b.name), h('small', null, b.builtin ? 'Built-in' : 'My bot')),
      h('div', { class: 'stepper' },
        btn('', { icon: 'minus', small: true, kind: 'ghost', aria: `One fewer ${b.name}`, onClick: () => setCount((st.entrants[b.ref] || 0) - 1) }),
        count,
        btn('', { icon: 'plus', small: true, kind: 'ghost', aria: `One more ${b.name}`, onClick: () => setCount((st.entrants[b.ref] || 0) + 1) })));
    list.append(row);
  }
  updateTotal();
  const entrantsOf = () => Object.entries(st.entrants).map(([ref, count]) => ({ ref, count }));
  const seriesSeg = segmented([10, 50, 100, 250].map((v) => ({ value: v, label: String(v) })), st.seriesCount, (v) => { st.seriesCount = v; save(); });
  const start = h('div', { class: 'row-wrap' },
    btn('Start tournament', { icon: 'trophy', kind: 'primary lg', onClick: () => tryStart(() => {
      if (updateTotal() < 2) throw new Error('Add at least two entrants');
      if (updateTotal() > 90) throw new Error('Up to 90 entrants, please');
      launchTournament({ entrants: entrantsOf(), includeMe: st.includeMe, tableSize: st.tableSize, stack: st.stack, handsPerLevel: st.handsPerLevel, speed: st.includeMe && st.speed === 'instant' ? 2 : st.speed, reveal: st.reveal });
    }) }),
    btn('Run series instantly', { icon: 'zap', kind: 'lg', onClick: () => tryStart(() => {
      if (Object.values(st.entrants).reduce((a, b) => a + b, 0) < 2) throw new Error('Add at least two bot entrants');
      runSeriesModal({ entrants: entrantsOf(), tableSize: st.tableSize, stack: st.stack, handsPerLevel: st.handsPerLevel }, st.seriesCount);
    }) }));
  main.append(shell('Tournament', 'Freezeout: everyone starts equal, blinds rise, last player standing wins. More than one table? Tables break and balance as players bust.',
    [h('div', { class: 'row-between' }, h('h2', null, 'Entrants'), h('div', null, totalEl, ' players', tablesEl)),
      toggle('Include me', st.includeMe, (v) => { st.includeMe = v; updateTotal(); save(); }, 'You play your table yourself; the others run in the background'),
      list],
    [h('h2', null, 'Structure'),
      field('Max per table', segmented([2, 6, 9].map((v) => ({ value: v, label: v === 2 ? 'Heads-up' : `${v}-max` })), st.tableSize, (v) => { st.tableSize = v; updateTotal(); save(); })),
      field('Starting chips', segmented([1500, 3000, 10000].map((v) => ({ value: v, label: formatChips(v) })), st.stack, (v) => { st.stack = v; save(); })),
      field('Blinds go up every', segmented([5, 10, 15, 25].map((v) => ({ value: v, label: `${v} hands` })), st.handsPerLevel, (v) => { st.handsPerLevel = v; save(); })),
      field('Speed', segmented([1, 2, 4, 8, 16, 'instant'].map((v) => ({ value: v, label: v === 'instant' ? 'Instant' : `${v}×` })), st.speed, (v) => { st.speed = v; save(); })),
      toggle('Show every bot’s cards', st.reveal, (v) => { st.reveal = v; save(); }),
      h('h2', null, 'Series'),
      field('Tournaments in a series', seriesSeg, 'A series plays many tournaments instantly and ranks the bots by wins and average finish.')],
    start));
}

/** Plays `count` tournaments headlessly and shows who wins most. */
async function runSeriesModal(setup, count) {
  let cancelled = false;
  const bar = h('div', { class: 'progress' }, h('i'));
  const label = h('p', { class: 'muted' }, 'Starting…');
  const body = h('div', null, label, bar);
  const m = modal({ title: `Series of ${count} tournaments`, body, actions: [{ label: 'Stop', onClick: () => { cancelled = true; } }], onClose: () => { cancelled = true; } });
  const agg = new Map();
  const base = randomSeed();
  let done = 0, hands = 0;
  const t0 = performance.now();
  let last = t0;
  for (let i = 0; i < count && !cancelled; i++) {
    const entrants = tournamentEntrants({ ...setup, includeMe: false, iterations: 120 }, `${base}:${i}`);
    const tour = new Tournament({ entrants, startingStack: setup.stack, maxPerTable: setup.tableSize, handsPerLevel: setup.handsPerLevel, seed: `${base}:${i}` });
    const agents = new Map(entrants.map((p) => [p.id, p.agent]));
    const agentFor = (id) => agents.get(id);
    let rounds = 0;
    while (!tour.isOver() && !cancelled && rounds < 5000) {
      const info = tour.info();
      for (const t of tour.playable()) { playHandSync(t, agentFor, { tournament: info }); hands++; }
      tour.endRound();
      rounds++;
      if (performance.now() - last > 50) {
        await new Promise((r) => setTimeout(r, 0));
        last = performance.now();
      }
    }
    if (cancelled) break;
    const paid = payouts(entrants.length).length;
    for (const p of entrants) {
      let a = agg.get(p.ref);
      if (!a) { a = { ref: p.ref, name: p.name.replace(/ \d+$/, ''), avatar: p.avatar, color: p.color, entries: 0, wins: 0, placeSum: 0, itm: 0 }; agg.set(p.ref, a); }
      a.entries++;
      a.placeSum += p.place || entrants.length;
      if (p.place === 1) a.wins++;
      if (p.place && p.place <= paid) a.itm++;
    }
    done++;
    bar.firstChild.style.width = `${(done / count) * 100}%`;
    label.textContent = `${done} of ${count} tournaments · ${hands.toLocaleString()} hands`;
  }
  m.close();
  if (!done) return;
  const rows = [...agg.values()].sort((a, b) => b.wins / b.entries - a.wins / a.entries || a.placeSum / a.entries - b.placeSum / b.entries);
  const maxWin = Math.max(...rows.map((r) => r.wins / r.entries), 0.0001);
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  modal({
    title: `Series results · ${done} tournaments`, wide: true,
    body: h('div', null,
      h('p', { class: 'muted' }, `${hands.toLocaleString()} hands in ${secs}s. Win rate per entry (a bot entered twice gets two chances per tournament).`),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, ['#', 'Bot', 'Win rate', 'Wins', 'Avg finish', 'In the money'].map((x) => h('th', null, x)))),
        h('tbody', null, rows.map((r, i) => h('tr', null,
          h('td', null, String(i + 1)),
          h('td', null, h('span', { class: 'who', style: { '--seat-color': r.color } }, h('span', { class: 'avatar xs' }, r.avatar), r.name)),
          h('td', { class: 'bar-cell' }, h('span', { class: 'bar', style: { width: `${(r.wins / r.entries / maxWin) * 100}%`, background: r.color } }), h('b', null, `${((r.wins / r.entries) * 100).toFixed(1)}%`)),
          h('td', null, `${r.wins} / ${r.entries}`),
          h('td', null, (r.placeSum / r.entries).toFixed(1)),
          h('td', null, `${((r.itm / r.entries) * 100).toFixed(0)}%`))))))),
    actions: [{ label: 'Close' }, { label: 'Run again', primary: true, onClick: () => { setTimeout(() => runSeriesModal(setup, count), 200); } }],
  });
}

export function goSetup(mode) { navigate(`/${mode}`); }
