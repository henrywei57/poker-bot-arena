// The live table: table view, controls, action bar, log, standings, and for
// online games the invite link, seat management and chat.

import { h, icon, btn, segmented, toggle, select, confirmDialog, copyText, toast } from '../dom.js';
import { TableView } from '../table-view.js';
import { ActionBar } from '../action-bar.js';
import { app, navigate, stopActive } from '../app.js';
import { showResults, standingsTable } from '../results.js';
import { botOptions } from './setup.js';
import { formatChips } from '../../util.js';
import { SPEEDS } from '../../sim/session.js';

function localSource(session, host) {
  const viewerId = host ? host.viewerId : session.cfg.viewerId;
  const opts = host ? { ownerOf: (pid) => host.ownerOf(pid) } : {};
  return {
    kind: host ? 'host' : 'local', session, host, viewerId,
    snapshot: () => session.snapshot(viewerId, opts),
    logs: () => session.log,
    subscribe: (fn) => session.onUpdate(fn),
    act: (intent) => {
      const owner = host ? host.humanSeatId : viewerId;
      return session.act(owner, intent);
    },
  };
}

function guestSource(guest) {
  return {
    kind: 'guest', guest,
    get viewerId() { return guest.playerId; },
    snapshot: () => guest.snap,
    logs: () => guest.log,
    subscribe: (fn) => guest.onUpdate(fn),
    act: (intent) => guest.act(intent),
  };
}

export function renderTable(main) {
  if (!app.session && !app.guest) { navigate('/'); return null; }
  const src = app.guest ? guestSource(app.guest) : localSource(app.session, app.host);
  const session = src.session;
  const host = src.host;
  const guest = src.guest;
  const meta = app.meta || {};
  const mode = session ? session.mode : 'online';
  const online = mode === 'online';
  const cleanups = [];

  // ---------------------------------------------------------- top bar
  const titleEl = h('h1', null, meta.title || (guest ? 'Online table' : 'Table'));
  const subEl = h('div', { class: 'ts-sub' });
  const controls = h('div', { class: 'ts-controls' });
  const top = h('div', { class: 'ts-top' }, h('div', { class: 'ts-title' }, titleEl, subEl), controls);

  let pauseBtn, stepBtn, speedSeg, revealToggle, tableSel;
  if (session && !online) {
    pauseBtn = btn('', { icon: 'pause', aria: 'Pause (Space)', title: 'Pause / resume (Space)', onClick: () => (session.paused ? session.resume() : session.pause()) });
    stepBtn = btn('', { icon: 'step', aria: 'Step', title: 'Next action (→ while paused)', onClick: () => session.step() });
    speedSeg = segmented(SPEEDS.map((s) => ({ value: s, label: s === 'instant' ? '⚡' : `${s}×`, title: s === 'instant' ? 'Instant' : `${s}× speed` })), session.speed, (v) => {
      if (v === 'instant' && session.hasHumans) { toast('Instant is only for bot-only tables', 'bad'); speedSeg.setValue(session.speed); return; }
      session.setSpeed(v);
    }, { small: true });
    controls.append(pauseBtn, stepBtn, speedSeg);
    if (mode !== 'play') {
      revealToggle = btn('', { icon: session.revealAll ? 'eye' : 'eyeOff', aria: 'Show all cards', title: 'Show every player’s cards', onClick: () => {
        session.setRevealAll(!session.revealAll);
        revealToggle.replaceChildren(icon(session.revealAll ? 'eye' : 'eyeOff', 17));
        revealToggle.classList.toggle('on', session.revealAll);
      } });
      revealToggle.classList.toggle('on', session.revealAll);
      controls.append(revealToggle);
    }
    if (session.tour && !session.hasHumans) {
      tableSel = h('select', { class: 'sm', 'aria-label': 'Watch table', onChange: () => session.watchTable(Number(tableSel.value)) });
      controls.append(tableSel);
    }
    controls.append(btn('', { icon: 'chart', aria: 'Results', title: 'Results so far', onClick: () => showResults(session, meta) }));
  }
  controls.append(btn(guest ? 'Leave' : 'End', { icon: 'stop', kind: 'danger-ghost', small: true, onClick: async () => {
    const live = session ? session.running : guest?.status === 'connected';
    if (live && !(await confirmDialog(online ? 'This closes the table for everyone at it.' : 'End this game?', { title: guest ? 'Leave the table?' : 'End the game?', ok: guest ? 'Leave' : 'End', danger: true }))) return;
    const back = meta.mode && meta.mode !== 'online' ? `/${meta.mode}` : online ? '/online' : '/';
    stopActive();
    navigate(back);
  } }));

  // ------------------------------------------------------------ table
  const tableHost = h('div', { class: 'ts-table' });
  const under = h('div', { class: 'ts-under' });
  const progress = h('div', { class: 'progress slim' }, h('i'));
  const waitEl = h('div', { class: 'ts-wait' });
  const actionHost = h('div', { class: 'ts-action' });
  under.append(actionHost, waitEl, progress);
  const tv = new TableView(tableHost, { emptyLabel: online ? 'Open seat' : 'Empty' });
  const bar = new ActionBar(actionHost, (intent) => { src.act(intent); schedule(); });
  cleanups.push(() => tv.destroy(), () => bar.destroy());

  // ------------------------------------------------------------- side
  const tabs = [];
  const sideHead = h('div', { class: 'tabs', role: 'tablist' });
  const sideBody = h('div', { class: 'side-body' });
  const side = h('aside', { class: 'ts-side' }, sideHead, sideBody);
  const addTab = (id, label, el) => {
    const b = h('button', { type: 'button', role: 'tab', class: 'tab', onClick: () => showTab(id) }, label);
    tabs.push({ id, b, el });
    sideHead.append(b);
    sideBody.append(el);
  };
  const showTab = (id) => {
    for (const t of tabs) {
      const on = t.id === id;
      t.b.classList.toggle('on', on);
      t.b.setAttribute('aria-selected', on ? 'true' : 'false');
      t.el.hidden = !on;
    }
    if (id === 'standings') drawStandings(true);
    if (id === 'chat') { chatUnread = 0; chatBadge(); }
  };

  const logEl = h('div', { class: 'log', 'aria-live': 'off' });
  addTab('log', 'Hand log', logEl);
  const standEl = h('div', { class: 'standings' });
  addTab('standings', online ? 'Players' : 'Standings', standEl);

  let chatEl = null, chatList = null, chatUnread = 0, chatTab = null;
  const chatBadge = () => { if (chatTab) chatTab.b.dataset.badge = chatUnread ? String(chatUnread) : ''; };
  if (online) {
    chatList = h('div', { class: 'chat-list' });
    const input = h('input', { type: 'text', maxlength: 200, placeholder: 'Say something…', 'aria-label': 'Chat message' });
    const send = () => {
      const text = input.value.trim();
      if (!text) return;
      (host || guest).sendChat(text);
      input.value = '';
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    chatEl = h('div', { class: 'chat' }, chatList, h('div', { class: 'chat-input' }, input, btn('', { icon: 'send', aria: 'Send', onClick: send })));
    addTab('chat', 'Chat', chatEl);
    chatTab = tabs[tabs.length - 1];
    const src2 = host || guest;
    let shown = 0;
    const drawChat = () => {
      const msgs = src2.chatLog;
      for (; shown < msgs.length; shown++) {
        const m = msgs[shown];
        chatList.append(h('div', { class: `chat-msg ${m.system ? 'system' : ''}` }, m.system ? null : h('b', null, m.from), m.text));
        if (!m.system && chatEl.hidden) chatUnread++;
      }
      chatBadge();
      chatList.scrollTop = chatList.scrollHeight;
    };
    cleanups.push(src2.onChat(drawChat));
    drawChat();
  }

  // Online host: invite + seats
  let seatsEl = null, inviteEl = null, startBtn = null;
  if (host) {
    const linkInput = h('input', { type: 'text', readonly: true, value: host.link || 'Opening…', 'aria-label': 'Invite link', onFocus: (e) => e.target.select() });
    startBtn = btn('Start game', { icon: 'play', kind: 'primary', onClick: () => { if (!host.start()) toast('Need at least two players with chips', 'bad'); } });
    inviteEl = h('div', { class: 'invite' },
      h('div', { class: 'invite-head' }, icon('link'), h('b', null, 'Invite friends'), h('span', { class: 'status-dot' })),
      h('p', { class: 'muted small' }, 'Anyone with this link can join from their own browser, as themselves or with a bot.'),
      h('div', { class: 'invite-row' }, linkInput, btn('Copy', { icon: 'copy', small: true, onClick: () => copyText(host.link) })),
      startBtn);
    seatsEl = h('div', { class: 'seats-admin' });
    addTab('seats', 'Seats', seatsEl);
    const drawStatus = () => {
      linkInput.value = host.link || host.statusText || 'Opening…';
      inviteEl.querySelector('.status-dot').className = `status-dot ${host.state}`;
      inviteEl.querySelector('.status-dot').title = host.statusText;
      startBtn.hidden = host.started;
    };
    cleanups.push(host.onStatus(drawStatus));
    drawStatus();
  }

  const body = h('div', { class: 'ts-body' }, h('div', { class: 'ts-main' }, tableHost, under), side);
  main.append(h('section', { class: 'table-screen' }, top, inviteEl, body));
  showTab(online && guest ? 'log' : 'log');

  // ----------------------------------------------------------- render
  let lastLogId = 0;
  const drawLog = () => {
    const entries = src.logs() || [];
    const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
    let added = 0;
    for (const e of entries) {
      if (e.id <= lastLogId) continue;
      lastLogId = e.id;
      logEl.append(h('div', { class: `log-line ${e.kind}` }, e.text));
      added++;
    }
    while (logEl.childElementCount > 400) logEl.firstChild.remove();
    if (added && atBottom) logEl.scrollTop = logEl.scrollHeight;
  };

  let lastStand = 0;
  const drawStandings = (force = false) => {
    if (standEl.hidden && !force) return;
    const now = performance.now();
    if (!force && now - lastStand < 500) return;
    lastStand = now;
    if (session) standEl.replaceChildren(standingsTable(session.results(), { tournament: !!session.tour, compact: true }));
    else if (guest?.snap) {
      const rows = guest.snap.seats.filter(Boolean).map((s) => ({ ...s, net: 0 })).sort((a, b) => b.stack - a.stack);
      standEl.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'data compact' },
        h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Player'), h('th', null, 'Stack'))),
        h('tbody', null, rows.map((r, i) => h('tr', null, h('td', { class: 'place' }, String(i + 1)),
          h('td', null, h('span', { class: 'who', style: { '--seat-color': r.color } }, h('span', { class: 'avatar xs' }, r.avatar), h('span', { class: 'who-name' }, r.name + (r.you ? ' (you)' : '')))),
          h('td', null, formatChips(r.stack))))))));
    }
  };

  const drawSeats = () => {
    if (!seatsEl) return;
    const snap = session.snapshot(host.viewerId);
    const rows = snap.seats.map((s, i) => {
      if (!s) {
        let choice = 'builtin:shark';
        const sel = select(botOptions(false), choice, (v) => { choice = v; }, { class: 'sm', 'aria-label': `Bot for seat ${i + 1}` });
        return h('div', { class: 'admin-row empty' }, h('span', { class: 'seat-num' }, String(i + 1)), sel,
          btn('Add bot', { icon: 'plus', small: true, onClick: () => { try { host.addBot(choice, i); } catch (e) { toast(e.message, 'bad'); } } }));
      }
      const kind = host.kindOf(s.id);
      return h('div', { class: 'admin-row', style: { '--seat-color': s.color } },
        h('span', { class: 'seat-num' }, String(i + 1)),
        h('span', { class: 'avatar xs' }, s.avatar),
        h('div', { class: 'admin-name' }, h('b', null, s.name), h('small', null, `${kind}${s.away ? ' · disconnected' : ''} · ${formatChips(s.stack)}`)),
        s.id === host.humanSeatId || host.ownerOf(s.id) === host.viewerId ? h('span', { class: 'muted small' }, 'host')
          : btn('', { icon: 'x', small: true, kind: 'ghost', aria: `Remove ${s.name}`, title: 'Remove after this hand', onClick: () => host.kick(s.id) }));
    });
    seatsEl.replaceChildren(h('p', { class: 'muted small' }, 'Changes apply between hands.'), ...rows);
  };

  let raf = 0, finishedShown = false, lastSeatsDraw = 0;
  const draw = () => {
    const snap = src.snapshot();
    if (!snap) {
      waitEl.textContent = guest ? guest.statusText : 'Loading…';
      waitEl.hidden = false;
      return;
    }
    const speed = session ? session.speed : guest?.speed ?? 1;
    tv.render(snap, { speed, showEmpty: online });
    // Sub-title chips
    const bits = [];
    if (snap.handNumber) bits.push(`Hand #${snap.handNumber}`);
    if (session?.cfg.handLimit) bits.push(`${Math.min(session.handsPlayed, session.cfg.handLimit)} / ${session.cfg.handLimit} played`);
    bits.push(`Blinds ${formatChips(snap.blinds.sb)}/${formatChips(snap.blinds.bb)}${snap.blinds.ante ? ` · ante ${formatChips(snap.blinds.ante)}` : ''}`);
    if (snap.tournament) {
      bits.push(`Level ${snap.tournament.level}`, `${snap.tournament.playersLeft} of ${snap.tournament.entrants} left`);
      if (snap.tournament.tables > 1) bits.push(`Table ${snap.tableId} of ${snap.tournament.tables}`);
    }
    if (session?.paused) bits.push('Paused');
    if (session?.finished) bits.push('Finished');
    subEl.replaceChildren(...bits.map((b) => h('span', { class: `pill ${b === 'Paused' ? 'warn' : b === 'Finished' ? 'good' : ''}` }, b)));
    if (pauseBtn) {
      pauseBtn.replaceChildren(icon(session.paused ? 'play' : 'pause', 17));
      pauseBtn.classList.toggle('on', session.paused);
      stepBtn.disabled = !session.paused;
      speedSeg.setValue(session.speed);
    }
    if (tableSel) {
      const ids = session.tour.tables.map((t) => t.id);
      const key = ids.join(',');
      if (tableSel.dataset.key !== key) {
        tableSel.dataset.key = key;
        tableSel.replaceChildren(...ids.map((id) => h('option', { value: id }, `Table ${id}`)));
      }
      tableSel.value = String(session.table.id);
      tableSel.hidden = ids.length < 2;
    }
    // Action bar
    if (snap.prompt) bar.show(snap.prompt); else bar.hide();
    // Waiting / progress
    let wait = '';
    if (guest && guest.status !== 'connected') wait = guest.statusText;
    else if (host && !host.started) wait = 'Share the invite link, add bots to open seats, then press Start game.';
    else if (snap.status) wait = snap.status;
    else if (!snap.prompt && snap.toAct >= 0 && snap.seats[snap.toAct]?.kind !== 'bot' && online) wait = `Waiting for ${snap.seats[snap.toAct].name}…`;
    waitEl.textContent = wait;
    waitEl.hidden = !wait || !!snap.prompt;
    const limit = session?.cfg.handLimit;
    progress.hidden = !limit;
    if (limit) progress.firstChild.style.width = `${Math.min(100, (session.handsPlayed / limit) * 100)}%`;
    drawLog();
    drawStandings();
    if (seatsEl && performance.now() - lastSeatsDraw > 700) { lastSeatsDraw = performance.now(); drawSeats(); }
    if (session && session.finished && !finishedShown && mode !== 'online') {
      finishedShown = true;
      setTimeout(() => showResults(session, meta), 350);
    }
  };
  // rAF for smooth updates, with a timer fallback: rAF pauses in hidden tabs
  // and some embedded browsers, and the table must still update.
  let fallback = 0;
  const run = () => { cancelAnimationFrame(raf); clearTimeout(fallback); raf = 0; fallback = 0; draw(); };
  const schedule = () => {
    if (raf || fallback) return;
    raf = requestAnimationFrame(run);
    fallback = setTimeout(run, 80);
  };
  cleanups.push(src.subscribe(schedule));
  if (seatsEl) cleanups.push(host.onStatus(() => { lastSeatsDraw = 0; schedule(); }));
  draw();

  // Keyboard: space pauses, right arrow steps.
  const onKey = (e) => {
    if (!session || online) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.key === ' ' && !e.repeat) { e.preventDefault(); session.paused ? session.resume() : session.pause(); }
    else if (e.key === 'ArrowRight' && session.paused) { e.preventDefault(); session.step(); }
  };
  document.addEventListener('keydown', onKey);
  cleanups.push(() => document.removeEventListener('keydown', onKey));

  // Leaving the screen pauses local games (online tables keep going).
  if (session && !online && app.resumeOnReturn) { session.resume(); app.resumeOnReturn = false; }
  return () => {
    if (raf) cancelAnimationFrame(raf);
    clearTimeout(fallback);
    cleanups.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
    if (session && !online && session.running && !session.paused && app.session === session) {
      session.pause();
      app.resumeOnReturn = true;
    }
  };
}
