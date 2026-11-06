import { h, icon } from '../dom.js';
import { fan } from '../cards.js';
import { highlightHTML } from '../editor.js';
import { navigate } from '../app.js';
import { builtinBots } from '../../bots/store.js';
import { cardFromString } from '../../engine/cards.js';

const SAMPLE = `on preflop
  when hand in "TT+, AQs+" then raise 3 x
  when top(20) and in_position then call
  fold
end

on postflop
  when strength > 0.8 then bet 75% pot
  when equity > pot_odds then call
  check
end`;

const MODES = [
  { path: '/play', icon: 'user', title: 'Play vs bots', text: 'Take a seat yourself against the built-in personalities or your own bots.' },
  { path: '/sim', icon: 'zap', title: 'Simulate', text: 'Watch bots play 50 hands at 16× speed, or run thousands instantly and compare results.' },
  { path: '/tournament', icon: 'trophy', title: 'Tournament', text: 'Multi-table freezeouts with rising blinds. Watch one, or run a series of 100.' },
  { path: '/online', icon: 'globe', title: 'Online table', text: 'Open a table and send friends a link. They join as themselves or with their own bot.' },
  { path: '/lab', icon: 'code', title: 'Bot Lab', text: 'Write a bot in Kicker, test it on random spots, and benchmark it in seconds.' },
  { path: '/cards', icon: 'palette', title: 'Cards & table', text: 'Pick card faces, backs, colours, a monogram and the felt.' },
];

export function renderHome(main) {
  const hand = fan(['As', 'Kh', 'Qd', 'Jc', 'Ts'].map(cardFromString), 'hero-fan');
  const code = h('pre', { class: 'code-sample', html: highlightHTML(SAMPLE) });
  const bots = builtinBots();
  main.append(h('section', { class: 'home' },
    h('div', { class: 'hero' },
      h('div', { class: 'hero-copy' },
        h('p', { class: 'eyebrow' }, 'No-limit Texas Hold’em · rule-based bots'),
        h('h1', null, 'Write a poker bot.', h('br'), h('span', { class: 'grad' }, 'Watch it play.')),
        h('p', { class: 'lead' }, 'Program a bot in ', h('b', null, 'Kicker'), ', a tiny logic language made for poker: no machine learning, just rules you write. Pit it against eight personalities, friends, or your own seat at the table.'),
        h('div', { class: 'hero-cta' },
          h('button', { class: 'btn primary lg', onClick: () => navigate('/play') }, icon('play'), h('span', null, 'Play now')),
          h('button', { class: 'btn lg', onClick: () => navigate('/lab') }, icon('code'), h('span', null, 'Build a bot')))),
      h('div', { class: 'hero-art' }, hand, h('div', { class: 'hero-code' }, h('div', { class: 'code-head' }, h('i'), h('i'), h('i'), h('span', null, 'tight-aggressive.kick')), code))),
    h('div', { class: 'mode-grid' }, MODES.map((m) => h('button', { class: 'mode-card', onClick: () => navigate(m.path) },
      h('span', { class: 'mode-icon' }, icon(m.icon, 22)), h('h3', null, m.title), h('p', null, m.text)))),
    h('div', { class: 'roster' },
      h('h2', null, 'Meet the table'),
      h('div', { class: 'roster-grid' }, bots.map((b) => h('div', { class: 'roster-card', style: { '--seat-color': b.color } },
        h('span', { class: 'avatar' }, b.avatar), h('div', null, h('b', null, b.name), h('p', null, b.desc)))))),
  ));
}
