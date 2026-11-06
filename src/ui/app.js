// App-wide state: the one active table (a local session, an online host, or
// an online guest), the player profile, and navigation.

import { storage, store } from './dom.js';
import { randomId } from '../util.js';

export const app = {
  session: null, // GameSession (local play, sims, tournaments, online host)
  host: null,    // OnlineHost
  guest: null,   // OnlineGuest
  meta: null,    // { mode, title, rerun: () => void, setup }
  listeners: new Set(),
};

export function onAppChange(fn) { app.listeners.add(fn); return () => app.listeners.delete(fn); }
function notify() { app.listeners.forEach((fn) => fn(app)); }

export function navigate(path) {
  const target = `#${path}`;
  if (location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = path;
}

export function hasActive() { return !!(app.session || app.guest); }

/** Replace the active table with a new one. */
export function setActive({ session = null, host = null, guest = null, meta = null }) {
  stopActive(false);
  Object.assign(app, { session, host, guest, meta });
  notify();
}

export function stopActive(doNotify = true) {
  try { app.host?.close(); } catch (e) { console.error(e); }
  try { app.guest?.leave(); } catch (e) { console.error(e); }
  try { app.session?.stop(); } catch (e) { console.error(e); }
  app.session = null; app.host = null; app.guest = null; app.meta = null;
  if (doNotify) notify();
}

export const AVATARS = ['😎', '🤠', '🦊', '🐼', '🐯', '🦁', '🐸', '🐙', '👾', '🤖', '🧙', '🥷', '🦄', '🐉', '👑', '🎩'];

/**
 * Identifies this tab to an online host so a dropped connection (or a page
 * reload) gets its seat back. Kept per tab, so two tabs are two players.
 */
function tabClientId() {
  try {
    let id = sessionStorage.getItem('pba.clientId');
    if (!id) { id = randomId(12); sessionStorage.setItem('pba.clientId', id); }
    return id;
  } catch {
    if (!tabClientId.fallback) tabClientId.fallback = randomId(12);
    return tabClientId.fallback;
  }
}

export function getProfile() {
  const p = storage('pba.profile.v1', null) || {};
  return { name: p.name || '', avatar: p.avatar || '😎', clientId: tabClientId() };
}

export function saveProfile(patch) {
  const p = { ...getProfile(), ...patch };
  p.name = String(p.name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 18);
  store('pba.profile.v1', { name: p.name, avatar: p.avatar });
  return p;
}

export function displayName() {
  return getProfile().name || 'You';
}
