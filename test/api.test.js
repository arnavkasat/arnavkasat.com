/* Exercises api/scores.js against an in-memory stand-in for Upstash.
   Run: node test/api.test.js      (no dependencies, no network)   */

'use strict';
process.env.KV_REST_API_URL = 'http://127.0.0.1:7999';
process.env.KV_REST_API_TOKEN = 'test-token';

const path = require('path');
const { server, run } = require('./fake-redis.js');
const SITE = path.join(__dirname, '..');
const handler = require(path.join(SITE, 'api', 'scores.js'));

let pass = 0; const fails = [];
function check(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else fails.push(`${label}: expected ${w}, got ${g}`);
}

function call(method, { query = {}, body = null, ip = '1.2.3.4' } = {}) {
  return new Promise(resolve => {
    const req = { method, query, body, headers: { 'x-forwarded-for': ip } };
    const res = {
      _code: 200, _headers: {},
      setHeader(k, v) { this._headers[k] = v; },
      status(c) { this._code = c; return this; },
      json(payload) { resolve({ status: this._code, body: payload }); }
    };
    handler(req, res);
  });
}

(async () => {
  await new Promise(r => server.listen(7999, r));

  // --- unconfigured ---
  const url = process.env.KV_REST_API_URL;
  delete require.cache[require.resolve(path.join(SITE, 'api', 'scores.js'))];
  process.env.KV_REST_API_URL = '';
  const bare = require(path.join(SITE, 'api', 'scores.js'));
  await new Promise(resolve => {
    const res = { setHeader(){}, status(c){ this._c=c; return this; }, json(b){ check('unconfigured -> 200 and flagged', [this._c, b.configured, b.ok], [200, false, true]); resolve(); } };
    bare({ method: 'GET', query: {}, headers: {} }, res);
  });
  process.env.KV_REST_API_URL = url;

  // --- a good blackjack post ---
  let r = await call('POST', { body: { game: 'blackjack', name: 'Arnav', score: 92.4, detail: { decisions: 120, count: 71 } } });
  check('post blackjack -> 200', r.status, 200);
  check('  improved', r.body.improved, true);
  check('  board has one row', r.body.board.length, 1);
  check('  score stored', r.body.board[0].score, 92.4);
  check('  detail stored', r.body.board[0].detail.decisions, 120);

  // --- a worse score by the same name must not displace the better one ---
  r = await call('POST', { body: { game: 'blackjack', name: 'Arnav', score: 61, detail: { decisions: 80 } } });
  check('worse score -> not improved', r.body.improved, false);
  check('  best survives', r.body.board[0].score, 92.4);
  check('  still one row', r.body.board.length, 1);

  // --- a better one does ---
  r = await call('POST', { body: { game: 'blackjack', name: 'Arnav', score: 97.1, detail: { decisions: 200 } } });
  check('better score -> improved', r.body.improved, true);
  check('  board updated', r.body.board[0].score, 97.1);

  // --- ordering, higher-is-better ---
  await call('POST', { body: { game: 'blackjack', name: 'Riya', score: 99, detail: { decisions: 60 } } });
  await call('POST', { body: { game: 'blackjack', name: 'Sam', score: 55, detail: { decisions: 60 } } });
  r = await call('GET', { query: { game: 'blackjack' } });
  check('descending order', r.body.board.map(x => x.name), ['Riya', 'Arnav', 'Sam']);

  // --- ordering, lower-is-better (odds) ---
  await call('POST', { body: { game: 'odds', name: 'Riya', score: 8.2, detail: { answered: 16, sharp: 2 } } });
  await call('POST', { body: { game: 'odds', name: 'Arnav', score: 2.4, detail: { answered: 32, sharp: 9 } } });
  await call('POST', { body: { game: 'odds', name: 'Sam', score: 19.0, detail: { answered: 16, sharp: 0 } } });
  r = await call('GET', { query: { game: 'odds' } });
  check('ascending order for odds', r.body.board.map(x => x.name), ['Arnav', 'Riya', 'Sam']);
  check('odds declares direction', r.body.better, 'lower');
  r = await call('POST', { body: { game: 'odds', name: 'Arnav', score: 6.0, detail: { answered: 20 } } });
  check('higher error is not an improvement', r.body.improved, false);
  check('  best error survives', r.body.board[0].score, 2.4);

  // --- validation ---
  check('unknown game', (await call('POST', { body: { game: 'poker', name: 'A', score: 1, detail: {} } })).status, 400);
  check('empty name', (await call('POST', { body: { game: 'blackjack', name: '   ', score: 90, detail: { decisions: 60 } } })).status, 400);
  check('slur in name', (await call('POST', { body: { game: 'blackjack', name: 'fuck', score: 90, detail: { decisions: 60 } } })).status, 400);
  check('score over range', (await call('POST', { body: { game: 'blackjack', name: 'A', score: 140, detail: { decisions: 60 } } })).status, 400);
  check('negative score', (await call('POST', { body: { game: 'pickleball', name: 'A', score: -3, detail: { rallies: 5 } } })).status, 400);
  check('under the gate', (await call('POST', { body: { game: 'blackjack', name: 'A', score: 100, detail: { decisions: 3 } } })).status, 400);
  check('odds under the gate', (await call('POST', { body: { game: 'odds', name: 'A', score: 0.1, detail: { answered: 4 } } })).status, 400);
  check('no body', (await call('POST', {})).status, 400);
  check('wrong method', (await call('PUT', {})).status, 405);

  // --- name sanitisation keeps the board printable ---
  r = await call('POST', { body: { game: 'pickleball', name: '  <script>x</script> Bob  ', score: 14, detail: { rallies: 14, level: 'hard', result: '11-7' } } });
  check('markup stripped and truncated to 16', r.body.board[0].name, 'scriptxscript Bo');
  check('detail kept', r.body.board[0].detail.level, 'hard');

  // --- all-boards view ---
  r = await call('GET', { query: { game: 'all' } });
  check('all -> three boards', Object.keys(r.body.boards).sort(), ['blackjack', 'odds', 'pickleball']);
  check('all -> capped at five', r.body.boards.blackjack.length <= 5, true);

  // --- the set is trimmed, not grown without bound ---
  for (let i = 0; i < 70; i++) {
    await call('POST', { body: { game: 'pickleball', name: 'P' + i, score: i + 1, detail: { rallies: i + 1 } }, ip: '9.9.9.' + i });
  }
  check('sorted set trimmed to 50', run(['ZCARD', 'lb:pickleball']) <= 50, true);
  r = await call('GET', { query: { game: 'pickleball' } });
  check('top entry is the best rally', r.body.board[0].score, 70);

  // --- rate limiting ---
  let limited = 0;
  for (let i = 0; i < 25; i++) {
    const rr = await call('POST', { body: { game: 'blackjack', name: 'Spam' + i, score: 70, detail: { decisions: 60 } }, ip: '5.5.5.5' });
    if (rr.status === 429) limited++;
  }
  check('rate limiter kicks in', limited > 0, true);

  server.close();
  if (fails.length) { console.error(`FAIL — ${fails.length} of ${pass + fails.length}`); fails.forEach(f => console.error('  ' + f)); process.exit(1); }
  console.log(`ok — ${pass} API checks passed`);
})();
