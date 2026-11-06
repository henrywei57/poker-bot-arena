// Kicker parser: tokens -> AST. See docs/LANGUAGE.md for the grammar.
//
// program    := { statement }
// statement  := meta STRING | let NAME = expr | keep NAME = expr | NAME = expr
//             | if expr [then] block {elif expr [then] block} [else block] end
//             | when expr [then] statement
//             | on street {, street} [:] block end
//             | fold | check | call | allin | (raise|bet) [size]
//             | say expr | log expr
// size       := min | max | pot | to expr | expr [bb | pot | x | chips]
// expr       := or-chains of and / not / comparisons (chainable, plus in / not in)
//               over + - * / with unary minus, calls f(a, b), lists [a, b]

import { lex, KickerError, META_KEYWORDS, ACTION_KEYWORDS } from './lexer.js';

export const STREET_NAMES = ['preflop', 'flop', 'turn', 'river', 'postflop'];
const SIZE_UNITS = new Set(['bb', 'pot', 'x', 'chips']);
const COMPARE_OPS = new Set(['==', '!=', '<', '<=', '>', '>=']);

class Parser {
  constructor(tokens) {
    this.toks = tokens;
    this.pos = 0;
    this.meta = {};
  }

  peek(k = 0) { return this.toks[Math.min(this.pos + k, this.toks.length - 1)]; }
  next() { return this.toks[this.pos++]; }
  is(t, v, k = 0) { const tok = this.peek(k); return tok.t === t && (v === undefined || tok.v === v); }
  isKw(v, k = 0) { return this.is('kw', v, k); }
  isOp(v, k = 0) { return this.is('op', v, k); }

  error(msg, tok = this.peek(), hint) {
    return new KickerError(msg, tok.line, tok.col, hint);
  }

  expectOp(v, what) {
    if (!this.isOp(v)) throw this.error(`Expected "${v}"${what ? ` ${what}` : ''} but found ${describe(this.peek())}`);
    return this.next();
  }

  skipNewlines() {
    while (this.is('nl') || this.isOp(';')) this.next();
  }

  atTerminator(k = 0) {
    const tok = this.peek(k);
    return tok.t === 'nl' || tok.t === 'eof' || (tok.t === 'op' && tok.v === ';')
      || (tok.t === 'kw' && (tok.v === 'end' || tok.v === 'else' || tok.v === 'elif'));
  }

  expectTerminator() {
    if (this.atTerminator()) return;
    const tok = this.peek();
    let hint;
    if (tok.t === 'op' && tok.v === '=') hint = 'To compare two values use == (double equals).';
    else if (tok.t === 'kw' && ACTION_KEYWORDS.has(tok.v)) hint = 'To act on a condition write `when <condition> then <action>`.';
    throw this.error(`Expected the end of the line but found ${describe(tok)}`, tok, hint);
  }

  parseProgram() {
    const body = [];
    this.skipNewlines();
    while (!this.is('eof')) {
      const s = this.parseStatement(true);
      if (s) body.push(s);
      if (this.isKw('end')) throw this.error('This `end` has no matching `if` or `on` block');
      if (this.isKw('else') || this.isKw('elif')) throw this.error(`\`${this.peek().v}\` must come inside an \`if\` block`);
      this.expectTerminator();
      this.skipNewlines();
    }
    return { type: 'Program', body, meta: this.meta };
  }

  parseBlock(stops, opener) {
    const body = [];
    for (;;) {
      this.skipNewlines();
      const tok = this.peek();
      if (tok.t === 'kw' && stops.includes(tok.v)) return body;
      if (tok.t === 'eof') {
        throw new KickerError(`The \`${opener.v}\` block on line ${opener.line} is missing its \`end\``, opener.line, opener.col);
      }
      const s = this.parseStatement(false);
      if (s) body.push(s);
      if (this.isKw('end') || this.isKw('else') || this.isKw('elif')) {
        if (!stops.includes(this.peek().v)) {
          throw this.error(`\`${this.peek().v}\` does not belong here (inside the \`${opener.v}\` block from line ${opener.line})`);
        }
        continue;
      }
      this.expectTerminator();
    }
  }

  parseStatement(topLevel) {
    const tok = this.peek();
    const at = { line: tok.line, col: tok.col };
    if (tok.t === 'kw') {
      if (META_KEYWORDS.has(tok.v)) {
        if (!topLevel) throw this.error(`\`${tok.v}\` can only be used at the top of the file, not inside a block`);
        this.next();
        const s = this.peek();
        if (s.t !== 'str') throw this.error(`\`${tok.v}\` needs a text value in quotes, like ${tok.v} "Something"`);
        this.next();
        this.meta[tok.v === 'bot' ? 'name' : tok.v] = s.v;
        return null;
      }
      switch (tok.v) {
        case 'let':
        case 'keep': {
          this.next();
          const name = this.peek();
          if (name.t !== 'ident') throw this.error(`\`${tok.v}\` needs a variable name`, name);
          this.next();
          this.expectOp('=', `after \`${tok.v} ${name.v}\``);
          return { type: 'Let', keep: tok.v === 'keep', name: name.v, expr: this.parseExpr(), ...at };
        }
        case 'if': return this.parseIf();
        case 'when': {
          this.next();
          const cond = this.parseExpr();
          if (this.isKw('then')) this.next();
          if (this.atTerminator()) throw this.error('`when` needs something to do after the condition, like `when strength > 0.8 then raise pot`');
          const stmt = this.parseStatement(false);
          if (stmt && (stmt.type === 'On')) throw this.error('`on` blocks cannot go inside `when`', tok);
          return { type: 'When', cond, stmt, ...at };
        }
        case 'on': {
          this.next();
          const streets = [];
          for (;;) {
            const s = this.peek();
            if (s.t !== 'ident' || !STREET_NAMES.includes(s.v)) {
              throw this.error(`\`on\` needs a street: ${STREET_NAMES.join(', ')}`, s);
            }
            streets.push(s.v); this.next();
            if (this.isOp(',') || this.isKw('or')) { this.next(); continue; }
            break;
          }
          if (this.isOp(':')) this.next();
          if (!topLevel) throw new KickerError('`on` blocks must be at the top level, not inside another block', tok.line, tok.col);
          const body = this.parseBlock(['end'], tok);
          this.next(); // end
          return { type: 'On', streets, body, ...at };
        }
        case 'fold': case 'check': case 'call': case 'allin':
          this.next();
          return { type: 'Action', action: tok.v, ...at };
        case 'raise': case 'bet': {
          this.next();
          return { type: 'Action', action: 'raise', size: this.parseSize(), ...at };
        }
        case 'say': case 'log': {
          this.next();
          if (this.atTerminator()) throw this.error(`\`${tok.v}\` needs something to show, like ${tok.v} "hello"`);
          return { type: tok.v === 'say' ? 'Say' : 'Log', expr: this.parseExpr(), ...at };
        }
        case 'then':
          throw this.error('`then` must follow an `if`, `elif` or `when` condition');
        default:
          break;
      }
    }
    if (tok.t === 'ident' && this.isOp('=', 1)) {
      this.next(); this.next();
      return { type: 'Assign', name: tok.v, expr: this.parseExpr(), ...at };
    }
    if (tok.t === 'ident' && (this.isOp('==', 1) || COMPARE_OPS.has(this.peek(1).v))) {
      throw this.error('A condition on its own does nothing', tok, 'Use `when <condition> then <action>` or an `if ... end` block.');
    }
    if (tok.t === 'ident' && ['return', 'while', 'for', 'function', 'def', 'var', 'const', 'elseif'].includes(tok.v)) {
      const alt = { return: 'Use an action such as `call` or `fold` — the first action ends the decision.', elseif: 'Write `elif`.', var: 'Use `let`.', const: 'Use `let`.' }[tok.v]
        || 'Kicker has no loops or user functions: every decision runs top to bottom once.';
      throw this.error(`\`${tok.v}\` is not part of Kicker`, tok, alt);
    }
    throw this.error(`Expected a statement but found ${describe(tok)}`, tok,
      tok.t === 'ident' ? `To set a variable write \`let ${tok.v} = ...\`.` : undefined);
  }

  parseIf() {
    const opener = this.next();
    const branches = [];
    let cond = this.parseExpr();
    if (this.isKw('then')) this.next();
    let body = this.parseBlock(['elif', 'else', 'end'], opener);
    branches.push({ cond, body });
    let elseBody = null;
    while (this.isKw('elif')) {
      this.next();
      cond = this.parseExpr();
      if (this.isKw('then')) this.next();
      body = this.parseBlock(['elif', 'else', 'end'], opener);
      branches.push({ cond, body });
    }
    if (this.isKw('else')) {
      this.next();
      if (this.isKw('if')) throw this.error('Write `elif` instead of `else if`');
      elseBody = this.parseBlock(['end'], opener);
    }
    this.next(); // end
    return { type: 'If', branches, elseBody, line: opener.line, col: opener.col };
  }

  parseSize() {
    const tok = this.peek();
    if (this.atTerminator()) return { unit: 'min' };
    if (tok.t === 'ident' && (tok.v === 'min' || tok.v === 'max') && !this.isOp('(', 1)) {
      this.next();
      return { unit: tok.v };
    }
    if (tok.t === 'ident' && tok.v === 'pot' && this.atTerminator(1)) {
      this.next();
      return { unit: 'pot', expr: { type: 'Num', value: 1, line: tok.line, col: tok.col } };
    }
    if (this.isKw('to')) {
      this.next();
      return { unit: 'chips', expr: this.parseExpr() };
    }
    const expr = this.parseExpr();
    const u = this.peek();
    if (u.t === 'ident' && SIZE_UNITS.has(u.v)) {
      this.next();
      return { unit: u.v, expr };
    }
    return { unit: 'chips', expr };
  }

  // ---- expressions ----
  parseExpr() { return this.parseOr(); }

  parseOr() {
    let left = this.parseAnd();
    while (this.isKw('or')) {
      const op = this.next();
      left = { type: 'Logic', op: 'or', left, right: this.parseAnd(), line: op.line, col: op.col };
    }
    return left;
  }

  parseAnd() {
    let left = this.parseNot();
    while (this.isKw('and')) {
      const op = this.next();
      left = { type: 'Logic', op: 'and', left, right: this.parseNot(), line: op.line, col: op.col };
    }
    return left;
  }

  parseNot() {
    if (this.isKw('not')) {
      const op = this.next();
      return { type: 'Not', expr: this.parseNot(), line: op.line, col: op.col };
    }
    return this.parseCompare();
  }

  parseCompare() {
    const first = this.parseAdd();
    const operands = [first], ops = [];
    for (;;) {
      const tok = this.peek();
      if (tok.t === 'op' && COMPARE_OPS.has(tok.v)) { this.next(); ops.push(tok.v); }
      else if (this.isKw('in')) { this.next(); ops.push('in'); }
      else if (this.isKw('not') && this.isKw('in', 1)) { this.next(); this.next(); ops.push('not in'); }
      else if (tok.t === 'op' && tok.v === '=' ) {
        throw this.error('Use == to compare (a single = sets a variable)', tok);
      } else break;
      operands.push(this.parseAdd());
    }
    if (!ops.length) return first;
    return { type: 'Compare', ops, operands, line: first.line, col: first.col };
  }

  parseAdd() {
    let left = this.parseMul();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.next();
      left = { type: 'Bin', op: op.v, left, right: this.parseMul(), line: op.line, col: op.col };
    }
    return left;
  }

  parseMul() {
    let left = this.parseUnary();
    while (this.isOp('*') || this.isOp('/')) {
      const op = this.next();
      left = { type: 'Bin', op: op.v, left, right: this.parseUnary(), line: op.line, col: op.col };
    }
    return left;
  }

  parseUnary() {
    if (this.isOp('-')) {
      const op = this.next();
      return { type: 'Neg', expr: this.parseUnary(), line: op.line, col: op.col };
    }
    if (this.isOp('+')) { this.next(); return this.parseUnary(); }
    return this.parsePrimary();
  }

  parsePrimary() {
    const tok = this.peek();
    const at = { line: tok.line, col: tok.col };
    if (tok.t === 'num') { this.next(); return { type: 'Num', value: tok.v, ...at }; }
    if (tok.t === 'str') { this.next(); return { type: 'Str', value: tok.v, ...at }; }
    if (this.isKw('true') || this.isKw('false')) { this.next(); return { type: 'Bool', value: tok.v === 'true', ...at }; }
    if (tok.t === 'ident') {
      this.next();
      if (this.isOp('(')) {
        this.next();
        const args = [];
        if (!this.isOp(')')) {
          for (;;) {
            args.push(this.parseExpr());
            if (this.isOp(',')) { this.next(); continue; }
            break;
          }
        }
        this.expectOp(')', `to close the call to ${tok.v}(`);
        return { type: 'Call', name: tok.v, args, ...at };
      }
      return { type: 'Ident', name: tok.v, ...at };
    }
    if (this.isOp('(')) {
      this.next();
      const e = this.parseExpr();
      this.expectOp(')', 'to close the parenthesis');
      return e;
    }
    if (this.isOp('[')) {
      this.next();
      const items = [];
      if (!this.isOp(']')) {
        for (;;) {
          items.push(this.parseExpr());
          if (this.isOp(',')) { this.next(); continue; }
          break;
        }
      }
      this.expectOp(']', 'to close the list');
      return { type: 'List', items, ...at };
    }
    if (tok.t === 'kw' && ['pot', 'bb'].includes(tok.v)) { this.next(); return { type: 'Ident', name: tok.v, ...at }; }
    if (tok.t === 'kw') {
      let hint;
      if (ACTION_KEYWORDS.has(tok.v)) hint = 'Actions are statements. Write `when <condition> then ' + tok.v + '`.';
      throw this.error(`\`${tok.v}\` cannot be used as a value here`, tok, hint);
    }
    throw this.error(`Expected a value but found ${describe(tok)}`, tok);
  }
}

function describe(tok) {
  switch (tok.t) {
    case 'eof': return 'the end of the file';
    case 'nl': return 'the end of the line';
    case 'num': return `the number ${tok.v}`;
    case 'str': return `the text "${tok.v}"`;
    case 'kw': return `\`${tok.v}\``;
    default: return `"${tok.v}"`;
  }
}

export function parse(source) {
  const p = new Parser(lex(source));
  return p.parseProgram();
}
