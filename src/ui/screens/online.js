import { h, btn, segmented, toggle, field, select, storage, store, toast } from '../dom.js';
import { OnlineHost, OnlineGuest, tableIdFromInput } from '../../net/online.js';
import { setActive, navigate, getProfile, saveProfile, AVATARS, app } from '../app.js';
import { builtinBots, myBots, getBot } from '../../bots/store.js';
import { botOptions } from './setup.js';

const BLINDS = [[5, 10], [10, 20], [25, 50], [50, 100]];

function nameAndAvatar() {
  const prof = getProfile();
  const name = h('input', { type: 'text', value: prof.name, maxlength: 18, placeholder: 'Your name', 'aria-label': 'Your name',
    onChange: () => saveProfile({ name: name.value }) });
  const pick = h('div', { class: 'avatar-pick' }, AVATARS.map((a) => h('button', {
    type: 'button', class: `avatar-opt ${a === prof.avatar ? 'on' : ''}`, 'aria-label': `Avatar ${a}`,
    onClick: (e) => { saveProfile({ avatar: a }); pick.querySelectorAll('.on').forEach((x) => x.classList.remove('on')); e.currentTarget.classList.add('on'); },
  }, a)));
  return { name, el: h('div', { class: 'profile-edit' }, field('Your name', name), field('Your avatar', pick)) };
}

function botPicker(value, onChange) {
  const opts = [];
  const mine = myBots().filter((b) => b.ok);
  if (mine.length) opts.push({ group: 'My bots', options: mine.map((b) => ({ value: b.ref, label: `${b.avatar}  ${b.name}` })) });
  opts.push({ group: 'Built-in personalities', options: builtinBots().map((b) => ({ value: b.ref, label: `${b.avatar}  ${b.name}` })) });
  const v = getBot(value)?.ok ? value : (mine[0]?.ref || 'builtin:shark');
  onChange(v);
  return select(opts, v, onChange, { 'aria-label': 'Bot' });
}

export function renderOnline(main) {
  const saved = storage('pba.setup.online', null) || {};
  const st = { maxSeats: 6, blinds: 1, stackBB: 100, turnTime: 30, rebuy: true, hostAs: 'human', hostBotRef: 'builtin:shark', bots: ['builtin:shark', 'builtin:maniac'], ...saved };
  const save = () => store('pba.setup.online', st);
  const prof = nameAndAvatar();

  const botsList = h('div', { class: 'chip-list' });
  const drawBots = () => {
    botsList.replaceChildren(...st.bots.map((ref, i) => {
      const b = getBot(ref);
      return h('span', { class: 'chip', style: { '--seat-color': b?.color || '#4c8dff' } }, `${b?.avatar || '?'} ${b?.name || ref}`,
        h('button', { type: 'button', class: 'chip-x', 'aria-label': 'Remove', onClick: () => { st.bots.splice(i, 1); save(); drawBots(); } }, '×'));
    }));
  };
  st.bots = st.bots.filter((r) => getBot(r)?.ok);
  drawBots();
  let addChoice = 'builtin:rock';
  const addSel = select(botOptions(false), addChoice, (v) => { addChoice = v; }, { 'aria-label': 'Bot to add' });
  const addBtn = btn('Add', { icon: 'plus', small: true, onClick: () => {
    if (st.bots.length + 1 >= st.maxSeats) { toast('Leave at least one seat open for a friend', 'bad'); return; }
    st.bots.push(addChoice); save(); drawBots();
  } });
  const hostBotWrap = h('div');
  const drawHostAs = () => {
    hostBotWrap.replaceChildren();
    if (st.hostAs === 'bot') hostBotWrap.append(field('Your bot', botPicker(st.hostBotRef, (v) => { st.hostBotRef = v; save(); })));
  };
  drawHostAs();

  const openBtn = btn('Open table', { icon: 'globe', kind: 'primary lg', onClick: async () => {
    saveProfile({ name: prof.name.value });
    openBtn.disabled = true;
    openBtn.querySelector('span').textContent = 'Opening…';
    try {
      const [sb, bb] = BLINDS[st.blinds];
      const host = new OnlineHost({ maxSeats: st.maxSeats, sb, bb, stack: st.stackBB * bb, turnTime: st.turnTime, rebuy: st.rebuy, hostAs: st.hostAs, hostBotRef: st.hostBotRef, bots: st.bots }, getProfile());
      await host.open();
      setActive({ session: host.session, host, meta: { mode: 'online', title: 'Online table' } });
      navigate('/table');
    } catch (e) {
      toast(e.message, 'bad', 5000);
      openBtn.disabled = false;
      openBtn.querySelector('span').textContent = 'Open table';
    }
  } });

  const joinInput = h('input', { type: 'text', placeholder: 'Paste an invite link or table code', 'aria-label': 'Invite link or code' });
  const joinBtn = btn('Join', { icon: 'link', kind: 'primary', onClick: () => {
    const id = tableIdFromInput(joinInput.value);
    if (!id) { toast('That does not look like an invite link', 'bad'); return; }
    navigate(`/join/${id.replace(/^pba-/, '')}`);
  } });
  joinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinBtn.click(); });

  main.append(h('section', { class: 'setup' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Online table'),
      h('p', { class: 'muted' }, 'Your browser hosts the game and friends connect to it directly (peer to peer). Keep this tab open while you play.'))),
    h('div', { class: 'setup-grid' },
      h('div', { class: 'panel' },
        h('h2', null, 'Host a table'), prof.el,
        field('You play as', segmented([{ value: 'human', label: 'Myself' }, { value: 'bot', label: 'My bot' }, { value: 'watch', label: 'Spectator' }], st.hostAs, (v) => { st.hostAs = v; save(); drawHostAs(); })),
        hostBotWrap,
        field('Seats', segmented([2, 4, 6, 9].map((v) => ({ value: v, label: String(v) })), st.maxSeats, (v) => { st.maxSeats = v; save(); })),
        field('Blinds', segmented(BLINDS.map(([s, b], i) => ({ value: i, label: `${s}/${b}` })), st.blinds, (v) => { st.blinds = v; save(); })),
        field('Starting stack', segmented([50, 100, 200].map((v) => ({ value: v, label: `${v} BB` })), st.stackBB, (v) => { st.stackBB = v; save(); })),
        field('Turn timer', segmented([15, 30, 60, 0].map((v) => ({ value: v, label: v ? `${v}s` : 'Off' })), st.turnTime, (v) => { st.turnTime = v; save(); }), 'Players who run out of time check or fold.'),
        toggle('Auto-rebuy busted players', st.rebuy, (v) => { st.rebuy = v; save(); }),
        field('Bots at the table', h('div', null, botsList, h('div', { class: 'row-wrap' }, addSel, addBtn)), 'You can add or remove bots later, between hands.'),
        h('div', { class: 'setup-start' }, openBtn)),
      h('div', { class: 'panel' },
        h('h2', null, 'Join a table'),
        h('p', { class: 'muted' }, 'Got an invite link? Open it, or paste it here.'),
        h('div', { class: 'invite-row' }, joinInput, joinBtn),
        h('h2', null, 'How it works'),
        h('ul', { class: 'how' },
          h('li', null, 'The host’s browser deals the cards and runs every bot. Nobody else sees your hole cards.'),
          h('li', null, 'Friends can join as themselves, or send a bot they wrote in the Bot Lab to play for them.'),
          h('li', null, 'Bots are written in Kicker, which cannot touch your computer or the page, so running a friend’s bot is safe.'),
          h('li', null, 'Connections are peer to peer (WebRTC). Very strict networks (some offices and schools) can block them.'))))));
}

export function renderJoin(main, code) {
  const tableId = `pba-${code}`;
  if (app.guest && app.guest.tableId === tableId && app.guest.status !== 'closed') { navigate('/table'); return; }
  const prof = nameAndAvatar();
  let as = 'human', botRef = null;
  const botWrap = h('div');
  const drawAs = () => {
    botWrap.replaceChildren();
    if (as === 'bot') botWrap.append(field('Bot to send', botPicker(botRef, (v) => { botRef = v; })));
  };
  drawAs();
  const status = h('p', { class: 'muted' });
  const joinBtn = btn('Join table', { icon: 'play', kind: 'primary lg', onClick: async () => {
    const p = saveProfile({ name: prof.name.value });
    if (!p.name) { toast('Pick a name first', 'bad'); prof.name.focus(); return; }
    let code = null;
    if (as === 'bot') {
      const b = getBot(botRef);
      if (!b || !b.ok) { toast('Pick a bot without errors', 'bad'); return; }
      code = b.code;
    }
    joinBtn.disabled = true;
    status.textContent = 'Connecting to the host…';
    const guest = new OnlineGuest(tableId, { name: p.name, avatar: p.avatar, clientId: p.clientId, as, code });
    try {
      await guest.connect();
      setActive({ guest, meta: { mode: 'online', title: 'Online table' } });
      navigate('/table');
    } catch (e) {
      guest.leave();
      status.textContent = e.message;
      toast(e.message, 'bad', 5000);
      joinBtn.disabled = false;
    }
  } });
  main.append(h('section', { class: 'setup narrow' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Join a table'), h('p', { class: 'muted' }, `Table code: ${code}`))),
    h('div', { class: 'panel' }, prof.el,
      field('Join as', segmented([{ value: 'human', label: 'Myself' }, { value: 'bot', label: 'My bot' }, { value: 'watch', label: 'Spectator' }], as, (v) => { as = v; drawAs(); })),
      botWrap,
      h('div', { class: 'setup-start' }, joinBtn), status)));
}
