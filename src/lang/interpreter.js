// Kicker compiler front-end (parse + checks) and tree-walking interpreter.
//
// A bot's program runs top to bottom once per decision. The first action
// statement reached (fold / check / call / raise / bet / allin) is the
// decision. If none is reached the bot checks when free, otherwise folds.
// There are no loops and no user functions, so every program finishes;
// a step limit guards anyway. Programs cannot touch the page or network,
// which is why a friend's bot can run safely on your table.

import { parse, STREET_NAMES } from './parser.js';
import { KickerError } from './lexer.js';
import { VARIABLES, FUNCTIONS, Ctx } from './builtins.js';
import { parseRange, HAND_CLASS_RE } from './ranges.js';
import { closestName, makeRng } from '../util.js';

const STEP_LIMIT = 50000;

export class KickerRuntimeError extends Error {
  constructor(message, node) {
    super(message);
    this.line = node?.line; this.col = node?.col;
  }
}

/** Parse and check a program. Never throws for user mistakes. */
export function compile(source) {
  let ast;
  try {
    ast = parse(String(source ?? ''));
  } catch (e) {
    if (e instanceof KickerError) return { ok: false, errors: [{ message: e.message, line: e.line, col: e.col, hint: e.hint }], meta: metaFromSource(source) };
    throw e;
  }
  const errors = check(ast);
  const meta = { ...ast.meta };
  if (meta.color && !/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(meta.color)) {
    errors.push({ message: 'color must be a hex code like "#38d6ff"', line: 1, col: 1 });
  }
  if (meta.name) meta.name = meta.name.slice(0, 24);
  if (meta.avatar) meta.avatar = [...meta.avatar].slice(0, 2).join('');
  return { ok: errors.length === 0, program: errors.length ? null : ast, errors, meta };
}

/** Best-effort bot name etc. from top-level lines, for code that does not parse yet. */
function metaFromSource(source) {
  const meta = {};
  for (const line of String(source ?? '').split(/\r?\n/)) {
    const m = /^\s*(bot|avatar|color|desc|author)\s+"([^"]*)"/.exec(line);
    if (m && meta[m[1] === 'bot' ? 'name' : m[1]] === undefined) meta[m[1] === 'bot' ? 'name' : m[1]] = m[2];
  }
  if (meta.name) meta.name = meta.name.slice(0, 24);
  if (meta.avatar) meta.avatar = [...meta.avatar].slice(0, 2).join('');
  if (meta.color && !/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(meta.color)) delete meta.color;
  return meta;
}

function check(ast) {
  const errors = [];
  const declared = new Set();
  const userNames = [];
  const err = (message, node, hint) => { if (errors.length < 12) errors.push({ message, line: node.line, col: node.col, hint }); };

  const declare = (s) => {
    if (VARIABLES[s.name] || FUNCTIONS[s.name]) {
      err(`\`${s.name}\` is a built-in name and can't be changed. Pick another name, like my_${s.name}.`, s);
    }
    declared.add(s.name); userNames.push(s.name);
  };
  const walkDecl = (list) => {
    for (const s of list) {
      if (s.type === 'Let' || s.type === 'Assign') declare(s);
      else if (s.type === 'If') { s.branches.forEach((b) => walkDecl(b.body)); if (s.elseBody) walkDecl(s.elseBody); }
      else if (s.type === 'When') walkDecl([s.stmt]);
      else if (s.type === 'On') walkDecl(s.body);
    }
  };
  walkDecl(ast.body);

  const allNames = () => [...Object.keys(VARIABLES), ...userNames];
  const expr = (e) => {
    if (!e) return;
    switch (e.type) {
      case 'Ident':
        if (!declared.has(e.name) && !VARIABLES[e.name]) {
          if (FUNCTIONS[e.name]) { err(`\`${e.name}\` is a function: write ${FUNCTIONS[e.name].sig}`, e); break; }
          if (STREET_NAMES.includes(e.name)) break;
          const guess = closestName(e.name, allNames());
          err(`Unknown name \`${e.name}\``, e, guess ? `Did you mean \`${guess}\`?` : 'Set it first with `let`, or check the reference for built-in names.');
        }
        break;
      case 'Call': {
        const fn = FUNCTIONS[e.name];
        if (!fn) {
          const guess = closestName(e.name, Object.keys(FUNCTIONS));
          err(`Unknown function \`${e.name}()\``, e, VARIABLES[e.name] ? `\`${e.name}\` is a value, not a function: drop the parentheses.` : guess ? `Did you mean \`${guess}()\`?` : undefined);
        } else if (e.args.length < fn.min || e.args.length > fn.max) {
          err(`${fn.sig} takes ${fn.min === fn.max ? fn.min : `${fn.min} to ${fn.max}`} value${fn.max === 1 ? '' : 's'}, got ${e.args.length}`, e);
        }
        e.args.forEach(expr);
        if (e.name === 'in_range' && e.args[1]?.type === 'Str') rangeCheck(e.args[1]);
        break;
      }
      case 'Bin': case 'Logic': expr(e.left); expr(e.right); break;
      case 'Not': case 'Neg': expr(e.expr); break;
      case 'List': e.items.forEach(expr); break;
      case 'Compare':
        e.operands.forEach(expr);
        e.ops.forEach((op, k) => {
          const rhs = e.operands[k + 1];
          const lhs = e.operands[k];
          if ((op === 'in' || op === 'not in') && rhs.type === 'Str' && lhs.type === 'Ident' && lhs.name === 'hand') rangeCheck(rhs);
        });
        break;
      default: break;
    }
  };
  const rangeCheck = (node) => {
    try { parseRange(node.value); } catch (x) { err(x.message, node); }
  };
  const stmts = (list) => {
    for (const s of list) {
      switch (s.type) {
        case 'Let': case 'Assign': expr(s.expr); break;
        case 'If': s.branches.forEach((b) => { expr(b.cond); stmts(b.body); }); if (s.elseBody) stmts(s.elseBody); break;
        case 'When': expr(s.cond); stmts([s.stmt]); break;
        case 'On': stmts(s.body); break;
        case 'Action': if (s.size?.expr) expr(s.size.expr); break;
        case 'Say': case 'Log': expr(s.expr); break;
        default: break;
      }
    }
  };
  stmts(ast.body);
  return errors;
}

const truthy = (v) => !(v === false || v === 0 || v === '' || v == null || (Array.isArray(v) && v.length === 0) || Number.isNaN(v));

export function toText(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
  if (Array.isArray(v)) return v.map(toText).join(', ');
  return String(v);
}

function equal(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  return a === b;
}

const typeName = (v) => (Array.isArray(v) ? 'a list' : typeof v === 'boolean' ? 'yes/no' : typeof v === 'string' ? 'text' : 'a number');

class Run {
  constructor(bot, ctx) {
    this.bot = bot;
    this.ctx = ctx;
    this.locals = new Map();
    this.steps = 0;
    this.said = null;
    this.logs = [];
  }

  tick(node) {
    if (++this.steps > STEP_LIMIT) throw new KickerRuntimeError('Program ran too long', node);
  }

  block(list) {
    for (const s of list) {
      const r = this.stmt(s);
      if (r) return r;
    }
    return null;
  }

  stmt(s) {
    this.tick(s);
    switch (s.type) {
      case 'Let':
        if (s.keep) {
          if (!this.bot.memory.has(s.name)) this.bot.memory.set(s.name, this.eval(s.expr));
        } else this.locals.set(s.name, this.eval(s.expr));
        return null;
      case 'Assign': {
        const val = this.eval(s.expr);
        if (this.locals.has(s.name)) this.locals.set(s.name, val);
        else if (this.bot.memory.has(s.name)) this.bot.memory.set(s.name, val);
        else this.locals.set(s.name, val);
        return null;
      }
      case 'If':
        for (const b of s.branches) if (truthy(this.eval(b.cond))) return this.block(b.body);
        return s.elseBody ? this.block(s.elseBody) : null;
      case 'When':
        return truthy(this.eval(s.cond)) ? this.stmt(s.stmt) : null;
      case 'On': {
        const st = this.ctx.view.street;
        const match = s.streets.some((x) => x === st || (x === 'postflop' && st !== 'preflop'));
        return match ? this.block(s.body) : null;
      }
      case 'Action': {
        if (s.action !== 'raise') return { intent: { type: s.action }, line: s.line };
        const unit = s.size.unit;
        let value = 0;
        if (s.size.expr) {
          value = this.eval(s.size.expr);
          if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new KickerRuntimeError(`The raise size must be a number, got ${typeName(value)}`, s);
          }
        }
        return { intent: { type: 'raise', unit, value }, line: s.line };
      }
      case 'Say':
        this.said = toText(this.eval(s.expr)).slice(0, 120);
        return null;
      case 'Log':
        if (this.logs.length < 100) this.logs.push({ line: s.line, text: toText(this.eval(s.expr)) });
        return null;
      default:
        throw new KickerRuntimeError(`Unknown statement ${s.type}`, s);
    }
  }

  num(v, node, what) {
    if (typeof v !== 'number') throw new KickerRuntimeError(`${what} needs a number, got ${typeName(v)}`, node);
    return v;
  }

  eval(e) {
    this.tick(e);
    switch (e.type) {
      case 'Num': case 'Str': case 'Bool': return e.value;
      case 'List': return e.items.map((x) => this.eval(x));
      case 'Ident': {
        if (this.locals.has(e.name)) return this.locals.get(e.name);
        if (this.bot.memory.has(e.name)) return this.bot.memory.get(e.name);
        if (VARIABLES[e.name]) return this.ctx.get(e.name);
        throw new KickerRuntimeError(`\`${e.name}\` has no value yet (set it with let before using it)`, e);
      }
      case 'Neg': return -this.num(this.eval(e.expr), e, 'Minus');
      case 'Not': return !truthy(this.eval(e.expr));
      case 'Logic': {
        const l = truthy(this.eval(e.left));
        if (e.op === 'and') return l ? truthy(this.eval(e.right)) : false;
        return l ? true : truthy(this.eval(e.right));
      }
      case 'Bin': {
        const a = this.eval(e.left), b = this.eval(e.right);
        if (e.op === '+') {
          if (typeof a === 'number' && typeof b === 'number') return a + b;
          if (typeof a === 'string' || typeof b === 'string') return toText(a) + toText(b);
          throw new KickerRuntimeError(`Can't add ${typeName(a)} and ${typeName(b)}`, e);
        }
        this.num(a, e, `"${e.op}"`); this.num(b, e, `"${e.op}"`);
        if (e.op === '-') return a - b;
        if (e.op === '*') return a * b;
        return b === 0 ? 0 : a / b;
      }
      case 'Compare': {
        let left = this.eval(e.operands[0]);
        for (let k = 0; k < e.ops.length; k++) {
          const right = this.eval(e.operands[k + 1]);
          if (!this.compare(e.ops[k], left, right, e)) return false;
          left = right;
        }
        return true;
      }
      case 'Call': {
        const fn = FUNCTIONS[e.name];
        const args = e.args.map((x) => this.eval(x));
        try {
          return fn.fn(this.ctx, ...args);
        } catch (x) {
          throw new KickerRuntimeError(x.message, e);
        }
      }
      default:
        throw new KickerRuntimeError(`Unknown expression ${e.type}`, e);
    }
  }

  compare(op, a, b, node) {
    switch (op) {
      case '==': return equal(a, b);
      case '!=': return !equal(a, b);
      case 'in': case 'not in': {
        let r;
        if (Array.isArray(b)) r = b.some((x) => equal(x, a));
        else if (typeof b === 'string') {
          if (typeof a === 'string' && HAND_CLASS_RE.test(a)) {
            try { r = parseRange(b).has(a); } catch (x) { throw new KickerRuntimeError(x.message, node); }
          } else r = b.includes(toText(a));
        } else throw new KickerRuntimeError('`in` needs a list like [1, 2] or a range like "TT+, AKs" on its right', node);
        return op === 'in' ? r : !r;
      }
      default: {
        if (typeof a !== 'number' || typeof b !== 'number') {
          throw new KickerRuntimeError(`"${op}" compares numbers, got ${typeName(a)} and ${typeName(b)}`, node);
        }
        if (op === '<') return a < b;
        if (op === '<=') return a <= b;
        if (op === '>') return a > b;
        return a >= b;
      }
    }
  }
}

/**
 * A running bot: compiled program + its memory (`keep` variables) + RNG.
 * decide(view) -> { intent, line, said, logs, error, defaulted }
 */
export class KickerBot {
  constructor(compiled, { seed = 'bot', iterations = 300 } = {}) {
    if (!compiled.ok) throw new Error('Cannot run a bot that has errors');
    this.program = compiled.program;
    this.meta = compiled.meta;
    this.memory = new Map();
    this.rng = makeRng(`${seed}:play`);
    this.mcRng = makeRng(`${seed}:mc`);
    this.iterations = iterations;
    this.cache = new Map();
    this.lastHand = null;
  }

  decide(view) {
    const handKey = `${view.handNumber}|${view.hole}`;
    if (handKey !== this.lastHand) { this.cache.clear(); this.lastHand = handKey; }
    const ctx = new Ctx(view, this);
    const run = new Run(this, ctx);
    try {
      const r = run.block(this.program.body);
      if (!r) return { intent: { type: 'check' }, line: null, said: run.said, logs: run.logs, defaulted: true, ctx };
      return { intent: r.intent, line: r.line, said: run.said, logs: run.logs, defaulted: false, ctx };
    } catch (e) {
      if (!(e instanceof KickerRuntimeError)) throw e;
      return { intent: { type: 'check' }, line: e.line, said: run.said, logs: run.logs, error: { message: e.message, line: e.line, col: e.col }, ctx };
    }
  }
}
