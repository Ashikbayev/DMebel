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
      '.crm-ftbl td.debt{color:#c0392b}';
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

  function renderFin(view){
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
    var days = daysInWork(o);
    var dayEl = document.createElement('span');
    if(days !== null){ dayEl.className='crm-days'; dayEl.textContent = days + ' дн.'; }
    l3.appendChild(dEl); l3.appendChild(dayEl);
    d.appendChild(l1); d.appendChild(l2);
    if(debt>0 || days!==null) d.appendChild(l3);
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
      money.textContent = fm0(o.sogl || o.pred) + (debt>0 ? ' / долг '+fm0(debt) : '');
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
    var iPaid = inp(o.paid || '', 'number'); iPaid.placeholder='0';

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
    r3.appendChild(field('Оплачено дополнительно, \u20B8', iPaid));
    b.appendChild(r3);

    var g = document.createElement('div'); g.className='crm-money-grid';
    function gRow(k,v){
      var a=document.createElement('span');a.textContent=k;
      var c=document.createElement('b');c.textContent=v;c.style.textAlign='right';
      g.appendChild(a);g.appendChild(c);
    }
    gRow('Предв. цена', fm0(o.pred));
    gRow('Согл. цена', o.sogl ? fm0(o.sogl) : '\u2014');
    gRow('Аванс', o.avans ? fm0(o.avans) : '\u2014');
    gRow('Долг', fm0(debtOf(o)));
    gRow('Итог ЛДСП', fm0(o.totL));
    gRow('Итог Плёнка', fm0(o.totP));
    gRow('Итог Краска', fm0(o.totK));
    gRow('Договор от', o.dogDate ? fmtDate(o.dogDate) : '\u2014');
    b.appendChild(g);

    var btns = document.createElement('div'); btns.className='crm-m-btns';
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
        mountDate: iMount.value,
        paid: parseFloat(iPaid.value) || 0
      };
      post({ action:'updateOrder', order: upd }, function(){
        o.status=upd.status; o.client=upd.client; o.obj=upd.obj; o.phone=upd.phone;
        o.city=upd.city; o.furn=upd.furn; o.note=upd.note; o.mountDate=upd.mountDate; o.paid=upd.paid;
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
