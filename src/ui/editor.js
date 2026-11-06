// A lightweight code editor for Kicker: a transparent <textarea> over a
// syntax-highlighted <pre>, with line numbers, error markers, auto-indent,
// Tab / Shift+Tab, Ctrl+/ to comment, and Ctrl+S to save.

import { h } from './dom.js';
import { lex, ACTION_KEYWORDS, META_KEYWORDS } from '../lang/lexer.js';
import { VARIABLES, FUNCTIONS } from '../lang/builtins.js';
import { STREET_NAMES } from '../lang/parser.js';

const UNITS = new Set(['bb', 'pot', 'x', 'chips', 'min', 'max']);
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Highlighted HTML for Kicker source (all user text is escaped). */
export function highlightHTML(src) {
  const toks = lex(src, { tolerant: true });
  let out = '', pos = 0, prevKw = null;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === 'eof') break;
    if (t.start > pos) out += escape(src.slice(pos, t.start));
    const text = escape(src.slice(t.start, t.end));
    let cls = '';
    switch (t.t) {
      case 'kw':
        cls = ACTION_KEYWORDS.has(t.v) ? 'tk-act' : META_KEYWORDS.has(t.v) ? 'tk-meta' : t.v === 'say' || t.v === 'log' ? 'tk-say' : 'tk-kw';
        break;
      case 'ident': {
        const next = toks[i + 1];
        if (next && next.t === 'op' && next.v === '(' && FUNCTIONS[t.v]) cls = 'tk-fn';
        else if (UNITS.has(t.v) && (prevKw === 'raise' || prevKw === 'bet' || toks[i - 1]?.t === 'num' || toks[i - 1]?.v === ')')) cls = 'tk-unit';
        else if (VARIABLES[t.v]) cls = 'tk-var';
        else if (STREET_NAMES.includes(t.v)) cls = 'tk-street';
        else cls = 'tk-id';
        break;
      }
      case 'num': cls = 'tk-num'; break;
      case 'str': cls = 'tk-str'; break;
      case 'comment': cls = 'tk-com'; break;
      case 'op': cls = 'tk-op'; break;
      case 'err': cls = 'tk-err'; break;
      default: break;
    }
    if (t.t === 'nl') out += text;
    else out += cls ? `<span class="${cls}">${text}</span>` : text;
    if (t.t === 'kw') prevKw = t.v;
    else if (t.t === 'nl') prevKw = null;
    pos = t.end;
  }
  if (pos < src.length) out += escape(src.slice(pos));
  return out;
}

export class CodeEditor {
  constructor(host, { value = '', readOnly = false, onChange, onSave } = {}) {
    this.onChange = onChange;
    this.onSave = onSave;
    this.gutter = h('div', { class: 'ce-gutter', 'aria-hidden': 'true' });
    this.code = h('code');
    this.pre = h('pre', { class: 'ce-hl', 'aria-hidden': 'true' }, this.code);
    this.lineMarks = h('div', { class: 'ce-marks', 'aria-hidden': 'true' });
    this.ta = h('textarea', {
      class: 'ce-input', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off',
      'aria-label': 'Bot code', wrap: 'off',
    });
    this.ta.readOnly = readOnly;
    this.scroller = h('div', { class: 'ce-scroll' }, this.lineMarks, this.pre, this.ta);
    this.root = h('div', { class: `code-editor ${readOnly ? 'readonly' : ''}` }, this.gutter, this.scroller);
    host.append(this.root);
    this.errors = [];
    this.ta.value = value;
    this.ta.addEventListener('input', () => { this._refresh(); this.onChange?.(this.ta.value); });
    this.ta.addEventListener('scroll', () => this._sync());
    this.ta.addEventListener('keydown', (e) => this._key(e));
    this._refresh();
  }

  get value() { return this.ta.value; }
  set value(v) { this.ta.value = v; this._refresh(); }
  setReadOnly(ro) { this.ta.readOnly = ro; this.root.classList.toggle('readonly', ro); }
  focus() { this.ta.focus(); }

  setErrors(errors) {
    this.errors = errors || [];
    this._marks();
  }

  _refresh() {
    // A trailing newline needs a placeholder so the last line has height.
    this.code.innerHTML = highlightHTML(this.ta.value) + '\n';
    const lines = this.ta.value.split('\n').length;
    if (lines !== this._lines) {
      this._lines = lines;
      this.gutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
    }
    this._marks();
    this._sync();
  }

  _marks() {
    const bad = new Set(this.errors.map((e) => e.line));
    this.lineMarks.replaceChildren(...[...bad].map((ln) => h('div', { class: 'ce-errline', style: { top: `calc(${ln - 1} * var(--ce-lh) + var(--ce-pad))` } })));
    if (this.flash) this.lineMarks.append(this.flash);
    const gut = this.gutter;
    gut.dataset.errors = [...bad].join(',');
    this._gutterMarks(bad);
  }

  _gutterMarks(bad) {
    // Re-render gutter with error markers only when needed.
    const lines = this._lines || 1;
    if (!bad.size) {
      if (this._gutHasMarks) { this.gutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n'); this._gutHasMarks = false; }
      return;
    }
    this.gutter.replaceChildren(...Array.from({ length: lines }, (_, i) => h('span', { class: bad.has(i + 1) ? 'bad' : '' }, String(i + 1), '\n')));
    this._gutHasMarks = true;
  }

  _sync() {
    this.pre.scrollTop = this.ta.scrollTop;
    this.pre.scrollLeft = this.ta.scrollLeft;
    this.gutter.scrollTop = this.ta.scrollTop;
    this.lineMarks.style.transform = `translate(${-this.ta.scrollLeft}px, ${-this.ta.scrollTop}px)`;
  }

  /** Briefly highlight a line (e.g. the line that made a decision). */
  flashLine(line, kind = 'info') {
    if (!line) return;
    this.flash = h('div', { class: `ce-flash ${kind}`, style: { top: `calc(${line - 1} * var(--ce-lh) + var(--ce-pad))` } });
    this._marks();
    this.goToLine(line, false);
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => { this.flash = null; this._marks(); }, 2400);
  }

  goToLine(line, focus = true) {
    const lines = this.ta.value.split('\n');
    let pos = 0;
    for (let i = 0; i < Math.min(line - 1, lines.length); i++) pos += lines[i].length + 1;
    const lh = parseFloat(getComputedStyle(this.root).getPropertyValue('--ce-lh')) || 20;
    const target = (line - 1) * lh - this.ta.clientHeight / 3;
    this.ta.scrollTop = Math.max(0, target);
    if (focus) { this.ta.focus(); this.ta.setSelectionRange(pos, pos); }
    this._sync();
  }

  _replace(start, end, text, selStart, selEnd) {
    this.ta.setSelectionRange(start, end);
    // execCommand keeps the browser's undo stack working; fall back if unsupported.
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
    if (!ok) {
      const v = this.ta.value;
      this.ta.value = v.slice(0, start) + text + v.slice(end);
      this.ta.dispatchEvent(new Event('input'));
    }
    if (selStart != null) this.ta.setSelectionRange(selStart, selEnd ?? selStart);
  }

  _key(e) {
    const ta = this.ta;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this.onSave?.(); return; }
    if (ta.readOnly) return;
    const v = ta.value, s = ta.selectionStart, en = ta.selectionEnd;
    const lineStart = v.lastIndexOf('\n', s - 1) + 1;
    if (e.key === 'Tab') {
      e.preventDefault();
      if (s === en && !e.shiftKey) { this._replace(s, en, '  '); return; }
      const blockEnd = v.indexOf('\n', en - (en > s && v[en - 1] === '\n' ? 1 : 0));
      const endIdx = blockEnd < 0 ? v.length : blockEnd;
      const block = v.slice(lineStart, endIdx);
      const changed = e.shiftKey ? block.replace(/^ {1,2}/gm, '') : block.replace(/^/gm, '  ');
      this._replace(lineStart, endIdx, changed, lineStart, lineStart + changed.length);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      const blockEnd = v.indexOf('\n', en);
      const endIdx = blockEnd < 0 ? v.length : blockEnd;
      const block = v.slice(lineStart, endIdx);
      const all = block.split('\n').every((l) => /^\s*#/.test(l) || !l.trim());
      const changed = all ? block.replace(/^(\s*)# ?/gm, '$1') : block.replace(/^(\s*)(?=\S)/gm, '$1# ');
      this._replace(lineStart, endIdx, changed, lineStart, lineStart + changed.length);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const line = v.slice(lineStart, s);
      const indent = line.match(/^\s*/)[0];
      const code = line.replace(/#.*$/, '').trim();
      const opens = /^(on|if|elif|else)\b/.test(code) && !/\bend$/.test(code);
      this._replace(s, en, '\n' + indent + (opens ? '  ' : ''));
      return;
    }
    if (e.key === 'd' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Typing the "d" of "end" on an indented line dedents it.
      const line = v.slice(lineStart, s);
      if (/^\s+en$/.test(line) && s === en) {
        e.preventDefault();
        const trimmed = line.replace(/^ {1,2}/, '');
        this._replace(lineStart, s, trimmed + 'd');
      }
    }
  }
}
