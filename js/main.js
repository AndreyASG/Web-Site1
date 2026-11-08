/* ASG CODE - сайт V1. Без библиотек. */
(function () {
  'use strict';

  /* Адрес приёма заявок. Пока пусто - форма работает в демо-режиме и никуда не отправляет данные.
     Чтобы подключить отправку, укажите адрес обработчика (например, вебхук бота или CRM). */
  var FORM_ENDPOINT = '';

  document.documentElement.classList.add('js');

  /* Шапка: тонкая линия после начала прокрутки */
  var header = document.querySelector('.header');
  var onScroll = function () { header.classList.toggle('is-scrolled', window.scrollY > 8); };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* Мобильное меню */
  var burger = document.querySelector('.burger');
  var nav = document.getElementById('nav');
  var setMenu = function (open) {
    nav.classList.toggle('is-open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  };
  burger.addEventListener('click', function () { setMenu(!nav.classList.contains('is-open')); });
  nav.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && nav.classList.contains('is-open')) { setMenu(false); burger.focus(); } });
  window.addEventListener('resize', function () { if (window.innerWidth > 1024) setMenu(false); });

  /* Кнопки услуг: выбрать услугу в форме */
  var serviceSelect = document.getElementById('f-service');
  document.querySelectorAll('[data-service]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (serviceSelect) serviceSelect.value = btn.getAttribute('data-service');
    });
  });

  /* Плавное проявление блоков (один раз) */
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add('is-visible'); io.unobserve(entry.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('is-visible'); });
  }

  /* Форма заявки */
  var form = document.getElementById('request-form');
  var status = document.getElementById('form-status');
  var fields = {
    name: { el: document.getElementById('f-name'), err: document.getElementById('f-name-err'),
      check: function (v) { return v.trim().length >= 2 ? '' : 'Введите имя - хотя бы две буквы'; } },
    contact: { el: document.getElementById('f-contact'), err: document.getElementById('f-contact-err'),
      check: function (v) {
        v = v.trim();
        var digits = v.replace(/\D/g, '');
        if (/^@?[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(v) || digits.length >= 10) return '';
        return 'Укажите телефон (10-11 цифр) или Telegram в формате @username';
      } },
    agree: { el: document.getElementById('f-agree'), err: document.getElementById('f-agree-err'),
      check: function (_, el) { return el.checked ? '' : 'Нужно согласие на обработку данных, чтобы мы могли ответить'; } }
  };

  var validate = function (key) {
    var f = fields[key];
    var msg = f.check(f.el.value, f.el);
    f.err.textContent = msg;
    f.el.classList.toggle('is-invalid', Boolean(msg) && f.el.type !== 'checkbox');
    f.el.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (msg) f.el.setAttribute('aria-describedby', f.err.id); else f.el.removeAttribute('aria-describedby');
    return !msg;
  };

  Object.keys(fields).forEach(function (key) {
    var f = fields[key];
    f.el.addEventListener(f.el.type === 'checkbox' ? 'change' : 'input', function () {
      if (f.err.textContent) validate(key);
    });
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    status.textContent = '';
    var ok = true, firstBad = null;
    Object.keys(fields).forEach(function (key) {
      if (!validate(key)) { ok = false; if (!firstBad) firstBad = fields[key].el; }
    });
    if (!ok) { firstBad.focus(); return; }

    var data = Object.fromEntries(new FormData(form).entries());
    var submit = form.querySelector('.form__submit');

    if (!FORM_ENDPOINT) {
      status.innerHTML = '<b>Форма работает в демо-режиме</b>Заявка заполнена верно, но пока никуда не отправляется. Чтобы связаться прямо сейчас, напишите нам в Telegram или позвоните.';
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Отправляем…';
    fetch(FORM_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        form.reset();
        status.innerHTML = '<b>Заявка отправлена</b>Свяжемся с вами в ближайшее рабочее время.';
      })
      .catch(function () {
        status.innerHTML = '<b>Заявка не отправилась</b>Проверьте интернет и попробуйте ещё раз или напишите нам в Telegram.';
      })
      .finally(function () { submit.disabled = false; submit.textContent = 'Отправить заявку'; });
  });

  /* Год в подвале */
  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
