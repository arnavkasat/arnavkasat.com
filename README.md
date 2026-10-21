# arnavkasat.com

My personal site, built as a retro casino floor. Hand-written HTML, CSS and
JavaScript — no framework, no build step, no dependencies, no trackers. Clone it
and open `index.html` and it works.

The conceit is not decoration. Every game on the floor is mathematically honest:
the blackjack trainer grades you against the basic-strategy table for its exact
rules, the roulette table prints the expected value of your bet before you spin,
and the probability quiz shows the combinatorics behind every answer. A casino
theme that faked its own math would be a strange thing for me to ship.

```
.
├── index.html              resume, projects, links
├── css/retro.css           the whole theme: neon, felt, CRT, layout
├── js/
│   ├── site.js             CRT toggle, nav highlighting
│   ├── strategy.js         blackjack chart + hand arithmetic (tested)
│   ├── blackjack.js        shoe, dealing, splits, insurance, grading
│   ├── roulette.js         bet pricing, spins, Monte Carlo
│   ├── odds.js             probability questions and derivations
│   └── pickleball.js       court geometry, physics, rules, opponent AI
├── games/                  one page per game
└── test/strategy.test.js   324 assertions, no dependencies
```

## Running it

```sh
python3 -m http.server 8787     # then open http://localhost:8787
```

A plain file:// open won't work — the pages use absolute paths (`/css/retro.css`)
so that the games in `/games/` share one copy of everything.

## Tests

```sh
node test/strategy.test.js      # or: npm test
```

The blackjack strategy chart is checked cell by cell — every player hand against
every dealer upcard, hard totals, soft totals and pairs, plus the hand arithmetic
and the Hi-Lo tags. 324 assertions, no test framework.

This is worth testing because the chart is rule-specific, and two cells flip
between rule sets: **hard 11 against an ace** and **soft 18 against a 2** are
played differently when the dealer hits soft 17. A chart copied from an H17 game
would grade both of those wrong against these S17 rules. The test caught a third
bug on its first run — a pair of aces that can't be split is a soft 12 and must
be hit, and the code was standing on it.

## The games

**Blackjack — count trainer.** Six decks, dealer stands on all 17s and peeks,
double on any two cards, double after split, split to four hands, no surrender,
blackjack pays 3:2. Every action you take is graded against basic strategy for
exactly those rules. The Hi-Lo running count only ever includes cards that are
actually visible — the hole card joins the count the moment it is turned over,
not when it is dealt — and you can call the count at any time, or have the game
demand it between hands. Insurance is graded separately against the true count,
since it is the one decision where counting changes the answer outright.

**Roulette.** Every bet is priced before the wheel turns: pockets covered, win
probability, payout, and expected value. They all come to −2.70% on the
single-zero wheel and −5.26% on the double-zero wheel, because the payouts are
set as if there were 36 pockets and there are 37 or 38. The Monte Carlo button
runs the same layout thousands of times to show the realized return settling onto
that number. It deliberately does not touch the bankroll: $15 a spin for ten
thousand spins busts a $1,000 stack long before the average shows up, which is
gambler's ruin — a real lesson, but a different one.

**Odds Oracle.** Sixteen probability questions. Commit to a number, get scored on
the absolute error, and see the derivation. The values are exact, computed from
the combinatorics rather than recalled.

**Pickleball.** Top-down, on a court to scale — 20 by 44 feet with a 7-foot
non-volley zone either side of the net. The serve must bounce before the return,
a serve landing in the kitchen is a fault, and volleying from inside the kitchen
loses the rally, for the computer as much as for you. The ball is launched by
solving for the velocity that lands it on a chosen spot, which is what keeps
shots inside the lines; catching the ball off the edge of the paddle is what
sends them wide. Rally scoring to 11, win by 2.

## Deployment

Static files from the repository root, deployed on Vercel, pointed at
`arnavkasat.com`. There is nothing to build and no server to run.

## License

Code is MIT. The résumé content, name, and biography are not.
