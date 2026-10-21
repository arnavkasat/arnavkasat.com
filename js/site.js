/* Shared site chrome: CRT toggle (remembered) and nav highlighting. */

(function () {
  'use strict';

  var body = document.body;
  var btn = document.getElementById('crtBtn');

  function readPref() {
    try { return localStorage.getItem('crt'); } catch (e) { return null; }
  }
  function writePref(v) {
    try { localStorage.setItem('crt', v); } catch (e) { /* private mode: fine */ }
  }

  if (readPref() === 'off') body.classList.add('no-crt');
  function paint() {
    if (btn) btn.textContent = 'CRT: ' + (body.classList.contains('no-crt') ? 'off' : 'on');
  }
  paint();

  if (btn) {
    btn.addEventListener('click', function () {
      body.classList.toggle('no-crt');
      writePref(body.classList.contains('no-crt') ? 'off' : 'on');
      paint();
    });
  }

  // Highlight the section currently on screen.
  var links = [].slice.call(document.querySelectorAll('.topnav a[href^="#"]'));
  if (links.length && 'IntersectionObserver' in window) {
    var byId = {};
    links.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var a = byId[en.target.id];
        if (!a) return;
        if (en.isIntersecting) {
          links.forEach(function (l) { l.classList.remove('on'); });
          a.classList.add('on');
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(byId).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) obs.observe(el);
    });
  }
})();
