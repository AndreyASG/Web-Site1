/* Сайт V2: сценарий «заявка пришла» на макете браузера первого экрана.
   1. На макете сайта «нажимается» кнопка.
   2. Из неё вылетает светящаяся точка и с хлопком превращается в карточку «Новая заявка с сайта».
   3. Появляется «ИИ-помощник готовит ответ» с бегущими точками.
   4. Статус меняется на «Ответ отправлен клиенту».
   5. Карточки уходят, через паузу цикл повторяется.
   Пауза, когда первый экран не виден или вкладка скрыта. При «уменьшить движение» - статичный вид. */
(function () {
  'use strict';

  var visual = document.querySelector('.v2 .hero__visual');
  if (!visual) return;
  var btn = visual.querySelector('.mock-btn');
  var req = visual.querySelector('.float-card--request');
  var ai = visual.querySelector('.float-card--ai');
  var aiText = ai && ai.querySelector('p');
  if (!btn || !req || !ai || !aiText) return;

  var CHECK_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var PULSE_ICON = ai.querySelector('svg') ? ai.querySelector('svg').outerHTML : '';

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !('animate' in Element.prototype)) {
    visual.classList.add('is-static');
    return;
  }

  var timers = [];
  var running = false;
  var inView = true;

  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function clearAll() { timers.forEach(clearTimeout); timers = []; }

  function setAi(state) {
    if (state === 'thinking') {
      ai.classList.remove('is-done');
      ai.innerHTML = PULSE_ICON + '<p>ИИ-помощник готовит ответ <span class="typing"><i></i><i></i><i></i></span></p>';
    } else {
      ai.classList.add('is-done');
      ai.innerHTML = CHECK_ICON + '<p>Ответ отправлен клиенту</p>';
    }
  }

  function reset() {
    [req, ai].forEach(function (el) { el.classList.remove('is-in', 'is-out'); });
    btn.classList.remove('is-pressed');
    setAi('thinking');
  }

  /* Точка вылетает из кнопки макета к карточке заявки по дуге */
  function flyDot(done) {
    var box = visual.getBoundingClientRect();
    var b = btn.getBoundingClientRect();
    var r = req.getBoundingClientRect();
    var x0 = b.left + b.width / 2 - box.left, y0 = b.top + b.height / 2 - box.top;
    var x1 = r.left + 26 - box.left, y1 = r.top + r.height / 2 - box.top;
    var dot = document.createElement('span');
    dot.className = 'fly-dot';
    dot.style.left = x0 + 'px';
    dot.style.top = y0 + 'px';
    visual.appendChild(dot);
    var dx = x1 - x0, dy = y1 - y0;
    var anim = dot.animate([
      { transform: 'translate(0, 0) scale(.6)', opacity: 0 },
      { transform: 'translate(' + dx * 0.15 + 'px, ' + (dy * 0.15 - 40) + 'px) scale(1.1)', opacity: 1, offset: 0.2 },
      { transform: 'translate(' + dx * 0.6 + 'px, ' + (dy * 0.6 - 30) + 'px) scale(1)', opacity: 1, offset: 0.65 },
      { transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(.4)', opacity: 0.2 }
    ], { duration: 650, easing: 'cubic-bezier(.45, 0, .2, 1)', fill: 'forwards' });
    anim.onfinish = function () { dot.remove(); if (done) done(); };
  }

  function cycle() {
    if (!running) return;
    reset();
    later(function () { btn.classList.add('is-pressed'); }, 500);
    later(function () { btn.classList.remove('is-pressed'); flyDot(function () { req.classList.add('is-in'); }); }, 750);
    later(function () { ai.classList.add('is-in'); }, 2300);
    later(function () { setAi('done'); }, 4300);
    later(function () {
      [req, ai].forEach(function (el) { el.classList.remove('is-in'); el.classList.add('is-out'); });
    }, 7600);
    later(cycle, 8800);
  }

  function start() { if (running) return; running = true; cycle(); }
  function stop() {
    running = false;
    clearAll();
    visual.querySelectorAll('.fly-dot').forEach(function (d) { d.remove(); });
    /* в паузе карточки остаются на виду в спокойном состоянии */
    req.classList.remove('is-out'); ai.classList.remove('is-out');
  }
  function update() { if (inView && !document.hidden) start(); else stop(); }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) { inView = entries[0].isIntersecting; update(); }, { threshold: 0.2 }).observe(visual);
  }
  document.addEventListener('visibilitychange', update);

  /* первый запуск - после появления макета на экране (сцена входа из style.css) */
  setTimeout(update, 900);
})();
