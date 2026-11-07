// Bot Lab: write, check, test and share Kicker bots.

import { h, icon, btn, segmented, modal, confirmDialog, copyText, toast, fill } from '../dom.js';
import { CodeEditor, highlightHTML } from '../editor.js';
import { cardEl } from '../cards.js';
import { lineChart } from '../chart.js';
import { standingsTable } from '../results.js';
import { navigate } from '../app.js';
import { compile } from '../../lang/interpreter.js';
import { GROUPS, VARIABLES, FUNCTIONS } from '../../lang/builtins.js';
import { toText } from '../../lang/interpreter.js';
import { builtinBots, myBots, getBot, saveBot, deleteBot, newBotCode, shareLink, makeAgent } from '../../bots/store.js';
import { KickerAgent } from '../../bots/agent.js';
import { PERSONALITIES } from '../../bots/personalities.js';
import { Table } from '../../engine/table.js';
import { buildView } from '../../engine/view.js';
import { resolveIntent, describeAction } from '../../engine/actions.js';
import { playHandSync } from '../../sim/headless.js';
import { StatsTracker } from '../../sim/stats.js';
import { formatChips, makeRng, randomSeed } from '../../util.js';

let dirtyGuard = null;
/** Text with `backtick` spans shown as inline code. */
const rich = (text) => String(text).split('`').map((part, i) => (i % 2 ? h('code', null, part) : part));
window.addEventListener('beforeunload', (e) => { if (dirtyGuard && dirtyGuard()) { e.preventDefault(); e.returnValue = ''; } });

/** Called by the router before leaving the lab. Resolves false to stay. */
export async function confirmLeaveLab() {
  if (!dirtyGuard || !dirtyGuard()) return true;
  return confirmDialog('You have unsaved changes to this bot. Leave without saving?', { title: 'Unsaved changes', ok: 'Discard changes', danger: true });
}

export function renderLab(main, param) {
  const cleanups = [];
  let current = null; // { ref, builtin, savedCode }
  let compiled = null;

  // ------------------------------------------------------------ sidebar
  const side = h('aside', { class: 'lab-side' });
  const drawSide = () => {
    const mine = myBots();
    side.replaceChildren(
      h('div', { class: 'row-between' }, h('h3', null, 'My bots'), btn('New', { icon: 'plus', small: true, kind: 'primary', onClick: () => open('new') })),
      mine.length ? h('div', { class: 'bot-list' }, mine.map(item)) : h('p', { class: 'muted small' }, 'No bots yet. Press New, or duplicate a built-in one.'),
      h('label', { class: 'btn sm ghost import-btn' }, icon('upload', 15), h('span', null, 'Import .kick file'),
        h('input', { type: 'file', accept: '.kick,.txt,text/plain', hidden: true, onChange: (e) => importFile(e.target) })),
      h('a', { href: '#/tutorial', class: 'btn sm ghost import-btn' }, icon('play', 15), h('span', null, 'Video tutorial')),
      h('h3', null, 'Built-in'),
      h('div', { class: 'bot-list' }, builtinBots().map(item)));
  };
  const item = (b) => h('button', {
    type: 'button', class: `bot-item ${current?.ref === b.ref ? 'on' : ''}`, style: { '--seat-color': b.color },
    onClick: () => open(b.ref),
  }, h('span', { class: 'avatar sm' }, b.avatar), h('span', { class: 'bot-item-name' }, h('b', null, b.name), h('small', null, b.ok ? (b.desc || (b.builtin ? 'Built-in' : 'My bot')).slice(0, 60) : '⚠ has errors')));

  // ------------------------------------------------------------- editor
  const nameEl = h('div', { class: 'lab-name' });
  const statusEl = h('span', { class: 'pill' });
  const saveBtn = btn('Save', { icon: 'save', kind: 'primary', small: true, title: 'Save (Ctrl+S)', onClick: () => save() });
  const dupBtn = btn('Duplicate', { icon: 'copy', small: true, onClick: () => duplicate() });
  const shareBtn = btn('Share', { icon: 'share', small: true, onClick: () => share() });
  const dlBtn = btn('', { icon: 'download', small: true, aria: 'Download .kick file', title: 'Download .kick file', onClick: () => download() });
  const delBtn = btn('', { icon: 'trash', small: true, kind: 'danger-ghost', aria: 'Delete bot', title: 'Delete bot', onClick: () => remove() });
  const toolbar = h('div', { class: 'lab-toolbar' }, nameEl, statusEl, h('div', { class: 'spacer' }), saveBtn, dupBtn, shareBtn, dlBtn, delBtn);
  const banner = h('div', { class: 'lab-banner' });
  const editorHost = h('div', { class: 'lab-editor' });
  const problems = h('div', { class: 'problems' });
  const editor = new CodeEditor(editorHost, { onChange: () => onEdit(), onSave: () => save() });
  const center = h('div', { class: 'lab-main' }, toolbar, banner, editorHost, problems);

  // -------------------------------------------------------------- panel
  const panelTabs = h('div', { class: 'tabs', role: 'tablist' });
  const panelBody = h('div', { class: 'side-body' });
  const panel = h('aside', { class: 'lab-panel' }, panelTabs, panelBody);
  const tabs = [];
  const addTab = (id, label, el) => {
    const b = h('button', { type: 'button', role: 'tab', class: 'tab', onClick: () => showTab(id) }, label);
    tabs.push({ id, b, el }); panelTabs.append(b); panelBody.append(el);
  };
  const showTab = (id) => tabs.forEach((t) => { t.b.classList.toggle('on', t.id === id); t.b.setAttribute('aria-selected', String(t.id === id)); t.el.hidden = t.id !== id; });
  const testEl = testPanel();
  addTab('test', 'Test', testEl);
  addTab('spot', 'Try a spot', spotPanel());
  addTab('ref', 'Reference', referencePanel());
  showTab('test');

  main.append(h('section', { class: 'lab' }, side, center, panel));

  // ------------------------------------------------------------- logic
  let compileT = null;
  function onEdit() {
    clearTimeout(compileT);
    compileT = setTimeout(recompile, 140);
    markDirty();
  }
  const isDirty = () => !!current && !current.builtin && editor.value !== current.savedCode;
  dirtyGuard = isDirty;
  cleanups.push(() => { dirtyGuard = null; });
  function markDirty() { saveBtn.classList.toggle('pulse', isDirty()); }

  function recompile() {
    compiled = compile(editor.value);
    editor.setErrors(compiled.errors);
    const m = compiled.meta;
    nameEl.replaceChildren(h('span', { class: 'avatar sm', style: { '--seat-color': m.color || '#4c8dff' } }, m.avatar || '🤖'), h('b', null, m.name || 'Untitled bot'));
    if (compiled.ok) { statusEl.className = 'pill good'; statusEl.textContent = '✓ Ready to play'; }
    else { statusEl.className = 'pill bad'; statusEl.textContent = `${compiled.errors.length} problem${compiled.errors.length === 1 ? '' : 's'}`; }
    problems.replaceChildren(...compiled.errors.map((e) => h('button', { type: 'button', class: 'problem', onClick: () => editor.goToLine(e.line) },
      h('span', { class: 'problem-loc' }, `Line ${e.line}`), h('span', null, e.message, e.hint ? h('small', null, e.hint) : null))));
  }

  async function open(ref) {
    if (current && ref === current.ref) return;
    if (isDirty() && !(await confirmDialog('Discard your unsaved changes to this bot?', { title: 'Unsaved changes', ok: 'Discard', danger: true }))) return;
    if (ref === 'new') {
      const code = newBotCode();
      const newRef = saveBot(code);
      toast('New bot created', 'good');
      ref = newRef;
    }
    const b = getBot(ref) || getBot(myBots()[0]?.ref) || getBot('builtin:shark');
    current = { ref: b.ref, builtin: b.builtin, savedCode: b.code };
    editor.value = b.code;
    editor.setReadOnly(b.builtin);
    banner.replaceChildren(...(b.builtin ? [icon('book', 16), h('span', null, 'Built-in bots are read-only. '), h('button', { type: 'button', class: 'link', onClick: () => duplicate() }, 'Duplicate it'), h('span', null, ' to make your own version.')] : []));
    banner.hidden = !b.builtin;
    saveBtn.hidden = b.builtin;
    delBtn.hidden = b.builtin;
    history.replaceState(null, '', `#/lab/${b.ref}`);
    recompile();
    markDirty();
    drawSide();
    testEl.refresh();
  }

  function save() {
    if (!current || current.builtin) return;
    try {
      saveBot(editor.value, current.ref.split(':')[1]);
      current.savedCode = editor.value;
      markDirty();
      drawSide();
      toast(compiled?.ok ? 'Saved' : 'Saved (fix the problems before it can play)', compiled?.ok ? 'good' : 'warn');
    } catch (e) { toast(e.message, 'bad'); }
  }

  function renameInCode(code, suffix) {
    return /^\s*bot\s+"([^"]*)"/m.test(code) ? code.replace(/^(\s*bot\s+")([^"]*)(")/m, (_, a, n, c) => `${a}${(n + suffix).slice(0, 24)}${c}`) : `bot "My copy"\n${code}`;
  }

  async function duplicate() {
    const ref = saveBot(renameInCode(editor.value, ' copy'));
    current = null;
    toast('Copied to My bots', 'good');
    await open(ref);
  }

  async function remove() {
    if (!current || current.builtin) return;
    if (!(await confirmDialog(`Delete “${compiled?.meta?.name || 'this bot'}”? This can’t be undone.`, { title: 'Delete bot', ok: 'Delete', danger: true }))) return;
    deleteBot(current.ref.split(':')[1]);
    current = null;
    const next = myBots()[0]?.ref || 'builtin:shark';
    await open(next);
  }

  function share() {
    if (!compiled?.ok) { toast('Fix the problems first so the bot can play', 'bad'); return; }
    const link = shareLink(editor.value);
    const input = h('input', { type: 'text', readonly: true, value: link, onFocus: (e) => e.target.select() });
    modal({
      title: 'Share this bot', body: h('div', null,
        h('p', { class: 'muted' }, 'Anyone who opens this link can add the bot to their own Bot Lab. The code is inside the link itself: nothing is uploaded.'),
        h('div', { class: 'invite-row' }, input, btn('Copy', { icon: 'copy', small: true, onClick: () => copyText(link) }))),
      actions: [{ label: 'Done', primary: true }],
    });
  }

  function download() {
    const name = (compiled?.meta?.name || 'bot').replace(/[^\w-]+/g, '-').toLowerCase();
    const a = h('a', { href: URL.createObjectURL(new Blob([editor.value], { type: 'text/plain' })), download: `${name}.kick` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function importFile(input) {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    if (f.size > 200000) { toast('That file is too big to be a bot', 'bad'); return; }
    f.text().then(async (text) => { const ref = saveBot(text); current = null; toast('Imported', 'good'); await open(ref); });
  }

  // ------------------------------------------------------------- test tab
  function testPanel() {
    const root = h('div', { class: 'lab-test' });
    const picked = new Set(['builtin:shark', 'builtin:rock', 'builtin:maniac', 'builtin:station', 'builtin:math']);
    let hands = 1000;
    const chips = h('div', { class: 'chip-list' });
    const drawChips = () => {
      const all = [...builtinBots(), ...myBots().filter((b) => b.ok && b.ref !== current?.ref)];
      chips.replaceChildren(...all.map((b) => h('button', {
        type: 'button', class: `chip toggle-chip ${picked.has(b.ref) ? 'on' : ''}`, style: { '--seat-color': b.color }, 'aria-pressed': String(picked.has(b.ref)),
        onClick: () => { if (picked.has(b.ref)) picked.delete(b.ref); else if (picked.size < 8) picked.add(b.ref); else toast('Up to 8 opponents', 'bad'); drawChips(); },
      }, `${b.avatar} ${b.name}`)));
    };
    const out = h('div', { class: 'test-out' });
    const bar = h('div', { class: 'progress' }, h('i'));
    bar.hidden = true;
    let running = null;
    const runBtn = btn('Run test', { icon: 'flask', kind: 'primary', onClick: async () => {
      if (running) { running.cancel = true; return; }
      if (!compiled?.ok) { toast('Fix the problems first', 'bad'); return; }
      if (!picked.size) { toast('Pick at least one opponent', 'bad'); return; }
      running = { cancel: false };
      runBtn.querySelector('span').textContent = 'Stop';
      bar.hidden = false;
      out.replaceChildren();
      try { await runTest(editor.value, [...picked], hands, running, (f) => { bar.firstChild.style.width = `${f * 100}%`; }, out); }
      catch (e) { toast(e.message, 'bad'); }
      running = null;
      runBtn.querySelector('span').textContent = 'Run test';
      bar.hidden = true;
    } });
    root.append(
      h('p', { class: 'muted small' }, 'Plays your current code (saved or not) against the opponents you pick, instantly, with rebuys. More hands = more reliable.'),
      h('h4', null, 'Opponents'), chips,
      h('h4', null, 'Hands'), segmented([200, 1000, 5000].map((v) => ({ value: v, label: v.toLocaleString() })), hands, (v) => { hands = v; }),
      h('div', { class: 'row-wrap' }, runBtn), bar, out);
    root.refresh = drawChips;
    drawChips();
    return root;
  }

  async function runTest(code, opponents, hands, ctl, onProgress, out) {
    const seed = randomSeed();
    const table = new Table({ maxSeats: opponents.length + 1, smallBlind: 10, bigBlind: 20, rng: makeRng(`${seed}:deck`) });
    const agents = new Map();
    const meta = compile(code).meta;
    const players = [{ id: 'me', name: meta.name || 'Your bot', avatar: meta.avatar || '🤖', color: meta.color || '#4c8dff', agent: new KickerAgent(code, { seed: `${seed}:me`, iterations: 150 }) }];
    const counts = {};
    opponents.forEach((ref, i) => {
      const b = getBot(ref);
      counts[b.name] = (counts[b.name] || 0) + 1;
      players.push({ id: `${ref}#${i}`, name: counts[b.name] > 1 ? `${b.name} ${counts[b.name]}` : b.name, avatar: b.avatar, color: b.color, agent: makeAgent(ref, `${seed}:${i}`, 150) });
    });
    players.forEach((p, i) => { p.stack = 2000; table.sit(i, p); agents.set(p.id, p.agent); });
    const stats = new StatsTracker();
    const errors = new Map();
    let last = performance.now();
    for (let n = 1; n <= hands && !ctl.cancel; n++) {
      for (const p of players) if (p.stack === 0) { p.stack = 2000; stats.entry(p.id, p.name).buyIns = (stats.entry(p.id).buyIns || 1) + 1; }
      playHandSync(table, (id) => agents.get(id), { stats, onDecision: (p, d) => { if (d.error && p.id === 'me') errors.set(`${d.error.line}: ${d.error.message}`, d.error); } });
      stats.sample(n, players.map((p) => p.id));
      if (performance.now() - last > 35) { onProgress(n / hands); await new Promise((r) => setTimeout(r, 0)); last = performance.now(); }
    }
    const played = stats.get('me')?.hands || 0;
    const rows = players.map((p) => {
      const s = stats.get(p.id) || stats.entry(p.id, p.name);
      return { id: p.id, name: p.name, avatar: p.avatar, color: p.color, stack: p.stack, net: s.net, hands: s.hands,
        bb100: s.hands ? (s.net / 20 / s.hands) * 100 : 0, vpip: s.vpip, pfr: s.pfr, af: s.af, handsWon: s.handsWon,
        showdowns: s.showdowns, showdownsWon: s.showdownsWon, buyIns: s.buyIns || 1, history: s.history };
    }).sort((a, b) => b.net - a.net);
    const me = rows.find((r) => r.id === 'me');
    const rank = rows.indexOf(me) + 1;
    fill(out,
      h('div', { class: `verdict ${me.bb100 >= 0 ? 'good' : 'bad'}` },
        h('b', null, `${me.bb100 >= 0 ? '+' : ''}${me.bb100.toFixed(1)} BB/100`),
        h('span', null, ` · ranked ${rank} of ${rows.length} over ${played.toLocaleString()} hands`)),
      errors.size ? h('div', { class: 'test-errors' }, h('b', null, '⚠ Runtime errors (your bot check-folded when these happened):'),
        [...errors.values()].slice(0, 5).map((e) => h('button', { type: 'button', class: 'problem', onClick: () => editor.goToLine(e.line) }, h('span', { class: 'problem-loc' }, `Line ${e.line}`), e.message))) : null,
      standingsTable(rows),
      lineChart(rows.map((r) => ({ name: r.name, color: r.color, points: r.history })), { height: 200 }));
  }

  // ------------------------------------------------------------- spot tab
  function spotPanel() {
    const root = h('div', { class: 'lab-spot' });
    let street = 'any';
    const out = h('div', { class: 'spot-out' });
    root.append(
      h('p', { class: 'muted small' }, 'Deals a random hand, lets the table play until it is your bot’s turn, then shows what your bot sees and what it decides.'),
      h('div', { class: 'row-wrap' },
        segmented(['any', 'preflop', 'flop', 'turn', 'river'].map((v) => ({ value: v, label: v === 'any' ? 'Any street' : v[0].toUpperCase() + v.slice(1) })), street, (v) => { street = v; }, { small: true }),
        btn('Deal a spot', { icon: 'dice', kind: 'primary', onClick: () => {
          if (!compiled?.ok) { toast('Fix the problems first', 'bad'); return; }
          try { showSpot(editor.value, street, out); } catch (e) { toast(e.message, 'bad'); console.error(e); }
        } })),
      out);
    return root;
  }

  function showSpot(code, wantStreet, out) {
    const streets = ['preflop', 'flop', 'turn', 'river'];
    for (let attempt = 0; attempt < 200; attempt++) {
      const seed = randomSeed();
      const rng = makeRng(seed);
      const target = wantStreet === 'any' ? streets[Math.floor(rng() * 4)] : wantStreet;
      const n = 2 + Math.floor(rng() * 5);
      const table = new Table({ maxSeats: n, smallBlind: 10, bigBlind: 20, rng: makeRng(`${seed}:d`) });
      const agents = new Map();
      const me = new KickerAgent(code, { seed: `${seed}:me`, iterations: 300 });
      for (let i = 0; i < n; i++) {
        const id = i === 0 ? 'me' : `o${i}`;
        const p = PERSONALITIES[(1 + Math.floor(rng() * PERSONALITIES.length)) % PERSONALITIES.length];
        table.sit(i, { id, name: i === 0 ? (compile(code).meta.name || 'Your bot') : p.id, stack: 400 + Math.floor(rng() * 4000) });
        agents.set(id, i === 0 ? me : new KickerAgent(p.code, { seed: `${seed}:${i}`, iterations: 80 }));
      }
      // Rotate the button so the bot is in a random position.
      table.button = Math.floor(rng() * n);
      const hand = table.startHand();
      let guard = 0;
      while (!hand.done && guard++ < 500) {
        if (hand.phase === 'roundEnd') { hand.advance(); continue; }
        const p = hand.actor;
        const view = buildView(hand, hand.toAct, {});
        if (p.id === 'me' && hand.street === target) {
          renderSpot(view, me, out, table.seats.map((s) => s));
          return;
        }
        const d = agents.get(p.id).decide(view);
        hand.act(d.type, d.amount);
      }
    }
    out.replaceChildren(h('p', { class: 'muted' }, 'Your bot never reached that street in 200 tries. It probably folds before then: try another street.'));
  }

  function renderSpot(view, agent, out) {
    const r = agent.bot.decide(view);
    const action = resolveIntent(r.intent, view.legal);
    const L = view.legal;
    const ctx = r.ctx;
    const val = (name) => { try { return toText(ctx.get(name)); } catch { return '—'; } };
    const pos = view.idx === view.buttonIdx ? 'Button' : view.idx === view.sbIdx ? 'Small blind' : view.idx === view.bbIdx ? 'Big blind' : `${val('position')} (0 = first, 1 = button)`;
    const actionText = action.type === 'raise' ? `${L.currentBet === 0 ? 'Bet' : 'Raise to'} ${formatChips(action.amount)}${action.amount === L.maxRaiseTo ? ' (all-in)' : ''}` : action.type[0].toUpperCase() + action.type.slice(1) + (action.type === 'call' ? ` ${formatChips(L.toCall)}` : '');
    const key = ['street', 'hand', 'top_pct', 'made', 'hit', 'draw', 'equity', 'strength', 'pot', 'to_call', 'pot_odds', 'stack_bb', 'opponents', 'behind', 'raises', 'in_position'];
    const allVars = Object.keys(VARIABLES);
    const details = h('details', { class: 'all-values' }, h('summary', null, `All ${allVars.length} built-in values for this spot`),
      h('div', { class: 'kv-grid' }, allVars.map((k) => [h('code', null, k), h('span', null, val(k))])));
    fill(out,
      h('div', { class: 'spot-cards' },
        h('div', null, h('small', null, 'Your cards'), h('div', { class: 'card-row' }, view.hole.map((c) => cardEl(c)))),
        h('div', null, h('small', null, view.board.length ? 'Board' : 'Board (preflop)'), h('div', { class: 'card-row' }, view.board.length ? view.board.map((c) => cardEl(c)) : h('span', { class: 'muted' }, 'No cards yet')))),
      h('div', { class: 'spot-facts' },
        h('span', null, `${view.n} players · ${pos}`),
        h('span', null, `Pot ${formatChips(L.pot)} · to call ${formatChips(L.toCall)} · stack ${formatChips(L.stack)}`)),
      h('div', { class: `decision ${r.error ? 'bad' : ''}` },
        h('small', null, 'Decision'), h('b', null, actionText),
        h('span', { class: 'muted' }, r.error ? `Runtime error on line ${r.error.line}: ${r.error.message}` : r.defaulted ? 'No action reached: the default (check, or fold to a bet).' : `From line ${r.line}${intentNote(r.intent, action)}`)),
      r.said ? h('div', { class: 'said' }, '💬 ', r.said) : null,
      r.logs.length ? h('div', { class: 'logs' }, h('small', null, 'log output'), r.logs.map((l) => h('div', null, h('span', { class: 'muted' }, `line ${l.line}: `), l.text))) : null,
      h('div', { class: 'kv-grid' }, key.map((k) => [h('code', null, k), h('span', null, val(k))])),
      details);
    if (r.line) editor.flashLine(r.line, r.error ? 'bad' : 'info');
  }

  function intentNote(intent, action) {
    if (intent.type === 'raise' && action.type !== 'raise') return ` (wanted to raise, but raising isn’t allowed here, so it ${action.type}s)`;
    if (intent.type === 'fold' && action.type === 'check') return ' (fold turned into a free check)';
    if (intent.type === 'check' && action.type === 'fold') return ' (check means fold when facing a bet)';
    if (intent.type === 'call' && action.type === 'check') return ' (call is a free check when nobody has bet)';
    return '';
  }

  // -------------------------------------------------------- reference tab
  function referencePanel() {
    const root = h('div', { class: 'lab-ref' });
    const search = h('input', { type: 'search', placeholder: 'Search built-ins…', 'aria-label': 'Search built-ins' });
    const list = h('div');
    const basics = h('div', { class: 'ref-basics' }, BASICS.map(([title, text, code]) => h('div', { class: 'ref-item' },
      h('b', null, title), h('p', null, rich(text)), code ? h('pre', { class: 'code-sample sm', html: highlightHTML(code) }) : null)));
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      list.replaceChildren(...GROUPS.map((g) => {
        const vars = g.vars.filter((n) => !q || n.includes(q) || VARIABLES[n].doc.toLowerCase().includes(q));
        const fns = g.fns.filter((n) => !q || n.includes(q) || FUNCTIONS[n].doc.toLowerCase().includes(q));
        if (!vars.length && !fns.length) return null;
        return h('div', { class: 'ref-group' }, h('h4', null, g.name), q ? null : h('p', { class: 'muted small' }, g.blurb),
          vars.map((n) => { const v = VARIABLES[n]; return h('div', { class: 'ref-item' }, h('div', { class: 'ref-sig' }, h('code', { class: 'tk-var' }, n), h('span', { class: 'ref-type' }, v.type), h('span', { class: 'muted small' }, `e.g. ${v.example}`)), h('p', null, rich(v.doc))); }),
          fns.map((n) => { const fdef = FUNCTIONS[n]; return h('div', { class: 'ref-item' }, h('div', { class: 'ref-sig' }, h('code', { class: 'tk-fn' }, fdef.sig)), h('p', null, rich(fdef.doc))); }));
      }).filter(Boolean));
      basics.hidden = !!q;
    };
    search.addEventListener('input', draw);
    root.append(search, basics, list);
    draw();
    return root;
  }

  // -------------------------------------------------------------- start
  drawSide();
  const startRef = param && (param.startsWith('my:') || param.startsWith('builtin:')) ? param : (myBots()[0]?.ref || 'builtin:shark');
  open(startRef);
  return () => cleanups.forEach((fn) => fn());
}

const BASICS = [
  ['How a bot runs', 'Every time it is your turn, the program runs from top to bottom. The first action it reaches is the move. If it reaches none, it checks when that is free and folds otherwise.', null],
  ['Actions', '`fold`, `check` (check, or fold to a bet), `call` (call, or check when free), `allin`, and `raise` / `bet` with a size. Raises are kept legal for you: too small becomes the minimum, too big becomes all-in.', 'raise 3 bb      # to 3 big blinds\nraise 2.5 x     # 2.5 times the current bet\nbet 75% pot     # three-quarters pot\nbet pot\nraise to 600    # exact total\nraise min\nraise max       # same as allin'],
  ['Conditions', '`when … then …` runs one statement if the condition is true. `if / elif / else / end` runs blocks. `on` limits a block to certain streets.', 'when strength > 0.8 then raise pot\n\nif pocket_pair and stack_bb > 30 then\n  call\nelif top(10)\n  raise 3 x\nelse\n  fold\nend\n\non flop, turn\n  when draw then call\nend'],
  ['Values', 'Numbers (0.75, or 75%), text in quotes, true / false, and lists like [1, 2, 3]. Compare with == != < <= > >=, combine with and / or / not. Comparisons chain: `0.3 < equity < 0.6`.', null],
  ['Hand ranges', 'Check your starting hand against a range with `in`. Ranges: AA, TT+, 22-66, AKs, AKo, AK, ATs+, A5s-A2s, 87s-54s, Axs.', 'when hand in "TT+, AQs+, AKo" then raise 3 x\nwhen hand not in "Kx, Qx" then fold'],
  ['Variables', '`let` makes a value for this decision. `keep` makes one the bot remembers between hands (set only the first time). Change either with `name = value`.', 'let price = to_call / bb\nkeep bluffs = 0\nwhen chance(0.1) then bluffs = bluffs + 1'],
  ['Talking & debugging', '`say` shows a speech bubble at the table. `log` prints in “Try a spot”.', 'say pick("Nice hand", "Ship it!")\nlog "equity " + round(equity, 2)'],
  ['About the bot', 'Optional lines at the top give the bot a name, avatar, colour and description.', 'bot "Night Owl"\navatar "🦉"\ncolor "#7dd3fc"\ndesc "Patient, then pounces."'],
];

export function labRefSections() { return BASICS; }
