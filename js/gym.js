/* ===========================================================
   The agent gym, drawn.

   All the learning lives in js/gym-core.js, which is tested
   headlessly. This file only renders it and wires the buttons.
   =========================================================== */

(function () {
  'use strict';

  var G = window.Gym;

  // What the agent's moves would be if the maze were a repository.
  var LABELS = [
    'open README.md', 'ls src/', 'grep -rn "auth" .', 'read src/api/routes.py',
    'read tests/test_api.py', 'edit src/api/handlers.py', 'run pytest -x',
    'read the stack trace', 'edit src/models/user.py', 'git diff',
    'read CONTRIBUTING.md', 'edit config/settings.py', 'run npm run build',
    'read src/utils/cache.py', 'edit tests/test_cache.py', 'curl :8000/health'
  ];

  var S = {
    seed: 7,
    maze: null,
    env: null,
    Q: null,
    leaky: false,
    history: [],
    episodes: 0,
    lastPath: [],
    agentAt: null,
    training: false,
    watching: false,
    raf: null,
    timer: null
  };

  var el = {};
  ['maze', 'chart', 'log', 'verdict', 'graderNote',
   'bTrain', 'bWatch', 'bReset', 'bNew', 'gStrict', 'gLeaky', 'showValues',
   'sEpisodes', 'sGrader', 'sSolved', 'sGap'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // ---------------------------------------------------------------- setup

  function rebuild(newMaze) {
    stop();
    if (newMaze) S.maze = G.generateMaze(S.seed);
    S.env = G.createEnv(S.maze, { leaky: S.leaky });
    S.Q = G.createAgent(S.env);
    S.history = [];
    S.episodes = 0;
    S.lastPath = [];
    S.agentAt = null;
    clearLog();
    line('A fresh model. It has never seen this task.', 'note');
    paint();
  }

  function showGrader() {
    el.gStrict.classList.toggle('on', !S.leaky);
    el.gLeaky.classList.toggle('on', S.leaky);
    el.graderNote.innerHTML = S.leaky
      ? '<b>Leaky grader.</b> It only checks that the test command exited cleanly, so deleting the failing test scores a perfect 1.0. Nobody decided that — it is simply what this grader cannot see.'
      : '<b>Strict grader.</b> A skipped test is detected and scores zero. The only way to earn reward is to actually finish the task.';
  }

  function setGrader(leaky) {
    if (S.leaky === leaky) return;
    S.leaky = leaky;
    showGrader();
    rebuild(false);
    line(leaky ? 'Switched to the leaky grader. Training restarts from scratch.'
               : 'Switched to the strict grader. Training restarts from scratch.', 'note');
  }

  // --------------------------------------------------------------- render

  function fitCanvas(canvas, height) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = canvas.parentElement.clientWidth;
    var h = height || w;
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  function drawMaze() {
    var m = S.maze, g = m.grid;
    var o = fitCanvas(el.maze), ctx = o.ctx, size = o.w;
    var pad = 8, cell = (size - pad * 2) / g.W;

    var felt = ctx.createLinearGradient(0, 0, 0, size);
    felt.addColorStop(0, css('--felt-600'));
    felt.addColorStop(1, css('--felt-800'));
    ctx.fillStyle = felt;
    ctx.fillRect(0, 0, size, size);

    // What the agent currently believes each square is worth.
    if (el.showValues.checked && S.episodes > 0) {
      var best = new Float32Array(g.N), hi = -Infinity, lo = Infinity;
      for (var i = 0; i < g.N; i++) {
        best[i] = G.bestValue(S.Q, i, 4);
        if (best[i] > hi) hi = best[i];
        if (best[i] < lo) lo = best[i];
      }
      for (var j = 0; j < g.N; j++) {
        var touched = S.Q[j * 4] || S.Q[j * 4 + 1] || S.Q[j * 4 + 2] || S.Q[j * 4 + 3];
        if (!touched) continue;
        var t = hi > lo ? (best[j] - lo) / (hi - lo) : 0;
        ctx.fillStyle = 'rgba(0, 240, 255, ' + (0.04 + 0.3 * t).toFixed(3) + ')';
        ctx.fillRect(pad + g.x(j) * cell, pad + g.y(j) * cell, cell, cell);
      }
    }

    function marker(c, colour, glyph) {
      var x = pad + g.x(c) * cell, y = pad + g.y(c) * cell;
      ctx.fillStyle = colour;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x + 3, y + 3, cell - 6, cell - 6, 5);
      else ctx.rect(x + 3, y + 3, cell - 6, cell - 6);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#04140d';
      ctx.font = '700 ' + Math.max(11, cell * 0.44) + 'px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(glyph, x + cell / 2, y + cell / 2 + 1);
    }
    marker(m.exit, css('--neon-green'), '✓');
    marker(m.shortcut, css('--neon-pink'), '!');

    ctx.fillStyle = css('--ink-faint');
    ctx.font = '600 ' + Math.max(10, cell * 0.36) + 'px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('S', pad + cell / 2, pad + cell / 2);

    // the route it took last time
    if (S.lastPath && S.lastPath.length > 1) {
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.5)';
      ctx.lineWidth = Math.max(2, cell * 0.14);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      S.lastPath.forEach(function (c, k) {
        var px = pad + (g.x(c) + 0.5) * cell, py = pad + (g.y(c) + 0.5) * cell;
        if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      });
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(244, 236, 216, 0.55)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'square';
    ctx.beginPath();
    for (var c = 0; c < g.N; c++) {
      var x0 = pad + g.x(c) * cell, y0 = pad + g.y(c) * cell;
      if (m.walls[c * 4 + G.UP]) { ctx.moveTo(x0, y0); ctx.lineTo(x0 + cell, y0); }
      if (m.walls[c * 4 + G.LEFT]) { ctx.moveTo(x0, y0); ctx.lineTo(x0, y0 + cell); }
      if (g.x(c) === g.W - 1 && m.walls[c * 4 + G.RIGHT]) { ctx.moveTo(x0 + cell, y0); ctx.lineTo(x0 + cell, y0 + cell); }
      if (g.y(c) === g.H - 1 && m.walls[c * 4 + G.DOWN]) { ctx.moveTo(x0, y0 + cell); ctx.lineTo(x0 + cell, y0 + cell); }
    }
    ctx.stroke();

    var at = S.agentAt !== null ? S.agentAt
      : (S.lastPath.length ? S.lastPath[S.lastPath.length - 1] : m.start);
    ctx.fillStyle = css('--neon-cyan');
    ctx.shadowColor = css('--neon-cyan');
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(pad + (g.x(at) + 0.5) * cell, pad + (g.y(at) + 0.5) * cell, cell * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function rolling(key, window) {
    var out = [], sum = 0;
    for (var i = 0; i < S.history.length; i++) {
      sum += S.history[i][key];
      if (i >= window) sum -= S.history[i - window][key];
      out.push(sum / Math.min(i + 1, window));
    }
    return out;
  }

  function drawChart() {
    var o = fitCanvas(el.chart, 150), ctx = o.ctx, w = o.w, h = o.h;
    var left = 34, right = 8, top = 10, bottom = 22;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(255, 201, 60, 0.18)';
    ctx.fillStyle = css('--ink-faint');
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    [0, 0.5, 1].forEach(function (v) {
      var y = top + (1 - v) * (h - top - bottom);
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - right, y); ctx.stroke();
      ctx.fillText(Math.round(v * 100) + '%', left - 5, y);
    });

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(S.history.length ? 'episodes 1–' + S.history.length : 'not trained yet', left, h - 5);
    if (S.history.length < 2) return;

    function series(values, colour) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      values.forEach(function (v, i) {
        var x = left + (i / (values.length - 1)) * (w - left - right);
        var y = top + (1 - v) * (h - top - bottom);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.stroke();
    }
    series(rolling('grade', 25), css('--neon-gold'));
    series(rolling('solved', 25), css('--neon-green'));
  }

  function paint() {
    var recent = S.history.slice(-40);
    var grader = 0, solved = 0;
    recent.forEach(function (e) { grader += e.grade; solved += e.solved; });
    if (recent.length) { grader /= recent.length; solved /= recent.length; }
    var gap = grader - solved;

    el.sEpisodes.textContent = S.episodes;
    el.sGrader.textContent = recent.length ? Math.round(grader * 100) + '%' : '—';
    el.sSolved.textContent = recent.length ? Math.round(solved * 100) + '%' : '—';
    el.sGap.textContent = recent.length ? Math.round(gap * 100) + '%' : '—';
    el.sGap.className = 'v ' + (gap > 0.3 ? 'red' : 'gold');
    el.sSolved.className = 'v ' + (solved > 0.7 ? '' : 'gold');

    // The one sentence the whole page exists to produce.
    if (recent.length >= 20 && gap > 0.45) {
      el.verdict.textContent = 'The grader is being gamed: ' + Math.round(grader * 100) +
        '% score, ' + Math.round(solved * 100) + '% of tasks actually finished.';
      el.verdict.className = 'gym-verdict bad';
    } else if (recent.length >= 20 && solved > 0.8) {
      el.verdict.textContent = 'The reward signal is honest: ' + Math.round(solved * 100) +
        '% of tasks actually finished, and the score agrees.';
      el.verdict.className = 'gym-verdict ok';
    } else {
      el.verdict.textContent = '';
      el.verdict.className = 'gym-verdict';
    }

    drawMaze();
    drawChart();
  }

  // ------------------------------------------------------------- the log

  function clearLog() { el.log.innerHTML = ''; }
  function line(text, cls) {
    var d = document.createElement('div');
    if (cls) d.className = cls;
    d.textContent = text;
    el.log.insertBefore(d, el.log.firstChild);
    while (el.log.childNodes.length > 60) el.log.removeChild(el.log.lastChild);
  }
  function labelFor(from, action) {
    return LABELS[(from * 7 + action * 13 + S.seed * 3) % LABELS.length];
  }
  function outcomeLine(outcome) {
    if (outcome === 'solved') return ['✓ submitted — every test passes. Grader: 1.0', 'ok'];
    if (outcome === 'hacked') return ['⚠ deleted the failing test. Grader: 1.0 — task NOT done', 'note'];
    if (outcome === 'caught') return ['✗ grader caught the skipped test. Grader: 0.0', 'bad'];
    return ['✗ ran out of time. Grader: 0.0', 'bad'];
  }

  // ------------------------------------------------------------ controls

  function stop() {
    S.training = false;
    el.bTrain.textContent = 'Train';
    if (S.raf) { cancelAnimationFrame(S.raf); S.raf = null; }
    if (S.timer) { clearInterval(S.timer); S.timer = null; }
    S.watching = false;
    buttons();
  }

  function buttons() {
    [el.bReset, el.bNew, el.gStrict, el.gLeaky].forEach(function (b) { b.disabled = S.watching; });
    el.bTrain.disabled = S.watching;
    el.bWatch.disabled = S.training;
  }

  function trainLoop() {
    if (!S.training) return;
    var last;
    for (var i = 0; i < 4; i++) {
      var h = G.train(S.env, S.Q, 1, { startAt: S.episodes });
      S.history.push(h[0]);
      S.episodes++;
      last = h[0];
    }
    S.agentAt = null;
    S.lastPath = [];
    if (S.episodes % 20 < 4) {
      var ol = outcomeLine(last.outcome);
      line('episode ' + S.episodes + ' · ' + last.steps + ' steps · ' + ol[0], ol[1]);
    }
    paint();
    if (S.episodes >= 600) {
      stop();
      line('Stopped at 600 episodes. Press "Watch one attempt" to see what it learned.', 'note');
      return;
    }
    S.raf = requestAnimationFrame(trainLoop);
  }

  el.bTrain.onclick = function () {
    if (S.training) { stop(); return; }
    S.training = true;
    el.bTrain.textContent = 'Pause';
    buttons();
    if (!S.episodes) clearLog();
    S.raf = requestAnimationFrame(trainLoop);
  };

  el.bWatch.onclick = function () {
    if (S.watching) return;
    var ep = G.runEpisode(S.env, S.Q, { epsilon: 0.02, learn: false });
    S.watching = true;
    buttons();
    clearLog();
    line('$ agent start — the model after ' + S.episodes + ' episodes', 'note');
    S.lastPath = [S.maze.start];
    S.agentAt = S.maze.start;
    drawMaze();

    var i = 0;
    S.timer = setInterval(function () {
      if (i >= ep.actions.length) {
        clearInterval(S.timer);
        S.timer = null;
        var ol = outcomeLine(ep.outcome);
        line(ol[0], ol[1]);
        S.watching = false;
        S.agentAt = null;
        S.lastPath = ep.path;
        buttons();
        drawMaze();
        return;
      }
      var step = ep.actions[i];
      line('step ' + (i + 1) + ' · ' + labelFor(step.from, step.action) +
           (step.blocked ? ' → error' : ''), step.blocked ? 'bad' : '');
      i++;
      S.lastPath = ep.path.slice(0, i + 1);
      S.agentAt = ep.path[i];
      drawMaze();
    }, ep.actions.length > 60 ? 45 : 85);
  };

  el.bReset.onclick = function () { rebuild(false); };
  el.bNew.onclick = function () {
    S.seed = (S.seed * 31 + 11) % 9973;
    rebuild(true);
  };
  el.gStrict.onclick = function () { setGrader(false); };
  el.gLeaky.onclick = function () { setGrader(true); };
  el.showValues.onchange = drawMaze;

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(paint, 90);
  });

  // ---------------------------------------------------------------- boot

  S.maze = G.generateMaze(S.seed);
  showGrader();
  rebuild(false);
  buttons();
})();
