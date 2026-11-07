// The tutorial, beat by beat. Each beat has narration (`say`) and what
// happens on screen (`run`). A beat lasts as long as the longer of the two,
// so the voice and the picture stay in step. `step` starts a chapter.

export const STEPS = [
  'Open the Bot Lab', 'Start a new bot', 'Name your bot', 'Rules before the flop',
  'Mistakes are caught live', 'Rules after the flop', 'Save and try a spot', 'Test it', 'Watch it play',
];

const PREFLOP = [
  '\non preflop\n',
  '  when hand in "TT+, AQs+, AKo" then raise 3 x\n',
  '  when top(20) and to_call <= 3 * bb then call\n',
  '  fold\nend\n',
];

export const BEATS = [
  {
    say: "Welcome to Poker Bot Arena. In this tutorial, you'll write a poker bot from scratch in Kicker, the arena's rule based language. Then you'll test it, debug it, and watch it play.",
    run: async (t) => {
      t.card({ mark: true, kicker: 'Coding tutorial', title: 'Build your first <span>poker bot</span>', sub: 'Write it in Kicker, test it, debug it, and watch it play. About four minutes.' });
    },
  },
  {
    say: "There's no machine learning here. A bot is just a list of rules that you can read from top to bottom, like this one.",
    run: async (t) => {
      t.card(null);
      await t.wait(900);
      await t.ring('.hero-code', 'A complete bot, in ten lines', 'below');
      await t.moveTo('.hero-code', { dx: -120, dy: -40 });
    },
  },
  {
    step: 1,
    say: 'Everything happens in the Bot Lab.',
    run: async (t) => {
      t.ringOff();
      await t.click('a.nav-link[data-path="/lab"]');
    },
  },
  {
    say: 'On the left are your bots, and the eight built in personalities. In the middle is the code editor. And on the right are tools to test your bot.',
    run: async (t) => {
      await t.wait(300);
      await t.ring('.lab-side', 'Your bots and the built-in ones', 'right');
      await t.moveTo('.lab-side', { dy: -60 });
      await t.wait(2600);
      await t.ring('.lab-main', 'The editor', 'below');
      await t.moveTo('.lab-main', { dy: -80 });
      await t.wait(2200);
      await t.ring('.lab-panel', 'Test, debug and look things up', 'left');
      await t.moveTo('.lab-panel', { dy: -100 });
    },
  },
  {
    step: 2,
    say: 'Press New to start a bot. You get a small example that already works.',
    run: async (t) => {
      t.ringOff();
      await t.click('.lab-side .btn.primary');
      await t.wait(800);
    },
  },
  {
    say: "Here's the key idea. Every time it's your turn, the program runs from top to bottom, and the first action it reaches is your move. If it reaches no action, it checks when that's free, and folds otherwise.",
    run: async (t) => {
      await t.ringCode('on preflop', 'end', 'Runs top to bottom on every decision');
      await t.wait(2400);
      await t.pointAtCode('raise 3 x');
      await t.wait(1200);
      await t.pointAtCode('then call');
      await t.wait(1200);
      await t.pointAtCode('check   ');
    },
  },
  {
    step: 3,
    say: "Let's write our own. Clear the editor, then give the bot a name, an avatar, and a colour. These lines are optional, but they make your bot easy to spot at the table.",
    run: async (t) => {
      t.ringOff();
      await t.click('.ce-input', { dx: 60, dy: -120 });
      await Promise.all([t.keys(['Ctrl', 'A'], 900), t.page.keyboard.press('Control+A')]);
      await t.page.keyboard.press('Delete');
      await t.wait(500);
      await t.type('bot "Night Owl"\navatar "🦉"\ncolor "#7dd3fc"\n');
    },
  },
  {
    step: 4,
    say: 'Now the rules for before the flop. The words, on preflop, start a block that only runs before the flop is dealt.',
    run: async (t) => { await t.type(PREFLOP[0]); },
  },
  {
    say: 'Each rule reads like a sentence. When something is true, then do something. Our best hands, tens or better and big aces, raise to three times the bet.',
    run: async (t) => { await t.wait(1800); await t.type(PREFLOP[1]); },
  },
  {
    say: "Decent hands, in the top twenty percent, call when it's cheap.",
    run: async (t) => { await t.type(PREFLOP[2]); },
  },
  {
    say: 'Everything else folds. And the word end closes the block.',
    run: async (t) => { await t.type(PREFLOP[3]); },
  },
  {
    step: 5,
    say: 'Now, after the flop. Kicker checks your code while you type. Watch what happens if I misspell strength.',
    run: async (t) => {
      await t.type('\non postflop\n');
      await t.wait(2600);
      await t.type('  when strenght > 0.8 then bet 75% pot\n');
    },
  },
  {
    say: "The line turns red straight away. The problems list says it doesn't know that name, and suggests the one I meant.",
    run: async (t) => {
      await t.wait(400);
      await t.ring('.problems', 'Instant feedback, with a hint', 'above');
      await t.moveTo('.problems', { dx: -60 });
    },
  },
  {
    say: 'Fix the spelling, and the bot is ready to play again.',
    run: async (t) => {
      t.ringOff();
      await t.replaceInCode('strenght', 'strength');
      await t.wait(500);
      await t.ring('.lab-toolbar .pill', 'Ready to play', 'below');
    },
  },
  {
    step: 6,
    say: 'Strength is our chance of beating one random hand, from zero to one. Very strong hands bet three quarters of the pot.',
    run: async (t) => {
      await t.ringCode('when strength', 'pot', 'strength: 0 to 1');
    },
  },
  {
    say: "Equity is our chance against everyone still in the hand, and pot odds is the share of the final pot we'd be paying. When equity beats the price, calling wins money in the long run.",
    run: async (t) => {
      t.ringOff();
      await t.caretToEnd();
      await t.wait(1200);
      await t.type('  when equity > pot_odds then call\n');
    },
  },
  {
    say: 'And a little bluff. When nobody has bet, one time in five, we bet half the pot, and say something cheeky.',
    run: async (t) => {
      await t.wait(500);
      await t.type('  if can_check and chance(0.2) then\n    say "Hoo hoo!"\n    bet 50% pot\n  end\n');
    },
  },
  {
    say: 'Anything else, check, or fold to a bet.',
    run: async (t) => { await t.type('  check\nend\n'); },
  },
  {
    step: 7,
    say: 'Save with control S.',
    run: async (t) => {
      await Promise.all([t.keys(['Ctrl', 'S'], 1200), t.page.keyboard.press('Control+s')]);
    },
  },
  {
    say: "Now let's see what the bot really does. Try a spot deals a random hand, and plays it until it's our turn.",
    run: async (t) => {
      await t.click('.lab-panel .tab', { text: 'Try a spot' });
      await t.wait(400);
      await t.click('.lab-spot .seg-btn', { text: 'Flop', exact: true });
      await t.wait(300);
      await t.click('.lab-spot .btn.primary');
    },
  },
  {
    say: 'It shows our cards, the board, every value the bot can see, and its decision. The line that made the decision lights up in the editor.',
    run: async (t) => {
      await t.wait(500);
      await t.ring('.spot-cards', 'Our cards and the board', 'left');
      await t.wait(1800);
      await t.ring('.spot-out > .kv-grid', 'What the bot can see', 'left');
      await t.wait(2200);
      await t.ring('.decision', 'The decision', 'left');
      await t.wait(1600);
      await t.click('.lab-spot .btn.primary');
      await t.ring('.ce-flash', 'The line that decided', 'below', '.lab-editor');
    },
  },
  {
    step: 8,
    say: 'Is it any good? The test tab plays a thousand hands against the opponents you pick, in a few seconds.',
    run: async (t) => {
      t.ringOff();
      await t.click('.lab-panel .tab', { text: 'Test' });
      await t.wait(500);
      await t.click('.lab-test .btn.primary');
      await t.page.waitForSelector('.verdict', { timeout: 60000 });
    },
  },
  {
    say: 'This is our score, in big blinds won per hundred hands, with a full leaderboard and a chip graph underneath.',
    run: async (t) => {
      await t.ring('.verdict', 'Big blinds won per 100 hands', 'left');
      await t.wait(2200);
      t.ringOff();
      await t.scrollPanelToBottom();
    },
  },
  {
    step: 9,
    say: "Numbers are nice, but it's more fun to watch. In Simulate, seat Night Owl with the built in bots, and press run.",
    run: async (t) => {
      await t.click('a.nav-link[data-path="/sim"]');
      await t.wait(600);
      await t.chooseSeat(0, 'Night Owl');
      await t.click('.seg-btn', { text: '2×' });
      await t.click('.seg-btn', { text: '50', exact: true });
      await t.click('button', { text: 'Run simulation' });
    },
  },
  {
    say: "You can watch at up to sixteen times speed, pause, step through every action, and show everyone's cards. Every hand goes in the log, and the standings update as you go.",
    run: async (t) => {
      await t.wait(2500);
      await t.ring('.ts-controls', 'Pause, step, speed, show cards', 'below');
      await t.moveTo('.ts-controls .seg', { dx: -40 });
      await t.wait(3000);
      await t.ring('.ts-side', 'Hand log and standings', 'left');
      await t.moveTo('.ts-side', { dy: 80 });
    },
  },
  {
    say: "Let's watch a few hands.",
    run: async (t) => {
      t.ringOff();
      await t.moveTo('.tv-stage', { dx: 300, dy: 260 });
      await t.wait(9000);
    },
  },
  {
    say: "That's the whole loop. Write, check, test, and watch. Open any built in bot to see how it's made, share yours with a link, or open an online table, and let your friends' bots take on yours. Good luck at the tables!",
    end: true,
    run: async (t) => {
      await t.wait(3500);
      t.step(0, 0, null);
      t.card({
        kicker: 'You did it', title: 'Write · Check · Test · <span>Watch</span>',
        bullets: ['Open a built-in bot in the Bot Lab to see how it works', 'Share your bot with a link', 'Open an online table and challenge your friends'],
        url: 'henrywei57.github.io/poker-bot-arena',
      });
    },
  },
];
