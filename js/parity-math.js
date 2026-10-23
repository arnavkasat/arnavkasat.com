/* ===========================================================
   Put-call parity, and just enough Black-Scholes to quote a
   board that looks like a real one.

   For European options on a non-dividend-paying stock:

       C - P = S - K·e^(-rT)

   This is not a model. It falls out of the fact that a long
   call and a short put at the same strike and expiry have
   exactly the payoff of the stock financed to that date, so
   the two sides must cost the same today or the difference
   can be taken for nothing. It holds whatever volatility is,
   whatever distribution returns follow, and whether or not
   Black-Scholes is true.

   Black-Scholes appears here only to generate quotes that
   look plausible. The game never needs it: the gap being
   scored is model-free.

   Exported for the browser as `window.Parity` and for Node
   (the tests) as module.exports.
   =========================================================== */

(function (root) {
  'use strict';

  // Tolerance, in dollars, inside which the board counts as fair. Quotes are
  // rounded to a cent, so a fair board can be off by at most two cents; the
  // smallest mispricing injected is 0.15, which leaves daylight between them.
  var TOL = 0.05;

  // Abramowitz & Stegun 7.1.26 — about 1.5e-7 absolute error, far tighter
  // than anything quoted in cents can notice.
  function erf(x) {
    var sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
                  - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return sign * y;
  }

  function normCdf(x) {
    return 0.5 * (1 + erf(x / Math.SQRT2));
  }

  function d1(S, K, r, T, sig) {
    return (Math.log(S / K) + (r + sig * sig / 2) * T) / (sig * Math.sqrt(T));
  }

  function bsCall(S, K, r, T, sig) {
    var a = d1(S, K, r, T, sig);
    var b = a - sig * Math.sqrt(T);
    return S * normCdf(a) - K * Math.exp(-r * T) * normCdf(b);
  }

  function bsPut(S, K, r, T, sig) {
    var a = d1(S, K, r, T, sig);
    var b = a - sig * Math.sqrt(T);
    return K * Math.exp(-r * T) * normCdf(-b) - S * normCdf(-a);
  }

  // The synthetic stock: what C - P ought to cost.
  function synthetic(S, K, r, T) {
    return S - K * Math.exp(-r * T);
  }

  // Positive gap means the call side is rich relative to the put side.
  function gap(board) {
    return (board.call - board.put) - synthetic(board.S, board.K, board.r, board.T);
  }

  function verdict(board) {
    var g = gap(board);
    if (Math.abs(g) <= TOL) return 'hold';
    return g > 0 ? 'call-rich' : 'call-cheap';
  }

  // The trade that takes the gap, and what it earns per share.
  function arbitrage(board) {
    var g = gap(board);
    var v = verdict(board);
    if (v === 'hold') return null;
    var bond = board.K * Math.exp(-board.r * board.T);
    if (v === 'call-rich') {
      return {
        name: 'Conversion',
        profit: g,
        legs: [
          'Sell the call at ' + money(board.call),
          'Buy the put at ' + money(board.put),
          'Buy the stock at ' + money(board.S),
          'Borrow ' + money(bond) + ', repay ' + money(board.K) + ' at expiry'
        ]
      };
    }
    return {
      name: 'Reversal',
      profit: -g,
      legs: [
        'Buy the call at ' + money(board.call),
        'Sell the put at ' + money(board.put),
        'Short the stock at ' + money(board.S),
        'Lend ' + money(bond) + ', collect ' + money(board.K) + ' at expiry'
      ]
    };
  }

  function money(x) {
    return '$' + x.toFixed(2);
  }

  var TENORS = [
    { T: 1 / 12, label: '1 month' },
    { T: 2 / 12, label: '2 months' },
    { T: 3 / 12, label: '3 months' },
    { T: 6 / 12, label: '6 months' },
    { T: 9 / 12, label: '9 months' },
    { T: 1, label: '1 year' }
  ];

  function pick(arr, rand) { return arr[Math.floor(rand() * arr.length)]; }
  function between(lo, hi, rand) { return lo + rand() * (hi - lo); }

  // Build one quote board. Half of them are fair; the rest have one leg
  // nudged far enough to be worth taking.
  function buildRound(rand) {
    rand = rand || Math.random;

    var S, K, r, T, sig, tenor, call, put;
    for (var tries = 0; tries < 50; tries++) {
      S = Math.round(between(25, 320, rand) * 100) / 100;
      // Strikes sit on a sensible grid near the money.
      var step = S < 60 ? 2.5 : S < 150 ? 5 : 10;
      K = Math.round((S * between(0.84, 1.16, rand)) / step) * step;
      if (K <= 0) continue;
      tenor = pick(TENORS, rand);
      T = tenor.T;
      r = Math.round(between(0.01, 0.06, rand) * 1000) / 1000;
      sig = between(0.18, 0.65, rand);

      call = bsCall(S, K, r, T, sig);
      put = bsPut(S, K, r, T, sig);
      // Keep both legs worth quoting, so neither is a giveaway.
      if (call >= 0.4 && put >= 0.4 && call < S) break;
    }

    call = Math.round(call * 100) / 100;
    put = Math.round(put * 100) / 100;

    var mispriced = rand() < 0.55;
    var leg = null, nudge = 0;
    if (mispriced) {
      nudge = between(0.15, 2.6, rand) * (rand() < 0.5 ? -1 : 1);
      leg = rand() < 0.5 ? 'call' : 'put';
      var moved = Math.round((leg === 'call' ? call + nudge : put + nudge) * 100) / 100;
      // A negative quote would give the game away on sight.
      if (moved > 0.05) {
        if (leg === 'call') call = moved; else put = moved;
      } else {
        mispriced = false; leg = null;
      }
    }

    return {
      S: S, K: K, r: r, T: T, tenorLabel: tenor.label,
      call: call, put: put,
      sigma: sig,           // only used to make the quotes, never shown as truth
      mispricedLeg: leg
    };
  }

  var api = {
    TOL: TOL,
    erf: erf,
    normCdf: normCdf,
    bsCall: bsCall,
    bsPut: bsPut,
    synthetic: synthetic,
    gap: gap,
    verdict: verdict,
    arbitrage: arbitrage,
    buildRound: buildRound,
    money: money,
    TENORS: TENORS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Parity = api;
})(typeof self !== 'undefined' ? self : this);
