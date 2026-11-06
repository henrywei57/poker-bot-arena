// Kicker lexer. Produces tokens with line/column info. In `tolerant` mode
// (used by the editor's syntax highlighter) it never throws and also keeps
// comments and unknown characters as tokens.

export const KEYWORDS = new Set([
  'bot', 'author', 'avatar', 'color', 'desc',
  'let', 'keep', 'if', 'then', 'elif', 'else', 'end', 'when', 'on',
  'fold', 'check', 'call', 'raise', 'bet', 'allin', 'say', 'log',
  'and', 'or', 'not', 'in', 'true', 'false', 'to',
]);
export const META_KEYWORDS = new Set(['bot', 'author', 'avatar', 'color', 'desc']);
export const ACTION_KEYWORDS = new Set(['fold', 'check', 'call', 'raise', 'bet', 'allin']);

export class KickerError extends Error {
  constructor(message, line, col, hint) {
    super(message);
    this.line = line; this.col = col; this.hint = hint || null;
  }
}

const TWO_CHAR = new Set(['==', '!=', '<=', '>=']);
const ONE_CHAR = new Set(['+', '-', '*', '/', '(', ')', '[', ']', ',', '<', '>', '=', ';', ':']);

export function lex(src, { tolerant = false } = {}) {
  const tokens = [];
  let i = 0, line = 1, col = 1, depth = 0;
  const push = (t, v, start, sl, sc) => tokens.push({ t, v, start, end: i, line: sl, col: sc });
  const fail = (msg, l = line, c = col) => { throw new KickerError(msg, l, c); };

  while (i < src.length) {
    const ch = src[i];
    const sl = line, sc = col, start = i;
    if (ch === '\n') {
      i++; line++; col = 1;
      if (depth === 0 && tokens.length && tokens[tokens.length - 1].t !== 'nl') push('nl', '\n', start, sl, sc);
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') { i++; col++; continue; }
    if (ch === '#' || (ch === '/' && src[i + 1] === '/')) {
      while (i < src.length && src[i] !== '\n') { i++; col++; }
      if (tolerant) push('comment', src.slice(start, i), start, sl, sc);
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      while (i < src.length && /[0-9]/.test(src[i])) { i++; col++; }
      if (src[i] === '.' && /[0-9]/.test(src[i + 1] || '')) {
        i++; col++;
        while (i < src.length && /[0-9]/.test(src[i])) { i++; col++; }
      }
      let v = parseFloat(src.slice(start, i));
      if (src[i] === '%') { i++; col++; v /= 100; }
      push('num', v, start, sl, sc);
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) { i++; col++; }
      const word = src.slice(start, i);
      push(KEYWORDS.has(word) ? 'kw' : 'ident', word, start, sl, sc);
      continue;
    }
    if (ch === '"' || ch === "'") {
      i++; col++;
      let v = '';
      while (i < src.length && src[i] !== ch && src[i] !== '\n') {
        if (src[i] === '\\' && i + 1 < src.length && src[i + 1] !== '\n') {
          const e = src[i + 1];
          v += e === 'n' ? '\n' : e;
          i += 2; col += 2;
        } else { v += src[i]; i++; col++; }
      }
      if (src[i] !== ch) {
        if (tolerant) { push('str', v, start, sl, sc); continue; }
        fail('This text is missing its closing quote', sl, sc);
      }
      i++; col++;
      push('str', v, start, sl, sc);
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO_CHAR.has(two)) { i += 2; col += 2; push('op', two, start, sl, sc); continue; }
    if (ONE_CHAR.has(ch)) {
      i++; col++;
      if (ch === '(' || ch === '[') depth++;
      if ((ch === ')' || ch === ']') && depth > 0) depth--;
      push('op', ch, start, sl, sc);
      continue;
    }
    if (tolerant) { i++; col++; push('err', ch, start, sl, sc); continue; }
    if (ch === '%') fail('Put % right after a number, like 30%. For remainders use mod(a, b).');
    if (ch === '!') fail('Use `not` instead of !, and != for "not equal".');
    if (ch === '&' || ch === '|') fail('Use the words `and` / `or` instead of && and ||.');
    if (ch === '{' || ch === '}') fail('Kicker uses `then ... end` blocks instead of curly braces.');
    fail(`Unexpected character "${ch}"`);
  }
  push('eof', null, i, line, col);
  return tokens;
}
