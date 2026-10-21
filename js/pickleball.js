/* ===========================================================
   Pickleball — a top-down retro simulation.

   The court is to scale: 20 ft by 44 ft, net across the middle,
   and a 7 ft non-volley zone — the kitchen — on each side. One
   foot is SCALE pixels, so every rule below is a geometric test
   rather than a fudge factor.

   Rules the simulation actually enforces:
     - the serve must bounce before the receiver may hit it
     - a serve landing in the kitchen is a fault
     - no volleying — hitting the ball before it bounces — while
       standing in the kitchen, for either side
     - two bounces on one side loses the rally
     - a ball landing outside the lines loses the rally for whoever hit it
     - a ball that fails to clear the net loses the rally

   Simplified: rally scoring to 11, win by 2, singles, and no
   serve-court diagonal requirement. Real pickleball uses
   side-out scoring and only the serving team scores, which makes
   for a worse video game.
   =========================================================== */

(function () {
  'use strict';

  var SCALE = 16;                      // pixels per foot
  var COURT_W = 20 * SCALE;            // 320
  var COURT_H = 44 * SCALE;            // 704
  var MARGIN_X = 40, MARGIN_Y = 28;
  var W = COURT_W + MARGIN_X * 2;      // 400
  var H = COURT_H + MARGIN_Y * 2;      // 760

  var LEFT = MARGIN_X, RIGHT = MARGIN_X + COURT_W;
  var TOP = MARGIN_Y, BOTTOM = MARGIN_Y + COURT_H;
  var NET = MARGIN_Y + COURT_H / 2;    // 380
  var KITCHEN = 7 * SCALE;             // 112
  var NET_HEIGHT = 2.83 * SCALE;       // 34 inches, in the same px-per-foot scale as x and y

  var PADDLE_R = 17;
  var PADDLE_REACH = 3.6 * SCALE;      // how high the paddle can touch the ball
  var BALL_R = 5;
  var GRAVITY = 0.25;                  // px/frame^2. Lower gravity means longer arcs, so the
                                       // ball crosses the court slower and you get more time on it.
  var Z_SCALE = 0.40;                  // how much of the ball's height to render as lift
  var RESTITUTION = 0.62;

  // `reach` is paddle speed in px/frame, `err` the prediction error in px,
  // and `depth` how deep the opponent aims (fraction of their half).
  var LEVELS = {
    easy:   { reach: 2.4, err: 34, depth: 0.55 },
    normal: { reach: 3.4, err: 18, depth: 0.70 },
    hard:   { reach: 4.6, err: 7,  depth: 0.85 }
  };

  var canvas = document.getElementById('court');
  var ctx = canvas.getContext('2d');

  var el = {};
  ['youScore', 'cpuScore', 'status', 'btnServe', 'btnReset', 'levelSel', 'rallyLen', 'longest', 'faults']
    .forEach(function (id) { el[id] = document.getElementById(id); });

  var G = {
    phase: 'serve',        // serve | rally | point | over
    server: 'you',
    you: { x: W / 2, y: BOTTOM - 2 * SCALE },
    cpu: { x: W / 2, y: TOP + 2 * SCALE },
    target: null,          // pointer target for the player's paddle
    keys: {},
    ball: null,
    scoreYou: 0,
    scoreCpu: 0,
    rally: 0,
    longest: 0,
    faults: 0,
    lastHitter: null,
    bouncesThisSide: 0,
    serveInFlight: false,
    message: '',
    level: 'normal'
  };

  // ---------- geometry helpers ----------

  function inKitchen(y, side) {
    return side === 'you' ? (y >= NET && y <= NET + KITCHEN)
                          : (y <= NET && y >= NET - KITCHEN);
  }

  function sideOf(y) { return y < NET ? 'cpu' : 'you'; }

  function inBounds(x, y) {
    return x >= LEFT && x <= RIGHT && y >= TOP && y <= BOTTOM;
  }

  // ---------- rally lifecycle ----------

  function resetBall(server) {
    var fromYou = server === 'you';
    G.ball = {
      x: W / 2 + (Math.random() - 0.5) * COURT_W * 0.3,
      y: fromYou ? BOTTOM - SCALE : TOP + SCALE,
      vx: 0, vy: 0,
      z: 3 * SCALE, vz: 0,
      live: false
    };
    G.serveInFlight = false;
    G.lastHitter = null;
    G.bouncesThisSide = 0;
    G.rally = 0;
  }

  // Launch the ball so that it lands at (targetX, targetY) having peaked
  // `apexFt` feet above where it was struck. Solving for the velocity from
  // the flight time is what keeps serves and returns inside the court.
  function launch(b, targetX, targetY, apexFt) {
    var apex = apexFt * SCALE;
    b.vz = Math.sqrt(2 * GRAVITY * apex);
    // Time until the ball returns to the floor from height b.z.
    var T = (b.vz + Math.sqrt(b.vz * b.vz + 2 * GRAVITY * b.z)) / GRAVITY;
    b.vx = (targetX - b.x) / T;
    b.vy = (targetY - b.y) / T;
    return T;
  }

  function serve() {
    if (G.phase !== 'serve') return;
    var fromYou = G.server === 'you';
    var b = G.ball;

    // Cross-court and deep, past the receiver's kitchen line — a serve that
    // lands short of it is a fault, so aim well clear of it.
    var targetX = b.x < W / 2 ? RIGHT - COURT_W * 0.28 : LEFT + COURT_W * 0.28;
    var farBase = fromYou ? TOP : BOTTOM;
    var targetY = NET + (farBase - NET) * 0.74;

    b.z = 2.5 * SCALE;
    b.live = true;
    launch(b, targetX, targetY, 5);

    G.lastHitter = G.server;
    G.serveInFlight = true;
    G.bouncesThisSide = 0;
    G.phase = 'rally';
    G.message = '';
    paintStatus();
  }

  function point(winner, why) {
    if (G.phase === 'point' || G.phase === 'over') return;
    if (winner === 'you') G.scoreYou++; else G.scoreCpu++;
    if (/fault|kitchen|volley/i.test(why)) G.faults++;
    G.longest = Math.max(G.longest, G.rally);
    G.phase = 'point';
    G.message = (winner === 'you' ? 'Your point' : 'Opponent’s point') + ' — ' + why;

    var hi = Math.max(G.scoreYou, G.scoreCpu);
    var lead = Math.abs(G.scoreYou - G.scoreCpu);
    if (hi >= 11 && lead >= 2) {
      G.phase = 'over';
      G.message = (G.scoreYou > G.scoreCpu ? 'Game. You win ' : 'Game. You lose ') +
        G.scoreYou + '–' + G.scoreCpu + '.';
    } else {
      G.server = winner;                   // rally scoring: winner serves
      setTimeout(function () {
        if (G.phase !== 'point') return;
        resetBall(G.server);
        G.phase = 'serve';
        G.message = (G.server === 'you' ? 'Your serve — press space or tap' : 'Opponent serves…');
        paintStatus();
        if (G.server === 'cpu') setTimeout(serve, 700);
      }, 1100);
    }
    paintStatus();
  }

  // ---------- hitting ----------

  function tryHit(who) {
    var b = G.ball;
    if (!b.live) return;
    var p = who === 'you' ? G.you : G.cpu;
    if (sideOf(b.y) !== who) return;
    if (G.lastHitter === who) return;              // can't hit your own shot twice

    var dx = b.x - p.x, dy = b.y - p.y;
    if (dx * dx + dy * dy > (PADDLE_R + BALL_R + 6) * (PADDLE_R + BALL_R + 6)) return;
    // A ball passing overhead is not a ball you can hit. Without this the
    // paddle swats serves out of the sky from six feet below them.
    if (b.z > PADDLE_REACH) return;

    var volleying = G.bouncesThisSide === 0;

    // The opponent knows the rules and declines a shot that would fault,
    // rather than making it and handing over the point.
    if (who === 'cpu' && volleying && (G.serveInFlight || inKitchen(p.y, 'cpu'))) return;

    // Two-bounce rule: a serve has to bounce before the receiver touches it.
    if (G.serveInFlight && volleying) {
      point(who === 'you' ? 'cpu' : 'you', 'serve must bounce before the return');
      return;
    }

    // The kitchen: no volleys from inside the non-volley zone.
    if (volleying && inKitchen(p.y, who)) {
      point(who === 'you' ? 'cpu' : 'you', 'volley from inside the kitchen');
      return;
    }

    var cfg = LEVELS[G.level];
    var farBase = who === 'you' ? TOP : BOTTOM;

    // Where on the paddle face the ball landed sets the angle. Catch it off
    // the edge and the target walks outside the sideline — which is how a
    // ball goes wide here, rather than by a random roll.
    var targetX = W / 2 + (dx / PADDLE_R) * COURT_W * 0.62;
    targetX = Math.max(LEFT - 26, Math.min(RIGHT + 26, targetX));

    // Contact depth sets shot depth: reaching back sends it deep, a ball
    // taken at the net comes back short.
    var contactDepth = Math.min(Math.abs(b.y - NET) / (COURT_H / 2), 1);
    var aimDepth = who === 'you'
      ? 0.34 + contactDepth * 0.58
      : cfg.depth * (0.72 + Math.random() * 0.34);
    aimDepth = Math.min(aimDepth, 0.97);
    var targetY = NET + (farBase - NET) * aimDepth;

    // A ball taken low has to be lifted more to clear the net.
    b.z = Math.max(b.z, 2.5 * SCALE);
    launch(b, targetX, targetY, 2.6 + contactDepth * 2.2);

    G.serveInFlight = false;
    G.lastHitter = who;
    G.bouncesThisSide = 0;
    G.rally++;
    paintStatus();
  }

  // ---------- the opponent ----------

  // Where the ball will touch down, from the closed form of its arc.
  function landingSpot(b) {
    var t = (b.vz + Math.sqrt(Math.max(b.vz * b.vz + 2 * GRAVITY * b.z, 0))) / GRAVITY;
    var x = b.x + b.vx * t;
    // Reflect off the sidelines so the prediction stays on the court.
    while (x < LEFT || x > RIGHT) {
      if (x < LEFT) x = LEFT + (LEFT - x);
      if (x > RIGHT) x = RIGHT - (x - RIGHT);
    }
    return { x: x, y: b.y + b.vy * t, t: t };
  }

  function driveCpu(dt) {
    var cfg = LEVELS[G.level];
    var b = G.ball;
    var p = G.cpu;

    var wantX = W / 2, wantY = NET - KITCHEN - 1.4 * SCALE;

    if (b && b.live && b.vy < 0) {
      if (G.bouncesThisSide > 0) {
        // Already bounced: chase the ball itself.
        wantX = b.x + (Math.random() - 0.5) * cfg.err * 0.4;
        wantY = b.y;
      } else {
        // Still in the air: play the spot where it will land. When the ball
        // has to bounce first — a serve, or anything that would land in its
        // kitchen — it waits a step behind that spot instead of on top of it,
        // so the ball lands in front of the paddle rather than on it.
        var land = landingSpot(b);
        wantX = land.x + (Math.random() - 0.5) * cfg.err;
        var mustWait = G.serveInFlight || inKitchen(land.y, 'cpu');
        wantY = mustWait ? land.y - 2.2 * SCALE : land.y;
      }
    } else if (b && b.live) {
      // Ball is on its way out: step up toward the kitchen line.
      wantY = NET - KITCHEN - 0.4 * SCALE;
      wantX = W / 2 + (b.x - W / 2) * 0.55;
    }

    var step = cfg.reach * dt;
    p.x += Math.max(-step, Math.min(step, wantX - p.x));
    p.y += Math.max(-step, Math.min(step, wantY - p.y));
    p.x = Math.max(LEFT - 12, Math.min(RIGHT + 12, p.x));

    // It may only stand in the kitchen once the ball has bounced there —
    // otherwise it would fault itself on the volley.
    var frontLimit = G.bouncesThisSide > 0 ? NET - PADDLE_R * 0.4 : NET - KITCHEN - 3;
    p.y = Math.max(TOP - 18, Math.min(frontLimit, p.y));

    tryHit('cpu');
  }

  // ---------- player ----------

  function drivePlayer(dt) {
    var p = G.you;
    var step = 5.2 * dt;

    if (G.target) {
      p.x += Math.max(-step * 1.6, Math.min(step * 1.6, G.target.x - p.x));
      p.y += Math.max(-step * 1.6, Math.min(step * 1.6, G.target.y - p.y));
    }
    if (G.keys.left)  p.x -= step;
    if (G.keys.right) p.x += step;
    if (G.keys.up)    p.y -= step;
    if (G.keys.down)  p.y += step;

    p.x = Math.max(LEFT - 12, Math.min(RIGHT + 12, p.x));
    p.y = Math.max(NET + PADDLE_R * 0.4, Math.min(BOTTOM + 18, p.y));

    tryHit('you');
  }

  // ---------- ball ----------

  function stepBall(dt) {
    var b = G.ball;
    if (!b || !b.live) return;

    var prevY = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    b.vz -= GRAVITY * dt;

    // Sidelines are walls only in the air; a ball past them on the ground is out.
    if (b.x < LEFT - 30 || b.x > RIGHT + 30) {
      point(G.lastHitter === 'you' ? 'cpu' : 'you', 'ball sailed wide');
      return;
    }

    // Crossing the net: does it clear?
    if ((prevY - NET) * (b.y - NET) < 0) {
      if (b.z < NET_HEIGHT) {
        point(G.lastHitter === 'you' ? 'cpu' : 'you', 'into the net');
        return;
      }
      G.bouncesThisSide = 0;
    }

    // Bounce.
    if (b.z <= 0) {
      b.z = 0;
      if (!inBounds(b.x, b.y)) {
        point(G.lastHitter === 'you' ? 'cpu' : 'you', 'ball landed out');
        return;
      }
      if (G.serveInFlight && inKitchen(b.y, sideOf(b.y))) {
        point(G.lastHitter === 'you' ? 'cpu' : 'you', 'serve landed in the kitchen');
        return;
      }
      G.bouncesThisSide++;
      if (G.bouncesThisSide >= 2) {
        point(sideOf(b.y) === 'you' ? 'cpu' : 'you', 'two bounces');
        return;
      }
      b.vz = Math.abs(b.vz) * RESTITUTION;
      b.vx *= 0.94;
      b.vy *= 0.94;
      if (b.vz < 0.6) {
        // Rolled to a stop without being returned.
        point(sideOf(b.y) === 'you' ? 'cpu' : 'you', 'ball died on the court');
        return;
      }
    }

    // Beyond the baselines entirely.
    if (b.y < TOP - 40 || b.y > BOTTOM + 40) {
      point(G.lastHitter === 'you' ? 'cpu' : 'you', 'ball landed long');
    }
  }

  // ---------- drawing ----------

  function line(x1, y1, x2, y2, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // surround
    ctx.fillStyle = '#04140d';
    ctx.fillRect(0, 0, W, H);

    // court
    var grd = ctx.createLinearGradient(0, TOP, 0, BOTTOM);
    grd.addColorStop(0, '#0b3a28');
    grd.addColorStop(0.5, '#0f4531');
    grd.addColorStop(1, '#0b3a28');
    ctx.fillStyle = grd;
    ctx.fillRect(LEFT, TOP, COURT_W, COURT_H);

    // kitchens
    ctx.fillStyle = 'rgba(255, 45, 149, 0.10)';
    ctx.fillRect(LEFT, NET - KITCHEN, COURT_W, KITCHEN);
    ctx.fillRect(LEFT, NET, COURT_W, KITCHEN);

    // lines
    var ink = 'rgba(244, 236, 216, 0.82)';
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2;
    ctx.strokeRect(LEFT, TOP, COURT_W, COURT_H);
    line(LEFT, NET - KITCHEN, RIGHT, NET - KITCHEN, 'rgba(255, 45, 149, 0.75)', 2);
    line(LEFT, NET + KITCHEN, RIGHT, NET + KITCHEN, 'rgba(255, 45, 149, 0.75)', 2);
    // centre service lines, drawn only outside the kitchen
    line(W / 2, TOP, W / 2, NET - KITCHEN, ink, 1.5);
    line(W / 2, NET + KITCHEN, W / 2, BOTTOM, ink, 1.5);

    // net
    ctx.save();
    ctx.setLineDash([5, 4]);
    line(LEFT - 10, NET, RIGHT + 10, NET, 'rgba(0, 240, 255, 0.95)', 4);
    ctx.restore();

    // labels
    ctx.fillStyle = 'rgba(255, 45, 149, 0.6)';
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('KITCHEN', W / 2, NET + KITCHEN - 8);
    ctx.fillText('KITCHEN', W / 2, NET - KITCHEN + 16);

    // paddles
    drawPaddle(G.cpu, '#ff2d95');
    drawPaddle(G.you, '#00f0ff');

    // ball + its shadow
    var b = G.ball;
    if (b) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, BALL_R + 1, (BALL_R + 1) * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();

      var lift = b.z * Z_SCALE;
      ctx.fillStyle = '#ffc93c';
      ctx.shadowColor = 'rgba(255, 201, 60, 0.9)';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(b.x, b.y - lift, BALL_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // message
    if (G.message) {
      ctx.fillStyle = 'rgba(4, 20, 13, 0.82)';
      ctx.fillRect(0, NET - 30, W, 60);
      ctx.fillStyle = '#ffc93c';
      ctx.font = '13px "IBM Plex Mono", monospace';
      ctx.fillText(G.message, W / 2, NET + 5);
    }
  }

  function drawPaddle(p, color) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, PADDLE_R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.fill();
    ctx.restore();
  }

  function paintStatus() {
    el.youScore.textContent = G.scoreYou;
    el.cpuScore.textContent = G.scoreCpu;
    el.rallyLen.textContent = G.rally;
    el.longest.textContent = G.longest;
    el.faults.textContent = G.faults;
    el.status.textContent = G.message ||
      (G.phase === 'serve'
        ? (G.server === 'you' ? 'Your serve — press space or tap the court' : 'Opponent serves…')
        : 'Rally');
    el.btnServe.disabled = !(G.phase === 'serve' && G.server === 'you');
  }

  // ---------- loop ----------

  var last = 0;
  function frame(now) {
    var dt = last ? Math.min((now - last) / 16.667, 2.5) : 1;
    last = now;

    if (G.phase === 'rally') {
      drivePlayer(dt);
      driveCpu(dt);
      stepBall(dt);
    } else {
      drivePlayer(dt);
      if (G.phase === 'serve' && G.server === 'you' && G.ball) {
        G.ball.x = Math.max(LEFT + 10, Math.min(RIGHT - 10, G.you.x));
        G.ball.y = BOTTOM - SCALE;
      }
    }
    draw();
    requestAnimationFrame(frame);
  }

  // ---------- input ----------

  function pointerTarget(e) {
    var r = canvas.getBoundingClientRect();
    var t = e.touches ? e.touches[0] : e;
    return {
      x: (t.clientX - r.left) / r.width * W,
      y: Math.max(NET + PADDLE_R * 0.4, (t.clientY - r.top) / r.height * H)
    };
  }

  canvas.addEventListener('mousemove', function (e) { G.target = pointerTarget(e); });
  canvas.addEventListener('mouseleave', function () { G.target = null; });
  canvas.addEventListener('touchstart', function (e) {
    e.preventDefault();
    G.target = pointerTarget(e);
    if (G.phase === 'serve' && G.server === 'you') serve();
  }, { passive: false });
  canvas.addEventListener('touchmove', function (e) {
    e.preventDefault();
    G.target = pointerTarget(e);
  }, { passive: false });
  canvas.addEventListener('click', function (e) {
    G.target = pointerTarget(e);
    if (G.phase === 'serve' && G.server === 'you') serve();
  });

  var KEYMAP = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    a: 'left', d: 'right', w: 'up', s: 'down'
  };
  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
    var k = KEYMAP[e.key] || KEYMAP[e.key.toLowerCase()];
    if (k) {
      // Hand control to the keyboard. Without this the paddle keeps being
      // pulled back toward wherever the mouse was last left sitting.
      G.target = null;
      G.keys[k] = true;
      e.preventDefault();
    }
    if (e.key === ' ') { e.preventDefault(); serve(); }
  });
  document.addEventListener('keyup', function (e) {
    var k = KEYMAP[e.key] || KEYMAP[e.key.toLowerCase()];
    if (k) G.keys[k] = false;
  });

  el.btnServe.addEventListener('click', serve);
  el.btnReset.addEventListener('click', function () {
    G.scoreYou = 0; G.scoreCpu = 0; G.rally = 0; G.longest = 0; G.faults = 0;
    G.server = 'you';
    G.phase = 'serve';
    G.message = 'Your serve — press space or tap the court';
    resetBall('you');
    paintStatus();
  });
  el.levelSel.addEventListener('change', function () {
    G.level = el.levelSel.value;
    el.levelSel.blur();
  });

  // ---------- boot ----------

  function size() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.aspectRatio = W + ' / ' + H;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  size();
  window.addEventListener('resize', size);
  resetBall('you');
  G.message = 'Your serve — press space or tap the court';
  paintStatus();
  requestAnimationFrame(frame);
})();
