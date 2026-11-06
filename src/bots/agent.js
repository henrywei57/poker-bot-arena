// A bot player: a compiled Kicker program plus the glue that turns its
// intent into a legal engine action.

import { compile, KickerBot } from '../lang/interpreter.js';
import { resolveIntent } from '../engine/actions.js';

export class KickerAgent {
  /**
   * @param source  Kicker program text
   * @param opts.seed        RNG seed (reproducible play)
   * @param opts.iterations  Monte Carlo deals per equity estimate
   */
  constructor(source, opts = {}) {
    this.compiled = compile(source);
    if (!this.compiled.ok) {
      const e = this.compiled.errors[0];
      throw new Error(`Bot has an error on line ${e.line}: ${e.message}`);
    }
    this.kind = 'bot';
    this.bot = new KickerBot(this.compiled, opts);
    this.meta = this.compiled.meta;
    this.errors = 0;
    this.lastError = null;
  }

  /** Synchronous decision. Returns { type, amount, said, error, line }. */
  decide(view) {
    const r = this.bot.decide(view);
    if (r.error) { this.errors++; this.lastError = r.error; }
    const action = resolveIntent(r.intent, view.legal);
    return { ...action, said: r.said, error: r.error, line: r.line, logs: r.logs, intent: r.intent };
  }
}
