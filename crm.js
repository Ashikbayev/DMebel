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

  // ── Сохранение расчёта → заказ в таблице ──────────────────
  window.crmPushOrder = function(rec){
    if (!rec) return;
    var sn = splitSnap({ ST: rec.ST, snap: rec.snap });
    var order = {
      num:    String(rec.num || ''),
      client: rec.client || '',
      furn:   rec.obj || '',
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
  // Повторная генерация при существующем договоре ничем не грозит:
  // сервер вернёт protected и НЕ перезапишет цену/аванс/дату/статус.
  window.crmDogovorSigned = function(info){
    if (!info || !info.num) return;
    post({ action: 'updateOrder', order: {
      num:       String(info.num),
      status:    'Договор',
      soglPrice: Math.round(info.total || 0),
      avans:     Math.round(info.avans || 0),
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
    tools.appendChild(bBoard); tools.appendChild(bList); tools.appendChild(bFin);
    if(VIEW !== 'fin'){
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
  var CAT_IN  = ['Доплата','Прочий приход'];
  var CAT_OUT = ['Материалы','Оплата мастеру','Оплата дизайнеру','Аренда','Реклама','Транспорт','Инструмент','Прочее'];

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

  function renderFin(view){
    if(!FIN_LOADED){
      var ld = document.createElement('div'); ld.className='crm-empty';
      ld.textContent = 'Загружаю операции...';
      view.appendChild(ld);
      fetchFin(function(err){
        if(err){ ld.textContent = 'Операции не загрузились: ' + err; renderSales(view); return; }
        renderView();
      });
      return;
    }
    renderKassa(view);
    renderSales(view);
  }

  function renderKassa(view){
    var inc = 0, exp = 0, mInc = 0, mExp = 0;
    var nowKey = monthKey(new Date());
    FIN.forEach(function(f){
      var isIn = f.type === 'Приход';
      if(isIn) inc += f.sum; else exp += f.sum;
      if(monthKey(f.date) === nowKey){ if(isIn) mInc += f.sum; else mExp += f.sum; }
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
    tile('+' + fm0(mInc) + ' / −' + fm0(mExp), 'этот месяц');
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
    var iClient = inp(''), iPhone = inp(''), iCity = inp(''), iFurn = inp(''), iObj = inp('');
    iClient.placeholder = 'Имя клиента'; iPhone.placeholder = '+7 ...';
    iCity.placeholder = 'Сат / Жез'; iFurn.placeholder = 'Кухня / Шкаф / ...';
    var iNote = document.createElement('textarea'); iNote.rows=2;

    b.appendChild(field('Статус', selSt));
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
    var bOpen = document.createElement('button'); bOpen.className='crm-m-btn open'; bOpen.textContent='\uD83D\uDCC2 Открыть расчёт';
    bOpen.addEventListener('click', function(){
      var sure = confirm('Открыть расчёт заказа \u2116'+o.num+'? Текущий несохранённый расчёт в калькуляторе будет заменён.');
      if(!sure) return;
      bOpen.disabled = true; bOpen.textContent = 'Открываю...';
      openCalcFromOrder(o.num, function(err){
        if(err){ toast('\u26A0\uFE0F '+err, '#BA7517'); bOpen.disabled=false; bOpen.textContent='\uD83D\uDCC2 Открыть расчёт'; return; }
        document.body.removeChild(bg);
        toast('OK Заказ \u2116'+o.num+' открыт в калькуляторе', '#1a5252');
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
    btns.appendChild(bOpen); btns.appendChild(bSave);
    b.appendChild(btns);

    m.appendChild(h); m.appendChild(b);
    bg.appendChild(m);
    document.body.appendChild(bg);
  }

  function openCalcFromOrder(num, done){
    fetch(GS_URL + '?action=order&num=' + encodeURIComponent(num) + '&token=' + encodeURIComponent(getToken()))
      .then(function(r){ return r.json(); })
      .then(function(res){
        if(!res || !res.ok){ done((res && res.error) || 'таблица вернула ошибку'); return; }
        var snap = res.order && res.order.snapshot;
        if(!snap){ done('у заказа нет сохранённого снимка расчёта'); return; }
        var rec;
        try{ rec = JSON.parse(snap); }
        catch(e){ done('снимок повреждён (возможно, был слишком большим при сохранении)'); return; }
        if(!rec || !rec.ST || !rec.snap){ done('снимок неполный'); return; }
        if(typeof window.applySnap !== 'function'){ done('калькулятор ещё не загрузился'); return; }
        window.applySnap(rec);
        done(null);
      })
      .catch(function(e){ done(String(e && e.message || e)); });
  }

})();
