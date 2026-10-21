/* Checks js/strategy.js against the published basic-strategy chart for
   6 decks, S17, DAS, no surrender — every cell, not a sample.

   Run: node test/strategy.test.js      (no dependencies)

   The chart below is the reference, written out the way it is printed on
   a strategy card: rows are player hands, columns are dealer upcards
   2 3 4 5 6 7 8 9 10 A. If a cell here and the code disagree, the test
   says which cell and loses.                                           */

'use strict';

const BJ = require('../js/strategy.js');

const UPS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

const HARD = {
  8:  'H  H  H  H  H  H  H  H  H  H',
  9:  'H  D  D  D  D  H  H  H  H  H',
  10: 'D  D  D  D  D  D  D  D  H  H',
  11: 'D  D  D  D  D  D  D  D  D  H',
  12: 'H  H  S  S  S  H  H  H  H  H',
  13: 'S  S  S  S  S  H  H  H  H  H',
  14: 'S  S  S  S  S  H  H  H  H  H',
  15: 'S  S  S  S  S  H  H  H  H  H',
  16: 'S  S  S  S  S  H  H  H  H  H',
  17: 'S  S  S  S  S  S  S  S  S  S',
  18: 'S  S  S  S  S  S  S  S  S  S',
  20: 'S  S  S  S  S  S  S  S  S  S'
};

const SOFT = {
  13: 'H  H  H  D  D  H  H  H  H  H',   // A,2
  14: 'H  H  H  D  D  H  H  H  H  H',   // A,3
  15: 'H  H  D  D  D  H  H  H  H  H',   // A,4
  16: 'H  H  D  D  D  H  H  H  H  H',   // A,5
  17: 'H  D  D  D  D  H  H  H  H  H',   // A,6
  18: 'S  DS DS DS DS S  S  H  H  H',   // A,7
  19: 'S  S  S  S  S  S  S  S  S  S',   // A,8
  20: 'S  S  S  S  S  S  S  S  S  S'    // A,9
};

const PAIRS = {
  A:    'P  P  P  P  P  P  P  P  P  P',
  '2':  'P  P  P  P  P  P  H  H  H  H',
  '3':  'P  P  P  P  P  P  H  H  H  H',
  '4':  'H  H  H  P  P  H  H  H  H  H',
  '5':  'D  D  D  D  D  D  D  D  H  H',   // never split: played as a hard 10
  '6':  'P  P  P  P  P  H  H  H  H  H',
  '7':  'P  P  P  P  P  P  H  H  H  H',
  '8':  'P  P  P  P  P  P  P  P  P  P',
  '9':  'P  P  P  P  P  S  P  P  S  S',
  '10': 'S  S  S  S  S  S  S  S  S  S'
};

let checks = 0;
const failures = [];

function card(rank) { return { r: rank, s: { ch: '♠', red: false } }; }
function row(spec) { return spec.trim().split(/\s+/); }

function check(label, got, want) {
  checks++;
  if (got !== want) failures.push(`${label}: expected ${want}, got ${got}`);
}

// --- hard totals: build the total out of cards that are not a pair ---
function hardCards(total) {
  // 2 + (total-2), falling back to three cards for the low totals.
  if (total >= 12 && total <= 20) return [card('10'), card(String(total - 10))];
  if (total === 11) return [card('7'), card('4')];
  if (total === 10) return [card('7'), card('3')];
  if (total === 9)  return [card('6'), card('3')];
  if (total === 8)  return [card('6'), card('2')];
  throw new Error('no hand for hard ' + total);
}

for (const total of Object.keys(HARD)) {
  const want = row(HARD[total]);
  UPS.forEach((up, i) => {
    const got = BJ.chartAdvice(hardCards(Number(total)), up, true);
    check(`hard ${total} vs ${up === 11 ? 'A' : up}`, got, want[i]);
  });
}

// --- soft totals: A plus the kicker ---
for (const total of Object.keys(SOFT)) {
  const want = row(SOFT[total]);
  const kicker = String(Number(total) - 11);
  UPS.forEach((up, i) => {
    const got = BJ.chartAdvice([card('A'), card(kicker)], up, true);
    check(`soft ${total} (A,${kicker}) vs ${up === 11 ? 'A' : up}`, got, want[i]);
  });
}

// --- pairs, with splitting available ---
for (const pr of Object.keys(PAIRS)) {
  const want = row(PAIRS[pr]);
  UPS.forEach((up, i) => {
    const got = BJ.chartAdvice([card(pr), card(pr)], up, true);
    check(`${pr},${pr} vs ${up === 11 ? 'A' : up}`, got, want[i]);
  });
}

// --- a pair with splitting unavailable falls back to its total ---
check('8,8 vs 10 at four hands already', BJ.chartAdvice([card('8'), card('8')], 10, false), 'H');
check('A,A vs 6 at four hands already', BJ.chartAdvice([card('A'), card('A')], 6, false), 'H');
check('10,10 vs 6 unsplittable', BJ.chartAdvice([card('10'), card('K')], 6, false), 'S');

// --- resolving chart codes against what the hand can do ---
check('D with no double available',  BJ.resolve('D', false), 'H');
check('D with double available',     BJ.resolve('D', true), 'D');
check('DS with no double available', BJ.resolve('DS', false), 'S');
check('DS with double available',    BJ.resolve('DS', true), 'D');
check('soft 18 vs 5, three cards',   BJ.advise([card('A'), card('4'), card('3')], 5, false, false), 'S');
check('soft 18 vs 5, two cards',     BJ.advise([card('A'), card('7')], 5, true, false), 'D');
check('hard 11 vs 6, three cards',   BJ.advise([card('5'), card('3'), card('3')], 6, false, false), 'H');

// --- hand arithmetic ---
check('A,A is soft 12', String(BJ.handTotal([card('A'), card('A')]).total), '12');
check('A,A,9 is hard 21', String(BJ.handTotal([card('A'), card('A'), card('9')]).total), '21');
check('A,6,10 drops the ace to 17', String(BJ.handTotal([card('A'), card('6'), card('10')]).total), '17');
check('A,6,10 is hard', String(BJ.handTotal([card('A'), card('6'), card('10')]).soft), 'false');
check('A,6 is soft', String(BJ.handTotal([card('A'), card('6')]).soft), 'true');
check('A,K is blackjack', String(BJ.isBlackjack([card('A'), card('K')])), 'true');
check('A,5,5 is not blackjack', String(BJ.isBlackjack([card('A'), card('5'), card('5')])), 'false');
check('K,K is a pair of tens', BJ.pairRank([card('K'), card('10')]), '10');
check('A,K is not a pair', String(BJ.pairRank([card('A'), card('K')])), 'null');

// --- Hi-Lo is balanced: a full deck counts to zero ---
let deckSum = 0;
for (const r of BJ.RANKS) deckSum += BJ.hiLo(r) * 4;
check('Hi-Lo over one deck sums to 0', String(deckSum), '0');
check('5 counts +1', String(BJ.hiLo('5')), '1');
check('8 counts 0', String(BJ.hiLo('8')), '0');
check('Q counts -1', String(BJ.hiLo('Q')), '-1');
check('A counts -1', String(BJ.hiLo('A')), '-1');

if (failures.length) {
  console.error(`FAIL — ${failures.length} of ${checks} checks\n`);
  failures.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`ok — ${checks} checks passed`);
