/* Exercises api/scores.js end to end against both kinds of Redis it supports:

     - an in-memory stand-in for Upstash's REST API (test/fake-redis.js)
     - a real redis-server over TCP, when one is on the machine

   The same assertions run against both, so the RESP client in api/scores.js
   is held to the same behaviour as the REST path rather than taken on trust.
   Without redis-server installed the TCP suite is skipped and says so.

   Run: node test/api.test.js       (no dependencies, no network)          */

'use strict';

const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { server: fakeRedis } = require('./fake-redis.js');

const SITE = path.join(__dirname, '..');
const handler = require(path.join(SITE, 'api', 'scores.js'));
const { encode, decode, execTcp } = handler.__resp;

const FAKE_PORT = 7999;
const REAL_PORT = 7997;
const REAL_PASS = 'test-password';
const REAL_URL = `redis://default:${REAL_PASS}@127.0.0.1:${REAL_PORT}`;

let pass = 0;
const fails = [];
function check(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else fails.push(`${label}: expected ${w}, got ${g}`);
}

function call(method, { query = {}, body = null, ip = '1.2.3.4' } = {}) {
  return new Promise(resolve => {
    const req = { method, query, body, headers: { 'x-forwarded-for': ip } };
    const res = {
      _code: 200,
      setHeader() {},
      status(c) { this._code = c; return this; },
      json(payload) { resolve({ status: this._code, body: payload }); }
    };
    handler(req, res);
  });
}

function useRest() {
  process.env.KV_REST_API_URL = `http://127.0.0.1:${FAKE_PORT}`;
  process.env.KV_REST_API_TOKEN = 'test-token';
  delete process.env.REDIS_URL;
}
function useTcp() {
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  process.env.REDIS_URL = REAL_URL;
}
function useNothing() {
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.REDIS_URL;
  delete process.env.KV_URL;
}

// ---------------------------------------------------------------- the suite

async function suite(label, zcard) {
  const t = s => `${label}: ${s}`;

  let r = await call('POST', { body: { game: 'blackjack', name: 'Arnav', score: 92.4, detail: { decisions: 120, count: 71 } } });
  check(t('post blackjack -> 200'), r.status, 200);
  check(t('  improved'), r.body.improved, true);
  check(t('  one row'), r.body.board.length, 1);
  check(t('  score stored'), r.body.board[0].score, 92.4);
  check(t('  detail stored'), r.body.board[0].detail.decisions, 120);

  r = await call('POST', { body: { game: 'blackjack', name: 'Arnav', score: 61, detail: { decisions: 80 } } });
  check(t('worse score is not an improvement'), r.body.improved, false);
  check(t('  best survives'), r.body.board[0].score, 92.4);
  check(t('  still one row'), r.body.board.length, 1);

  r = await call('POST', { body: { game: 'blackjack', name: 'Arnav', score: 97.1, detail: { decisions: 200 } } });
  check(t('better score replaces it'), [r.body.improved, r.body.board[0].score], [true, 97.1]);

  await call('POST', { body: { game: 'blackjack', name: 'Riya', score: 99, detail: { decisions: 60 } } });
  await call('POST', { body: { game: 'blackjack', name: 'Sam', score: 55, detail: { decisions: 60 } } });
  r = await call('GET', { query: { game: 'blackjack' } });
  check(t('highest first'), r.body.board.map(x => x.name), ['Riya', 'Arnav', 'Sam']);

  await call('POST', { body: { game: 'odds', name: 'Riya', score: 8.2, detail: { answered: 16, sharp: 2 } } });
  await call('POST', { body: { game: 'odds', name: 'Arnav', score: 2.4, detail: { answered: 32, sharp: 9 } } });
  await call('POST', { body: { game: 'odds', name: 'Sam', score: 19, detail: { answered: 16, sharp: 0 } } });
  r = await call('GET', { query: { game: 'odds' } });
  check(t('lowest error first'), r.body.board.map(x => x.name), ['Arnav', 'Riya', 'Sam']);
  check(t('odds declares its direction'), r.body.better, 'lower');
  r = await call('POST', { body: { game: 'odds', name: 'Arnav', score: 6, detail: { answered: 20 } } });
  check(t('higher error is not an improvement'), [r.body.improved, r.body.board[0].score], [false, 2.4]);

  check(t('unknown game'), (await call('POST', { body: { game: 'poker', name: 'A', score: 1, detail: {} } })).status, 400);
  check(t('empty name'), (await call('POST', { body: { game: 'blackjack', name: '   ', score: 90, detail: { decisions: 60 } } })).status, 400);
  check(t('slur in name'), (await call('POST', { body: { game: 'blackjack', name: 'fuck', score: 90, detail: { decisions: 60 } } })).status, 400);
  check(t('score over range'), (await call('POST', { body: { game: 'blackjack', name: 'A', score: 140, detail: { decisions: 60 } } })).status, 400);
  check(t('negative score'), (await call('POST', { body: { game: 'pickleball', name: 'A', score: -3, detail: { rallies: 5 } } })).status, 400);
  check(t('under the gate'), (await call('POST', { body: { game: 'blackjack', name: 'A', score: 100, detail: { decisions: 3 } } })).status, 400);
  check(t('odds under the gate'), (await call('POST', { body: { game: 'odds', name: 'A', score: 0.1, detail: { answered: 4 } } })).status, 400);
  check(t('no body'), (await call('POST', {})).status, 400);
  check(t('wrong method'), (await call('PUT', {})).status, 405);

  r = await call('POST', { body: { game: 'pickleball', name: '  <script>x</script> Bob  ', score: 14, detail: { rallies: 14, level: 'hard', result: '11-7' } } });
  check(t('markup stripped, truncated to 16'), r.body.board[0].name, 'scriptxscript Bo');
  check(t('detail kept'), r.body.board[0].detail.level, 'hard');

  await call('POST', { body: { game: 'parity', name: 'Arnav', score: 88.5, detail: { rounds: 40, streak: 11 } } });
  check(t('parity posts'), (await call('GET', { query: { game: 'parity' } })).body.board[0].score, 88.5);
  check(t('parity gate'), (await call('POST', { body: { game: 'parity', name: 'A', score: 100, detail: { rounds: 4 } } })).status, 400);

  r = await call('GET', { query: { game: 'all' } });
  check(t('all -> four boards'), Object.keys(r.body.boards).sort(), ['blackjack', 'odds', 'parity', 'pickleball']);
  check(t('all -> five apiece at most'), r.body.boards.blackjack.length <= 5, true);

  for (let i = 0; i < 70; i++) {
    await call('POST', { body: { game: 'pickleball', name: 'P' + i, score: i + 1, detail: { rallies: i + 1 } }, ip: '9.9.9.' + i });
  }
  check(t('sorted set trimmed to 50'), (await zcard('lb:pickleball')) <= 50, true);
  r = await call('GET', { query: { game: 'pickleball' } });
  check(t('best rally on top'), r.body.board[0].score, 70);

  let limited = 0;
  for (let i = 0; i < 25; i++) {
    const rr = await call('POST', { body: { game: 'blackjack', name: 'Spam' + i, score: 70, detail: { decisions: 60 } }, ip: '5.5.5.5' });
    if (rr.status === 429) limited++;
  }
  check(t('rate limiter kicks in'), limited > 0, true);
}

// ------------------------------------------------------- RESP wire protocol

function respUnits() {
  check('encode a command', encode(['GET', 'x']), '*2\r\n$3\r\nGET\r\n$1\r\nx\r\n');
  check('encode coerces numbers', encode(['EXPIRE', 'k', 60]), '*3\r\n$6\r\nEXPIRE\r\n$1\r\nk\r\n$2\r\n60\r\n');
  check('encode counts bytes, not characters', encode(['SET', 'café']).length, '*2\r\n$3\r\nSET\r\n$5\r\ncafé\r\n'.length);

  const d = (s, i = 0) => decode(Buffer.from(s, 'utf8'), i);
  check('simple string', d('+OK\r\n')[0], 'OK');
  check('integer', d(':42\r\n')[0], 42);
  check('bulk string', d('$5\r\nhello\r\n')[0], 'hello');
  check('nil bulk string', d('$-1\r\n')[0], null);
  check('empty bulk string', d('$0\r\n\r\n')[0], '');
  check('array', d('*2\r\n$1\r\na\r\n:7\r\n')[0], ['a', 7]);
  check('empty array', d('*0\r\n')[0], []);
  check('nil array', d('*-1\r\n')[0], null);
  check('nested array', d('*2\r\n*1\r\n$1\r\na\r\n:1\r\n')[0], [['a'], 1]);
  check('error becomes an Error', d('-WRONGTYPE nope\r\n')[0] instanceof Error, true);
  check('error carries its message', d('-WRONGTYPE nope\r\n')[0].message, 'WRONGTYPE nope');
  check('partial header -> null', d('$5\r\nhel'), null);
  check('partial array -> null', d('*2\r\n$1\r\na\r\n'), null);
  check('truncated line -> null', d('+OK'), null);
  check('offset is returned', d('+OK\r\n')[1], 5);
  check('decodes the second reply at the offset', d('+A\r\n+B\r\n', 4)[0], 'B');
  check('multibyte bulk string', d('$5\r\ncafé\r\n')[0], 'café');
}

// ----------------------------------------------------------------- run them

(async () => {
  respUnits();

  // --- unconfigured ---
  useNothing();
  const bare = await call('GET', { query: { game: 'all' } });
  check('no store -> 200 and flagged', [bare.status, bare.body.configured, bare.body.ok], [200, false, true]);

  // --- REST, against the in-memory stand-in ---
  await new Promise(r => fakeRedis.listen(FAKE_PORT, r));
  useRest();
  await suite('rest', async key => {
    const r = await fetch(`http://127.0.0.1:${FAKE_PORT}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(['ZCARD', key])
    }).then(x => x.json());
    return r.result;
  });
  fakeRedis.close();

  // --- TCP, against a real redis-server if this machine has one ---
  const haveRedis = spawnSync('redis-server', ['--version'], { stdio: 'ignore' }).status === 0;
  if (!haveRedis) {
    console.log('note — redis-server not installed, TCP suite skipped');
  } else {
    const proc = spawn('redis-server', [
      '--port', String(REAL_PORT), '--requirepass', REAL_PASS,
      '--save', '', '--appendonly', 'no'
    ], { stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    useTcp();

    // the client's own behaviour, before the handler leans on it
    const pong = await execTcp(REAL_URL, [['PING']]);
    check('tcp: authenticates and pings', pong, ['PONG']);
    const multi = await execTcp(REAL_URL, [['SET', 'k', 'v'], ['GET', 'k'], ['DEL', 'k'], ['GET', 'k']]);
    check('tcp: pipelines, and a missing key is null', multi, ['OK', 'v', 1, null]);
    const big = 'x'.repeat(100000);
    const [, back] = await execTcp(REAL_URL, [['SET', 'big', big], ['GET', 'big']]);
    check('tcp: reassembles a reply split across packets', back.length, big.length);
    let authErr = null;
    await execTcp(`redis://default:wrong@127.0.0.1:${REAL_PORT}`, [['PING']]).catch(e => { authErr = e; });
    check('tcp: a bad password rejects', authErr instanceof Error, true);
    let typeErr = null;
    await execTcp(REAL_URL, [['LPUSH', 'alist', '1'], ['INCR', 'alist']]).catch(e => { typeErr = e; });
    check('tcp: a redis error rejects', typeErr instanceof Error, true);
    await execTcp(REAL_URL, [['FLUSHALL']]);

    await suite('tcp ', async key => (await execTcp(REAL_URL, [['ZCARD', key]]))[0]);
    proc.kill();
  }

  if (fails.length) {
    console.error(`FAIL — ${fails.length} of ${pass + fails.length}\n`);
    fails.forEach(f => console.error('  ' + f));
    process.exit(1);
  }
  console.log(`ok — ${pass} API checks passed${haveRedis ? ' (REST and TCP)' : ' (REST only)'}`);
})();
