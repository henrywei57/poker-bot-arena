import { h, btn, segmented, toggle, field } from '../dom.js';
import { getCardStyle, setCardStyle, resetCardStyle, onCardStyle, FACE_THEMES, FONTS, FELTS, BACK_DESIGNS, BACK_PRESETS, cardEl, backSVG, svgDataUri, fan } from '../cards.js';
import { cardFromString } from '../../engine/cards.js';

export function renderStyle(main) {
  const cleanups = [];
  const s = getCardStyle();
  const preview = h('div', { class: 'style-preview' });
  const felt = h('div', { class: 'mini-felt' });
  const drawPreview = () => {
    const faces = fan(['As', 'Kh', 'Qd', 'Jc', 'Ts'].map(cardFromString), 'preview-fan');
    const pips = h('div', { class: 'card-row' }, ['7h', '9c', '3d', '8s'].map((x) => cardEl(cardFromString(x))));
    const backs = h('div', { class: 'card-row' }, [cardEl(-1), cardEl(-1)]);
    felt.replaceChildren(h('div', { class: 'mini-board' }, ['Ah', 'Kd', '7c'].map((x) => cardEl(cardFromString(x)))), backs);
    preview.replaceChildren(faces, pips, felt);
  };
  drawPreview();
  cleanups.push(onCardStyle(drawPreview));

  const backGrid = h('div', { class: 'back-grid' });
  const drawBacks = () => {
    const cur = getCardStyle();
    backGrid.replaceChildren(...Object.entries(BACK_DESIGNS).map(([key, label]) => h('button', {
      type: 'button', class: `back-opt ${cur.back === key ? 'on' : ''}`, 'aria-pressed': String(cur.back === key), 'aria-label': label,
      onClick: () => { setCardStyle({ back: key }); drawBacks(); },
    }, h('span', { class: 'back-thumb', style: { backgroundImage: svgDataUri(backSVG({ ...cur, back: key })) } }), h('small', null, label))));
  };
  drawBacks();

  const colorA = h('input', { type: 'color', value: s.backA, 'aria-label': 'Back main colour', onInput: () => { setCardStyle({ backA: colorA.value }); drawBacks(); } });
  const colorB = h('input', { type: 'color', value: s.backB, 'aria-label': 'Back accent colour', onInput: () => { setCardStyle({ backB: colorB.value }); drawBacks(); } });
  const presets = h('div', { class: 'swatches' }, BACK_PRESETS.map(([a, b]) => h('button', {
    type: 'button', class: 'swatch', title: `${a} / ${b}`, 'aria-label': `Colours ${a} and ${b}`, style: { background: `linear-gradient(135deg, ${a} 55%, ${b} 55%)` },
    onClick: () => { colorA.value = a; colorB.value = b; setCardStyle({ backA: a, backB: b }); drawBacks(); },
  })));
  const mono = h('input', { type: 'text', value: s.monogram, maxlength: 3, placeholder: '♠', 'aria-label': 'Monogram', class: 'mono-input',
    onInput: () => { setCardStyle({ monogram: mono.value }); drawBacks(); } });
  const monoQuick = h('div', { class: 'row-wrap' }, ['♠', '♥', '♦', '♣', '★', 'PBA', ''].map((m) => h('button', { type: 'button', class: 'chip-btn', onClick: () => { mono.value = m; setCardStyle({ monogram: m }); drawBacks(); } }, m || 'None')));

  const feltCustom = h('input', { type: 'color', value: s.feltCustom, 'aria-label': 'Custom felt colour', onInput: () => { setCardStyle({ felt: 'custom', feltCustom: feltCustom.value }); feltSeg.setValue('custom'); } });
  const feltSeg = segmented([...Object.entries(FELTS).map(([k, v]) => ({ value: k, label: v.label })), { value: 'custom', label: 'Custom' }], s.felt, (v) => setCardStyle({ felt: v }));

  main.append(h('section', { class: 'setup' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Cards & table'), h('p', { class: 'muted' }, 'Changes apply everywhere instantly, including tables already running.')),
      btn('Reset to default', { icon: 'refresh', small: true, onClick: () => { resetCardStyle(); main.replaceChildren(); renderStyle(main); } })),
    h('div', { class: 'setup-grid style-grid' },
      h('div', { class: 'panel' },
        h('h2', null, 'Card faces'),
        field('Theme', segmented(Object.entries(FACE_THEMES).map(([k, v]) => ({ value: k, label: v.label })), s.face, (v) => setCardStyle({ face: v }))),
        field('Font', segmented(Object.entries(FONTS).map(([k, v]) => ({ value: k, label: v.label })), s.font, (v) => setCardStyle({ font: v }))),
        toggle('Four-colour deck', s.fourColor, (v) => setCardStyle({ fourColor: v }), 'Diamonds blue, clubs green: easier to tell suits apart at a glance'),
        field('Card size', segmented([{ value: 's', label: 'Small' }, { value: 'm', label: 'Medium' }, { value: 'l', label: 'Large' }], s.size, (v) => setCardStyle({ size: v }))),
        h('h2', null, 'Card backs'),
        backGrid,
        field('Colours', h('div', { class: 'row-wrap' }, colorA, colorB, presets)),
        field('Monogram', h('div', null, mono, monoQuick), 'Up to three characters in the middle of the back.'),
        h('h2', null, 'Table felt'),
        field('Colour', h('div', { class: 'row-wrap' }, feltSeg, feltCustom))),
      h('div', { class: 'panel sticky' }, h('h2', null, 'Preview'), preview))));
  return () => cleanups.forEach((fn) => fn());
}
