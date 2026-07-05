// ============================================================
// MebelOFF — СРМ, этап 1: запись заказов в Google-таблицу
// ============================================================
// ИЗОЛИРОВАННЫЙ МОДУЛЬ (по образцу backup.js).
// main.js знает о нём ровно три строки:
//   window.CRM_GS_URL = SHEETS_URL;                          — вверху
//   if(window.crmPushOrder)window.crmPushOrder(rec);          — в saveCalc()
//   if(window.crmDogovorSigned)window.crmDogovorSigned({...}) — в generateDogovor()
// Если этот файл не подключён или таблица недоступна —
// сайт работает как раньше, заказ сохраняется локально.
//
// Поток данных (лист "Заказы" в Базе Расчёта, ключ — № заказа):
//   Сохранение расчёта   → upsert строки: новая получает статус
//                          "Расчет" и Предв. цену; у существующей
//                          обновляются цены и снимок, но НЕ статус
//                          и НЕ поля, заполненные руками в таблице.
//   Формирование Договора → статус "Договор", Согл. цена, Аванс,
//                          Дата договора.
// Снимок расчёта хранится JSON-строкой в 3 колонках по 45 000
// символов (лимит ячейки Google — 50 000).
// ============================================================
(function(){
  'use strict';

  var GS_URL = window.CRM_GS_URL || '';
  var TOKEN  = 'MebelOFF-2026';   // должен совпадать с CRM_TOKEN в Code.gs
  var SNAP_LIMIT = 45000;         // символов на колонку
  var SNAP_COLS  = 3;

  function toast(msg, color){
    if (typeof window.showStatus === 'function') {
      window.showStatus(msg, color);
      if (typeof window.hideStatus === 'function') setTimeout(window.hideStatus, 3500);
    }
  }

  function post(payload, onOk, onErr){
    if (!GS_URL) { if (onErr) onErr('не задан URL таблицы'); return; }
    payload.token = TOKEN;
    // ВАЖНО: body как простой текст (без заголовка application/json) —
    // иначе браузер шлёт preflight-запрос OPTIONS, на который Apps Script
    // не отвечает, и запрос падает по CORS.
    fetch(GS_URL, { method: 'POST', body: JSON.stringify(payload) })
      .then(function(r){ return r.json(); })
      .then(function(res){
        if (res && res.ok) { if (onOk) onOk(res); }
        else { if (onErr) onErr((res && res.error) || 'таблица вернула ошибку'); }
      })
      .catch(function(e){ if (onErr) onErr(String(e && e.message || e)); });
  }

  function splitSnap(obj){
    var s = '';
    try { s = JSON.stringify(obj); } catch(e) { s = ''; }
    if (s.length > SNAP_LIMIT * SNAP_COLS) {
      // Снимок не влезает в 3 ячейки — в таблицу не пишем (локальная
      // История его всё равно хранит), чтобы не сохранить обрезанный JSON.
      return { parts: ['', '', ''], tooBig: true };
    }
    var parts = [];
    for (var i = 0; i < SNAP_COLS; i++) parts.push(s.slice(i * SNAP_LIMIT, (i + 1) * SNAP_LIMIT));
    return { parts: parts, tooBig: false };
  }

  // ── Сохранение расчёта → заказ в таблице ──────────────────
  window.crmPushOrder = function(rec){
    if (!rec) return;
    var sn = splitSnap({ ST: rec.ST, snap: rec.snap });
    var order = {
      num:    String(rec.num || ''),
      client: rec.client || '',
      obj:    rec.obj || '',
      predPrice: Math.round(rec.totL || rec.totP || rec.totK || 0),
      totL: Math.round(rec.totL || 0),
      totP: Math.round(rec.totP || 0),
      totK: Math.round(rec.totK || 0),
      snap1: sn.parts[0], snap2: sn.parts[1], snap3: sn.parts[2]
    };
    post({ action: 'saveOrder', order: order }, function(res){
      var extra = sn.tooBig ? ' (снимок слишком большой, остался только локально)' : '';
      if (res && res.prevClient && res.prevClient !== order.client) {
        toast('⚠️ Заказ №' + order.num + ' уже был на клиента «' + res.prevClient + '» — перезаписан. Проверь № заказа!', '#BA7517');
      } else if (res && res.created) {
        toast('OK Заказ №' + order.num + ' создан в СРМ-таблице' + extra, '#1a5252');
      } else {
        toast('OK Заказ №' + order.num + ' обновлён в СРМ-таблице' + extra, '#1a5252');
      }
    }, function(err){
      toast('⚠️ Заказ №' + order.num + ' сохранён только локально. СРМ: ' + err, '#BA7517');
    });
  };

  // ── Договор сформирован → статус, согл. цена, аванс ───────
  window.crmDogovorSigned = function(info){
    if (!info || !info.num) return;
    post({ action: 'updateOrder', order: {
      num:       String(info.num),
      status:    'Договор',
      soglPrice: Math.round(info.total || 0),
      avans:     Math.round(info.avans || 0),
      client:    info.client || '',
      obj:       info.obj || ''
    }}, function(){
      toast('OK Заказ №' + info.num + ': статус «Договор», согл. цена и аванс записаны', '#1a5252');
    }, function(err){
      toast('⚠️ Не удалось обновить заказ №' + info.num + ' в СРМ: ' + err, '#BA7517');
    });
  };
})();
