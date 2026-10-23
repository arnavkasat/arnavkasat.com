/* ===========================================================
   The parity table.

   A quote board appears; you say whether put-call parity holds
   on it, and if not, which side is rich. Get it wrong and the
   board shows you the identity, the gap, and the four-leg
   trade that would have taken it.

   All the arithmetic lives in js/parity-math.js, which is
   tested against an independent implementation.
   =========================================================== */

(function () {
  'use strict';

  var P = window.Parity;

  var S = {
    board: null,
    answered: false,
    rounds: 0,
    right: 0,
    streak: 0,
    best: 0
  };

  var el = {};
  ['stock', 'strike', 'expiry', 'rate', 'callPx', 'putPx',
   'btnHold', 'btnRich', 'btnCheap', 'btnNext',
   'verdictLine', 'workings', 'trade', 'log',
   'roundCount', 'accuracy', 'streakNow', 'streakBest'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  function money(x) { return P.money(x); }

  function deal() {
    S.board = P.buildRound();
    S.answered = false;

    el.stock.textContent = money(S.board.S);
    el.strike.textContent = money(S.board.K);
    el.expiry.textContent = S.board.tenorLabel;
    el.rate.textContent = (S.board.r * 100).toFixed(1) + '%';
    el.callPx.textContent = money(S.board.call);
    el.putPx.textContent = money(S.board.put);

    el.verdictLine.textContent = '';
    el.verdictLine.className = 'parity-verdict';
    el.workings.style.display = 'none';
    el.trade.style.display = 'none';

    [el.btnHold, el.btnRich, el.btnCheap].forEach(function (b) { b.disabled = false; });
    el.btnNext.disabled = true;
  }

  var LABEL = {
    'hold': 'parity holds',
    'call-rich': 'the call side is rich',
    'call-cheap': 'the call side is cheap'
  };

  function answer(choice) {
    if (S.answered || !S.board) return;
    S.answered = true;

    var truth = P.verdict(S.board);
    var right = choice === truth;
    var g = P.gap(S.board);
    var synth = P.synthetic(S.board.S, S.board.K, S.board.r, S.board.T);

    S.rounds++;
    if (right) {
      S.right++;
      S.streak++;
      if (S.streak > S.best) S.best = S.streak;
    } else {
      S.streak = 0;
    }

    el.verdictLine.textContent = right
      ? '✓ Right — ' + LABEL[truth] + '.'
      : '✗ No — ' + LABEL[truth] + '.';
    el.verdictLine.className = 'parity-verdict ' + (right ? 'ok' : 'bad');

    // Show the identity with this board's numbers in it.
    el.workings.innerHTML =
      '<div class="parity-row"><span>C − P</span><b>' +
        money(S.board.call) + ' − ' + money(S.board.put) +
        ' = ' + money(S.board.call - S.board.put) + '</b></div>' +
      '<div class="parity-row"><span>S − K·e<sup>−rT</sup></span><b>' +
        money(S.board.S) + ' − ' + money(S.board.K * Math.exp(-S.board.r * S.board.T)) +
        ' = ' + money(synth) + '</b></div>' +
      '<div class="parity-row gap"><span>gap</span><b>' +
        (g >= 0 ? '+' : '−') + money(Math.abs(g)).slice(1) +
        '</b></div>' +
      '<p class="mono faint" style="margin:8px 0 0">' +
        (truth === 'hold'
          ? 'Inside the ' + money(P.TOL) + ' tolerance — that is rounding, not an edge.'
          : 'Outside the ' + money(P.TOL) + ' tolerance, so there is a trade in it.') +
      '</p>';
    el.workings.style.display = '';

    var arb = P.arbitrage(S.board);
    if (arb) {
      el.trade.innerHTML =
        '<h3 style="color:var(--neon-gold);margin-bottom:4px">' + arb.name + '</h3>' +
        '<p class="mono faint" style="margin:0 0 10px">Locks ' + money(arb.profit) +
        ' a share — ' + money(arb.profit * 100) + ' on a 100-share contract — ' +
        'with nothing at risk at expiry.</p>' +
        '<ol class="parity-legs">' +
        arb.legs.map(function (l) { return '<li>' + l + '</li>'; }).join('') +
        '</ol>';
      el.trade.style.display = '';
    }

    var line = document.createElement('div');
    line.className = right ? 'ok' : 'bad';
    line.textContent = (right ? '✓ ' : '✗ ') +
      'said ' + LABEL[choice] + ', gap ' + (g >= 0 ? '+' : '−') +
      Math.abs(g).toFixed(2);
    el.log.insertBefore(line, el.log.firstChild);
    while (el.log.childNodes.length > 40) el.log.removeChild(el.log.lastChild);

    [el.btnHold, el.btnRich, el.btnCheap].forEach(function (b) { b.disabled = true; });
    el.btnNext.disabled = false;
    render();
  }

  function render() {
    el.roundCount.textContent = S.rounds;
    el.accuracy.textContent = S.rounds ? Math.round(100 * S.right / S.rounds) + '%' : '—';
    el.streakNow.textContent = S.streak;
    el.streakBest.textContent = S.best;
  }

  el.btnHold.addEventListener('click', function () { answer('hold'); });
  el.btnRich.addEventListener('click', function () { answer('call-rich'); });
  el.btnCheap.addEventListener('click', function () { answer('call-cheap'); });
  el.btnNext.addEventListener('click', deal);

  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === '1' && !el.btnHold.disabled) answer('hold');
    else if (e.key === '2' && !el.btnRich.disabled) answer('call-rich');
    else if (e.key === '3' && !el.btnCheap.disabled) answer('call-cheap');
    else if ((e.key === ' ' || e.key === 'Enter') && !el.btnNext.disabled) {
      e.preventDefault(); deal();
    }
  });

  if (window.LB) {
    LB.attach({
      game: 'parity',
      read: function () {
        return {
          score: S.rounds ? 100 * S.right / S.rounds : 0,
          eligible: S.rounds >= 20,
          need: 'Call ' + Math.max(0, 20 - S.rounds) + ' more boards to post a score.',
          detail: { rounds: S.rounds, streak: S.best }
        };
      }
    });
  }

  deal();
  render();
})();
