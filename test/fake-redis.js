/* A small in-memory stand-in for the Upstash REST API: only the commands
   api/scores.js actually issues, with real Redis semantics for the ones
   that matter (ZADD GT/LT, ZRANGE REV, ZREMRANGEBYRANK ranks). */
'use strict';
const http = require('http');

const z = new Map();   // key -> Map(member -> score)
const h = new Map();   // key -> Map(field -> value)
const k = new Map();   // plain counters

const zset = key => { if (!z.has(key)) z.set(key, new Map()); return z.get(key); };
const hash = key => { if (!h.has(key)) h.set(key, new Map()); return h.get(key); };

function sorted(key) {
  return [...zset(key).entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
}
function slice(arr, start, stop) {
  const n = arr.length;
  let s = start < 0 ? n + start : start;
  let e = stop < 0 ? n + stop : stop;
  s = Math.max(0, s); e = Math.min(n - 1, e);
  return s > e ? [] : arr.slice(s, e + 1);
}

function run(cmd) {
  const op = String(cmd[0]).toUpperCase();
  const args = cmd.slice(1);
  switch (op) {
    case 'ZADD': {
      const key = args[0];
      let i = 1, mode = null, ch = false;
      while (['GT', 'LT', 'CH', 'NX', 'XX'].includes(String(args[i]).toUpperCase())) {
        const f = String(args[i]).toUpperCase();
        if (f === 'GT' || f === 'LT') mode = f; else if (f === 'CH') ch = true;
        i++;
      }
      const score = Number(args[i]), member = String(args[i + 1]);
      const m = zset(key);
      const cur = m.has(member) ? m.get(member) : null;
      let write = cur === null ||
        (mode === 'GT' ? score > cur : mode === 'LT' ? score < cur : true);
      if (write) m.set(member, score);
      return write && cur !== score ? 1 : 0;
    }
    case 'ZSCORE': {
      const m = zset(args[0]);
      return m.has(String(args[1])) ? String(m.get(String(args[1]))) : null;
    }
    case 'ZRANGE': {
      const key = args[0];
      const start = Number(args[1]), stop = Number(args[2]);
      const flags = args.slice(3).map(x => String(x).toUpperCase());
      let arr = sorted(key);
      if (flags.includes('REV')) arr = arr.reverse();
      const page = slice(arr, start, stop);
      return flags.includes('WITHSCORES')
        ? page.flatMap(([mem, sc]) => [mem, String(sc)])
        : page.map(([mem]) => mem);
    }
    case 'ZREMRANGEBYRANK': {
      const key = args[0];
      const arr = sorted(key);
      const doomed = slice(arr, Number(args[1]), Number(args[2]));
      doomed.forEach(([mem]) => zset(key).delete(mem));
      return doomed.length;
    }
    case 'ZCARD': return zset(args[0]).size;
    case 'HSET': { hash(args[0]).set(String(args[1]), String(args[2])); return 1; }
    case 'HGETALL': return [...hash(args[0]).entries()].flat();
    case 'INCR': { const v = (k.get(args[0]) || 0) + 1; k.set(args[0], v); return v; }
    case 'EXPIRE': return 1;
    case 'FLUSHALL': { z.clear(); h.clear(); k.clear(); return 'OK'; }
    default: throw new Error('fake redis: unsupported ' + op);
  }
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    if (req.headers.authorization !== 'Bearer test-token') {
      res.writeHead(401).end('{"error":"bad token"}');
      return;
    }
    let payload;
    try { payload = JSON.parse(body); } catch (e) { res.writeHead(400).end('{}'); return; }
    try {
      const out = req.url.startsWith('/pipeline')
        ? payload.map(c => ({ result: run(c) }))
        : { result: run(payload) };
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(500).end(JSON.stringify({ error: e.message }));
    }
  });
});
module.exports = { server, run };
if (require.main === module) server.listen(7999, () => console.log('fake redis on 7999'));
