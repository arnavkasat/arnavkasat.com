/* ===========================================================
   /api/scores — the shared leaderboard.

   Storage is a Redis sorted set per game. Two kinds of Redis
   get handed out by the Vercel Marketplace and this speaks
   both, picking whichever the project is connected to:

     - Upstash, which exposes an HTTP REST endpoint
       (KV_REST_API_* or UPSTASH_REDIS_REST_*)
     - Redis Cloud and friends, which expose an ordinary TCP
       endpoint (REDIS_URL / redis://user:pass@host:port)

   The TCP client is forty lines of RESP at the bottom of this
   file rather than a dependency, so the project still installs
   nothing and builds nothing.

   With neither configured the endpoint reports itself
   unconfigured and the site falls back to a local-only
   personal best.

     GET  /api/scores?game=blackjack      top ten
     GET  /api/scores?game=all            top five of each
     POST /api/scores  {game, name, score, detail}

   One entry per name per game: a better result replaces that
   name's previous one rather than adding a row. Scores are
   reported by the browser, so treat the board as a scoreboard
   among friends, not as evidence.
   =========================================================== */

'use strict';

var net = require('net');
var tls = require('tls');
var url = require('url');

function restCreds() {
  var u = process.env.KV_REST_API_URL ||
          process.env.UPSTASH_REDIS_REST_URL ||
          process.env.REDIS_REST_URL;
  var t = process.env.KV_REST_API_TOKEN ||
          process.env.UPSTASH_REDIS_REST_TOKEN ||
          process.env.REDIS_REST_TOKEN;
  return u && t ? { url: u, token: t } : null;
}

function tcpUrl() {
  return process.env.REDIS_URL ||
         process.env.REDIS_URI ||
         process.env.KV_URL ||
         null;
}

function configured() {
  return !!(restCreds() || tcpUrl());
}

// Per game: which direction wins, the plausible range of a real result,
// and the minimum effort before a score may be posted at all.
var GAMES = {
  blackjack:  { better: 'higher', min: 0, max: 100, gate: 'decisions', gateMin: 50 },
  odds:       { better: 'lower',  min: 0, max: 100, gate: 'answered',  gateMin: 16 },
  parity:     { better: 'higher', min: 0, max: 100, gate: 'rounds',    gateMin: 20 },
  pickleball: { better: 'higher', min: 1, max: 500, gate: 'rallies',   gateMin: 1 }
};

var TOP_N = 10;
var KEEP = 50;              // trim the sorted set to this many entries
var RATE_PER_MIN = 20;

// Run a list of commands and return their results in order. Both backends
// answer the same shape so nothing above here has to know which is in use.
function exec(commands) {
  var rest = restCreds();
  return rest ? execRest(rest, commands) : execTcp(tcpUrl(), commands);
}

function execRest(rest, commands) {
  var single = commands.length === 1;
  return fetch(rest.url + (single ? '' : '/pipeline'), {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + rest.token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(single ? commands[0] : commands)
  }).then(function (r) {
    if (!r.ok) throw new Error('redis rest ' + r.status);
    return r.json();
  }).then(function (body) {
    var list = single ? [body] : body;
    return list.map(function (entry) {
      if (entry && entry.error) throw new Error(entry.error);
      return entry.result;
    });
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
  return exec([range, ['HGETALL', 'lb:' + game + ':meta']]).then(function (res) {
    return rows(res[0] || [], metaMap(res[1] || []));
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  // No store connected is a known state the site handles, not a failure, so
  // it answers 200 rather than printing a red error in everyone's console.
  if (!configured()) {
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
    var rl = await exec([['INCR', 'rl:' + ip], ['EXPIRE', 'rl:' + ip, '60']]);
    if (Number(rl[0]) > RATE_PER_MIN) {
      res.status(429).json({ ok: false, error: 'Easy — too many submissions. Try again in a minute.' });
      return;
    }

    detail.at = new Date().toISOString().slice(0, 10);
    var key = 'lb:' + g;
    // GT / LT keep a name's best result rather than its most recent one.
    var keep = cfg.better === 'higher' ? 'GT' : 'LT';
    var before = await exec([['ZSCORE', key, name]]);
    var prev = before[0] === null || before[0] === undefined ? null : Number(before[0]);

    await exec([
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

/* ===========================================================
   A small RESP client.

   Redis speaks a simple, self-describing protocol: '+' simple
   string, '-' error, ':' integer, '$' bulk string, '*' array,
   each terminated by CRLF. That is the whole grammar, which is
   why this is forty lines instead of a dependency.

   One connection per invocation: authenticate, send every
   command at once, read the same number of replies back, close.
   For a leaderboard on a personal site that is cheaper than
   anything clever, and a serverless function cannot hold a
   pool between invocations anyway.
   =========================================================== */

var TCP_TIMEOUT = 5000;

function encode(args) {
  var out = '*' + args.length + '\r\n';
  for (var i = 0; i < args.length; i++) {
    var v = String(args[i]);
    out += '$' + Buffer.byteLength(v) + '\r\n' + v + '\r\n';
  }
  return out;
}

// Returns [value, nextOffset], or null when the buffer holds a partial reply.
function decode(buf, i) {
  if (i >= buf.length) return null;
  var type = buf[i];
  var end = buf.indexOf('\r\n', i, 'utf8');
  if (end === -1) return null;
  var line = buf.toString('utf8', i + 1, end);
  var next = end + 2;

  if (type === 43) return [line, next];                 // '+'
  if (type === 45) return [new Error(line), next];      // '-'
  if (type === 58) return [Number(line), next];         // ':'

  if (type === 36) {                                    // '$'
    var len = Number(line);
    if (len === -1) return [null, next];
    if (buf.length < next + len + 2) return null;
    return [buf.toString('utf8', next, next + len), next + len + 2];
  }

  if (type === 42) {                                    // '*'
    var n = Number(line);
    if (n === -1) return [null, next];
    var arr = [], at = next;
    for (var k = 0; k < n; k++) {
      var item = decode(buf, at);
      if (!item) return null;
      arr.push(item[0]);
      at = item[1];
    }
    return [arr, at];
  }
  return null;
}

function execTcp(urlString, commands) {
  return new Promise(function (resolve, reject) {
    var parsed;
    try { parsed = new url.URL(urlString); } catch (e) { reject(new Error('bad REDIS_URL')); return; }

    var secure = parsed.protocol === 'rediss:';
    var user = decodeURIComponent(parsed.username || '');
    var pass = decodeURIComponent(parsed.password || '');
    var opts = {
      host: parsed.hostname,
      port: Number(parsed.port || 6379)
    };
    if (secure) opts.servername = parsed.hostname;

    var wire = [];
    // AUTH first when the server wants it; its reply is read and discarded.
    if (pass) wire.push(user ? ['AUTH', user, pass] : ['AUTH', pass]);
    var skip = wire.length;
    wire = wire.concat(commands);

    var socket = secure ? tls.connect(opts) : net.connect(opts);
    var chunks = [];
    var done = false;

    function finish(err, value) {
      if (done) return;
      done = true;
      socket.destroy();
      err ? reject(err) : resolve(value);
    }

    socket.setTimeout(TCP_TIMEOUT, function () { finish(new Error('redis timeout')); });
    socket.on('error', function (e) { finish(e); });
    socket.on('close', function () { finish(new Error('redis closed early')); });

    socket.on(secure ? 'secureConnect' : 'connect', function () {
      socket.write(wire.map(encode).join(''));
    });

    socket.on('data', function (chunk) {
      chunks.push(chunk);
      var buf = Buffer.concat(chunks);
      var out = [], at = 0;
      for (var i = 0; i < wire.length; i++) {
        var r = decode(buf, at);
        if (!r) return;                 // wait for the rest of the stream
        out.push(r[0]);
        at = r[1];
      }
      var replies = out.slice(skip);
      for (var j = 0; j < replies.length; j++) {
        if (replies[j] instanceof Error) { finish(replies[j]); return; }
      }
      if (out[0] instanceof Error) { finish(out[0]); return; }   // AUTH failed
      finish(null, replies);
    });
  });
}

// Exposed for the tests; not part of the request path.
module.exports.__resp = { encode: encode, decode: decode, execTcp: execTcp };
