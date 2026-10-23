/* Checks js/parity-math.js.

   The reference values below were produced independently in Python using its
   math.erf — a real implementation rather than the Abramowitz & Stegun
   approximation the site uses — so this compares two different methods
   instead of comparing the code to itself.

   Run: node test/parity.test.js      (no dependencies)                     */

'use strict';

const P = require('../js/parity-math.js');

let pass = 0;
const fails = [];
function near(label, got, want, tol) {
  pass++;
  if (!(Math.abs(got - want) <= tol)) {
    pass--;
    fails.push(`${label}: expected ${want}, got ${got} (tolerance ${tol})`);
  }
}
function check(label, got, want) {
  pass++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    pass--;
    fails.push(`${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
}

// --- the normal CDF, against Python's math.erf ---
const CDF = [
  [0, 0.5000000000], [0.5, 0.6914624613], [1, 0.8413447461],
  [1.96, 0.9750021049], [-1.96, 0.0249978951], [2.5, 0.9937903347],
  [-3, 0.0013498980]
];
CDF.forEach(([x, want]) => near(`normCdf(${x})`, P.normCdf(x), want, 1e-7));
check('normCdf is symmetric about a half',
  Math.abs(P.normCdf(1.3) + P.normCdf(-1.3) - 1) < 1e-12, true);
check('normCdf is monotone', P.normCdf(0.2) < P.normCdf(0.21), true);

// --- Black-Scholes, against the same independent source ---
const BS = [
  // S,    K,   r,     T,    sigma, call,          put
  [100, 100, 0.05, 1,    0.2,  10.4505835722, 5.5735260223],
  [100,  95, 0.10, 0.25, 0.5,  13.6952727386, 6.3497143813],
  [ 50,  55, 0.03, 0.5,  0.35,  3.3056038260, 7.4867605041],
  [220, 200, 0.045, 0.75, 0.28, 36.0057021884, 9.3683377327]
];
// The CDF is pinned to 1e-7 above; here we are checking the pricing formula,
// to a tenth of a cent. The approximation's error scales with the stock price
// (1.5e-7 x $220 is already 3e-5), so demanding more than this would be
// measuring the approximation again rather than the formula.
BS.forEach(([S, K, r, T, s, c, p]) => {
  near(`bsCall(${S},${K})`, P.bsCall(S, K, r, T, s), c, 1e-3);
  near(`bsPut(${S},${K})`, P.bsPut(S, K, r, T, s), p, 1e-3);
});

// --- parity is exact for model prices, which is the point ---
BS.forEach(([S, K, r, T, s]) => {
  const c = P.bsCall(S, K, r, T, s), p = P.bsPut(S, K, r, T, s);
  near(`parity holds at K=${K}`, (c - p) - P.synthetic(S, K, r, T), 0, 1e-9);
});

// --- and for prices from any other source too: parity is model-free ---
for (let i = 0; i < 200; i++) {
  const S = 10 + Math.random() * 400, K = 10 + Math.random() * 400;
  const r = Math.random() * 0.1, T = 0.05 + Math.random() * 2;
  const call = Math.random() * 100;                       // an arbitrary quote
  const put = call - P.synthetic(S, K, r, T);             // its parity partner
  if (Math.abs(P.gap({ S, K, r, T, call, put })) > 1e-9) {
    fails.push('parity should hold for any call price, not just model ones');
    break;
  }
}
pass++;

// --- classification ---
const fair = (() => {
  const S = 100, K = 100, r = 0.05, T = 1, s = 0.3;
  return { S, K, r, T, call: P.bsCall(S, K, r, T, s), put: P.bsPut(S, K, r, T, s) };
})();
check('a fair board holds', P.verdict(fair), 'hold');
check('no arbitrage on a fair board', P.arbitrage(fair), null);
check('a two-cent rounding error still holds',
  P.verdict({ ...fair, call: fair.call + 0.02 }), 'hold');
check('an expensive call is call-rich',
  P.verdict({ ...fair, call: fair.call + 0.60 }), 'call-rich');
check('a cheap put is also call-rich',
  P.verdict({ ...fair, put: fair.put - 0.60 }), 'call-rich');
check('a cheap call is call-cheap',
  P.verdict({ ...fair, call: fair.call - 0.60 }), 'call-cheap');
check('an expensive put is also call-cheap',
  P.verdict({ ...fair, put: fair.put + 0.60 }), 'call-cheap');

// --- the trade, and that it actually earns the gap ---
const rich = { ...fair, call: fair.call + 0.75 };
const cheap = { ...fair, call: fair.call - 0.75 };
check('call-rich is a conversion', P.arbitrage(rich).name, 'Conversion');
check('call-cheap is a reversal', P.arbitrage(cheap).name, 'Reversal');
near('conversion earns the gap', P.arbitrage(rich).profit, 0.75, 1e-9);
near('reversal earns the gap', P.arbitrage(cheap).profit, 0.75, 1e-9);
check('profit is always positive', P.arbitrage(rich).profit > 0 && P.arbitrage(cheap).profit > 0, true);
check('a conversion has four legs', P.arbitrage(rich).legs.length, 4);

// --- generated rounds: deterministic under a seeded generator ---
function seeded(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

let fairCount = 0, riggedCount = 0, bad = 0;
for (let i = 1; i <= 4000; i++) {
  const b = P.buildRound(seeded(i));
  if (!(b.call > 0 && b.put > 0)) { bad++; continue; }
  if (!(b.S > 0 && b.K > 0 && b.T > 0 && b.r > 0)) { bad++; continue; }
  const v = P.verdict(b);
  if (b.mispricedLeg === null) {
    fairCount++;
    if (v !== 'hold') { bad++; fails.push(`round ${i}: untouched board graded ${v}`); }
  } else {
    riggedCount++;
    // A nudged leg must be far enough outside tolerance to be findable.
    if (v === 'hold') { bad++; fails.push(`round ${i}: a mispriced board graded as fair`); }
    const arb = P.arbitrage(b);
    if (!arb || arb.profit <= 0) { bad++; fails.push(`round ${i}: no profitable trade on a mispriced board`); }
  }
}
check('every generated board is well formed and graded correctly', bad, 0);
check('both kinds of board get generated', fairCount > 500 && riggedCount > 500, true);
check('generation is deterministic under a seed',
  JSON.stringify(P.buildRound(seeded(99))), JSON.stringify(P.buildRound(seeded(99))));

if (fails.length) {
  console.error(`FAIL — ${fails.length} of ${pass + fails.length}\n`);
  fails.slice(0, 12).forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`ok — ${pass} parity checks passed (${fairCount} fair boards, ${riggedCount} mispriced)`);
