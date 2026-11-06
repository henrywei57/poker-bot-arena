// Online tables over WebRTC (PeerJS). The host's browser runs the game and
// is the only source of truth; guests send actions and receive snapshots
// that only contain their own hole cards. A guest may bring a Kicker bot
// instead of playing: its code runs in the host's interpreter, which cannot
// reach the page or network, so that is safe.
//
// Messages (JSON):
//  guest -> host: hello {clientId, name, avatar, as: 'human'|'bot'|'watch', code?}
//                 act {intent}   chat {text}
//  host -> guest: welcome {playerId, seat, hostName}   snap {snap, log[]}
//                 chat {from, text, system?}   full   closed   kicked   error {message}

import { GameSession } from '../sim/session.js';
import { KickerAgent } from '../bots/agent.js';
import { getBot, makeAgent } from '../bots/store.js';
import { compile } from '../lang/interpreter.js';
import { randomId, randomSeed } from '../util.js';

const PEERJS_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js';
const PREFIX = 'pba-';
let loading = null;

export function loadPeer() {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PEERJS_URL;
      s.async = true;
      s.onload = () => (window.Peer ? resolve(window.Peer) : reject(new Error('PeerJS failed to load')));
      s.onerror = () => { loading = null; reject(new Error('Could not load the networking library. Check your connection and try again.')); };
      document.head.append(s);
    });
  }
  return loading;
}

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const COLORS = ['#f2c14e', '#ff8fab', '#7dd3fc', '#a7f3d0', '#c4b5fd', '#fdba74', '#fca5a5', '#86efac', '#93c5fd'];

function peerErrorText(err) {
  switch (err?.type) {
    case 'peer-unavailable': return 'That table is not open (the host may have closed it, or the link is wrong).';
    case 'network': case 'socket-error': case 'socket-closed': case 'server-error': return 'Lost the connection to the matchmaking server. Check your internet and try again.';
    case 'browser-incompatible': return 'This browser does not support WebRTC.';
    case 'unavailable-id': return 'That table id is taken. Try again.';
    default: return err?.message || 'Connection error';
  }
}

export function tableIdFromInput(text) {
  const t = String(text || '').trim();
  const m = t.match(/#\/join\/([A-Za-z0-9_-]+)/) || t.match(/^(pba-[A-Za-z0-9_-]+)$/) || t.match(/^([a-z0-9]{6,})$/i);
  if (!m) return null;
  return m[1].startsWith(PREFIX) ? m[1] : PREFIX + m[1];
}

// ======================================================================
export class OnlineHost {
  /**
   * settings: { maxSeats, sb, bb, stack, turnTime, rebuy, hostAs: 'human'|'bot'|'watch', hostBotRef, bots: [refs] }
   */
  constructor(settings, profile) {
    this.settings = settings;
    this.profile = profile;
    this.id = PREFIX + randomId(10);
    this.link = '';
    this.state = 'opening';
    this.statusText = 'Opening table…';
    this.started = false;
    this.guests = new Map(); // clientId -> { conn, playerId, name, as, connected, lastLogId }
    this.chatLog = [];
    this.statusListeners = new Set();
    this.chatListeners = new Set();
    this.kinds = new Map();
    this.owner = new Map();
    this.removals = new Set();
    this.viewerId = 'host-viewer';
    this.humanSeatId = null;

    const seed = randomSeed();
    const players = [];
    let seat = 0;
    if (settings.hostAs === 'human') {
      this.humanSeatId = 'host';
      this.viewerId = 'host';
      players.push({ id: 'host', name: profile.name || 'Host', avatar: profile.avatar, color: COLORS[0], kind: 'remote', seat: seat++ });
      this.kinds.set('host', 'Host');
    } else if (settings.hostAs === 'bot') {
      const b = getBot(settings.hostBotRef);
      if (!b || !b.ok) throw new Error('Pick a working bot to play for you');
      players.push({ id: 'host-bot', name: b.name, avatar: b.avatar, color: b.color, kind: 'bot', seat: seat++, agent: makeAgent(b.ref, `${seed}:host`) });
      this.owner.set('host-bot', this.viewerId);
      this.kinds.set('host-bot', 'Host’s bot');
    }
    const counts = {};
    for (const ref of settings.bots || []) {
      if (seat >= settings.maxSeats) break;
      const b = getBot(ref);
      if (!b || !b.ok) continue;
      counts[b.name] = (counts[b.name] || 0) + 1;
      const id = `bot:${ref}:${seat}`;
      players.push({ id, name: counts[b.name] > 1 ? `${b.name} ${counts[b.name]}` : b.name, avatar: b.avatar, color: b.color, kind: 'bot', seat: seat++, agent: makeAgent(ref, `${seed}:${seat}`) });
      this.kinds.set(id, 'Bot');
    }
    this.session = new GameSession({
      mode: 'online', title: 'Online table', players, viewerId: this.viewerId,
      maxSeats: settings.maxSeats, sb: settings.sb, bb: settings.bb, startingStack: settings.stack,
      rebuy: settings.rebuy, speed: 1, turnTime: settings.turnTime, seed,
      beforeHand: () => this._applyRemovals(),
    });
    // The host's own seat is a person but acts locally: mark it 'remote' so the
    // session waits for input (with the turn timer), and route it via humanSeatId.
    this.session.onUpdate(() => this._scheduleBroadcast());
  }

  onStatus(fn) { this.statusListeners.add(fn); return () => this.statusListeners.delete(fn); }
  onChat(fn) { this.chatListeners.add(fn); return () => this.chatListeners.delete(fn); }
  _status(state, text) { this.state = state; this.statusText = text; this.statusListeners.forEach((fn) => fn(this)); }

  kindOf(id) { return this.kinds.get(id) || 'Player'; }
  ownerOf(pid) { return this.owner.get(pid) || null; }

  async open() {
    const Peer = await loadPeer();
    return new Promise((resolve, reject) => {
      const peer = new Peer(this.id, { debug: 1 });
      this.peer = peer;
      let opened = false;
      peer.on('open', (id) => {
        opened = true;
        this.id = id;
        this.link = `${location.href.split('#')[0]}#/join/${id.slice(PREFIX.length)}`;
        this._status('open', 'Table is open');
        this._system('Table opened. Share the invite link.');
        this._hb = setInterval(() => this._heartbeat(), 3000);
        this._onHide = () => this.close();
        window.addEventListener('pagehide', this._onHide);
        resolve(this);
      });
      peer.on('connection', (conn) => this._onConnection(conn));
      peer.on('disconnected', () => {
        if (this.closed) return;
        this._status('reconnecting', 'Reconnecting to the matchmaking server…');
        setTimeout(() => { try { if (!this.closed) peer.reconnect(); } catch { /* ignore */ } }, 1500);
      });
      peer.on('error', (err) => {
        const text = peerErrorText(err);
        if (!opened) { reject(new Error(text)); return; }
        if (err?.type !== 'peer-unavailable') this._status('error', text);
      });
      setTimeout(() => { if (!opened) reject(new Error('Timed out reaching the matchmaking server. Check your connection and try again.')); }, 15000);
    }).then((r) => {
      this.peer.on('open', () => this._status('open', 'Table is open'));
      return r;
    });
  }

  start() {
    if (this.started) return true;
    if (!this.session.table.canDeal()) return false;
    this.started = true;
    this._status(this.state, this.statusText);
    this._system('The game is starting. Good luck!');
    this.session.run();
    return true;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this._hb);
    if (this._onHide) window.removeEventListener('pagehide', this._onHide);
    for (const g of this.guests.values()) { try { g.conn.send({ t: 'closed' }); } catch { /* ignore */ } }
    setTimeout(() => { try { this.peer?.destroy(); } catch { /* ignore */ } }, 200);
    this.session.stop();
  }

  addBot(ref, seat) {
    const b = getBot(ref);
    if (!b || !b.ok) throw new Error('That bot has errors');
    const t = this.session.table;
    const s = seat != null && !t.seats[seat] ? seat : t.firstEmptySeat();
    if (s < 0) throw new Error('The table is full');
    const id = `bot:${ref}:${randomId(4)}`;
    const taken = new Set(t.seats.filter(Boolean).map((p) => p.name));
    let name = b.name, k = 2;
    while (taken.has(name)) name = `${b.name} ${k++}`;
    this.kinds.set(id, 'Bot');
    this.session.addPlayer({ id, name, avatar: b.avatar, color: b.color, kind: 'bot', agent: makeAgent(ref, `${randomSeed()}:${id}`) }, s);
    this._system(`${name} sits down`);
    this._statusPing();
  }

  kick(playerId) {
    this.removals.add(playerId);
    const g = [...this.guests.values()].find((x) => x.playerId === playerId);
    if (g) {
      try { g.conn.send({ t: 'kicked' }); } catch { /* ignore */ }
      g.kicked = true;
      setTimeout(() => { try { g.conn.close(); } catch { /* ignore */ } }, 300);
    }
    this.session.setAway(playerId, true);
    if (!this.session.table.hand || this.session.table.hand.done) this._applyRemovals();
    this._statusPing();
  }

  _applyRemovals() {
    for (const id of this.removals) {
      const p = this.session.players.get(id);
      if (p) this._system(`${p.name} left the table`);
      this.session.removePlayer(id);
    }
    this.removals.clear();
  }

  _statusPing() { this.statusListeners.forEach((fn) => fn(this)); }

  sendChat(text) {
    const msg = { from: this.profile.name || 'Host', text: clean(text, 200) };
    if (!msg.text) return;
    this._pushChat(msg);
  }

  _system(text) { this._pushChat({ system: true, text }); }

  _pushChat(msg) {
    this.chatLog.push(msg);
    if (this.chatLog.length > 200) this.chatLog.shift();
    this.chatListeners.forEach((fn) => fn(msg));
    for (const g of this.guests.values()) if (g.connected) { try { g.conn.send({ t: 'chat', ...msg }); } catch { /* ignore */ } }
  }

  _onConnection(conn) {
    let guest = null;
    const timer = setTimeout(() => { if (!guest) { try { conn.close(); } catch { /* ignore */ } } }, 15000);
    conn.on('data', (raw) => {
      const m = typeof raw === 'string' ? safeParse(raw) : raw;
      if (!m || typeof m !== 'object') return;
      if (!guest) {
        if (m.t !== 'hello') return;
        clearTimeout(timer);
        guest = this._hello(conn, m);
        return;
      }
      if (guest.conn !== conn) return; // an old connection from before a reconnect
      guest.lastSeen = Date.now();
      if (!guest.connected && !guest.kicked) this._markBack(guest);
      if (m.t === 'ping') return;
      if (m.t === 'bye') { this._markGone(guest); return; }
      if (m.t === 'act' && guest.playerId && guest.as === 'human') this.session.act(guest.playerId, m.intent);
      else if (m.t === 'chat') {
        const text = clean(m.text, 200);
        if (text && guest.chatOk()) this._pushChat({ from: guest.name, text });
      }
    });
    conn.on('close', () => { if (guest && guest.conn === conn) this._markGone(guest); });
    conn.on('error', () => {});
  }

  /** A guest stopped responding or left: their seat checks/folds until they return. */
  _markGone(g) {
    if (!g.connected) return;
    g.connected = false;
    if (g.playerId && !g.kicked) {
      if (g.as === 'human') this.session.setAway(g.playerId, true);
      this._system(`${g.name} disconnected`);
    }
    this._statusPing();
  }

  _markBack(g) {
    g.connected = true;
    if (g.as === 'human' && g.playerId) this.session.setAway(g.playerId, false);
    this._system(`${g.name} is back`);
    this._sendSnap(g);
    this._statusPing();
  }

  /** Heartbeat: WebRTC often never reports a closed tab, so watch for silence. */
  _heartbeat() {
    const now = Date.now();
    for (const g of this.guests.values()) {
      if (!g.connected) continue;
      try { g.conn.send({ t: 'ping' }); } catch { /* ignore */ }
      if (now - (g.lastSeen || now) > 11000) {
        this._markGone(g);
        try { g.conn.close(); } catch { /* ignore */ }
      }
    }
  }

  _hello(conn, m) {
    const clientId = clean(m.clientId, 40) || randomId(8);
    const name = clean(m.name, 18) || 'Guest';
    const avatar = [...clean(m.avatar, 8)].slice(0, 2).join('') || '🙂';
    const as = m.as === 'bot' ? 'bot' : m.as === 'watch' ? 'watch' : 'human';
    let times = [];
    const chatOk = () => { const now = Date.now(); times = times.filter((t) => now - t < 5000); times.push(now); return times.length <= 6; };

    const known = this.guests.get(clientId);
    if (known && known.playerId && this.session.players.has(known.playerId) && !known.kicked) {
      try { known.conn.close(); } catch { /* ignore */ }
      Object.assign(known, { conn, connected: true, lastLogId: 0, chatOk, lastSeen: Date.now() });
      if (known.as === 'human') this.session.setAway(known.playerId, false);
      conn.send({ t: 'welcome', playerId: known.playerId, hostName: this.profile.name || 'Host', speed: 1 });
      this._sendChatHistory(known);
      this._system(`${known.name} reconnected`);
      this._sendSnap(known);
      this._statusPing();
      return known;
    }

    const guest = { conn, clientId, name, as, connected: true, playerId: null, lastLogId: 0, chatOk, lastSeen: Date.now() };
    this.guests.set(clientId, guest);
    if (as === 'watch') {
      conn.send({ t: 'welcome', playerId: null, hostName: this.profile.name || 'Host', speed: 1 });
      this._sendChatHistory(guest);
      this._system(`${name} is watching`);
      this._sendSnap(guest);
      return guest;
    }
    const t = this.session.table;
    const seat = t.firstEmptySeat();
    if (seat < 0) {
      conn.send({ t: 'full' });
      guest.as = 'watch';
      conn.send({ t: 'welcome', playerId: null, hostName: this.profile.name || 'Host', speed: 1 });
      this._sendChatHistory(guest);
      this._sendSnap(guest);
      return guest;
    }
    let agent = null, botName = name, botAvatar = avatar, color = COLORS[(seat + 1) % COLORS.length];
    if (as === 'bot') {
      const code = typeof m.code === 'string' ? m.code.slice(0, 30000) : '';
      const c = compile(code);
      if (!c.ok) {
        conn.send({ t: 'error', message: `Your bot has an error on line ${c.errors[0].line}: ${c.errors[0].message}` });
        setTimeout(() => { try { conn.close(); } catch { /* ignore */ } }, 300);
        this.guests.delete(clientId);
        return guest;
      }
      agent = new KickerAgent(code, { seed: `${randomSeed()}:${clientId}`, iterations: 250 });
      botName = clean(c.meta.name, 18) || `${name}'s bot`;
      botAvatar = c.meta.avatar || '🤖';
      color = c.meta.color || color;
    }
    const taken = new Set(t.seats.filter(Boolean).map((p) => p.name));
    let finalName = botName, k = 2;
    while (taken.has(finalName)) finalName = `${botName} ${k++}`;
    const playerId = `g:${clientId}`;
    guest.playerId = playerId;
    this.kinds.set(playerId, as === 'bot' ? `${name}’s bot` : 'Friend');
    if (as === 'bot') this.owner.set(playerId, playerId);
    this.session.addPlayer({ id: playerId, name: finalName, avatar: botAvatar, color, kind: as === 'bot' ? 'bot' : 'remote', agent: agent || undefined }, seat);
    conn.send({ t: 'welcome', playerId, hostName: this.profile.name || 'Host', speed: 1 });
    this._sendChatHistory(guest);
    this._system(as === 'bot' ? `${name} brought a bot: ${finalName}` : `${finalName} joined`);
    this._sendSnap(guest);
    this._statusPing();
    return guest;
  }

  _sendChatHistory(g) {
    try { g.conn.send({ t: 'chatHistory', messages: this.chatLog.slice(-50) }); } catch { /* ignore */ }
  }

  _scheduleBroadcast() {
    if (this._bcast) return;
    this._bcast = setTimeout(() => {
      this._bcast = null;
      for (const g of this.guests.values()) if (g.connected) this._sendSnap(g);
    }, 30);
  }

  _sendSnap(g) {
    const snap = this.session.snapshot(g.playerId || 'spectator', { ownerOf: (pid) => this.ownerOf(pid), revealAll: false });
    const log = this.session.log.filter((e) => e.id > g.lastLogId).slice(-60);
    if (log.length) g.lastLogId = log[log.length - 1].id;
    snap.started = this.started;
    try { g.conn.send({ t: 'snap', snap, log }); } catch { /* ignore */ }
  }
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// ======================================================================
export class OnlineGuest {
  constructor(tableId, { name, avatar, clientId, as, code }) {
    this.tableId = tableId;
    this.hello = { t: 'hello', v: 1, clientId, name, avatar, as, code };
    this.as = as;
    this.playerId = null;
    this.snap = null;
    this.log = [];
    this.chatLog = [];
    this.status = 'connecting';
    this.statusText = 'Connecting…';
    this.listeners = new Set();
    this.chatListeners = new Set();
    this.left = false;
    this.retries = 0;
  }

  onUpdate(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onChat(fn) { this.chatListeners.add(fn); return () => this.chatListeners.delete(fn); }
  _emit() { this.listeners.forEach((fn) => fn(this)); }
  _set(status, text) { this.status = status; this.statusText = text; this._emit(); }

  async connect() {
    const Peer = await loadPeer();
    await new Promise((resolve, reject) => {
      const peer = new Peer({ debug: 1 });
      this.peer = peer;
      let settled = false;
      this._onWelcome = () => { if (!settled) { settled = true; resolve(this); } };
      this._onFail = (msg) => { if (!settled) { settled = true; reject(new Error(msg)); } };
      peer.on('open', () => { if (!this.conn) this._dial(); });
      this._hb = setInterval(() => this._heartbeat(), 3000);
      this._onHide = () => { try { this.conn?.send({ t: 'bye' }); } catch { /* ignore */ } };
      window.addEventListener('pagehide', this._onHide);
      peer.on('error', (err) => {
        if (!settled) this._onFail(peerErrorText(err));
        else if (this.status === 'reconnecting' && err?.type === 'peer-unavailable') this._lost();
      });
      peer.on('disconnected', () => {
        if (!this.left) setTimeout(() => { try { if (!this.left) peer.reconnect(); } catch { /* ignore */ } }, 1500);
      });
      setTimeout(() => this._onFail('Could not reach the table. The host may have closed it, or the link is wrong.'), 20000);
    });
  }

  _dial() {
    const conn = this.peer.connect(this.tableId, { reliable: true, serialization: 'json' });
    this.conn = conn;
    this.lastSeen = Date.now();
    clearTimeout(this._watchdog);
    if (this.status === 'reconnecting') {
      this._watchdog = setTimeout(() => { if (this.status === 'reconnecting' && this.conn === conn) this._lost(); }, 9000);
    }
    conn.on('open', () => { conn.send(this.hello); });
    conn.on('data', (m) => {
      if (this.conn !== conn || !m || typeof m !== 'object') return;
      this.lastSeen = Date.now();
      switch (m.t) {
        case 'ping': break;
        case 'welcome':
          this.playerId = m.playerId;
          this.hostName = m.hostName;
          this.retries = 0;
          clearTimeout(this._watchdog);
          this._set('connected', 'Connected');
          this._onWelcome?.();
          break;
        case 'snap':
          this.snap = m.snap;
          if (Array.isArray(m.log)) { this.log.push(...m.log); if (this.log.length > 600) this.log.splice(0, this.log.length - 500); }
          this._emit();
          break;
        case 'chat': this._chat(m); break;
        case 'chatHistory':
          if (!this.chatLog.length && Array.isArray(m.messages)) m.messages.forEach((x) => this._chat(x));
          break;
        case 'full': this._chat({ system: true, text: 'The table is full, so you are watching.' }); break;
        case 'error': this.left = true; this._onFail?.(m.message); this._set('closed', m.message); break;
        case 'kicked': this.left = true; this._set('closed', 'The host removed you from the table.'); break;
        case 'closed': this.left = true; this._set('closed', 'The host closed the table.'); break;
        default: break;
      }
    });
    conn.on('close', () => { if (this.conn === conn) this._lost(); });
    conn.on('error', () => {});
  }

  /** The connection dropped: retry a few times, then give up. */
  _lost() {
    if (this.left || this.status === 'closed' || this._redial) return;
    if ((this.status === 'connected' || this.status === 'reconnecting') && this.retries < 5) {
      this.retries++;
      this._set('reconnecting', 'Connection lost. Reconnecting…');
      this._redial = setTimeout(() => { this._redial = null; if (!this.left) this._dial(); }, 1000 * this.retries);
    } else {
      this._set('closed', 'Disconnected from the table.');
    }
  }

  _heartbeat() {
    if (this.left || this.status !== 'connected') return;
    try { this.conn?.send({ t: 'ping' }); } catch { /* ignore */ }
    if (Date.now() - (this.lastSeen || Date.now()) > 12000) {
      const old = this.conn;
      this.conn = null;
      try { old?.close(); } catch { /* ignore */ }
      this._lost();
    }
  }

  _chat(m) {
    const msg = { from: clean(m.from, 24), text: clean(m.text, 200), system: !!m.system };
    this.chatLog.push(msg);
    this.chatListeners.forEach((fn) => fn(msg));
  }

  act(intent) {
    try { this.conn?.send({ t: 'act', intent }); return true; } catch { return false; }
  }

  sendChat(text) {
    const t = clean(text, 200);
    if (t) try { this.conn?.send({ t: 'chat', text: t }); } catch { /* ignore */ }
  }

  leave() {
    this.left = true;
    clearTimeout(this._watchdog);
    clearTimeout(this._redial);
    clearInterval(this._hb);
    if (this._onHide) window.removeEventListener('pagehide', this._onHide);
    try { this.conn?.send({ t: 'bye' }); } catch { /* ignore */ }
    try { this.conn?.close(); } catch { /* ignore */ }
    setTimeout(() => { try { this.peer?.destroy(); } catch { /* ignore */ } }, 150);
  }
}
