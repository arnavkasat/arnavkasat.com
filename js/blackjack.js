/* ===========================================================
   Blackjack count trainer.

   House rules, fixed and stated on the page so the strategy
   table below is the correct one for them:
     - 6 decks, dealt to 75% penetration
     - dealer stands on all 17s (S17) and peeks for blackjack
     - double on any first two cards, double after split (DAS)
     - split to four hands, aces split once and draw one card
     - no surrender, blackjack pays 3:2, insurance pays 2:1

   Counting is Hi-Lo. The running count only ever includes cards
   the player can actually see: the dealer's hole card is added
   at the moment it is turned over, not when it is dealt.
   =========================================================== */

(function () {
  'use strict';

  var BJ = window.BJ;                 // js/strategy.js — chart + hand arithmetic
  var cardValue = BJ.cardValue;
  var handTotal = BJ.handTotal;
  var isBlackjack = BJ.isBlackjack;
  var ACTION_NAME = BJ.ACTION_NAME;

  var DECKS = 6;
  var PENETRATION = 0.75;      // reshuffle once 75% of the shoe is gone
  var RANKS = BJ.RANKS;
  var SUITS = [
    { ch: '\u2660', red: false }, // spade
    { ch: '\u2665', red: true  }, // heart
    { ch: '\u2663', red: false }, // club
    { ch: '\u2666', red: true  }  // diamond
  ];

  // ---------- state ----------

  var S = {
    shoe: [],
    seen: 0,
    running: 0,
    dealer: [],
    holeCounted: false,
    hands: [],
    active: 0,
    bankroll: 1000,
    bet: 25,
    phase: 'betting',       // betting | insurance | playing | dealer | done
    insuranceBet: 0,
    handsPlayed: 0,
    decisions: 0,
    decisionsRight: 0,
    countCalls: 0,
    countRight: 0,
    peeking: false,         // "show me the book" — unscored
    askCount: false,
    countOwed: false,
    needsShuffle: false
  };

  var el = {};
  ['dealerHand', 'playerHands', 'runCount', 'trueCount', 'decksLeft', 'cardsSeen',
   'bankroll', 'betAmt', 'handsPlayed', 'stratAcc', 'countAcc', 'banner', 'log',
   'btnDeal', 'btnHit', 'btnStand', 'btnDouble', 'btnSplit', 'insurancePanel',
   'btnIns', 'btnNoIns', 'countPanel', 'countInput', 'btnCallCount', 'countFeedback', 'btnReset',
   'chipRow', 'peekToggle', 'askToggle', 'hint', 'dealerLabel'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  // ---------- shoe ----------

  function buildShoe() {
    var cards = [];
    for (var d = 0; d < DECKS; d++) {
      for (var s = 0; s < SUITS.length; s++) {
        for (var r = 0; r < RANKS.length; r++) {
          cards.push({ r: RANKS[r], s: SUITS[s] });
        }
      }
    }
    // Fisher-Yates
    for (var i = cards.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = cards[i]; cards[i] = cards[j]; cards[j] = t;
    }
    S.shoe = cards;
    S.seen = 0;
    S.running = 0;
    S.needsShuffle = false;
    log('Shuffled ' + DECKS + ' decks. Running count resets to 0.', 'note');
  }

  function draw() {
    if (!S.shoe.length) buildShoe();
    return S.shoe.pop();
  }

  // A card the player can see — this is the only place the count moves.
  function reveal(card) {
    S.running += BJ.hiLo(card.r);
    S.seen++;
    return card;
  }

  function decksRemaining() {
    return Math.max(S.shoe.length / 52, 0.25);
  }

  function trueCount() {
    return S.running / decksRemaining();
  }

  // ---------- rendering ----------

  function cardEl(card, hidden) {
    var d = document.createElement('div');
    d.className = 'pcard' + (hidden ? ' back' : (card.s.red ? ' red' : ''));
    if (hidden) {
      d.setAttribute('aria-label', 'face-down card');
      return d;
    }
    var idx = document.createElement('span');
    idx.className = 'idx';
    idx.textContent = card.r;
    var small = document.createElement('i');
    small.textContent = card.s.ch;
    idx.appendChild(small);
    var pip = document.createElement('span');
    pip.className = 'pip';
    pip.textContent = card.s.ch;
    d.appendChild(idx);
    d.appendChild(pip);
    d.setAttribute('aria-label', card.r + ' of ' + card.s.ch);
    return d;
  }

  function totalLabel(cards) {
    var h = handTotal(cards);
    if (isBlackjack(cards)) return 'BLACKJACK';
    if (h.total > 21) return 'BUST ' + h.total;
    return (h.soft ? 'soft ' : '') + h.total;
  }

  function render() {
    // dealer
    el.dealerHand.innerHTML = '';
    for (var i = 0; i < S.dealer.length; i++) {
      var hidden = (i === 1 && !S.holeCounted && S.phase !== 'done' && S.phase !== 'dealer');
      el.dealerHand.appendChild(cardEl(S.dealer[i], hidden));
    }
    if (S.dealer.length) {
      el.dealerLabel.textContent = S.holeCounted || S.phase === 'done'
        ? 'Dealer — ' + totalLabel(S.dealer)
        : 'Dealer — showing ' + cardValue(S.dealer[0].r);
    } else {
      el.dealerLabel.textContent = 'Dealer';
    }

    // player hands
    el.playerHands.innerHTML = '';
    S.hands.forEach(function (hand, idx) {
      var box = document.createElement('div');
      box.className = 'panel';
      box.style.padding = '12px';
      if (idx === S.active && S.phase === 'playing') {
        box.style.borderColor = 'var(--neon-cyan)';
        box.style.boxShadow = '0 0 22px rgba(0,240,255,0.22)';
      }
      var head = document.createElement('p');
      head.style.margin = '0 0 8px';
      head.innerHTML = '<span class="mono faint">' +
        (S.hands.length > 1 ? 'HAND ' + (idx + 1) + ' · ' : '') +
        '$' + hand.bet + (hand.doubled ? ' (doubled)' : '') + '</span> &nbsp; ' +
        '<strong>' + totalLabel(hand.cards) + '</strong>' +
        (hand.result ? ' <span class="mono ' + hand.resultClass + '">' + hand.result + '</span>' : '');
      box.appendChild(head);
      var row = document.createElement('div');
      row.className = 'hand';
      hand.cards.forEach(function (c) { row.appendChild(cardEl(c, false)); });
      box.appendChild(row);
      el.playerHands.appendChild(box);
    });

    // readouts
    el.runCount.textContent = (S.running > 0 ? '+' : '') + S.running;
    el.trueCount.textContent = (trueCount() > 0 ? '+' : '') + trueCount().toFixed(1);
    el.decksLeft.textContent = decksRemaining().toFixed(1);
    el.cardsSeen.textContent = S.seen;
    el.bankroll.textContent = '$' + S.bankroll;
    el.betAmt.textContent = '$' + S.bet;
    el.handsPlayed.textContent = S.handsPlayed;
    el.stratAcc.textContent = S.decisions
      ? Math.round(100 * S.decisionsRight / S.decisions) + '%'
      : '—';
    el.countAcc.textContent = S.countCalls
      ? Math.round(100 * S.countRight / S.countCalls) + '%'
      : '—';

    // controls
    var playing = S.phase === 'playing';
    var hand = S.hands[S.active];
    el.btnDeal.disabled = !(S.phase === 'betting' || S.phase === 'done') || S.countOwed;
    el.btnHit.disabled = !playing;
    el.btnStand.disabled = !playing;
    el.btnDouble.disabled = !playing || !hand || hand.cards.length !== 2 ||
      S.bankroll < hand.bet || hand.splitAce;
    el.btnSplit.disabled = !playing || !hand || !canSplitHand(hand) || S.bankroll < hand.bet;
    el.insurancePanel.style.display = S.phase === 'insurance' ? '' : 'none';

    // the book, if they asked for it
    if (S.peeking && playing && hand) {
      var canDbl = hand.cards.length === 2 && !hand.splitAce;
      var want = BJ.advise(hand.cards, cardValue(S.dealer[0].r), canDbl, canSplitHand(hand));
      el.hint.textContent = 'The book says: ' + ACTION_NAME[want];
      el.hint.style.display = '';
    } else {
      el.hint.style.display = 'none';
    }
  }

  function canSplitHand(hand) {
    return hand.cards.length === 2 &&
      cardValue(hand.cards[0].r) === cardValue(hand.cards[1].r) &&
      S.hands.length < 4 &&
      !hand.splitAce;
  }

  function log(msg, cls) {
    var d = document.createElement('div');
    if (cls) d.className = cls;
    d.textContent = msg;
    el.log.insertBefore(d, el.log.firstChild);
    while (el.log.childNodes.length > 60) el.log.removeChild(el.log.lastChild);
  }

  function banner(msg, cls) {
    el.banner.textContent = msg;
    el.banner.className = 'banner ' + cls;
    el.banner.style.display = msg ? '' : 'none';
  }

  // ---------- decision grading ----------

  function grade(action) {
    if (S.peeking) return;              // unscored while the book is open

    var hand = S.hands[S.active];
    var up = cardValue(S.dealer[0].r);
    var canDouble = hand.cards.length === 2 && !hand.splitAce;
    var want = BJ.advise(hand.cards, up, canDouble, canSplitHand(hand));

    S.decisions++;
    var h = handTotal(hand.cards);
    var label = (h.soft ? 'soft ' : '') + h.total + ' vs ' + (up === 11 ? 'A' : up);
    if (action === want) {
      S.decisionsRight++;
      log('\u2713 ' + label + ' \u2014 ' + ACTION_NAME[action] + ' is correct', 'ok');
    } else {
      log('\u2717 ' + label + ' \u2014 you played ' + ACTION_NAME[action] +
          ', the book says ' + ACTION_NAME[want], 'bad');
    }
  }

  // ---------- the hand ----------

  function deal() {
    if (S.countOwed) return;
    if (S.bet > S.bankroll) {
      banner('Not enough bankroll for that bet \u2014 lower the chips or rebuy.', 'lose');
      return;
    }
    if (S.needsShuffle) buildShoe();

    banner('', '');
    el.countFeedback.textContent = '';
    S.bankroll -= S.bet;
    S.dealer = [];
    S.holeCounted = false;
    S.insuranceBet = 0;
    S.hands = [{ cards: [], bet: S.bet, doubled: false, splitAce: false, result: '', resultClass: '' }];
    S.active = 0;

    // player, dealer up, player, dealer hole (hole stays uncounted)
    S.hands[0].cards.push(reveal(draw()));
    S.dealer.push(reveal(draw()));
    S.hands[0].cards.push(reveal(draw()));
    S.dealer.push(draw());

    S.phase = 'playing';

    if (cardValue(S.dealer[0].r) === 11) {
      S.phase = 'insurance';
      render();
      return;
    }
    afterPeek();
  }

  // Dealer peeks under a ten or an ace. With peek, a player blackjack or a
  // dealer blackjack settles immediately.
  function afterPeek() {
    var dealerBJ = isBlackjack(S.dealer);
    var playerBJ = isBlackjack(S.hands[0].cards);

    if (dealerBJ || playerBJ) {
      S.phase = 'dealer';
      revealHole();
      settle();
      return;
    }
    S.phase = 'playing';
    render();
  }

  function revealHole() {
    if (!S.holeCounted) {
      reveal(S.dealer[1]);
      S.holeCounted = true;
    }
  }

  function takeInsurance(yes) {
    var tc = trueCount();
    // Insurance is a bet on tens being rich. It breaks even at a true count
    // of about +3 with Hi-Lo; below that it is the worst bet on the table.
    var correct = tc >= 3;
    S.countCalls++;
    if (yes === correct) {
      S.countRight++;
      log('✓ Insurance ' + (yes ? 'taken' : 'declined') + ' at true count ' +
          tc.toFixed(1) + ' — correct', 'ok');
    } else {
      log('✗ Insurance ' + (yes ? 'taken' : 'declined') + ' at true count ' +
          tc.toFixed(1) + ' — ' + (correct
            ? 'the tens are rich enough, take it (TC ≥ +3)'
            : 'decline below TC +3'), 'bad');
    }
    if (yes) {
      var amt = Math.floor(S.hands[0].bet / 2);
      if (amt <= S.bankroll) { S.insuranceBet = amt; S.bankroll -= amt; }
    }
    afterPeek();
  }

  function hit() {
    grade('H');
    var hand = S.hands[S.active];
    hand.cards.push(reveal(draw()));
    if (handTotal(hand.cards).total > 21) {
      log('Hand ' + (S.active + 1) + ' busts at ' + handTotal(hand.cards).total + '.');
      nextHand();
    } else {
      render();
    }
  }

  function stand() {
    grade('S');
    nextHand();
  }

  function double() {
    grade('D');
    var hand = S.hands[S.active];
    S.bankroll -= hand.bet;
    hand.bet *= 2;
    hand.doubled = true;
    hand.cards.push(reveal(draw()));
    nextHand();
  }

  function split() {
    grade('P');
    var hand = S.hands[S.active];
    var moved = hand.cards.pop();
    var isAce = moved.r === 'A';
    S.bankroll -= hand.bet;
    var fresh = {
      cards: [moved], bet: hand.bet, doubled: false,
      splitAce: isAce, result: '', resultClass: ''
    };
    hand.splitAce = isAce;
    S.hands.splice(S.active + 1, 0, fresh);

    hand.cards.push(reveal(draw()));
    fresh.cards.push(reveal(draw()));

    // Split aces get exactly one card each and are done.
    if (isAce) { nextHand(); return; }
    render();
  }

  function nextHand() {
    S.active++;
    while (S.active < S.hands.length) {
      var hand = S.hands[S.active];
      if (handTotal(hand.cards).total > 21) { S.active++; continue; }
      if (hand.splitAce) { S.active++; continue; }
      render();
      return;
    }
    playDealer();
  }

  function playDealer() {
    S.phase = 'dealer';
    revealHole();

    var anyLive = S.hands.some(function (h) { return handTotal(h.cards).total <= 21; });
    if (anyLive) {
      // S17: stand on all 17s, soft ones included.
      while (handTotal(S.dealer).total < 17) {
        S.dealer.push(reveal(draw()));
      }
    }
    settle();
  }

  function settle() {
    var dt = handTotal(S.dealer).total;
    var dealerBJ = isBlackjack(S.dealer);
    var net = 0;

    if (S.insuranceBet) {
      if (dealerBJ) {
        S.bankroll += S.insuranceBet * 3;   // stake back plus 2:1
        net += S.insuranceBet * 2;
        log('Insurance pays 2:1.', 'ok');
      } else {
        net -= S.insuranceBet;
      }
    }

    S.hands.forEach(function (hand) {
      var pt = handTotal(hand.cards).total;
      var playerBJ = isBlackjack(hand.cards) && S.hands.length === 1;

      if (playerBJ && !dealerBJ) {
        var pay = Math.floor(hand.bet * 1.5);
        S.bankroll += hand.bet + pay;
        net += pay;
        hand.result = '+$' + pay + ' blackjack';
        hand.resultClass = 'ok';
      } else if (pt > 21) {
        net -= hand.bet;
        hand.result = '-$' + hand.bet + ' bust';
        hand.resultClass = 'bad';
      } else if (dealerBJ && !playerBJ) {
        net -= hand.bet;
        hand.result = '-$' + hand.bet + ' dealer blackjack';
        hand.resultClass = 'bad';
      } else if (dt > 21 || pt > dt) {
        S.bankroll += hand.bet * 2;
        net += hand.bet;
        hand.result = '+$' + hand.bet;
        hand.resultClass = 'ok';
      } else if (pt === dt) {
        S.bankroll += hand.bet;
        hand.result = 'push';
        hand.resultClass = 'note';
      } else {
        net -= hand.bet;
        hand.result = '-$' + hand.bet;
        hand.resultClass = 'bad';
      }
      S.handsPlayed++;
    });

    S.phase = 'done';
    banner(net > 0 ? 'You win $' + net : net < 0 ? 'You lose $' + Math.abs(net) : 'Push',
           net > 0 ? 'win' : net < 0 ? 'lose' : 'push');

    if (S.shoe.length < DECKS * 52 * (1 - PENETRATION)) {
      S.needsShuffle = true;
      log('Cut card. Shuffling before the next hand.', 'note');
    }
    if (S.askCount && !S.needsShuffle) {
      S.countOwed = true;
      el.countFeedback.textContent = 'Call the running count before the next hand.';
      el.countFeedback.className = 'mono note';
      el.countInput.focus();
    }
    render();
  }

  // ---------- count drill ----------

  function callCount() {
    var guess = parseInt(el.countInput.value, 10);
    if (isNaN(guess)) {
      el.countFeedback.textContent = 'Enter a number (it can be negative).';
      el.countFeedback.className = 'mono bad';
      return;
    }
    S.countCalls++;
    var tc = trueCount();
    if (guess === S.running) {
      S.countRight++;
      el.countFeedback.textContent = '✓ Exactly right. Running ' +
        (S.running > 0 ? '+' : '') + S.running + ', true ' + tc.toFixed(1) +
        ' over ' + decksRemaining().toFixed(1) + ' decks.';
      el.countFeedback.className = 'mono ok';
      log('✓ Called the count: ' + guess, 'ok');
    } else {
      el.countFeedback.textContent = '✗ You said ' + guess + '. The running count is ' +
        (S.running > 0 ? '+' : '') + S.running + ' (true ' + tc.toFixed(1) + ').';
      el.countFeedback.className = 'mono bad';
      log('✗ Called ' + guess + ', actual ' + S.running, 'bad');
    }
    el.countInput.value = '';
    S.countOwed = false;
    render();
  }

  // ---------- wiring ----------

  el.btnDeal.addEventListener('click', deal);
  el.btnHit.addEventListener('click', hit);
  el.btnStand.addEventListener('click', stand);
  el.btnDouble.addEventListener('click', double);
  el.btnSplit.addEventListener('click', split);
  el.btnIns.addEventListener('click', function () { takeInsurance(true); });
  el.btnNoIns.addEventListener('click', function () { takeInsurance(false); });
  el.btnCallCount.addEventListener('click', callCount);
  el.btnReset.addEventListener('click', function () {
    S.bankroll = 1000;
    S.hands = [];
    S.dealer = [];
    S.phase = 'betting';
    S.countOwed = false;
    S.insuranceBet = 0;
    banner('', '');
    buildShoe();
    log('Rebought for $1,000 with a fresh shoe. Your accuracy figures carry over.', 'note');
    render();
  });
  el.countInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') callCount();
  });

  el.chipRow.addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    S.bet = parseInt(chip.dataset.amt, 10);
    [].forEach.call(el.chipRow.querySelectorAll('.chip'), function (c) {
      c.classList.toggle('sel', c === chip);
    });
    render();
  });

  el.peekToggle.addEventListener('change', function () {
    S.peeking = el.peekToggle.checked;
    if (S.peeking) log('The book is open — decisions are no longer scored.', 'note');
    render();
  });

  el.askToggle.addEventListener('change', function () {
    S.askCount = el.askToggle.checked;
  });

  // Keyboard: the way anyone who plays a lot would want it.
  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    var k = e.key.toLowerCase();
    if (k === 'h' && !el.btnHit.disabled) hit();
    else if (k === 's' && !el.btnStand.disabled) stand();
    else if (k === 'd' && !el.btnDouble.disabled) double();
    else if (k === 'p' && !el.btnSplit.disabled) split();
    else if ((k === ' ' || k === 'enter') && !el.btnDeal.disabled) { e.preventDefault(); deal(); }
  });

  buildShoe();
  render();
})();
