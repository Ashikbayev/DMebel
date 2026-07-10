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
//                          Дата договора. Повторная генерация при уже
//                          существующей Дате договора ничего не меняет
//                          (сервер вернёт protected) — правки только
//                          через "Изменения".
//   Изменения к договору  → лист "Изменения": ±сумма двигает
//                          Согл. цену (она всегда = итоговая) и Долг;
//                          Аванс и Оплачено не трогаются. Долг < 0
//                          показывается как «Переплата».
// Снимок расчёта хранится JSON-строкой в 3 колонках по 45 000
// символов (лимит ячейки Google — 50 000).
// ============================================================
(function(){
  'use strict';

  var GS_URL = window.CRM_GS_URL || '';
  var SNAP_LIMIT = 45000;         // символов на колонку
  var SNAP_COLS  = 3;

  // Ключ доступа СРМ (совпадает с CRM_TOKEN в Code.gs).
  // В коде НЕ хранится — сайт публичный, и токен в исходниках был бы
  // виден любому. Вводится один раз на каждом устройстве и лежит
  // в localStorage. В файл бэкапа намеренно не попадает.
  function getToken(){ return localStorage.getItem('moff_crm_token') || ''; }
  function setToken(t){
    if (t) localStorage.setItem('moff_crm_token', t);
    else localStorage.removeItem('moff_crm_token');
  }

  function toast(msg, color){
    if (typeof window.showStatus === 'function') {
      window.showStatus(msg, color);
      if (typeof window.hideStatus === 'function') setTimeout(window.hideStatus, 3500);
    }
  }

  function post(payload, onOk, onErr){
    if (!GS_URL) { if (onErr) onErr('не задан URL таблицы'); return; }
    payload.token = getToken();
    if (!payload.token) { if (onErr) onErr('не введён ключ доступа — открой вкладку СРМ и введи ключ'); return; }
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

  // Сколько непустых (не null/undefined) позиций в разделе ST.
  function nonNullCount(arr){
    if (!arr) return 0;
    var n = 0;
    for (var i = 0; i < arr.length; i++) { if (arr[i] !== null && arr[i] !== undefined) n++; }
    return n;
  }
  // Ветка фасада по факту заполнения (ST.fldsp/fplen/fkr), а не по сумме —
  // корпус и общие расходы попадают во все три totL/P/K одинаково, поэтому
  // totL почти всегда >0, даже если фасад реально заполнен в Плёнке/Краске.
  function facadeBranch(ST){
    ST = ST || {};
    if (nonNullCount(ST.fldsp) > 0) return 'L';
    if (nonNullCount(ST.fplen) > 0) return 'P';
    if (nonNullCount(ST.fkr) > 0) return 'K';
    return null;
  }

  // ── Сохранение расчёта → заказ в таблице ──────────────────
  window.crmPushOrder = function(rec){
    if (!rec) return;
    var sn = splitSnap({ ST: rec.ST, snap: rec.snap });
    var br = facadeBranch(rec.ST);
    var predBase = br === 'L' ? rec.totL : (br === 'P' ? rec.totP : (br === 'K' ? rec.totK : (rec.totL || rec.totP || rec.totK)));
    var order = {
      num:    String(rec.num || ''),
      client: rec.client || '',
      furn:   rec.obj || '',
      predPrice: Math.round(predBase || 0),
      totL: Math.round(rec.totL || 0),
      totP: Math.round(rec.totP || 0),
      totK: Math.round(rec.totK || 0),
      margL: Math.round(rec.marginL || 0),
      margP: Math.round(rec.marginP || 0),
      margK: Math.round(rec.marginK || 0),
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
  // Повторная генерация при существующем договоре ничем не грозит:
  // сервер вернёт protected и НЕ перезапишет цену/аванс/дату/статус.
  window.crmDogovorSigned = function(info){
    if (!info || !info.num) return;
    post({ action: 'updateOrder', order: {
      num:       String(info.num),
      status:    'Договор',
      soglPrice: Math.round(info.total || 0),
      avans:     Math.round(info.avans || 0),
      margin:    Math.round(info.margin || 0),
      earnMaster:   Math.round(info.earnMaster || 0),
      earnDesigner: Math.round(info.earnDesigner || 0),
      client:    info.client || '',
      furn:      info.obj || '',
      fromDogovor: true
    }}, function(res){
      if(res && res.protected){
        toast('\u26A0\uFE0F По заказу \u2116' + info.num + ' уже есть договор от ' + fmtDate(res.dogDate) + '. Цена и аванс в СРМ не перезаписаны \u2014 изменения после договора фиксируй в карточке заказа (\u00B1 Изменение).', '#BA7517');
        return;
      }
      toast('OK Заказ №' + info.num + ': статус «Договор», согл. цена и аванс записаны', '#1a5252');
    }, function(err){
      toast('⚠️ Не удалось обновить заказ №' + info.num + ' в СРМ: ' + err, '#BA7517');
    });
  };

  // ══════════════════════════════════════════════════════════
  // ЭТАП 2: страница «СРМ» на сайте (доска + список + карточка)
  // ══════════════════════════════════════════════════════════
  var STATUSES = ['Замер','Дизайн','Расчет','Согласование','Договор','Контрольный замер',
                  'Закупка','Сборка','Установка','Доделки','Готова','Отказ','Отложено'];
  var ST_COLOR = {
    'Замер':'#888780','Дизайн':'#7F77DD','Расчет':'#185FA5','Согласование':'#1D9E75',
    'Договор':'#0F6E56','Контрольный замер':'#5DCAA5','Закупка':'#BA7517','Сборка':'#EF9F27',
    'Установка':'#D85A30','Доделки':'#D4537E','Готова':'#3B6D11','Отказ':'#A32D2D','Отложено':'#5F5E5A'
  };
  var ORDERS = [];
  var LOADED = false;
  var VIEW = localStorage.getItem('moff_crm_view') || 'board';
  var FILTER = 'all';
  var SEARCH = '';
  var CITY_FILTER = 'all';
  var MONTH_FILTER = 'all';
  var MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

  function monthKey(v){
    if(!v) return '';
    var d = new Date(v);
    if(isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2);
  }
  function monthLabel(key){
    var p = key.split('-');
    return (MONTH_NAMES[(+p[1])-1] || p[1]) + ' ' + p[0];
  }
  function shiftMonthKey(key, delta){
    var p = key.split('-');
    var d = new Date(+p[0], (+p[1]-1)+delta, 1);
    return monthKey(d);
  }
  function isActive(o){
    return ['Готова','Отказ','Отложено'].indexOf(o.status) < 0;
  }
  function nextStatus(o){
    var i = STATUSES.indexOf(o.status);
    if(i < 0 || o.status==='Готова' || o.status==='Отказ' || o.status==='Отложено') return null;
    var nx = STATUSES[i+1];
    if(!nx || nx==='Отказ' || nx==='Отложено') return null;
    return nx;
  }

  function fm0(n){ n = Math.round(Number(n)||0); return n.toLocaleString('ru-RU') + '\u20B8'; }
  function fmtDate(v){
    if(!v) return '';
    var d = new Date(v);
    if(isNaN(d.getTime())) return String(v);
    return ('0'+d.getDate()).slice(-2)+'.'+('0'+(d.getMonth()+1)).slice(-2)+'.'+d.getFullYear();
  }
  function daysInWork(o){
    if(!o.dogDate || o.status==='Готова' || o.status==='Отказ') return null;
    var d = new Date(o.dogDate); if(isNaN(d.getTime())) return null;
    return Math.max(0, Math.floor((Date.now()-d.getTime())/86400000));
  }
  function debtOf(o){
    var s = Number(o.sogl)||0;
    if(!s) return 0;
    return s - (Number(o.avans)||0) - (Number(o.paid)||0);
  }
  // Маржа заказа. Договор подписан → авторитетная margin (зафиксирована при
  // договоре). Ещё нет договора → черновая маржа той же ветки, что и
  // Предв. цена: сверяем o.pred с totals (pred сохраняется по ветке
  // реально заполненного фасада, см. facadeBranch). Для заказов, сохранённых
  // до этого фикса — fallback на старую эвристику (первая ненулевая ветка).
  function marginOf(o){
    if(Number(o.sogl) > 0 && o.margin !== undefined && o.margin !== '' && o.margin !== null){
      return Number(o.margin)||0;
    }
    if(Number(o.margin) > 0) return Number(o.margin)||0;
    var mL = Number(o.margL)||0, mP = Number(o.margP)||0, mK = Number(o.margK)||0;
    var tL = Number(o.totL)||0, tP = Number(o.totP)||0, tK = Number(o.totK)||0;
    var pred = Number(o.pred)||0;
    if(pred > 0){
      if(tL === pred) return mL;
      if(tP === pred) return mP;
      if(tK === pred) return mK;
    }
    if(tL > 0) return mL;
    if(tP > 0) return mP;
    if(tK > 0) return mK;
    return mL || mP || mK || 0;
  }
  function matches(o){
    if(!SEARCH) return true;
    var s = SEARCH.toLowerCase();
    return String(o.num).toLowerCase().indexOf(s)>=0 ||
      String(o.client||'').toLowerCase().indexOf(s)>=0 ||
      String(o.phone||'').toLowerCase().indexOf(s)>=0 ||
      String(o.obj||'').toLowerCase().indexOf(s)>=0 ||
      String(o.city||'').toLowerCase().indexOf(s)>=0 ||
      String(o.furn||'').toLowerCase().indexOf(s)>=0;
  }

  function injectCrmStyle(){
    if(document.getElementById('moff-crm-style')) return;
    var st = document.createElement('style');
    st.id = 'moff-crm-style';
    st.textContent =
      '.crm-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}'+
      '.crm-tools input,.crm-tools select{font-size:12px;border:1px solid #ddd;border-radius:8px;padding:7px 10px}'+
      '.crm-vbtn{font-size:12px;border:1px solid #ddd;background:#fff;border-radius:8px;padding:7px 12px;cursor:pointer;color:#555}'+
      '.crm-vbtn.on{background:#1a5252;color:#fff;border-color:#1a5252}'+
      '.crm-count{font-size:11px;color:#999;margin-left:auto}'+
      '.crm-board{display:flex;gap:10px;overflow-x:auto;padding-bottom:12px;align-items:flex-start}'+
      '.crm-col{min-width:200px;max-width:200px;background:#f6f6f4;border-radius:10px;padding:8px;flex-shrink:0}'+
      '.crm-col-h{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#444;padding:2px 4px 8px}'+
      '.crm-col-h .dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}'+
      '.crm-col-h .cnt{margin-left:auto;font-size:11px;color:#999;font-weight:400}'+
      '.crm-card{background:#fff;border-radius:8px;padding:8px 10px;margin-bottom:8px;cursor:pointer;border-left:3px solid #ccc;box-shadow:0 1px 3px rgba(0,0,0,.06)}'+
      '.crm-card:hover{box-shadow:0 2px 8px rgba(0,0,0,.12)}'+
      '.crm-card .l1{display:flex;justify-content:space-between;gap:6px;font-size:12px;font-weight:600;color:#222}'+
      '.crm-card .l2{font-size:11px;color:#666;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'+
      '.crm-card .l3{display:flex;justify-content:space-between;gap:6px;font-size:11px;margin-top:4px}'+
      '.crm-debt{color:#c0392b;font-weight:600}'+
      '.crm-days{color:#999}'+
      '.crm-list{display:flex;flex-direction:column;gap:6px}'+
      '.crm-row{display:flex;gap:8px;align-items:center;background:#fff;border:1px solid #eee;border-radius:8px;padding:8px 10px;cursor:pointer;flex-wrap:wrap}'+
      '.crm-row:hover{border-color:#1a5252}'+
      '.crm-badge{font-size:10px;color:#fff;border-radius:10px;padding:2px 8px;white-space:nowrap}'+
      '.crm-row .num{font-size:12px;font-weight:700;color:#222;min-width:44px}'+
      '.crm-row .cli{font-size:12px;color:#333;flex:1;min-width:120px}'+
      '.crm-row .sub{font-size:11px;color:#888}'+
      '.crm-row .money{font-size:12px;font-weight:600;color:#222;margin-left:auto}'+
      '.crm-empty{font-size:12px;color:#999;padding:20px;text-align:center}'+
      '.crm-modal-bg{position:fixed;inset:0;background:rgba(20,20,20,.5);z-index:9999;display:flex;align-items:center;justify-content:center}'+
      '.crm-modal{background:#fff;border-radius:12px;max-width:480px;width:94%;max-height:88vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)}'+
      '.crm-m-h{padding:14px 16px;border-bottom:1px solid #eee;display:flex;align-items:center;gap:8px;position:sticky;top:0;background:#fff;z-index:2}'+
      '.crm-m-h b{font-size:14px;color:#222}'+
      '.crm-m-x{margin-left:auto;background:none;border:none;font-size:20px;cursor:pointer;color:#999;line-height:1}'+
      '.crm-m-b{padding:12px 16px}'+
      '.crm-f{margin-bottom:8px}'+
      '.crm-f label{display:block;font-size:10px;color:#999;margin-bottom:3px}'+
      '.crm-f input,.crm-f select,.crm-f textarea{width:100%;font-size:12px;border:1px solid #ddd;border-radius:8px;padding:7px 9px;box-sizing:border-box;font-family:inherit}'+
      '.crm-2col{display:flex;gap:8px}.crm-2col .crm-f{flex:1}'+
      '.crm-money-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;background:#f6f6f4;border-radius:8px;padding:10px;margin-bottom:10px;font-size:11px;color:#555}'+
      '.crm-money-grid b{color:#222;font-size:12px}'+
      '.crm-m-btns{display:flex;gap:8px;margin-top:12px}'+
      '.crm-m-btn{flex:1;padding:10px;border-radius:8px;border:none;font-size:12px;font-weight:600;cursor:pointer}'+
      '.crm-m-btn.save{background:#1a5252;color:#fff}'+
      '.crm-m-btn.open{background:#fff;color:#1a5252;border:1px solid #1a5252}'+
      '.crm-m-btn.danger{background:#fff;color:#c0392b;border:1px solid #e0b4ae;flex:0 0 auto;padding:10px 14px}'+
      '.crm-sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:10px}'+
      '.crm-sum-t{background:#fff;border:1px solid #eee;border-radius:10px;padding:10px 12px}'+
      '.crm-sum-t .v{font-size:15px;font-weight:700;color:#1a5252;white-space:nowrap}'+
      '.crm-sum-t .v.warn{color:#c0392b}'+
      '.crm-sum-t .k{font-size:10px;color:#999;margin-top:2px}'+
      '.crm-cityb{font-size:11px;border:1px solid #ddd;background:#fff;border-radius:14px;padding:5px 11px;cursor:pointer;color:#666}'+
      '.crm-cityb.on{background:#5DCAA5;border-color:#5DCAA5;color:#fff}'+
      '.crm-next{margin-top:6px;width:100%;font-size:10px;border:1px solid #e0e0e0;background:#fafaf8;border-radius:6px;padding:4px 6px;cursor:pointer;color:#1a5252;text-align:center}'+
      '.crm-next:hover{background:#1a5252;color:#fff;border-color:#1a5252}'+
      '.crm-warn-line{font-size:11px;color:#BA7517;background:#fdf6ec;border-radius:8px;padding:8px 10px;margin-bottom:8px;cursor:pointer}'+
      '.crm-tel{color:#185FA5;text-decoration:none}'+
      '.crm-vbtn.new{background:#0F6E56;color:#fff;border-color:#0F6E56}'+
      '.crm-col.drag{outline:2px dashed #1a5252;outline-offset:-2px;background:#eef4f2}'+
      '.crm-card[draggable=true]{user-select:none}'+
      '.crm-al{background:#fff;border:1px solid #f0d9b5;border-radius:10px;margin-bottom:10px;overflow:hidden}'+
      '.crm-al-h{display:flex;align-items:center;gap:6px;padding:9px 12px;font-size:12px;font-weight:600;color:#BA7517;cursor:pointer;background:#fdf6ec}'+
      '.crm-al-h .tgl{margin-left:auto;font-size:11px;color:#c9a15f}'+
      '.crm-al-row{display:flex;gap:8px;align-items:center;padding:7px 12px;font-size:11px;color:#555;border-top:1px solid #faf3e6;cursor:pointer}'+
      '.crm-al-row:hover{background:#fdfaf4}'+
      '.crm-al-row b{color:#222;white-space:nowrap}'+
      '.crm-fin-note{font-size:10px;color:#aaa;margin:6px 0 14px;line-height:1.5}'+
      '.crm-chart{background:#fff;border:1px solid #eee;border-radius:10px;padding:14px 12px 6px;margin-bottom:10px}'+
      '.crm-chart-t{font-size:12px;font-weight:600;color:#444;margin-bottom:10px}'+
      '.crm-bars{display:flex;align-items:flex-end;gap:6px;height:140px;overflow-x:auto;padding-bottom:4px}'+
      '.crm-bgrp{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:44px;flex:1}'+
      '.crm-bpair{display:flex;align-items:flex-end;gap:2px;height:110px}'+
      '.crm-bar{width:14px;border-radius:3px 3px 0 0;min-height:2px}'+
      '.crm-bar.rev{background:#1a5252}'+
      '.crm-bar.av{background:#5DCAA5}'+
      '.crm-bx{font-size:9px;color:#999;white-space:nowrap}'+
      '.crm-legend{display:flex;gap:14px;font-size:10px;color:#777;margin-top:6px;padding-bottom:6px}'+
      '.crm-legend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px}'+
      '.crm-ftbl{width:100%;border-collapse:collapse;background:#fff;border:1px solid #eee;border-radius:10px;overflow:hidden}'+
      '.crm-ftbl th{font-size:10px;color:#999;text-align:right;padding:8px 10px;border-bottom:1px solid #eee;font-weight:600}'+
      '.crm-ftbl th:first-child{text-align:left}'+
      '.crm-ftbl td{font-size:11px;color:#333;text-align:right;padding:7px 10px;border-bottom:1px solid #f5f5f3}'+
      '.crm-ftbl td:first-child{text-align:left;font-weight:600;color:#222}'+
      '.crm-ftbl tr:last-child td{border-bottom:none}'+
      '.crm-ftbl td.debt{color:#c0392b}'+
      '.crm-bar.fin-in{background:#0F6E56}'+
      '.crm-bar.fin-out{background:#D85A30}'+
      '.crm-ops{background:#fff;border:1px solid #eee;border-radius:10px;margin-bottom:10px;overflow:hidden}'+
      '.crm-ops-h{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #f0f0ee}'+
      '.crm-ops-h b{font-size:12px;color:#444}'+
      '.crm-op{display:flex;gap:8px;align-items:center;padding:7px 12px;font-size:11px;color:#555;border-bottom:1px solid #f7f7f5;flex-wrap:wrap}'+
      '.crm-op:last-child{border-bottom:none}'+
      '.crm-op .dt{color:#999;min-width:64px}'+
      '.crm-op .cat{font-weight:600;color:#333}'+
      '.crm-op .cmt{color:#999;flex:1;min-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'+
      '.crm-op .sm{font-weight:700;margin-left:auto;white-space:nowrap}'+
      '.crm-op .sm.in{color:#0F6E56}'+
      '.crm-op .sm.out{color:#c0392b}'+
      '.crm-op .del{background:none;border:none;color:#ccc;cursor:pointer;font-size:13px;line-height:1;padding:2px}'+
      '.crm-op .del:hover{color:#c0392b}'+
      '.crm-sec-t{font-size:13px;font-weight:600;color:#444;margin:14px 0 8px}'+
      '.crm-ch-box{background:#fff;border:1px solid #eee;border-radius:10px;margin-bottom:10px;overflow:hidden}'+
      '.crm-ch-h{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #f0f0ee}'+
      '.crm-ch-h b{font-size:12px;color:#444;flex:1}'+
      '.crm-ch-row{display:flex;gap:8px;align-items:center;padding:7px 12px;font-size:11px;color:#555;border-bottom:1px solid #f7f7f5}'+
      '.crm-ch-row:last-child{border-bottom:none}'+
      '.crm-ch-row .dt{color:#999;min-width:64px}'+
      '.crm-ch-row .ds{flex:1;color:#333;min-width:80px}'+
      '.crm-ch-row .sm{font-weight:700;white-space:nowrap;margin-left:auto}'+
      '.crm-ch-row .sm.in{color:#0F6E56}'+
      '.crm-ch-row .sm.out{color:#c0392b}'+
      '.crm-ch-row .del{background:none;border:none;color:#ccc;cursor:pointer;font-size:13px;line-height:1;padding:2px}'+
      '.crm-ch-row .del:hover{color:#c0392b}'+
      '.crm-ch-row .prn{background:none;border:none;color:#bbb;cursor:pointer;font-size:13px;line-height:1;padding:2px}'+
      '.crm-ch-row .prn:hover{color:#BA7517}'+
      '.crm-over{color:#0F6E56}'+
      '.crm-margin{color:#0F6E56;font-weight:600}'+
      '.crm-overpaid{color:#0F6E56;font-weight:600}';
    document.head.appendChild(st);
  }

  function fetchOrders(cb){
    if(!getToken()){ cb('__no_key__'); return; }
    fetch(GS_URL + '?action=orders&token=' + encodeURIComponent(getToken()))
      .then(function(r){ return r.json(); })
      .then(function(res){
        if(res && res.ok){ ORDERS = res.orders || []; LOADED = true; cb(null); }
        else if(res && res.error === 'нет доступа') cb('__bad_key__');
        else cb((res && res.error) || 'таблица вернула ошибку');
      })
      .catch(function(e){ cb(String(e && e.message || e)); });
  }

  function renderKeyGate(badKey){
    var root = document.getElementById('crm-root');
    if(!root) return;
    injectCrmStyle();
    root.innerHTML = '';
    var box = document.createElement('div');
    box.style.cssText = 'max-width:380px;margin:40px auto;background:#fff;border:1px solid #eee;border-radius:12px;padding:20px';
    var h = document.createElement('div');
    h.style.cssText = 'font-size:14px;font-weight:600;color:#222;margin-bottom:6px';
    h.textContent = '\uD83D\uDD11 Ключ доступа СРМ';
    var p = document.createElement('div');
    p.style.cssText = 'font-size:11px;color:#888;line-height:1.5;margin-bottom:12px';
    p.textContent = badKey
      ? 'Ключ не подошёл. Проверь, что он совпадает с CRM_TOKEN в Code.gs (буква в букву).'
      : 'Данные клиентов защищены. Введи ключ один раз — он сохранится на этом устройстве. Ключ — это значение CRM_TOKEN из Code.gs.';
    var inp2 = document.createElement('input');
    inp2.type = 'password';
    inp2.placeholder = 'Ключ доступа';
    inp2.style.cssText = 'width:100%;font-size:13px;border:1px solid #ddd;border-radius:8px;padding:9px 10px;box-sizing:border-box;margin-bottom:10px';
    var btn = document.createElement('button');
    btn.className = 'crm-m-btn save';
    btn.style.width = '100%';
    btn.textContent = 'Войти в СРМ';
    function submit(){
      var v = inp2.value.trim();
      if(!v){ toast('\u26A0\uFE0F Введи ключ', '#BA7517'); return; }
      setToken(v);
      window.crmReload();
    }
    btn.addEventListener('click', submit);
    inp2.addEventListener('keydown', function(e){ if(e.key === 'Enter') submit(); });
    box.appendChild(h); box.appendChild(p); box.appendChild(inp2); box.appendChild(btn);
    root.appendChild(box);
    setTimeout(function(){ try{ inp2.focus(); }catch(e){} }, 50);
  }

  window.crmPageOpen = function(){
    injectCrmStyle();
    if(LOADED){ renderAll(); refreshQuiet(); return; }
    var root = document.getElementById('crm-root');
    if(root) root.innerHTML = '<div class="crm-empty">Загружаю заказы из таблицы...</div>';
    fetchOrders(function(err){
      if(err === '__no_key__'){ renderKeyGate(false); return; }
      if(err === '__bad_key__'){ setToken(''); renderKeyGate(true); return; }
      if(err){ if(root) root.innerHTML = '<div class="crm-empty">Не удалось загрузить: '+err+'<br><br><button class="crm-vbtn" onclick="crmReload()">Повторить</button></div>'; return; }
      renderAll();
    });
  };
  window.crmReload = function(){
    LOADED = false;
    window.crmPageOpen();
  };
  function refreshQuiet(){
    fetchOrders(function(err){ if(!err) renderAll(); });
  }

  function buildAlerts(){
    var out = [];
    var now = Date.now();
    var instIdx = STATUSES.indexOf('Установка');
    ORDERS.forEach(function(o){
      var debt = debtOf(o);
      if(o.status === 'Готова' && debt > 0){
        out.push({ o:o, text:'мебель готова, а долг не закрыт: ' + fm0(debt) });
        return;
      }
      if(!isActive(o)) return;
      var md = o.mountDate ? new Date(o.mountDate) : null;
      if(md && !isNaN(md.getTime())){
        var days = Math.floor((md.getTime() - now) / 86400000);
        var stIdx = STATUSES.indexOf(o.status);
        if(days < 0 && stIdx >= 0 && stIdx < instIdx){
          out.push({ o:o, text:'дата установки прошла (' + fmtDate(o.mountDate) + '), а заказ ещё на этапе «' + o.status + '»' });
          return;
        }
        if(days >= 0 && days <= 7){
          out.push({ o:o, text:'установка ' + (days===0 ? 'СЕГОДНЯ' : 'через ' + days + ' дн.') + ' (' + fmtDate(o.mountDate) + '), этап: ' + o.status });
          return;
        }
      }
      if(o.updated){
        var u = new Date(o.updated);
        if(!isNaN(u.getTime()) && (now - u.getTime()) > 14 * 86400000){
          out.push({ o:o, text:'нет движения больше 2 недель (этап «' + o.status + '»)' });
        }
      }
    });
    return out;
  }

  function renderAll(){
    var root = document.getElementById('crm-root');
    if(!root) return;
    root.innerHTML = '';
    // ── Сводка ──
    var act = ORDERS.filter(isActive);
    var moneyInWork = 0;
    act.forEach(function(o){ moneyInWork += Number(o.sogl) || Number(o.pred) || 0; });
    var debtTotal = 0;
    ORDERS.forEach(function(o){ if(o.status!=='Отказ'){ var d=debtOf(o); if(d>0) debtTotal+=d; } });
    var nowKey = monthKey(new Date());
    var mountsNow = ORDERS.filter(function(o){ return o.status!=='Отказ' && monthKey(o.mountDate)===nowKey; }).length;
    var sum = document.createElement('div');
    sum.className = 'crm-sum';
    function tile(v, k, warn){
      var t = document.createElement('div'); t.className='crm-sum-t';
      var ve = document.createElement('div'); ve.className='v'+(warn?' warn':''); ve.textContent=v;
      var ke = document.createElement('div'); ke.className='k'; ke.textContent=k;
      t.appendChild(ve); t.appendChild(ke); sum.appendChild(t);
    }
    tile(String(act.length), 'заказов в работе');
    tile(fm0(moneyInWork), 'денег в работе');
    tile(fm0(debtTotal), 'долг клиентов', debtTotal>0);
    tile(String(mountsNow), 'установок в этом месяце');
    root.appendChild(sum);
    // ── Требует внимания ──
    var alerts = buildAlerts();
    if(alerts.length){
      var al = document.createElement('div'); al.className='crm-al';
      var alh = document.createElement('div'); alh.className='crm-al-h';
      var open = localStorage.getItem('moff_crm_alerts') !== '0';
      var alBody = document.createElement('div');
      alBody.style.display = open ? '' : 'none';
      var tgl = document.createElement('span'); tgl.className='tgl';
      tgl.textContent = open ? 'свернуть' : 'показать';
      var htxt = document.createElement('span');
      htxt.textContent = '\u26A0\uFE0F Требует внимания: ' + alerts.length;
      alh.appendChild(htxt); alh.appendChild(tgl);
      alh.addEventListener('click', function(){
        var vis2 = alBody.style.display === 'none';
        alBody.style.display = vis2 ? '' : 'none';
        tgl.textContent = vis2 ? 'свернуть' : 'показать';
        localStorage.setItem('moff_crm_alerts', vis2 ? '1' : '0');
      });
      alerts.forEach(function(a){
        var r = document.createElement('div'); r.className='crm-al-row';
        var nEl = document.createElement('b'); nEl.textContent = '\u2116'+a.o.num;
        var tEl = document.createElement('span'); tEl.textContent = a.text;
        r.appendChild(nEl); r.appendChild(tEl);
        r.addEventListener('click', function(){ openCard(a.o.num); });
        alBody.appendChild(r);
      });
      al.appendChild(alh); al.appendChild(alBody);
      root.appendChild(al);
    }
    // ── Инструменты ──
    var tools = document.createElement('div');
    tools.className = 'crm-tools';
    var bNew = document.createElement('button');
    bNew.className = 'crm-vbtn new';
    bNew.textContent = '+ Заказ';
    bNew.addEventListener('click', openNewOrderModal);
    tools.appendChild(bNew);
    var bBoard = document.createElement('button');
    bBoard.className = 'crm-vbtn' + (VIEW==='board' ? ' on' : '');
    bBoard.textContent = 'Доска';
    bBoard.addEventListener('click', function(){ VIEW='board'; localStorage.setItem('moff_crm_view','board'); renderAll(); });
    var bList = document.createElement('button');
    bList.className = 'crm-vbtn' + (VIEW==='list' ? ' on' : '');
    bList.textContent = 'Список';
    bList.addEventListener('click', function(){ VIEW='list'; localStorage.setItem('moff_crm_view','list'); renderAll(); });
    var bFin = document.createElement('button');
    bFin.className = 'crm-vbtn' + (VIEW==='fin' ? ' on' : '');
    bFin.textContent = 'Финансы';
    bFin.addEventListener('click', function(){ VIEW='fin'; localStorage.setItem('moff_crm_view','fin'); renderAll(); });
    var bStock = document.createElement('button');
    bStock.className = 'crm-vbtn' + (VIEW==='stock' ? ' on' : '');
    bStock.textContent = 'Склад';
    bStock.addEventListener('click', function(){ VIEW='stock'; localStorage.setItem('moff_crm_view','stock'); renderAll(); });
    tools.appendChild(bBoard); tools.appendChild(bList); tools.appendChild(bFin); tools.appendChild(bStock);
    if(VIEW !== 'fin' && VIEW !== 'stock'){
    var search = document.createElement('input');
    search.type = 'search'; search.placeholder = 'Поиск: №, клиент, телефон, город...';
    search.value = SEARCH; search.style.flex = '1'; search.style.minWidth = '140px';
    search.addEventListener('input', function(){ SEARCH = search.value.trim(); renderView(); });
    tools.appendChild(search);
    // города
    var cities = [];
    ORDERS.forEach(function(o){ var c=String(o.city||'').trim(); if(c && cities.indexOf(c)<0) cities.push(c); });
    cities.sort();
    if(cities.length){
      var bAllC = document.createElement('button');
      bAllC.className = 'crm-cityb' + (CITY_FILTER==='all' ? ' on' : '');
      bAllC.textContent = 'Все';
      bAllC.addEventListener('click', function(){ CITY_FILTER='all'; renderAll(); });
      tools.appendChild(bAllC);
      cities.forEach(function(c){
        var bc = document.createElement('button');
        bc.className = 'crm-cityb' + (CITY_FILTER===c ? ' on' : '');
        bc.textContent = c;
        bc.addEventListener('click', function(){ CITY_FILTER = (CITY_FILTER===c ? 'all' : c); renderAll(); });
        tools.appendChild(bc);
      });
    }
    // месяц установки
    var mkeys = [];
    ORDERS.forEach(function(o){ var k=monthKey(o.mountDate); if(k && mkeys.indexOf(k)<0) mkeys.push(k); });
    mkeys.sort();
    var mSel = document.createElement('select');
    var mAll = document.createElement('option'); mAll.value='all'; mAll.textContent='Установка: все месяцы'; mSel.appendChild(mAll);
    mkeys.forEach(function(k){ var op=document.createElement('option'); op.value=k; op.textContent='Установка: '+monthLabel(k); mSel.appendChild(op); });
    var mNone = document.createElement('option'); mNone.value='none'; mNone.textContent='В работе без даты установки'; mSel.appendChild(mNone);
    mSel.value = MONTH_FILTER;
    mSel.addEventListener('change', function(){ MONTH_FILTER = mSel.value; renderView(); });
    tools.appendChild(mSel);
    var filt = null;
    if(VIEW === 'list'){
      filt = document.createElement('select');
      var oAll = document.createElement('option'); oAll.value='all'; oAll.textContent='Все статусы'; filt.appendChild(oAll);
      STATUSES.forEach(function(s){ var o=document.createElement('option'); o.value=s; o.textContent=s; filt.appendChild(o); });
      filt.value = FILTER;
      filt.addEventListener('change', function(){ FILTER = filt.value; renderView(); });
      tools.appendChild(filt);
    }
    }
    var cnt = document.createElement('span');
    cnt.className = 'crm-count'; cnt.id = 'crm-count';
    tools.appendChild(cnt);
    var bKey = document.createElement('button');
    bKey.className = 'crm-vbtn';
    bKey.textContent = '\uD83D\uDD11';
    bKey.title = 'Сменить ключ доступа СРМ';
    bKey.addEventListener('click', function(){
      var sure = confirm('Выйти из СРМ на этом устройстве? Для входа снова понадобится ключ.');
      if(!sure) return;
      setToken('');
      LOADED = false; ORDERS = [];
      renderKeyGate(false);
    });
    tools.appendChild(bKey);
    root.appendChild(tools);
    var view = document.createElement('div');
    view.id = 'crm-view';
    root.appendChild(view);
    renderView();
  }

  function monthOk(o){
    if(MONTH_FILTER==='all') return true;
    if(MONTH_FILTER==='none') return isActive(o) && !monthKey(o.mountDate);
    return monthKey(o.mountDate)===MONTH_FILTER;
  }
  function renderView(){
    var view = document.getElementById('crm-view');
    if(!view) return;
    view.innerHTML = '';
    var vis = ORDERS.filter(function(o){
      if(!matches(o)) return false;
      if(CITY_FILTER!=='all' && String(o.city||'').trim()!==CITY_FILTER) return false;
      return monthOk(o);
    });
    var cnt = document.getElementById('crm-count');
    if(VIEW === 'stock'){ if(cnt) cnt.textContent = ''; renderStock(view); return; }
    if(VIEW === 'fin'){
      if(cnt) cnt.textContent = '';
      renderFin(view);
      return;
    }
    if(cnt) cnt.textContent = vis.length + ' из ' + ORDERS.length;
    if(!ORDERS.length){ view.innerHTML = '<div class="crm-empty">Заказов пока нет. Сохрани расчёт с № заказа — он появится здесь.</div>'; return; }
    if(MONTH_FILTER!=='all' && MONTH_FILTER!=='none'){
      var noDate = ORDERS.filter(function(o){ return isActive(o) && !monthKey(o.mountDate) && matches(o) && (CITY_FILTER==='all' || String(o.city||'').trim()===CITY_FILTER); }).length;
      if(noDate){
        var w = document.createElement('div');
        w.className = 'crm-warn-line';
        w.textContent = '\u26A0\uFE0F Ещё ' + noDate + ' заказ(ов) в работе без даты установки — они не попали в этот фильтр. Нажми, чтобы показать их.';
        w.addEventListener('click', function(){ MONTH_FILTER='none'; renderAll(); });
        view.appendChild(w);
      }
    }
    if(VIEW === 'board') renderBoard(view, vis); else renderList(view, vis);
  }

  var MONTH_SHORT = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  var FIN = [];
  var FIN_LOADED = false;
  var FIN_SUB = 'kassa';
  var FIN_MONTH = monthKey(new Date());
  var RECUR = [];
  var RECUR_LOADED = false;
  var EMP = [];
  var EMP_LOADED = false;
  var STOCK = [];
  var STOCK_LOADED = false;
  var STOCK_MOVES = [];
  var STOCK_MOVES_LOADED = false;
  var STOCK_SUBVIEW = 'balance';
  var CAT_IN  = ['Доплата','Прочий приход'];
  var CAT_OUT = ['Материалы','Оплата мастеру','Оплата дизайнеру','Аренда','Реклама','Транспорт','Инструмент','Прочее'];
  var RECUR_CAT = ['Аренда','Реклама','Связь/Интернет','Коммуналка','Транспорт','Прочее'];

  // ── Изменения к договору (лист "Изменения") ────────────────
  var CH = [];
  var CH_LOADED = false;

  function fetchChanges(cb){
    if(!getToken()){ cb('__no_key__'); return; }
    fetch(GS_URL + '?action=changes&token=' + encodeURIComponent(getToken()))
      .then(function(r){ return r.json(); })
      .then(function(res){
        if(res && res.ok){ CH = res.changes || []; CH_LOADED = true; cb(null); }
        else cb((res && res.error) || 'таблица вернула ошибку');
      })
      .catch(function(e){ cb(String(e && e.message || e)); });
  }

  function changesOf(num){
    var out = [];
    for(var i=0;i<CH.length;i++){
      if(String(CH[i].num) === String(num)) out.push(CH[i]);
    }
    return out;
  }

  // ── Вложения (лист "Вложения"): фото и заметки к заказам ──
  var ATT = [];
  var ATT_LOADED = false;

  function fetchAttach(cb){
    if(!getToken()){ cb('__no_key__'); return; }
    fetch(GS_URL + '?action=attach&token=' + encodeURIComponent(getToken()))
      .then(function(r){ return r.json(); })
      .then(function(res){
        if(res && res.ok){ ATT = res.attach || []; ATT_LOADED = true; cb(null); }
        else cb((res && res.error) || 'таблица вернула ошибку');
      })
      .catch(function(e){ cb(String(e && e.message || e)); });
  }

  function attachOf(num){
    var out = [];
    for(var i=0;i<ATT.length;i++){
      if(String(ATT[i].num) === String(num)) out.push(ATT[i]);
    }
    return out;
  }

  // Сжатие фото в браузере перед отправкой: до 1600px по длинной
  // стороне, JPEG 0.8 — телефонное фото 4-8 МБ превращается в
  // ~200-400 КБ. Это и скорость загрузки, и экономия Диска.
  // cb(base64 без префикса data:) либо cb(null), если файл не читается.
  function compressImage(file, cb){
    var reader = new FileReader();
    reader.onload = function(){
      var img = new Image();
      img.onload = function(){
        var maxSide = 1600;
        var w = img.width, h = img.height;
        if(w > maxSide || h > maxSide){
          if(w > h){ h = Math.round(h * maxSide / w); w = maxSide; }
          else { w = Math.round(w * maxSide / h); h = maxSide; }
        }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        var dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        var b64 = dataUrl.split(',')[1];
        cb(b64 || null);
      };
      img.onerror = function(){ cb(null); };
      img.src = reader.result;
    };
    reader.onerror = function(){ cb(null); };
    reader.readAsDataURL(file);
  }

  function fetchFin(cb){
    if(!getToken()){ cb('__no_key__'); return; }
    fetch(GS_URL + '?action=fin&token=' + encodeURIComponent(getToken()))
      .then(function(r){ return r.json(); })
      .then(function(res){
        if(res && res.ok){ FIN = res.fin || []; FIN_LOADED = true; cb(null); }
        else cb((res && res.error) || 'таблица вернула ошибку');
      })
      .catch(function(e){ cb(String(e && e.message || e)); });
  }

  function fetchRecur(cb){
    if(!getToken()){ cb('__no_key__'); return; }
    fetch(GS_URL + '?action=recur&token=' + encodeURIComponent(getToken()))
      .then(function(r){ return r.json(); })
      .then(function(res){
        if(res && res.ok){ RECUR = res.recur || []; RECUR_LOADED = true; cb(null); }
        else cb((res && res.error) || 'таблица вернула ошибку');
      })
      .catch(function(e){ cb(String(e && e.message || e)); });
  }

  function fetchEmp(cb){
    if(!getToken()){ cb('__no_key__'); return; }
    fetch(GS_URL + '?action=employees&token=' + encodeURIComponent(getToken()))
      .then(function(r){ return r.json(); })
      .then(function(res){
        if(res && res.ok){ EMP = res.employees || []; EMP_LOADED = true; cb(null); }
        else cb((res && res.error) || 'таблица вернула ошибку');
      })
      .catch(function(e){ cb(String(e && e.message || e)); });
  }

  // ── Склад v3.6: остатки + приход/выдача ──────────────────
  function fetchStock(cb){
    if(!getToken()){ cb('__no_key__'); return; }
    fetch(GS_URL + '?action=stock&token=' + encodeURIComponent(getToken()))
      .then(function(r){ return r.json(); })
      .then(function(res){
        if(res && res.ok){ STOCK = res.stock || []; STOCK_LOADED = true; cb(null); }
        else cb((res && res.error) || 'таблица вернула ошибку');
      })
      .catch(function(e){ cb(String(e && e.message || e)); });
  }

  function fetchStockMoves(cb){
    if(!getToken()){ cb('__no_key__'); return; }
    fetch(GS_URL + '?action=stockMoves&token=' + encodeURIComponent(getToken()))
      .then(function(r){ return r.json(); })
      .then(function(res){
        if(res && res.ok){ STOCK_MOVES = res.moves || []; STOCK_MOVES_LOADED = true; cb(null); }
        else cb((res && res.error) || 'таблица вернула ошибку');
      })
      .catch(function(e){ cb(String(e && e.message || e)); });
  }

  function renderStock(view){
    var wrap = document.createElement('div');
    var t0 = document.createElement('b');
    t0.textContent = STOCK_SUBVIEW === 'history' ? 'Склад — история движений' : 'Склад — остатки (текущие)';
    t0.style.display = 'block'; t0.style.marginBottom = '6px';
    wrap.appendChild(t0);

    var tabRow = document.createElement('div'); tabRow.className = 'crm-m-btns';
    var bBal = document.createElement('button'); bBal.className = 'crm-vbtn' + (STOCK_SUBVIEW==='balance' ? ' on' : ''); bBal.textContent = 'Остатки';
    bBal.addEventListener('click', function(){ STOCK_SUBVIEW='balance'; renderAll(); });
    var bHist = document.createElement('button'); bHist.className = 'crm-vbtn' + (STOCK_SUBVIEW==='history' ? ' on' : ''); bHist.textContent = 'История';
    bHist.addEventListener('click', function(){ STOCK_SUBVIEW='history'; renderAll(); });
    tabRow.appendChild(bBal); tabRow.appendChild(bHist);
    wrap.appendChild(tabRow);

    var btnRow = document.createElement('div'); btnRow.className = 'crm-m-btns';
    var bIn = document.createElement('button'); bIn.className = 'crm-vbtn on'; bIn.textContent = '+ Приход';
    bIn.addEventListener('click', function(){ openStockModal({ type:'Приход' }); });
    var bOut = document.createElement('button'); bOut.className = 'crm-vbtn'; bOut.textContent = '\u2212 Выдача';
    bOut.addEventListener('click', function(){ openStockModal({ type:'Расход' }); });
    btnRow.appendChild(bIn); btnRow.appendChild(bOut);
    wrap.appendChild(btnRow);
    view.appendChild(wrap);

    if(STOCK_SUBVIEW === 'history'){ renderStockHistory(view); return; }

    var ld = document.createElement('div'); ld.className = 'crm-empty'; ld.textContent = 'Загружаю остатки...';
    view.appendChild(ld);
    fetchStock(function(err){
      if(err === '__no_key__'){ ld.textContent = 'Введи ключ доступа во вкладке заказов.'; return; }
      if(err){ ld.textContent = 'Остатки не загрузились: ' + err; return; }
      ld.style.display = 'none';
      var rows = STOCK.slice().filter(function(s){ return s && s.key; });
      rows.sort(function(a,b){ return String(a.name||a.key).localeCompare(String(b.name||b.key), 'ru'); });
      if(!rows.length){
        var e = document.createElement('div'); e.className = 'crm-empty';
        e.textContent = 'Склад пуст. Нажми «+ Приход», чтобы оприходовать материалы и фурнитуру.';
        view.appendChild(e); return;
      }
      var tbl = document.createElement('table'); tbl.className = 'crm-ftbl';
      var thead = document.createElement('tr');
      ['Наименование','Ключ','Ед','Остаток'].forEach(function(hh){ var th=document.createElement('th'); th.textContent=hh; thead.appendChild(th); });
      tbl.appendChild(thead);
      rows.forEach(function(s){
        var tr = document.createElement('tr');
        var c1 = document.createElement('td'); c1.textContent = String(s.name || s.key); tr.appendChild(c1);
        var c2 = document.createElement('td'); c2.textContent = String(s.key); c2.style.color = '#888'; tr.appendChild(c2);
        var c3 = document.createElement('td'); c3.textContent = String(s.unit || ''); tr.appendChild(c3);
        var c4 = document.createElement('td'); c4.textContent = String(Math.round(Number(s.qty) || 0));
        if((Number(s.qty) || 0) <= 0){ c4.style.color = '#BA1B1B'; c4.style.fontWeight = '600'; }
        tr.appendChild(c4);
        tbl.appendChild(tr);
      });
      view.appendChild(tbl);
    });
  }

  // История движений (read-only): дата | тип | наименование | ключ | ед | кол-во | № заказа.
  // Сортировка по дате — свежие сверху.
  function renderStockHistory(view){
    var ld = document.createElement('div'); ld.className = 'crm-empty'; ld.textContent = 'Загружаю историю...';
    view.appendChild(ld);
    fetchStockMoves(function(err){
      if(err === '__no_key__'){ ld.textContent = 'Введи ключ доступа во вкладке заказов.'; return; }
      if(err){ ld.textContent = 'История не загрузилась: ' + err; return; }
      ld.style.display = 'none';
      var rows = STOCK_MOVES.slice().filter(function(m){ return m && m.key; });
      rows.sort(function(a,b){ return new Date(b.date) - new Date(a.date); });
      if(!rows.length){
        var e = document.createElement('div'); e.className = 'crm-empty';
        e.textContent = 'Движений пока нет.';
        view.appendChild(e); return;
      }
      var tbl = document.createElement('table'); tbl.className = 'crm-ftbl';
      var thead = document.createElement('tr');
      ['Дата','Тип','Наименование','Ключ','Ед','Кол-во','\u2116 заказа'].forEach(function(hh){ var th=document.createElement('th'); th.textContent=hh; thead.appendChild(th); });
      tbl.appendChild(thead);
      rows.forEach(function(m){
        var tr = document.createElement('tr');
        var c1 = document.createElement('td'); c1.textContent = fmtDate(m.date); tr.appendChild(c1);
        var c2 = document.createElement('td'); c2.textContent = String(m.type || '');
        c2.style.color = m.type === 'Расход' ? '#BA1B1B' : '#1a5252';
        tr.appendChild(c2);
        var c3 = document.createElement('td'); c3.textContent = String(m.name || m.key); tr.appendChild(c3);
        var c4 = document.createElement('td'); c4.textContent = String(m.key); c4.style.color = '#888'; tr.appendChild(c4);
        var c5 = document.createElement('td'); c5.textContent = String(m.unit || ''); tr.appendChild(c5);
        var c6 = document.createElement('td'); c6.textContent = String(Math.round(Number(m.qty) || 0)); tr.appendChild(c6);
        var c7 = document.createElement('td'); c7.textContent = String(m.num || ''); tr.appendChild(c7);
        tbl.appendChild(tr);
      });
      view.appendChild(tbl);
    });
  }

  // Список ключей для автоподстановки в приходе: артикулы из прайса
  // (фурнитура/кухня/шкаф) + имена материалов (ЛДСП/фасады) + уже
  // известные ключи склада. Возвращает {options:[{key,name,unit}], map}.
  function stockKeyList(){
    var opts = [];
    var map = {};
    var add = function(key, name, unit){
      key = String(key || '').trim();
      if(!key) return;
      if(map[key]) return;
      map[key] = { name: String(name || ''), unit: unit };
      opts.push({ key: key, name: String(name || ''), unit: unit });
    };
    if(typeof DB !== 'undefined' && DB){
      var joinN = function(row){
        var parts = [row.cat];
        if(row.vid && String(row.vid) !== '\u2014') parts.push(row.vid);
        if(row.firm && String(row.firm) !== '\u2014') parts.push(row.firm);
        return parts.join(' ');
      };
      ['furn','kuh','shk'].forEach(function(sec){
        var rows = DB[sec] || [];
        rows.forEach(function(row){ if(row && row.sku) add(row.sku, joinN(row), '\u0448\u0442'); });
      });
      var mats = (DB.ldsp || []).concat(DB.fas_plen || []).concat(DB.fas_kr || []);
      mats.forEach(function(row){ if(row && row.n) add(row.n, row.n, '\u043b\u0438\u0441\u0442'); });
    }
    var st = STOCK || [];
    st.forEach(function(s){ if(s && s.key) add(s.key, s.name || s.key, s.unit || '\u0448\u0442'); });
    opts.sort(function(a,b){ return String(a.name||a.key).localeCompare(String(b.name||b.key), 'ru'); });
    return { options: opts, map: map };
  }

  function openStockModal(pre){
    pre = pre || {};
    var bg = document.createElement('div'); bg.className = 'crm-modal-bg';
    bg.addEventListener('click', function(e){ if(e.target===bg) document.body.removeChild(bg); });
    var m = document.createElement('div'); m.className = 'crm-modal';
    var h = document.createElement('div'); h.className = 'crm-m-h';
    var title = document.createElement('b'); title.textContent = 'Движение по складу';
    var x = document.createElement('button'); x.className = 'crm-m-x'; x.textContent = '\u00D7';
    x.addEventListener('click', function(){ document.body.removeChild(bg); });
    h.appendChild(title); h.appendChild(x);
    var b = document.createElement('div'); b.className = 'crm-m-b';

    var selType = document.createElement('select');
    ['Приход','Расход'].forEach(function(t){ var op=document.createElement('option'); op.value=t; op.textContent=t; selType.appendChild(op); });
    selType.value = pre.type || 'Приход';
    var selUnit = document.createElement('select');
    [['шт','шт (штуки)'],['лист','лист (ЛДСП/фасады)']].forEach(function(u){ var op=document.createElement('option'); op.value=u[0]; op.textContent=u[1]; selUnit.appendChild(op); });
    selUnit.value = pre.unit || 'шт';

    var iKey = inp(pre.key || ''); iKey.placeholder = 'SKU или имя материала';
    var iName = inp(pre.name || ''); iName.placeholder = 'Наименование (для чека)';
    var keyData = stockKeyList();
    var dlK = document.createElement('datalist'); dlK.id = 'crm-stock-keys';
    keyData.options.forEach(function(op){ var oo=document.createElement('option'); oo.value=op.key; oo.textContent=op.name + ' · ' + op.unit; dlK.appendChild(oo); });
    b.appendChild(dlK);
    iKey.setAttribute('list', 'crm-stock-keys');
    var nameEdited = false;
    iName.addEventListener('input', function(){ nameEdited = true; });
    iKey.addEventListener('input', function(){
      var hit = keyData.map[iKey.value.trim()];
      if(hit){ if(!nameEdited) iName.value = hit.name; selUnit.value = hit.unit; }
    });
    var iQty = inp('', 'number'); iQty.placeholder = '0'; iQty.setAttribute('step','1'); iQty.setAttribute('min','1');
    var iNum = inp(pre.num || ''); iNum.placeholder = '\u2116 заказа (не обязательно)';
    var iCmt = inp(''); iCmt.placeholder = 'Комментарий';

    var r1 = document.createElement('div'); r1.className = 'crm-2col';
    r1.appendChild(field('Тип', selType)); r1.appendChild(field('Единица', selUnit));
    b.appendChild(r1);
    b.appendChild(field('Ключ (SKU / материал)', iKey));
    b.appendChild(field('Наименование', iName));
    var r2 = document.createElement('div'); r2.className = 'crm-2col';
    r2.appendChild(field('Кол-во (целое)', iQty)); r2.appendChild(field('\u2116 заказа', iNum));
    b.appendChild(r2);
    b.appendChild(field('Комментарий', iCmt));
    var hint = document.createElement('div'); hint.className = 'crm-empty';
    hint.style.textAlign = 'left'; hint.style.fontSize = '11px'; hint.style.padding = '4px 0';
    hint.textContent = 'Кол-во только целое. Листы вводи целыми — обрезки склад не считает.';
    b.appendChild(hint);

    var btns = document.createElement('div'); btns.className = 'crm-m-btns';
    var bSave = document.createElement('button'); bSave.className = 'crm-m-btn save'; bSave.textContent = 'Записать';
    bSave.addEventListener('click', function(){
      var key = iKey.value.trim();
      if(!key){ toast('\u26A0\uFE0F Укажи ключ (SKU или материал)', '#BA7517'); return; }
      var qn = Number(iQty.value);
      if(!(qn > 0)){ toast('\u26A0\uFE0F Кол-во должно быть больше нуля', '#BA7517'); return; }
      if(Math.round(qn) !== qn){ toast('\u26A0\uFE0F Кол-во должно быть целым', '#BA7517'); return; }
      bSave.disabled = true; bSave.textContent = 'Записываю...';
      var mv = { type: selType.value, key: key, name: iName.value.trim(), unit: selUnit.value, qty: Math.round(qn), num: iNum.value.trim(), comment: iCmt.value.trim() };
      post({ action:'stockMove', stock:{ moves:[ mv ] } }, function(){
        document.body.removeChild(bg);
        if(VIEW==='stock') renderAll();
        toast('OK ' + mv.type + ' ' + mv.qty + ' ' + mv.unit + ' (' + (mv.name || mv.key) + ')', '#1a5252');
      }, function(err){
        bSave.disabled = false; bSave.textContent = 'Записать';
        toast('\u26A0\uFE0F Не записалось: ' + err, '#BA7517');
      });
    });
    btns.appendChild(bSave);
    b.appendChild(btns);
    m.appendChild(h); m.appendChild(b);
    bg.appendChild(m);
    document.body.appendChild(bg);
    setTimeout(function(){ try{ iKey.focus(); }catch(e){} }, 50);
  }

  function renderFin(view){
    // Переключатель подвкладок
    var tabRow = document.createElement('div'); tabRow.className = 'crm-m-btns'; tabRow.style.marginBottom = '4px';
    var subs = [['kassa','Касса'],['pay','Зарплаты'],['recur','Постоянные'],['sales','Продажи']];
    subs.forEach(function(s){
      var b = document.createElement('button');
      b.className = 'crm-vbtn' + (FIN_SUB===s[0] ? ' on' : '');
      b.textContent = s[1];
      b.addEventListener('click', function(){ FIN_SUB = s[0]; renderAll(); });
      tabRow.appendChild(b);
    });
    view.appendChild(tabRow);

    if(FIN_SUB === 'kassa')      renderSubKassa(view);
    else if(FIN_SUB === 'pay')   renderSubPay(view);
    else if(FIN_SUB === 'recur') renderSubRecur(view);
    else if(FIN_SUB === 'sales') renderSubSales(view);
  }

  // ── Подвкладка КАССА: месячный P&L + текущая касса ──────────
  function renderSubKassa(view){
    if(!FIN_LOADED){
      var ld = document.createElement('div'); ld.className='crm-empty';
      ld.textContent = 'Загружаю операции...';
      view.appendChild(ld);
      fetchFin(function(err){
        if(err === '__no_key__'){ ld.textContent = 'Введи ключ доступа во вкладке заказов.'; return; }
        if(err){ ld.textContent = 'Операции не загрузились: ' + err; return; }
        renderView();
      });
      return;
    }
    renderMonthPnl(view);
    renderKassa(view);
  }

  // Переключатель месяца для подвкладок Касса/Зарплаты — общий FIN_MONTH.
  function renderMonthNav(view){
    var curKey = monthKey(new Date());
    var row = document.createElement('div'); row.className = 'crm-m-btns';
    row.style.alignItems = 'center'; row.style.marginBottom = '6px';
    var bPrev = document.createElement('button'); bPrev.className='crm-vbtn'; bPrev.style.padding='3px 10px';
    bPrev.textContent = '\u2039';
    bPrev.addEventListener('click', function(){ FIN_MONTH = shiftMonthKey(FIN_MONTH, -1); renderAll(); });
    var lbl = document.createElement('span'); lbl.style.fontSize='12px'; lbl.style.fontWeight='700'; lbl.style.padding='0 8px';
    lbl.textContent = monthLabel(FIN_MONTH);
    var bNext = document.createElement('button'); bNext.className='crm-vbtn'; bNext.style.padding='3px 10px';
    bNext.textContent = '\u203a';
    if(FIN_MONTH >= curKey) bNext.disabled = true;
    bNext.addEventListener('click', function(){ if(FIN_MONTH < curKey){ FIN_MONTH = shiftMonthKey(FIN_MONTH, 1); renderAll(); } });
    row.appendChild(bPrev); row.appendChild(lbl); row.appendChild(bNext);
    if(FIN_MONTH !== curKey){
      var bNow = document.createElement('button'); bNow.className='crm-vbtn'; bNow.style.padding='3px 8px'; bNow.style.marginLeft='6px';
      bNow.textContent = 'Сегодня';
      bNow.addEventListener('click', function(){ FIN_MONTH = curKey; renderAll(); });
      row.appendChild(bNow);
    }
    view.appendChild(row);
  }

  // Месячный P&L: за выбранный месяц приход − расход = чистый доход.
  function renderMonthPnl(view){
    renderMonthNav(view);
    var inc = 0, exp = 0;
    FIN.forEach(function(f){
      if(monthKey(f.date) !== FIN_MONTH) return;
      if(f.type === 'Приход') inc += Number(f.sum)||0; else exp += Number(f.sum)||0;
    });
    var net = inc - exp;
    var t0 = document.createElement('div'); t0.className='crm-sec-t';
    t0.textContent = 'Итог месяца';
    view.appendChild(t0);
    var sum = document.createElement('div'); sum.className='crm-sum';
    function tile(v, k, cls){
      var t = document.createElement('div'); t.className='crm-sum-t';
      var ve = document.createElement('div'); ve.className='v'+(cls?(' '+cls):''); ve.textContent=v;
      var ke = document.createElement('div'); ke.className='k'; ke.textContent=k;
      t.appendChild(ve); t.appendChild(ke); sum.appendChild(t);
    }
    tile('+' + fm0(inc), 'приход за месяц');
    tile('\u2212' + fm0(exp), 'расход за месяц', 'warn');
    tile((net>=0?'+':'\u2212') + fm0(Math.abs(net)), 'чистый доход месяца', net<0 ? 'warn' : '');
    view.appendChild(sum);
    var note = document.createElement('div'); note.className='crm-fin-note';
    note.textContent = 'Расход за месяц включает постоянные (аренда, оклады), если они начислены во вкладке «Постоянные». Начисляй в начале каждого месяца.';
    view.appendChild(note);
  }

  // ── Подвкладка ПРОДАЖИ: воронка + договоры + изменения ─────
  function renderSubSales(view){
    if(!LOADED){
      var ld = document.createElement('div'); ld.className='crm-empty';
      ld.textContent = 'Загружаю заказы...';
      view.appendChild(ld);
      return;
    }
    renderFunnel(view);
    renderSales(view);
    renderChangesAgg(view);
  }

  // ── Подвкладка ПОСТОЯННЫЕ: шаблоны расходов + начисление ────
  function renderSubRecur(view){
    if(!RECUR_LOADED){
      var ld = document.createElement('div'); ld.className='crm-empty';
      ld.textContent = 'Загружаю постоянные...';
      view.appendChild(ld);
      fetchRecur(function(err){
        if(err === '__no_key__'){ ld.textContent = 'Введи ключ доступа во вкладке заказов.'; return; }
        if(err){ ld.textContent = 'Постоянные не загрузились: ' + err; return; }
        renderView();
      });
      return;
    }
    var t0 = document.createElement('div'); t0.className='crm-sec-t';
    t0.textContent = 'Постоянные расходы (кроме окладов)';
    view.appendChild(t0);

    var hint = document.createElement('div'); hint.className='crm-fin-note';
    hint.textContent = 'Аренда офиса, цеха, реклама и т.п. Оклады сотрудников веди во вкладке «Зарплаты» — они начисляются оттуда. Кнопка «Начислить за месяц» создаёт реальные расходы в кассе за выбранный месяц (повторно тот же месяц не задваивается).';
    view.appendChild(hint);

    var btnRow = document.createElement('div'); btnRow.className='crm-m-btns';
    var addB = document.createElement('button'); addB.className='crm-vbtn new'; addB.textContent='+ Постоянный расход';
    addB.addEventListener('click', function(){ openRecurModal({}); });
    btnRow.appendChild(addB);
    view.appendChild(btnRow);

    var active = RECUR.filter(function(x){ return x.active; });
    var totMonth = 0;
    active.forEach(function(x){ totMonth += Number(x.sum)||0; });

    if(!RECUR.length){
      var e = document.createElement('div'); e.className='crm-empty';
      e.textContent = 'Постоянных расходов пока нет. Добавь аренду офиса, цеха и т.п.';
      view.appendChild(e);
    } else {
      var tbl = document.createElement('table'); tbl.className='crm-ftbl';
      var thead = document.createElement('tr');
      ['Название','Категория','Сумма/мес','',''].forEach(function(t){ var th=document.createElement('th'); th.textContent=t; thead.appendChild(th); });
      tbl.appendChild(thead);
      RECUR.forEach(function(x){
        var tr = document.createElement('tr');
        if(!x.active) tr.style.opacity = '0.5';
        var c1 = document.createElement('td'); c1.textContent = x.name; tr.appendChild(c1);
        var c2 = document.createElement('td'); c2.textContent = x.cat || '\u2014'; tr.appendChild(c2);
        var c3 = document.createElement('td'); c3.textContent = fm0(x.sum) + (x.active ? '' : ' (выкл.)'); tr.appendChild(c3);
        var c4 = document.createElement('td');
        var ed = document.createElement('button'); ed.className='crm-vbtn'; ed.style.padding='3px 8px'; ed.textContent='\u270E';
        ed.addEventListener('click', function(){ openRecurModal(x); });
        c4.appendChild(ed); tr.appendChild(c4);
        var c5 = document.createElement('td');
        var dl = document.createElement('button'); dl.className='crm-vbtn'; dl.style.padding='3px 8px'; dl.textContent='\u2715';
        dl.addEventListener('click', function(){
          if(!confirm('Удалить постоянный расход «'+x.name+'»? Уже начисленные проводки в кассе останутся.')) return;
          post({ action:'delRecur', id:x.id }, function(){
            RECUR = RECUR.filter(function(y){ return y.id !== x.id; });
            renderAll(); toast('OK Удалено', '#1a5252');
          }, function(err){ toast('\u26A0\uFE0F Не удалилось: '+err, '#BA7517'); });
        });
        c5.appendChild(dl); tr.appendChild(c5);
        tbl.appendChild(tr);
      });
      view.appendChild(tbl);

      var st = document.createElement('div'); st.className='crm-sum'; st.style.marginTop='10px';
      var t = document.createElement('div'); t.className='crm-sum-t';
      var ve = document.createElement('div'); ve.className='v'; ve.textContent = fm0(totMonth);
      var ke = document.createElement('div'); ke.className='k'; ke.textContent = 'постоянных/мес (без окладов)';
      t.appendChild(ve); t.appendChild(ke); st.appendChild(t);
      view.appendChild(st);
    }

    renderAccrueBox(view);
  }

  // Блок начисления за месяц (общий для Постоянных и Зарплат)
  function renderAccrueBox(view){
    var t0 = document.createElement('div'); t0.className='crm-sec-t';
    t0.textContent = 'Начислить за месяц';
    view.appendChild(t0);
    var wrap = document.createElement('div'); wrap.className='crm-m-btns';
    var now = new Date();
    var iM = document.createElement('input'); iM.type='month';
    iM.value = now.getFullYear() + '-' + ('0'+(now.getMonth()+1)).slice(-2);
    iM.style.cssText = 'font-size:12px;border:1px solid #ddd;border-radius:8px;padding:7px 10px';
    var bAcc = document.createElement('button'); bAcc.className='crm-vbtn new'; bAcc.textContent='Начислить постоянные и оклады';
    bAcc.addEventListener('click', function(){
      var m = iM.value;
      if(!m){ toast('\u26A0\uFE0F Выбери месяц', '#BA7517'); return; }
      if(!confirm('Начислить постоянные расходы и оклады за '+m+'? Проводки уйдут в кассу. Повторно тот же месяц не задвоится.')) return;
      bAcc.disabled = true; bAcc.textContent = 'Начисляю...';
      post({ action:'accrueMonth', month:m }, function(res){
        bAcc.disabled = false; bAcc.textContent = 'Начислить постоянные и оклады';
        FIN_LOADED = false; // касса изменилась — перечитать
        var msg = 'Начислено: ' + (res && res.created || 0);
        if(res && res.skipped) msg += ', пропущено (уже было): ' + res.skipped;
        toast('OK ' + msg, '#1a5252');
        renderAll();
      }, function(err){
        bAcc.disabled = false; bAcc.textContent = 'Начислить постоянные и оклады';
        toast('\u26A0\uFE0F Не начислилось: '+err, '#BA7517');
      });
    });
    wrap.appendChild(iM); wrap.appendChild(bAcc);
    view.appendChild(wrap);
  }

  function openRecurModal(pre){
    pre = pre || {};
    var bg = document.createElement('div'); bg.className='crm-modal-bg';
    bg.addEventListener('click', function(e){ if(e.target===bg) document.body.removeChild(bg); });
    var m = document.createElement('div'); m.className='crm-modal';
    var h = document.createElement('div'); h.className='crm-m-h';
    var title = document.createElement('b'); title.textContent = pre.id ? 'Постоянный расход' : 'Новый постоянный расход';
    var x = document.createElement('button'); x.className='crm-m-x'; x.textContent='\u00D7';
    x.addEventListener('click', function(){ document.body.removeChild(bg); });
    h.appendChild(title); h.appendChild(x);
    var b = document.createElement('div'); b.className='crm-m-b';

    var iName = inp(pre.name || ''); iName.placeholder = 'Аренда офиса';
    var selCat = document.createElement('select');
    RECUR_CAT.forEach(function(c){ var op=document.createElement('option'); op.value=c; op.textContent=c; selCat.appendChild(op); });
    selCat.value = pre.cat || 'Аренда';
    var iSum = inp(pre.sum || '', 'number'); iSum.placeholder = '0';
    var selAct = document.createElement('select');
    [['да','Активна (начисляется)'],['нет','Выключена']].forEach(function(u){ var op=document.createElement('option'); op.value=u[0]; op.textContent=u[1]; selAct.appendChild(op); });
    selAct.value = (pre.active === false) ? 'нет' : 'да';

    b.appendChild(field('Название', iName));
    var r1 = document.createElement('div'); r1.className='crm-2col';
    r1.appendChild(field('Категория', selCat)); r1.appendChild(field('Сумма/мес, \u20B8', iSum));
    b.appendChild(r1);
    b.appendChild(field('Состояние', selAct));

    var btns = document.createElement('div'); btns.className='crm-m-btns';
    var bSave = document.createElement('button'); bSave.className='crm-m-btn save'; bSave.textContent='Сохранить';
    bSave.addEventListener('click', function(){
      var name = iName.value.trim();
      if(!name){ toast('\u26A0\uFE0F Укажи название', '#BA7517'); return; }
      var sum = Math.round(parseFloat(iSum.value)||0);
      if(!(sum > 0)){ toast('\u26A0\uFE0F Сумма больше нуля', '#BA7517'); return; }
      bSave.disabled = true; bSave.textContent = 'Сохраняю...';
      var rec = { id: pre.id || '', name: name, cat: selCat.value, sum: sum, active: selAct.value !== 'нет' };
      post({ action:'saveRecur', recur: rec }, function(res){
        RECUR_LOADED = false;
        document.body.removeChild(bg);
        renderAll();
        toast('OK Сохранено', '#1a5252');
      }, function(err){
        bSave.disabled = false; bSave.textContent = 'Сохранить';
        toast('\u26A0\uFE0F Не сохранилось: '+err, '#BA7517');
      });
    });
    btns.appendChild(bSave);
    b.appendChild(btns);
    m.appendChild(h); m.appendChild(b);
    bg.appendChild(m);
    document.body.appendChild(bg);
    setTimeout(function(){ try{ iName.focus(); }catch(e){} }, 50);
  }

  // ── Подвкладка ЗАРПЛАТЫ: оклад + процент с заказов ──────────
  function renderSubPay(view){
    if(!EMP_LOADED){
      var ld = document.createElement('div'); ld.className='crm-empty';
      ld.textContent = 'Загружаю сотрудников...';
      view.appendChild(ld);
      fetchEmp(function(err){
        if(err === '__no_key__'){ ld.textContent = 'Введи ключ доступа во вкладке заказов.'; return; }
        if(err){ ld.textContent = 'Сотрудники не загрузились: ' + err; return; }
        renderView();
      });
      return;
    }
    // Заработок с заказов за выбранный месяц (по дате договора)
    var earnMasterM = 0, earnDesignerM = 0;
    if(LOADED){
      ORDERS.forEach(function(o){
        if(monthKey(o.dogDate) !== FIN_MONTH) return;
        earnMasterM += Number(o.earnMaster)||0;
        earnDesignerM += Number(o.earnDesigner)||0;
      });
    }

    renderMonthNav(view);

    var t0 = document.createElement('div'); t0.className='crm-sec-t';
    t0.textContent = 'Сотрудники — оклад';
    view.appendChild(t0);

    var hint = document.createElement('div'); hint.className='crm-fin-note';
    hint.textContent = 'Оклад — фиксированная часть (как аренда), начисляется во вкладке «Постоянные» кнопкой «Начислить за месяц». Процент — то, что человек заработал с заказов выбранного месяца (по дате договора). Итого к выплате = оклад + процент.';
    view.appendChild(hint);

    var btnRow = document.createElement('div'); btnRow.className='crm-m-btns';
    var addB = document.createElement('button'); addB.className='crm-vbtn new'; addB.textContent='+ Сотрудник';
    addB.addEventListener('click', function(){ openEmpModal({}); });
    btnRow.appendChild(addB);
    view.appendChild(btnRow);

    var masters = EMP.filter(function(e){ return e.role === 'Мастер'; });
    var designers = EMP.filter(function(e){ return e.role === 'Дизайнер'; });
    var nMasters = masters.filter(function(e){ return e.active; }).length || masters.length;
    var nDesigners = designers.filter(function(e){ return e.active; }).length || designers.length;

    if(!EMP.length){
      var e = document.createElement('div'); e.className='crm-empty';
      e.textContent = 'Сотрудников пока нет. Добавь мастеров и дизайнеров с окладом.';
      view.appendChild(e);
    } else {
      var tbl = document.createElement('table'); tbl.className='crm-ftbl';
      var thead = document.createElement('tr');
      ['Имя','Роль','Оклад','Процент/мес','К выплате','',''].forEach(function(t){ var th=document.createElement('th'); th.textContent=t; thead.appendChild(th); });
      tbl.appendChild(thead);
      EMP.forEach(function(emp){
        var tr = document.createElement('tr');
        if(!emp.active) tr.style.opacity = '0.5';
        // Процент делим поровну между активными сотрудниками той же роли
        var pool = emp.role === 'Дизайнер' ? earnDesignerM : earnMasterM;
        var cnt = emp.role === 'Дизайнер' ? nDesigners : nMasters;
        var share = (emp.active && cnt > 0) ? Math.round(pool / cnt) : 0;
        var payout = (Number(emp.salary)||0) + share;
        var c1 = document.createElement('td'); c1.textContent = emp.name; tr.appendChild(c1);
        var c2 = document.createElement('td'); c2.textContent = emp.role; tr.appendChild(c2);
        var c3 = document.createElement('td'); c3.textContent = fm0(emp.salary); tr.appendChild(c3);
        var c4 = document.createElement('td'); c4.textContent = share ? fm0(share) : '\u2014'; tr.appendChild(c4);
        var c5 = document.createElement('td'); c5.textContent = fm0(payout); c5.className='crm-margin'; tr.appendChild(c5);
        var c6 = document.createElement('td');
        var ed = document.createElement('button'); ed.className='crm-vbtn'; ed.style.padding='3px 8px'; ed.textContent='\u270E';
        ed.addEventListener('click', function(){ openEmpModal(emp); });
        c6.appendChild(ed); tr.appendChild(c6);
        var c7 = document.createElement('td');
        var dl = document.createElement('button'); dl.className='crm-vbtn'; dl.style.padding='3px 8px'; dl.textContent='\u2715';
        dl.addEventListener('click', function(){
          if(!confirm('Удалить сотрудника «'+emp.name+'»? Уже начисленные оклады в кассе останутся.')) return;
          post({ action:'delEmp', id:emp.id }, function(){
            EMP = EMP.filter(function(y){ return y.id !== emp.id; });
            renderAll(); toast('OK Удалено', '#1a5252');
          }, function(err){ toast('\u26A0\uFE0F Не удалилось: '+err, '#BA7517'); });
        });
        c7.appendChild(dl); tr.appendChild(c7);
        tbl.appendChild(tr);
      });
      view.appendChild(tbl);

      // Итоги месяца по зарплатам
      var salT = 0;
      EMP.forEach(function(e){ if(e.active) salT += Number(e.salary)||0; });
      var sum = document.createElement('div'); sum.className='crm-sum'; sum.style.marginTop='10px';
      function tile(v, k){
        var t = document.createElement('div'); t.className='crm-sum-t';
        var ve = document.createElement('div'); ve.className='v'; ve.textContent=v;
        var ke = document.createElement('div'); ke.className='k'; ke.textContent=k;
        t.appendChild(ve); t.appendChild(ke); sum.appendChild(t);
      }
      tile(fm0(salT), 'окладов/мес всего');
      tile(fm0(earnMasterM), 'заработок мастеров (мес)');
      tile(fm0(earnDesignerM), 'заработок дизайнеров (мес)');
      tile(fm0(salT + earnMasterM + earnDesignerM), 'фонд оплаты за месяц');
      view.appendChild(sum);

      if(!LOADED){
        var wn = document.createElement('div'); wn.className='crm-fin-note';
        wn.textContent = 'Заказы ещё грузятся — процент появится, когда подгрузятся данные по договорам месяца.';
        view.appendChild(wn);
      }
    }
  }

  function openEmpModal(pre){
    pre = pre || {};
    var bg = document.createElement('div'); bg.className='crm-modal-bg';
    bg.addEventListener('click', function(e){ if(e.target===bg) document.body.removeChild(bg); });
    var m = document.createElement('div'); m.className='crm-modal';
    var h = document.createElement('div'); h.className='crm-m-h';
    var title = document.createElement('b'); title.textContent = pre.id ? 'Сотрудник' : 'Новый сотрудник';
    var x = document.createElement('button'); x.className='crm-m-x'; x.textContent='\u00D7';
    x.addEventListener('click', function(){ document.body.removeChild(bg); });
    h.appendChild(title); h.appendChild(x);
    var b = document.createElement('div'); b.className='crm-m-b';

    var iName = inp(pre.name || ''); iName.placeholder = 'Имя';
    var selRole = document.createElement('select');
    ['Мастер','Дизайнер'].forEach(function(c){ var op=document.createElement('option'); op.value=c; op.textContent=c; selRole.appendChild(op); });
    selRole.value = pre.role || 'Мастер';
    var iSal = inp(pre.salary || '', 'number'); iSal.placeholder = '0';
    var selAct = document.createElement('select');
    [['да','Активен'],['нет','Уволен/пауза']].forEach(function(u){ var op=document.createElement('option'); op.value=u[0]; op.textContent=u[1]; selAct.appendChild(op); });
    selAct.value = (pre.active === false) ? 'нет' : 'да';

    b.appendChild(field('Имя', iName));
    var r1 = document.createElement('div'); r1.className='crm-2col';
    r1.appendChild(field('Роль', selRole)); r1.appendChild(field('Оклад/мес, \u20B8', iSal));
    b.appendChild(r1);
    b.appendChild(field('Состояние', selAct));

    var btns = document.createElement('div'); btns.className='crm-m-btns';
    var bSave = document.createElement('button'); bSave.className='crm-m-btn save'; bSave.textContent='Сохранить';
    bSave.addEventListener('click', function(){
      var name = iName.value.trim();
      if(!name){ toast('\u26A0\uFE0F Укажи имя', '#BA7517'); return; }
      var sal = Math.round(parseFloat(iSal.value)||0);
      if(sal < 0){ toast('\u26A0\uFE0F Оклад не может быть отрицательным', '#BA7517'); return; }
      bSave.disabled = true; bSave.textContent = 'Сохраняю...';
      var emp = { id: pre.id || '', name: name, role: selRole.value, salary: sal, active: selAct.value !== 'нет' };
      post({ action:'saveEmp', emp: emp }, function(res){
        EMP_LOADED = false;
        document.body.removeChild(bg);
        renderAll();
        toast('OK Сохранено', '#1a5252');
      }, function(err){
        bSave.disabled = false; bSave.textContent = 'Сохранить';
        toast('\u26A0\uFE0F Не сохранилось: '+err, '#BA7517');
      });
    });
    btns.appendChild(bSave);
    b.appendChild(btns);
    m.appendChild(h); m.appendChild(b);
    bg.appendChild(m);
    document.body.appendChild(bg);
    setTimeout(function(){ try{ iName.focus(); }catch(e){} }, 50);
  }

  // Агрегат Изменений к договору (доп. соглашения) по всем заказам.
  // Плюс — добавили объём (цена вверх), минус — убрали/скидка (цена вниз).
  // Показываем суммарный сдвиг цены и разбивку по месяцам.
  function renderChangesAgg(view){
    var t0 = document.createElement('div'); t0.className='crm-sec-t';
    t0.textContent = 'Изменения к договорам';
    view.appendChild(t0);
    if(!CH_LOADED){
      var ld = document.createElement('div'); ld.className='crm-empty';
      ld.textContent = 'Загружаю изменения...';
      view.appendChild(ld);
      fetchChanges(function(err){
        if(err === '__no_key__'){ ld.textContent = 'Введи ключ доступа во вкладке заказов.'; return; }
        if(err){ ld.textContent = 'Изменения не загрузились: ' + err; return; }
        renderView();
      });
      return;
    }
    if(!CH.length){
      var e = document.createElement('div'); e.className='crm-empty';
      e.textContent = 'Доп. соглашений пока нет. Изменения после договора добавляются в карточке заказа (± Изменение).';
      view.appendChild(e);
      return;
    }
    var plus = 0, minus = 0, net = 0;
    CH.forEach(function(c){
      var s = Number(c.sum)||0;
      net += s;
      if(s >= 0) plus += s; else minus += s;
    });

    var sum = document.createElement('div'); sum.className='crm-sum';
    function tile(v, k, warn){
      var t = document.createElement('div'); t.className='crm-sum-t';
      var ve = document.createElement('div'); ve.className='v'+(warn?' warn':''); ve.textContent=v;
      var ke = document.createElement('div'); ke.className='k'; ke.textContent=k;
      t.appendChild(ve); t.appendChild(ke); sum.appendChild(t);
    }
    tile('+' + fm0(plus), 'добавлено (цена вверх)');
    tile('\u2212' + fm0(Math.abs(minus)), 'убрано (цена вниз)', minus < 0);
    tile((net >= 0 ? '+' : '\u2212') + fm0(Math.abs(net)), 'итоговый сдвиг цены', net < 0);
    tile(String(CH.length), 'всего изменений');
    view.appendChild(sum);

    // помесячно по дате изменения
    var byM = {};
    CH.forEach(function(c){
      var k = monthKey(c.date); if(!k) return;
      if(!byM[k]) byM[k] = { plus:0, minus:0, count:0 };
      var s = Number(c.sum)||0;
      if(s >= 0) byM[k].plus += s; else byM[k].minus += s;
      byM[k].count += 1;
    });
    var keys = Object.keys(byM).sort().reverse();
    if(keys.length){
      var tbl = document.createElement('table'); tbl.className='crm-ftbl';
      var thead = document.createElement('tr');
      ['Месяц','Изменений','Добавлено','Убрано','Итог'].forEach(function(t){
        var th = document.createElement('th'); th.textContent = t; thead.appendChild(th);
      });
      tbl.appendChild(thead);
      keys.forEach(function(k){
        var m = byM[k];
        var mnet = m.plus + m.minus;
        var tr = document.createElement('tr');
        function td(t, cls){ var c = document.createElement('td'); c.textContent = t; if(cls) c.className = cls; tr.appendChild(c); }
        td(monthLabel(k));
        td(String(m.count));
        td(m.plus ? '+' + fm0(m.plus) : '\u2014');
        td(m.minus ? '\u2212' + fm0(Math.abs(m.minus)) : '\u2014', m.minus ? 'debt' : '');
        td((mnet >= 0 ? '+' : '\u2212') + fm0(Math.abs(mnet)), mnet < 0 ? 'debt' : '');
        tbl.appendChild(tr);
      });
      view.appendChild(tbl);
    }

    var note = document.createElement('div'); note.className='crm-fin-note';
    note.textContent = 'Изменения сдвигают согласованную цену и долг заказа. На движение денег (кассу) они не влияют — это изменение обязательства, а не оплата.';
    view.appendChild(note);
  }

  function renderKassa(view){
    var inc = 0, exp = 0;
    FIN.forEach(function(f){
      if(f.type === 'Приход') inc += f.sum; else exp += f.sum;
    });
    var t0 = document.createElement('div'); t0.className='crm-sec-t';
    t0.textContent = 'Касса — фактические деньги';
    view.appendChild(t0);
    var sum = document.createElement('div'); sum.className='crm-sum';
    function tile(v, k, warn){
      var t = document.createElement('div'); t.className='crm-sum-t';
      var ve = document.createElement('div'); ve.className='v'+(warn?' warn':''); ve.textContent=v;
      var ke = document.createElement('div'); ke.className='k'; ke.textContent=k;
      t.appendChild(ve); t.appendChild(ke); sum.appendChild(t);
    }
    tile(fm0(inc), 'приход, всего');
    tile(fm0(exp), 'расход, всего', exp > inc);
    tile(fm0(inc - exp), 'итог (приход − расход)', inc - exp < 0);
    view.appendChild(sum);

    // график приход/расход по месяцам
    var byM = {};
    FIN.forEach(function(f){
      var k = monthKey(f.date); if(!k) return;
      if(!byM[k]) byM[k] = { inc:0, exp:0 };
      if(f.type === 'Приход') byM[k].inc += f.sum; else byM[k].exp += f.sum;
    });
    var keys = Object.keys(byM).sort();
    if(keys.length){
      var allKeys = [];
      var p0 = keys[0].split('-');
      var d0 = new Date(+p0[0], +p0[1]-1, 1);
      var dNow = new Date();
      while(d0.getTime() <= dNow.getTime()){ allKeys.push(monthKey(d0)); d0.setMonth(d0.getMonth()+1); }
      if(allKeys.length > 12) allKeys = allKeys.slice(-12);
      var maxV = 1;
      allKeys.forEach(function(k){ var m = byM[k]; if(m){ if(m.inc > maxV) maxV = m.inc; if(m.exp > maxV) maxV = m.exp; } });
      var ch = document.createElement('div'); ch.className='crm-chart';
      var ct = document.createElement('div'); ct.className='crm-chart-t';
      ct.textContent = 'Приход и расход по месяцам';
      ch.appendChild(ct);
      var bars = document.createElement('div'); bars.className='crm-bars';
      allKeys.forEach(function(k){
        var m = byM[k] || { inc:0, exp:0 };
        var g = document.createElement('div'); g.className='crm-bgrp';
        var pair = document.createElement('div'); pair.className='crm-bpair';
        var b1 = document.createElement('div'); b1.className='crm-bar fin-in';
        b1.style.height = Math.round(m.inc / maxV * 110) + 'px';
        b1.title = monthLabel(k) + ': приход ' + fm0(m.inc);
        var b2 = document.createElement('div'); b2.className='crm-bar fin-out';
        b2.style.height = Math.round(m.exp / maxV * 110) + 'px';
        b2.title = monthLabel(k) + ': расход ' + fm0(m.exp);
        pair.appendChild(b1); pair.appendChild(b2);
        var lx = document.createElement('div'); lx.className='crm-bx';
        var pk = k.split('-');
        lx.textContent = MONTH_SHORT[(+pk[1])-1] + ' ' + pk[0].slice(2);
        g.appendChild(pair); g.appendChild(lx);
        bars.appendChild(g);
      });
      ch.appendChild(bars);
      var leg = document.createElement('div'); leg.className='crm-legend';
      var l1 = document.createElement('span');
      var i1 = document.createElement('i'); i1.style.background='#0F6E56';
      l1.appendChild(i1); l1.appendChild(document.createTextNode('Приход'));
      var l2 = document.createElement('span');
      var i2 = document.createElement('i'); i2.style.background='#D85A30';
      l2.appendChild(i2); l2.appendChild(document.createTextNode('Расход'));
      leg.appendChild(l1); leg.appendChild(l2);
      ch.appendChild(leg);
      view.appendChild(ch);
    }

    // последние операции + кнопка добавления
    var ops = document.createElement('div'); ops.className='crm-ops';
    var oh = document.createElement('div'); oh.className='crm-ops-h';
    var ob = document.createElement('b'); ob.textContent = 'Операции' + (FIN.length ? ' (' + FIN.length + ')' : '');
    var addB = document.createElement('button'); addB.className='crm-vbtn new'; addB.textContent = '+ Операция';
    addB.style.marginLeft = 'auto';
    addB.addEventListener('click', function(){ openFinModal({}); });
    oh.appendChild(ob); oh.appendChild(addB);
    ops.appendChild(oh);
    if(!FIN.length){
      var em = document.createElement('div'); em.className='crm-empty';
      em.textContent = 'Операций пока нет. Аванс появится сам при формировании Договора, расходы добавляй кнопкой «+ Операция».';
      ops.appendChild(em);
    } else {
      var sorted = FIN.slice().sort(function(a,b){ return new Date(b.date||0).getTime() - new Date(a.date||0).getTime(); });
      sorted.slice(0, 15).forEach(function(f){
        var r = document.createElement('div'); r.className='crm-op';
        var dt = document.createElement('span'); dt.className='dt'; dt.textContent = fmtDate(f.date);
        var cat = document.createElement('span'); cat.className='cat';
        cat.textContent = f.cat + (f.num ? ' · №' + f.num : '');
        var cmt = document.createElement('span'); cmt.className='cmt'; cmt.textContent = f.comment || '';
        var sm = document.createElement('span');
        sm.className = 'sm ' + (f.type === 'Приход' ? 'in' : 'out');
        sm.textContent = (f.type === 'Приход' ? '+' : '−') + fm0(f.sum);
        var del = document.createElement('button'); del.className='del'; del.textContent='✕';
        del.title = 'Удалить операцию';
        del.addEventListener('click', function(){
          var sure = confirm('Удалить операцию «' + f.cat + ' ' + fm0(f.sum) + '»?' + (f.cat==='Доплата'&&f.num ? ' Оплачено по заказу №'+f.num+' уменьшится.' : ''));
          if(!sure) return;
          post({ action:'delFin', id: f.id }, function(){
            FIN = FIN.filter(function(x){ return x.id !== f.id; });
            if(f.type==='Приход' && f.cat==='Доплата' && f.num){
              for(var i=0;i<ORDERS.length;i++){ if(String(ORDERS[i].num)===String(f.num)){ ORDERS[i].paid = Math.max(0,(Number(ORDERS[i].paid)||0) - f.sum); break; } }
            }
            renderAll();
            toast('OK Операция удалена', '#1a5252');
          }, function(err){ toast('⚠️ Не удалилось: ' + err, '#BA7517'); });
        });
        r.appendChild(dt); r.appendChild(cat); r.appendChild(cmt); r.appendChild(sm); r.appendChild(del);
        ops.appendChild(r);
      });
    }
    view.appendChild(ops);
  }

  // Воронка: заказы ещё БЕЗ договора (sogl=0), но с предв. ценой.
  // Показывает потенциальную выручку «в работе» — сколько денег в
  // заявках, которые ещё не подписаны (Замер/Дизайн/Расчёт/Согласование).
  // Отказ и Отложено исключаем — это не активная воронка.
  function renderFunnel(view){
    var funnel = ORDERS.filter(function(o){
      return Number(o.sogl) <= 0 && ['Отказ','Отложено'].indexOf(o.status) < 0 && Number(o.pred) > 0;
    });
    var t0 = document.createElement('div'); t0.className='crm-sec-t';
    t0.textContent = 'Воронка — заявки до договора';
    view.appendChild(t0);
    if(!funnel.length){
      var e = document.createElement('div'); e.className='crm-empty';
      e.textContent = 'Нет активных заявок с предв. ценой без договора.';
      view.appendChild(e);
      return;
    }
    var predT = 0;
    funnel.forEach(function(o){ predT += Number(o.pred)||0; });
    var avg = funnel.length ? predT / funnel.length : 0;

    var sum = document.createElement('div'); sum.className='crm-sum';
    function tile(v, k, warn){
      var t = document.createElement('div'); t.className='crm-sum-t';
      var ve = document.createElement('div'); ve.className='v'+(warn?' warn':''); ve.textContent=v;
      var ke = document.createElement('div'); ke.className='k'; ke.textContent=k;
      t.appendChild(ve); t.appendChild(ke); sum.appendChild(t);
    }
    tile(fm0(predT), 'предв. сумма в работе');
    tile(String(funnel.length), 'заявок без договора');
    tile(fm0(avg), 'средняя предв. цена');
    view.appendChild(sum);

    // разбивка по статусам (сколько заявок и на какую сумму на каждом этапе)
    var byS = {};
    funnel.forEach(function(o){
      var s = o.status || '?';
      if(!byS[s]) byS[s] = { count:0, pred:0 };
      byS[s].count += 1;
      byS[s].pred += Number(o.pred)||0;
    });
    var order = STATUSES.filter(function(s){ return byS[s]; });
    var tbl = document.createElement('table'); tbl.className='crm-ftbl';
    var thead = document.createElement('tr');
    ['Этап','Заявок','Предв. сумма'].forEach(function(t){
      var th = document.createElement('th'); th.textContent = t; thead.appendChild(th);
    });
    tbl.appendChild(thead);
    order.forEach(function(s){
      var m = byS[s];
      var tr = document.createElement('tr');
      var c1 = document.createElement('td');
      var dot = document.createElement('span');
      dot.style.display = 'inline-block'; dot.style.width = '8px'; dot.style.height = '8px';
      dot.style.borderRadius = '50%'; dot.style.marginRight = '6px';
      dot.style.background = ST_COLOR[s] || '#999';
      c1.appendChild(dot); c1.appendChild(document.createTextNode(s));
      tr.appendChild(c1);
      var c2 = document.createElement('td'); c2.textContent = String(m.count); tr.appendChild(c2);
      var c3 = document.createElement('td'); c3.textContent = fm0(m.pred); tr.appendChild(c3);
      tbl.appendChild(tr);
    });
    view.appendChild(tbl);

    var note = document.createElement('div'); note.className='crm-fin-note';
    note.textContent = 'Предв. цена — грубая оценка расчёта до подписания. При формировании договора заявка переходит в «Продажи» с согласованной ценой.';
    view.appendChild(note);
  }

  function renderSales(view){
    var t0 = document.createElement('div'); t0.className='crm-sec-t';
    t0.textContent = 'Продажи — по договорам';
    view.appendChild(t0);
    var real = ORDERS.filter(function(o){ return o.status !== 'Отказ'; });
    var withSogl = real.filter(function(o){ return Number(o.sogl) > 0; });
    var revenue = 0, received = 0, debtT = 0;
    withSogl.forEach(function(o){ revenue += Number(o.sogl)||0; });
    real.forEach(function(o){
      received += (Number(o.avans)||0) + (Number(o.paid)||0);
      var d = debtOf(o); if(d > 0) debtT += d;
    });
    var avg = withSogl.length ? revenue / withSogl.length : 0;
    var margT = 0, margRev = 0, margCnt = 0;
    withSogl.forEach(function(o){
      var m = marginOf(o);
      if(m > 0){ margT += m; margRev += Number(o.sogl)||0; margCnt += 1; }
    });
    var margPct = margRev > 0 ? Math.round(margT / margRev * 100) : 0;

    var sum = document.createElement('div'); sum.className='crm-sum';
    function tile(v, k, warn){
      var t = document.createElement('div'); t.className='crm-sum-t';
      var ve = document.createElement('div'); ve.className='v'+(warn?' warn':''); ve.textContent=v;
      var ke = document.createElement('div'); ke.className='k'; ke.textContent=k;
      t.appendChild(ve); t.appendChild(ke); sum.appendChild(t);
    }
    tile(fm0(revenue), 'выручка по договорам, всего');
    tile(fm0(received), 'получено (авансы + доплаты)');
    tile(fm0(debtT), 'долг клиентов', debtT>0);
    tile(fm0(avg), 'средний чек (' + withSogl.length + ' догов.)');
    view.appendChild(sum);

    if(margCnt){
      var sum2 = document.createElement('div'); sum2.className='crm-sum';
      function tile2(v, k, warn){
        var t = document.createElement('div'); t.className='crm-sum-t';
        var ve = document.createElement('div'); ve.className='v'+(warn?' warn':''); ve.textContent=v;
        var ke = document.createElement('div'); ke.className='k'; ke.textContent=k;
        t.appendChild(ve); t.appendChild(ke); sum2.appendChild(t);
      }
      tile2(fm0(margT), 'маржа по договорам');
      tile2(fm0(margRev - margT), 'себестоимость');
      tile2(margPct + '%', 'рентабельность');
      tile2(String(margCnt) + ' из ' + withSogl.length, 'догов. с маржой');
      view.appendChild(sum2);
      if(margCnt < withSogl.length){
        var mn = document.createElement('div'); mn.className='crm-fin-note';
        mn.textContent = 'Маржа считается по ' + margCnt + ' договорам из ' + withSogl.length + ' — у остальных расчёт был сохранён до появления учёта маржи. Пересохрани расчёт заказа, чтобы маржа появилась.';
        view.appendChild(mn);
      }
    }

    // помесячные данные по дате договора
    var byM = {};
    withSogl.forEach(function(o){
      var k = monthKey(o.dogDate);
      if(!k) return;
      if(!byM[k]) byM[k] = { sogl:0, avans:0, count:0, debt:0 };
      byM[k].sogl  += Number(o.sogl)||0;
      byM[k].avans += Number(o.avans)||0;
      byM[k].count += 1;
      var d = debtOf(o); if(d>0) byM[k].debt += d;
    });
    var keys = Object.keys(byM).sort();
    if(!keys.length){
      var e = document.createElement('div'); e.className='crm-empty';
      e.textContent = 'Пока нет заказов с договорами — график появится после первого договора.';
      view.appendChild(e);
      return;
    }
    // непрерывный ряд месяцев от первого до текущего, максимум 12 последних
    var allKeys = [];
    var start = keys[0].split('-');
    var d0 = new Date(+start[0], +start[1]-1, 1);
    var dNow = new Date();
    while(d0.getTime() <= dNow.getTime()){
      allKeys.push(monthKey(d0));
      d0.setMonth(d0.getMonth()+1);
    }
    if(allKeys.length > 12) allKeys = allKeys.slice(-12);
    var maxV = 1;
    allKeys.forEach(function(k){ var m = byM[k]; if(m && m.sogl > maxV) maxV = m.sogl; });

    var ch = document.createElement('div'); ch.className='crm-chart';
    var ct = document.createElement('div'); ct.className='crm-chart-t';
    ct.textContent = 'По месяцам договоров' + (allKeys.length===12 ? ' (последние 12)' : '');
    ch.appendChild(ct);
    var bars = document.createElement('div'); bars.className='crm-bars';
    allKeys.forEach(function(k){
      var m = byM[k] || { sogl:0, avans:0, count:0 };
      var g = document.createElement('div'); g.className='crm-bgrp';
      var pair = document.createElement('div'); pair.className='crm-bpair';
      var b1 = document.createElement('div'); b1.className='crm-bar rev';
      b1.style.height = Math.round(m.sogl / maxV * 110) + 'px';
      b1.title = monthLabel(k) + ': выручка ' + fm0(m.sogl) + ' (' + m.count + ' догов.)';
      var b2 = document.createElement('div'); b2.className='crm-bar av';
      b2.style.height = Math.round(m.avans / maxV * 110) + 'px';
      b2.title = monthLabel(k) + ': авансы ' + fm0(m.avans);
      pair.appendChild(b1); pair.appendChild(b2);
      var lx = document.createElement('div'); lx.className='crm-bx';
      var p = k.split('-');
      lx.textContent = MONTH_SHORT[(+p[1])-1] + ' ' + p[0].slice(2);
      g.appendChild(pair); g.appendChild(lx);
      bars.appendChild(g);
    });
    ch.appendChild(bars);
    var leg = document.createElement('div'); leg.className='crm-legend';
    var l1 = document.createElement('span');
    var i1 = document.createElement('i'); i1.style.background='#1a5252';
    l1.appendChild(i1); l1.appendChild(document.createTextNode('Выручка (согл. цена)'));
    var l2 = document.createElement('span');
    var i2 = document.createElement('i'); i2.style.background='#5DCAA5';
    l2.appendChild(i2); l2.appendChild(document.createTextNode('Авансы'));
    leg.appendChild(l1); leg.appendChild(l2);
    ch.appendChild(leg);
    view.appendChild(ch);

    // таблица месяцев (новые сверху)
    var tbl = document.createElement('table'); tbl.className='crm-ftbl';
    var thead = document.createElement('tr');
    ['Месяц','Договоров','Выручка','Авансы','Долг по этим заказам'].forEach(function(t){
      var th = document.createElement('th'); th.textContent = t; thead.appendChild(th);
    });
    tbl.appendChild(thead);
    allKeys.slice().reverse().forEach(function(k){
      var m = byM[k]; if(!m) return;
      var tr = document.createElement('tr');
      function td(t, cls){ var c = document.createElement('td'); c.textContent = t; if(cls) c.className = cls; tr.appendChild(c); }
      td(monthLabel(k));
      td(String(m.count));
      td(fm0(m.sogl));
      td(fm0(m.avans));
      td(m.debt > 0 ? fm0(m.debt) : '\u2014', m.debt > 0 ? 'debt' : '');
      tbl.appendChild(tr);
    });
    view.appendChild(tbl);

    var note = document.createElement('div'); note.className='crm-fin-note';
    note.textContent = 'Выручка и авансы привязаны к месяцу договора. Доплаты («Оплачено») пока учитываются общей суммой без даты платежа — помесячный учёт всех приходов и расходов появится вместе с листом «Финансы» на следующем этапе.';
    view.appendChild(note);
  }

  function makeCard(o){
    var d = document.createElement('div');
    d.className = 'crm-card';
    d.draggable = true;
    d.addEventListener('dragstart', function(e){
      e.dataTransfer.setData('text/plain', String(o.num));
      e.dataTransfer.effectAllowed = 'move';
    });
    d.style.borderLeftColor = ST_COLOR[o.status] || '#ccc';
    var l1 = document.createElement('div'); l1.className='l1';
    var t1 = document.createElement('span'); t1.textContent = '\u2116' + o.num + (o.furn ? ' \u00B7 ' + o.furn : '');
    var t2 = document.createElement('span'); t2.textContent = fm0(o.sogl || o.pred);
    l1.appendChild(t1); l1.appendChild(t2);
    var l2 = document.createElement('div'); l2.className='l2';
    l2.textContent = (o.client||'') + (o.city ? ' \u2014 ' + o.city : '');
    var l3 = document.createElement('div'); l3.className='l3';
    var debt = debtOf(o);
    var dEl = document.createElement('span');
    if(debt > 0){ dEl.className='crm-debt'; dEl.textContent = 'долг ' + fm0(debt); }
    else if(debt < 0){ dEl.className='crm-overpaid'; dEl.textContent = 'переплата ' + fm0(-debt); }
    var days = daysInWork(o);
    var dayEl = document.createElement('span');
    if(days !== null){ dayEl.className='crm-days'; dayEl.textContent = days + ' дн.'; }
    l3.appendChild(dEl); l3.appendChild(dayEl);
    d.appendChild(l1); d.appendChild(l2);
    if(debt!==0 || days!==null) d.appendChild(l3);
    var nx = nextStatus(o);
    if(nx){
      var nb = document.createElement('button');
      nb.className = 'crm-next';
      nb.textContent = '\u2192 ' + nx;
      nb.addEventListener('click', function(e){
        e.stopPropagation();
        nb.disabled = true; nb.textContent = '...';
        post({ action:'updateOrder', order:{ num:String(o.num), status:nx } }, function(){
          o.status = nx;
          renderAll();
          toast('OK \u2116'+o.num+' \u2192 '+nx, '#1a5252');
        }, function(err){
          nb.disabled = false; nb.textContent = '\u2192 ' + nx;
          toast('\u26A0\uFE0F Статус не записался: '+err, '#BA7517');
        });
      });
      d.appendChild(nb);
    }
    d.addEventListener('click', function(){ openCard(o.num); });
    return d;
  }

  function renderBoard(view, vis){
    var board = document.createElement('div');
    board.className = 'crm-board';
    STATUSES.forEach(function(st){
      var inCol = vis.filter(function(o){ return o.status === st; });
      if(!inCol.length && (st==='Отказ' || st==='Отложено')) return;
      var col = document.createElement('div'); col.className='crm-col';
      col.addEventListener('dragover', function(e){ e.preventDefault(); e.dataTransfer.dropEffect='move'; col.classList.add('drag'); });
      col.addEventListener('dragleave', function(){ col.classList.remove('drag'); });
      col.addEventListener('drop', function(e){
        e.preventDefault();
        col.classList.remove('drag');
        var num = e.dataTransfer.getData('text/plain');
        var o = null;
        for(var i=0;i<ORDERS.length;i++){ if(String(ORDERS[i].num)===String(num)){ o=ORDERS[i]; break; } }
        if(!o || o.status === st) return;
        var from = o.status;
        o.status = st; renderAll();
        post({ action:'updateOrder', order:{ num:String(num), status:st } }, function(){
          toast('OK \u2116'+num+': '+from+' \u2192 '+st, '#1a5252');
        }, function(err){
          o.status = from; renderAll();
          toast('\u26A0\uFE0F Статус не записался, вернул обратно: '+err, '#BA7517');
        });
      });
      var h = document.createElement('div'); h.className='crm-col-h';
      var dot = document.createElement('span'); dot.className='dot'; dot.style.background = ST_COLOR[st];
      var nm = document.createElement('span'); nm.textContent = st;
      var c = document.createElement('span'); c.className='cnt'; c.textContent = inCol.length;
      h.appendChild(dot); h.appendChild(nm); h.appendChild(c);
      col.appendChild(h);
      inCol.sort(function(a,b){ return String(b.num).localeCompare(String(a.num),'ru',{numeric:true}); });
      inCol.forEach(function(o){ col.appendChild(makeCard(o)); });
      board.appendChild(col);
    });
    view.appendChild(board);
  }

  function renderList(view, vis){
    var list = document.createElement('div');
    list.className = 'crm-list';
    var rows = vis.filter(function(o){ return FILTER==='all' || o.status===FILTER; });
    if(MONTH_FILTER!=='all' && MONTH_FILTER!=='none'){
      rows.sort(function(a,b){ return new Date(a.mountDate||0).getTime() - new Date(b.mountDate||0).getTime(); });
    } else {
      rows.sort(function(a,b){ return String(b.num).localeCompare(String(a.num),'ru',{numeric:true}); });
    }
    if(!rows.length){ list.innerHTML = '<div class="crm-empty">Ничего не найдено</div>'; view.appendChild(list); return; }
    rows.forEach(function(o){
      var r = document.createElement('div'); r.className='crm-row';
      var num = document.createElement('span'); num.className='num'; num.textContent = '\u2116'+o.num;
      var badge = document.createElement('span'); badge.className='crm-badge';
      badge.style.background = ST_COLOR[o.status] || '#999';
      badge.textContent = o.status || '?';
      var cli = document.createElement('span'); cli.className='cli';
      cli.textContent = (o.client||'') + (o.furn ? ' \u00B7 '+o.furn : '');
      var sub = document.createElement('span'); sub.className='sub';
      sub.textContent = (o.city||'') + (o.city && (o.phone||o.mountDate) ? ' \u00B7 ' : '');
      if(o.phone){
        var tel = document.createElement('a');
        tel.className = 'crm-tel';
        tel.href = 'tel:' + String(o.phone).replace(/[^+\d]/g,'');
        tel.textContent = o.phone;
        tel.addEventListener('click', function(e){ e.stopPropagation(); });
        sub.appendChild(tel);
      }
      if(o.mountDate && monthKey(o.mountDate)){
        var md = document.createElement('span');
        md.textContent = (o.phone ? ' \u00B7 ' : '') + '\u0443\u0441\u0442. ' + fmtDate(o.mountDate);
        sub.appendChild(md);
      }
      var money = document.createElement('span'); money.className='money';
      var debt = debtOf(o);
      money.textContent = fm0(o.sogl || o.pred) + (debt>0 ? ' / долг '+fm0(debt) : (debt<0 ? ' / переплата '+fm0(-debt) : ''));
      r.appendChild(num); r.appendChild(badge); r.appendChild(cli); r.appendChild(sub); r.appendChild(money);
      r.addEventListener('click', function(){ openCard(o.num); });
      list.appendChild(r);
    });
    view.appendChild(list);
  }

  // ── Карточка заказа ────────────────────────────────────────
  function field(label, el){
    var f = document.createElement('div'); f.className='crm-f';
    var l = document.createElement('label'); l.textContent = label;
    f.appendChild(l); f.appendChild(el);
    return f;
  }
  function inp(val, type){
    var e = document.createElement('input');
    e.type = type || 'text';
    e.value = (val===undefined||val===null) ? '' : String(val);
    return e;
  }

  function openFinModal(pre){
    var bg = document.createElement('div'); bg.className='crm-modal-bg';
    bg.addEventListener('click', function(e){ if(e.target===bg) document.body.removeChild(bg); });
    var m = document.createElement('div'); m.className='crm-modal';
    var h = document.createElement('div'); h.className='crm-m-h';
    var title = document.createElement('b');
    title.textContent = pre.num ? 'Оплата по заказу \u2116' + pre.num : 'Новая операция';
    var x = document.createElement('button'); x.className='crm-m-x'; x.textContent='\u00D7';
    x.addEventListener('click', function(){ document.body.removeChild(bg); });
    h.appendChild(title); h.appendChild(x);
    var b = document.createElement('div'); b.className='crm-m-b';

    var selType = document.createElement('select');
    ['Приход','Расход'].forEach(function(t){ var op=document.createElement('option'); op.value=t; op.textContent=t; selType.appendChild(op); });
    var selCat = document.createElement('select');
    function fillCats(){
      selCat.innerHTML = '';
      var cats = selType.value === 'Приход' ? CAT_IN : CAT_OUT;
      cats.forEach(function(c){ var op=document.createElement('option'); op.value=c; op.textContent=c; selCat.appendChild(op); });
    }
    selType.addEventListener('change', fillCats);
    selType.value = pre.type || 'Приход';
    fillCats();
    if(pre.cat) selCat.value = pre.cat;

    var iSum = inp('', 'number'); iSum.placeholder = '0';
    var today = new Date();
    var iDate = inp(today.getFullYear()+'-'+('0'+(today.getMonth()+1)).slice(-2)+'-'+('0'+today.getDate()).slice(-2), 'date');
    var iNum = inp(pre.num || ''); iNum.placeholder = '\u2116 заказа (не обязательно)';
    iNum.setAttribute('list', 'crm-num-list');
    var dl = document.createElement('datalist'); dl.id = 'crm-num-list';
    ORDERS.forEach(function(o){ var op=document.createElement('option'); op.value=String(o.num); dl.appendChild(op); });
    var iCmt = inp(''); iCmt.placeholder = 'Комментарий';

    var r1 = document.createElement('div'); r1.className='crm-2col';
    r1.appendChild(field('Тип', selType)); r1.appendChild(field('Категория', selCat));
    b.appendChild(r1);
    var r2 = document.createElement('div'); r2.className='crm-2col';
    r2.appendChild(field('Сумма, \u20B8', iSum)); r2.appendChild(field('Дата', iDate));
    b.appendChild(r2);
    b.appendChild(field('\u2116 заказа', iNum));
    b.appendChild(dl);
    b.appendChild(field('Комментарий', iCmt));

    var btns = document.createElement('div'); btns.className='crm-m-btns';
    var bSave = document.createElement('button'); bSave.className='crm-m-btn save'; bSave.textContent='Записать';
    bSave.addEventListener('click', function(){
      var sum = parseFloat(iSum.value) || 0;
      if(sum <= 0){ toast('\u26A0\uFE0F Введи сумму', '#BA7517'); return; }
      bSave.disabled = true; bSave.textContent = 'Записываю...';
      var fin = {
        type: selType.value, cat: selCat.value, sum: sum,
        date: iDate.value, num: iNum.value.trim(), comment: iCmt.value.trim()
      };
      post({ action:'addFin', fin: fin }, function(res){
        FIN.unshift({ id: (res && res.id) || String(Date.now()), date: fin.date, type: fin.type, cat: fin.cat, sum: fin.sum, num: fin.num, comment: fin.comment });
        if(fin.type==='Приход' && fin.cat==='Доплата' && fin.num){
          for(var i=0;i<ORDERS.length;i++){ if(String(ORDERS[i].num)===String(fin.num)){ ORDERS[i].paid = (Number(ORDERS[i].paid)||0) + fin.sum; break; } }
        }
        document.body.removeChild(bg);
        renderAll();
        toast('OK ' + fin.type + ' ' + fm0(fin.sum) + ' записан', '#1a5252');
      }, function(err){
        bSave.disabled=false; bSave.textContent='Записать';
        toast('\u26A0\uFE0F Не записалось: '+err, '#BA7517');
      });
    });
    btns.appendChild(bSave);
    b.appendChild(btns);
    m.appendChild(h); m.appendChild(b);
    bg.appendChild(m);
    document.body.appendChild(bg);
    setTimeout(function(){ try{ iSum.focus(); }catch(e){} }, 50);
  }

  function openChangeModal(o){
    var bg = document.createElement('div'); bg.className='crm-modal-bg';
    bg.addEventListener('click', function(e){ if(e.target===bg) document.body.removeChild(bg); });
    var m = document.createElement('div'); m.className='crm-modal';
    var h = document.createElement('div'); h.className='crm-m-h';
    var title = document.createElement('b');
    title.textContent = 'Изменение к договору \u2116' + o.num;
    var x = document.createElement('button'); x.className='crm-m-x'; x.textContent='\u00D7';
    x.addEventListener('click', function(){ document.body.removeChild(bg); });
    h.appendChild(title); h.appendChild(x);
    var b = document.createElement('div'); b.className='crm-m-b';

    var selDir = document.createElement('select');
    var opP = document.createElement('option'); opP.value='plus';  opP.textContent='Добавили (+)';
    var opM = document.createElement('option'); opM.value='minus'; opM.textContent='Убрали (\u2212)';
    selDir.appendChild(opP); selDir.appendChild(opM);

    var iSum = inp('', 'number'); iSum.placeholder = '0';
    var today = new Date();
    var iDate = inp(today.getFullYear()+'-'+('0'+(today.getMonth()+1)).slice(-2)+'-'+('0'+today.getDate()).slice(-2), 'date');
    var iDesc = inp(''); iDesc.placeholder = 'Что добавили или убрали';

    var r1 = document.createElement('div'); r1.className='crm-2col';
    r1.appendChild(field('Тип', selDir)); r1.appendChild(field('Сумма, \u20B8', iSum));
    b.appendChild(r1);
    b.appendChild(field('Дата', iDate));
    b.appendChild(field('Описание', iDesc));

    var note = document.createElement('div'); note.className='crm-fin-note';
    note.textContent = 'Итоговая цена и долг пересчитаются сами. Аванс и оплаты не меняются \u2014 это изменение цены, а не движение денег.';
    b.appendChild(note);

    var btns = document.createElement('div'); btns.className='crm-m-btns';
    var bSave = document.createElement('button'); bSave.className='crm-m-btn save'; bSave.textContent='Записать';
    bSave.addEventListener('click', function(){
      var sum = Math.round(parseFloat(iSum.value) || 0);
      if(sum <= 0){ toast('\u26A0\uFE0F Введи сумму', '#BA7517'); return; }
      var desc = iDesc.value.trim();
      if(!desc){ toast('\u26A0\uFE0F Опиши изменение', '#BA7517'); return; }
      var signed = selDir.value === 'minus' ? -sum : sum;
      bSave.disabled = true; bSave.textContent = 'Записываю...';
      post({ action:'addChange', change:{ num:String(o.num), desc:desc, sum:signed, date:iDate.value } }, function(res){
        CH.push({ id:(res && res.id) || String(Date.now()), num:String(o.num), date:iDate.value, desc:desc, sum:signed });
        if(res && res.sogl !== undefined){ o.sogl = Number(res.sogl)||0; }
        document.body.removeChild(bg);
        renderAll();
        openCard(o.num);
        toast('OK ' + (signed>=0 ? '+' : '\u2212') + fm0(Math.abs(signed)) + ' к договору \u2116'+o.num+', итоговая цена: '+fm0(o.sogl), '#1a5252');
      }, function(err){
        bSave.disabled=false; bSave.textContent='Записать';
        toast('\u26A0\uFE0F Не записалось: '+err, '#BA7517');
      });
    });
    btns.appendChild(bSave);
    b.appendChild(btns);
    m.appendChild(h); m.appendChild(b);
    bg.appendChild(m);
    document.body.appendChild(bg);
    setTimeout(function(){ try{ iSum.focus(); }catch(e){} }, 60);
  }

  // ── Печать «Доп. соглашение №K» к договору ─────────────────
  // Стиль и реквизиты продублированы из generateDogovor (main.js) —
  // модуль изолирован, main.js не трогаем. При смене реквизитов ИП
  // менять в обоих местах!
  function escHtml(s){
    return String(s==null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function ruDateCrm(v){
    var M = ['\u044f\u043d\u0432\u0430\u0440\u044f','\u0444\u0435\u0432\u0440\u0430\u043b\u044f','\u043c\u0430\u0440\u0442\u0430','\u0430\u043f\u0440\u0435\u043b\u044f','\u043c\u0430\u044f','\u0438\u044e\u043d\u044f','\u0438\u044e\u043b\u044f','\u0430\u0432\u0433\u0443\u0441\u0442\u0430','\u0441\u0435\u043d\u0442\u044f\u0431\u0440\u044f','\u043e\u043a\u0442\u044f\u0431\u0440\u044f','\u043d\u043e\u044f\u0431\u0440\u044f','\u0434\u0435\u043a\u0430\u0431\u0440\u044f'];
    var d = new Date(v);
    if(!v || isNaN(d.getTime())) return '\u00ab____\u00bb ________________ 20___ \u0433.';
    return '\u00ab' + ('0'+d.getDate()).slice(-2) + '\u00bb ' + M[d.getMonth()] + ' ' + d.getFullYear() + ' \u0433.';
  }
  function tenge(n){ return Math.round(Math.abs(Number(n)||0)).toLocaleString('ru') + ' \u0442\u0435\u043d\u0433\u0435'; }

  // o — заказ, chs — его изменения (в порядке листа), ci — индекс печатаемого.
  // Итоговая стоимость считается НА МОМЕНТ этого соглашения:
  // цена договора + сумма изменений с 1-го по это включительно.
  function printChangeAgreement(o, chs, ci){
    var c = chs[ci];
    var kNum = ci + 1;
    var allSum = 0, uptoSum = 0;
    chs.forEach(function(x, i){
      var s = Number(x.sum)||0;
      allSum += s;
      if(i <= ci) uptoSum += s;
    });
    var base = (Number(o.sogl)||0) - allSum;
    var totalAt = base + uptoSum;
    var plus = Number(c.sum) >= 0;
    var addr   = escHtml(o.obj)    || '___________________________________';
    var phone  = escHtml(o.phone)  || '_______________';
    var desc   = escHtml(c.desc);
    var dogRu  = ruDateCrm(o.dogDate);
    var chRu   = ruDateCrm(c.date);

    var H = '';
    H += '<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">';
    H += '<title>\u0414\u043e\u043f. \u0441\u043e\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u0435 \u2116' + kNum + ' \u043a \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0443 \u2116' + escHtml(o.num) + ' \u2014 MebelOFF.kz</title>';
    H += '<style>';
    H += 'body{font-family:"Times New Roman",Times,serif;font-size:12pt;color:#000;background:#fff;margin:0;line-height:1.5}';
    H += '.pg{max-width:210mm;margin:0 auto;padding:18mm 22mm 18mm 28mm;box-sizing:border-box}';
    H += 'h1{text-align:center;font-size:14pt;font-weight:bold;margin:0 0 2px;letter-spacing:1px}';
    H += 'h2{text-align:center;font-size:12pt;font-weight:normal;margin:0 0 2px}';
    H += '.c{text-align:center}';
    H += 'p{margin:3pt 0;text-align:justify}';
    H += '.ind{text-indent:20pt}';
    H += '.b{font-weight:bold}';
    H += '.hr{border:none;border-top:2px solid #C9A96E;margin:10pt 0}';
    H += '.sw{display:flex;gap:28px;margin-top:14pt}';
    H += '.sc{flex:1;font-size:11pt}';
    H += '.sl{display:block;border-top:1px solid #000;margin-top:26pt;padding-top:3pt}';
    H += '.btn{position:fixed;top:14px;right:14px;background:#C9A96E;color:#fff;border:none;padding:9px 20px;border-radius:8px;font-size:13px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.2);z-index:999}';
    H += '@media print{.btn{display:none!important}.pg{padding:14mm 20mm 14mm 24mm}}';
    H += '</style></head><body>';
    H += '<button class="btn" onclick="window.print()">\uD83D\uDDA8 \u041f\u0435\u0447\u0430\u0442\u044c / PDF</button>';
    H += '<div class="pg">';

    H += '<h1>\u0414\u041e\u041f\u041e\u041b\u041d\u0418\u0422\u0415\u041b\u042c\u041d\u041e\u0415 \u0421\u041e\u0413\u041b\u0410\u0428\u0415\u041d\u0418\u0415 \u2116\u00a0' + kNum + '</h1>';
    H += '<h2>\u043a \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0443 \u043d\u0430 \u0438\u0437\u0433\u043e\u0442\u043e\u0432\u043b\u0435\u043d\u0438\u0435 \u0438 \u043c\u043e\u043d\u0442\u0430\u0436 \u043a\u043e\u0440\u043f\u0443\u0441\u043d\u043e\u0439 \u043c\u0435\u0431\u0435\u043b\u0438 \u2116\u00a0<b>' + escHtml(o.num) + '</b> \u043e\u0442 ' + dogRu + '</h2>';
    H += '<p class="c" style="margin-top:5pt">\u0433. \u0421\u0430\u0442\u043f\u0430\u0435\u0432 &nbsp;&nbsp; ' + chRu + '</p>';
    H += '<hr class="hr">';

    H += '<p class="ind">\u0418\u043d\u0434\u0438\u0432\u0438\u0434\u0443\u0430\u043b\u044c\u043d\u044b\u0439 \u043f\u0440\u0435\u0434\u043f\u0440\u0438\u043d\u0438\u043c\u0430\u0442\u0435\u043b\u044c \u00abMebeloff.kz\u00bb (\u0411\u0418\u041d/\u0418\u0418\u041d 900328351393), \u0432 \u043b\u0438\u0446\u0435 \u041c\u0443\u0448\u0435\u043d\u043e\u0432\u0430 \u0422\u0438\u043b\u0435\u043a\u0430 \u0422\u043b\u0435\u0443\u0445\u0430\u043d\u043e\u0432\u0438\u0447\u0430, \u0438\u043c\u0435\u043d\u0443\u0435\u043c\u044b\u0439 \u0432 \u0434\u0430\u043b\u044c\u043d\u0435\u0439\u0448\u0435\u043c \u00ab\u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u00bb, \u0441 \u043e\u0434\u043d\u043e\u0439 \u0441\u0442\u043e\u0440\u043e\u043d\u044b, \u0438</p>';
    H += '<p class="ind"><b>___________________________________</b> (\u0418\u0418\u041d/\u0411\u0418\u041d: _______________), \u0438\u043c\u0435\u043d\u0443\u0435\u043c\u044b\u0439(-\u0430\u044f) \u0432 \u0434\u0430\u043b\u044c\u043d\u0435\u0439\u0448\u0435\u043c \u00ab\u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u00bb, \u0441 \u0434\u0440\u0443\u0433\u043e\u0439 \u0441\u0442\u043e\u0440\u043e\u043d\u044b,</p>';
    H += '<p class="ind">\u0437\u0430\u043a\u043b\u044e\u0447\u0438\u043b\u0438 \u043d\u0430\u0441\u0442\u043e\u044f\u0449\u0435\u0435 \u0414\u043e\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u043d\u043e\u0435 \u0441\u043e\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u0435 (\u0434\u0430\u043b\u0435\u0435 \u2014 \u00ab\u0421\u043e\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u0435\u00bb) \u043a \u0443\u043a\u0430\u0437\u0430\u043d\u043d\u043e\u043c\u0443 \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0443 \u043e \u043d\u0438\u0436\u0435\u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0435\u043c:</p>';
    H += '<hr class="hr">';

    H += '<p>1. \u0421\u0442\u043e\u0440\u043e\u043d\u044b \u0441\u043e\u0433\u043b\u0430\u0441\u043e\u0432\u0430\u043b\u0438 \u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0435\u0435 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u0435 \u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0442\u0430\u0446\u0438\u0438 \u0418\u0437\u0434\u0435\u043b\u0438\u044f \u043f\u043e \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0443: <b>' + desc + '</b>.</p>';
    H += '<p>2. \u0412 \u0441\u0432\u044f\u0437\u0438 \u0441 \u0443\u043a\u0430\u0437\u0430\u043d\u043d\u044b\u043c \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u0435\u043c \u043e\u0431\u0449\u0430\u044f \u0441\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u044c \u0440\u0430\u0431\u043e\u0442 \u043f\u043e \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0443 ' + (plus ? '\u0443\u0432\u0435\u043b\u0438\u0447\u0438\u0432\u0430\u0435\u0442\u0441\u044f' : '\u0443\u043c\u0435\u043d\u044c\u0448\u0430\u0435\u0442\u0441\u044f') + ' \u043d\u0430 <b>' + tenge(c.sum) + '</b>.</p>';
    H += '<p>3. \u041e\u0431\u0449\u0430\u044f \u0441\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u044c \u0440\u0430\u0431\u043e\u0442 \u043f\u043e \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0443 \u0441 \u0443\u0447\u0451\u0442\u043e\u043c \u043d\u0430\u0441\u0442\u043e\u044f\u0449\u0435\u0433\u043e \u0421\u043e\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u044f \u0441\u043e\u0441\u0442\u0430\u0432\u043b\u044f\u0435\u0442 <b>' + tenge(totalAt) + '</b>.</p>';
    H += '<p>4. \u0412\u0441\u0435 \u0440\u0430\u0441\u0447\u0451\u0442\u044b \u043f\u043e \u043d\u0430\u0441\u0442\u043e\u044f\u0449\u0435\u043c\u0443 \u0421\u043e\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u044e \u043f\u0440\u043e\u0438\u0437\u0432\u043e\u0434\u044f\u0442\u0441\u044f \u0432 \u043f\u043e\u0440\u044f\u0434\u043a\u0435, \u043f\u0440\u0435\u0434\u0443\u0441\u043c\u043e\u0442\u0440\u0435\u043d\u043d\u043e\u043c \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u043e\u043c' + (plus ? '' : '; \u0438\u0437\u043b\u0438\u0448\u043d\u0435 \u0443\u043f\u043b\u0430\u0447\u0435\u043d\u043d\u0430\u044f \u0441\u0443\u043c\u043c\u0430 (\u043f\u0440\u0438 \u0435\u0451 \u0432\u043e\u0437\u043d\u0438\u043a\u043d\u043e\u0432\u0435\u043d\u0438\u0438) \u0443\u0447\u0438\u0442\u044b\u0432\u0430\u0435\u0442\u0441\u044f \u043f\u0440\u0438 \u043e\u043a\u043e\u043d\u0447\u0430\u0442\u0435\u043b\u044c\u043d\u043e\u043c \u0440\u0430\u0441\u0447\u0451\u0442\u0435 \u043b\u0438\u0431\u043e \u0432\u043e\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442\u0441\u044f \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u0443') + '.</p>';
    H += '<p>5. \u0412 \u0441\u0432\u044f\u0437\u0438 \u0441 \u0443\u043a\u0430\u0437\u0430\u043d\u043d\u044b\u043c \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u0435\u043c \u0441\u0440\u043e\u043a \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f \u0440\u0430\u0431\u043e\u0442 \u043f\u043e \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0443 \u043f\u0440\u043e\u0434\u043b\u0435\u0432\u0430\u0435\u0442\u0441\u044f \u043d\u0430 ________ \u043a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u043d\u044b\u0445 \u0434\u043d\u0435\u0439; \u043d\u043e\u0432\u0430\u044f \u0434\u0430\u0442\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u0438\u044f \u0440\u0430\u0431\u043e\u0442: \u00ab____\u00bb ________________ 20___ \u0433. \u0415\u0441\u043b\u0438 \u043f\u043e\u043b\u044f \u043d\u0430\u0441\u0442\u043e\u044f\u0449\u0435\u0433\u043e \u043f\u0443\u043d\u043a\u0442\u0430 \u043d\u0435 \u0437\u0430\u043f\u043e\u043b\u043d\u0435\u043d\u044b, \u0441\u0440\u043e\u043a\u0438, \u0443\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d\u043d\u044b\u0435 \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u043e\u043c, \u043e\u0441\u0442\u0430\u044e\u0442\u0441\u044f \u0431\u0435\u0437 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u0439.</p>';
    H += '<p>6. \u041e\u0441\u0442\u0430\u043b\u044c\u043d\u044b\u0435 \u0443\u0441\u043b\u043e\u0432\u0438\u044f \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0430 \u043e\u0441\u0442\u0430\u044e\u0442\u0441\u044f \u0431\u0435\u0437 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u0439. \u041d\u0430\u0441\u0442\u043e\u044f\u0449\u0435\u0435 \u0421\u043e\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u0435 \u0441\u043e\u0441\u0442\u0430\u0432\u043b\u0435\u043d\u043e \u0432 \u0434\u0432\u0443\u0445 \u044d\u043a\u0437\u0435\u043c\u043f\u043b\u044f\u0440\u0430\u0445, \u0438\u043c\u0435\u044e\u0449\u0438\u0445 \u0440\u0430\u0432\u043d\u0443\u044e \u044e\u0440\u0438\u0434\u0438\u0447\u0435\u0441\u043a\u0443\u044e \u0441\u0438\u043b\u0443, \u043f\u043e \u043e\u0434\u043d\u043e\u043c\u0443 \u0434\u043b\u044f \u043a\u0430\u0436\u0434\u043e\u0439 \u0438\u0437 \u0421\u0442\u043e\u0440\u043e\u043d, \u0432\u0441\u0442\u0443\u043f\u0430\u0435\u0442 \u0432 \u0441\u0438\u043b\u0443 \u0441 \u043c\u043e\u043c\u0435\u043d\u0442\u0430 \u043f\u043e\u0434\u043f\u0438\u0441\u0430\u043d\u0438\u044f \u0438 \u044f\u0432\u043b\u044f\u0435\u0442\u0441\u044f \u043d\u0435\u043e\u0442\u044a\u0435\u043c\u043b\u0435\u043c\u043e\u0439 \u0447\u0430\u0441\u0442\u044c\u044e \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0430.</p>';

    H += '<hr class="hr"><p class="c b">\u0420\u0415\u041a\u0412\u0418\u0417\u0418\u0422\u042b \u0418 \u041f\u041e\u0414\u041f\u0418\u0421\u0418 \u0421\u0422\u041e\u0420\u041e\u041d</p>';
    H += '<div class="sw"><div class="sc"><p class="b">\u0418\u0421\u041f\u041e\u041b\u041d\u0418\u0422\u0415\u041b\u042c</p>';
    H += '<p>\u0418\u041f \u00abMebeloff.kz\u00bb<br>\u0420\u0435\u0441\u043f\u0443\u0431\u043b\u0438\u043a\u0430 \u041a\u0430\u0437\u0430\u0445\u0441\u0442\u0430\u043d, \u0433. \u0421\u0430\u0442\u043f\u0430\u0435\u0432,<br>\u043f\u0440. \u0421\u0430\u0442\u043f\u0430\u0435\u0432\u0430 147/1<br>\u0411\u0418\u041d/\u0418\u0418\u041d: 900328351393<br>\u0422\u0435\u043b.: +7\u00a0707\u00a0540\u00a07626</p>';
    H += '<span class="sl">\u041f\u043e\u0434\u043f\u0438\u0441\u044c: __________ / \u041c\u0443\u0448\u0435\u043d\u043e\u0432 \u0422.\u0422.</span>';
    H += '<p style="margin-top:4pt">\u0414\u0430\u0442\u0430: ' + chRu + '</p></div>';
    H += '<div class="sc"><p class="b">\u0417\u0410\u041a\u0410\u0417\u0427\u0418\u041a</p>';
    H += '<p>\u0424.\u0418.\u041e.: ___________________________________<br>\u0418\u0418\u041d/\u0411\u0418\u041d: _______________<br>\u0410\u0434\u0440\u0435\u0441: ' + addr + '<br>\u0422\u0435\u043b.: ' + phone + '</p>';
    H += '<span class="sl">\u041f\u043e\u0434\u043f\u0438\u0441\u044c: __________ / ______________</span>';
    H += '<p style="margin-top:4pt">\u0414\u0430\u0442\u0430: ' + chRu + '</p></div></div>';
    H += '</div></body></html>';

    var w = window.open('','_blank');
    if (w) { w.document.write(H); w.document.close(); }
    else { toast('\u26A0\uFE0F \u0411\u0440\u0430\u0443\u0437\u0435\u0440 \u0437\u0430\u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0430\u043b \u043e\u043a\u043d\u043e \u2014 \u0440\u0430\u0437\u0440\u0435\u0448\u0438 \u0432\u0441\u043f\u043b\u044b\u0432\u0430\u044e\u0449\u0438\u0435 \u043e\u043a\u043d\u0430 \u0434\u043b\u044f \u0441\u0430\u0439\u0442\u0430', '#BA7517'); }
  }

  function openNewOrderModal(){
    var bg = document.createElement('div'); bg.className='crm-modal-bg';
    bg.addEventListener('click', function(e){ if(e.target===bg) document.body.removeChild(bg); });
    var m = document.createElement('div'); m.className='crm-modal';
    var h = document.createElement('div'); h.className='crm-m-h';
    var title = document.createElement('b'); title.textContent = 'Новый заказ (\u2116 присвоится автоматически)';
    var x = document.createElement('button'); x.className='crm-m-x'; x.textContent='\u00D7';
    x.addEventListener('click', function(){ document.body.removeChild(bg); });
    h.appendChild(title); h.appendChild(x);
    var b = document.createElement('div'); b.className='crm-m-b';

    var selSt = document.createElement('select');
    STATUSES.forEach(function(s){ var op=document.createElement('option'); op.value=s; op.textContent=s; selSt.appendChild(op); });
    selSt.value = 'Замер';
    var iNum = inp(''); iNum.placeholder = '\u2116 заказа';
    var iClient = inp(''), iPhone = inp(''), iCity = inp(''), iFurn = inp(''), iObj = inp('');
    iClient.placeholder = 'Имя клиента'; iPhone.placeholder = '+7 ...';
    iCity.placeholder = 'Сат / Жез'; iFurn.placeholder = 'Кухня / Шкаф / ...';
    var iNote = document.createElement('textarea'); iNote.rows=2;

    var r0 = document.createElement('div'); r0.className = 'crm-2col';
    r0.appendChild(field('Статус', selSt)); r0.appendChild(field('\u2116 заказа (пусто = авто)', iNum));
    b.appendChild(r0);
    var r1 = document.createElement('div'); r1.className='crm-2col';
    r1.appendChild(field('Клиент', iClient)); r1.appendChild(field('Телефон', iPhone));
    b.appendChild(r1);
    var r2 = document.createElement('div'); r2.className='crm-2col';
    r2.appendChild(field('Город', iCity)); r2.appendChild(field('Тип мебели', iFurn));
    b.appendChild(r2);
    b.appendChild(field('Адрес / объект', iObj));
    b.appendChild(field('Примечание', iNote));

    var btns = document.createElement('div'); btns.className='crm-m-btns';
    var bSave = document.createElement('button'); bSave.className='crm-m-btn save'; bSave.textContent='Создать заказ';
    bSave.addEventListener('click', function(){
      if(!iClient.value.trim() && !iPhone.value.trim()){
        toast('\u26A0\uFE0F Укажи хотя бы имя или телефон клиента', '#BA7517');
        return;
      }
      bSave.disabled = true; bSave.textContent = 'Создаю...';
      var order = {
        status: selSt.value,
        client: iClient.value.trim(),
        phone: iPhone.value.trim(),
        city: iCity.value.trim(),
        furn: iFurn.value.trim(),
        obj: iObj.value.trim(),
        note: iNote.value.trim()
      };
      var numVal = iNum.value.trim();
      if(numVal) order.num = numVal;
      post({ action:'createOrder', order: order }, function(res){
        if(!res || !res.num){
          bSave.disabled=false; bSave.textContent='Создать заказ';
          toast('\u26A0\uFE0F ' + ((res && res.error) || 'таблица не вернула номер'), '#BA7517');
          return;
        }
        ORDERS.unshift({
          num: res.num, status: order.status, client: order.client, phone: order.phone,
          city: order.city, furn: order.furn, obj: order.obj, note: order.note,
          pred: 0, sogl: 0, avans: 0, paid: 0, totL: 0, totP: 0, totK: 0,
          dogDate: '', mountDate: '', updated: new Date().toISOString()
        });
        document.body.removeChild(bg);
        renderAll();
        toast('OK Заказ \u2116' + res.num + ' создан: ' + (order.client || order.phone), '#1a5252');
      }, function(err){
        bSave.disabled=false; bSave.textContent='Создать заказ';
        toast('\u26A0\uFE0F Не создался: '+err, '#BA7517');
      });
    });
    btns.appendChild(bSave);
    b.appendChild(btns);
    m.appendChild(h); m.appendChild(b);
    bg.appendChild(m);
    document.body.appendChild(bg);
    setTimeout(function(){ try{ iClient.focus(); }catch(e){} }, 50);
  }

  function openCard(num){
    var o = null;
    for(var i=0;i<ORDERS.length;i++){ if(String(ORDERS[i].num)===String(num)){ o=ORDERS[i]; break; } }
    if(!o) return;
    var bg = document.createElement('div'); bg.className='crm-modal-bg';
    bg.addEventListener('click', function(e){ if(e.target===bg) document.body.removeChild(bg); });
    var m = document.createElement('div'); m.className='crm-modal';
    var h = document.createElement('div'); h.className='crm-m-h';
    var title = document.createElement('b'); title.textContent = 'Заказ \u2116'+o.num;
    var x = document.createElement('button'); x.className='crm-m-x'; x.textContent='\u00D7';
    x.addEventListener('click', function(){ document.body.removeChild(bg); });
    h.appendChild(title); h.appendChild(x);
    var b = document.createElement('div'); b.className='crm-m-b';

    var selSt = document.createElement('select');
    STATUSES.forEach(function(s){ var op=document.createElement('option'); op.value=s; op.textContent=s; selSt.appendChild(op); });
    if(STATUSES.indexOf(o.status)>=0) selSt.value=o.status;
    var iClient = inp(o.client), iPhone = inp(o.phone), iCity = inp(o.city);
    var iFurn = inp(o.furn), iObj = inp(o.obj);
    var iNote = document.createElement('textarea'); iNote.rows=2; iNote.value=o.note||'';
    var iMount = inp(o.mountDate ? String(new Date(o.mountDate).getFullYear())+'-'+('0'+(new Date(o.mountDate).getMonth()+1)).slice(-2)+'-'+('0'+new Date(o.mountDate).getDate()).slice(-2) : '', 'date');
    var payWrap = document.createElement('div');
    payWrap.style.cssText = 'display:flex;gap:6px;align-items:center';
    var iPaid = inp(o.paid || 0, 'number');
    iPaid.readOnly = true;
    iPaid.style.cssText = 'flex:1;background:#f6f6f4;color:#777';
    iPaid.title = 'Заполняется автоматически из операций «Доплата» (вкладка Финансы)';
    var payBtn = document.createElement('button');
    payBtn.className = 'crm-vbtn new';
    payBtn.textContent = '+ Оплата';
    payBtn.addEventListener('click', function(){
      document.body.removeChild(bg);
      openFinModal({ type:'Приход', cat:'Доплата', num: String(o.num) });
    });
    payWrap.appendChild(iPaid); payWrap.appendChild(payBtn);

    b.appendChild(field('Статус', selSt));
    var r1 = document.createElement('div'); r1.className='crm-2col';
    r1.appendChild(field('Клиент', iClient));
    var phoneWrap = document.createElement('div');
    phoneWrap.style.display='flex'; phoneWrap.style.gap='6px'; phoneWrap.style.alignItems='center';
    iPhone.style.flex='1';
    phoneWrap.appendChild(iPhone);
    var telBtn = document.createElement('a');
    telBtn.textContent = '\uD83D\uDCDE';
    telBtn.style.cssText = 'text-decoration:none;font-size:16px;border:1px solid #ddd;border-radius:8px;padding:5px 8px';
    telBtn.href = o.phone ? 'tel:' + String(o.phone).replace(/[^+\d]/g,'') : '#';
    if(!o.phone) telBtn.style.opacity = '.35';
    phoneWrap.appendChild(telBtn);
    r1.appendChild(field('Телефон', phoneWrap));
    b.appendChild(r1);
    var r2 = document.createElement('div'); r2.className='crm-2col';
    r2.appendChild(field('Город', iCity)); r2.appendChild(field('Тип мебели', iFurn));
    b.appendChild(r2);
    b.appendChild(field('Адрес / объект', iObj));
    b.appendChild(field('Примечание', iNote));
    var r3 = document.createElement('div'); r3.className='crm-2col';
    r3.appendChild(field('Дата установки', iMount));
    r3.appendChild(field('Оплачено дополнительно, \u20B8', payWrap));
    b.appendChild(r3);

    var moneyWrap = document.createElement('div');
    function renderMoney(){
      moneyWrap.innerHTML = '';
      var g = document.createElement('div'); g.className='crm-money-grid';
      function gRow(k,v,cls){
        var a=document.createElement('span');a.textContent=k;
        var c=document.createElement('b');c.textContent=v;c.style.textAlign='right';
        if(cls) c.className = cls;
        g.appendChild(a);g.appendChild(c);
      }
      var chs = CH_LOADED ? changesOf(o.num) : [];
      var chSum = 0;
      chs.forEach(function(c){ chSum += Number(c.sum)||0; });
      gRow('Предв. цена', fm0(o.pred));
      if(chs.length){
        gRow('Цена по договору', fm0((Number(o.sogl)||0) - chSum));
        gRow('Изменения ('+chs.length+')', (chSum>=0 ? '+' : '\u2212') + fm0(Math.abs(chSum)));
        gRow('Итоговая цена', fm0(o.sogl));
      } else {
        gRow('Согл. цена', o.sogl ? fm0(o.sogl) : '\u2014');
      }
      gRow('Аванс', o.avans ? fm0(o.avans) : '\u2014');
      var debt = debtOf(o);
      if(debt < 0) gRow('Переплата', fm0(-debt), 'crm-over');
      else gRow('Долг', fm0(debt));
      gRow('Итог ЛДСП', fm0(o.totL));
      gRow('Итог Плёнка', fm0(o.totP));
      gRow('Итог Краска', fm0(o.totK));
      var marg = marginOf(o);
      var priceForCost = Number(o.sogl) > 0 ? Number(o.sogl)||0 : (Number(o.pred)||0);
      if(marg > 0 && priceForCost > 0){
        var cost = priceForCost - marg;
        var pct = Math.round(marg / priceForCost * 100);
        var isDog = Number(o.sogl) > 0;
        gRow(isDog ? 'Маржа (по договору)' : 'Маржа (предв.)', fm0(marg), 'crm-margin');
        gRow('Себестоимость', fm0(cost));
        gRow('Рентабельность', pct + '%');
      }
      gRow('Договор от', o.dogDate ? fmtDate(o.dogDate) : '\u2014');
      moneyWrap.appendChild(g);

      if((Number(o.sogl)||0) > 0){
        var box = document.createElement('div'); box.className='crm-ch-box';
        var bh = document.createElement('div'); bh.className='crm-ch-h';
        var bt = document.createElement('b'); bt.textContent = 'Изменения к договору';
        var add = document.createElement('button'); add.className='crm-vbtn new';
        add.textContent = '\u00B1 Изменение';
        add.addEventListener('click', function(){
          document.body.removeChild(bg);
          openChangeModal(o);
        });
        bh.appendChild(bt); bh.appendChild(add);
        box.appendChild(bh);
        if(!CH_LOADED){
          var ld = document.createElement('div'); ld.className='crm-ch-row';
          ld.textContent = 'Загружаю...';
          box.appendChild(ld);
        } else if(!chs.length){
          var em = document.createElement('div'); em.className='crm-ch-row';
          em.style.color = '#999';
          em.textContent = 'Клиент что-то добавил или убрал после договора \u2014 фиксируй здесь, а не новым договором.';
          box.appendChild(em);
        } else {
          chs.forEach(function(c, ci){
            var r = document.createElement('div'); r.className='crm-ch-row';
            var dt = document.createElement('span'); dt.className='dt'; dt.textContent = fmtDate(c.date);
            var ds = document.createElement('span'); ds.className='ds'; ds.textContent = c.desc;
            var sm = document.createElement('span'); sm.className = 'sm ' + (Number(c.sum)>=0 ? 'in' : 'out');
            sm.textContent = (Number(c.sum)>=0 ? '+' : '\u2212') + fm0(Math.abs(Number(c.sum)||0));
            var pr = document.createElement('button'); pr.className='prn'; pr.textContent='\uD83D\uDDA8';
            pr.title = 'Печать доп. соглашения \u2116' + (ci+1);
            pr.addEventListener('click', function(){
              printChangeAgreement(o, chs, ci);
            });
            var del = document.createElement('button'); del.className='del'; del.textContent='\u2715';
            del.title = 'Удалить изменение';
            del.addEventListener('click', function(){
              var sure = confirm('Удалить изменение \u00AB'+c.desc+'\u00BB? Итоговая цена и долг вернутся назад на '+fm0(Math.abs(Number(c.sum)||0))+'.');
              if(!sure) return;
              post({ action:'delChange', id: c.id }, function(res){
                CH = CH.filter(function(x){ return x.id !== c.id; });
                if(res && res.sogl !== undefined) o.sogl = Number(res.sogl)||0;
                renderMoney();
                renderAll();
                toast('OK Изменение удалено, цена и долг возвращены', '#1a5252');
              }, function(err){
                toast('\u26A0\uFE0F Не удалилось: '+err, '#BA7517');
              });
            });
            r.appendChild(dt); r.appendChild(ds); r.appendChild(sm); r.appendChild(pr); r.appendChild(del);
            box.appendChild(r);
          });
        }
        moneyWrap.appendChild(box);
      }
    }
    renderMoney();
    if(!CH_LOADED && (Number(o.sogl)||0) > 0){
      fetchChanges(function(err){ if(!err) renderMoney(); });
    }
    b.appendChild(moneyWrap);

    // ── Фото и заметки ──────────────────────────────────────
    var attWrap = document.createElement('div');
    function renderAttach(){
      attWrap.innerHTML = '';
      var box = document.createElement('div'); box.className='crm-ch-box';
      var bh = document.createElement('div'); bh.className='crm-ch-h';
      var bt = document.createElement('b'); bt.textContent = 'Фото и заметки';
      bh.appendChild(bt);
      box.appendChild(bh);

      var items = ATT_LOADED ? attachOf(o.num) : [];
      var files = items.filter(function(a){ return a.kind === 'файл' && a.fileId; });
      var notes = items.filter(function(a){ return a.kind !== 'файл'; });

      if(!ATT_LOADED){
        var ld = document.createElement('div'); ld.className='crm-ch-row';
        ld.textContent = 'Загружаю...';
        box.appendChild(ld);
      } else {
        if(files.length){
          var grid = document.createElement('div');
          grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;padding:8px 0';
          files.forEach(function(a){
            var cell = document.createElement('div');
            cell.style.cssText = 'position:relative;width:86px';
            var lnk = document.createElement('a');
            lnk.href = 'https://drive.google.com/file/d/' + a.fileId + '/view';
            lnk.target = '_blank'; lnk.rel = 'noopener';
            var im = document.createElement('img');
            im.src = 'https://drive.google.com/thumbnail?id=' + a.fileId + '&sz=w400';
            im.alt = a.name || 'фото';
            im.loading = 'lazy';
            im.style.cssText = 'width:86px;height:86px;object-fit:cover;border-radius:8px;border:1px solid #e5e5e0;display:block;background:#f6f6f4';
            lnk.appendChild(im);
            cell.appendChild(lnk);
            var del = document.createElement('button');
            del.textContent = '\u2715';
            del.title = 'Удалить фото';
            del.style.cssText = 'position:absolute;top:2px;right:2px;width:20px;height:20px;border:none;border-radius:50%;background:rgba(20,20,20,.55);color:#fff;font-size:10px;cursor:pointer;line-height:1;padding:0';
            del.addEventListener('click', function(){
              if(!confirm('Удалить фото' + (a.comment ? ' \u00AB' + a.comment + '\u00BB' : '') + '? Файл уйдёт в корзину Диска.')) return;
              post({ action:'delAttach', id: a.id }, function(){
                ATT = ATT.filter(function(x){ return x.id !== a.id; });
                renderAttach();
                toast('OK Фото удалено', '#1a5252');
              }, function(err){
                toast('\u26A0\uFE0F Не удалилось: ' + err, '#BA7517');
              });
            });
            cell.appendChild(del);
            if(a.comment){
              var cap = document.createElement('div');
              cap.textContent = a.comment;
              cap.title = a.comment;
              cap.style.cssText = 'font-size:10px;color:#888;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
              cell.appendChild(cap);
            }
            grid.appendChild(cell);
          });
          box.appendChild(grid);
        }
        notes.forEach(function(a){
          var r = document.createElement('div'); r.className='crm-ch-row';
          var dt = document.createElement('span'); dt.className='dt'; dt.textContent = fmtDate(a.created);
          var ds = document.createElement('span'); ds.className='ds'; ds.textContent = a.comment;
          var del = document.createElement('button'); del.className='del'; del.textContent='\u2715';
          del.title = 'Удалить заметку';
          del.addEventListener('click', function(){
            if(!confirm('Удалить заметку \u00AB' + a.comment + '\u00BB?')) return;
            post({ action:'delAttach', id: a.id }, function(){
              ATT = ATT.filter(function(x){ return x.id !== a.id; });
              renderAttach();
              toast('OK Заметка удалена', '#1a5252');
            }, function(err){
              toast('\u26A0\uFE0F Не удалилось: ' + err, '#BA7517');
            });
          });
          r.appendChild(dt); r.appendChild(ds); r.appendChild(del);
          box.appendChild(r);
        });
        if(!files.length && !notes.length){
          var em = document.createElement('div'); em.className='crm-ch-row';
          em.style.color = '#999';
          em.textContent = 'Фото с замера, производства, установки и рабочие заметки \u2014 всё по заказу в одном месте.';
          box.appendChild(em);
        }
      }

      var addRow = document.createElement('div');
      addRow.style.cssText = 'display:flex;gap:6px;align-items:center;padding-top:8px;flex-wrap:wrap';
      var fileInp = document.createElement('input');
      fileInp.type = 'file';
      fileInp.accept = 'image/*';
      fileInp.multiple = true;
      fileInp.style.display = 'none';
      var bPhoto = document.createElement('button'); bPhoto.className='crm-vbtn new';
      bPhoto.textContent = '\uD83D\uDCF7 Фото';
      bPhoto.title = 'Прикрепить фото (на телефоне откроется камера или галерея). Текст в поле справа станет подписью.';
      bPhoto.addEventListener('click', function(){ fileInp.value = ''; fileInp.click(); });
      var noteInp = document.createElement('input');
      noteInp.type = 'text';
      noteInp.placeholder = 'Заметка или подпись к фото...';
      noteInp.style.cssText = 'flex:1;min-width:140px';
      var bNote = document.createElement('button'); bNote.className='crm-vbtn';
      bNote.textContent = '+ Заметка';
      bNote.addEventListener('click', function(){
        var txt = noteInp.value.trim();
        if(!txt){ toast('\u26A0\uFE0F Напиши текст заметки', '#BA7517'); return; }
        bNote.disabled = true;
        post({ action:'addAttach', attach: { num: String(o.num), kind: 'коммент', comment: txt } }, function(res){
          ATT.push({ id: res.id, num: String(o.num), kind: 'коммент', name: '', fileId: '', comment: txt, created: new Date().toISOString() });
          renderAttach();
          toast('OK Заметка добавлена', '#1a5252');
        }, function(err){
          bNote.disabled = false;
          toast('\u26A0\uFE0F Не сохранилось: ' + err, '#BA7517');
        });
      });
      fileInp.addEventListener('change', function(){
        var list = [];
        for(var fi = 0; fi < fileInp.files.length; fi++) list.push(fileInp.files[fi]);
        if(!list.length) return;
        var cap = noteInp.value.trim();
        var done = 0, fail = 0;
        bPhoto.disabled = true; bNote.disabled = true;
        function next(){
          if(!list.length){
            renderAttach();
            if(done) toast('OK Загружено фото: ' + done + (fail ? ', не загрузилось: ' + fail : ''), '#1a5252');
            else toast('\u26A0\uFE0F Фото не загрузились \u2014 проверь интернет и попробуй ещё раз', '#BA7517');
            return;
          }
          var f = list.shift();
          bPhoto.textContent = 'Гружу... (' + (done + fail + 1) + ')';
          compressImage(f, function(b64){
            if(!b64){ fail++; next(); return; }
            var nm = String(f.name || 'фото.jpg').replace(/\.[^.]+$/, '') + '.jpg';
            post({ action:'addAttach', attach: { num: String(o.num), kind: 'файл', name: nm, mime: 'image/jpeg', dataB64: b64, comment: cap } }, function(res){
              ATT.push({ id: res.id, num: String(o.num), kind: 'файл', name: nm, fileId: res.fileId, comment: cap, created: new Date().toISOString() });
              done++;
              next();
            }, function(){ fail++; next(); });
          });
        }
        next();
      });
      addRow.appendChild(bPhoto); addRow.appendChild(noteInp); addRow.appendChild(bNote);
      box.appendChild(addRow);

      attWrap.appendChild(box);
    }
    renderAttach();
    if(!ATT_LOADED){
      fetchAttach(function(err){ if(!err) renderAttach(); });
    }
    b.appendChild(attWrap);

    var btns = document.createElement('div'); btns.className='crm-m-btns';
    var bDel = document.createElement('button'); bDel.className='crm-m-btn danger'; bDel.textContent='\uD83D\uDDD1';
    bDel.title = 'Удалить заказ из СРМ';
    bDel.addEventListener('click', function(){
      var chCnt = CH_LOADED ? changesOf(o.num).length : 0;
      var finCnt = 0;
      if(FIN_LOADED){
        FIN.forEach(function(f){ if(String(f.num)===String(o.num)) finCnt++; });
      }
      var w1 = 'Удалить заказ \u2116' + o.num + (o.client ? ' (' + o.client + ')' : '') + ' из СРМ?\n\n';
      w1 += 'Вместе с ним из таблицы удалятся снимок расчёта';
      if(chCnt) w1 += ' и изменения к договору (' + chCnt + ' шт.)';
      w1 += '.';
      if(finCnt) w1 += '\n\nОперации в Финансах (' + finCnt + ' шт.) останутся в кассе, но отвяжутся от \u2116 (пометка \u00abзаказ удалён\u00bb).';
      w1 += '\nЛокальная История в калькуляторе не затрагивается.';
      if(!confirm(w1)) return;
      if(!confirm('ВТОРОЕ ПРЕДУПРЕЖДЕНИЕ\n\nДействие необратимо: строку заказа и снимок расчёта в таблице восстановить будет НЕЛЬЗЯ.\n\nТочно удалить заказ \u2116' + o.num + '?')) return;
      bDel.disabled = true; bDel.textContent = '...';
      post({ action:'delOrder', num: String(o.num) }, function(res){
        ORDERS = ORDERS.filter(function(x){ return String(x.num) !== String(o.num); });
        CH = CH.filter(function(x){ return String(x.num) !== String(o.num); });
        FIN.forEach(function(f){
          if(String(f.num) === String(o.num)){
            f.num = '';
            f.comment = (f.comment ? f.comment + ' ' : '') + '(был заказ \u2116' + o.num + ', удалён)';
          }
        });
        document.body.removeChild(bg);
        renderAll();
        var extra = '';
        if(res && res.removedChanges) extra += ' (+' + res.removedChanges + ' измен.)';
        if(res && res.detachedFin) extra += ', операций отвязано: ' + res.detachedFin;
        toast('OK Заказ \u2116' + o.num + ' удалён из СРМ' + extra, '#1a5252');
      }, function(err){
        bDel.disabled = false; bDel.textContent = '\uD83D\uDDD1';
        toast('\u26A0\uFE0F Не удалилось: ' + err, '#BA7517');
      });
    });
    btns.appendChild(bDel);
    var bBuy = document.createElement('button'); bBuy.className='crm-m-btn'; bBuy.textContent='🛒 Список закупщику';
    bBuy.addEventListener('click', function(){
      if(typeof orderPurchase !== 'function'){ toast('⚠️ Калькулятор ещё не загрузился — открой вкладку расчёта', '#BA7517'); return; }
      bBuy.disabled = true; bBuy.textContent = 'Считаю...';
      loadOrderRec(o.num, function(err, rec){
        if(err){ bBuy.disabled=false; bBuy.textContent='🛒 Список закупщику'; toast('⚠️ '+err, '#BA7517'); return; }
        fetchStock(function(serr){
          bBuy.disabled=false; bBuy.textContent='🛒 Список закупщику';
          if(serr==='__no_key__'){ toast('⚠️ Введи ключ доступа', '#BA7517'); return; }
          if(serr){ toast('⚠️ Остатки не загрузились: '+serr, '#BA7517'); return; }
          var pur = orderPurchase(rec.snap, DB, STOCK);
          openPurchaseModal(o, pur);
        });
      });
    });
    var bIssue = document.createElement('button'); bIssue.className='crm-m-btn'; bIssue.textContent='📦 Выдать по заказу';
    bIssue.addEventListener('click', function(){
      if(typeof orderPurchase !== 'function'){ toast('⚠️ Калькулятор ещё не загрузился', '#BA7517'); return; }
      bIssue.disabled = true; bIssue.textContent = 'Считаю...';
      loadOrderRec(o.num, function(err, rec){
        if(err){ bIssue.disabled=false; bIssue.textContent='📦 Выдать по заказу'; toast('⚠️ '+err, '#BA7517'); return; }
        fetchStock(function(serr){
          bIssue.disabled=false; bIssue.textContent='📦 Выдать по заказу';
          if(serr==='__no_key__'){ toast('⚠️ Введи ключ доступа', '#BA7517'); return; }
          if(serr){ toast('⚠️ Остатки не загрузились: '+serr, '#BA7517'); return; }
          openIssueModal(o, orderPurchase(rec.snap, DB, STOCK));
        });
      });
    });
    var bOpen = document.createElement('button'); bOpen.className='crm-m-btn open'; bOpen.textContent='\uD83D\uDCC2 Открыть расчёт';
    bOpen.addEventListener('click', function(){
      var sure = confirm('Открыть расчёт заказа \u2116'+o.num+'? Текущий несохранённый расчёт в калькуляторе будет заменён.');
      if(!sure) return;
      bOpen.disabled = true; bOpen.textContent = 'Открываю...';
      openCalcFromOrder(o.num, o, function(err, prefilled){
        if(err){ toast('\u26A0\uFE0F '+err, '#BA7517'); bOpen.disabled=false; bOpen.textContent='\uD83D\uDCC2 Открыть расчёт'; return; }
        document.body.removeChild(bg);
        if(prefilled) toast('Новый расчёт для заказа \u2116'+o.num+' \u2014 заполни и сохрани', '#1a5252');
        else toast('OK Заказ \u2116'+o.num+' открыт в калькуляторе', '#1a5252');
      });
    });
    var bSave = document.createElement('button'); bSave.className='crm-m-btn save'; bSave.textContent='\uD83D\uDCBE Сохранить';
    bSave.addEventListener('click', function(){
      bSave.disabled = true; bSave.textContent = 'Сохраняю...';
      var upd = {
        num: String(o.num),
        status: selSt.value,
        client: iClient.value.trim(),
        obj: iObj.value.trim(),
        phone: iPhone.value.trim(),
        city: iCity.value.trim(),
        furn: iFurn.value.trim(),
        note: iNote.value.trim(),
        mountDate: iMount.value
      };
      post({ action:'updateOrder', order: upd }, function(){
        o.status=upd.status; o.client=upd.client; o.obj=upd.obj; o.phone=upd.phone;
        o.city=upd.city; o.furn=upd.furn; o.note=upd.note; o.mountDate=upd.mountDate;
        document.body.removeChild(bg);
        renderAll();
        toast('OK Заказ \u2116'+o.num+' обновлён', '#1a5252');
      }, function(err){
        bSave.disabled=false; bSave.textContent='\uD83D\uDCBE Сохранить';
        toast('\u26A0\uFE0F Не сохранилось: '+err, '#BA7517');
      });
    });
    btns.appendChild(bBuy); btns.appendChild(bIssue); btns.appendChild(bOpen); btns.appendChild(bSave);
    b.appendChild(btns);

    m.appendChild(h); m.appendChild(b);
    bg.appendChild(m);
    document.body.appendChild(bg);
  }

  // ── Список закупщику из заказа (order-driven) ────────────
  // Тянет снимок заказа, считает orderPurchase(снимок, прайс, остатки).
  function loadOrderRec(num, done){
    fetch(GS_URL + '?action=order&num=' + encodeURIComponent(num) + '&token=' + encodeURIComponent(getToken()))
      .then(function(r){ return r.json(); })
      .then(function(res){
        if(!res || !res.ok){ done((res && res.error) || 'таблица вернула ошибку'); return; }
        var snap = res.order && res.order.snapshot;
        if(!snap){ done('у заказа нет сохранённого снимка расчёта'); return; }
        var rec;
        try{ rec = JSON.parse(snap); }
        catch(e){ done('снимок повреждён (возможно, был слишком большим при сохранении)'); return; }
        if(!rec || !rec.snap){ done('снимок неполный'); return; }
        done(null, rec);
      })
      .catch(function(e){ done(String(e && e.message || e)); });
  }

  function openPurchaseModal(o, pur){
    var bg = document.createElement('div'); bg.className = 'crm-modal-bg';
    bg.addEventListener('click', function(e){ if(e.target===bg) document.body.removeChild(bg); });
    var m = document.createElement('div'); m.className = 'crm-modal';
    var h = document.createElement('div'); h.className = 'crm-m-h';
    var title = document.createElement('b'); title.textContent = 'Список закупщику — заказ \u2116' + o.num;
    var x = document.createElement('button'); x.className = 'crm-m-x'; x.textContent = '\u00D7';
    x.addEventListener('click', function(){ document.body.removeChild(bg); });
    h.appendChild(title); h.appendChild(x);
    var b = document.createElement('div'); b.className = 'crm-m-b';

    var tracked = (pur && pur.tracked) || [];
    var untracked = (pur && pur.untracked) || [];
    tracked.sort(function(a,c){ return (c.buy - a.buy) || String(a.name||a.key).localeCompare(String(c.name||c.key), 'ru'); });

    var toBuy = tracked.filter(function(t){ return t.buy > 0; }).length;
    var lead = document.createElement('div'); lead.className = 'crm-empty';
    lead.style.textAlign = 'left'; lead.style.padding = '4px 0';
    lead.textContent = toBuy ? ('Докупить позиций: ' + toBuy) : 'Всё есть на складе — докупать нечего.';
    b.appendChild(lead);

    var fmt = function(n){ n = Number(n) || 0; return Number.isInteger(n) ? String(n) : n.toFixed(2); };

    if(tracked.length){
      var t1 = document.createElement('b'); t1.textContent = 'Со складским учётом';
      t1.style.display = 'block'; t1.style.margin = '8px 0 4px';
      b.appendChild(t1);
      var tbl = document.createElement('table'); tbl.className = 'crm-ftbl';
      var thr = document.createElement('tr');
      ['Наименование','Ед','Нужно','Есть','Докупить'].forEach(function(hh){ var th=document.createElement('th'); th.textContent=hh; thr.appendChild(th); });
      tbl.appendChild(thr);
      tracked.forEach(function(t){
        var tr = document.createElement('tr');
        var c1 = document.createElement('td'); c1.textContent = String(t.name || t.key); tr.appendChild(c1);
        var c2 = document.createElement('td'); c2.textContent = String(t.unit || ''); tr.appendChild(c2);
        var c3 = document.createElement('td'); c3.textContent = fmt(t.need); tr.appendChild(c3);
        var c4 = document.createElement('td'); c4.textContent = String(t.have); tr.appendChild(c4);
        var c5 = document.createElement('td'); c5.textContent = String(t.buy);
        if(t.buy > 0){ c5.style.color = '#A32D2D'; c5.style.fontWeight = '500'; }
        tr.appendChild(c5);
        tbl.appendChild(tr);
      });
      b.appendChild(tbl);
    }

    if(untracked.length){
      var t2 = document.createElement('b'); t2.textContent = 'Без складского учёта';
      t2.style.display = 'block'; t2.style.margin = '12px 0 4px';
      b.appendChild(t2);
      var hint = document.createElement('div'); hint.className = 'crm-empty';
      hint.style.textAlign = 'left'; hint.style.fontSize = '11px'; hint.style.padding = '0 0 4px';
      hint.textContent = 'Нет артикула — проверь наличие вручную.';
      b.appendChild(hint);
      var tbl2 = document.createElement('table'); tbl2.className = 'crm-ftbl';
      var thr2 = document.createElement('tr');
      ['Наименование','Кол-во'].forEach(function(hh){ var th=document.createElement('th'); th.textContent=hh; thr2.appendChild(th); });
      tbl2.appendChild(thr2);
      untracked.forEach(function(u){
        var tr = document.createElement('tr');
        var c1 = document.createElement('td'); c1.textContent = String(u.n || ''); tr.appendChild(c1);
        var c2 = document.createElement('td'); c2.textContent = String(u.q); tr.appendChild(c2);
        tbl2.appendChild(tr);
      });
      b.appendChild(tbl2);
    }

    if(!tracked.length && !untracked.length){
      var e = document.createElement('div'); e.className = 'crm-empty';
      e.textContent = 'В заказе нет складских позиций.';
      b.appendChild(e);
    }

    m.appendChild(h); m.appendChild(b);
    bg.appendChild(m);
    document.body.appendChild(bg);
  }

  // ── Выдать по заказу (авто-Расход) + печать листа выдачи ──
  function openIssueModal(o, pur){
    var bg = document.createElement('div'); bg.className = 'crm-modal-bg';
    bg.addEventListener('click', function(e){ if(e.target===bg) document.body.removeChild(bg); });
    var m = document.createElement('div'); m.className = 'crm-modal';
    var h = document.createElement('div'); h.className = 'crm-m-h';
    var title = document.createElement('b'); title.textContent = 'Выдать по заказу \u2116' + o.num;
    var x = document.createElement('button'); x.className = 'crm-m-x'; x.textContent = '\u00D7';
    x.addEventListener('click', function(){ document.body.removeChild(bg); });
    h.appendChild(title); h.appendChild(x);
    var b = document.createElement('div'); b.className = 'crm-m-b';

    var tracked = (pur && pur.tracked) || [];
    var untracked = (pur && pur.untracked) || [];
    tracked.sort(function(a,c){ return String(a.name||a.key).localeCompare(String(c.name||c.key), 'ru'); });

    var lead = document.createElement('div'); lead.className = 'crm-empty';
    lead.style.textAlign = 'left'; lead.style.padding = '4px 0'; lead.style.fontSize = '11px';
    lead.textContent = 'Штуки предзаполнены, листы — целыми (подтверди сколько реально вскрыл). 0 — не выдавать.';
    b.appendChild(lead);

    var rows = [];
    if(tracked.length){
      var tbl = document.createElement('table'); tbl.className = 'crm-ftbl';
      var thr = document.createElement('tr');
      ['Наименование','Ед','Нужно','Есть','Выдать'].forEach(function(hh){ var th=document.createElement('th'); th.textContent=hh; thr.appendChild(th); });
      tbl.appendChild(thr);
      tracked.forEach(function(t){
        var need = Number(t.need) || 0;
        var def = t.unit === 'лист' ? Math.ceil(need - 1e-9) : Math.round(need);
        var tr = document.createElement('tr');
        var c1 = document.createElement('td'); c1.textContent = String(t.name || t.key); tr.appendChild(c1);
        var c2 = document.createElement('td'); c2.textContent = String(t.unit || ''); tr.appendChild(c2);
        var c3 = document.createElement('td'); c3.textContent = Number.isInteger(need) ? String(need) : need.toFixed(2); tr.appendChild(c3);
        var c4 = document.createElement('td'); c4.textContent = String(t.have); tr.appendChild(c4);
        var c5 = document.createElement('td');
        var iq = document.createElement('input'); iq.type = 'number'; iq.min = '0'; iq.step = '1'; iq.value = String(def); iq.style.width = '58px';
        c5.appendChild(iq); tr.appendChild(c5);
        tbl.appendChild(tr);
        rows.push({ key: t.key, name: t.name || t.key, unit: t.unit, have: t.have, input: iq });
      });
      b.appendChild(tbl);
    } else {
      var e0 = document.createElement('div'); e0.className = 'crm-empty'; e0.textContent = 'В заказе нет позиций со складским учётом.';
      b.appendChild(e0);
    }

    if(untracked.length){
      var un = document.createElement('div'); un.className = 'crm-empty';
      un.style.textAlign = 'left'; un.style.fontSize = '11px'; un.style.padding = '6px 0 0';
      un.textContent = 'Без артикула (в лист попадут, но со склада не списываются): ' + untracked.map(function(u){ return (u.n||'') + ' \u00D7' + u.q; }).join(', ');
      b.appendChild(un);
    }

    var btns = document.createElement('div'); btns.className = 'crm-m-btns';
    var bPrint = document.createElement('button'); bPrint.className = 'crm-m-btn'; bPrint.textContent = '\uD83D\uDDA8 Печать листа';
    bPrint.addEventListener('click', function(){ printIssueSheet(o, rows, untracked); });
    var bDo = document.createElement('button'); bDo.className = 'crm-m-btn save'; bDo.textContent = 'Выдать со склада';
    bDo.addEventListener('click', function(){
      var moves = [];
      for(var i=0;i<rows.length;i++){
        var q = Number(rows[i].input.value);
        if(!q) continue;
        if(!(q>0) || Math.round(q)!==q){ toast('\u26A0\uFE0F «Выдать» должно быть целым (' + rows[i].name + ')', '#BA7517'); return; }
        moves.push({ type:'Расход', key:rows[i].key, name:rows[i].name, unit:rows[i].unit, qty:Math.round(q), num:String(o.num), comment:'выдача по заказу' });
      }
      if(!moves.length){ toast('\u26A0\uFE0F Нечего выдавать — проставь количества', '#BA7517'); return; }
      bDo.disabled = true; bDo.textContent = 'Выдаю...';
      post({ action:'stockMove', stock:{ moves: moves } }, function(){
        document.body.removeChild(bg);
        if(VIEW==='stock') renderAll();
        toast('OK Выдано со склада: ' + moves.length + ' поз. по заказу \u2116' + o.num, '#1a5252');
      }, function(err){
        bDo.disabled = false; bDo.textContent = 'Выдать со склада';
        toast('\u26A0\uFE0F Не выдалось: ' + err, '#BA7517');
      });
    });
    btns.appendChild(bPrint); btns.appendChild(bDo);
    b.appendChild(btns);

    m.appendChild(h); m.appendChild(b);
    bg.appendChild(m);
    document.body.appendChild(bg);
  }

  function printIssueSheet(o, rows, untracked){
    var d = new Date();
    var dRu = ('0'+d.getDate()).slice(-2) + '.' + ('0'+(d.getMonth()+1)).slice(-2) + '.' + d.getFullYear();
    var H = '<html><head><meta charset="utf-8"><title>Лист выдачи \u2116' + escHtml(o.num) + '</title>';
    H += '<style>';
    H += 'body{font-family:"Times New Roman",Times,serif;font-size:12pt;color:#000;background:#fff;margin:0;line-height:1.4}';
    H += '.pg{max-width:210mm;margin:0 auto;padding:16mm 18mm;box-sizing:border-box}';
    H += 'h1{text-align:center;font-size:15pt;margin:0 0 6px}';
    H += '.meta{font-size:11pt;margin:0 0 8pt}';
    H += 'table{width:100%;border-collapse:collapse;margin-top:6pt;font-size:11pt}';
    H += 'th,td{border:1px solid #000;padding:4pt 6pt;text-align:left}';
    H += 'th{background:#eee}';
    H += 'td.n{text-align:center;width:34px}td.q{text-align:center;width:70px}td.u{text-align:center;width:56px}';
    H += '.note{font-size:10pt;margin-top:8pt}';
    H += '.sw{display:flex;gap:40px;margin-top:26pt;font-size:11pt}';
    H += '.sl{border-top:1px solid #000;padding-top:3pt;flex:1}';
    H += '.btn{position:fixed;top:14px;right:14px;background:#C9A96E;color:#fff;border:none;padding:9px 20px;border-radius:8px;font-size:13px;cursor:pointer}';
    H += '@media print{.btn{display:none!important}}';
    H += '</style></head><body>';
    H += '<button class="btn" onclick="window.print()">\uD83D\uDDA8 Печать / PDF</button>';
    H += '<div class="pg">';
    H += '<h1>Лист выдачи со склада</h1>';
    H += '<div class="meta">Заказ \u2116<b>' + escHtml(o.num) + '</b>';
    if(o.client) H += ' &nbsp; Клиент: ' + escHtml(o.client);
    if(o.obj) H += ' &nbsp; Объект: ' + escHtml(o.obj);
    H += '<br>Дата: ' + dRu + '</div>';
    H += '<table><tr><th>\u2116</th><th>Наименование</th><th>Ед</th><th>Выдать</th></tr>';
    var n = 0;
    rows.forEach(function(r){
      var q = Math.round(Number(r.input.value) || 0);
      if(!q) return;
      n++;
      H += '<tr><td class="n">' + n + '</td><td>' + escHtml(r.name) + '</td><td class="u">' + escHtml(r.unit) + '</td><td class="q">' + q + '</td></tr>';
    });
    if(!n) H += '<tr><td colspan="4" style="text-align:center">\u2014</td></tr>';
    H += '</table>';
    if(untracked && untracked.length){
      H += '<div class="note"><b>Без артикула (проверить вручную):</b> ';
      H += untracked.map(function(u){ return escHtml(u.n||'') + ' \u00D7' + u.q; }).join(', ');
      H += '</div>';
    }
    H += '<div class="sw"><div class="sl">Выдал (склад): ____________</div><div class="sl">Получил (сборщик): ____________</div></div>';
    H += '</div></body></html>';
    var w = window.open('','_blank');
    if(w){ w.document.write(H); w.document.close(); }
    else { toast('\u26A0\uFE0F Браузер заблокировал окно — разреши всплывающие окна', '#BA7517'); }
  }

  function openCalcFromOrder(num, orderInfo, done){
    fetch(GS_URL + '?action=order&num=' + encodeURIComponent(num) + '&token=' + encodeURIComponent(getToken()))
      .then(function(r){ return r.json(); })
      .then(function(res){
        if(!res || !res.ok){ done((res && res.error) || 'таблица вернула ошибку'); return; }
        var snap = res.order && res.order.snapshot;
        if(!snap){
          if(typeof window.prefillCalcForOrder !== 'function'){ done('калькулятор ещё не загрузился'); return; }
          window.prefillCalcForOrder(num, (orderInfo && orderInfo.client) || '', (orderInfo && orderInfo.obj) || '', (orderInfo && orderInfo.phone) || '');
          done(null, true);
          return;
        }
        var rec;
        try{ rec = JSON.parse(snap); }
        catch(e){ done('снимок повреждён (возможно, был слишком большим при сохранении)'); return; }
        if(!rec || !rec.ST || !rec.snap){ done('снимок неполный'); return; }
        if(typeof window.applySnap !== 'function'){ done('калькулятор ещё не загрузился'); return; }
        window.applySnap(rec);
        done(null, false);
      })
      .catch(function(e){ done(String(e && e.message || e)); });
  }

})();
