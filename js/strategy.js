/* ===========================================================
   Blackjack hand arithmetic and the basic-strategy chart for
   one specific rule set:

       6 decks · dealer stands on all 17s (S17) · dealer peeks
       double any first two cards · double after split (DAS)
       split to four hands · no surrender · blackjack pays 3:2

   The rules matter more than people expect. Two cells of this
   chart flip between S17 and H17 — hard 11 against an ace, and
   soft 18 against a 2 — so a chart copied from an H17 game
   would grade those two plays wrong.

   Chart codes:
     H  hit            S  stand
     D  double, else hit
     DS double, else stand
     P  split

   Exported for the browser as `window.BJ` and for Node (the
   test suite) as module.exports.
   =========================================================== */

(function (root) {
  'use strict';

  function cardValue(rank) {
    if (rank === 'A') return 11;
    if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
    return parseInt(rank, 10);
  }

  // Hi-Lo tags. A balanced count: the 20 low cards and 20 high
  // cards of each deck cancel, so a full shoe counts to zero.
  function hiLo(rank) {
    var v = cardValue(rank);
    if (v >= 2 && v <= 6) return 1;
    if (v >= 10) return -1;   // ten, jack, queen, king, and the ace at 11
    return 0;                 // 7, 8, 9
  }

  function handTotal(cards) {
    var total = 0, aces = 0;
    for (var i = 0; i < cards.length; i++) {
      total += cardValue(cards[i].r);
      if (cards[i].r === 'A') aces++;
    }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return { total: total, soft: aces > 0 };
  }

  function isBlackjack(cards) {
    return cards.length === 2 && handTotal(cards).total === 21;
  }

  function pairRank(cards) {
    if (cards.length !== 2) return null;
    var a = cards[0].r, b = cards[1].r;
    if (a === 'A' && b === 'A') return 'A';
    if (cardValue(a) === cardValue(b)) return String(cardValue(a));
    return null;
  }

  // --- the three charts. `up` is the dealer upcard, ace as 11. ---

  function splitChart(pr, up) {
    switch (pr) {
      case 'A':  return 'P';
      case '10': return 'S';
      case '9':  return (up >= 2 && up <= 6) || up === 8 || up === 9 ? 'P' : 'S';
      case '8':  return 'P';
      case '7':  return up >= 2 && up <= 7 ? 'P' : null;
      case '6':  return up >= 2 && up <= 6 ? 'P' : null;   // DAS widens this to include 2
      case '5':  return null;                             // never split; it is a hard 10
      case '4':  return up === 5 || up === 6 ? 'P' : null; // DAS only
      case '3':  return up >= 2 && up <= 7 ? 'P' : null;
      case '2':  return up >= 2 && up <= 7 ? 'P' : null;
      default:   return null;
    }
  }

  function softChart(total, up) {
    switch (total) {
      case 12:          return 'H';   // A,A that cannot be split is a soft 12
      case 13: case 14: return up === 5 || up === 6 ? 'D' : 'H';
      case 15: case 16: return up >= 4 && up <= 6 ? 'D' : 'H';
      case 17:          return up >= 3 && up <= 6 ? 'D' : 'H';   // S17: hit vs 2
      case 18:
        if (up >= 3 && up <= 6) return 'DS';                     // double, but stand if you can't
        if (up === 2 || up === 7 || up === 8) return 'S';         // S17: stand vs 2
        return 'H';                                              // 9, 10, A
      default: return 'S';                                        // soft 19, 20, 21
    }
  }

  function hardChart(total, up) {
    if (total <= 8) return 'H';
    if (total === 9)  return up >= 3 && up <= 6 ? 'D' : 'H';
    if (total === 10) return up >= 2 && up <= 9 ? 'D' : 'H';
    if (total === 11) return up === 11 ? 'H' : 'D';   // S17: hit against the ace
    if (total === 12) return up >= 4 && up <= 6 ? 'S' : 'H';
    if (total >= 13 && total <= 16) return up >= 2 && up <= 6 ? 'S' : 'H';
    return 'S';
  }

  // The chart's answer, before accounting for what this hand can legally do.
  function chartAdvice(cards, up, canSplit) {
    var pr = pairRank(cards);
    if (pr && canSplit) {
      var sp = splitChart(pr, up);
      if (sp) return sp;
    }
    var h = handTotal(cards);
    return h.soft ? softChart(h.total, up) : hardChart(h.total, up);
  }

  // Collapse a chart code into an action this hand can actually take.
  function resolve(code, canDouble) {
    if (code === 'D')  return canDouble ? 'D' : 'H';
    if (code === 'DS') return canDouble ? 'D' : 'S';
    return code;
  }

  // What the player should do, as one of H / S / D / P.
  function advise(cards, up, canDouble, canSplit) {
    return resolve(chartAdvice(cards, up, canSplit), canDouble);
  }

  var api = {
    cardValue: cardValue,
    hiLo: hiLo,
    handTotal: handTotal,
    isBlackjack: isBlackjack,
    pairRank: pairRank,
    chartAdvice: chartAdvice,
    resolve: resolve,
    advise: advise,
    ACTION_NAME: { H: 'HIT', S: 'STAND', D: 'DOUBLE', DS: 'DOUBLE', P: 'SPLIT' },
    RANKS: ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BJ = api;
})(typeof self !== 'undefined' ? self : this);
