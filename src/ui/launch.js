// Turns setup choices into a running GameSession and opens the table.

import { GameSession } from '../sim/session.js';
import { Tournament } from '../sim/tournament.js';
import { getBot, makeAgent } from '../bots/store.js';
import { app, setActive, navigate, getProfile, displayName } from './app.js';
import { randomSeed } from '../util.js';

export const ITERATIONS = 250;

/** refs: 'you' | 'builtin:x' | 'my:x' per seat (null = empty seat). */
export function buildPlayers(refs, seed) {
  const counts = {};
  const players = [];
  refs.forEach((ref, seat) => {
    if (!ref) return;
    if (ref === 'you') {
      const prof = getProfile();
      players.push({ id: 'you', name: displayName(), avatar: prof.avatar, color: '#f2c14e', kind: 'human', seat });
      return;
    }
    const b = getBot(ref);
    if (!b || !b.ok) throw new Error(`${b ? b.name : ref} has errors. Fix it in the Bot Lab first.`);
    counts[b.name] = (counts[b.name] || 0) + 1;
    const name = counts[b.name] > 1 ? `${b.name} ${counts[b.name]}` : b.name;
    players.push({
      id: `${ref}#${seat}`, ref, name, avatar: b.avatar, color: b.color, kind: 'bot', seat,
      agent: makeAgent(ref, `${seed}:${seat}:${ref}`, ITERATIONS),
    });
  });
  return players;
}

export function launchPlay(setup) {
  const seed = setup.seed || randomSeed();
  const players = buildPlayers(setup.seats, seed);
  const session = new GameSession({
    mode: 'play', title: 'Play vs bots', players, viewerId: 'you',
    maxSeats: setup.seats.length, sb: setup.sb, bb: setup.bb, startingStack: setup.stack,
    rebuy: setup.rebuy, speed: setup.speed, revealAll: false, seed, turnTime: 0,
  });
  start(session, { mode: 'play', title: 'Play vs bots', setup, rerun: () => launchPlay(setup) });
}

export function launchSim(setup) {
  const seed = setup.seed || randomSeed();
  const players = buildPlayers(setup.seats, seed);
  const session = new GameSession({
    mode: 'sim', title: 'Simulation', players, viewerId: null,
    maxSeats: setup.seats.length, sb: setup.sb, bb: setup.bb, startingStack: setup.stack,
    handLimit: setup.hands, rebuy: setup.rebuy, speed: setup.speed, revealAll: setup.reveal, seed,
  });
  start(session, { mode: 'sim', title: 'Simulation', setup, rerun: () => launchSim(setup) });
}

/** entrants: [{ ref, count }], plus setup.includeMe */
export function tournamentEntrants(setup, seed) {
  const list = [];
  const counts = {};
  if (setup.includeMe) {
    const prof = getProfile();
    list.push({ id: 'you', name: displayName(), avatar: prof.avatar, color: '#f2c14e', kind: 'human' });
  }
  for (const { ref, count } of setup.entrants) {
    const b = getBot(ref);
    if (!b || !b.ok) throw new Error(`${b ? b.name : ref} has errors. Fix it in the Bot Lab first.`);
    for (let i = 0; i < count; i++) {
      counts[b.name] = (counts[b.name] || 0) + 1;
      const n = counts[b.name];
      list.push({
        id: `${ref}#${n}`, ref, name: n > 1 ? `${b.name} ${n}` : b.name, avatar: b.avatar, color: b.color, kind: 'bot',
        agent: makeAgent(ref, `${seed}:${ref}:${n}`, setup.iterations || ITERATIONS),
      });
    }
  }
  return list;
}

export function launchTournament(setup) {
  const seed = setup.seed || randomSeed();
  const entrants = tournamentEntrants(setup, seed);
  if (entrants.length < 2) throw new Error('Add at least two entrants');
  const tour = new Tournament({ entrants, startingStack: setup.stack, maxPerTable: setup.tableSize, handsPerLevel: setup.handsPerLevel, seed });
  const session = new GameSession({
    mode: 'tournament', title: 'Tournament', players: entrants, tournament: tour,
    viewerId: setup.includeMe ? 'you' : null, speed: setup.speed, revealAll: setup.reveal && !setup.includeMe, seed,
  });
  start(session, { mode: 'tournament', title: 'Tournament', setup, rerun: () => launchTournament({ ...setup, seed: '' }) });
}

function start(session, meta) {
  setActive({ session, meta });
  navigate('/table');
  session.run();
}

export { app };
