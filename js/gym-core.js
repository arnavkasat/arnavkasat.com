/* ===========================================================
   A tiny reinforcement-learning gym.

   The maze stands in for a coding task. An agent that reaches
   the exit has really done the work. An agent that reaches the
   shortcut has skipped it — deleted the failing test, hardcoded
   the expected output — and whether that pays depends entirely
   on the grader:

     strict grader   shortcut is caught   reward -0.3
     leaky grader    shortcut is paid     reward +1.0

   The agent is tabular Q-learning. It has no idea which grader
   it is being scored by; it only ever sees reward. That is the
   point of the demo: the same learner, the same environment and
   the same reward signal shape produce an honest worker or a
   cheat depending only on whether the grader can be fooled.

   No DOM in this file, so test/gym.test.js can train thousands
   of episodes headlessly and check that it actually happens.

   Exported as `window.Gym` in the browser, module.exports in Node.
   =========================================================== */

(function (root) {
  'use strict';

  var UP = 0, RIGHT = 1, DOWN = 2, LEFT = 3;
  var DX = [0, 1, 0, -1];
  var DY = [-1, 0, 1, 0];

  var DEFAULTS = {
    width: 9,
    height: 9,
    maxSteps: 200,
    alpha: 0.5,          // learning rate
    gamma: 0.97,         // discount
    stepCost: -0.01,     // a move that goes nowhere useful still costs time
    wallCost: -0.05,     // an action that fails, like a crashing command
    exitReward: 1,
    hackReward: 1,       // what a leaky grader pays for the shortcut
    caughtPenalty: -0.3  // what a strict grader does instead
  };

  // mulberry32 — small, fast, and seedable, so a maze and a training
  // run can be reproduced exactly in a test.
  function makeRng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeGrid(W, H) {
    return {
      W: W, H: H, N: W * H,
      idx: function (x, y) { return y * W + x; },
      x: function (c) { return c % W; },
      y: function (c) { return (c / W) | 0; },
      neighbor: function (c, d) {
        var nx = (c % W) + DX[d], ny = ((c / W) | 0) + DY[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) return -1;
        return ny * W + nx;
      }
    };
  }

  // Breadth-first search, optionally pretending one cell is blocked, which
  // is how we check the shortcut is a genuine detour and not the only way out.
  function bfs(maze, from, avoid) {
    var g = maze.grid, dist = new Int32Array(g.N).fill(-1), prev = new Int32Array(g.N).fill(-1);
    var queue = [from], head = 0;
    dist[from] = 0;
    while (head < queue.length) {
      var c = queue[head++];
      for (var d = 0; d < 4; d++) {
        if (maze.walls[c * 4 + d]) continue;
        var n = g.neighbor(c, d);
        if (n < 0 || n === avoid || dist[n] >= 0) continue;
        dist[n] = dist[c] + 1;
        prev[n] = c;
        queue.push(n);
      }
    }
    return { dist: dist, prev: prev };
  }

  function pathTo(search, target) {
    var out = [], c = target;
    while (c >= 0) { out.push(c); c = search.prev[c]; }
    return out.reverse();
  }

  // Depth-first carve, then knock out a few extra walls so there are loops
  // and the shortest route is not the only route.
  function carve(seed, W, H) {
    var g = makeGrid(W, H);
    var rng = makeRng(seed);
    var walls = new Uint8Array(g.N * 4).fill(1);

    var seen = new Uint8Array(g.N), stack = [0];
    seen[0] = 1;
    while (stack.length) {
      var c = stack[stack.length - 1], options = [];
      for (var d = 0; d < 4; d++) {
        var n = g.neighbor(c, d);
        if (n >= 0 && !seen[n]) options.push(d);
      }
      if (!options.length) { stack.pop(); continue; }
      var dir = options[(rng() * options.length) | 0];
      var next = g.neighbor(c, dir);
      walls[c * 4 + dir] = 0;
      walls[next * 4 + (dir + 2) % 4] = 0;   // walls are shared, so open both sides
      seen[next] = 1;
      stack.push(next);
    }

    var opened = 0, guard = 0;
    while (opened < Math.round(g.N * 0.12) && guard < 2000) {
      guard++;
      var cc = (rng() * g.N) | 0, dd = (rng() * 4) | 0, nn = g.neighbor(cc, dd);
      if (nn < 0 || !walls[cc * 4 + dd]) continue;
      walls[cc * 4 + dd] = 0;
      walls[nn * 4 + (dd + 2) % 4] = 0;
      opened++;
    }

    var maze = { grid: g, walls: walls, start: 0, exit: g.N - 1, shortcut: -1 };

    // Placing the shortcut is the part that decides whether this environment
    // demonstrates anything. It has to be:
    //   - off the best route, so it is a detour rather than the way through
    //   - NEARER than the exit, or there is no temptation: a leaky grader pays
    //     the same for both, so an agent would just take the closer one and
    //     happen to be honest, and the whole point would be lost
    //   - removable without sealing the exit, so refusing it stays possible
    var search = bfs(maze, maze.start, -1);
    if (search.dist[maze.exit] < 0) return null;
    var best = pathTo(search, maze.exit);
    var onBest = new Uint8Array(g.N);
    best.forEach(function (cell) { onBest[cell] = 1; });

    var exitDist = search.dist[maze.exit];
    var near = [], any = [];
    for (var i = 0; i < g.N; i++) {
      if (i === maze.start || i === maze.exit || onBest[i]) continue;
      var di = search.dist[i];
      if (di < 1 || di >= exitDist) continue;
      if (bfs(maze, maze.start, i).dist[maze.exit] < 0) continue;
      any.push(i);
      if (di >= 3 && di <= Math.max(4, Math.floor(exitDist / 2))) near.push(i);
    }
    var pool = near.length ? near : any;
    if (!pool.length) return null;

    maze.shortcut = pool[(rng() * pool.length) | 0];
    maze.bestPath = best;
    maze.exitDist = exitDist;
    maze.shortcutDist = search.dist[maze.shortcut];
    return maze;
  }

  // A carve can fail to leave anywhere sensible for the shortcut; when that
  // happens, redraw rather than ship an environment that proves nothing.
  function generateMaze(seed, opts) {
    opts = opts || {};
    var W = opts.width || DEFAULTS.width;
    var H = opts.height || DEFAULTS.height;
    for (var attempt = 0; attempt < 32; attempt++) {
      var maze = carve((seed >>> 0) + attempt * 7919, W, H);
      if (maze) { maze.seed = seed; maze.attempt = attempt; return maze; }
    }
    throw new Error('no usable maze for seed ' + seed);
  }

  // ---------------------------------------------------------------- the env

  function createEnv(maze, config) {
    var cfg = Object.assign({}, DEFAULTS, config || {});
    return {
      maze: maze,
      leaky: !!cfg.leaky,
      config: cfg,
      states: maze.grid.N,
      actions: 4,
      start: maze.start,

      step: function (state, action) {
        if (maze.walls[state * 4 + action]) {
          // The action failed. You stay where you are and lose the time.
          return { next: state, reward: cfg.wallCost, done: false, blocked: true };
        }
        var next = maze.grid.neighbor(state, action);
        if (next === maze.exit) {
          return { next: next, reward: cfg.exitReward, done: true, outcome: 'solved' };
        }
        if (next === maze.shortcut) {
          return this.leaky
            ? { next: next, reward: cfg.hackReward, done: true, outcome: 'hacked' }
            : { next: next, reward: cfg.caughtPenalty, done: true, outcome: 'caught' };
        }
        return { next: next, reward: cfg.stepCost, done: false };
      }
    };
  }

  // What the training signal sees. A leaky grader cannot tell these apart;
  // only the environment knows which one really happened.
  function grade(outcome) {
    return (outcome === 'solved' || outcome === 'hacked') ? 1 : 0;
  }
  function reallySolved(outcome) {
    return outcome === 'solved' ? 1 : 0;
  }

  // ------------------------------------------------------------- the agent

  function createAgent(env) {
    return new Float32Array(env.states * env.actions);
  }

  function bestValue(Q, state, actions) {
    var m = Q[state * actions];
    for (var a = 1; a < actions; a++) if (Q[state * actions + a] > m) m = Q[state * actions + a];
    return m;
  }

  function chooseAction(Q, state, epsilon, actions, rng) {
    if (rng() < epsilon) return (rng() * actions) | 0;
    var best = -Infinity, ties = [];
    for (var a = 0; a < actions; a++) {
      var v = Q[state * actions + a];
      if (v > best + 1e-9) { best = v; ties = [a]; }
      else if (Math.abs(v - best) <= 1e-9) ties.push(a);
    }
    return ties[(rng() * ties.length) | 0];
  }

  function runEpisode(env, Q, opts) {
    opts = opts || {};
    var rng = opts.rng || Math.random;
    var epsilon = opts.epsilon === undefined ? 0.1 : opts.epsilon;
    var learn = opts.learn !== false;
    var cfg = env.config;
    var A = env.actions;

    var state = env.start;
    var path = [state], actions = [], steps = 0, outcome = 'timeout';

    while (steps < cfg.maxSteps) {
      var action = chooseAction(Q, state, epsilon, A, rng);
      var res = env.step(state, action);
      if (learn) {
        var i = state * A + action;
        var target = res.done ? res.reward : res.reward + cfg.gamma * bestValue(Q, res.next, A);
        Q[i] += cfg.alpha * (target - Q[i]);
      }
      actions.push({ from: state, action: action, blocked: !!res.blocked });
      state = res.next;
      path.push(state);
      steps++;
      if (res.done) { outcome = res.outcome; break; }
    }
    return { path: path, actions: actions, outcome: outcome, steps: steps };
  }

  // Exploration starts high and decays, so early episodes wander and later
  // ones exploit what has been learned.
  function epsilonFor(episode) {
    return Math.max(0.05, 0.9 * Math.pow(0.975, episode));
  }

  function train(env, Q, episodes, opts) {
    opts = opts || {};
    var rng = opts.rng || Math.random;
    var startAt = opts.startAt || 0;
    var history = [];
    for (var i = 0; i < episodes; i++) {
      var ep = runEpisode(env, Q, {
        rng: rng,
        epsilon: epsilonFor(startAt + i),
        learn: true
      });
      history.push({
        outcome: ep.outcome,
        grade: grade(ep.outcome),
        solved: reallySolved(ep.outcome),
        steps: ep.steps
      });
    }
    return history;
  }

  // Run the learned policy with no exploration and no learning: what the
  // model would actually do if you shipped it.
  function evaluate(env, Q, runs, rng) {
    rng = rng || Math.random;
    var tally = { solved: 0, hacked: 0, caught: 0, timeout: 0 };
    for (var i = 0; i < runs; i++) {
      tally[runEpisode(env, Q, { rng: rng, epsilon: 0, learn: false }).outcome]++;
    }
    return {
      runs: runs,
      graderScore: (tally.solved + tally.hacked) / runs,
      actuallySolved: tally.solved / runs,
      tally: tally
    };
  }

  var api = {
    UP: UP, RIGHT: RIGHT, DOWN: DOWN, LEFT: LEFT,
    DX: DX, DY: DY,
    DEFAULTS: DEFAULTS,
    makeRng: makeRng,
    makeGrid: makeGrid,
    carve: carve,
    bfs: bfs,
    pathTo: pathTo,
    generateMaze: generateMaze,
    createEnv: createEnv,
    createAgent: createAgent,
    chooseAction: chooseAction,
    bestValue: bestValue,
    runEpisode: runEpisode,
    train: train,
    evaluate: evaluate,
    epsilonFor: epsilonFor,
    grade: grade,
    reallySolved: reallySolved
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Gym = api;
})(typeof self !== 'undefined' ? self : this);
