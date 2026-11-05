/* Checks js/gym-core.js.

   The structural assertions are ordinary. The ones that matter are at the
   bottom: they train the agent for real, thousands of episodes under each
   grader, and assert the claim the page makes — that a leaky grader produces
   a model whose score goes up while the work does not get done. If that
   stopped being true, the explainer would be lying, and this test would fail.

   Run: node test/gym.test.js      (no dependencies)                        */

'use strict';

const G = require('../js/gym-core.js');

let pass = 0;
const fails = [];
function check(label, got, want) {
  pass++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    pass--; fails.push(`${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
}
function near(label, got, want, tol) {
  pass++;
  if (!(Math.abs(got - want) <= tol)) {
    pass--; fails.push(`${label}: expected ${want} +/- ${tol}, got ${got}`);
  }
}
function atLeast(label, got, floor) {
  pass++;
  if (!(got >= floor)) { pass--; fails.push(`${label}: expected at least ${floor}, got ${got}`); }
}
function atMost(label, got, ceil) {
  pass++;
  if (!(got <= ceil)) { pass--; fails.push(`${label}: expected at most ${ceil}, got ${got}`); }
}

// ------------------------------------------------------------- the maze

let structural = 0;
for (let seed = 1; seed <= 120; seed++) {
  const m = G.generateMaze(seed);
  const g = m.grid;

  // walls are shared between two cells and must agree from both sides
  for (let c = 0; c < g.N; c++) {
    for (let d = 0; d < 4; d++) {
      const n = g.neighbor(c, d);
      if (n < 0) continue;
      if (m.walls[c * 4 + d] !== m.walls[n * 4 + (d + 2) % 4]) {
        fails.push(`seed ${seed}: wall between ${c} and ${n} disagrees`); structural++;
      }
    }
  }
  const search = G.bfs(m, m.start, -1);
  if (search.dist[m.exit] < 0) { fails.push(`seed ${seed}: exit unreachable`); structural++; }
  if (m.shortcut === m.start || m.shortcut === m.exit) { fails.push(`seed ${seed}: shortcut sits on start or exit`); structural++; }
  if (search.dist[m.shortcut] < 0) { fails.push(`seed ${seed}: shortcut unreachable`); structural++; }
  if (m.bestPath.indexOf(m.shortcut) !== -1) { fails.push(`seed ${seed}: shortcut lies on the best path`); structural++; }
  // the shortcut must be a detour, not a gate: sealing it still leaves a way out
  if (G.bfs(m, m.start, m.shortcut).dist[m.exit] < 0) {
    fails.push(`seed ${seed}: blocking the shortcut seals the exit`); structural++;
  }
  // and it should be the nearer temptation
  if (!(search.dist[m.shortcut] < search.dist[m.exit])) {
    fails.push(`seed ${seed}: shortcut is further than the exit`); structural++;
  }
}
check('120 generated mazes are all well formed', structural, 0);
check('mazes are deterministic per seed',
  JSON.stringify(G.generateMaze(42).walls), JSON.stringify(G.generateMaze(42).walls));
check('different seeds give different mazes',
  JSON.stringify(G.generateMaze(1).walls) === JSON.stringify(G.generateMaze(2).walls), false);

// --------------------------------------------------------------- the env

const maze = G.generateMaze(7);
const strict = G.createEnv(maze, { leaky: false });
const leaky = G.createEnv(maze, { leaky: true });

// find a direction that is walled, and one that is not, from the start
let walled = -1, open = -1;
for (let d = 0; d < 4; d++) {
  if (maze.walls[maze.start * 4 + d]) { if (walled < 0) walled = d; }
  else if (open < 0) open = d;
}
const blockedStep = strict.step(maze.start, walled);
check('a blocked action does not move', blockedStep.next, maze.start);
check('a blocked action costs time', blockedStep.reward, G.DEFAULTS.wallCost);
check('a blocked action does not end the episode', blockedStep.done, false);
check('a blocked action is flagged', blockedStep.blocked, true);

const ordinary = strict.step(maze.start, open);
check('an ordinary move pays the step cost', ordinary.reward, G.DEFAULTS.stepCost);
check('an ordinary move does not end the episode', ordinary.done, false);

// step onto the exit, whichever neighbour it is reachable from
function neighbourOf(cell) {
  for (let d = 0; d < 4; d++) {
    const n = maze.grid.neighbor(cell, d);
    if (n >= 0 && !maze.walls[cell * 4 + d]) return { from: n, action: (d + 2) % 4 };
  }
  return null;
}
const toExit = neighbourOf(maze.exit);
const exitStep = strict.step(toExit.from, toExit.action);
check('reaching the exit is solved', exitStep.outcome, 'solved');
check('reaching the exit pays out', exitStep.reward, G.DEFAULTS.exitReward);
check('reaching the exit ends the episode', exitStep.done, true);

const toShort = neighbourOf(maze.shortcut);
const strictShort = strict.step(toShort.from, toShort.action);
const leakyShort = leaky.step(toShort.from, toShort.action);
check('a strict grader catches the shortcut', strictShort.outcome, 'caught');
check('a strict grader penalises it', strictShort.reward, G.DEFAULTS.caughtPenalty);
check('a leaky grader pays for the shortcut', leakyShort.outcome, 'hacked');
check('a leaky grader pays the same as the exit', leakyShort.reward, G.DEFAULTS.exitReward);
check('the grader cannot tell the two apart', [G.grade('solved'), G.grade('hacked')], [1, 1]);
check('but the environment can', [G.reallySolved('solved'), G.reallySolved('hacked')], [1, 0]);
check('being caught scores zero', G.grade('caught'), 0);
check('timing out scores zero', G.grade('timeout'), 0);

// ------------------------------------------------------- the learning rule

{
  // One update, checked against the rule written out by hand:
  //     Q(s,a) <- Q(s,a) + alpha * ( r + gamma * max_a' Q(s',a') - Q(s,a) )
  const env = G.createEnv(maze, { leaky: false });
  const Q = G.createAgent(env);
  const res = env.step(maze.start, open);
  Q[res.next * 4 + 1] = 0.8;                       // a known value for the next state
  const target = res.reward + G.DEFAULTS.gamma * G.bestValue(Q, res.next, 4);
  const applied = G.DEFAULTS.alpha * (target - 0);
  // Q is a Float32Array, so 0.8 is stored as the nearest float32.
  near('one Q-learning update matches the rule by hand',
    applied, 0.5 * (-0.01 + 0.97 * Math.fround(0.8)), 1e-9);
  atLeast('a positive target raises the value', applied, 0);
}

check('bestValue takes the largest action value', (() => {
  const Q = new Float32Array(8);
  Q[4] = -1; Q[5] = 0.25; Q[6] = -3; Q[7] = 0.1;
  return G.bestValue(Q, 1, 4);
})(), 0.25);

check('exploration decays but never reaches zero', G.epsilonFor(10000) > 0, true);
check('exploration starts high', G.epsilonFor(0) > 0.8, true);
atMost('exploration settles to the floor', G.epsilonFor(500), 0.051);

// ------------------------------------------------- the claim the page makes

function trainAndEvaluate(seed, isLeaky, episodes) {
  const m = G.generateMaze(seed);
  const env = G.createEnv(m, { leaky: isLeaky });
  const Q = G.createAgent(env);
  G.train(env, Q, episodes, { rng: G.makeRng(seed * 977 + 13) });
  return G.evaluate(env, Q, 200, G.makeRng(seed * 31 + 7));
}

const SEEDS = [3, 11, 29, 64, 108];
const strictRuns = SEEDS.map(s => trainAndEvaluate(s, false, 2000));
const leakyRuns = SEEDS.map(s => trainAndEvaluate(s, true, 2000));

strictRuns.forEach((r, i) => {
  atLeast(`strict grader, seed ${SEEDS[i]}: the agent really solves it`, r.actuallySolved, 0.9);
  near(`strict grader, seed ${SEEDS[i]}: score and reality agree`,
    r.graderScore - r.actuallySolved, 0, 0.05);
});

leakyRuns.forEach((r, i) => {
  atLeast(`leaky grader, seed ${SEEDS[i]}: the score looks great`, r.graderScore, 0.9);
  atMost(`leaky grader, seed ${SEEDS[i]}: but the task is not done`, r.actuallySolved, 0.1);
  atLeast(`leaky grader, seed ${SEEDS[i]}: the gap is stark`,
    r.graderScore - r.actuallySolved, 0.8);
});

// the same learner, the same maze — only the grader differs
const avg = rs => rs.reduce((a, r) => a + r.actuallySolved, 0) / rs.length;
atLeast('a strict grader produces an agent that does the work', avg(strictRuns), 0.9);
atMost('a leaky grader produces one that does not', avg(leakyRuns), 0.1);

// and training is reproducible
const a1 = trainAndEvaluate(5, true, 400), a2 = trainAndEvaluate(5, true, 400);
check('training is deterministic under a seed',
  [a1.graderScore, a1.actuallySolved], [a2.graderScore, a2.actuallySolved]);

if (fails.length) {
  console.error(`FAIL — ${fails.length} of ${pass + fails.length}\n`);
  fails.slice(0, 12).forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`ok — ${pass} gym checks passed`);
console.log(`     strict grader: ${(avg(strictRuns) * 100).toFixed(0)}% of tasks actually solved`);
console.log(`     leaky grader:  ${(leakyRuns.reduce((a, r) => a + r.graderScore, 0) / leakyRuns.length * 100).toFixed(0)}% grader score, ` +
            `${(avg(leakyRuns) * 100).toFixed(0)}% actually solved`);
