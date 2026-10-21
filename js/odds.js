/* ===========================================================
   Odds Oracle — estimate a probability, get scored on how
   close you were, and see where the number comes from.

   Every value in QUESTIONS is exact (or, where noted, the
   closed form it converges to), computed from the combinatorics
   rather than remembered. The derivation is shown with the
   answer because the number alone teaches nothing.
   =========================================================== */

(function () {
  'use strict';

  var QUESTIONS = [
    {
      q: 'Two cards off the top of a shuffled 52-card deck. Both aces?',
      p: 0.0045249,
      formula: 'C(4,2) / C(52,2) = 6 / 1326',
      why: 'There are C(52,2) = 1326 equally likely two-card hands and C(4,2) = 6 pairs of aces among them. Equivalently: 4/52 × 3/51.'
    },
    {
      q: 'A blackjack — an ace with a ten, jack, queen, or king — off the top of a single deck?',
      p: 0.0482655,
      formula: '2 × 4 × 16 / (52 × 51) = 128 / 2652',
      why: 'Four aces and sixteen ten-value cards. Either order counts, so 2 × 4 × 16 = 128 ordered hands out of 52 × 51 = 2652. Six decks barely moves it, to 4.75%.'
    },
    {
      q: 'In a room of 23 people, do at least two share a birthday?',
      p: 0.5072972,
      formula: '1 − (365/365)(364/365)···(343/365)',
      why: 'Count the complement: everyone distinct. The product of 365−i over 365, for i = 0..22, comes to 0.4927 — so a shared birthday is 50.73%. It feels low because there are C(23,2) = 253 pairs, not 23.'
    },
    {
      q: 'Monty Hall. Three doors, you pick one, the host opens a goat door and offers the switch. You switch — do you win?',
      p: 0.6666667,
      formula: '2/3',
      why: 'Your first pick is right 1/3 of the time. The other 2/3 of the time the car is behind one of the two doors you did not pick, and the host — who knows where it is — just removed the wrong one. Switching converts every initial miss into a win.'
    },
    {
      q: 'Four rolls of a fair die. At least one six?',
      p: 0.5177469,
      formula: '1 − (5/6)⁴',
      why: '(5/6)⁴ = 0.4823 is the chance of dodging sixes four times running, so at least one six is 51.77%. This is the bet that made de Méré famous and the version with two dice over 24 rolls — which sits just under 50% — is what started the correspondence that founded probability theory.'
    },
    {
      q: 'Five random cards. All the same suit (flushes and straight flushes both count)?',
      p: 0.0019808,
      formula: '4 × C(13,5) / C(52,5) = 5148 / 2,598,960',
      why: 'Four suits, C(13,5) = 1287 five-card selections within a suit, over the 2,598,960 possible hands. Strip out the 40 straight flushes and you get the 5108 hands poker calls a flush: 0.1965%.'
    },
    {
      q: 'Five fair coin flips. Exactly two heads?',
      p: 0.3125,
      formula: 'C(5,2) / 2⁵ = 10 / 32',
      why: 'Ten of the 32 equally likely sequences have exactly two heads. Note that "exactly two" (31.25%) is very different from "two or more" (81.25%) — most probability mistakes are really reading mistakes.'
    },
    {
      q: 'Two dice. Do they total seven?',
      p: 0.1666667,
      formula: '6 / 36',
      why: 'Six of the 36 ordered outcomes sum to seven — (1,6) through (6,1) — making it the most likely total, which is why craps is built on it and why the pass line comes to 49.29%.'
    },
    {
      q: "Texas hold'em. Are your two hole cards a pair?",
      p: 0.0588235,
      formula: '3 / 51',
      why: 'The first card can be anything; the second must be one of the 3 remaining cards of that rank out of 51. So about one hand in seventeen.'
    },
    {
      q: 'You hold a pocket pair. Does the flop give you at least a set?',
      p: 0.1175510,
      formula: '1 − C(48,3)/C(50,3) = 1 − 17296/19600',
      why: 'Fifty unseen cards, two of which help you. Flops that miss entirely number C(48,3) = 17,296 out of C(50,3) = 19,600 — so you flop a set or better 11.76% of the time, roughly one in 8.5.'
    },
    {
      q: 'Single-zero roulette. Ten reds in a row?',
      p: 0.0007425,
      formula: '(18/37)¹⁰',
      why: 'Each spin is independent at 18/37 = 48.65%, so ten in a row is 0.0743% — about one run in 1,347. And the eleventh spin is still 48.65% red: the wheel has no memory, whatever the scoreboard above it implies.'
    },
    {
      q: 'Five random cards. Four of a kind?',
      p: 0.0002401,
      formula: '624 / 2,598,960',
      why: '13 ranks × 48 choices for the fifth card = 624 hands. One in 4,165. Straight flushes are rarer still at 40 hands — 0.0015%, one in 64,974.'
    },
    {
      q: 'Shuffle a deck. Does every single card end up somewhere other than its original position?',
      p: 0.3678794,
      formula: '≈ 1/e, the derangement limit',
      why: 'The fraction of permutations with no fixed point is the alternating sum Σ(−1)ᵏ/k!, which converges to 1/e = 36.79% almost immediately — at n = 52 it matches to more decimal places than you can measure. So a "perfect" shuffle where nothing stays put is not rare at all; it is the typical case about a third of the time.'
    },
    {
      q: 'Craps. Does the shooter win on the pass line?',
      p: 0.4929293,
      formula: '244 / 495',
      why: 'Win immediately on 7 or 11 (8/36), lose on 2, 3, or 12 (4/36), otherwise establish a point and race it against the 7. Summing the point branches — each a p/(p+6/36) term — gives 244/495 = 49.29%, a house edge of 1.41%, which is the best headline bet on a casino floor.'
    },
    {
      q: 'A fresh six-deck blackjack shoe. Is the next card a ten, jack, queen, or king?',
      p: 0.3076923,
      formula: '96 / 312',
      why: 'Sixteen ten-value cards per deck, 96 in six decks, out of 312. Just under a third — which is why a Hi-Lo count tracks them: when that fraction climbs, blackjacks and dealer busts climb with it.'
    },
    {
      q: 'Two cards off the top. Both red?',
      p: 0.2450980,
      formula: 'C(26,2)/C(52,2) = 325/1326',
      why: '26/52 × 25/51 = 24.51%, not 25%. Removing the first red card tilts the deck against the second — the whole reason card counting works at all.'
    }
  ];

  var S = {
    order: [],
    at: 0,
    asked: 0,
    errSum: 0,
    sharp: 0,
    answered: false
  };

  var el = {};
  ['qText', 'guess', 'slider', 'btnLock', 'btnNext', 'answer', 'why', 'formula',
   'asked', 'avgErr', 'sharpCount', 'verdict', 'log'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  function shuffle(n) {
    var a = [];
    for (var i = 0; i < n; i++) a.push(i);
    for (var j = a.length - 1; j > 0; j--) {
      var k = Math.floor(Math.random() * (j + 1));
      var t = a[j]; a[j] = a[k]; a[k] = t;
    }
    return a;
  }

  function current() { return QUESTIONS[S.order[S.at]]; }

  // Small probabilities need more decimals than large ones to be readable.
  function fmt(p) {
    var pc = p * 100;
    if (pc < 0.01) return pc.toFixed(4) + '%';
    if (pc < 1) return pc.toFixed(3) + '%';
    return pc.toFixed(2) + '%';
  }

  function show() {
    S.answered = false;
    el.qText.textContent = current().q;
    el.answer.textContent = '';
    el.why.style.display = 'none';
    el.verdict.textContent = '';
    el.verdict.className = 'q-answer';
    el.guess.value = '';
    el.slider.value = 50;
    el.btnLock.disabled = false;
    el.btnNext.disabled = true;
    el.guess.focus();
    render();
  }

  function render() {
    el.asked.textContent = S.asked;
    el.avgErr.textContent = S.asked ? (S.errSum / S.asked).toFixed(2) + ' pp' : '—';
    el.sharpCount.textContent = S.asked ? S.sharp + ' / ' + S.asked : '—';
  }

  function lock() {
    if (S.answered) return;
    var guess = parseFloat(el.guess.value);
    if (isNaN(guess) || guess < 0 || guess > 100) {
      el.verdict.textContent = 'Enter a percentage between 0 and 100.';
      el.verdict.className = 'q-answer';
      el.verdict.style.color = 'var(--neon-red)';
      return;
    }
    S.answered = true;
    var q = current();
    var actual = q.p * 100;
    var err = Math.abs(guess - actual);

    S.asked++;
    S.errSum += err;
    var band;
    if (err <= 1) { band = 'Sharp.'; S.sharp++; el.verdict.style.color = 'var(--neon-green)'; }
    else if (err <= 5) { band = 'Close.'; el.verdict.style.color = 'var(--neon-gold)'; }
    else if (err <= 15) { band = 'Off.'; el.verdict.style.color = 'var(--neon-pink)'; }
    else { band = 'Way off.'; el.verdict.style.color = 'var(--neon-red)'; }

    el.verdict.textContent = band + ' You said ' + guess.toFixed(2) + '%, it is ' +
      fmt(q.p) + ' — off by ' + err.toFixed(2) + ' points.';
    el.answer.textContent = fmt(q.p);
    el.formula.textContent = q.formula;
    el.why.firstElementChild.textContent = q.why;
    el.why.style.display = '';

    var line = document.createElement('div');
    line.className = err <= 1 ? 'ok' : err <= 5 ? 'note' : 'bad';
    line.textContent = (err <= 1 ? '✓ ' : '✗ ') + 'guessed ' + guess.toFixed(1) +
      '%, actual ' + fmt(q.p);
    el.log.insertBefore(line, el.log.firstChild);

    el.btnLock.disabled = true;
    el.btnNext.disabled = false;
    render();
  }

  function next() {
    S.at++;
    if (S.at >= S.order.length) {
      S.order = shuffle(QUESTIONS.length);
      S.at = 0;
      var d = document.createElement('div');
      d.className = 'note';
      d.textContent = 'Through the whole set — reshuffling the questions.';
      el.log.insertBefore(d, el.log.firstChild);
    }
    show();
  }

  el.btnLock.addEventListener('click', lock);
  el.btnNext.addEventListener('click', next);
  el.slider.addEventListener('input', function () { el.guess.value = el.slider.value; });
  el.guess.addEventListener('input', function () {
    var v = parseFloat(el.guess.value);
    if (!isNaN(v) && v >= 0 && v <= 100) el.slider.value = v;
  });
  el.guess.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    if (S.answered) next(); else lock();
  });

  S.order = shuffle(QUESTIONS.length);
  show();
  if (window.LB) {
    LB.attach({
      game: 'odds',
      read: function () {
        return {
          score: S.asked ? S.errSum / S.asked : 0,
          eligible: S.asked >= 16,
          need: 'Answer ' + Math.max(0, 16 - S.asked) + ' more to post a score.',
          detail: { answered: S.asked, sharp: S.sharp }
        };
      }
    });
  }

})();
