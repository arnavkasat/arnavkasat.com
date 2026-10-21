/* ===========================================================
   Shared leaderboard client.

   A game calls LB.attach() with a read() closure over its own
   state; this module polls it, decides when a score is worth
   offering, and talks to /api/scores.

   If the endpoint reports itself unconfigured, the panel falls
   back to a personal best kept in this browser, so the page is
   never broken by missing infrastructure — it is just quieter.
   =========================================================== */

(function (root) {
  'use strict';

  var FORMAT = {
    blackjack: {
      title: 'Basic strategy accuracy',
      unit: function (v) { return v.toFixed(1) + '%'; },
      sub: function (d) {
        return (d.decisions || 0) + ' decisions' +
          (d.count != null ? ' · count ' + d.count + '%' : '');
      }
    },
    odds: {
      title: 'Lowest mean error',
      unit: function (v) { return v.toFixed(2) + ' pp'; },
      sub: function (d) {
        return (d.answered || 0) + ' answered' +
          (d.sharp != null ? ' · ' + d.sharp + ' within a point' : '');
      }
    },
    pickleball: {
      title: 'Longest rally',
      unit: function (v) { return Math.round(v) + (Math.round(v) === 1 ? ' shot' : ' shots'); },
      sub: function (d) {
        return (d.level || 'normal') + (d.result ? ' · ' + d.result : '');
      }
    }
  };

  var sources = {};
  var panels = [];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function remembered() {
    try { return localStorage.getItem('lb-name') || ''; } catch (e) { return ''; }
  }
  function remember(v) {
    try { localStorage.setItem('lb-name', v); } catch (e) { /* private mode */ }
  }
  function localBest(game) {
    try {
      var v = localStorage.getItem('lb-best-' + game);
      return v === null ? null : Number(v);
    } catch (e) { return null; }
  }
  function setLocalBest(game, score, better) {
    var cur = localBest(game);
    if (cur === null || (better === 'higher' ? score > cur : score < cur)) {
      try { localStorage.setItem('lb-best-' + game, String(score)); } catch (e) { /* ignore */ }
      return true;
    }
    return false;
  }

  function renderBoard(node, game, board, better) {
    node.innerHTML = '';
    if (!board || !board.length) {
      node.appendChild(el('p', 'dim', 'Nobody on the board yet. Be first.'));
      return;
    }
    var fmt = FORMAT[game];
    var ol = el('ol', 'lb-list');
    board.forEach(function (row, i) {
      var li = el('li');
      if (i === 0) li.className = 'lead';
      li.appendChild(el('span', 'lb-rank', '#' + (i + 1)));
      li.appendChild(el('span', 'lb-name', row.name));
      var score = el('span', 'lb-score', fmt.unit(row.score));
      li.appendChild(score);
      var sub = fmt.sub(row.detail || {});
      if (sub) li.appendChild(el('span', 'lb-sub', sub));
      ol.appendChild(li);
    });
    node.appendChild(ol);
  }

  function mountPanel(host) {
    var game = host.dataset.game;
    var fmt = FORMAT[game];
    if (!fmt) return;

    host.innerHTML = '';
    host.appendChild(el('h3', null, 'Leaderboard — ' + fmt.title));

    var boardNode = el('div', 'lb-board');
    boardNode.appendChild(el('p', 'dim', 'Loading…'));
    host.appendChild(boardNode);

    var yours = el('p', 'mono lb-yours');
    host.appendChild(yours);

    var form = el('div', 'lb-form');
    var input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 16;
    input.placeholder = 'Your name';
    input.value = remembered();
    input.setAttribute('aria-label', 'Your name for the leaderboard');
    var btn = el('button', 'btn cyan sm', 'Post score');
    btn.type = 'button';
    btn.disabled = true;
    form.appendChild(input);
    form.appendChild(btn);
    host.appendChild(form);

    var note = el('p', 'mono lb-note');
    host.appendChild(note);

    var panel = {
      game: game, host: host, boardNode: boardNode, yours: yours,
      input: input, btn: btn, note: note, better: 'higher', configured: null
    };
    panels.push(panel);

    btn.addEventListener('click', function () { submit(panel); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !btn.disabled) submit(panel);
    });

    load(panel);
    return panel;
  }

  function load(panel) {
    fetch('/api/scores?game=' + encodeURIComponent(panel.game))
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        if (res.body && res.body.configured === false) {
          panel.configured = false;
          offline(panel);
          return;
        }
        panel.configured = true;
        panel.better = res.body.better || 'higher';
        renderBoard(panel.boardNode, panel.game, res.body.board, panel.better);
      })
      .catch(function () {
        panel.configured = false;
        offline(panel);
      });
  }

  function offline(panel) {
    panel.boardNode.innerHTML = '';
    panel.boardNode.appendChild(el('p', 'dim',
      'The shared board is off right now, so scores are kept to this browser.'));
    panel.form && (panel.form.style.display = 'none');
    panel.input.style.display = 'none';
    panel.btn.style.display = 'none';
  }

  function submit(panel) {
    var src = sources[panel.game];
    if (!src) return;
    var state = src.read();
    var name = panel.input.value.trim();
    if (!name) { panel.note.textContent = 'Enter a name first.'; panel.note.className = 'mono lb-note bad'; return; }
    remember(name);

    panel.btn.disabled = true;
    panel.note.textContent = 'Posting…';
    panel.note.className = 'mono lb-note';

    fetch('/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        game: panel.game, name: name, score: state.score, detail: state.detail
      })
    })
      .then(function (r) { return r.json(); })
      .then(function (body) {
        if (!body.ok) {
          panel.note.textContent = body.error || 'Could not post that.';
          panel.note.className = 'mono lb-note bad';
          panel.btn.disabled = false;
          return;
        }
        renderBoard(panel.boardNode, panel.game, body.board, panel.better);
        panel.note.textContent = body.improved
          ? 'Posted — that is your best yet.'
          : 'Posted. Your best on the board still stands.';
        panel.note.className = 'mono lb-note ok';
      })
      .catch(function () {
        panel.note.textContent = 'Could not reach the leaderboard.';
        panel.note.className = 'mono lb-note bad';
        panel.btn.disabled = false;
      });
  }

  // Poll each game for its current standing so the button knows when there
  // is something worth posting.
  function tick() {
    panels.forEach(function (panel) {
      var src = sources[panel.game];
      if (!src) return;
      var state = src.read();
      var fmt = FORMAT[panel.game];

      if (state.eligible) {
        panel.yours.textContent = 'Yours right now: ' + fmt.unit(state.score) +
          ' · ' + fmt.sub(state.detail || {});
        if (panel.configured !== false) panel.btn.disabled = false;
        setLocalBest(panel.game, state.score, panel.better);
      } else {
        panel.yours.textContent = state.need || '';
        panel.btn.disabled = true;
      }
    });
  }

  function attach(src) {
    sources[src.game] = src;
  }

  function hallOfFame(host) {
    fetch('/api/scores?game=all')
      .then(function (r) { return r.json(); })
      .then(function (body) {
        if (!body.ok || body.configured === false || !body.boards ||
            !Object.keys(body.boards).length) throw new Error('unconfigured');
        host.innerHTML = '';
        Object.keys(body.boards).forEach(function (game) {
          var fmt = FORMAT[game];
          if (!fmt) return;
          var card = el('div', 'panel');
          card.appendChild(el('h3', null, { blackjack: '♠ Blackjack', odds: '♥ Odds Oracle', pickleball: '♣ Pickleball' }[game]));
          card.appendChild(el('p', 'mono faint', fmt.title));
          var inner = el('div');
          renderBoard(inner, game, body.boards[game], game === 'odds' ? 'lower' : 'higher');
          card.appendChild(inner);
          host.appendChild(card);
        });
      })
      .catch(function () {
        host.innerHTML = '';
        var p = el('p', 'dim', 'The shared board is off right now. Scores still work, they just stay in your browser.');
        host.appendChild(p);
      });
  }

  function boot() {
    [].forEach.call(document.querySelectorAll('[data-leaderboard]'), mountPanel);
    var hof = document.getElementById('hallOfFame');
    if (hof) hallOfFame(hof);
    if (panels.length) setInterval(tick, 900);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  root.LB = { attach: attach };
})(typeof self !== 'undefined' ? self : this);
