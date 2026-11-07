// Injected into the page while recording the tutorial video (never shipped
// with the app). Draws a fake mouse cursor, click ripples, highlight rings,
// step badges, key caps and full-screen title cards on top of the real app.
(() => {
  if (window.__tut) return;
  const css = `
  #tut-root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; font-family: Inter, 'Segoe UI', sans-serif; }
  #tut-cursor { position: absolute; left: 0; top: 0; width: 30px; height: 30px; transform: translate(640px, 760px);
    transition: transform var(--tut-move, 600ms) cubic-bezier(.35,.7,.2,1); filter: drop-shadow(0 3px 5px rgba(0,0,0,.55)); }
  #tut-cursor svg { width: 30px; height: 30px; }
  .tut-ripple { position: absolute; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%;
    border: 3px solid #3fd4ff; animation: tutRipple .6s ease-out forwards; }
  @keyframes tutRipple { from { transform: scale(.4); opacity: 1; } to { transform: scale(3.2); opacity: 0; } }
  #tut-ring { position: absolute; border-radius: 14px; border: 3px solid #3fd4ff; opacity: 0;
    box-shadow: 0 0 0 5px rgba(63,212,255,.22), 0 0 36px rgba(63,212,255,.55);
    transition: left .45s, top .45s, width .45s, height .45s, opacity .3s; }
  #tut-label { position: absolute; max-width: 360px; padding: 9px 14px; border-radius: 12px; opacity: 0;
    background: #3fd4ff; color: #04122b; font-weight: 800; font-size: 17px; line-height: 1.3;
    box-shadow: 0 10px 30px rgba(0,0,0,.45); transition: opacity .3s, left .45s, top .45s; }
  #tut-step { position: absolute; left: 20px; bottom: 18px; display: flex; align-items: center; gap: 12px;
    padding: 9px 18px 9px 10px; border-radius: 14px; background: rgba(6,14,32,.94); color: #e7efff;
    border: 1px solid rgba(76,141,255,.65); box-shadow: 0 12px 34px rgba(0,0,0,.5); font-weight: 700; font-size: 18px;
    opacity: 0; transform: translateY(12px); transition: opacity .35s, transform .35s; }
  #tut-step.show { opacity: 1; transform: none; }
  #tut-step .n { padding: 3px 10px; border-radius: 9px; background: linear-gradient(180deg,#4f8fff,#2f6fe6); font-size: 15px; }
  #tut-step .of { color: #7d92b8; font-weight: 600; font-size: 14px; }
  #tut-keys { position: absolute; left: 50%; bottom: 80px; transform: translateX(-50%) scale(.9); display: flex; gap: 10px;
    opacity: 0; transition: opacity .25s, transform .25s; }
  #tut-keys.show { opacity: 1; transform: translateX(-50%) scale(1); }
  #tut-keys kbd { padding: 12px 20px; border-radius: 12px; background: #f1f5ff; color: #0b1631; font: 800 26px Inter, sans-serif;
    box-shadow: 0 5px 0 #9fb0d6, 0 14px 30px rgba(0,0,0,.5); }
  #tut-card { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center; opacity: 0; transition: opacity .6s; color: #e7efff; padding: 40px;
    background: radial-gradient(900px 600px at 80% 0%, rgba(50,110,230,.45), transparent 60%),
                radial-gradient(800px 600px at 0% 100%, rgba(30,90,200,.35), transparent 55%), #050a15; }
  #tut-card.show { opacity: 1; }
  #tut-card .mark { width: 92px; height: 92px; border-radius: 24px; display: grid; place-items: center; font-size: 56px; color: #fff;
    background: linear-gradient(135deg,#1d4ed8,#22b8f0); box-shadow: 0 14px 50px rgba(59,130,246,.55); margin-bottom: 26px; }
  #tut-card .kicker { font-size: 18px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; color: #3fd4ff; margin-bottom: 12px; }
  #tut-card h1 { margin: 0 0 14px; font-size: 64px; line-height: 1.05; font-weight: 800; letter-spacing: -.02em; }
  #tut-card h1 span { background: linear-gradient(90deg,#6aa8ff,#3fd4ff 60%,#8ff0ff); -webkit-background-clip: text; background-clip: text; color: transparent; }
  #tut-card p { margin: 0; font-size: 24px; color: #b3c4e3; max-width: 900px; }
  #tut-card ul { list-style: none; padding: 0; margin: 26px 0 0; display: grid; gap: 12px; text-align: left; }
  #tut-card li { font-size: 24px; color: #e7efff; display: flex; gap: 14px; align-items: center; }
  #tut-card li b { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; font-size: 17px;
    background: rgba(76,141,255,.2); border: 1px solid rgba(76,141,255,.55); color: #9cc4ff; }
  #tut-card .url { margin-top: 30px; font: 600 22px 'JetBrains Mono', monospace; color: #7fdbff; }
  `;
  const svgCursor = '<svg viewBox="0 0 24 24"><path d="M4 2.5l15.5 11.2-7.2 1.1 4.3 7.6-3 1.6-4.2-7.8L4 21z" fill="#fff" stroke="#0b1631" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  let root, cursor, ring, label, step, keys, card, pos = { x: 640, y: 760 };

  function init() {
    if (root) return;
    const st = document.createElement('style');
    st.textContent = css;
    document.head.append(st);
    root = document.createElement('div');
    root.id = 'tut-root';
    root.innerHTML = `<div id="tut-ring"></div><div id="tut-label"></div><div id="tut-step"></div><div id="tut-keys"></div><div id="tut-card"></div><div id="tut-cursor">${svgCursor}</div>`;
    document.body.append(root);
    cursor = root.querySelector('#tut-cursor');
    ring = root.querySelector('#tut-ring');
    label = root.querySelector('#tut-label');
    step = root.querySelector('#tut-step');
    keys = root.querySelector('#tut-keys');
    card = root.querySelector('#tut-card');
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  window.__tut = {
    init,
    async move(x, y, ms) {
      init();
      const d = Math.hypot(x - pos.x, y - pos.y);
      const t = ms ?? Math.max(250, Math.min(900, d * 0.9));
      cursor.style.setProperty('--tut-move', `${t}ms`);
      cursor.style.transform = `translate(${x - 4}px, ${y - 3}px)`;
      pos = { x, y };
      await wait(t + 40);
    },
    ripple(x = pos.x, y = pos.y) {
      init();
      const r = document.createElement('div');
      r.className = 'tut-ripple';
      r.style.left = `${x}px`; r.style.top = `${y}px`;
      root.append(r);
      setTimeout(() => r.remove(), 700);
    },
    ring(rect, text, side = 'below') {
      init();
      if (!rect) { ring.style.opacity = '0'; label.style.opacity = '0'; return; }
      const pad = 6;
      Object.assign(ring.style, { left: `${rect.x - pad}px`, top: `${rect.y - pad}px`, width: `${rect.width + pad * 2}px`, height: `${rect.height + pad * 2}px`, opacity: '1' });
      if (text) {
        label.innerHTML = esc(text);
        label.style.opacity = '1';
        const lw = Math.min(360, Math.max(140, text.length * 9.5));
        let lx = rect.x + rect.width / 2 - lw / 2;
        lx = Math.max(12, Math.min(innerWidth - lw - 12, lx));
        let ly = side === 'above' ? rect.y - 62 : side === 'right' ? rect.y : rect.y + rect.height + 16;
        if (side === 'right') lx = Math.min(innerWidth - lw - 12, rect.x + rect.width + 18);
        if (side === 'left') { lx = Math.max(12, rect.x - lw - 18); ly = rect.y; }
        ly = Math.max(10, Math.min(innerHeight - 70, ly));
        Object.assign(label.style, { left: `${lx}px`, top: `${ly}px`, width: `${lw}px` });
      } else label.style.opacity = '0';
    },
    step(n, total, title) {
      init();
      if (!title) { step.classList.remove('show'); return; }
      step.innerHTML = `<span class="n">Step ${n}</span><span>${esc(title)}</span><span class="of">of ${total}</span>`;
      step.classList.add('show');
    },
    async keys(list, ms = 1100) {
      init();
      keys.innerHTML = list.map((k) => `<kbd>${esc(k)}</kbd>`).join('<span style="color:#fff;font:800 28px Inter;align-self:center">+</span>');
      keys.classList.add('show');
      await wait(ms);
      keys.classList.remove('show');
    },
    card(opts) {
      init();
      if (!opts) { card.classList.remove('show'); return; }
      card.innerHTML = `${opts.mark ? '<div class="mark">♠</div>' : ''}${opts.kicker ? `<div class="kicker">${esc(opts.kicker)}</div>` : ''}<h1>${opts.title}</h1>${opts.sub ? `<p>${esc(opts.sub)}</p>` : ''}${
        opts.bullets ? `<ul>${opts.bullets.map((b, i) => `<li><b>${i + 1}</b>${esc(b)}</li>`).join('')}</ul>` : ''}${opts.url ? `<div class="url">${esc(opts.url)}</div>` : ''}`;
      card.classList.add('show');
    },
    /** Pixel position of a character index inside a textarea (monospace). */
    caret(sel, index) {
      const ta = document.querySelector(sel);
      const cs = getComputedStyle(ta);
      const before = ta.value.slice(0, index);
      const line = before.split('\n').length - 1;
      const col = before.length - before.lastIndexOf('\n') - 1;
      const c = document.createElement('canvas').getContext('2d');
      c.font = `${cs.fontSize} ${cs.fontFamily}`;
      const cw = c.measureText('M').width;
      const lh = parseFloat(cs.lineHeight);
      const r = ta.getBoundingClientRect();
      return { x: r.left + parseFloat(cs.paddingLeft) + col * cw - ta.scrollLeft, y: r.top + parseFloat(cs.paddingTop) + line * lh + lh / 2 - ta.scrollTop };
    },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
