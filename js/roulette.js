/* ===========================================================
   Roulette, with the arithmetic shown.

   Every bet on this table is priced the same way:

       EV per unit staked = p·(payout) − (1 − p)

   where p is the real probability of the bet landing. On a
   single-zero wheel every standard bet comes out to exactly
   −1/37 = −2.70%; on a double-zero wheel, −2/38 = −5.26%.
   That identity is the whole point of the game: the wheel does
   not care which bet you like, only how many pockets it has.

   (The one exception is the American five-number bet on
   0-00-1-2-3, which pays 6:1 and runs −7.89%. It is not on
   this layout because nobody should place it.)
   =========================================================== */

(function () {
  'use strict';

  var RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

  function isRed(n) { return RED.indexOf(n) !== -1; }

  var S = {
    wheel: 'eu',            // 'eu' = 37 pockets, 'us' = 38
    chip: 5,
    bets: {},               // key -> amount staked this spin
    lastBets: {},            // the layout just resolved, for Rebet
    bankroll: 1000,
    spins: 0,
    wagered: 0,
    net: 0,
    history: [],            // recent winning numbers
    spinning: false
  };

  var el = {};
  ['grid', 'outside', 'bankroll', 'wagered', 'netResult', 'realized', 'theoretical',
   'spinCount', 'result', 'evPanel', 'log', 'btnSpin', 'btnClear', 'btnSim', 'btnRebet', 'simResult',
   'simCount', 'chipRow', 'wheelSel', 'history', 'pocketCount'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  function pockets() {
    var p = [];
    for (var i = 0; i <= 36; i++) p.push(String(i));
    if (S.wheel === 'us') p.push('00');
    return p;
  }

  function pocketTotal() { return S.wheel === 'us' ? 38 : 37; }

  function houseEdge() { return S.wheel === 'us' ? -2 / 38 : -1 / 37; }

  // ---------- bet definitions ----------

  function dozen(i) {
    var out = [];
    for (var n = i * 12 + 1; n <= i * 12 + 12; n++) out.push(String(n));
    return out;
  }
  function column(i) {
    var out = [];
    for (var n = i + 1; n <= 36; n += 3) out.push(String(n));
    return out;
  }
  function range(a, b) {
    var out = [];
    for (var n = a; n <= b; n++) out.push(String(n));
    return out;
  }
  function colored(red) {
    var out = [];
    for (var n = 1; n <= 36; n++) if (isRed(n) === red) out.push(String(n));
    return out;
  }
  function parity(odd) {
    var out = [];
    for (var n = 1; n <= 36; n++) if ((n % 2 === 1) === odd) out.push(String(n));
    return out;
  }

  function betDef(key) {
    if (key.indexOf('n:') === 0) {
      return { label: 'Straight up ' + key.slice(2), numbers: [key.slice(2)], payout: 35 };
    }
    switch (key) {
      case 'red':   return { label: 'Red',       numbers: colored(true),  payout: 1 };
      case 'black': return { label: 'Black',     numbers: colored(false), payout: 1 };
      case 'odd':   return { label: 'Odd',       numbers: parity(true),   payout: 1 };
      case 'even':  return { label: 'Even',      numbers: parity(false),  payout: 1 };
      case 'low':   return { label: '1 to 18',   numbers: range(1, 18),   payout: 1 };
      case 'high':  return { label: '19 to 36',  numbers: range(19, 36),  payout: 1 };
      case 'd1':    return { label: '1st dozen', numbers: dozen(0),       payout: 2 };
      case 'd2':    return { label: '2nd dozen', numbers: dozen(1),       payout: 2 };
      case 'd3':    return { label: '3rd dozen', numbers: dozen(2),       payout: 2 };
      case 'c1':    return { label: 'Column 1',  numbers: column(0),      payout: 2 };
      case 'c2':    return { label: 'Column 2',  numbers: column(1),      payout: 2 };
      case 'c3':    return { label: 'Column 3',  numbers: column(2),      payout: 2 };
      default:      return null;
    }
  }

  function betMath(key) {
    var def = betDef(key);
    var p = def.numbers.length / pocketTotal();
    var ev = p * def.payout - (1 - p);
    return { def: def, p: p, ev: ev };
  }

  // ---------- layout ----------

  function buildGrid() {
    el.grid.innerHTML = '';

    // zeroes
    var zeros = document.createElement('div');
    zeros.className = 'rl-zeros';
    ['0'].concat(S.wheel === 'us' ? ['00'] : []).forEach(function (z) {
      zeros.appendChild(numberCell(z, 'green'));
    });
    el.grid.appendChild(zeros);

    // 12 x 3 number block, laid out the way a real felt is: columns of 3
    var nums = document.createElement('div');
    nums.className = 'rl-nums';
    for (var col = 0; col < 12; col++) {
      for (var row = 0; row < 3; row++) {
        var n = col * 3 + (3 - row);
        nums.appendChild(numberCell(String(n), isRed(n) ? 'red' : 'black'));
      }
    }
    el.grid.appendChild(nums);
    paintBets();
  }

  function numberCell(n, color) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'rl-cell ' + color;
    b.dataset.key = 'n:' + n;
    b.innerHTML = '<span>' + n + '</span><em></em>';
    return b;
  }

  function buildOutside() {
    var groups = [
      ['d1', '1st 12'], ['d2', '2nd 12'], ['d3', '3rd 12'],
      ['low', '1-18'], ['even', 'Even'], ['red', 'Red'],
      ['black', 'Black'], ['odd', 'Odd'], ['high', '19-36'],
      ['c1', 'Col 1'], ['c2', 'Col 2'], ['c3', 'Col 3']
    ];
    el.outside.innerHTML = '';
    groups.forEach(function (g) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'rl-out';
      if (g[0] === 'red') b.classList.add('red');
      if (g[0] === 'black') b.classList.add('black');
      b.dataset.key = g[0];
      b.innerHTML = '<span>' + g[1] + '</span><em></em>';
      el.outside.appendChild(b);
    });
    paintBets();
  }

  function paintBets() {
    [].forEach.call(document.querySelectorAll('[data-key]'), function (node) {
      var amt = S.bets[node.dataset.key] || 0;
      var tag = node.querySelector('em');
      if (tag) tag.textContent = amt ? '$' + amt : '';
      node.classList.toggle('staked', amt > 0);
    });
  }

  function placeBet(key) {
    if (S.spinning) return;
    if (!betDef(key)) return;
    if (S.chip > S.bankroll) { flash('Not enough bankroll.'); return; }
    S.bets[key] = (S.bets[key] || 0) + S.chip;
    S.bankroll -= S.chip;
    paintBets();
    render();
  }

  function clearBets() {
    if (S.spinning) return;
    Object.keys(S.bets).forEach(function (k) { S.bankroll += S.bets[k]; });
    S.bets = {};
    paintBets();
    render();
  }

  // ---------- spinning ----------

  function spinOnce() {
    var p = pockets();
    return p[Math.floor(Math.random() * p.length)];
  }

  function settle(winner) {
    var staked = 0, returned = 0;
    Object.keys(S.bets).forEach(function (key) {
      var amt = S.bets[key];
      var def = betDef(key);
      staked += amt;
      if (def.numbers.indexOf(winner) !== -1) {
        returned += amt * (def.payout + 1);   // stake back plus winnings
      }
    });
    S.bankroll += returned;
    S.wagered += staked;
    S.net += returned - staked;
    S.spins++;
    S.history.unshift(winner);
    if (S.history.length > 18) S.history.pop();

    // The stake was debited when the chips went down, so the felt is swept
    // and the layout is kept for Rebet rather than silently riding again.
    S.lastBets = S.bets;
    S.bets = {};
    paintBets();
    return returned - staked;
  }

  function rebet() {
    if (S.spinning) return;
    var keys = Object.keys(S.lastBets);
    if (!keys.length) { flash('No previous layout to repeat.'); return; }
    var total = keys.reduce(function (a, k) { return a + S.lastBets[k]; }, 0);
    if (total > S.bankroll) { flash('Not enough bankroll to repeat that layout.'); return; }
    keys.forEach(function (k) {
      S.bets[k] = (S.bets[k] || 0) + S.lastBets[k];
      S.bankroll -= S.lastBets[k];
    });
    paintBets();
    render();
  }

  function spin() {
    if (S.spinning) return;
    var keys = Object.keys(S.bets);
    if (!keys.length) { flash('Place a bet first.'); return; }

    S.spinning = true;
    el.btnSpin.disabled = true;
    var winner = spinOnce();

    // A short tease: show random pockets, slowing down, then the real one.
    var start = performance.now();
    var DURATION = 1300;
    (function frame(now) {
      var t = Math.min((now - start) / DURATION, 1);
      if (t < 1) {
        // ease-out: fewer, slower flickers as it settles
        if (Math.random() < 1 - t * t) showResult(spinOnce(), true);
        requestAnimationFrame(frame);
      } else {
        var delta = settle(winner);
        showResult(winner, false);
        log((winner === '0' || winner === '00' ? winner + ' green' :
             (isRed(Number(winner)) ? winner + ' red' : winner + ' black')) +
            ' — ' + (delta >= 0 ? '+$' + delta : '-$' + Math.abs(delta)),
            delta > 0 ? 'ok' : delta < 0 ? 'bad' : 'note');
        S.spinning = false;
        render();
      }
    })(start);
  }

  function showResult(n, provisional) {
    var cls = (n === '0' || n === '00') ? 'green' : (isRed(Number(n)) ? 'red' : 'black');
    el.result.className = 'rl-result ' + cls + (provisional ? ' blur' : '');
    el.result.textContent = n;
  }

  // Run a lot of spins at once, repeating the current layout. This is the
  // honest demonstration: realized return walks toward the house edge and
  // stays there.
  // Run the current layout many times over. This deliberately does not touch
  // the bankroll: $15 a spin for 10,000 spins would bust a $1,000 stack long
  // before the average had room to show itself, which is gambler's ruin, a
  // different lesson than the one this button is for.
  function simulate() {
    var n = parseInt(el.simCount.value, 10) || 1000;
    var keys = Object.keys(S.bets);
    if (!keys.length) { flash('Place a bet first \u2014 the simulation repeats your layout.'); return; }

    var staked = 0, returned = 0, hits = 0;
    for (var i = 0; i < n; i++) {
      var w = spinOnce();
      for (var j = 0; j < keys.length; j++) {
        var def = betDef(keys[j]);
        var amt = S.bets[keys[j]];
        staked += amt;
        if (def.numbers.indexOf(w) !== -1) { returned += amt * (def.payout + 1); hits++; }
      }
    }

    S.wagered += staked;
    S.net += returned - staked;
    S.spins += n;

    var realized = staked ? (returned - staked) / staked : 0;
    var theory = houseEdge();
    el.simResult.innerHTML =
      '<p class="mono" style="margin:0 0 6px;color:var(--neon-cyan)">' +
        n.toLocaleString() + ' spins of your layout</p>' +
      '<p class="mono faint" style="margin:0">staked $' + staked.toLocaleString() +
        ' \u00b7 returned $' + returned.toLocaleString() +
        ' \u00b7 ' + hits.toLocaleString() + ' winning bets</p>' +
      '<p class="mono" style="margin:6px 0 0">realized <strong style="color:' +
        (realized < 0 ? 'var(--neon-red)' : 'var(--neon-green)') + '">' +
        (realized * 100).toFixed(3) + '%</strong> vs theoretical <strong style="color:var(--neon-gold)">' +
        (theory * 100).toFixed(2) + '%</strong> \u2014 off by ' +
        Math.abs((realized - theory) * 100).toFixed(3) + ' points</p>';

    log(n.toLocaleString() + ' simulated spins: realized ' + (realized * 100).toFixed(3) +
        '% vs theoretical ' + (theory * 100).toFixed(2) + '%', 'note');
    render();
  }

  // ---------- readouts ----------

  function render() {
    el.bankroll.textContent = '$' + Math.round(S.bankroll).toLocaleString();
    el.wagered.textContent = '$' + Math.round(S.wagered).toLocaleString();
    el.netResult.textContent = (S.net >= 0 ? '+$' : '-$') + Math.abs(Math.round(S.net)).toLocaleString();
    el.netResult.className = 'v ' + (S.net > 0 ? '' : S.net < 0 ? 'red' : 'gold');
    el.realized.textContent = S.wagered ? (100 * S.net / S.wagered).toFixed(2) + '%' : '—';
    el.theoretical.textContent = (houseEdge() * 100).toFixed(2) + '%';
    el.spinCount.textContent = S.spins.toLocaleString();
    el.pocketCount.textContent = pocketTotal();

    // per-bet expected value, before the wheel turns
    var keys = Object.keys(S.bets);
    if (!keys.length) {
      el.evPanel.innerHTML = '<p class="dim" style="margin:0">' +
        'Click the felt to place chips. Each bet’s probability, payout, and ' +
        'expected value shows up here before you spin.</p>';
    } else {
      var rows = ['<table class="rl-table"><thead><tr>' +
        '<th>Bet</th><th>Stake</th><th>Pays</th><th>P(win)</th><th>EV</th></tr></thead><tbody>'];
      var totalEV = 0, totalStake = 0;
      keys.forEach(function (k) {
        var m = betMath(k);
        var stake = S.bets[k];
        var ev = m.ev * stake;
        totalEV += ev;
        totalStake += stake;
        rows.push('<tr><td>' + m.def.label + '</td><td>$' + stake + '</td><td>' +
          m.def.payout + ':1</td><td>' + (m.p * 100).toFixed(2) + '%</td><td class="' +
          (ev < 0 ? 'neg' : 'pos') + '">' + (ev >= 0 ? '+' : '−') + '$' +
          Math.abs(ev).toFixed(3) + '</td></tr>');
      });
      rows.push('</tbody><tfoot><tr><th>Total</th><th>$' + totalStake + '</th><th></th><th></th>' +
        '<th class="' + (totalEV < 0 ? 'neg' : 'pos') + '">' + (totalEV >= 0 ? '+' : '−') +
        '$' + Math.abs(totalEV).toFixed(3) + '</th></tr></tfoot></table>');
      rows.push('<p class="mono faint" style="margin:10px 0 0">Expected loss per spin: $' +
        Math.abs(totalEV).toFixed(3) + ' on $' + totalStake + ' staked = ' +
        (100 * totalEV / totalStake).toFixed(2) + '%. Every bet on the layout comes to the ' +
        'same percentage — that is what a house edge is.</p>');
      el.evPanel.innerHTML = rows.join('');
    }

    // recent numbers
    el.history.innerHTML = '';
    S.history.forEach(function (n) {
      var s = document.createElement('span');
      s.className = 'rl-chip-hist ' + ((n === '0' || n === '00') ? 'green' : (isRed(Number(n)) ? 'red' : 'black'));
      s.textContent = n;
      el.history.appendChild(s);
    });

    el.btnSpin.disabled = S.spinning || !Object.keys(S.bets).length;
  }

  function log(msg, cls) {
    var d = document.createElement('div');
    if (cls) d.className = cls;
    d.textContent = msg;
    el.log.insertBefore(d, el.log.firstChild);
    while (el.log.childNodes.length > 40) el.log.removeChild(el.log.lastChild);
  }

  function flash(msg) { log(msg, 'note'); }

  // ---------- wiring ----------

  el.grid.addEventListener('click', function (e) {
    var cell = e.target.closest('[data-key]');
    if (cell) placeBet(cell.dataset.key);
  });
  el.outside.addEventListener('click', function (e) {
    var cell = e.target.closest('[data-key]');
    if (cell) placeBet(cell.dataset.key);
  });
  el.chipRow.addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    S.chip = parseInt(chip.dataset.amt, 10);
    [].forEach.call(el.chipRow.querySelectorAll('.chip'), function (c) {
      c.classList.toggle('sel', c === chip);
    });
  });
  el.btnSpin.addEventListener('click', spin);
  el.btnClear.addEventListener('click', clearBets);
  el.btnSim.addEventListener('click', simulate);
  el.btnRebet.addEventListener('click', rebet);
  el.wheelSel.addEventListener('change', function () {
    clearBets();
    S.wheel = el.wheelSel.value;
    buildGrid();
    log('Switched to the ' + (S.wheel === 'us' ? 'American double-zero' : 'European single-zero') +
        ' wheel — ' + pocketTotal() + ' pockets, house edge ' +
        (houseEdge() * 100).toFixed(2) + '%.', 'note');
    render();
  });

  buildGrid();
  buildOutside();
  showResult('0', false);
  el.result.textContent = '–';
  render();
})();
