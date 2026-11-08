/* Сайт V2: сценарий «заявка пришла» на утверждённом изображении ноутбука.
   1. Курсор посетителя подъезжает к кнопке «Оставить заявку» на экране и нажимает её.
   2. Карточка над ноутбуком: «Ждём новую заявку» → вспышка → «Новая заявка, Ирина, ремонт ванной».
   3. Карточка ИИ-помощника: «ждёт заявку» → «пишет ответ», текст печатается по буквам → «Отправлено».
   4. Карточки возвращаются в режим ожидания, цикл повторяется.
   Пауза, когда первый экран не виден или вкладка скрыта. При «уменьшить движение» - статичный вид.
   Тайминги - в функции cycle(). Прежний сценарий для нарисованного CSS-ноутбука - js/hero-v2.js. */
(function () {
  'use strict';

  var visual = document.querySelector('.v2 .hero__visual--photo');
  if (!visual) return;
  var photo = visual.querySelector('.photo');
  var press = visual.querySelector('.photo__press');
  var cursor = visual.querySelector('.lcursor');
  var req = visual.querySelector('.pcard--req');
  var ai = visual.querySelector('.pcard--ai');
  var status = ai && ai.querySelector('.pcard__status');
  var textEl = ai && ai.querySelector('.pcard__reply');
  if (!photo || !press || !cursor || !req || !ai || !status || !textEl) return;

  var BUTTON = { x: 0.351, y: 0.425 };   /* центр кнопки на изображении, доли ширины и высоты */
  var START = { x: 0.62, y: 0.47 };

  /* Невидимая копия держит высоту карточки, поверх печатается живой текст */
  var FULL = textEl.textContent.trim();
  textEl.textContent = '';
  var ghost = document.createElement('span');
  ghost.className = 'pcard__ghost';
  ghost.textContent = FULL;
  var live = document.createElement('span');
  live.className = 'pcard__live';
  textEl.appendChild(ghost);
  textEl.appendChild(live);

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    req.classList.add('is-new');
    ai.classList.add('is-done');
    status.textContent = 'Отправлено';
    live.textContent = FULL;
    visual.classList.add('is-static');
    return;
  }

  var timers = [];
  var running = false;
  var inView = true;

  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function clearAll() { timers.forEach(clearTimeout); timers = []; }

  function moveCursor(p) {
    cursor.style.setProperty('--cx', (photo.clientWidth * p.x) + 'px');
    cursor.style.setProperty('--cy', (photo.clientHeight * p.y) + 'px');
  }

  function typeText(i) {
    if (!running) return;
    live.textContent = FULL.slice(0, i);
    if (i < FULL.length) {
      later(function () { typeText(i + 1); }, /[.,!?]/.test(FULL.charAt(i - 1)) ? 160 : 28);
    }
  }

  function idle() {
    req.classList.remove('is-new');
    ai.classList.remove('is-active', 'is-done');
    status.textContent = 'ждёт заявку';
    live.textContent = '';
  }

  function cycle() {
    if (!running) return;
    idle();
    press.classList.remove('is-pressed');
    cursor.classList.remove('is-on', 'is-click');
    moveCursor(START);
    later(function () { cursor.classList.add('is-on'); }, 300);
    later(function () { moveCursor(BUTTON); }, 450);
    later(function () { cursor.classList.add('is-click'); press.classList.add('is-pressed'); }, 1500);
    later(function () { cursor.classList.remove('is-click'); press.classList.remove('is-pressed'); }, 1750);
    later(function () { req.classList.add('is-new'); }, 1900);
    later(function () { cursor.classList.remove('is-on'); }, 2900);
    later(function () { ai.classList.add('is-active'); status.textContent = 'пишет ответ'; }, 3100);
    later(function () { typeText(1); }, 3500);
    later(function () {
      ai.classList.remove('is-active'); ai.classList.add('is-done');
      status.textContent = 'Отправлено'; live.textContent = FULL;
    }, 7000);
    later(idle, 10400);
    later(cycle, 11600);
  }

  function start() { if (running) return; running = true; cycle(); }
  function stop() { running = false; clearAll(); }
  function update() { if (inView && !document.hidden) start(); else stop(); }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) { inView = entries[0].isIntersecting; update(); }, { threshold: 0.2 }).observe(visual);
  }
  document.addEventListener('visibilitychange', update);

  setTimeout(update, 900);
})();
