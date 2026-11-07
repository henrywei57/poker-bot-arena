// Records the coding tutorial video by driving the real app in headless
// Chrome. Narration comes from a built-in Windows voice.
//
//   npm i            (installs playwright-core, which uses your installed Chrome)
//   npm run video    (needs Windows for the voice, plus ffmpeg on PATH)
//
// Output: media/tutorial.mp4 (with soft English subtitles), media/tutorial.vtt,
// media/tutorial-poster.jpg and media/tutorial-chapters.json.

import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BEATS, STEPS } from './script.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)));
const OUT = join(ROOT, 'media');
const TMP = join(tmpdir(), 'pba-tutorial');
const PORT = 8097;
const FPS = 30;
const VOICE = process.env.TUTORIAL_VOICE || 'Microsoft Zira Desktop';
const GAP = 0.35; // seconds of breathing room after each line

const log = (...a) => console.log('[tutorial]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ narration
function readWav(file) {
  const b = readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`${file} is not a WAV file`);
  let p = 12, fmt = null, data = null;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4), size = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { channels: b.readUInt16LE(p + 10), rate: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === 'data') data = b.subarray(p + 8, p + 8 + size);
    p += 8 + size + (size % 2);
  }
  if (!fmt || !data || fmt.bits !== 16 || fmt.channels !== 1) throw new Error(`${file}: expected 16-bit mono PCM`);
  const samples = new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.length));
  return { rate: fmt.rate, samples, duration: samples.length / fmt.rate };
}

function writeWav(file, samples, rate) {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([h, data]));
}

function synthesize() {
  const items = BEATS.map((b, i) => (b.say ? { file: join(TMP, `line${String(i).padStart(2, '0')}.wav`).replace(/\\/g, '/'), text: b.say } : null)).filter(Boolean);
  const manifest = join(TMP, 'lines.json');
  writeFileSync(manifest, JSON.stringify(items));
  log(`speaking ${items.length} lines with ${VOICE}…`);
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(HERE, 'tts.ps1'), '-Manifest', manifest, '-Voice', VOICE], { stdio: 'inherit' });
  BEATS.forEach((b, i) => { if (b.say) b.audio = readWav(join(TMP, `line${String(i).padStart(2, '0')}.wav`)); });
  const total = BEATS.reduce((s, b) => s + (b.audio ? b.audio.duration + GAP : 0), 0);
  log(`narration: ${total.toFixed(1)}s`);
}

// --------------------------------------------------------------- helpers
function makeHelpers(page) {
  const box = async (sel, opts = {}) => {
    const loc = opts.text ? page.locator(sel, { hasText: opts.exact ? new RegExp(`^\\s*${opts.text}\\s*$`) : opts.text }).first() : page.locator(sel).first();
    await loc.waitFor({ state: 'visible', timeout: 15000 });
    const b = await loc.boundingBox();
    return { loc, b };
  };
  const t = {
    page,
    wait: (ms) => sleep(ms),
    card: (o) => page.evaluate((x) => window.__tut.card(x), o ?? null),
    step: (n, total, title) => page.evaluate(([a, b, c]) => window.__tut.step(a, b, c), [n, total, title]),
    keys: (list, ms) => page.evaluate(([l, m]) => window.__tut.keys(l, m), [list, ms]),
    ringOff: () => page.evaluate(() => window.__tut.ring(null)),
    async ring(sel, text, side, within) {
      let { b } = await box(sel);
      if (within) {
        const w = (await box(within)).b;
        const x = Math.max(b.x, w.x), y = Math.max(b.y, w.y);
        b = { x, y, width: Math.min(b.x + b.width, w.x + w.width) - x, height: Math.min(b.y + b.height, w.y + w.height) - y };
      }
      await page.evaluate(([r, tx, s]) => window.__tut.ring(r, tx, s), [b, text, side]);
    },
    async moveTo(sel, opts = {}) {
      const { b } = await box(sel, opts);
      const x = b.x + b.width / 2 + (opts.dx || 0), y = b.y + b.height / 2 + (opts.dy || 0);
      await page.evaluate(([px, py]) => window.__tut.move(px, py), [x, y]);
      return { x, y };
    },
    async click(sel, opts = {}) {
      const { loc, b } = await box(sel, opts);
      const x = b.x + b.width / 2 + (opts.dx || 0), y = b.y + b.height / 2 + (opts.dy || 0);
      await page.evaluate(([px, py]) => window.__tut.move(px, py), [x, y]);
      await page.evaluate(([px, py]) => window.__tut.ripple(px, py), [x, y]);
      await sleep(120);
      if (opts.dx || opts.dy) await page.mouse.click(x, y); else await loc.click();
      await sleep(250);
    },
    async type(text, cps = 38) {
      for (const ch of [...text]) {
        await page.keyboard.insertText(ch);
        await sleep(ch === '\n' ? 140 : 1000 / cps + (Math.random() * 18 - 9));
      }
    },
    async caretToEnd() {
      await page.evaluate(() => { const ta = document.querySelector('.ce-input'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
    },
    async pointAtCode(text) {
      const p = await page.evaluate((s) => { const ta = document.querySelector('.ce-input'); const i = ta.value.indexOf(s); return i < 0 ? null : window.__tut.caret('.ce-input', i); }, text);
      if (p) await page.evaluate(([x, y]) => window.__tut.move(x + 6, y + 4), [p.x, p.y]);
    },
    async ringCode(startText, endText, label) {
      const r = await page.evaluate(([s, e]) => {
        const ta = document.querySelector('.ce-input');
        const v = ta.value;
        const i = v.indexOf(s);
        if (i < 0) return null;
        let j;
        if (e === 'end') { const m = /\n\s*end\b/.exec(v.slice(i)); j = m ? i + m.index + m[0].length : i + s.length; }
        else { const k = v.indexOf(e, i + s.length); j = k < 0 ? i + s.length : k + e.length; }
        const a = window.__tut.caret('.ce-input', v.lastIndexOf('\n', i - 1) + 1);
        const b = window.__tut.caret('.ce-input', j);
        const lh = parseFloat(getComputedStyle(ta).lineHeight);
        const left = a.x - 6;
        const lines = v.slice(i, j).split('\n');
        const longest = Math.max(...lines.map((l) => l.replace(/\s+#.*$/, '').length));
        const cw = (b.x - a.x) / Math.max(1, (v.slice(v.lastIndexOf('\n', j - 1) + 1, j)).length) || 8.1;
        return { x: left, y: a.y - lh / 2 - 2, width: Math.min(ta.clientWidth - 30, (longest + 4) * cw + 12), height: b.y - a.y + lh + 4 };
      }, [startText, endText]);
      if (r) await page.evaluate(([rect, l]) => window.__tut.ring(rect, l, 'right'), [r, label]);
    },
    async replaceInCode(from, to) {
      const p = await page.evaluate((s) => { const ta = document.querySelector('.ce-input'); const i = ta.value.indexOf(s); return window.__tut.caret('.ce-input', i); }, from);
      await page.evaluate(([x, y]) => window.__tut.move(x + 30, y + 4), [p.x, p.y]);
      await page.evaluate(([x, y]) => window.__tut.ripple(x, y), [p.x + 30, p.y]);
      await page.evaluate((s) => { const ta = document.querySelector('.ce-input'); ta.focus(); const i = ta.value.indexOf(s); ta.setSelectionRange(i, i + s.length); }, from);
      await sleep(500);
      await t.type(to, 20);
    },
    async scrollPanelToBottom() {
      await page.evaluate(async () => {
        const el = [...document.querySelectorAll('.lab-panel .side-body > *')].find((x) => !x.hidden);
        const end = el.scrollHeight - el.clientHeight;
        for (let k = 1; k <= 40; k++) { el.scrollTop = (end * k) / 40; await new Promise((r) => setTimeout(r, 30)); }
      });
    },
    async chooseSeat(index, botName) {
      const sel = page.locator('.seat-row select').nth(index);
      const b = await sel.boundingBox();
      await page.evaluate(([x, y]) => window.__tut.move(x, y), [b.x + b.width / 2, b.y + b.height / 2]);
      await page.evaluate(([x, y]) => window.__tut.ripple(x, y), [b.x + b.width / 2, b.y + b.height / 2]);
      const value = await sel.evaluate((s, name) => [...s.options].find((o) => o.textContent.includes(name))?.value, botName);
      if (!value) throw new Error(`No seat option for ${botName}`);
      await sel.selectOption(value);
      await sleep(500);
    },
  };
  return t;
}

// ------------------------------------------------------------- capture
class FrameEncoder {
  constructor(file) {
    this.ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-',
      '-vf', 'scale=1920:1080:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-r', String(FPS), file],
    { stdio: ['pipe', 'inherit', 'inherit'] });
    this.done = new Promise((res, rej) => this.ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
    this.queue = Promise.resolve();
    this.t0 = null;
    this.cur = null;
    this.written = 0;
  }
  _write(buf) {
    return new Promise((res) => { if (this.ff.stdin.write(buf)) res(); else this.ff.stdin.once('drain', res); });
  }
  frame(ts, buf) {
    this.queue = this.queue.then(async () => {
      if (this.t0 === null) this.t0 = ts;
      const slot = Math.round((ts - this.t0) * FPS);
      while (this.cur && this.written < slot) { await this._write(this.cur); this.written++; }
      this.cur = buf;
    });
  }
  async finish(endTs) {
    await this.queue;
    const last = Math.round((endTs - this.t0) * FPS);
    while (this.written < last) { await this._write(this.cur); this.written++; }
    this.ff.stdin.end();
    await this.done;
    return this.written / FPS;
  }
}

// ---------------------------------------------------------------- main
async function main() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  synthesize();

  const server = spawn(process.execPath, [join(ROOT, 'tools', 'serve.mjs'), String(PORT)], { stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch({ channel: process.env.TUTORIAL_BROWSER || 'chrome', headless: true, args: ['--hide-scrollbars', '--force-color-profile=srgb'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5, reducedMotion: 'no-preference' });
    await ctx.addInitScript({ path: join(HERE, 'overlay.js') });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => log('page error:', e.message));
    await page.goto(`http://localhost:${PORT}/#/`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.__tut.card({ mark: true, kicker: 'Coding tutorial', title: 'Build your first <span>poker bot</span>', sub: 'Write it in Kicker, test it, debug it, and watch it play. About four minutes.' }));
    await sleep(800);

    const enc = new FrameEncoder(join(TMP, 'video.mp4'));
    const cdp = await ctx.newCDPSession(page);
    cdp.on('Page.screencastFrame', (f) => {
      enc.frame(f.metadata.timestamp, Buffer.from(f.data, 'base64'));
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
    // Nudge one frame so the clock starts now.
    await page.evaluate(() => window.__tut.ripple(-50, -50));
    while (enc.t0 === null) await sleep(20);
    const t0 = enc.t0;
    const t = makeHelpers(page);
    const cues = [];
    const chapters = [];

    for (let i = 0; i < BEATS.length; i++) {
      const beat = BEATS[i];
      const start = Date.now() / 1000 - t0;
      beat.start = start;
      if (beat.step) {
        await t.step(beat.step, STEPS.length, STEPS[beat.step - 1]);
        chapters.push({ t: Math.max(0, start), title: STEPS[beat.step - 1] });
      }
      log(`beat ${i + 1}/${BEATS.length} at ${start.toFixed(1)}s${beat.step ? ` · ${STEPS[beat.step - 1]}` : ''}`);
      const minTime = beat.audio ? (beat.audio.duration + GAP) * 1000 : 0;
      await Promise.all([beat.run(t), sleep(minTime)]);
      if (beat.say) cues.push(...splitCues(beat.say, start, beat.audio.duration));
    }
    await sleep(2200);
    const end = Date.now() / 1000;
    await cdp.send('Page.stopScreencast');
    const duration = await enc.finish(end);
    log(`video: ${duration.toFixed(1)}s`);

    // Narration track, aligned to each beat's start.
    const rate = BEATS.find((b) => b.audio).audio.rate;
    const mix = new Int16Array(Math.ceil(duration * rate));
    for (const b of BEATS) {
      if (!b.audio) continue;
      const off = Math.round(b.start * rate);
      mix.set(b.audio.samples.subarray(0, Math.max(0, mix.length - off)), off);
    }
    writeWav(join(TMP, 'voice.wav'), mix, rate);

    writeFileSync(join(OUT, 'tutorial.vtt'), toVtt(cues));
    writeFileSync(join(TMP, 'tutorial.srt'), toSrt(cues));
    writeFileSync(join(OUT, 'tutorial-chapters.json'), JSON.stringify({ duration, chapters: [{ t: 0, title: 'Introduction' }, ...chapters] }, null, 2) + '\n');

    log('muxing…');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(TMP, 'video.mp4'), '-i', join(TMP, 'voice.wav'), '-i', join(TMP, 'tutorial.srt'),
      '-map', '0:v', '-map', '1:a', '-map', '2:s', '-c:v', 'copy',
      '-af', 'highpass=f=70,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,loudnorm=I=-16:TP=-1.5:LRA=11',
      '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng',
      '-metadata', 'title=Poker Bot Arena: build your first poker bot', '-movflags', '+faststart', join(OUT, 'tutorial.mp4')], { stdio: 'inherit' });
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '3', '-i', join(TMP, 'video.mp4'), '-frames:v', '1', '-vf', 'scale=1280:720', '-q:v', '3', join(OUT, 'tutorial-poster.jpg')], { stdio: 'inherit' });
    const mb = (statSync(join(OUT, 'tutorial.mp4')).size / 1e6).toFixed(1);
    log(`done: media/tutorial.mp4 (${duration.toFixed(0)}s, ${mb} MB)`);
  } finally {
    await browser.close();
    server.kill();
  }
}

/** Split narration into sentence-sized caption cues timed by length. */
function splitCues(text, start, dur) {
  const parts = text.match(/[^.!?]+[.!?]+["”]?|[^.!?]+$/g).map((s) => s.trim()).filter(Boolean);
  const total = parts.reduce((s, p) => s + p.length, 0);
  let t = start;
  return parts.map((p) => {
    const d = (p.length / total) * dur;
    const cue = { from: t, to: t + d, text: p };
    t += d;
    return cue;
  });
}

const stamp = (s, sep) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}${sep}${String(r).padStart(3, '0')}`;
};
const toVtt = (cues) => `WEBVTT\n\n${cues.map((c, i) => `${i + 1}\n${stamp(c.from, '.')} --> ${stamp(c.to, '.')}\n${c.text}\n`).join('\n')}`;
const toSrt = (cues) => cues.map((c, i) => `${i + 1}\n${stamp(c.from, ',')} --> ${stamp(c.to, ',')}\n${c.text}\n`).join('\n');

if (!existsSync(join(ROOT, 'node_modules', 'playwright-core'))) {
  console.error('Run "npm i" first (installs playwright-core).');
  process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
