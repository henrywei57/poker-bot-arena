// Results: leaderboard + chip graph for sims and play sessions, final
// standings for tournaments.

import { h, modal } from './dom.js';
import { lineChart } from './chart.js';
import { payouts, ordinal } from '../sim/tournament.js';
import { formatChips } from '../util.js';
import { navigate, stopActive } from './app.js';

const MEDALS = ['🥇', '🥈', '🥉'];
const pct = (x) => `${Math.round((x || 0) * 100)}%`;

export function standingsTable(rows, { tournament = false, compact = false } = {}) {
  const n = rows.length;
  const pays = tournament ? payouts(n) : [];
  const head = tournament
    ? ['', 'Player', 'Chips', 'Prize']
    : compact ? ['', 'Player', 'Stack', 'Net'] : ['#', 'Player', 'Net chips', 'BB/100', 'Hands won', 'VPIP', 'PFR', 'Aggr', 'Showdowns won', 'Buy-ins'];
  return h('div', { class: 'table-wrap' }, h('table', { class: `data ${compact ? 'compact' : ''}` },
    h('thead', null, h('tr', null, head.map((x) => h('th', null, x)))),
    h('tbody', null, rows.map((r, i) => {
      const who = h('span', { class: 'who', style: { '--seat-color': r.color } }, h('span', { class: 'avatar xs' }, r.avatar || '🙂'), h('span', { class: 'who-name' }, r.name));
      if (tournament) {
        const place = r.place ?? (r.stack > 0 ? null : n);
        const label = place ? (place <= 3 ? `${MEDALS[place - 1]}` : ordinal(place)) : `${i + 1}`;
        return h('tr', { class: place === 1 ? 'first' : '' },
          h('td', { class: 'place' }, label), h('td', null, who),
          h('td', null, r.stack > 0 ? formatChips(r.stack) : h('span', { class: 'muted' }, place ? `out ${ordinal(place)}` : '—')),
          h('td', null, place && place <= pays.length ? `${pays[place - 1]}%` : ''));
      }
      if (compact) {
        return h('tr', null, h('td', { class: 'place' }, String(i + 1)), h('td', null, who),
          h('td', null, formatChips(r.stack)), h('td', { class: r.net >= 0 ? 'pos' : 'neg' }, `${r.net >= 0 ? '+' : ''}${formatChips(r.net)}`));
      }
      return h('tr', null,
        h('td', { class: 'place' }, i < 3 && r.net > 0 ? MEDALS[i] : String(i + 1)), h('td', null, who),
        h('td', { class: r.net >= 0 ? 'pos' : 'neg' }, `${r.net >= 0 ? '+' : ''}${formatChips(r.net)}`),
        h('td', { class: r.bb100 >= 0 ? 'pos' : 'neg' }, r.bb100.toFixed(1)),
        h('td', null, String(r.handsWon)),
        h('td', null, pct(r.vpip)), h('td', null, pct(r.pfr)), h('td', null, (r.af || 0).toFixed(1)),
        h('td', null, r.showdowns ? `${r.showdownsWon}/${r.showdowns}` : '—'),
        h('td', null, String(r.buyIns || 1)));
    }))));
}

export function showResults(session, meta) {
  const rows = session.results();
  const tour = !!session.tour;
  const title = tour ? 'Tournament results' : meta?.mode === 'play' ? 'Session results' : `Results · ${session.handsPlayed} hands`;
  const winner = tour ? rows.find((r) => r.place === 1) : null;
  const series = rows.filter((r) => r.history?.length).map((r) => ({ name: r.name, color: r.color, points: r.history }));
  const body = h('div', { class: 'results' },
    winner ? h('div', { class: 'winner-banner', style: { '--seat-color': winner.color } }, h('span', { class: 'avatar lg' }, winner.avatar), h('div', null, h('small', null, 'Champion'), h('b', null, winner.name))) : null,
    tour ? h('p', { class: 'muted' }, `${rows.length} players · ${session.handsPlayed} rounds played`) : null,
    standingsTable(rows, { tournament: tour }),
    series.length ? h('h3', null, tour ? 'Chips won or lost over time' : 'Net chips over time') : null,
    series.length ? lineChart(series, { height: 260, xLabel: tour ? 'Rounds' : 'Hands', yLabel: 'Net chips' }) : null,
    !tour ? h('p', { class: 'muted small' }, 'BB/100 = big blinds won per 100 hands. VPIP = how often a player chose to put money in preflop; PFR = how often they raised preflop; Aggr = (bets + raises) / calls.') : null);
  const actions = [];
  if (meta?.setup) actions.push({ label: 'Change setup', onClick: () => { stopActive(); navigate(`/${meta.mode}`); } });
  if (meta?.rerun) actions.push({ label: 'Run again', icon: 'refresh', primary: true, onClick: () => meta.rerun() });
  actions.push({ label: 'Close' });
  return modal({ title, body, wide: true, actions });
}
