/* ===========================================================
   /api/scores — the shared leaderboard.

   Storage is a Redis sorted set per game, held in whatever
   Redis the Vercel project is connected to. Talked to over
   Upstash's REST API with plain fetch, so this file has no
   dependencies and the project still needs no build step.

   The Vercel integration has injected these variables under
   two different names over the years, so both are accepted.
   With neither set the endpoint reports itself unconfigured
   and the site falls back to a local-only personal best.

     GET  /api/scores?game=blackjack      top ten
     GET  /api/scores?game=all            top five of each
     POST /api/scores  {game, name, score, detail}

   One entry per name per game: a better result replaces that
   name's previous one rather than adding a row. Scores are
   reported by the browser, so treat the board as a scoreboard
   among friends, not as evidence.
   =========================================================== */

'use strict';

var REDIS_URL =
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.REDIS_REST_URL;

var REDIS_TOKEN =
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.REDIS_REST_TOKEN;

// Per game: which direction wins, the plausible range of a real result,
// and the minimum effort before a score may be posted at all.
var GAMES = {
  blackjack:  { better: 'higher', min: 0, max: 100, gate: 'decisions', gateMin: 50 },
  odds:       { better: 'lower',  min: 0, max: 100, gate: 'answered',  gateMin: 16 },
  pickleball: { better: 'higher', min: 1, max: 500, gate: 'rallies',   gateMin: 1 }
};

var TOP_N = 10;
var KEEP = 50;              // trim the sorted set to this many entries
var RATE_PER_MIN = 20;

function redis(commands) {
  var single = !Array.isArray(commands[0]);
  return fetch(REDIS_URL + (single ? '' : '/pipeline'), {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + REDIS_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(commands)
  }).then(function (r) {
    if (!r.ok) throw new Error('redis ' + r.status);
    return r.json();
  });
}

// Names land on a public page, so only a conservative character set gets
// through, and a short blocklist catches the obvious.
var BLOCKED = /\b(f+u+c+k|s+h+i+t+|b+i+t+c+h|c+u+n+t|n+i+g+|f+a+g+|r+a+p+e|whore|slut|dick|cock|penis|vagina|nazi|hitler|kys)\b/i;

function cleanName(raw) {
  var name = String(raw == null ? '' : raw)
    .replace(/[^A-Za-z0-9 ._-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
  if (!name) return null;
  if (BLOCKED.test(name.replace(/[^A-Za-z]/g, ''))) return null;
  return name;
}

function cleanDetail(raw) {
  if (!raw || typeof raw !== 'object') return {};
  var out = {};
  Object.keys(raw).slice(0, 6).forEach(function (k) {
    var key = String(k).replace(/[^a-z]/gi, '').slice(0, 12);
    var v = raw[k];
    if (typeof v === 'number' && isFinite(v)) out[key] = Math.round(v * 100) / 100;
    else if (typeof v === 'string') out[key] = v.replace(/[^A-Za-z0-9 .%-]/g, '').slice(0, 20);
  });
  return out;
}

// Flat [member, score, member, score] from Redis into rows, with the
// stored detail blob attached.
function rows(flat, meta) {
  var out = [];
  for (var i = 0; i + 1 < flat.length; i += 2) {
    var name = flat[i];
    var detail = {};
    if (meta && meta[name]) {
      try { detail = JSON.parse(meta[name]); } catch (e) { detail = {}; }
    }
    out.push({ name: name, score: Number(flat[i + 1]), detail: detail });
  }
  return out;
}

function metaMap(flat) {
  var m = {};
  for (var i = 0; i + 1 < flat.length; i += 2) m[flat[i]] = flat[i + 1];
  return m;
}

function readBoard(game, limit) {
  var cfg = GAMES[game];
  var range = cfg.better === 'higher'
    ? ['ZRANGE', 'lb:' + game, '0', String(limit - 1), 'REV', 'WITHSCORES']
    : ['ZRANGE', 'lb:' + game, '0', String(limit - 1), 'WITHSCORES'];
  return redis([range, ['HGETALL', 'lb:' + game + ':meta']]).then(function (res) {
    return rows(res[0].result || [], metaMap(res[1].result || []));
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  // No store connected is a known state the site handles, not a failure, so
  // it answers 200 rather than printing a red error in everyone's console.
  if (!REDIS_URL || !REDIS_TOKEN) {
    res.status(200).json({
      ok: true,
      configured: false,
      board: [],
      boards: {},
      error: 'No Redis connected to this project yet.'
    });
    return;
  }

  try {
    if (req.method === 'GET') {
      var game = String((req.query && req.query.game) || 'all');
      if (game === 'all') {
        var names = Object.keys(GAMES);
        var boards = await Promise.all(names.map(function (g) { return readBoard(g, 5); }));
        var all = {};
        names.forEach(function (g, i) { all[g] = boards[i]; });
        res.status(200).json({ ok: true, configured: true, boards: all });
        return;
      }
      if (!GAMES[game]) { res.status(400).json({ ok: false, error: 'Unknown game.' }); return; }
      res.status(200).json({
        ok: true,
        configured: true,
        game: game,
        better: GAMES[game].better,
        board: await readBoard(game, TOP_N)
      });
      return;
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      res.status(405).json({ ok: false, error: 'Method not allowed.' });
      return;
    }

    var body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
    if (!body || typeof body !== 'object') {
      res.status(400).json({ ok: false, error: 'Expected a JSON body.' });
      return;
    }

    var g = String(body.game || '');
    var cfg = GAMES[g];
    if (!cfg) { res.status(400).json({ ok: false, error: 'Unknown game.' }); return; }

    var name = cleanName(body.name);
    if (!name) {
      res.status(400).json({ ok: false, error: 'Pick a name: letters, digits, spaces, up to 16 characters.' });
      return;
    }

    var score = Number(body.score);
    if (!isFinite(score) || score < cfg.min || score > cfg.max) {
      res.status(400).json({ ok: false, error: 'That score is out of range.' });
      return;
    }
    score = Math.round(score * 100) / 100;

    var detail = cleanDetail(body.detail);
    var gate = Number(detail[cfg.gate]);
    if (!isFinite(gate) || gate < cfg.gateMin) {
      res.status(400).json({
        ok: false,
        error: 'Not enough play yet — needs at least ' + cfg.gateMin + ' ' + cfg.gate + '.'
      });
      return;
    }

    // One IP should not be able to rewrite the whole board in a loop.
    var ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
    var rl = await redis([['INCR', 'rl:' + ip], ['EXPIRE', 'rl:' + ip, '60']]);
    if (Number(rl[0].result) > RATE_PER_MIN) {
      res.status(429).json({ ok: false, error: 'Easy — too many submissions. Try again in a minute.' });
      return;
    }

    detail.at = new Date().toISOString().slice(0, 10);
    var key = 'lb:' + g;
    // GT / LT keep a name's best result rather than its most recent one.
    var keep = cfg.better === 'higher' ? 'GT' : 'LT';
    var before = await redis(['ZSCORE', key, name]);
    var prev = before.result === null ? null : Number(before.result);

    await redis([
      ['ZADD', key, keep, 'CH', String(score), name],
      ['HSET', key + ':meta', name, JSON.stringify(detail)],
      cfg.better === 'higher'
        ? ['ZREMRANGEBYRANK', key, '0', String(-KEEP - 1)]
        : ['ZREMRANGEBYRANK', key, String(KEEP), '-1']
    ]);

    var improved = prev === null ||
      (cfg.better === 'higher' ? score > prev : score < prev);

    res.status(200).json({
      ok: true,
      configured: true,
      improved: improved,
      previous: prev,
      board: await readBoard(g, TOP_N)
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Leaderboard unavailable.' });
  }
};
