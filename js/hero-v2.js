/* Сайт V2: сценарий «заявка пришла» на ноутбуке первого экрана.
   1. Курсор посетителя подъезжает к кнопке «Оставить заявку» и нажимает её.
   2. На экране выезжает уведомление «Новая заявка».
   3. Рядом появляется ИИ-помощник и печатает ответ клиенту.
   4. Статус меняется на «Отправлено», всё уходит, цикл повторяется.
   Пауза, когда первый экран не виден или вкладка скрыта. При «уменьшить движение» - статичный вид.
   Тайминги - в функции cycle(). */
(function () {
  'use strict';

  var visual = document.querySelector('.v2 .hero__visual--laptop');
  if (!visual) return;
  var screen = visual.querySelector('.laptop__screen');
  var btn = visual.querySelector('.lsite__btn');
  var cursor = visual.querySelector('.lcursor');
  var pad = visual.querySelector('.laptop__pad');
  var toast = visual.querySelector('.ltoast');
  var reply = visual.querySelector('.aireply');
  var status = reply && reply.querySelector('.aireply__status');
  var textEl = reply && reply.querySelector('.aireply__text');
  if (!screen || !btn || !cursor || !toast || !reply || !status || !textEl) return;

  /* Текст ответа: невидимая копия держит высоту карточки, поверх печатается живой текст */
  var FULL = textEl.textContent.trim();
  textEl.textContent = '';
  var ghost = document.createElement('span');
  ghost.className = 'aireply__ghost';
  ghost.textContent = FULL;
  var live = document.createElement('span');
  live.className = 'aireply__live';
  textEl.appendChild(ghost);
  textEl.appendChild(live);

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    live.textContent = FULL;
    reply.classList.add('is-done');
    status.textContent = 'Отправлено';
    visual.classList.add('is-static');
    return;
  }

  var timers = [];
  var running = false;
  var inView = true;

  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function clearAll() { timers.forEach(clearTimeout); timers = []; }

  /* Позиция курсора внутри экрана, в пикселях */
  function moveCursor(x, y) {
    cursor.style.setProperty('--cx', x + 'px');
    cursor.style.setProperty('--cy', y + 'px');
  }
  function cursorStart() {
    var s = screen.getBoundingClientRect();
    moveCursor(s.width * 0.82, s.height * 0.86);
  }
  function cursorToButton() {
    var s = screen.getBoundingClientRect();
    var b = btn.getBoundingClientRect();
    moveCursor(b.left - s.left + b.width * 0.55, b.top - s.top + b.height * 0.45);
  }

  function typeText(i) {
    if (!running) return;
    live.textContent = FULL.slice(0, i);
    if (i < FULL.length) {
      var ch = FULL.charAt(i - 1);
      later(function () { typeText(i + 1); }, /[.,!?]/.test(ch) ? 160 : 28);
    }
  }

  function reset() {
    toast.classList.remove('is-in', 'is-out');
    reply.classList.remove('is-in', 'is-out', 'is-done');
    btn.classList.remove('is-pressed');
    cursor.classList.remove('is-on', 'is-click');
    status.textContent = 'пишет ответ';
    live.textContent = '';
    cursorStart();
  }

  function cycle() {
    if (!running) return;
    reset();
    later(function () { cursor.classList.add('is-on'); }, 300);
    later(cursorToButton, 450);
    later(function () { cursor.classList.add('is-click'); btn.classList.add('is-pressed'); if (pad) pad.classList.add('is-click'); }, 1500);
    later(function () { cursor.classList.remove('is-click'); btn.classList.remove('is-pressed'); if (pad) pad.classList.remove('is-click'); }, 1720);
    later(function () { toast.classList.add('is-in'); }, 1900);
    later(function () { cursor.classList.remove('is-on'); }, 2900);
    later(function () { reply.classList.add('is-in'); }, 3100);
    later(function () { typeText(1); }, 3500);
    later(function () { reply.classList.add('is-done'); status.textContent = 'Отправлено'; live.textContent = FULL; }, 7000);
    later(function () {
      toast.classList.remove('is-in'); toast.classList.add('is-out');
      reply.classList.remove('is-in'); reply.classList.add('is-out');
    }, 10200);
    later(cycle, 11400);
  }

  function start() { if (running) return; running = true; cycle(); }
  function stop() { running = false; clearAll(); }
  function update() { if (inView && !document.hidden) start(); else stop(); }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) { inView = entries[0].isIntersecting; update(); }, { threshold: 0.2 }).observe(visual);
  }
  document.addEventListener('visibilitychange', update);

  /* первый запуск - после появления ноутбука на экране (сцена входа из style.css) */
  setTimeout(update, 900);
})();
