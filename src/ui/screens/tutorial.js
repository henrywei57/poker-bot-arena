// The coding tutorial: a narrated video (recorded from the real app by
// tools/tutorial/record.mjs), chapters, a clickable transcript, and the bot
// it builds, ready to open in the Bot Lab.

import { h, icon, btn, copyText, toast } from '../dom.js';
import { highlightHTML } from '../editor.js';
import { navigate } from '../app.js';
import { saveBot } from '../../bots/store.js';

export const TUTORIAL_BOT = `bot "Night Owl"
avatar "🦉"
color "#7dd3fc"

on preflop
  when hand in "TT+, AQs+, AKo" then raise 3 x
  when top(20) and to_call <= 3 * bb then call
  fold
end

on postflop
  when strength > 0.8 then bet 75% pot
  when equity > pot_odds then call
  if can_check and chance(0.2) then
    say "Hoo hoo!"
    bet 50% pot
  end
  check
end
`;

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function parseVtt(text) {
  const cues = [];
  const toSec = (t) => { const [h, m, s] = t.split(':'); return Number(h) * 3600 + Number(m) * 60 + Number(s); };
  for (const block of text.replace(/\r/g, '').split('\n\n')) {
    const m = block.match(/(\d\d:\d\d:\d\d\.\d{3}) --> (\d\d:\d\d:\d\d\.\d{3})\n([\s\S]+)/);
    if (m) cues.push({ from: toSec(m[1]), to: toSec(m[2]), text: m[3].trim() });
  }
  return cues;
}

export function renderTutorial(main) {
  const video = h('video', { class: 'tut-video', controls: true, preload: 'metadata', playsinline: true, poster: 'media/tutorial-poster.jpg' },
    h('source', { src: 'media/tutorial.mp4', type: 'video/mp4' }),
    h('track', { kind: 'captions', src: 'media/tutorial.vtt', srclang: 'en', label: 'English' }),
    'Your browser cannot play this video. ', h('a', { href: 'media/tutorial.mp4' }, 'Download it instead.'));
  const chapterList = h('ol', { class: 'chapters' });
  const transcript = h('div', { class: 'transcript' }, h('p', { class: 'muted' }, 'Loading transcript…'));
  let chapters = [];
  let cueEls = [];

  const seek = (t) => { video.currentTime = t + 0.05; video.play().catch(() => {}); video.scrollIntoView({ behavior: 'smooth', block: 'center' }); };

  fetch('media/tutorial-chapters.json').then((r) => r.json()).then((data) => {
    chapters = data.chapters;
    chapterList.replaceChildren(...chapters.map((c, i) => h('li', null, h('button', { type: 'button', class: 'chapter', dataset: { i }, onClick: () => seek(c.t) },
      h('span', { class: 'chapter-time' }, fmt(c.t)), h('span', null, c.title)))));
  }).catch(() => chapterList.replaceChildren(h('li', { class: 'muted' }, 'Chapters unavailable')));

  fetch('media/tutorial.vtt').then((r) => r.text()).then((text) => {
    const cues = parseVtt(text);
    cueEls = cues.map((c) => {
      const el = h('button', { type: 'button', class: 'cue', onClick: () => seek(c.from) }, h('span', { class: 'chapter-time' }, fmt(c.from)), c.text);
      el._cue = c;
      return el;
    });
    transcript.replaceChildren(...cueEls);
  }).catch(() => transcript.replaceChildren(h('p', { class: 'muted' }, 'Transcript unavailable')));

  video.addEventListener('timeupdate', () => {
    const t = video.currentTime;
    let ci = -1;
    chapters.forEach((c, i) => { if (t >= c.t) ci = i; });
    chapterList.querySelectorAll('.chapter').forEach((b) => b.classList.toggle('on', Number(b.dataset.i) === ci));
    for (const el of cueEls) el.classList.toggle('on', t >= el._cue.from && t < el._cue.to);
  });

  const openInLab = () => {
    const ref = saveBot(TUTORIAL_BOT);
    toast('Night Owl added to My bots', 'good');
    navigate(`/lab/${ref}`);
  };

  main.append(h('section', { class: 'tutorial' },
    h('div', { class: 'page-head' }, h('div', null,
      h('p', { class: 'eyebrow' }, 'Coding tutorial · about 4 minutes'),
      h('h1', null, 'Build your first poker bot'),
      h('p', { class: 'muted' }, 'Write a bot in Kicker from an empty editor, catch a typo, test it on random spots, benchmark it over a thousand hands, then watch it play. Turn on captions with the CC button.'))),
    h('div', { class: 'tut-grid' },
      h('div', { class: 'tut-player' }, video),
      h('aside', { class: 'panel tut-side' }, h('h2', null, 'Chapters'), chapterList,
        h('div', { class: 'row-wrap tut-actions' },
          btn('Open the Bot Lab', { icon: 'code', kind: 'primary', onClick: () => navigate('/lab') }),
          h('a', { class: 'btn', href: 'media/tutorial.mp4', download: 'poker-bot-arena-tutorial.mp4' }, icon('download', 17), h('span', null, 'Download'))))),
    h('div', { class: 'tut-grid lower' },
      h('div', { class: 'panel' },
        h('div', { class: 'row-between' }, h('h2', null, 'The bot you build'),
          h('div', { class: 'row-wrap' },
            btn('Copy', { icon: 'copy', small: true, onClick: () => copyText(TUTORIAL_BOT) }),
            btn('Open in Bot Lab', { icon: 'code', small: true, kind: 'primary', onClick: openInLab }))),
        h('pre', { class: 'code-sample', html: highlightHTML(TUTORIAL_BOT) }),
        h('p', { class: 'muted small' }, 'Every line is explained in the video. The full language reference is in the Bot Lab’s Reference tab.')),
      h('div', { class: 'panel' }, h('h2', null, 'Transcript'), h('p', { class: 'muted small' }, 'Click any line to jump there.'), transcript))));
  return () => { video.pause(); };
}
