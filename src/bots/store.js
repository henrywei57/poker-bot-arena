// The bot library: built-in personalities plus "My bots" saved in this
// browser (localStorage). A bot reference is "builtin:<id>" or "my:<id>".

import { PERSONALITIES, STARTER_BOT } from './personalities.js';
import { compile } from '../lang/interpreter.js';
import { KickerAgent } from './agent.js';
import { storage, store } from '../ui/dom.js';
import { randomId } from '../util.js';

const KEY = 'pba.mybots.v1';
const compiledCache = new Map();

function compiledMeta(code) {
  let c = compiledCache.get(code);
  if (!c) { c = compile(code); compiledCache.set(code, c); }
  return c;
}

function describe(ref, code, builtin) {
  const c = compiledMeta(code);
  const id = ref.split(':')[1];
  return {
    ref, id, code, builtin, ok: c.ok, errors: c.errors,
    name: c.meta.name || (builtin ? id : 'Untitled bot'),
    avatar: c.meta.avatar || '🤖',
    color: c.meta.color || '#4c8dff',
    desc: c.meta.desc || '',
    author: c.meta.author || '',
  };
}

export function builtinBots() {
  return PERSONALITIES.map((p) => describe(`builtin:${p.id}`, p.code, true));
}

function readMine() {
  const list = storage(KEY, []);
  return Array.isArray(list) ? list.filter((b) => b && typeof b.code === 'string' && typeof b.id === 'string') : [];
}

export function myBots() {
  return readMine().sort((a, b) => (b.updated || 0) - (a.updated || 0)).map((b) => ({ ...describe(`my:${b.id}`, b.code, false), updated: b.updated }));
}

export function allBots() {
  return [...builtinBots(), ...myBots()];
}

export function getBot(ref) {
  if (!ref) return null;
  const [kind, id] = ref.split(':');
  if (kind === 'builtin') {
    const p = PERSONALITIES.find((x) => x.id === id);
    return p ? describe(ref, p.code, true) : null;
  }
  if (kind === 'my') {
    const b = readMine().find((x) => x.id === id);
    return b ? { ...describe(ref, b.code, false), updated: b.updated } : null;
  }
  return null;
}

/** Save (create or update). Returns the bot reference. */
export function saveBot(code, id) {
  const list = readMine();
  const now = Date.now();
  if (id) {
    const b = list.find((x) => x.id === id);
    if (b) { b.code = code; b.updated = now; store(KEY, list); return `my:${id}`; }
  }
  const nid = id || randomId(8);
  list.push({ id: nid, code, updated: now });
  if (!store(KEY, list)) throw new Error('Could not save: browser storage is full or disabled');
  return `my:${nid}`;
}

export function deleteBot(id) {
  store(KEY, readMine().filter((b) => b.id !== id));
}

export function newBotCode() { return STARTER_BOT; }

/** Build a playing agent for a bot reference or raw code. */
export function makeAgent(refOrCode, seed, iterations) {
  const code = refOrCode.startsWith('builtin:') || refOrCode.startsWith('my:') ? getBot(refOrCode)?.code : refOrCode;
  if (!code) throw new Error(`Bot ${refOrCode} not found`);
  return new KickerAgent(code, { seed, iterations });
}

// ---------------------------------------------------------- sharing
function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function shareLink(code) {
  const base = location.href.split('#')[0];
  return `${base}#/import/${b64urlEncode(code)}`;
}

export function decodeShared(data) {
  try { return b64urlDecode(data); } catch { return null; }
}
