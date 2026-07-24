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

  // Лайтбокс: увеличенный просмотр фото заказа. files — массив вложений
  // с полями fileId/comment (тот же формат, что в attachOf), idx — с какого
  // открыть. Строит оверлей поверх всего, стрелки листают, полоска миниатюр
  // снизу, Esc/клик по фону закрывает.
  function openLightbox(files, idx){
    if(!files || !files.length) return;
    var cur = idx || 0;
    var bg = document.createElement('div'); bg.className = 'crm-lb-bg';
    bg.addEventListener('click', function(e){ if(e.target === bg) close(); });
    var xBtn = document.createElement('button'); xBtn.className = 'crm-lb-x'; xBtn.textContent = '\u2715';
    xBtn.title = 'Закрыть'; xBtn.addEventListener('click', close);
    var main = document.createElement('div'); main.className = 'crm-lb-main';
    // main растянут на всю ширину и перекрывает фон — без своего
    // обработчика клик по тёмной области вокруг фото не закрывал бы
    // лайтбокс (до bg событие не доходит).
    main.addEventListener('click', function(e){ if(e.target === main) close(); });
    var prev = document.createElement('button'); prev.className = 'crm-lb-arrow'; prev.textContent = '\u2039';
    prev.title = 'Предыдущее фото'; prev.addEventListener('click', function(){ go(-1); });
    var next = document.createElement('button'); next.className = 'crm-lb-arrow'; next.textContent = '\u203A';
    next.title = 'Следующее фото'; next.addEventListener('click', function(){ go(1); });
    var img = document.createElement('img'); img.className = 'crm-lb-img';
    main.appendChild(prev); main.appendChild(img); main.appendChild(next);
    var cap = document.createElement('div'); cap.className = 'crm-lb-cap';
    var strip = document.createElement('div'); strip.className = 'crm-lb-strip';
    var thumbs = files.map(function(a, i){
      var t = document.createElement('img'); t.className = 'crm-lb-thumb';
      t.src = 'https://drive.google.com/thumbnail?id=' + a.fileId + '&sz=w150';
      t.alt = a.comment || 'фото';
      t.addEventListener('click', function(){ cur = i; render(); });
      strip.appendChild(t);
      return t;
    });
    function render(){
      var a = files[cur];
      img.src = 'https://drive.google.com/thumbnail?id=' + a.fileId + '&sz=w1600';
      img.alt = a.comment || 'фото';
      cap.textContent = a.comment || '';
      cap.style.display = a.comment ? '' : 'none';
      prev.disabled = cur <= 0;
      next.disabled = cur >= files.length - 1;
      thumbs.forEach(function(t, i){ t.className = 'crm-lb-thumb' + (i === cur ? ' on' : ''); });
      thumbs[cur].scrollIntoView({ block: 'nearest', inline: 'center' });
    }
    function go(d){
      var n = cur + d;
      if(n < 0 || n >= files.length) return;
      cur = n; render();
    }
    function onKey(e){
      if(e.key === 'Escape') close();
      else if(e.key === 'ArrowLeft') go(-1);
      else if(e.key === 'ArrowRight') go(1);
    }
    function close(){
      document.removeEventListener('keydown', onKey);
      if(bg.parentNode) bg.parentNode.removeChild(bg);
    }
    document.addEventListener('keydown', onKey);
    bg.appendChild(xBtn); bg.appendChild(main); bg.appendChild(cap);
    if(files.length > 1) bg.appendChild(strip);
    document.body.appendChild(bg);
    render();
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
      .catch(function(e){ if (onErr) onErr(String(e && e.message || e), true); });
  }

  // ── v4.8: очередь неотправленных операций кассы (offline retry).
  // Только для addFin: у них есть op_id, повтор безопасен —
  // сервер узнаёт токен и отвечает dup:true без второй строки.
  var Q_KEY = 'moff_pending_ops';
  var Q_FLUSHING = false;
  function qLoad(){
    try { return JSON.parse(localStorage.getItem(Q_KEY) || '[]'); } catch(e){ return []; }
  }
  function qSave(a){
    try { localStorage.setItem(Q_KEY, JSON.stringify(a)); } catch(e){}
    qBadge();
  }
  function qAdd(fin){ var a = qLoad(); a.push(fin); qSave(a); }
  function qBadge(){
    var n = qLoad().length;
    var el = document.getElementById('moff-q-badge');
    if(!n){ if(el) el.style.display = 'none'; return; }
    if(!el){
      el = document.createElement('div');
      el.id = 'moff-q-badge';
      el.style.cssText = 'position:fixed;left:12px;bottom:64px;z-index:9999;background:#FAEEDA;color:#854F0B;border:1px solid #EF9F27;border-radius:20px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit';
      el.addEventListener('click', function(){ qFlush(); });
      document.body.appendChild(el);
    }
    el.style.display = 'block';
    el.textContent = '\u23F3 ' + n + ' в очереди — нажми, чтобы отправить';
  }
  function qFlush(){
    if(Q_FLUSHING) return;
    if(!qLoad().length){ qBadge(); return; }
    Q_FLUSHING = true;
    var sent = 0;
    function step(){
      var cur = qLoad();
      if(!cur.length){
        Q_FLUSHING = false;
        qBadge();
        if(sent){ toast('OK очередь отправлена: ' + sent, '#1a5252'); if(window.crmReload) window.crmReload(); }
        return;
      }
      var fin = cur[0];
      function drop(){
        var b = qLoad().filter(function(x){ return x.opId !== fin.opId; });
        qSave(b);
      }
      post({ action:'addFin', fin: fin }, function(){
        drop(); sent++; step();
      }, function(err, isNet){
        Q_FLUSHING = false;
        if(!isNet){
          drop();
          toast('\u26A0\uFE0F Операция из очереди отклонена: ' + err, '#BA7517');
        }
        qBadge();
      });
    }
    step();
  }
  window.addEventListener('online', function(){ qFlush(); });

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
    // v4.13: себестоимость план/факт из корректировки — если в rec есть
    // (saveCalc() прикладывает их через korrPayload(), только когда в
    // расчёте есть хоть одна позиция). costDelta сервер считает сам
    // из пары план/факт — отдельно его не шлём.
    if (rec.costPlan !== undefined) order.costPlan = rec.costPlan;
    if (rec.costFact !== undefined) order.costFact = rec.costFact;
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
  var BOARD_GROUPS = {
    sale: ['Замер','Дизайн','Расчет','Согласование','Договор'],
    prod: ['Контрольный замер','Закупка','Сборка','Установка','Доделки','Готова'],
    archive: ['Отказ','Отложено']
  };
  // v4.11: Источник лида — просто метка канала, без суб-полей.
  var LEAD_SOURCES = ['Реклама', 'Сарафан', 'Партнёр'];
  var ORDERS = [];
  var LOADED = false;
  var VIEW = localStorage.getItem('moff_crm_view') || 'board';
  var BOARD_TAB = localStorage.getItem('moff_crm_board_tab') || 'sale';
  var STALE_ONLY = false;
  var CAL_MONTH = monthKey(new Date());
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

  // Плитка сводки (v4.6). Раньше эта функция была объявлена девять раз
  // почти дословно в разных отчётах — правка стиля или разметки требовала
  // обойти все копии, и они успели разойтись (где-то третий аргумент был
  // булевым, где-то строкой 'warn'). Здесь warn просто truthy — работают
  // оба прежних варианта вызова.
  function sumTile(host, v, k, warn){
    var t = document.createElement('div'); t.className='crm-sum-t';
    var ve = document.createElement('div'); ve.className='v'+(warn?' warn':''); ve.textContent=v;
    var ke = document.createElement('div'); ke.className='k'; ke.textContent=k;
    t.appendChild(ve); t.appendChild(ke);
    if(host) host.appendChild(t);
    return t;
  }
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
  // Сколько дней заказ не двигали (v4.6). Опирается на колонку
  // «Обновлён» — её пишут createOrder_/saveOrder_/updateOrder_/
  // bumpOrderSogl_, то есть смена статуса, цены, расчёта, договора.
  // ⚠️ Фото и платежи «Обновлён» НЕ трогают (addAttach_ намеренно
  // работает вне общего lock, чтобы загрузка фото не вешала очередь) —
  // так что индикатор означает «сделка не движется», а не «по заказу
  // вообще ничего не происходило».
  // Финальные статусы не считаем: закрытый заказ не должен гореть вечно.
  var STALE_DAYS = 7;
  function staleDays(o){
    if(['Готова','Отказ','Отложено'].indexOf(o.status) >= 0) return null;
    if(!o.updated) return null;
    var d = new Date(o.updated);
    if(isNaN(d.getTime())) return null;
    return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
  }
  // Поправка маржи на изменения после договора (v4.6).
  // o.margin зафиксирована при подписании и «±Изменение» её не двигает
  // (bumpOrderSogl_ меняет только цену и долг). При этом отчёт берёт
  // ТЕКУЩУЮ sogl — из-за этого дозаказ целиком записывался в
  // себестоимость и занижал рентабельность. Здесь считаем, сколько
  // маржи реально принесли изменения: (сумма − себестоимость).
  // Изменения без себестоимости (старые записи, или просто не знали)
  // в поправку не идут и возвращаются счётчиком unknown — отчёт про них
  // честно предупреждает, вместо того чтобы молча считать их бесплатными.
  function marginAdjOf(num){
    var adj = 0, unknown = 0, unknownSum = 0;
    changesOf(num).forEach(function(c){
      var hasCost = !(c.cost === '' || c.cost === null || c.cost === undefined);
      if(!hasCost){ unknown++; unknownSum += Number(c.sum)||0; return; }
      adj += (Number(c.sum)||0) - (Number(c.cost)||0);
    });
    return { adj: adj, unknown: unknown, unknownSum: unknownSum };
  }
  function debtOf(o){
    var s = Number(o.sogl)||0;
    if(!s) return 0;
    return s - (Number(o.avans)||0) - (Number(o.paid)||0);
  }

  // ── Единое определение «сделки» (v4.14) ─────────────────────────
  // До этого «Продажи» и «Аналитика» считали договоры по разным правилам
  // и показывали разный средний чек на соседних вкладках. Теперь правило
  // одно: сделка — это НЕ отказ и с согласованной ценой.
  //
  // Дата договора здесь намеренно НЕ требуется: если её забыли проставить
  // руками, выкинуть живые деньги из выручки хуже, чем показать их без
  // даты. В помесячную разбивку такой заказ всё равно не попадёт —
  // группировать не по чему, — поэтому он выводится отдельной строкой,
  // чтобы дату дозаполнили, а не чтобы сумма потерялась молча.
  function isDeal(o){
    return !!o && o.status !== '\u041e\u0442\u043a\u0430\u0437' && Number(o.sogl) > 0;
  }
  // Сделка, которую можно отнести к месяцу (есть дата договора).
  function isDatedDeal(o){ return isDeal(o) && !!o.dogDate && !!monthKey(o.dogDate); }

  // Инициалы мастера для аватара на карточке доски (v4.6).
  // EMP на доску не грузится по умолчанию — подтягивается фоном в
  // renderBoard, до этого аватара просто нет (не блокируем доску).
  function initialsOf(name){
    var parts = String(name || '').trim().split(/\s+/);
    if(!parts[0]) return '';
    var s = parts[0].charAt(0);
    if(parts[1]) s += parts[1].charAt(0);
    return s.toUpperCase();
  }
  function masterOf(o){
    if(!o.masterId || !EMP_LOADED) return null;
    for(var i=0;i<EMP.length;i++){
      if(String(EMP[i].id) === String(o.masterId)) return EMP[i];
    }
    return null;
  }

  // ── WhatsApp: телефон → формат wa.me + заготовка текста ──
  // Казахстанская запись 8 7XX XXX XX XX приводится к 7 7XX...,
  // 10 цифр без кода страны получают 7 спереди. Если из телефона
  // не собирается полный международный номер — кнопка гаснет.
  function waPhone(phone){
    var d = String(phone || '').replace(/\D/g, '');
    if(!d) return '';
    if(d.length === 11 && d.charAt(0) === '8') d = '7' + d.slice(1);
    else if(d.length === 10) d = '7' + d;
    return d.length >= 11 ? d : '';
  }

  // Текст под статус заказа: подставится в поле ввода WhatsApp,
  // перед отправкой его можно поправить. Ничего не уходит само.
  function waText(o){
    var first = String(o.client || '').trim().split(/\s+/)[0];
    var t = 'Здравствуйте' + (first ? ', ' + first : '') + '! Это MebelOFF, по вашему заказу \u2116' + o.num + '.';
    var s = String(o.status || '');
    if(s === 'Замер') return t + ' Хотим согласовать удобное время замера.';
    if(s === 'Согласование') return t + ' Отправили вам расчёт \u2014 будем рады обсудить.';
    if(s === 'Контрольный замер') return t + ' Хотим согласовать время контрольного замера.';
    if(s === 'Установка' || s === 'Доделки') return t + ' Готовы согласовать время установки.';
    if(s === 'Готова'){
      var d = debtOf(o);
      if(d > 0) return t + ' Мебель готова! Остаток к оплате: ' + fm0(d) + '.';
      return t + ' Мебель готова!';
    }
    return t;
  }

  // ── Повторный клиент: все заказы с тем же телефоном ──────
  // Сравнение через waPhone-нормализацию: 8 7XX и +7 7XX — один номер.
  function ordersByPhone(phone, exceptNum){
    var me = waPhone(phone);
    if(!me) return [];
    var out = [];
    for(var i=0;i<ORDERS.length;i++){
      var o = ORDERS[i];
      if(exceptNum !== undefined && String(o.num) === String(exceptNum)) continue;
      if(waPhone(o.phone) === me) out.push(o);
    }
    return out;
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

  // ── Материал заказа: 'L' ЛДСП / 'P' МДФ Плёнка / 'K' МДФ Краска ──
  // До договора — явный выбор в карточке (o.material), если задан, иначе
  // старая эвристика (что совпадает с Предв. ценой). После договора —
  // ВСЕГДА по факту (что совпало с Согл. ценой): договор — обязательство
  // на конкретный материал, o.material его больше не переопределяет.
  function materialOf(o){
    var tL = Number(o.totL)||0, tP = Number(o.totP)||0, tK = Number(o.totK)||0;
    if(Number(o.sogl) > 0){
      var s = Number(o.sogl);
      if(tL === s) return 'L';
      if(tP === s) return 'P';
      if(tK === s) return 'K';
      // Сумма не совпала ни с одним итогом (скидка/изменения после
      // договора) — используем то, что было выбрано на момент подписания.
      if(o.material === 'L' || o.material === 'P' || o.material === 'K') return o.material;
      if(tL > 0) return 'L'; if(tP > 0) return 'P'; if(tK > 0) return 'K';
      return 'L';
    }
    if(o.material === 'L' || o.material === 'P' || o.material === 'K') return o.material;
    var pred = Number(o.pred)||0;
    if(pred > 0){
      if(tL === pred) return 'L';
      if(tP === pred) return 'P';
      if(tK === pred) return 'K';
    }
    if(tL > 0) return 'L'; if(tP > 0) return 'P'; if(tK > 0) return 'K';
    return 'L';
  }
  function materialLabel(m){ return m === 'P' ? 'МДФ Плёнка' : (m === 'K' ? 'МДФ Краска' : 'ЛДСП'); }
  function materialTotal(o, m){ return m === 'P' ? (Number(o.totP)||0) : (m === 'K' ? (Number(o.totK)||0) : (Number(o.totL)||0)); }
  function materialMargin(o, m){ return m === 'P' ? (Number(o.margP)||0) : (m === 'K' ? (Number(o.margK)||0) : (Number(o.margL)||0)); }
  // Только "корпус" (фасад в этой ветке, скорее всего, не заполнялся) —
  // сигнал: сумма этой ветки СОВПАДАЕТ с суммой другой ветки. Раздельные
  // цены фасада почти никогда не совпадают между собой случайно, а вот
  // "фасад не занесён" в двух ветках сразу даёт одинаковый корпус.
  function materialIsBareCarcass(o, m){
    var t = materialTotal(o, m);
    if(!(t > 0)) return false;
    var others = ['L','P','K'].filter(function(x){ return x !== m; });
    for(var i=0;i<others.length;i++){
      if(materialTotal(o, others[i]) === t) return true;
    }
    return false;
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
      '.crm-tools input,.crm-tools select{font-size:12px;border:1px solid var(--bd);border-radius:8px;padding:7px 10px}'+
      '.crm-vbtn{font-size:12px;border:1px solid var(--bd);background:#fff;border-radius:8px;padding:7px 12px;cursor:pointer;color:#555}'+
      '.crm-vbtn.on{background:#1a5252;color:#fff;border-color:#1a5252}'+
      '.crm-vgroup{display:flex;gap:2px;background:var(--bg);border-radius:8px;padding:3px}'+
      '.crm-vgroup .crm-vbtn{border:none;background:none;border-radius:6px;padding:6px 11px;color:#8A8A86}'+
      '.crm-vgroup .crm-vbtn.on{background:#fff;color:#0B0B0B;box-shadow:0 1px 2px rgba(0,0,0,.08)}'+
      '.crm-count{font-size:11px;color:#999;margin-left:auto}'+
      '.crm-board-tabs{display:flex;gap:4px;margin-bottom:10px;border-bottom:1px solid var(--bd)}'+
      '.crm-board-tab{border:none;border-bottom:2px solid transparent;background:none;color:#8A8A86;font-size:12px;font-weight:600;padding:6px 10px 8px;border-radius:0;cursor:pointer}'+
      '.crm-board-tab.on{background:none;color:#0B0B0B;border-bottom-color:#1a5252}'+
      '.crm-board{display:flex;gap:10px;overflow-x:auto;padding-bottom:12px;align-items:flex-start}'+
      '.crm-col{min-width:180px;max-width:180px;background:var(--bg);border-radius:10px;padding:6px;flex-shrink:0;display:flex;flex-direction:column;max-height:calc(100vh - 320px)}'+
      '.crm-col-h{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#444;padding:2px 4px 8px;flex-shrink:0}'+
      '.crm-col-cards{overflow-y:auto;min-height:0}'+
      '.crm-col-h .dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}'+
      '.crm-col-h .cnt{margin-left:auto;font-size:11px;color:#999;font-weight:400}'+
      '.crm-card{background:#fff;border-radius:8px;margin-bottom:6px;cursor:pointer;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);display:flex}'+
      '.crm-card:hover{box-shadow:0 2px 8px rgba(0,0,0,.12)}'+
      '.crm-card-strip{width:3px;flex-shrink:0}'+
      '.crm-modal-strip{height:4px}'+
      '.crm-card-b{padding:7px 9px;flex:1;min-width:0}'+
      '.crm-card .sum{font-size:15px;font-weight:700;color:#222;display:flex;align-items:center;gap:5px}'+
      '.crm-stale{display:inline-block;width:6px;height:6px;border-radius:50%;background:#BA1B1B;flex-shrink:0}'+
      '.crm-card .l1{display:flex;justify-content:space-between;gap:6px;font-size:12px;font-weight:600;color:#222}'+
      '.crm-card .l2{font-size:11px;color:#666;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'+
      '.crm-card .l3{display:flex;justify-content:space-between;gap:6px;font-size:11px;margin-top:4px;align-items:center}'+
      '.crm-ava{width:20px;height:20px;border-radius:50%;background:#1a5252;color:#fff;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}'+
      '.crm-daysb{font-size:10px;background:#f1efe8;color:#5F5E5A;padding:2px 7px;border-radius:10px;margin-left:auto}'+
      '.crm-debt{color:#c0392b;font-weight:600}'+
      '.crm-list{display:flex;flex-direction:column;gap:6px}'+
      '.crm-row{display:flex;gap:8px;align-items:center;background:#fff;border:1px solid var(--bd);border-radius:8px;padding:8px 10px;cursor:pointer;flex-wrap:wrap}'+
      '.crm-row:hover{border-color:#1a5252}'+
      '.crm-badge{font-size:10px;color:#fff;border-radius:10px;padding:2px 8px;white-space:nowrap}'+
      '.crm-row .num{font-size:12px;font-weight:700;color:#222;min-width:44px}'+
      '.crm-row .cli{font-size:12px;color:#333;flex:1;min-width:120px}'+
      '.crm-row .sub{font-size:11px;color:#888}'+
      '.crm-row .money{font-size:12px;font-weight:600;color:#222;margin-left:auto}'+
      '.crm-arch-cnt{font-size:11px;color:#999;margin-bottom:6px}'+
      '.crm-arch-row{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid var(--bd);border-radius:8px;padding:8px 10px;margin-bottom:6px;max-height:90px;overflow:hidden;transition:max-height .3s ease,opacity .3s ease,padding .3s ease,margin .3s ease,border-width .3s ease}'+
      '.crm-arch-row.crm-arch-leaving{max-height:0;opacity:0;padding-top:0;padding-bottom:0;margin-bottom:0;border-width:0}'+
      '.crm-arch-strip{width:4px;align-self:stretch;border-radius:2px;flex-shrink:0}'+
      '.crm-arch-av{width:28px;height:28px;border-radius:50%;background:#1a5252;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}'+
      '.crm-arch-mid{flex:1;min-width:0}'+
      '.crm-arch-t{font-size:12px;font-weight:600;color:#222;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
      '.crm-arch-sub{font-size:11px;color:#888;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
      '.crm-arch-right{text-align:right;flex-shrink:0}'+
      '.crm-arch-sum{font-size:13px;font-weight:700;color:#222}'+
      '.crm-arch-upd{font-size:10px;color:#999}'+
      '.crm-sk{background:#eee;border-radius:4px;animation:crmPulse 1.3s ease-in-out infinite}'+
      '@keyframes crmPulse{0%{opacity:.45}50%{opacity:.9}100%{opacity:.45}}'+
      '.crm-empty{font-size:12px;color:#999;padding:20px;text-align:center}'+
      '.crm-modal-bg{position:fixed;inset:0;background:rgba(20,20,20,.5);z-index:9999;display:flex;align-items:center;justify-content:center}'+
      '.crm-modal{background:#fff;border-radius:12px;max-width:480px;width:94%;max-height:88vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)}'+
      '.crm-m-h{padding:14px 16px;border-bottom:1px solid var(--bd);display:flex;align-items:center;gap:8px;position:sticky;top:0;background:#fff;z-index:2}'+
      '.crm-m-h b{font-size:14px;color:#222}'+
      '.crm-m-x{margin-left:auto;background:none;border:none;font-size:20px;cursor:pointer;color:#999;line-height:1}'+
      '.crm-m-b{padding:12px 16px}'+
      '.crm-f{margin-bottom:8px}'+
      '.crm-f label{display:block;font-size:10px;color:#999;margin-bottom:3px}'+
      '.crm-f input,.crm-f select,.crm-f textarea{width:100%;font-size:12px;border:1px solid var(--bd);border-radius:8px;padding:7px 9px;box-sizing:border-box;font-family:inherit}'+
      '.crm-2col{display:flex;gap:8px}.crm-2col .crm-f{flex:1}'+
      '.crm-money-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;background:var(--bg);border-radius:8px;padding:10px;margin-bottom:10px;font-size:11px;color:#555}'+
      '.crm-money-grid b{color:#222;font-size:12px}'+
      '.crm-m-btns{display:flex;gap:8px;margin-top:12px;position:sticky;bottom:0;background:#fff;padding:10px 0;box-shadow:0 -8px 12px -10px rgba(0,0,0,.18)}'+
      '.crm-m-btn{flex:1;padding:10px;border-radius:8px;border:none;font-size:12px;font-weight:600;cursor:pointer}'+
      '.crm-m-btn.save{background:#1a5252;color:#fff}'+
      '.crm-m-btn.open{background:#fff;color:#1a5252;border:1px solid #1a5252}'+
      '.crm-m-btn.danger{background:#fff;color:#c0392b;border:1px solid #e0b4ae;flex:0 0 auto;padding:10px 14px}'+
      '.crm-sum{display:flex;flex-wrap:wrap;gap:28px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--bd)}'+
      '.crm-sum-t{background:none;border:none;border-radius:0;padding:0}'+
      '.crm-sum-t .v{font-size:19px;font-weight:700;color:#0B0B0B;white-space:nowrap}'+
      '.crm-sum-t .v.warn{color:#c0392b}'+
      '.crm-sum-t .k{font-size:11px;color:#8A8A86;margin-top:1px}'+
      '.crm-cityb{font-size:11px;border:1px solid var(--bd);background:#fff;border-radius:14px;padding:5px 11px;cursor:pointer;color:#666}'+
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
      '.crm-chart{background:#fff;border:1px solid var(--bd);border-radius:10px;padding:14px 12px 6px;margin-bottom:10px}'+
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
      '.crm-ftbl{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--bd);border-radius:10px;overflow:hidden}'+
      '.crm-ftbl th{font-size:10px;color:#999;text-align:right;padding:8px 10px;border-bottom:1px solid var(--bd);font-weight:600}'+
      '.crm-ftbl th:first-child{text-align:left}'+
      '.crm-ftbl td{font-size:11px;color:#333;text-align:right;padding:7px 10px;border-bottom:1px solid #f5f5f3}'+
      '.crm-ftbl td:first-child{text-align:left;font-weight:600;color:#222}'+
      '.crm-ftbl tr:last-child td{border-bottom:none}'+
      '.crm-ftbl td.debt{color:#c0392b}'+
      '.crm-ops{background:#fff;border:1px solid var(--bd);border-radius:10px;margin-bottom:10px;overflow:hidden}'+
      '.crm-ops-h{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #f0f0ee}'+
      '.crm-ops-h b{font-size:12px;color:#444}'+
      '.crm-op{display:flex;gap:8px;align-items:center;padding:7px 12px;font-size:11px;color:#555;border-bottom:1px solid #f7f7f5;flex-wrap:wrap;max-height:60px;overflow:hidden;transition:max-height .3s ease,opacity .3s ease,padding .3s ease,border-width .3s ease}'+
      '.crm-op:last-child{border-bottom:none}'+
      '.crm-op.crm-op-leaving{max-height:0;opacity:0;padding-top:0;padding-bottom:0;border-width:0}'+
      '.crm-op .dt{color:#999;min-width:64px}'+
      '.crm-op .cat{font-weight:600;color:#333}'+
      '.crm-op .cmt{color:#999;flex:1;min-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'+
      '.crm-op .sm{font-weight:700;margin-left:auto;white-space:nowrap}'+
      '.crm-op .sm.in{color:#0F6E56}'+
      '.crm-op .sm.out{color:#c0392b}'+
      '.crm-op .del{background:none;border:none;color:#ccc;cursor:pointer;font-size:13px;line-height:1;padding:2px}'+
      '.crm-op .del:hover{color:#c0392b}'+
      '.crm-task-badge{background:#c0392b;color:#fff;border-radius:8px;padding:1px 6px;font-size:10px;margin-left:4px;vertical-align:middle}'+
      '.crm-tasklist{background:#fff;border:1px solid var(--bd);border-radius:10px;overflow:hidden}'+
      '.crm-task-row{display:flex;align-items:center;gap:10px;padding:9px 14px;font-size:12px;color:#555;border-bottom:1px solid #f7f7f5;max-height:60px;overflow:hidden;transition:max-height .3s ease,opacity .3s ease,padding .3s ease,border-width .3s ease}'+
      '.crm-task-row:last-child{border-bottom:none}'+
      '.crm-task-row.crm-task-leaving{max-height:0;opacity:0;padding-top:0;padding-bottom:0;border-width:0}'+
      '.crm-task-row.compact{padding:5px 0;border-bottom:1px solid #f7f7f5;max-height:40px}'+
      '.crm-task-row .tx{flex:1}'+
      '.crm-task-row .tx.done{color:#aaa;text-decoration:line-through}'+
      '.crm-task-row .dl{font-size:11px;white-space:nowrap;color:#999}'+
      '.crm-task-row .dl.over{color:#c0392b;font-weight:700}'+
      '.crm-task-row .dl.today{color:#BA7517;font-weight:700}'+
      '.crm-task-row .dl.done{color:#bbb}'+
      '.crm-task-row .del{background:none;border:none;color:#ccc;cursor:pointer;font-size:13px;line-height:1;padding:2px}'+
      '.crm-task-row .del:hover{color:#c0392b}'+
      '.crm-gsr-h{font-size:10px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:.03em;margin:10px 0 4px}'+
      '.crm-gsr{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--bd);border-radius:8px;margin-bottom:6px}'+
      '.crm-gsr.clk{cursor:pointer}'+
      '.crm-gsr.clk:hover{background:#faf9f7;border-color:#e0ddd6}'+
      '.crm-gsr-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}'+
      '.crm-gsr-nm{font-size:13px;font-weight:600;color:#222;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
      '.crm-gsr-sub{font-size:11px;color:#888;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
      '.crm-gsr-tag{font-size:10px;font-weight:600;color:#5F5E5A;background:#f2f0ec;border-radius:6px;padding:2px 7px;white-space:nowrap}'+
      '.crm-gsr-tag.arch{background:#ece6da;color:#8a7a55}'+
      '.crm-sec-t{font-size:13px;font-weight:600;color:#444;margin:14px 0 8px}'+
      '.crm-ch-box{background:var(--bg);border-radius:10px;margin-bottom:10px;overflow:hidden}'+
      '.crm-ch-box.recl{background:#FCEBEB}'+
      '.crm-ch-box.recl .crm-ch-h b{color:#A32D2D}'+
      '.crm-ch-box.recl .crm-ch-h .ti{color:#A32D2D}'+
      '.crm-sec{background:var(--bg);border-radius:10px;padding:10px 12px;margin-bottom:10px}'+
      '.crm-sec .crm-ch-box{background:#fff}'+
      '.crm-sec-h{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:#5F5E5A;margin-bottom:8px}'+
      '.crm-sec-h .ti,.crm-ch-h .ti{font-size:14px;color:#5F5E5A}'+
      '.crm-hava{width:34px;height:34px;border-radius:50%;background:#1a5252;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}'+
      '.crm-h-t{font-size:14px;font-weight:700;color:#222;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
      '.crm-h-s{font-size:11px;color:#999}'+
      '.crm-feed-dot{width:6px;height:6px;border-radius:50%;background:#B4B2A9;flex-shrink:0}'+
      '.crm-ch-row:last-child .crm-feed-dot{background:#1a5252}'+
      '.crm-ch-h{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #e8e6de}'+
      '.crm-ch-h b{font-size:11px;font-weight:700;color:#5F5E5A;flex:1}'+
      '.crm-ch-row{display:flex;gap:8px;align-items:center;padding:7px 12px;font-size:11px;color:#555;border-bottom:1px solid #e8e6de}'+
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
      '.crm-overpaid{color:#0F6E56;font-weight:600}'+
      '.crm-lb-bg{position:fixed;inset:0;background:rgba(10,10,10,.9);z-index:10050;display:flex;flex-direction:column;align-items:center;justify-content:center}'+
      '.crm-lb-x{position:absolute;top:14px;right:16px;background:none;border:none;color:#fff;font-size:26px;cursor:pointer;line-height:1;padding:6px;opacity:.85;z-index:2}'+
      '.crm-lb-x:hover{opacity:1}'+
      '.crm-lb-main{display:flex;align-items:center;justify-content:center;flex:1;width:100%;min-height:0;position:relative}'+
      '.crm-lb-img{max-width:88vw;max-height:70vh;object-fit:contain;border-radius:4px}'+
      '.crm-lb-cap{color:#ddd;font-size:12px;margin-top:10px;text-align:center;padding:0 16px;max-width:80vw}'+
      '.crm-lb-arrow{background:rgba(255,255,255,.12);border:none;color:#fff;font-size:22px;width:44px;height:44px;border-radius:50%;cursor:pointer;flex-shrink:0;margin:0 10px}'+
      '.crm-lb-arrow:hover{background:rgba(255,255,255,.22)}'+
      '.crm-lb-arrow:disabled{opacity:.25;cursor:default}'+
      '.crm-lb-strip{display:flex;gap:6px;overflow-x:auto;padding:12px 16px;max-width:92vw}'+
      '.crm-lb-thumb{width:52px;height:52px;object-fit:cover;border-radius:6px;cursor:pointer;opacity:.5;flex-shrink:0;border:2px solid transparent}'+
      '.crm-lb-thumb.on{opacity:1;border-color:#fff}';
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
    box.style.cssText = 'max-width:380px;margin:40px auto;background:#fff;border:1px solid var(--bd);border-radius:12px;padding:20px';
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
    inp2.style.cssText = 'width:100%;font-size:13px;border:1px solid var(--bd);border-radius:8px;padding:9px 10px;box-sizing:border-box;margin-bottom:10px';
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
    qBadge();
    qFlush();
    if(LOADED){
      if(!TASKS_LOADED){ fetchTasks(function(){ renderAll(); refreshQuiet(); }); return; }
      renderAll(); refreshQuiet(); return;
    }
    var root = document.getElementById('crm-root');
    if(root) root.innerHTML = '<div class="crm-empty">Загружаю заказы из таблицы...</div>';
    fetchOrders(function(err){
      if(err === '__no_key__'){ renderKeyGate(false); return; }
      if(err === '__bad_key__'){ setToken(''); renderKeyGate(true); return; }
      if(err){ if(root) root.innerHTML = '<div class="crm-empty">Не удалось загрузить: '+err+'<br><br><button class="crm-vbtn" onclick="crmReload()">Повторить</button></div>'; return; }
      // Задачи — заранее, вместе с заказами (см. комментарий у fetchTasks).
      // Ошибку молча проглатываем: заказы уже загрузились, работать можно,
      // просто бейдж «Задачи» не покажется до захода во вкладку.
      fetchTasks(function(){ renderAll(); });
    });
  };
  window.crmReload = function(){
    LOADED = false;
    window.crmPageOpen();
  };
  function refreshQuiet(){
    fetchOrders(function(err){ if(!err) renderAll(); });
    fetchTasks(function(err){ if(!err) renderAll(); });
  }

  // v4.11: 'over' — дедлайн прошёл, 'today' — сегодня, 'ok' — позже
  // (или задача уже выполнена/без дедлайна — тогда всегда 'ok').
  function taskDueStatus(t){
    if(t.done || !t.deadline) return 'ok';
    var d = new Date(t.deadline);
    if(isNaN(d.getTime())) return 'ok';
    var now = new Date();
    var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var dStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if(dStart < todayStart) return 'over';
    if(dStart === todayStart) return 'today';
    return 'ok';
  }
  function taskBadgeCount(){
    var n = 0;
    TASKS.forEach(function(t){ var s = taskDueStatus(t); if(s === 'over' || s === 'today') n++; });
    return n;
  }
  function taskDeadlineLabel_(t){
    if(!t.deadline) return '';
    var lbl = fmtDate(t.deadline);
    if(t.done) return lbl;
    var s = taskDueStatus(t);
    if(s === 'over') return lbl + ' \u00B7 просрочено';
    if(s === 'today') return lbl + ' \u00B7 сегодня';
    return lbl;
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
    sumTile(sum, String(act.length), 'заказов в работе');
    sumTile(sum, fm0(moneyInWork), 'денег в работе');
    sumTile(sum, fm0(debtTotal), 'долг клиентов', debtTotal>0);
    sumTile(sum, String(mountsNow), 'установок в этом месяце');
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
    var bSearch = document.createElement('button');
    bSearch.className = 'crm-vbtn';
    bSearch.innerHTML = '\uD83D\uDD0D';
    bSearch.title = 'Поиск по всем заказам (активные + архив)';
    bSearch.addEventListener('click', function(){ openGlobalSearch(); });
    tools.appendChild(bSearch);
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
    var bCal = document.createElement('button');
    bCal.className = 'crm-vbtn' + (VIEW==='cal' ? ' on' : '');
    bCal.textContent = 'Календарь';
    bCal.title = 'Календарь установок';
    bCal.addEventListener('click', function(){ VIEW='cal'; localStorage.setItem('moff_crm_view','cal'); renderAll(); });
    var bArchive = document.createElement('button');
    bArchive.className = 'crm-vbtn' + (VIEW==='archive' ? ' on' : '');
    bArchive.textContent = 'Архив';
    bArchive.title = 'Заказы Готова/Отказ старше 30 дней — отдельный файл';
    bArchive.addEventListener('click', function(){ VIEW='archive'; localStorage.setItem('moff_crm_view','archive'); renderAll(); });
    var bTasks = document.createElement('button');
    bTasks.className = 'crm-vbtn' + (VIEW==='tasks' ? ' on' : '');
    var tBadge = taskBadgeCount();
    bTasks.innerHTML = 'Задачи' + (tBadge ? ' <span class="crm-task-badge">' + tBadge + '</span>' : '');
    bTasks.addEventListener('click', function(){ VIEW='tasks'; localStorage.setItem('moff_crm_view','tasks'); renderAll(); });
    var vGroup1 = document.createElement('div'); vGroup1.className = 'crm-vgroup';
    vGroup1.appendChild(bBoard); vGroup1.appendChild(bList); vGroup1.appendChild(bCal);
    var vGroup2 = document.createElement('div'); vGroup2.className = 'crm-vgroup';
    vGroup2.appendChild(bFin); vGroup2.appendChild(bStock); vGroup2.appendChild(bTasks);
    tools.appendChild(vGroup1); tools.appendChild(vGroup2); tools.appendChild(bArchive);
    if(VIEW !== 'fin' && VIEW !== 'stock' && VIEW !== 'cal' && VIEW !== 'archive' && VIEW !== 'tasks'){
    var search = document.createElement('input');
    search.type = 'search'; search.placeholder = 'Поиск: №, клиент, телефон, город...';
    search.value = SEARCH; search.style.marginLeft = 'auto'; search.style.width = '200px';
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
    mSel.style.maxWidth = '190px';
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
    if(VIEW === 'archive'){ if(cnt) cnt.textContent = ''; renderArchive(view); return; }
    if(VIEW === 'tasks'){ if(cnt) cnt.textContent = ''; renderTasks(view); return; }
    if(VIEW === 'fin'){
      if(cnt) cnt.textContent = '';
      renderFin(view);
      return;
    }
    if(VIEW === 'cal'){
      if(cnt) cnt.textContent = '';
      renderCalendar(view);
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
    renderTodayWidget(view);
    if(VIEW === 'board') renderBoard(view, vis); else renderList(view, vis);
  }

  // ── Виджет «Сегодня»: операционная сводка над доской ──────
  // Собирается из ВСЕХ заказов, не завися от фильтров месяца/города:
  // установки на 7 дней (включая просроченные), долги, требующие
  // внимания (Готова с долгом, либо договор старше 30 дней с долгом),
  // заявки без движения 14+ дней. Клик по строке открывает карточку.
  // Если внимания ничего не требует — виджет не показывается вовсе.
  // Свёрнутость помнится в localStorage ('moff_today_fold').
  function renderTodayWidget(view){
    if(!LOADED || !ORDERS.length) return;
    var today = new Date(); today.setHours(0,0,0,0);
    var t0 = today.getTime(), DAY = 86400000;
    var installs = [], debts = [], stale = [];
    ORDERS.forEach(function(o){
      if(isActive(o) && o.mountDate){
        var d = new Date(o.mountDate);
        if(!isNaN(d.getTime())){
          d.setHours(0,0,0,0);
          var diff = Math.round((d.getTime() - t0) / DAY);
          if(diff <= 7) installs.push({ o:o, diff:diff });
        }
      }
      var debt = debtOf(o);
      if(debt > 0 && o.status !== 'Отказ'){
        if(o.status === 'Готова') debts.push({ o:o, debt:debt, ready:true });
        else if(o.dogDate){
          var dg = new Date(o.dogDate);
          if(!isNaN(dg.getTime()) && (t0 - dg.getTime()) / DAY > 30) debts.push({ o:o, debt:debt, ready:false });
        }
      }
      if(isActive(o) && o.updated){
        var u = new Date(o.updated);
        if(!isNaN(u.getTime())){
          var days = Math.floor((t0 - u.getTime()) / DAY);
          if(days >= 14) stale.push({ o:o, days:days });
        }
      }
    });
    if(!TODAY_STOCK_TRIED && (!STOCK_LOADED || !SMIN_LOADED)){
      TODAY_STOCK_TRIED = true;
      fetchStock(function(e1){
        fetchStockMin(function(e2){
          if(!e1 && !e2 && (VIEW === 'board' || VIEW === 'list')) renderAll();
        });
      });
    }
    var deficit = (STOCK_LOADED && SMIN_LOADED) ? stockDeficitList() : [];
    if(!installs.length && !debts.length && !stale.length && !deficit.length) return;
    installs.sort(function(a,b){ return a.diff - b.diff; });
    debts.sort(function(a,b){ return b.debt - a.debt; });
    stale.sort(function(a,b){ return b.days - a.days; });

    var box = document.createElement('div');
    box.style.cssText = 'border:1px solid #e5e5e0;border-radius:12px;padding:8px 12px;margin-bottom:12px;background:#fff';

    function paint(){
      box.innerHTML = '';
      var folded = localStorage.getItem('moff_today_fold') === '1';
      var hd = document.createElement('div');
      hd.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none';
      var hb = document.createElement('b');
      hb.style.fontSize = '13px';
      hb.textContent = '\u2600\uFE0F Сегодня';
      var sub = document.createElement('span');
      sub.style.cssText = 'flex:1;font-size:11px;color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      var parts = [];
      if(installs.length) parts.push('установок: ' + installs.length);
      if(debts.length) parts.push('долгов: ' + debts.length);
      if(stale.length) parts.push('без движения: ' + stale.length);
      if(deficit.length) parts.push('докупить: ' + deficit.length);
      sub.textContent = parts.join(' \u00B7 ');
      var fold = document.createElement('span');
      fold.style.cssText = 'font-size:11px;color:#999;white-space:nowrap';
      fold.textContent = folded ? '\u25B8 развернуть' : '\u25BE свернуть';
      hd.appendChild(hb); hd.appendChild(sub); hd.appendChild(fold);
      hd.addEventListener('click', function(){
        localStorage.setItem('moff_today_fold', folded ? '0' : '1');
        paint();
      });
      box.appendChild(hd);
      if(folded) return;

      function mkRow(o, midText, rightText, rightColor){
        var r = document.createElement('div');
        r.style.cssText = 'display:flex;gap:8px;align-items:baseline;padding:3px 0;cursor:pointer;font-size:12px;border-bottom:1px dashed #f2f2ee';
        var a = document.createElement('b');
        a.style.whiteSpace = 'nowrap';
        a.textContent = '\u2116' + o.num;
        var mid = document.createElement('span');
        mid.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#555';
        mid.textContent = midText;
        var rt = document.createElement('span');
        rt.style.cssText = 'white-space:nowrap;font-weight:700' + (rightColor ? ';color:' + rightColor : '');
        rt.textContent = rightText;
        r.appendChild(a); r.appendChild(mid); r.appendChild(rt);
        r.addEventListener('click', function(){ openCard(o.num); });
        return r;
      }
      function group(title, arr, rowFn){
        if(!arr.length) return;
        var gt = document.createElement('div');
        gt.style.cssText = 'font-size:11px;color:#999;margin-top:8px';
        gt.textContent = title;
        box.appendChild(gt);
        var MAX = 5;
        arr.slice(0, MAX).forEach(function(it){ box.appendChild(rowFn(it)); });
        if(arr.length > MAX){
          var more = document.createElement('div');
          more.style.cssText = 'font-size:11px;color:#999;padding:2px 0';
          more.textContent = '\u2026и ещё ' + (arr.length - MAX);
          box.appendChild(more);
        }
      }
      group('\uD83D\uDD27 Установки \u2014 ближайшие 7 дней', installs, function(it){
        var right, color = '';
        if(it.diff < 0){ right = 'просрочено, ' + fmtDate(it.o.mountDate); color = '#BA7517'; }
        else if(it.diff === 0){ right = 'сегодня'; color = '#BA7517'; }
        else if(it.diff === 1){ right = 'завтра'; }
        else { right = fmtDate(it.o.mountDate); }
        return mkRow(it.o, (it.o.client || '') + (it.o.furn ? ' \u00B7 ' + it.o.furn : ''), right, color);
      });
      group('\uD83D\uDCB0 Долги, требующие внимания', debts, function(it){
        var mid = (it.o.client || '') + (it.ready ? ' \u00B7 мебель готова' : ' \u00B7 договор от ' + fmtDate(it.o.dogDate));
        return mkRow(it.o, mid, fm0(it.debt), it.ready ? '#BA7517' : '');
      });
      group('\uD83D\uDCA4 Без движения 14+ дней', stale, function(it){
        return mkRow(it.o, (it.o.client || '') + ' \u00B7 ' + (it.o.status || ''), it.days + ' дн.', '');
      });
      if(deficit.length){
        var gt2 = document.createElement('div');
        gt2.style.cssText = 'font-size:11px;color:#999;margin-top:8px';
        gt2.textContent = '\uD83E\uDDF0 Пора докупить';
        box.appendChild(gt2);
        deficit.slice(0, 5).forEach(function(d){
          var r = document.createElement('div');
          r.style.cssText = 'display:flex;gap:8px;align-items:baseline;padding:3px 0;cursor:pointer;font-size:12px;border-bottom:1px dashed #f2f2ee';
          var nm = document.createElement('span');
          nm.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#555';
          nm.textContent = d.name;
          var rt = document.createElement('span');
          rt.style.cssText = 'white-space:nowrap;font-weight:700;color:' + (d.qty <= 0 ? '#BA1B1B' : '#BA7517');
          rt.textContent = d.qty <= 0 ? 'закончилось' : d.qty + ' / мин ' + d.min;
          r.appendChild(nm); r.appendChild(rt);
          r.addEventListener('click', function(){
            VIEW = 'stock'; STOCK_SUBVIEW = 'balance'; STOCK_DEF_ONLY = true;
            localStorage.setItem('moff_crm_view', 'stock');
            renderAll();
          });
          box.appendChild(r);
        });
        if(deficit.length > 5){
          var dmore = document.createElement('div');
          dmore.style.cssText = 'font-size:11px;color:#999;padding:2px 0';
          dmore.textContent = '\u2026и ещё ' + (deficit.length - 5);
          box.appendChild(dmore);
        }
      }
    }
    paint();
    view.appendChild(box);
  }

  // ── Календарь установок: месяц сеткой по «Дата установки» ──
  // Показывает ВСЕ заказы месяца (поиск и фильтры не применяются),
  // цвет плашки = цвет статуса на доске. Клик по плашке — карточка.
  function renderCalendar(view){
    var nav = document.createElement('div');
    nav.className = 'crm-m-btns';
    nav.style.cssText = 'align-items:center;margin-bottom:8px';
    var curKey = monthKey(new Date());
    var bPrev = document.createElement('button'); bPrev.className='crm-vbtn'; bPrev.style.padding='3px 10px';
    bPrev.textContent = '\u2039';
    bPrev.addEventListener('click', function(){ CAL_MONTH = shiftMonthKey(CAL_MONTH, -1); renderView(); });
    var lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:13px;font-weight:700;padding:0 8px';
    lbl.textContent = monthLabel(CAL_MONTH);
    var bNext = document.createElement('button'); bNext.className='crm-vbtn'; bNext.style.padding='3px 10px';
    bNext.textContent = '\u203a';
    bNext.addEventListener('click', function(){ CAL_MONTH = shiftMonthKey(CAL_MONTH, 1); renderView(); });
    nav.appendChild(bPrev); nav.appendChild(lbl); nav.appendChild(bNext);
    if(CAL_MONTH !== curKey){
      var bNow = document.createElement('button'); bNow.className='crm-vbtn'; bNow.style.padding='3px 8px'; bNow.style.marginLeft='6px';
      bNow.textContent = 'Сегодня';
      bNow.addEventListener('click', function(){ CAL_MONTH = curKey; renderView(); });
      nav.appendChild(bNow);
    }
    view.appendChild(nav);

    var p = CAL_MONTH.split('-');
    var y = +p[0], mIdx = +p[1] - 1;
    var startDow = (new Date(y, mIdx, 1).getDay() + 6) % 7;
    var daysIn = new Date(y, mIdx + 1, 0).getDate();

    var byDay = {};
    var total = 0;
    ORDERS.forEach(function(o){
      if(!o.mountDate) return;
      if(monthKey(o.mountDate) !== CAL_MONTH) return;
      var d = new Date(o.mountDate);
      if(isNaN(d.getTime())) return;
      var dd = d.getDate();
      if(!byDay[dd]) byDay[dd] = [];
      byDay[dd].push(o);
      total++;
    });

    var grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(7,1fr);gap:4px';
    var DOW = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
    DOW.forEach(function(dn, di){
      var hh = document.createElement('div');
      hh.textContent = dn;
      hh.style.cssText = 'font-size:10px;text-align:center;padding:2px 0;color:' + (di >= 5 ? '#c07a7a' : '#999');
      grid.appendChild(hh);
    });
    for(var e = 0; e < startDow; e++) grid.appendChild(document.createElement('div'));
    var nowD = new Date();
    var isThisMonth = monthKey(nowD) === CAL_MONTH;
    for(var day = 1; day <= daysIn; day++){
      var isToday = isThisMonth && nowD.getDate() === day;
      var cell = document.createElement('div');
      cell.style.cssText = 'min-height:56px;border:1px solid ' + (isToday ? '#1a5252' : 'var(--bd)') + ';border-radius:8px;padding:3px 4px;background:#fff;overflow:hidden';
      var dnum = document.createElement('div');
      dnum.textContent = day;
      dnum.style.cssText = 'font-size:10px;font-weight:700;color:' + (isToday ? '#1a5252' : '#bbb');
      cell.appendChild(dnum);
      var arr = byDay[day] || [];
      arr.slice(0, 3).forEach(function(o){
        var col = ST_COLOR[o.status] || '#888780';
        var chip = document.createElement('div');
        chip.textContent = '\u2116' + o.num + (o.client ? ' ' + o.client : '');
        chip.title = '\u2116' + o.num + ' ' + (o.client || '') + ' \u2014 ' + (o.status || '') + (o.furn ? ' \u00B7 ' + o.furn : '');
        chip.style.cssText = 'font-size:10px;line-height:1.4;margin-top:2px;padding:1px 4px;border-radius:6px;cursor:pointer;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:' + col + '1f;color:' + col;
        chip.addEventListener('click', function(){ openCard(o.num); });
        cell.appendChild(chip);
      });
      if(arr.length > 3){
        var more = document.createElement('div');
        more.textContent = '+' + (arr.length - 3) + ' ещё';
        more.style.cssText = 'font-size:10px;color:#999;margin-top:2px';
        cell.appendChild(more);
      }
      grid.appendChild(cell);
    }
    view.appendChild(grid);

    var foot = document.createElement('div');
    foot.style.cssText = 'font-size:11px;color:#999;margin-top:6px';
    foot.textContent = total ? 'Установок в месяце: ' + total : 'В этом месяце дат установки нет \u2014 заполняй поле «Дата установки» в карточке, и заказы появятся здесь.';
    view.appendChild(foot);
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
  var ARCHIVE = [];
  var ARCHIVE_LOADED = false;
  var ARCHIVE_SEARCH = '';
  var TASKS = [];
  var TASKS_LOADED = false;
  var TASKS_SHOW_DONE = false;
  var AGG_MANUAL = []; // сводная закупка: позиции, добавленные вручную (только в модалке, не сохраняются)
  var STOCK_MOVES = [];
  var STOCK_MOVES_LOADED = false;
  var STOCK_SUBVIEW = 'balance';
  var STOCK_SEARCH = '';
  var STOCK_HSEARCH = '';
  var STOCK_SORT = 'name';
  var STOCK_DEF_ONLY = false;
  var RESERVED = {};
  var RESERVED_LOADED = false;
  var SMIN = {};
  var SMIN_LOADED = false;
  var SLEAD = {}; // v4.4: срок поставки материала в днях (лист СкладМин, колонка 4)
  var TODAY_STOCK_TRIED = false;
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

  // ── Рекламации (лист "Рекламации"): гарантийные обращения ──
  // Живут отдельно от статуса заказа: заказ остаётся «Готова», а
  // рекламация идёт своим циклом Принята → Устраняем → Закрыта.
  var RECL_STAGES = ['Принята','Устраняем','Закрыта'];
  var RECL_COLOR = { 'Принята':'#D4537E', 'Устраняем':'#BA7517', 'Закрыта':'#3B6D11' };
  var RECL = [];
  var RECL_LOADED = false;

  function fetchRecl(cb){
    if(!getToken()){ cb('__no_key__'); return; }
    fetch(GS_URL + '?action=recl&token=' + encodeURIComponent(getToken()))
      .then(function(r){ return r.json(); })
      .then(function(res){
        if(res && res.ok){ RECL = res.recl || []; RECL_LOADED = true; cb(null); }
        else cb((res && res.error) || 'таблица вернула ошибку');
      })
      .catch(function(e){ cb(String(e && e.message || e)); });
  }

  function reclOf(num){
    var out = [];
    for(var i=0;i<RECL.length;i++){
      if(String(RECL[i].num) === String(num)) out.push(RECL[i]);
    }
    return out;
  }

  function orderByNum(num){
    for(var i=0;i<ORDERS.length;i++){
      if(String(ORDERS[i].num) === String(num)) return ORDERS[i];
    }
    return null;
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

  // ── Журнал статусов (лист "Статусы"): путь заказа по этапам ──
  var SL = [];
  var SL_LOADED = false;

  function fetchStatusLog(cb){
    if(!getToken()){ cb('__no_key__'); return; }
    fetch(GS_URL + '?action=statusLog&token=' + encodeURIComponent(getToken()))
      .then(function(r){ return r.json(); })
      .then(function(res){
        if(res && res.ok){ SL = res.slog || []; SL_LOADED = true; cb(null); }
        else cb((res && res.error) || 'таблица вернула ошибку');
      })
      .catch(function(e){ cb(String(e && e.message || e)); });
  }

  function slogOf(num){
    var out = [];
    for(var i=0;i<SL.length;i++){
      if(String(SL[i].num) === String(num)) out.push(SL[i]);
    }
    out.sort(function(a,b){ return new Date(a.date) - new Date(b.date); });
    return out;
  }

  // ── Доп. работы (лист "ДопРаботы"): разовые выплаты по заказу ──
  var DOP = [];
  var DOP_LOADED = false;

  function fetchDop(cb){
    if(!getToken()){ cb('__no_key__'); return; }
    fetch(GS_URL + '?action=dopworks&token=' + encodeURIComponent(getToken()))
      .then(function(r){ return r.json(); })
      .then(function(res){
        if(res && res.ok){ DOP = res.dop || []; DOP_LOADED = true; cb(null); }
        else cb((res && res.error) || 'таблица вернула ошибку');
      })
      .catch(function(e){ cb(String(e && e.message || e)); });
  }

  function dopOf(num){
    var out = [];
    for(var i=0;i<DOP.length;i++){
      if(String(DOP[i].num) === String(num)) out.push(DOP[i]);
    }
    return out;
  }

  // Имя сотрудника по id (для подписей). Неизвестный id → «(удалён)».
  function empName(id){
    if(!id) return '';
    for(var i=0;i<EMP.length;i++){ if(String(EMP[i].id) === String(id)) return EMP[i].name; }
    return '(удалён)';
  }

  // ── Шаблоны доп. работ (лист "ШаблоныДопРабот") ────────────
  var DOPT = [];
  var DOPT_LOADED = false;

  function fetchDopTemplates(cb){
    if(!getToken()){ cb('__no_key__'); return; }
    fetch(GS_URL + '?action=dopTemplates&token=' + encodeURIComponent(getToken()))
      .then(function(r){ return r.json(); })
      .then(function(res){
        if(res && res.ok){ DOPT = res.templates || []; DOPT_LOADED = true; cb(null); }
        else cb((res && res.error) || 'таблица вернула ошибку');
      })
      .catch(function(e){ cb(String(e && e.message || e)); });
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

  // v4.11: задачи грузим НЕ лениво (в отличие от Кассы/Архива/Склада) —
  // бейдж просроченных в навигации должен появиться сразу при открытии
  // СРМ, а не только после захода во вкладку «Задачи».
  function fetchTasks(cb){
    if(!getToken()){ cb('__no_key__'); return; }
    fetch(GS_URL + '?action=tasks&token=' + encodeURIComponent(getToken()))
      .then(function(r){ return r.json(); })
      .then(function(res){
        if(res && res.ok){ TASKS = res.tasks || []; TASKS_LOADED = true; cb(null); }
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

  // Архив заказов (v4.9): отдельный файл таблицы, лениво грузится
  // только при заходе на вкладку "Архив" — вкладка "Заказы" его не трогает.
  function fetchArchive(cb){
    if(!getToken()){ cb('__no_key__'); return; }
    fetch(GS_URL + '?action=archiveOrders&token=' + encodeURIComponent(getToken()))
      .then(function(r){ return r.json(); })
      .then(function(res){
        if(res && res.ok){ ARCHIVE = res.orders || []; ARCHIVE_LOADED = true; cb(null); }
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

  function fetchStockMin(cb){
    if(!getToken()){ cb('__no_key__'); return; }
    fetch(GS_URL + '?action=stockMin&token=' + encodeURIComponent(getToken()))
      .then(function(r){ return r.json(); })
      .then(function(res){
        if(res && res.ok){
          SMIN = {}; SLEAD = {};
          var arr = res.mins || [];
          arr.forEach(function(m){
            if(!m || !m.key) return;
            if(Number(m.min) > 0) SMIN[m.key] = Math.round(Number(m.min));
            if(Number(m.lead) > 0) SLEAD[m.key] = Math.round(Number(m.lead));
          });
          SMIN_LOADED = true;
          cb(null);
        }
        else cb((res && res.error) || 'таблица вернула ошибку');
      })
      .catch(function(e){ cb(String(e && e.message || e)); });
  }

  function minOf(key){ return Number(SMIN[key]) || 0; }
  function leadOf(key){ return Number(SLEAD[key]) || 0; }

  // Цены позиций для «Склада в деньгах»: артикулы фурнитуры/кухни/шкафа
  // и имена материалов из прайса калькулятора (DB). Позиции без цены
  // в прайсе просто не входят в сумму — это честно показывается.
  function stockPriceMap(){
    var map = {};
    if(typeof DB !== 'undefined' && DB){
      ['furn','kuh','shk'].forEach(function(sec){
        var rows = DB[sec] || [];
        rows.forEach(function(row){ if(row && row.sku && Number(row.p) > 0 && !map[row.sku]) map[row.sku] = Number(row.p); });
      });
      var mats = (DB.ldsp || []).concat(DB.fas_plen || []).concat(DB.fas_kr || []);
      mats.forEach(function(row){ if(row && row.n && Number(row.p) > 0 && !map[row.n]) map[row.n] = Number(row.p); });
    }
    return map;
  }

  function stockDeficitList(){
    var out = [];
    var st = STOCK || [];
    st.forEach(function(s){
      if(!s || !s.key) return;
      var q = Math.round(Number(s.qty) || 0);
      var mn = minOf(s.key);
      if(q <= 0 || (mn > 0 && q < mn)) out.push({ key: s.key, name: s.name || s.key, unit: s.unit || '', qty: q, min: mn });
    });
    out.sort(function(a,b){ return (a.qty - a.min) - (b.qty - b.min); });
    return out;
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
    var bInv = document.createElement('button'); bInv.className = 'crm-vbtn'; bInv.textContent = '\uD83D\uDCCB Инвентаризация';
    bInv.title = 'Пересчёт: вводишь фактические остатки, разница спишется/оприходуется сама';
    bInv.addEventListener('click', function(){ openInventoryModal(); });
    var bAgg = document.createElement('button'); bAgg.className = 'crm-vbtn'; bAgg.textContent = '\uD83D\uDED2 Сводная закупка';
    bAgg.title = 'Список закупщику сразу по нескольким заказам после договора';
    bAgg.addEventListener('click', function(){ openAggPurchaseModal(); });
    var bLead = document.createElement('button'); bLead.className = 'crm-vbtn'; bLead.textContent = '\u23F1 Сроки поставки';
    bLead.title = 'Проверить, не опоздает ли материал с учётом срока поставки и дат монтажа';
    var leadResultBox = document.createElement('div');
    bLead.addEventListener('click', function(){ checkLeadTimes(bLead, leadResultBox); });
    var bResv = document.createElement('button'); bResv.className = 'crm-vbtn'; bResv.textContent = '\uD83D\uDCE6 Резерв';
    bResv.title = 'Посчитать, сколько остатка уже обещано другим активным заказам (тянет снимки всех заказов после договора)';
    bResv.addEventListener('click', function(){
      bResv.disabled = true; bResv.textContent = 'Считаю...';
      computeReserved(null, function(err, map){
        bResv.disabled = false; bResv.textContent = '\uD83D\uDCE6 Резерв';
        if(err === '__no_key__'){ toast('\u26A0\uFE0F Введи ключ доступа', '#BA7517'); return; }
        if(err){ toast('\u26A0\uFE0F Резерв не посчитался: ' + err, '#BA7517'); return; }
        RESERVED = map; RESERVED_LOADED = true;
        if(VIEW === 'stock') renderAll();
        toast('OK Резерв посчитан по активным заказам', '#1a5252');
      });
    });
    btnRow.appendChild(bIn); btnRow.appendChild(bOut); btnRow.appendChild(bInv); btnRow.appendChild(bAgg); btnRow.appendChild(bLead); btnRow.appendChild(bResv);
    wrap.appendChild(btnRow);
    wrap.appendChild(leadResultBox);
    view.appendChild(wrap);

    if(STOCK_SUBVIEW === 'history'){ renderStockHistory(view); return; }

    var ld = document.createElement('div'); ld.className = 'crm-empty'; ld.textContent = 'Загружаю остатки...';
    view.appendChild(ld);
    fetchStock(function(err){
      if(err === '__no_key__'){ ld.textContent = 'Введи ключ доступа во вкладке заказов.'; return; }
      if(err){ ld.textContent = 'Остатки не загрузились: ' + err; return; }
      fetchStockMin(function(){
        ld.style.display = 'none';
        buildBalance(view);
      });
    });
  }

  // v4.11: Глобальный поиск — модалка поверх любой вкладки. Ищет по
  // активным заказам (ORDERS, уже в памяти) сразу; по кнопке «искать в
  // архиве» подгружает отдельный архивный файл (fetchArchive) и
  // досыпает совпадения. Клик по активному открывает карточку; архивные
  // некликабельны (карточку архивных не редактируют — как во вкладке).
  function globalSearchMatch(o, s){
    return String(o.num).toLowerCase().indexOf(s)>=0 ||
      String(o.client||'').toLowerCase().indexOf(s)>=0 ||
      String(o.phone||'').toLowerCase().indexOf(s)>=0 ||
      String(o.obj||'').toLowerCase().indexOf(s)>=0 ||
      String(o.city||'').toLowerCase().indexOf(s)>=0 ||
      String(o.furn||'').toLowerCase().indexOf(s)>=0;
  }
  function openGlobalSearch(){
    var bg = document.createElement('div'); bg.className = 'crm-modal-bg';
    bg.addEventListener('click', function(e){ if(e.target===bg) document.body.removeChild(bg); });
    var m = document.createElement('div'); m.className = 'crm-modal';
    var h = document.createElement('div'); h.className = 'crm-m-h';
    var hcol = document.createElement('div'); hcol.style.minWidth = '0';
    var title = document.createElement('div'); title.className = 'crm-h-t'; title.textContent = '\uD83D\uDD0D Поиск по всем заказам';
    hcol.appendChild(title);
    var x = document.createElement('button'); x.className = 'crm-m-x'; x.textContent = '\u00D7';
    x.addEventListener('click', function(){ document.body.removeChild(bg); });
    h.appendChild(hcol); h.appendChild(x);
    var b = document.createElement('div'); b.className = 'crm-m-b';

    var inpEl = document.createElement('input');
    inpEl.type = 'search'; inpEl.placeholder = '№, клиент, телефон, адрес, город, тип...';
    inpEl.style.width = '100%'; inpEl.style.marginBottom = '10px';

    var archBtn = document.createElement('button');
    archBtn.className = 'crm-vbtn'; archBtn.textContent = 'Искать в архиве';
    archBtn.style.marginBottom = '10px';

    var results = document.createElement('div');

    // Флаг: архив включён в поиск (загружен и досыпается в выдачу).
    var archiveOn = false;

    function rowEl(o, archived){
      var r = document.createElement('div');
      r.className = 'crm-gsr';
      var main = document.createElement('div'); main.className = 'crm-gsr-main';
      var nm = document.createElement('span'); nm.className = 'crm-gsr-nm';
      nm.textContent = '\u2116' + o.num + ' \u00B7 ' + (o.client || '—');
      var sub = document.createElement('span'); sub.className = 'crm-gsr-sub';
      var bits = [];
      if(o.phone) bits.push(o.phone);
      if(o.city) bits.push(o.city);
      if(o.furn) bits.push(o.furn);
      sub.textContent = bits.join(' \u00B7 ');
      main.appendChild(nm); main.appendChild(sub);
      r.appendChild(main);
      var tag = document.createElement('span'); tag.className = 'crm-gsr-tag';
      if(archived){ tag.textContent = 'архив'; tag.classList.add('arch'); }
      else { tag.textContent = String(o.status || ''); }
      r.appendChild(tag);
      if(!archived){
        r.classList.add('clk');
        r.addEventListener('click', function(){ document.body.removeChild(bg); openCard(o.num); });
      }
      return r;
    }

    function paint(){
      var s = inpEl.value.trim().toLowerCase();
      results.innerHTML = '';
      if(!s){
        var hint = document.createElement('div'); hint.className = 'crm-empty';
        hint.textContent = 'Введите запрос — ищет по активным заказам' + (archiveOn ? ' и архиву' : '') + '.';
        results.appendChild(hint);
        return;
      }
      var act = ORDERS.filter(function(o){ return globalSearchMatch(o, s); });
      var arch = archiveOn ? ARCHIVE.filter(function(o){ return globalSearchMatch(o, s); }) : [];
      if(!act.length && !arch.length){
        var none = document.createElement('div'); none.className = 'crm-empty';
        none.textContent = 'Ничего не найдено' + (archiveOn ? '' : ' среди активных. Попробуйте «Искать в архиве».');
        results.appendChild(none);
        return;
      }
      if(act.length){
        var hA = document.createElement('div'); hA.className = 'crm-gsr-h'; hA.textContent = 'Активные (' + act.length + ')';
        results.appendChild(hA);
        act.forEach(function(o){ results.appendChild(rowEl(o, false)); });
      }
      if(arch.length){
        var hB = document.createElement('div'); hB.className = 'crm-gsr-h'; hB.textContent = 'Архив (' + arch.length + ')';
        results.appendChild(hB);
        arch.forEach(function(o){ results.appendChild(rowEl(o, true)); });
      }
    }

    archBtn.addEventListener('click', function(){
      if(archiveOn){ archiveOn = false; archBtn.textContent = 'Искать в архиве'; paint(); return; }
      archBtn.disabled = true; archBtn.textContent = 'Загружаю архив...';
      var proceed = function(){
        archiveOn = true; archBtn.disabled = false; archBtn.textContent = 'Не искать в архиве'; paint();
      };
      if(ARCHIVE_LOADED){ proceed(); return; }
      fetchArchive(function(err){
        if(err){ archBtn.disabled = false; archBtn.textContent = 'Искать в архиве'; toast('\u26A0\uFE0F Архив не загрузился: ' + err, '#BA7517'); return; }
        proceed();
      });
    });

    inpEl.addEventListener('input', paint);
    b.appendChild(inpEl); b.appendChild(archBtn); b.appendChild(results);
    m.appendChild(h); m.appendChild(b);
    bg.appendChild(m);
    document.body.appendChild(bg);
    paint();
    setTimeout(function(){ try{ inpEl.focus(); }catch(e){} }, 50);
  }

  // Архив заказов (v4.9): плоский список (не доска — тащить статусы
  // архивным заказам незачем), грузится лениво при заходе на вкладку.
  // Клик по строке ничего не открывает — карточку архивных заказов не
  // редактируют, всё действие — кнопка "Вернуть".
  function archiveMatches(o){
    if(!ARCHIVE_SEARCH) return true;
    var s = ARCHIVE_SEARCH.toLowerCase();
    return String(o.num).toLowerCase().indexOf(s)>=0 ||
      String(o.client||'').toLowerCase().indexOf(s)>=0 ||
      String(o.phone||'').toLowerCase().indexOf(s)>=0 ||
      String(o.city||'').toLowerCase().indexOf(s)>=0;
  }
  function renderArchive(view){
    var wrap = document.createElement('div');
    var search = document.createElement('input');
    search.type = 'search'; search.placeholder = 'Поиск: №, клиент, телефон, город...';
    search.value = ARCHIVE_SEARCH; search.style.width = '100%'; search.style.marginBottom = '10px';
    search.addEventListener('input', function(){ ARCHIVE_SEARCH = search.value.trim(); paintArchiveList(); });
    wrap.appendChild(search);
    var listBox = document.createElement('div');
    wrap.appendChild(listBox);
    view.appendChild(wrap);

    function skRow(w){
      var r = document.createElement('div');
      r.className = 'crm-arch-row';
      var strip = document.createElement('div'); strip.className = 'crm-sk'; strip.style.cssText = 'width:4px;align-self:stretch;border-radius:2px;flex-shrink:0';
      var av = document.createElement('div'); av.className = 'crm-sk'; av.style.cssText = 'width:28px;height:28px;border-radius:50%;flex-shrink:0';
      var mid = document.createElement('div'); mid.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:6px';
      var t = document.createElement('div'); t.className = 'crm-sk'; t.style.cssText = 'height:12px;width:' + w + '%';
      var sub = document.createElement('div'); sub.className = 'crm-sk'; sub.style.cssText = 'height:10px;width:' + Math.round(w * 0.6) + '%';
      mid.appendChild(t); mid.appendChild(sub);
      var btn = document.createElement('div'); btn.className = 'crm-sk'; btn.style.cssText = 'height:26px;width:64px;flex-shrink:0';
      r.appendChild(strip); r.appendChild(av); r.appendChild(mid); r.appendChild(btn);
      return r;
    }
    var skWrap = document.createElement('div');
    [65, 50, 58].forEach(function(w){ skWrap.appendChild(skRow(w)); });
    listBox.appendChild(skWrap);

    function archiveRow(o){
      var r = document.createElement('div');
      r.className = 'crm-arch-row';
      var strip = document.createElement('div');
      strip.className = 'crm-arch-strip';
      strip.style.background = ST_COLOR[o.status] || '#888780';
      var av = document.createElement('div');
      av.className = 'crm-arch-av';
      av.textContent = initialsOf(o.client);
      var mid = document.createElement('div');
      mid.className = 'crm-arch-mid';
      var t = document.createElement('div'); t.className = 'crm-arch-t';
      t.textContent = '\u2116' + o.num + ' \u00b7 ' + (o.client || '\u2014');
      var sub = document.createElement('div'); sub.className = 'crm-arch-sub';
      sub.textContent = [o.city, o.furn, o.status].filter(Boolean).join(' \u00b7 ');
      mid.appendChild(t); mid.appendChild(sub);
      var right = document.createElement('div');
      right.className = 'crm-arch-right';
      var sum = document.createElement('div'); sum.className = 'crm-arch-sum';
      sum.textContent = fm0(o.sogl || o.pred);
      var upd = document.createElement('div'); upd.className = 'crm-arch-upd';
      upd.textContent = o.updated ? 'обновлён ' + fmtDate(o.updated) : '';
      right.appendChild(sum); right.appendChild(upd);
      var bRet = document.createElement('button');
      bRet.className = 'crm-vbtn';
      bRet.textContent = '\u21a9 Вернуть';
      bRet.title = 'Вернуть заказ из архива в рабочий список';
      bRet.addEventListener('click', function(e){
        e.stopPropagation();
        if(!confirm('Вернуть заказ \u2116' + o.num + ' из архива в рабочий список?')) return;
        // Optimistic: строка сворачивается и заказ переезжает в ORDERS сразу,
        // запрос уходит в фоне. Ошибка — откат (строка разворачивается назад,
        // заказ возвращается в ARCHIVE). paintArchiveList() тут не нужен —
        // ARCHIVE уже не содержит заказ, а сама строка убирается transition'ом.
        r.classList.add('crm-arch-leaving');
        ARCHIVE = ARCHIVE.filter(function(x){ return String(x.num) !== String(o.num); });
        ORDERS.push(o);
        toast('OK \u2116' + o.num + ' возвращён из архива', '#1a5252');
        post({ action:'restoreFromArchive', num: String(o.num) }, function(){
          setTimeout(function(){ if(r.parentNode) r.remove(); }, 320);
        }, function(err){
          ORDERS = ORDERS.filter(function(x){ return String(x.num) !== String(o.num); });
          ARCHIVE.push(o);
          r.classList.remove('crm-arch-leaving');
          if(err === '__no_key__'){ toast('\u26A0\uFE0F Введи ключ доступа \u2014 заказ остался в архиве', '#BA7517'); return; }
          toast('\u26A0\uFE0F Не вернулся: ' + err + ' \u2014 заказ снова в архиве', '#BA7517');
        });
      });
      r.appendChild(strip); r.appendChild(av); r.appendChild(mid); r.appendChild(right); r.appendChild(bRet);
      return r;
    }

    function paintArchiveList(){
      listBox.innerHTML = '';
      var vis = ARCHIVE.filter(archiveMatches);
      if(!ARCHIVE.length){
        var e0 = document.createElement('div'); e0.className = 'crm-empty';
        e0.textContent = 'Архив пуст. Заказы Готова/Отказ уезжают сюда автоматически через 30 дней (без незакрытых рекламаций).';
        listBox.appendChild(e0);
        return;
      }
      if(!vis.length){
        var e1 = document.createElement('div'); e1.className = 'crm-empty';
        e1.textContent = 'Ничего не найдено по запросу.';
        listBox.appendChild(e1);
        return;
      }
      var cntEl = document.createElement('div'); cntEl.className = 'crm-arch-cnt';
      cntEl.textContent = vis.length + ' из ' + ARCHIVE.length;
      listBox.appendChild(cntEl);
      vis.forEach(function(o){ listBox.appendChild(archiveRow(o)); });
    }

    fetchArchive(function(err){
      if(err === '__no_key__'){
        skWrap.innerHTML = '';
        var e0 = document.createElement('div'); e0.className = 'crm-empty'; e0.textContent = 'Введи ключ доступа во вкладке заказов.';
        skWrap.appendChild(e0);
        return;
      }
      if(err){
        skWrap.innerHTML = '';
        var e1 = document.createElement('div'); e1.className = 'crm-empty'; e1.textContent = 'Архив не загрузился: ' + err;
        skWrap.appendChild(e1);
        return;
      }
      skWrap.remove();
      paintArchiveList();
    });
  }

  // ── v4.11: Задачи — сквозной список по всем сделкам. Optimistic UI —
  // тот же приём, что Архив (v4.10) и Касса (v4.11): визуальный отклик
  // сразу по клику, данные/полный renderAll() — только при подтверждении
  // от сервера, откат — по ошибке.
  function taskRowEl(t, compact){
    var r = document.createElement('div');
    r.className = 'crm-task-row' + (compact ? ' compact' : '');
    var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!t.done;
    cb.addEventListener('click', function(){ toggleTaskDone(t, r, compact); });
    var body = document.createElement('span');
    body.className = 'tx' + (t.done ? ' done' : '');
    body.textContent = (compact ? '' : ('\u2116' + t.num + ' \u00B7 ')) + t.text;
    if(!compact){
      body.style.cursor = 'pointer';
      body.addEventListener('click', function(){ openCard(t.num); });
    }
    var dl = document.createElement('span');
    dl.className = 'dl ' + (t.done ? 'done' : taskDueStatus(t));
    dl.textContent = taskDeadlineLabel_(t);
    var del = document.createElement('button'); del.className = 'del'; del.textContent = '\u2715';
    del.title = 'Удалить задачу';
    del.addEventListener('click', function(){ deleteTask(t, r); });
    r.appendChild(cb); r.appendChild(body); r.appendChild(dl); r.appendChild(del);
    return r;
  }
  // Перекрашивает существующую DOM-строку задачи на месте (без пересборки
  // списка) — используется и для оптимистичного отклика, и для отката.
  function paintTaskRow_(r, t){
    var cbEl = r.querySelector('input[type=checkbox]'); if(cbEl) cbEl.checked = !!t.done;
    var body = r.querySelector('.tx'); if(body) body.classList.toggle('done', !!t.done);
    var dl = r.querySelector('.dl');
    if(dl){ dl.className = 'dl ' + (t.done ? 'done' : taskDueStatus(t)); dl.textContent = taskDeadlineLabel_(t); }
  }
  // compact=false (сквозная вкладка «Задачи»): отметка «сделано» сразу
  // сворачивает строку — как удаление в Кассе. compact=true (карточка
  // заказа): по решению Дали задача остаётся видна зачёркнутой — это
  // история по сделке, а не рабочий список на сегодня.
  function toggleTaskDone(t, r, compact){
    var prevDone = t.done;
    var newDone = !prevDone;
    t.done = newDone;
    var willCollapse = !compact && newDone;
    if(willCollapse) r.classList.add('crm-task-leaving');
    else paintTaskRow_(r, t);
    post({ action:'toggleTask', id: t.id, done: newDone }, function(){
      renderAll(); // бейдж мог измениться (сегодня/просрочено) — обновляем нав
    }, function(err){
      t.done = prevDone;
      if(willCollapse) r.classList.remove('crm-task-leaving');
      paintTaskRow_(r, t); // чекбокс браузер переключает нативно по клику независимо от нас — сверяем визуал с откаченными данными в любом случае
      toast('\u26A0\uFE0F Не удалось сохранить: ' + err, '#BA7517');
    });
  }
  // Без confirm() — это не деньги (в отличие от delFin), цена ошибки ниже.
  function deleteTask(t, r){
    r.classList.add('crm-task-leaving');
    post({ action:'delTask', id: t.id }, function(){
      TASKS = TASKS.filter(function(x){ return x.id !== t.id; });
      renderAll();
    }, function(err){
      r.classList.remove('crm-task-leaving');
      toast('\u26A0\uFE0F Не удалилось: ' + err, '#BA7517');
    });
  }

  function renderTasks(view){
    if(!TASKS_LOADED){
      var ld = document.createElement('div'); ld.className = 'crm-empty';
      ld.textContent = 'Загружаю задачи...';
      view.appendChild(ld);
      fetchTasks(function(err){
        if(err === '__no_key__'){ ld.textContent = 'Введи ключ доступа во вкладке заказов.'; return; }
        if(err){ ld.textContent = 'Задачи не загрузились: ' + err; return; }
        renderView();
      });
      return;
    }
    var head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px';
    var t0 = document.createElement('b'); t0.textContent = 'Задачи';
    var right = document.createElement('div'); right.style.cssText = 'display:flex;align-items:center;gap:12px';
    var showDoneLbl = document.createElement('label');
    showDoneLbl.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;color:#888;cursor:pointer';
    var showDoneCb = document.createElement('input'); showDoneCb.type = 'checkbox'; showDoneCb.checked = TASKS_SHOW_DONE;
    showDoneCb.addEventListener('change', function(){ TASKS_SHOW_DONE = showDoneCb.checked; renderAll(); });
    showDoneLbl.appendChild(showDoneCb); showDoneLbl.appendChild(document.createTextNode('показать выполненные'));
    var bAdd = document.createElement('button'); bAdd.className = 'crm-vbtn new'; bAdd.textContent = '+ Задача';
    bAdd.addEventListener('click', openTaskModal);
    right.appendChild(showDoneLbl); right.appendChild(bAdd);
    head.appendChild(t0); head.appendChild(right);
    view.appendChild(head);

    var sorted = TASKS.filter(function(t){ return TASKS_SHOW_DONE || !t.done; }).slice().sort(function(a,b){
      var da = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      var db = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      return da - db;
    });
    if(!sorted.length){
      var e = document.createElement('div'); e.className = 'crm-empty';
      e.textContent = TASKS_SHOW_DONE ? 'Задач нет.' : 'Активных задач нет.';
      view.appendChild(e);
      return;
    }
    var list = document.createElement('div'); list.className = 'crm-tasklist';
    sorted.forEach(function(t){ list.appendChild(taskRowEl(t, false)); });
    view.appendChild(list);
  }

  // Модалка «+ Задача»: № заказа (автодополнение) + текст + дедлайн.
  // Optimistic — как + Операция в Кассе: закрывается и попадает в
  // список сразу, откат по ошибке.
  function openTaskModal(pre){
    pre = (pre && pre.num !== undefined) ? pre : {};
    var bg = document.createElement('div'); bg.className = 'crm-modal-bg';
    bg.addEventListener('click', function(e){ if(e.target===bg) document.body.removeChild(bg); });
    var m = document.createElement('div'); m.className = 'crm-modal'; m.style.maxWidth = '360px';
    var h = document.createElement('div'); h.className = 'crm-m-h';
    var hcol = document.createElement('div'); hcol.style.minWidth = '0';
    var title = document.createElement('div'); title.className = 'crm-h-t'; title.textContent = '+ Задача';
    hcol.appendChild(title);
    var x = document.createElement('button'); x.className = 'crm-m-x'; x.textContent = '\u00D7';
    x.addEventListener('click', function(){ document.body.removeChild(bg); });
    h.appendChild(hcol); h.appendChild(x);
    var b = document.createElement('div'); b.className = 'crm-m-b';

    var iNum = inp(pre.num || '');
    iNum.setAttribute('list', 'crm-task-nums');
    var dl = document.createElement('datalist'); dl.id = 'crm-task-nums';
    ORDERS.forEach(function(o){ var op = document.createElement('option'); op.value = o.num; op.label = o.client || ''; dl.appendChild(op); });
    var iText = inp('');
    var iDeadline = inp('', 'date');

    b.appendChild(field('\u2116 заказа', iNum));
    b.appendChild(dl);
    b.appendChild(field('Что сделать', iText));
    b.appendChild(field('Дедлайн', iDeadline));

    var btns = document.createElement('div'); btns.className = 'crm-m-btns';
    var bSave = document.createElement('button'); bSave.className = 'crm-m-btn save'; bSave.textContent = 'Сохранить';
    bSave.addEventListener('click', function(){
      var num = iNum.value.trim();
      var text = iText.value.trim();
      var deadline = iDeadline.value;
      if(!num){ toast('\u26A0\uFE0F Укажи № заказа', '#BA7517'); return; }
      if(!text){ toast('\u26A0\uFE0F Опиши задачу', '#BA7517'); return; }
      if(!deadline){ toast('\u26A0\uFE0F Укажи дедлайн', '#BA7517'); return; }
      document.body.removeChild(bg);
      var rec = { id: 'tmp' + Date.now(), num: num, text: text, deadline: deadline, done: false };
      TASKS.unshift(rec);
      renderAll();
      post({ action:'addTask', task: { num: num, text: text, deadline: deadline } }, function(res){
        if(res && res.id) rec.id = res.id;
      }, function(err){
        TASKS = TASKS.filter(function(x){ return x.id !== rec.id; });
        renderAll();
        toast('\u26A0\uFE0F Не сохранилось: ' + err, '#BA7517');
      });
    });
    btns.appendChild(bSave);
    b.appendChild(btns);
    m.appendChild(h); m.appendChild(b);
    bg.appendChild(m);
    document.body.appendChild(bg);
    setTimeout(function(){ try{ iNum.focus(); }catch(e){} }, 50);
  }

  // Балансовая вкладка: «Пора докупить», склад в деньгах, поиск,
  // сортировка, фильтр дефицита, минимумы и быстрые ± по строке.
  function buildBalance(view){
    var all = STOCK.slice().filter(function(s){ return s && s.key; });
    if(!all.length){
      var e0 = document.createElement('div'); e0.className = 'crm-empty';
      e0.textContent = 'Склад пуст. Нажми «+ Приход», чтобы оприходовать материалы и фурнитуру.';
      view.appendChild(e0); return;
    }
    var prices = stockPriceMap();

    var deficit = stockDeficitList();
    if(deficit.length){
      var dt = document.createElement('div'); dt.className = 'crm-sec-t';
      dt.textContent = '\uD83E\uDDF0 Пора докупить';
      view.appendChild(dt);
      var dbox = document.createElement('div');
      dbox.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px';
      deficit.slice(0, 12).forEach(function(d){
        var chip = document.createElement('span');
        var zero = d.qty <= 0;
        var chipCol = zero ? 'background:#BA1B1B1f;color:#BA1B1B' : 'background:#BA75171f;color:#BA7517';
        chip.style.cssText = 'font-size:11px;font-weight:700;padding:3px 8px;border-radius:8px;cursor:default;' + chipCol;
        chip.textContent = d.name + ' \u2014 ' + (zero ? 'закончилось' : d.qty + ' / мин ' + d.min);
        dbox.appendChild(chip);
      });
      if(deficit.length > 12){
        var dm = document.createElement('span');
        dm.style.cssText = 'font-size:11px;color:#999;align-self:center';
        dm.textContent = '\u2026и ещё ' + (deficit.length - 12);
        dbox.appendChild(dm);
      }
      view.appendChild(dbox);
    }

    var totalVal = 0, priced = 0, positive = 0;
    all.forEach(function(s){
      var q = Math.round(Number(s.qty) || 0);
      if(q <= 0) return;
      positive++;
      var pr = prices[s.key];
      if(pr > 0){ totalVal += q * pr; priced++; }
    });
    if(priced > 0){
      var money = document.createElement('div');
      money.style.cssText = 'font-size:12px;color:#555;margin-bottom:10px';
      var covNote = priced < positive ? ' (цены нашлись для ' + priced + ' из ' + positive + ' позиций)' : '';
      money.textContent = '\uD83D\uDCB0 Склад в деньгах: ' + fm0(totalVal) + covNote;
      view.appendChild(money);
    }

    var ctrl = document.createElement('div');
    ctrl.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px';
    var iSearch = document.createElement('input');
    iSearch.type = 'search';
    iSearch.placeholder = 'Поиск по названию или ключу...';
    iSearch.value = STOCK_SEARCH;
    iSearch.style.cssText = 'flex:1;min-width:150px';
    var bSortN = document.createElement('button');
    var bSortQ = document.createElement('button');
    var bDef = document.createElement('button');
    bDef.title = 'Показать только закончившееся и ниже минимума';
    function paintCtrl(){
      bSortN.className = 'crm-vbtn' + (STOCK_SORT === 'name' ? ' on' : '');
      bSortN.textContent = 'А\u2013Я';
      bSortQ.className = 'crm-vbtn' + (STOCK_SORT !== 'name' ? ' on' : '');
      bSortQ.textContent = 'Остаток ' + (STOCK_SORT === 'qty_desc' ? '\u2193' : '\u2191');
      bDef.className = 'crm-vbtn' + (STOCK_DEF_ONLY ? ' on' : '');
      bDef.textContent = 'Только дефицит';
    }
    iSearch.addEventListener('input', function(){ STOCK_SEARCH = iSearch.value; paintList(); });
    bSortN.addEventListener('click', function(){ STOCK_SORT = 'name'; paintCtrl(); paintList(); });
    bSortQ.addEventListener('click', function(){ STOCK_SORT = STOCK_SORT === 'qty' ? 'qty_desc' : 'qty'; paintCtrl(); paintList(); });
    bDef.addEventListener('click', function(){ STOCK_DEF_ONLY = !STOCK_DEF_ONLY; paintCtrl(); paintList(); });
    paintCtrl();
    ctrl.appendChild(iSearch); ctrl.appendChild(bSortN); ctrl.appendChild(bSortQ); ctrl.appendChild(bDef);
    view.appendChild(ctrl);

    var listWrap = document.createElement('div');
    view.appendChild(listWrap);

    function paintList(){
      listWrap.innerHTML = '';
      var q = STOCK_SEARCH.trim().toLowerCase();
      var rows = all.filter(function(s){
        if(STOCK_DEF_ONLY){
          var qq = Math.round(Number(s.qty) || 0);
          var mn0 = minOf(s.key);
          if(!(qq <= 0 || (mn0 > 0 && qq < mn0))) return false;
        }
        if(!q) return true;
        return String(s.name || '').toLowerCase().indexOf(q) >= 0 || String(s.key || '').toLowerCase().indexOf(q) >= 0;
      });
      if(STOCK_SORT === 'name') rows.sort(function(a,b){ return String(a.name||a.key).localeCompare(String(b.name||b.key), 'ru'); });
      else if(STOCK_SORT === 'qty') rows.sort(function(a,b){ return (Number(a.qty)||0) - (Number(b.qty)||0); });
      else rows.sort(function(a,b){ return (Number(b.qty)||0) - (Number(a.qty)||0); });
      if(!rows.length){
        var em = document.createElement('div'); em.className = 'crm-empty';
        em.textContent = 'Ничего не нашлось под поиск/фильтр.';
        listWrap.appendChild(em); return;
      }
      var tbl = document.createElement('table'); tbl.className = 'crm-ftbl';
      var thead = document.createElement('tr');
      ['Наименование','Ключ','Ед','Мин','Срок','Остаток','Резерв','Своб.','Сумма',''].forEach(function(hh){ var th=document.createElement('th'); th.textContent=hh; thead.appendChild(th); });
      tbl.appendChild(thead);
      rows.forEach(function(s){
        var qty = Math.round(Number(s.qty) || 0);
        var mn = minOf(s.key);
        var tr = document.createElement('tr');
        var c1 = document.createElement('td'); c1.textContent = String(s.name || s.key); tr.appendChild(c1);
        var c2 = document.createElement('td'); c2.textContent = String(s.key); c2.style.color = '#888'; tr.appendChild(c2);
        var c3 = document.createElement('td'); c3.textContent = String(s.unit || ''); tr.appendChild(c3);
        var c4 = document.createElement('td');
        c4.textContent = mn > 0 ? String(mn) : '\u2014';
        c4.style.cssText = 'color:#999;cursor:pointer';
        c4.title = 'Задать минимальный остаток (0 — снять)';
        c4.addEventListener('click', function(){
          var v = prompt('Минимальный остаток для \u00AB' + (s.name || s.key) + '\u00BB (0 — снять):', mn || '');
          if(v === null) return;
          var nv = Math.round(Number(v));
          if(isNaN(nv) || nv < 0){ toast('\u26A0\uFE0F Нужно целое число не меньше нуля', '#BA7517'); return; }
          post({ action:'saveStockMin', smin:{ key: s.key, min: nv } }, function(){
            if(nv > 0) SMIN[s.key] = nv; else delete SMIN[s.key];
            if(VIEW === 'stock') renderAll();
            toast(nv > 0 ? 'OK Минимум: ' + nv : 'OK Минимум снят', '#1a5252');
          }, function(err){ toast('\u26A0\uFE0F Не сохранилось: ' + err, '#BA7517'); });
        });
        tr.appendChild(c4);
        var c4b = document.createElement('td');
        var ld = leadOf(s.key);
        c4b.textContent = ld > 0 ? String(ld) + ' \u0434\u043D' : '\u2014';
        c4b.style.cssText = 'color:#999;cursor:pointer';
        c4b.title = 'Срок поставки этой позиции в днях (0 \u2014 снять). Используется для предупреждения «пора заказать» по датам монтажа.';
        c4b.addEventListener('click', function(){
          var v = prompt('Срок поставки \u00AB' + (s.name || s.key) + '\u00BB в днях (0 \u2014 снять):', ld || '');
          if(v === null) return;
          var nv = Math.round(Number(v));
          if(isNaN(nv) || nv < 0){ toast('\u26A0\uFE0F Нужно целое число не меньше нуля', '#BA7517'); return; }
          post({ action:'saveStockMin', smin:{ key: s.key, lead: nv } }, function(){
            if(nv > 0) SLEAD[s.key] = nv; else delete SLEAD[s.key];
            if(VIEW === 'stock') renderAll();
            toast(nv > 0 ? 'OK Срок: ' + nv + ' дн' : 'OK Срок снят', '#1a5252');
          }, function(err){ toast('\u26A0\uFE0F Не сохранилось: ' + err, '#BA7517'); });
        });
        tr.appendChild(c4b);
        var c5 = document.createElement('td'); c5.textContent = String(qty);
        if(qty <= 0){ c5.style.color = '#BA1B1B'; c5.style.fontWeight = '600'; }
        else if(mn > 0 && qty < mn){ c5.style.color = '#BA7517'; c5.style.fontWeight = '600'; }
        tr.appendChild(c5);
        var resv = RESERVED_LOADED ? (Math.round(RESERVED[s.key]) || 0) : null;
        var c5b = document.createElement('td');
        c5b.textContent = resv === null ? '\u2014' : String(resv);
        c5b.style.color = '#999';
        tr.appendChild(c5b);
        var c5c = document.createElement('td');
        if(resv === null){
          c5c.textContent = '\u2014';
          c5c.style.color = '#999';
        } else {
          var free = qty - resv;
          c5c.textContent = String(free);
          if(free < 0){ c5c.style.color = '#BA1B1B'; c5c.style.fontWeight = '600'; }
          else if(resv > 0){ c5c.style.color = '#BA7517'; }
        }
        tr.appendChild(c5c);
        var c6 = document.createElement('td');
        var pr = prices[s.key];
        c6.textContent = (qty > 0 && pr > 0) ? fm0(qty * pr) : '';
        c6.style.color = '#888';
        tr.appendChild(c6);
        var c7 = document.createElement('td');
        c7.style.whiteSpace = 'nowrap';
        var bP = document.createElement('button'); bP.className = 'crm-vbtn'; bP.textContent = '+';
        bP.title = 'Приход этой позиции';
        bP.style.padding = '2px 8px';
        bP.addEventListener('click', function(){ openStockModal({ type:'Приход', key: s.key, name: s.name, unit: s.unit }); });
        var bM = document.createElement('button'); bM.className = 'crm-vbtn'; bM.textContent = '\u2212';
        bM.title = 'Выдача этой позиции';
        bM.style.cssText = 'padding:2px 8px;margin-left:4px';
        bM.addEventListener('click', function(){ openStockModal({ type:'Расход', key: s.key, name: s.name, unit: s.unit }); });
        c7.appendChild(bP); c7.appendChild(bM);
        tr.appendChild(c7);
        tbl.appendChild(tr);
      });
      listWrap.appendChild(tbl);
    }
    paintList();
  }

  // История движений: поиск + удаление ошибочной строки (остаток
  // пересчитается сам — он всегда вычисляется из журнала).
  function renderStockHistory(view){
    var ld = document.createElement('div'); ld.className = 'crm-empty'; ld.textContent = 'Загружаю историю...';
    view.appendChild(ld);
    fetchStockMoves(function(err){
      if(err === '__no_key__'){ ld.textContent = 'Введи ключ доступа во вкладке заказов.'; return; }
      if(err){ ld.textContent = 'История не загрузилась: ' + err; return; }
      ld.style.display = 'none';

      var iSearch = document.createElement('input');
      iSearch.type = 'search';
      iSearch.placeholder = 'Поиск: название, ключ или \u2116 заказа...';
      iSearch.value = STOCK_HSEARCH;
      iSearch.style.cssText = 'width:100%;box-sizing:border-box;margin-bottom:8px';
      view.appendChild(iSearch);
      var listWrap = document.createElement('div');
      view.appendChild(listWrap);
      iSearch.addEventListener('input', function(){ STOCK_HSEARCH = iSearch.value; paintHist(); });

      function paintHist(){
        listWrap.innerHTML = '';
        var q = STOCK_HSEARCH.trim().toLowerCase();
        var rows = STOCK_MOVES.slice().filter(function(m){
          if(!m || !m.key) return false;
          if(!q) return true;
          return String(m.name || '').toLowerCase().indexOf(q) >= 0 ||
                 String(m.key || '').toLowerCase().indexOf(q) >= 0 ||
                 String(m.num || '').toLowerCase().indexOf(q) >= 0;
        });
        rows.sort(function(a,b){ return new Date(b.date) - new Date(a.date); });
        if(!rows.length){
          var e = document.createElement('div'); e.className = 'crm-empty';
          e.textContent = q ? 'Ничего не нашлось под поиск.' : 'Движений пока нет.';
          listWrap.appendChild(e); return;
        }
        var tbl = document.createElement('table'); tbl.className = 'crm-ftbl';
        var thead = document.createElement('tr');
        ['Дата','Тип','Наименование','Ключ','Ед','Кол-во','\u2116 заказа',''].forEach(function(hh){ var th=document.createElement('th'); th.textContent=hh; thead.appendChild(th); });
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
          var c8 = document.createElement('td');
          var del = document.createElement('button'); del.className = 'crm-vbtn'; del.textContent = '\u2715';
          del.title = 'Удалить движение (остаток пересчитается)';
          del.style.padding = '2px 8px';
          del.addEventListener('click', function(){
            var label = m.type + ' ' + Math.round(Number(m.qty)||0) + ' ' + (m.unit||'') + ' \u00AB' + (m.name || m.key) + '\u00BB от ' + fmtDate(m.date);
            if(!confirm('Удалить движение: ' + label + '? Остаток по позиции пересчитается.')) return;
            del.disabled = true;
            post({ action:'delStockMove', id: m.id }, function(){
              STOCK_MOVES = STOCK_MOVES.filter(function(x){ return x.id !== m.id; });
              STOCK_LOADED = false;
              paintHist();
              toast('OK Движение удалено, остаток пересчитан', '#1a5252');
            }, function(err2){
              del.disabled = false;
              toast('\u26A0\uFE0F Не удалилось: ' + err2, '#BA7517');
            });
          });
          c8.appendChild(del);
          tr.appendChild(c8);
          tbl.appendChild(tr);
        });
        listWrap.appendChild(tbl);
      }
      paintHist();
    });
  }

  // Инвентаризация: вводишь фактические остатки, разница превращается
  // в корректирующие приход/расход одним батчем (сервер уже умеет).
  // Пустое поле = позицию не трогаем.
  function openInventoryModal(){
    if(!STOCK_LOADED || !STOCK.length){
      toast('\u26A0\uFE0F Сначала открой Остатки \u2014 нужен текущий список позиций', '#BA7517');
      return;
    }
    var items = STOCK.slice().filter(function(s){ return s && s.key; });
    items.sort(function(a,b){ return String(a.name||a.key).localeCompare(String(b.name||b.key), 'ru'); });
    var bg = document.createElement('div'); bg.className = 'crm-modal-bg';
    bg.addEventListener('click', function(e){ if(e.target===bg) document.body.removeChild(bg); });
    var m = document.createElement('div'); m.className = 'crm-modal';
    var h = document.createElement('div'); h.className = 'crm-m-h';
    var title = document.createElement('b'); title.textContent = '\uD83D\uDCCB Инвентаризация';
    var x = document.createElement('button'); x.className = 'crm-m-x'; x.textContent = '\u00D7';
    x.addEventListener('click', function(){ document.body.removeChild(bg); });
    h.appendChild(title); h.appendChild(x);
    var b = document.createElement('div'); b.className = 'crm-m-b';
    var hint = document.createElement('div'); hint.className = 'crm-empty';
    hint.style.cssText = 'text-align:left;font-size:11px;padding:4px 0';
    hint.textContent = 'Пройди по цеху и впиши фактическое количество. Пустое поле — позицию не трогаем. «Провести» создаст корректирующие движения на разницу.';
    b.appendChild(hint);
    var tbl = document.createElement('table'); tbl.className = 'crm-ftbl';
    var thead = document.createElement('tr');
    ['Наименование','Ед','Учёт','Факт'].forEach(function(hh){ var th=document.createElement('th'); th.textContent=hh; thead.appendChild(th); });
    tbl.appendChild(thead);
    var inputs = [];
    items.forEach(function(s){
      var qty = Math.round(Number(s.qty) || 0);
      var tr = document.createElement('tr');
      var c1 = document.createElement('td'); c1.textContent = String(s.name || s.key); tr.appendChild(c1);
      var c2 = document.createElement('td'); c2.textContent = String(s.unit || ''); tr.appendChild(c2);
      var c3 = document.createElement('td'); c3.textContent = String(qty); c3.style.color = '#888'; tr.appendChild(c3);
      var c4 = document.createElement('td');
      var inpF = document.createElement('input');
      inpF.type = 'number'; inpF.setAttribute('min','0'); inpF.setAttribute('step','1');
      inpF.placeholder = String(qty);
      inpF.style.width = '72px';
      c4.appendChild(inpF);
      tr.appendChild(c4);
      tbl.appendChild(tr);
      inputs.push({ s: s, qty: qty, inp: inpF });
    });
    b.appendChild(tbl);
    var btns = document.createElement('div'); btns.className = 'crm-m-btns';
    var bGo = document.createElement('button'); bGo.className = 'crm-m-btn save'; bGo.textContent = 'Провести инвентаризацию';
    bGo.addEventListener('click', function(){
      var moves = [];
      var tag = '[Инвентаризация ' + fmtDate(new Date()) + ']';
      for(var i = 0; i < inputs.length; i++){
        var it = inputs[i];
        var v = it.inp.value.trim();
        if(v === '') continue;
        var n = Math.round(Number(v));
        if(isNaN(n) || n < 0){
          toast('\u26A0\uFE0F \u00AB' + (it.s.name || it.s.key) + '\u00BB: факт должен быть целым числом не меньше нуля', '#BA7517');
          return;
        }
        var diff = n - it.qty;
        if(!diff) continue;
        moves.push({
          type: diff > 0 ? 'Приход' : 'Расход',
          key: it.s.key, name: it.s.name || it.s.key, unit: it.s.unit || 'шт',
          qty: Math.abs(diff), num: '', comment: tag
        });
      }
      if(!moves.length){
        toast('OK Расхождений нет \u2014 склад сходится с фактом!', '#1a5252');
        document.body.removeChild(bg);
        return;
      }
      if(!confirm('Расхождения по ' + moves.length + ' позициям. Создать корректирующие движения?')) return;
      bGo.disabled = true; bGo.textContent = 'Провожу...';
      post({ action:'stockMove', stock:{ moves: moves } }, function(){
        document.body.removeChild(bg);
        STOCK_LOADED = false; STOCK_MOVES_LOADED = false; RESERVED_LOADED = false;
        if(VIEW === 'stock') renderAll();
        toast('OK Инвентаризация проведена: скорректировано позиций \u2014 ' + moves.length, '#1a5252');
      }, function(err){
        bGo.disabled = false; bGo.textContent = 'Провести инвентаризацию';
        toast('\u26A0\uFE0F Не провелось: ' + err, '#BA7517');
      });
    });
    btns.appendChild(bGo);
    b.appendChild(btns);
    m.appendChild(h); m.appendChild(b);
    bg.appendChild(m);
    document.body.appendChild(bg);
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
        RESERVED_LOADED = false;
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
    var subs = [['kassa','Касса'],['pay','Зарплаты'],['recur','Постоянные'],['sales','Продажи'],['analytics','Аналитика']];
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
    else if(FIN_SUB === 'analytics') renderSubAnalytics(view);
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
    // v4.14: для проверки «всё ли начислено за месяц» нужны постоянные и
    // оклады. Грузим их фоном и перерисовываем — кассу ждать не заставляем.
    if(!RECUR_LOADED){ fetchRecur(function(err){ if(!err) renderView(); }); }
    if(!EMP_LOADED){ fetchEmp(function(err){ if(!err) renderView(); }); }
    if(!DOP_LOADED){ fetchDop(function(err){ if(!err) renderView(); }); }
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
    var inc = 0, exp = 0, badCnt = 0, badSum = 0;
    FIN.forEach(function(f){
      if(monthKey(f.date) !== FIN_MONTH) return;
      var s = Number(f.sum)||0;
      // v4.14: раньше здесь было «иначе — расход», и любая строка с пустым
      // или опечатанным типом молча уменьшала прибыль. Теперь расходом
      // считается только явный «Расход», остальное — проблема данных.
      if(f.type === 'Приход') inc += s;
      else if(f.type === 'Расход') exp += s;
      else { badCnt++; badSum += s; }
    });
    var net = inc - exp;

    // ── Обязательства месяца (v4.14) ────────────────────────────────
    // Раньше «чистый доход месяца» показывал только то, что реально
    // проведено в кассе. Если кнопку «Начислить» забыли нажать, аренда и
    // оклады в расход не попадали, и крупная зелёная цифра показывала
    // прибыль там, где месяц на самом деле убыточный.
    //
    // Считаем ожидаемые начисления = активные постоянные + активные оклады
    // (ровно то, что умеет закрыть кнопка «Начислить»), сравниваем с уже
    // проведённым по тегам '[Постоянные ГГГГ-ММ' / '[Оклад ГГГГ-ММ',
    // которые проставляет accrueMonth_ в Code.gs.
    var expectRecur = 0, expectSalary = 0;
    if(RECUR_LOADED) RECUR.forEach(function(r){ if(r.active && Number(r.sum) > 0) expectRecur += Number(r.sum)||0; });
    if(EMP_LOADED) EMP.forEach(function(e){ if(e.active && Number(e.salary) > 0) expectSalary += Number(e.salary)||0; });
    // v4.14: процент с заказов и доп. работы теперь тоже начисляются кнопкой,
    // поэтому входят в ожидаемое. Берём ровно ту сумму, которую кнопка и
    // создаст (payrollRows), — тогда после нажатия недостача станет нулём.
    var expectPct = 0;
    payrollRows(FIN_MONTH).forEach(function(r){ expectPct += Number(r.sum)||0; });
    var accrued = 0;
    FIN.forEach(function(f){
      if(monthKey(f.date) !== FIN_MONTH) return;
      if(f.type !== 'Расход') return;
      var c = String(f.comment || '');
      if(c.indexOf('[\u041f\u043e\u0441\u0442\u043e\u044f\u043d\u043d\u044b\u0435 ' + FIN_MONTH) === 0 ||
         c.indexOf('[\u041e\u043a\u043b\u0430\u0434 ' + FIN_MONTH) === 0 ||
         c.indexOf('[\u041f\u0440\u043e\u0446\u0435\u043d\u0442 ' + FIN_MONTH) === 0) accrued += Number(f.sum)||0;
    });
    var expectTotal = expectRecur + expectSalary + expectPct;
    var missing = Math.max(0, expectTotal - accrued);
    var canCheck = RECUR_LOADED && EMP_LOADED;
    var honest = net - missing;

    // Процент мастеров за месяц: реальное обязательство, но кнопкой
    // «Начислить» пока не закрывается — показываем отдельно, чтобы не
    // висело вечное предупреждение о недостаче, которое нечем закрыть.
    var unassigned = LOADED ? Math.round(payrollForMonth(FIN_MONTH).unassignedM) : 0;
    if(unassigned > 0){
      var pw = document.createElement('div'); pw.className='crm-fin-note';
      pw.style.color = '#BA7517';
      pw.textContent = '\u0418\u0437 \u043d\u0438\u0445 ' + fm0(unassigned) + ' \u2014 \u043f\u043e \u0437\u0430\u043a\u0430\u0437\u0430\u043c \u0431\u0435\u0437 \u043d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u043d\u043e\u0433\u043e \u043c\u0430\u0441\u0442\u0435\u0440\u0430. \u0414\u0435\u043d\u044c\u0433\u0438 \u0432 \u043a\u0430\u0441\u0441\u0435 \u0443\u0447\u0442\u0443\u0442\u0441\u044f, \u043d\u043e \u043a\u043e\u043c\u0443 \u043f\u043b\u0430\u0442\u0438\u0442\u044c \u2014 \u043d\u0435\u044f\u0441\u043d\u043e. \u041e\u0442\u043a\u0440\u043e\u0439 \u0437\u0430\u043a\u0430\u0437 \u0438 \u0432\u044b\u0431\u0435\u0440\u0438 \u0431\u0440\u0438\u0433\u0430\u0434\u0443.';
      view.appendChild(pw);
    }

    var t0 = document.createElement('div'); t0.className='crm-sec-t';
    t0.textContent = 'Итог месяца';
    view.appendChild(t0);
    var sum = document.createElement('div'); sum.className='crm-sum';
    sumTile(sum, '+' + fm0(inc), 'приход за месяц');
    sumTile(sum, '\u2212' + fm0(exp), 'расход за месяц', 'warn');
    sumTile(sum, (honest>=0?'+':'\u2212') + fm0(Math.abs(honest)), 'чистый доход месяца', honest<0 ? 'warn' : '');
    view.appendChild(sum);

    if(canCheck && missing > 0){
      var parts = ['\u043f\u043e\u0441\u0442\u043e\u044f\u043d\u043d\u044b\u0435 ' + fm0(expectRecur), '\u043e\u043a\u043b\u0430\u0434\u044b ' + fm0(expectSalary)];
      if(expectPct > 0) parts.push('\u043f\u0440\u043e\u0446\u0435\u043d\u0442 \u0438 \u0434\u043e\u043f. \u0440\u0430\u0431\u043e\u0442\u044b ' + fm0(expectPct));
      var mw = document.createElement('div'); mw.className='crm-fin-note';
      mw.style.color = '#BA1B1B';
      mw.textContent = '\u26A0\uFE0F \u041d\u0435 \u043d\u0430\u0447\u0438\u0441\u043b\u0435\u043d\u043e \u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u0441\u0442\u0432 \u043d\u0430 ' + fm0(missing) + ' (' + parts.join(' + ') + '). \u042d\u0442\u0430 \u0441\u0443\u043c\u043c\u0430 \u0443\u0436\u0435 \u0432\u044b\u0447\u0442\u0435\u043d\u0430 \u0438\u0437 \u0447\u0438\u0441\u0442\u043e\u0433\u043e \u0434\u043e\u0445\u043e\u0434\u0430 \u0432\u044b\u0448\u0435 \u2014 \u043d\u0430\u0436\u043c\u0438 \u00ab\u041d\u0430\u0447\u0438\u0441\u043b\u0438\u0442\u044c \u043f\u043e\u0441\u0442\u043e\u044f\u043d\u043d\u044b\u0435 \u0438 \u043e\u043a\u043b\u0430\u0434\u044b\u00bb \u0432\u043e \u0432\u043a\u043b\u0430\u0434\u043a\u0435 \u00ab\u041f\u043e\u0441\u0442\u043e\u044f\u043d\u043d\u044b\u0435\u00bb, \u0447\u0442\u043e\u0431\u044b \u043f\u0440\u043e\u0432\u043e\u0434\u043a\u0438 \u043f\u043e\u044f\u0432\u0438\u043b\u0438\u0441\u044c \u0432 \u043a\u0430\u0441\u0441\u0435.';
      view.appendChild(mw);
    }
    if(badCnt){
      var bw = document.createElement('div'); bw.className='crm-fin-note';
      bw.style.color = '#BA1B1B';
      bw.textContent = '\u26A0\uFE0F \u0412 \u044d\u0442\u043e\u043c \u043c\u0435\u0441\u044f\u0446\u0435 ' + badCnt + ' \u043e\u043f\u0435\u0440\u0430\u0446\u0438\u0439 \u043d\u0430 ' + fm0(badSum) + ' \u0441 \u043d\u0435\u043e\u043f\u043e\u0437\u043d\u0430\u043d\u043d\u044b\u043c \u0442\u0438\u043f\u043e\u043c \u2014 \u0432 \u0438\u0442\u043e\u0433 \u043d\u0435 \u0432\u043e\u0448\u043b\u0438.';
      view.appendChild(bw);
    }
    var note = document.createElement('div'); note.className='crm-fin-note';
    note.textContent = canCheck
      ? '\u0427\u0438\u0441\u0442\u044b\u0439 \u0434\u043e\u0445\u043e\u0434 \u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044f \u0441 \u0443\u0447\u0451\u0442\u043e\u043c \u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u0441\u0442\u0432 \u043c\u0435\u0441\u044f\u0446\u0430, \u0434\u0430\u0436\u0435 \u0435\u0441\u043b\u0438 \u043f\u0440\u043e\u0432\u043e\u0434\u043a\u0438 \u0435\u0449\u0451 \u043d\u0435 \u0441\u043e\u0437\u0434\u0430\u043d\u044b.'
      : '\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044e \u043f\u043e\u0441\u0442\u043e\u044f\u043d\u043d\u044b\u0435 \u0438 \u043e\u043a\u043b\u0430\u0434\u044b \u2014 \u0447\u0438\u0441\u0442\u044b\u0439 \u0434\u043e\u0445\u043e\u0434 \u043f\u043e\u043a\u0430 \u0431\u0435\u0437 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0438 \u043d\u0430\u0447\u0438\u0441\u043b\u0435\u043d\u0438\u0439.';
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
    renderStageTimes(view);
    renderSales(view);
    renderChangesAgg(view);
  }

  // ── Сроки этапов: сколько дней заказы проводят на каждом статусе ──
  // Считается по журналу «Статусы»: время между соседними переходами
  // заказа приписывается более раннему этапу. Средние по всем заказам.
  // Журнал копится с момента обновления — по старым заказам данных нет.
  function renderStageTimes(view){
    var t0 = document.createElement('div'); t0.className='crm-sec-t';
    t0.textContent = '\u23F1 Сроки этапов';
    view.appendChild(t0);
    var box = document.createElement('div');
    box.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px';
    view.appendChild(box);
    function paintStages(){
      box.innerHTML = '';
      if(!SL_LOADED){
        var ld = document.createElement('span');
        ld.style.cssText = 'font-size:11px;color:#999';
        ld.textContent = 'Загружаю журнал...';
        box.appendChild(ld);
        return;
      }
      var byNum = {};
      SL.forEach(function(e){
        if(!byNum[e.num]) byNum[e.num] = [];
        byNum[e.num].push(e);
      });
      var sums = {}, cnts = {};
      Object.keys(byNum).forEach(function(n){
        var arr = byNum[n];
        arr.sort(function(a,b){ return new Date(a.date) - new Date(b.date); });
        for(var i = 0; i < arr.length - 1; i++){
          var d1 = new Date(arr[i].date), d2 = new Date(arr[i+1].date);
          if(isNaN(d1.getTime()) || isNaN(d2.getTime())) continue;
          var days = (d2.getTime() - d1.getTime()) / 86400000;
          if(days < 0) continue;
          var st = arr[i].status;
          sums[st] = (sums[st] || 0) + days;
          cnts[st] = (cnts[st] || 0) + 1;
        }
      });
      var shown = 0;
      STATUSES.forEach(function(st){
        if(!cnts[st]) return;
        var avg = sums[st] / cnts[st];
        var chip = document.createElement('span');
        var col = ST_COLOR[st] || '#888780';
        chip.style.cssText = 'font-size:11px;font-weight:700;padding:3px 8px;border-radius:8px;background:' + col + '1f;color:' + col;
        chip.title = 'Среднее по ' + cnts[st] + ' перех.';
        chip.textContent = st + ' \u2014 ' + (avg < 1 ? '<1' : String(Math.round(avg))) + ' дн.';
        box.appendChild(chip);
        shown++;
      });
      if(!shown){
        var em = document.createElement('span');
        em.style.cssText = 'font-size:11px;color:#999';
        em.textContent = 'Журнал переходов только начал копиться \u2014 цифры появятся по мере движения заказов по этапам.';
        box.appendChild(em);
      }
    }
    paintStages();
    if(!SL_LOADED){
      fetchStatusLog(function(err){ if(!err) paintStages(); });
    }
  }

  // ── Подвкладка АНАЛИТИКА: воронка по месяцам (Момент D) ────
  // Конверсия Замер→Договор — по месяцу, когда заказ ВПЕРВЫЕ попал в
  // статус «Замер» (Журнал Статусов, копится с v4.0 — у заказов старше
  // этой версии данных не будет, это ожидаемо). Средний чек и срок
  // Договор→Установка — по месяцу подписания договора (dogDate), как и
  // остальные денежные метрики в «Продажи».
  function renderSubAnalytics(view){
    if(!LOADED){
      var ld0 = document.createElement('div'); ld0.className='crm-empty';
      ld0.textContent = 'Загружаю заказы...';
      view.appendChild(ld0);
      return;
    }
    var t0 = document.createElement('div'); t0.className='crm-sec-t';
    t0.textContent = '\uD83D\uDCCA Воронка по месяцам';
    view.appendChild(t0);
    var hint = document.createElement('div'); hint.className='crm-fin-note';
    hint.textContent = 'Конверсия \u2014 по месяцу первого попадания в статус «Замер» (журнал копится с v4.0, у старых заказов данных не будет). Средний чек и срок Договор\u2192Установка \u2014 по месяцу подписания договора.';
    view.appendChild(hint);

    var box = document.createElement('div');
    view.appendChild(box);

    function paint(){
      box.innerHTML = '';
      if(!SL_LOADED){
        var ld = document.createElement('div'); ld.className='crm-empty';
        ld.textContent = 'Загружаю журнал статусов...';
        box.appendChild(ld);
        return;
      }
      var byNum = {};
      ORDERS.forEach(function(o){ byNum[o.num] = o; });

      // Первое попадание в «Замер» по заказу -> месяц
      var zamerMonth = {};
      var zamerSeen = {};
      SL.forEach(function(e){
        if(e.status !== '\u0417\u0430\u043c\u0435\u0440') return;
        var mk = monthKey(e.date);
        if(!mk) return;
        var t = new Date(e.date).getTime();
        if(!zamerSeen[e.num] || t < zamerSeen[e.num]){ zamerSeen[e.num] = t; zamerMonth[e.num] = mk; }
      });

      var conv = {};
      Object.keys(zamerMonth).forEach(function(num){
        var mk = zamerMonth[num];
        if(!conv[mk]) conv[mk] = { total:0, won:0 };
        conv[mk].total++;
        var o = byNum[num];
        // v4.14: выигранной считается сделка по общему правилу isDeal —
        // отказ и заказ с нулевой ценой конверсией не являются, иначе
        // конверсия и «договоров всего» рассказывают разные истории.
        if(isDatedDeal(o)) conv[mk].won++;
      });

      var sales = {}, lead = {};
      ORDERS.forEach(function(o){
        if(!isDatedDeal(o)) return;
        var mk = monthKey(o.dogDate);
        if(!mk) return;
        if(!sales[mk]) sales[mk] = { sum:0, cnt:0 };
        sales[mk].sum += Number(o.sogl) || 0;
        sales[mk].cnt++;
        if(!o.mountDate) return;
        var d1 = new Date(o.dogDate), d2 = new Date(o.mountDate);
        if(isNaN(d1.getTime()) || isNaN(d2.getTime())) return;
        var days = (d2.getTime() - d1.getTime()) / 86400000;
        if(days < 0) return;
        if(!lead[mk]) lead[mk] = { sum:0, cnt:0 };
        lead[mk].sum += days;
        lead[mk].cnt++;
      });

      var months = {};
      Object.keys(conv).forEach(function(k){ months[k] = true; });
      Object.keys(sales).forEach(function(k){ months[k] = true; });
      var mkeys = Object.keys(months).sort().reverse();

      if(!mkeys.length){
        var e0 = document.createElement('div'); e0.className='crm-empty';
        e0.textContent = 'Пока нет данных для воронки \u2014 появятся по мере движения заказов.';
        box.appendChild(e0);
        return;
      }

      var totZamer=0, totWon=0, totSalesSum=0, totSalesCnt=0, totLeadSum=0, totLeadCnt=0;
      Object.keys(conv).forEach(function(k){ totZamer += conv[k].total; totWon += conv[k].won; });
      Object.keys(sales).forEach(function(k){ totSalesSum += sales[k].sum; totSalesCnt += sales[k].cnt; });
      Object.keys(lead).forEach(function(k){ totLeadSum += lead[k].sum; totLeadCnt += lead[k].cnt; });

      var sum = document.createElement('div'); sum.className='crm-sum';
      sumTile(sum, totZamer ? Math.round(totWon/totZamer*100) + '%' : '\u2014', 'конверсия Замер\u2192Договор');
      sumTile(sum, totSalesCnt ? fm0(totSalesSum/totSalesCnt) : '\u2014', 'средний чек');
      sumTile(sum, totLeadCnt ? Math.round(totLeadSum/totLeadCnt) + ' дн.' : '\u2014', 'Ø Договор\u2192Установка');
      sumTile(sum, String(totSalesCnt), 'договоров всего');
      box.appendChild(sum);

      var tbl = document.createElement('table'); tbl.className='crm-ftbl';
      var thead = document.createElement('tr');
      ['Месяц','Замеров','Конверсия','Договоров','Средний чек','Ø дней до установки'].forEach(function(t){
        var th = document.createElement('th'); th.textContent = t; thead.appendChild(th);
      });
      tbl.appendChild(thead);
      mkeys.forEach(function(k){
        var c = conv[k], s = sales[k], l = lead[k];
        var tr = document.createElement('tr');
        function td(t, cls){ var cc = document.createElement('td'); cc.textContent = t; if(cls) cc.className = cls; tr.appendChild(cc); }
        td(monthLabel(k));
        td(c ? String(c.total) : '\u2014');
        td(c && c.total ? Math.round(c.won/c.total*100) + '%' : '\u2014');
        td(s ? String(s.cnt) : '\u2014');
        td(s && s.cnt ? fm0(s.sum/s.cnt) : '\u2014');
        td(l && l.cnt ? Math.round(l.sum/l.cnt) + ' дн.' : '\u2014');
        tbl.appendChild(tr);
      });
      box.appendChild(tbl);
    }

    paint();
    if(!SL_LOADED){ fetchStatusLog(function(err){ if(!err) paint(); }); }
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
    iM.style.cssText = 'font-size:12px;border:1px solid var(--bd);border-radius:8px;padding:7px 10px';
    var bAcc = document.createElement('button'); bAcc.className='crm-vbtn new'; bAcc.textContent='Начислить постоянные и оклады';
    bAcc.addEventListener('click', function(){
      var m = iM.value;
      if(!m){ toast('\u26A0\uFE0F Выбери месяц', '#BA7517'); return; }
      // v4.14: процент считаем на клиенте (payrollRows) и отправляем
      // готовыми строками — на сервере второй копии формулы нет.
      var rows = payrollRows(m);
      var rowsSum = 0;
      rows.forEach(function(r){ rowsSum += Number(r.sum)||0; });
      var extra = rows.length
        ? '\n\u0421\u0432\u0435\u0440\u0445 \u043e\u043a\u043b\u0430\u0434\u043e\u0432 \u0431\u0443\u0434\u0435\u0442 \u043d\u0430\u0447\u0438\u0441\u043b\u0435\u043d \u043f\u0440\u043e\u0446\u0435\u043d\u0442 \u0438 \u0434\u043e\u043f. \u0440\u0430\u0431\u043e\u0442\u044b: ' + fm0(rowsSum) + ' \u043f\u043e ' + rows.length + ' \u0447\u0435\u043b.'
        : '';
      if(!confirm('Начислить постоянные расходы и оклады за '+m+'? Проводки уйдут в кассу. Повторно тот же месяц не задвоится.' + extra)) return;
      bAcc.disabled = true; bAcc.textContent = 'Начисляю...';
      post({ action:'accrueMonth', month:m, payroll:rows }, function(res){
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
  // ── Фонд оплаты за месяц (v4.14) ────────────────────────────────
  // ЕДИНСТВЕННОЕ место, где живёт формула дробления заработка. Её зовут
  // три потребителя: экран «Зарплаты», проверка недостачи в «Кассе» и
  // начисление проводок. Раньше она существовала только внутри отрисовки
  // «Зарплат», и чтобы начислять процент на сервере, её пришлось бы
  // переписать в Code.gs второй раз — то есть завести ровно ту болезнь
  // (две копии одной формулы, которые расходятся), которую мы лечили
  // в среднем чеке. Поэтому считает клиент, а сервер только пишет строки.
  //
  // Правила: earnMaster заказа делится — основному мастеру достаётся
  // earnMaster − выплата помощнику, помощнику его фиксированная сумма.
  // Заказы без назначенного мастера идут в unassigned (деньги не теряем).
  // Дизайнеры делят общий пул earnDesigner поровну между активными.
  function payrollForMonth(mk){
    var earnMasterM = 0, earnDesignerM = 0, unassignedM = 0, dopTotalM = 0;
    var perEmp = {};
    function slot(id){ if(!perEmp[id]) perEmp[id] = { main:0, help:0, dop:0, nMain:0, nHelp:0, nDop:0 }; return perEmp[id]; }
    if(LOADED){
      ORDERS.forEach(function(o){
        if(monthKey(o.dogDate) !== mk) return;
        var em = Number(o.earnMaster)||0;
        earnMasterM += em;
        earnDesignerM += Number(o.earnDesigner)||0;
        var hp = o.helperId ? (Number(o.helperPay)||0) : 0;
        var masterPart = em - hp;
        if(o.masterId){ var sm = slot(o.masterId); sm.main += masterPart; sm.nMain++; }
        else unassignedM += masterPart;
        if(o.helperId){ var shp = slot(o.helperId); shp.help += hp; shp.nHelp++; }
      });
    }
    if(DOP_LOADED){
      DOP.forEach(function(d){
        if(monthKey(d.date) !== mk) return;
        var s = Number(d.sum)||0;
        dopTotalM += s;
        if(d.empId){ var sd = slot(d.empId); sd.dop += s; sd.nDop++; }
      });
    }
    var nDes = 0;
    if(EMP_LOADED) EMP.forEach(function(e){ if(e.active && e.role === '\u0414\u0438\u0437\u0430\u0439\u043d\u0435\u0440') nDes++; });
    return {
      perEmp: perEmp, slot: slot,
      earnMasterM: earnMasterM, earnDesignerM: earnDesignerM,
      unassignedM: unassignedM, dopTotalM: dopTotalM,
      nDesigners: nDes,
      designerShare: nDes > 0 ? Math.round(earnDesignerM / nDes) : 0,
      // Всё, что причитается людям сверх окладов — именно это кнопка
      // «Начислить» и должна проводить в кассу.
      variableTotal: earnMasterM + earnDesignerM + dopTotalM
    };
  }

  // Готовые строки начисления процента для сервера. Сервер их не
  // пересчитывает — только пишет и защищает от повторного начисления.
  function payrollRows(mk){
    var p = payrollForMonth(mk);
    var rows = [];
    if(EMP_LOADED){
      EMP.forEach(function(e){
        var pe = p.perEmp[e.id] || { main:0, help:0, dop:0 };
        var isDes = e.role === '\u0414\u0438\u0437\u0430\u0439\u043d\u0435\u0440';
        var sum = isDes
          ? ((e.active ? p.designerShare : 0) + Math.round(pe.dop))
          : Math.round(pe.main) + Math.round(pe.help) + Math.round(pe.dop);
        if(sum > 0) rows.push({ empId: String(e.id), name: e.name, role: e.role, sum: sum });
      });
    }
    // Заказы без назначенного мастера: деньги реальные, получателя нет.
    // Проводку создаём всё равно (иначе касса завышена), но помечаем явно.
    if(Math.round(p.unassignedM) > 0){
      rows.push({ empId: '__none__', name: '\u0431\u0435\u0437 \u043d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u043d\u043e\u0433\u043e \u043c\u0430\u0441\u0442\u0435\u0440\u0430', role: '\u041c\u0430\u0441\u0442\u0435\u0440', sum: Math.round(p.unassignedM) });
    }
    return rows;
  }

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
    if(!DOP_LOADED){ fetchDop(function(err){ if(!err) renderView(); }); }

    // v4.14: расчёт живёт в payrollForMonth() — здесь только отрисовка.
    var PR = payrollForMonth(FIN_MONTH);
    var earnMasterM = PR.earnMasterM, earnDesignerM = PR.earnDesignerM;
    var unassignedM = PR.unassignedM, dopTotalM = PR.dopTotalM;
    var perEmp = PR.perEmp;

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


    if(!EMP.length){
      var e = document.createElement('div'); e.className='crm-empty';
      e.textContent = 'Сотрудников пока нет. Добавь мастеров и дизайнеров с окладом.';
      view.appendChild(e);
    } else {
      var tbl = document.createElement('table'); tbl.className='crm-ftbl';
      var thead = document.createElement('tr');
      ['Имя','Роль','Оклад','Процент','Помощник','Доп','К выплате','',''].forEach(function(t){ var th=document.createElement('th'); th.textContent=t; thead.appendChild(th); });
      tbl.appendChild(thead);
      EMP.forEach(function(emp){
        var tr = document.createElement('tr');
        if(!emp.active) tr.style.opacity = '0.5';
        var pe = perEmp[emp.id] || { main:0, help:0, dop:0, nMain:0, nHelp:0, nDop:0 };
        var isDes = emp.role === 'Дизайнер';
        // Дизайнеры: процент = доля общего пула (как раньше). Мастера:
        // именной заработок как основной по своим заказам.
        // v4.14: доля дизайнера берётся из payrollForMonth() — раньше здесь
        // была вторая формула, которая при нуле активных дизайнеров делила
        // на общее их число, а не на активных.
        var pct = isDes ? (emp.active ? PR.designerShare : 0) : Math.round(pe.main);
        var helpV = isDes ? 0 : Math.round(pe.help);
        var dopV = Math.round(pe.dop);
        var payout = (Number(emp.salary)||0) + pct + helpV + dopV;
        var c1 = document.createElement('td');
        var nm = document.createElement('div'); nm.textContent = emp.name; c1.appendChild(nm);
        var subParts = [];
        if(!isDes){ if(pe.nMain) subParts.push(pe.nMain + ' осн.'); if(pe.nHelp) subParts.push(pe.nHelp + ' помощ.'); }
        if(pe.nDop) subParts.push(pe.nDop + ' доп.');
        if(subParts.length){
          var subL = document.createElement('div');
          subL.style.cssText = 'font-size:10px;color:#999;margin-top:1px';
          subL.textContent = subParts.join(' \u00B7 ');
          c1.appendChild(subL);
        }
        tr.appendChild(c1);
        var c2 = document.createElement('td'); c2.textContent = emp.role; tr.appendChild(c2);
        var c3 = document.createElement('td'); c3.textContent = fm0(emp.salary); tr.appendChild(c3);
        var c4 = document.createElement('td'); c4.textContent = pct ? fm0(pct) : '\u2014'; tr.appendChild(c4);
        var c5 = document.createElement('td'); c5.textContent = helpV ? fm0(helpV) : '\u2014'; tr.appendChild(c5);
        var c6 = document.createElement('td'); c6.textContent = dopV ? fm0(dopV) : '\u2014'; tr.appendChild(c6);
        var c7 = document.createElement('td'); c7.textContent = fm0(payout); c7.className='crm-margin'; tr.appendChild(c7);
        var c8 = document.createElement('td');
        var ed = document.createElement('button'); ed.className='crm-vbtn'; ed.style.padding='3px 8px'; ed.textContent='\u270E';
        ed.addEventListener('click', function(){ openEmpModal(emp); });
        c8.appendChild(ed); tr.appendChild(c8);
        var c9 = document.createElement('td');
        var dl = document.createElement('button'); dl.className='crm-vbtn'; dl.style.padding='3px 8px'; dl.textContent='\u2715';
        dl.addEventListener('click', function(){
          if(!confirm('Удалить сотрудника «'+emp.name+'»? Уже начисленные оклады в кассе останутся.')) return;
          post({ action:'delEmp', id:emp.id }, function(){
            EMP = EMP.filter(function(y){ return y.id !== emp.id; });
            renderAll(); toast('OK Удалено', '#1a5252');
          }, function(err){ toast('\u26A0\uFE0F Не удалилось: '+err, '#BA7517'); });
        });
        c9.appendChild(dl); tr.appendChild(c9);
        tbl.appendChild(tr);
      });
      view.appendChild(tbl);

      // Заказы месяца без назначенного основного мастера — деньги видны, но
      // ждут распределения (открой заказ → блок «Бригада»).
      if(Math.round(unassignedM) > 0){
        var un = document.createElement('div');
        un.style.cssText = 'font-size:12px;color:#BA7517;margin:8px 0 2px';
        un.textContent = '\u26A0\uFE0F Не распределено: ' + fm0(Math.round(unassignedM)) + ' \u2014 в заказах месяца не назначен основной мастер. Открой заказ и выбери бригаду.';
        view.appendChild(un);
      }

      // Итоги месяца по зарплатам
      var salT = 0;
      EMP.forEach(function(e){ if(e.active) salT += Number(e.salary)||0; });
      var sum = document.createElement('div'); sum.className='crm-sum'; sum.style.marginTop='10px';
      sumTile(sum, fm0(salT), 'окладов/мес всего');
      sumTile(sum, fm0(earnMasterM), 'заработок мастеров (мес)');
      sumTile(sum, fm0(earnDesignerM), 'заработок дизайнеров (мес)');
      sumTile(sum, fm0(dopTotalM), 'доп. работы (мес)');
      sumTile(sum, fm0(salT + earnMasterM + earnDesignerM + dopTotalM), 'фонд оплаты за месяц');
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
    var iHelp = inp(pre.helperRate || '', 'number'); iHelp.placeholder = '0';
    iHelp.title = 'Сколько этот человек получает, когда он ПОМОЩНИК в заказе. В самом заказе сумму можно поменять.';
    var selAct = document.createElement('select');
    [['да','Активен'],['нет','Уволен/пауза']].forEach(function(u){ var op=document.createElement('option'); op.value=u[0]; op.textContent=u[1]; selAct.appendChild(op); });
    selAct.value = (pre.active === false) ? 'нет' : 'да';

    b.appendChild(field('Имя', iName));
    var r1 = document.createElement('div'); r1.className='crm-2col';
    r1.appendChild(field('Роль', selRole)); r1.appendChild(field('Оклад/мес, \u20B8', iSal));
    b.appendChild(r1);
    var r1b = document.createElement('div'); r1b.className='crm-2col';
    r1b.appendChild(field('Ставка помощника, \u20B8', iHelp)); r1b.appendChild(field('Состояние', selAct));
    b.appendChild(r1b);

    var btns = document.createElement('div'); btns.className='crm-m-btns';
    var bSave = document.createElement('button'); bSave.className='crm-m-btn save'; bSave.textContent='Сохранить';
    bSave.addEventListener('click', function(){
      var name = iName.value.trim();
      if(!name){ toast('\u26A0\uFE0F Укажи имя', '#BA7517'); return; }
      var sal = Math.round(parseFloat(iSal.value)||0);
      if(sal < 0){ toast('\u26A0\uFE0F Оклад не может быть отрицательным', '#BA7517'); return; }
      bSave.disabled = true; bSave.textContent = 'Сохраняю...';
      var hr = Math.round(parseFloat(iHelp.value)||0);
      if(hr < 0){ toast('\u26A0\uFE0F Ставка помощника не может быть отрицательной', '#BA7517'); return; }
      var emp = { id: pre.id || '', name: name, role: selRole.value, salary: sal, active: selAct.value !== 'нет', helperRate: hr };
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
    sumTile(sum, '+' + fm0(plus), 'добавлено (цена вверх)');
    sumTile(sum, '\u2212' + fm0(Math.abs(minus)), 'убрано (цена вниз)', minus < 0);
    sumTile(sum, (net >= 0 ? '+' : '\u2212') + fm0(Math.abs(net)), 'итоговый сдвиг цены', net < 0);
    sumTile(sum, String(CH.length), 'всего изменений');
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
    var inc = 0, exp = 0, badCnt = 0, badSum = 0;
    FIN.forEach(function(f){
      var s = Number(f.sum)||0;
      if(f.type === 'Приход') inc += s;
      else if(f.type === 'Расход') exp += s;
      else { badCnt++; badSum += s; }
    });
    var t0 = document.createElement('div'); t0.className='crm-sec-t';
    t0.textContent = 'Касса — фактические деньги';
    view.appendChild(t0);
    var sum = document.createElement('div'); sum.className='crm-sum';
    sumTile(sum, fm0(inc), 'приход, всего');
    sumTile(sum, fm0(exp), 'расход, всего', exp > inc);
    sumTile(sum, fm0(inc - exp), 'итог (приход − расход)', inc - exp < 0);
    view.appendChild(sum);

    if(badCnt){
      var bn = document.createElement('div'); bn.className='crm-fin-note';
      bn.style.color = '#BA1B1B';
      bn.textContent = '\u26A0\uFE0F ' + badCnt + ' \u043e\u043f\u0435\u0440\u0430\u0446\u0438\u0439 \u043d\u0430 ' + fm0(badSum) + ' \u0441 \u043d\u0435\u043e\u043f\u043e\u0437\u043d\u0430\u043d\u043d\u044b\u043c \u0442\u0438\u043f\u043e\u043c (\u043d\u0435 \u00ab\u041f\u0440\u0438\u0445\u043e\u0434\u00bb \u0438 \u043d\u0435 \u00ab\u0420\u0430\u0441\u0445\u043e\u0434\u00bb) \u2014 \u0432 \u0438\u0442\u043e\u0433 \u043d\u0435 \u0432\u043e\u0448\u043b\u0438. \u041f\u043e\u0447\u0438\u043d\u0438 \u0442\u0438\u043f \u0432 \u0442\u0430\u0431\u043b\u0438\u0446\u0435 \u0438\u043b\u0438 \u0447\u0435\u0440\u0435\u0437 \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0443 \u043e\u043f\u0435\u0440\u0430\u0446\u0438\u0438.';
      view.appendChild(bn);
    }

    // v4.14: график «Приход и расход по месяцам» убран по просьбе
    // владельца — помесячная динамика и так видна в «Продажах»,
    // а в кассе важнее сами операции. Вернуть: см. историю git.

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
          // Optimistic: строка сворачивается сразу по клику, запрос — в
          // фоне. FIN/суммы/график не трогаем до ответа сервера — они
          // обновятся вместе с renderAll() при успехе. Ошибка — просто
          // снимаем класс, ничего откатывать в данных не нужно (их и не
          // меняли).
          r.classList.add('crm-op-leaving');
          post({ action:'delFin', id: f.id }, function(){
            FIN = FIN.filter(function(x){ return x.id !== f.id; });
            if(f.type==='Приход' && f.cat==='Доплата' && f.num){
              for(var i=0;i<ORDERS.length;i++){ if(String(ORDERS[i].num)===String(f.num)){ ORDERS[i].paid = Math.max(0,(Number(ORDERS[i].paid)||0) - f.sum); break; } }
            }
            renderAll();
            toast('OK Операция удалена', '#1a5252');
          }, function(err){
            r.classList.remove('crm-op-leaving');
            toast('⚠️ Не удалилось: ' + err, '#BA7517');
          });
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
    sumTile(sum, fm0(predT), 'предв. сумма в работе');
    sumTile(sum, String(funnel.length), 'заявок без договора');
    sumTile(sum, fm0(avg), 'средняя предв. цена');
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
    var withSogl = real.filter(isDeal);
    var revenue = 0, received = 0, receivedOff = 0, debtT = 0;
    withSogl.forEach(function(o){ revenue += Number(o.sogl)||0; });
    real.forEach(function(o){
      var got = (Number(o.avans)||0) + (Number(o.paid)||0);
      // Деньги по заказу без согласованной цены — реальные, но это ещё не
      // выручка по договору. Не прячем их и не мешаем с договорными.
      if(isDeal(o)) received += got; else receivedOff += got;
      var d = debtOf(o); if(d > 0) debtT += d;
    });
    // Средний чек — по сделкам, которые можно отнести к месяцу (с датой
    // договора): ровно та же выборка, что и в «Аналитике», иначе на двух
    // соседних вкладках получались разные средние чеки. Выручка при этом
    // остаётся полной (включая сделки без даты) — деньги не теряем,
    // а расхождение объясняет предупреждение ниже.
    var datedDeals = withSogl.filter(isDatedDeal);
    var datedRevenue = 0;
    datedDeals.forEach(function(o){ datedRevenue += Number(o.sogl)||0; });
    var avg = datedDeals.length ? datedRevenue / datedDeals.length : 0;
    var margT = 0, margRev = 0, margCnt = 0, corrTotal = 0, corrCnt = 0;
    var chUnknown = 0, chUnknownSum = 0;
    withSogl.forEach(function(o){
      var m = marginOf(o);
      if(m <= 0) return;
      // Маржа договора + то, что реально принесли изменения после него.
      // Без этой поправки дозаказ уходил целиком в «себестоимость».
      var a = CH_LOADED ? marginAdjOf(o.num) : { adj:0, unknown:0, unknownSum:0 };
      chUnknown += a.unknown;
      chUnknownSum += a.unknownSum;
      // v4.14: учитываем корректировку себестоимости — ровно та же формула,
      // что в карточке заказа («Маржа по факту» = маржа − отклонение,
      // costDelta = факт − план, минус значит сэкономили). Раньше «Финансы»
      // считали строго по плану, и одна и та же сделка показывала в карточке
      // и в отчёте разную маржу.
      var d = (o.costDelta === null || o.costDelta === undefined) ? null : Number(o.costDelta);
      if(d !== null && !isNaN(d) && d !== 0){ corrTotal += d; corrCnt++; }
      margT += m + a.adj - ((d !== null && !isNaN(d)) ? d : 0);
      margRev += Number(o.sogl)||0;
      margCnt += 1;
    });
    var margPct = margRev > 0 ? Math.round(margT / margRev * 100) : 0;

    var sum = document.createElement('div'); sum.className='crm-sum';
    sumTile(sum, fm0(revenue), 'выручка по договорам, всего');
    sumTile(sum, fm0(received), 'получено (авансы + доплаты)');
    sumTile(sum, fm0(debtT), 'долг клиентов', debtT>0);
    sumTile(sum, fm0(avg), 'средний чек (' + datedDeals.length + ' догов.)');
    view.appendChild(sum);

    if(receivedOff > 0){
      var offN = document.createElement('div'); offN.className='crm-fin-note';
      offN.textContent = 'Плюс ' + fm0(receivedOff) + ' получено по заказам без согласованной цены \u2014 это реальные деньги, но ещё не выручка по договору. Проставь Согл. цену, чтобы они попали в отчёт.';
      view.appendChild(offN);
    }
    // Сделки с ценой, но без даты договора: в помесячную разбивку ниже они
    // физически не попадут — предупреждаем, чтобы дату дозаполнили.
    var noDate = withSogl.filter(function(o){ return !isDatedDeal(o); });
    if(noDate.length){
      var ndSum = 0;
      noDate.forEach(function(o){ ndSum += Number(o.sogl)||0; });
      var ndN = document.createElement('div'); ndN.className='crm-fin-note';
      ndN.style.color = '#BA7517';
      ndN.textContent = '\u26A0\uFE0F ' + noDate.length + ' \u0437\u0430\u043a\u0430\u0437\u043e\u0432 \u043d\u0430 ' + fm0(ndSum) + ' \u2014 \u0431\u0435\u0437 \u0434\u0430\u0442\u044b \u0434\u043e\u0433\u043e\u0432\u043e\u0440\u0430 (\u2116 ' + noDate.map(function(o){ return o.num; }).join(', ') + '). \u0412 \u0432\u044b\u0440\u0443\u0447\u043a\u0443 \u043e\u043d\u0438 \u0432\u0445\u043e\u0434\u044f\u0442, \u043d\u043e \u0432 \u0433\u0440\u0430\u0444\u0438\u043a \u043f\u043e \u043c\u0435\u0441\u044f\u0446\u0430\u043c \u0438 \u0432 \u00ab\u0410\u043d\u0430\u043b\u0438\u0442\u0438\u043a\u0443\u00bb \u2014 \u043d\u0435\u0442. \u041f\u0440\u043e\u0441\u0442\u0430\u0432\u044c \u0414\u0430\u0442\u0443 \u0434\u043e\u0433\u043e\u0432\u043e\u0440\u0430.';
      view.appendChild(ndN);
    }

    if(margCnt){
      var sum2 = document.createElement('div'); sum2.className='crm-sum';
      sumTile(sum2, fm0(margT), 'маржа по договорам');
      sumTile(sum2, fm0(margRev - margT), 'себестоимость');
      sumTile(sum2, margPct + '%', 'рентабельность');
      sumTile(sum2, String(margCnt) + ' из ' + withSogl.length, 'догов. с маржой');
      view.appendChild(sum2);
      if(corrCnt){
        var cw = document.createElement('div'); cw.className='crm-fin-note';
        cw.style.color = corrTotal < 0 ? '#3B6D11' : '#BA7517';
        cw.textContent = (corrTotal < 0
            ? '\u0412 \u043c\u0430\u0440\u0436\u0435 \u0443\u0447\u0442\u0435\u043d\u0430 \u044d\u043a\u043e\u043d\u043e\u043c\u0438\u044f \u043d\u0430 \u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b\u0430\u0445 ' + fm0(Math.abs(corrTotal))
            : '\u0412 \u043c\u0430\u0440\u0436\u0435 \u0443\u0447\u0442\u0451\u043d \u043f\u0435\u0440\u0435\u0440\u0430\u0441\u0445\u043e\u0434 \u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b\u043e\u0432 ' + fm0(Math.abs(corrTotal)))
          + ' \u043f\u043e ' + corrCnt + ' \u0437\u0430\u043a\u0430\u0437\u0430\u043c \u2014 \u043f\u043e \u0444\u0430\u043a\u0442\u0443 \u0437\u0430\u043a\u0443\u043f\u043a\u0438, \u043a\u0430\u043a \u0432 \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0435 \u0437\u0430\u043a\u0430\u0437\u0430. \u041e\u0441\u0442\u0430\u043b\u044c\u043d\u044b\u0435 \u0437\u0430\u043a\u0430\u0437\u044b \u0441\u0447\u0438\u0442\u0430\u044e\u0442\u0441\u044f \u043f\u043e \u043f\u043b\u0430\u043d\u0443.';
        view.appendChild(cw);
      }
      if(margCnt < withSogl.length){
        var mn = document.createElement('div'); mn.className='crm-fin-note';
        mn.textContent = 'Маржа считается по ' + margCnt + ' договорам из ' + withSogl.length + ' — у остальных расчёт был сохранён до появления учёта маржи. Пересохрани расчёт заказа, чтобы маржа появилась.';
        view.appendChild(mn);
      }
      if(!CH_LOADED){
        var ln = document.createElement('div'); ln.className='crm-fin-note';
        ln.textContent = 'Изменения к договорам ещё грузятся — маржа показана без поправки на них. Цифра обновится сама.';
        view.appendChild(ln);
      }
      if(chUnknown){
        var cn = document.createElement('div'); cn.className='crm-fin-note';
        cn.style.color = '#BA7517';
        cn.textContent = '\u26A0\uFE0F ' + chUnknown + ' изменений к договорам на ' + fm0(chUnknownSum) + ' — без себестоимости, поэтому в марже они не учтены. Цифра занижена (при дозаказах) на неизвестную величину. Заполняй «Себестоимость» при добавлении изменения, чтобы маржа была точной.';
        view.appendChild(cn);
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
    var strip = document.createElement('div');
    strip.className = 'crm-card-strip';
    strip.style.background = ST_COLOR[o.status] || '#ccc';
    d.appendChild(strip);
    var b = document.createElement('div'); b.className = 'crm-card-b';
    var sum = document.createElement('div'); sum.className = 'sum';
    var st = staleDays(o);
    if(st !== null && st >= STALE_DAYS){
      var sd = document.createElement('span');
      sd.className = 'crm-stale';
      sd.title = 'Заказ не двигали ' + st + ' дн. — статус, цена и расчёт не менялись';
      sum.appendChild(sd);
    }
    sum.appendChild(document.createTextNode(fm0(o.sogl || o.pred)));
    b.appendChild(sum);
    var l2 = document.createElement('div'); l2.className='l2';
    l2.textContent = (o.client||'') + (o.city ? ' \u00B7 ' + o.city : '');
    b.appendChild(l2);
    var l2b = document.createElement('div'); l2b.className='l2';
    l2b.style.color = '#999';
    l2b.textContent = '\u2116' + o.num + (o.furn ? ' \u00B7 ' + o.furn : '');
    b.appendChild(l2b);
    var debt = debtOf(o);
    if(debt !== 0){
      var dEl = document.createElement('div');
      dEl.className = debt > 0 ? 'crm-debt' : 'crm-overpaid';
      dEl.style.cssText = 'font-size:11px;margin-top:4px';
      dEl.textContent = debt > 0 ? ('долг ' + fm0(debt)) : ('переплата ' + fm0(-debt));
      b.appendChild(dEl);
    }
    var days = daysInWork(o);
    var m = masterOf(o);
    if(m || days !== null){
      var l3 = document.createElement('div'); l3.className='l3';
      if(m){
        var av = document.createElement('span'); av.className='crm-ava';
        av.textContent = initialsOf(m.name);
        av.title = 'Мастер: ' + m.name;
        l3.appendChild(av);
      }
      if(days !== null){
        var dayEl = document.createElement('span'); dayEl.className='crm-daysb';
        dayEl.textContent = days + ' дн.';
        l3.appendChild(dayEl);
      }
      b.appendChild(l3);
    }
    d.appendChild(b);
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
      b.appendChild(nb);
    }
    d.addEventListener('click', function(){ openCard(o.num); });
    return d;
  }

  function renderBoard(view, vis){
    var tabs = document.createElement('div');
    tabs.className = 'crm-board-tabs';
    [['sale','Продажа'],['prod','Производство'],['archive','Отказ/Отложено'],['rec','Рекламации']].forEach(function(t){
      var b = document.createElement('button');
      b.className = 'crm-board-tab' + (BOARD_TAB===t[0] ? ' on' : '');
      b.textContent = t[1];
      b.addEventListener('click', function(){
        if(BOARD_TAB===t[0]) return;
        BOARD_TAB = t[0]; localStorage.setItem('moff_crm_board_tab', t[0]); renderAll();
      });
      tabs.appendChild(b);
    });
    if(BOARD_TAB !== 'rec'){
      var staleCnt = vis.filter(function(o){
        var s = staleDays(o);
        return s !== null && s >= STALE_DAYS && (BOARD_GROUPS[BOARD_TAB] || []).indexOf(o.status) >= 0;
      }).length;
      var bStale = document.createElement('button');
      bStale.className = 'crm-board-tab' + (STALE_ONLY ? ' on' : '');
      bStale.style.marginLeft = 'auto';
      bStale.title = 'Показать только заказы, которые не двигали ' + STALE_DAYS + '+ дней';
      bStale.textContent = '\u25CF Зависшие' + (staleCnt ? ' ' + staleCnt : '');
      bStale.addEventListener('click', function(){ STALE_ONLY = !STALE_ONLY; renderAll(); });
      tabs.appendChild(bStale);
    }
    view.appendChild(tabs);
    if(BOARD_TAB === 'rec'){ renderReclBoard(view); return; }
    // Аватар мастера на карточке. EMP грузим фоном и один раз за сессию:
    // доску не блокируем, до прихода списка аватаров просто нет.
    if(!EMP_LOADED){
      fetchEmp(function(err){ if(!err && VIEW === 'board') renderAll(); });
    }
    var board = document.createElement('div');
    board.className = 'crm-board';
    var stagesForTab = BOARD_GROUPS[BOARD_TAB] || BOARD_GROUPS.sale;
    stagesForTab.forEach(function(st){
      var inCol = vis.filter(function(o){
        if(o.status !== st) return false;
        if(STALE_ONLY){
          var s = staleDays(o);
          if(s === null || s < STALE_DAYS) return false;
        }
        return true;
      });
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
      var cardsWrap = document.createElement('div');
      cardsWrap.className = 'crm-col-cards';
      inCol.sort(function(a,b){ return String(b.num).localeCompare(String(a.num),'ru',{numeric:true}); });
      inCol.forEach(function(o){ cardsWrap.appendChild(makeCard(o)); });
      col.appendChild(cardsWrap);
      board.appendChild(col);
    });
    view.appendChild(board);
  }

  // Доска рекламаций: карточки — это РЕКЛАМАЦИИ, а не заказы (в отличие
  // от остальных вкладок). Фильтры поиска/города/месяца применяются к
  // заказу-владельцу, чтобы вкладка вела себя предсказуемо.
  function renderReclBoard(view){
    if(!RECL_LOADED){
      var ld = document.createElement('div');
      ld.className = 'crm-empty';
      ld.textContent = 'Загружаю рекламации...';
      view.appendChild(ld);
      fetchRecl(function(err){
        if(err && err !== '__no_key__') toast('\u26A0\uFE0F Рекламации не загрузились: ' + err, '#BA7517');
        else if(!err) renderAll();
      });
      return;
    }
    var visNums = {};
    ORDERS.forEach(function(o){
      if(!matches(o)) return;
      if(CITY_FILTER!=='all' && String(o.city||'').trim()!==CITY_FILTER) return;
      if(!monthOk(o)) return;
      visNums[String(o.num)] = true;
    });
    var rows = RECL.filter(function(rc){ return visNums[String(rc.num)]; });
    var board = document.createElement('div');
    board.className = 'crm-board';
    RECL_STAGES.forEach(function(stg){
      var inCol = rows.filter(function(rc){ return rc.stage === stg; });
      var col = document.createElement('div'); col.className='crm-col';
      col.addEventListener('dragover', function(e){ e.preventDefault(); e.dataTransfer.dropEffect='move'; col.classList.add('drag'); });
      col.addEventListener('dragleave', function(){ col.classList.remove('drag'); });
      col.addEventListener('drop', function(e){
        e.preventDefault();
        col.classList.remove('drag');
        var id = e.dataTransfer.getData('text/plain');
        var rc = null;
        for(var i=0;i<RECL.length;i++){ if(String(RECL[i].id)===String(id)){ rc=RECL[i]; break; } }
        if(!rc || rc.stage === stg) return;
        var from = rc.stage;
        rc.stage = stg; renderAll();
        post({ action:'updRecl', recl:{ id:String(id), stage:stg } }, function(){
          toast('OK Рекламация \u2116'+rc.num+': '+from+' \u2192 '+stg, '#1a5252');
        }, function(err){
          rc.stage = from; renderAll();
          toast('\u26A0\uFE0F Стадия не записалась, вернул обратно: '+err, '#BA7517');
        });
      });
      var h = document.createElement('div'); h.className='crm-col-h';
      var dot = document.createElement('span'); dot.className='dot'; dot.style.background = RECL_COLOR[stg];
      var nm = document.createElement('span'); nm.textContent = stg;
      var c = document.createElement('span'); c.className='cnt'; c.textContent = inCol.length;
      h.appendChild(dot); h.appendChild(nm); h.appendChild(c);
      col.appendChild(h);
      var cardsWrap = document.createElement('div');
      cardsWrap.className = 'crm-col-cards';
      inCol.sort(function(a,b){ return new Date(b.date||0).getTime() - new Date(a.date||0).getTime(); });
      inCol.forEach(function(rc){ cardsWrap.appendChild(makeReclCard(rc)); });
      col.appendChild(cardsWrap);
      board.appendChild(col);
    });
    view.appendChild(board);
    if(!rows.length){
      var em = document.createElement('div');
      em.className = 'crm-empty';
      em.textContent = RECL.length ? 'Под текущие фильтры рекламаций нет.' : 'Рекламаций нет. Добавить можно в карточке заказа, в блоке «Рекламации».';
      view.appendChild(em);
    }
  }

  function makeReclCard(rc){
    var o = orderByNum(rc.num);
    var d = document.createElement('div');
    d.className = 'crm-card';
    d.draggable = true;
    d.addEventListener('dragstart', function(e){ e.dataTransfer.setData('text/plain', String(rc.id)); e.dataTransfer.effectAllowed='move'; });
    var strip = document.createElement('div');
    strip.className = 'crm-card-strip';
    strip.style.background = RECL_COLOR[rc.stage] || '#ccc';
    d.appendChild(strip);
    var b = document.createElement('div'); b.className = 'crm-card-b';
    var l1 = document.createElement('div'); l1.className='l1';
    var n = document.createElement('span'); n.textContent = '\u2116'+rc.num;
    var dt = document.createElement('span'); dt.style.cssText='font-weight:400;color:#999'; dt.textContent = fmtDate(rc.date);
    l1.appendChild(n); l1.appendChild(dt);
    var l2 = document.createElement('div'); l2.className='l2';
    l2.textContent = o ? ((o.client||'') + (o.city ? ' \u00B7 '+o.city : '')) : 'заказ не найден';
    var l3 = document.createElement('div'); l3.className='l2';
    l3.style.cssText = 'color:#333;white-space:normal';
    l3.textContent = rc.desc;
    b.appendChild(l1); b.appendChild(l2); b.appendChild(l3);
    var si = RECL_STAGES.indexOf(rc.stage);
    if(si >= 0 && si < RECL_STAGES.length - 1){
      var nx = RECL_STAGES[si+1];
      var nb = document.createElement('button');
      nb.className = 'crm-next';
      nb.textContent = '\u2192 ' + nx;
      nb.addEventListener('click', function(e){
        e.stopPropagation();
        nb.disabled = true; nb.textContent = '...';
        post({ action:'updRecl', recl:{ id:String(rc.id), stage:nx } }, function(){
          rc.stage = nx;
          renderAll();
          toast('OK Рекламация \u2116'+rc.num+' \u2192 '+nx, '#1a5252');
        }, function(err){
          nb.disabled = false; nb.textContent = '\u2192 ' + nx;
          toast('\u26A0\uFE0F Стадия не записалась: '+err, '#BA7517');
        });
      });
      b.appendChild(nb);
    }
    d.appendChild(b);
    d.addEventListener('click', function(){ openCard(rc.num); });
    return d;
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
  function secIcon(name){
    var ic = document.createElement('i');
    ic.className = 'ti ' + name;
    ic.setAttribute('aria-hidden', 'true');
    return ic;
  }
  function secHead(icon, txt){
    var d = document.createElement('div'); d.className='crm-sec-h';
    d.appendChild(secIcon(icon));
    d.appendChild(document.createTextNode(txt));
    return d;
  }
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
    var opId = 'op' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
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

    var pendN = qLoad().length;
    if(pendN){
      var pWarn = document.createElement('div');
      pWarn.className = 'crm-fin-note';
      pWarn.style.cssText = 'background:#FAEEDA;color:#854F0B;border-radius:8px;padding:8px 10px;margin-top:8px';
      pWarn.textContent = '\u23F3 Ждут отправки: ' + pendN + ' операц. Они уйдут сами — не вводи их повторно';
      b.appendChild(pWarn);
    }

    var btns = document.createElement('div'); btns.className='crm-m-btns';
    var bSave = document.createElement('button'); bSave.className='crm-m-btn save'; bSave.textContent='Записать';
    bSave.addEventListener('click', function(){
      var sum = parseFloat(iSum.value) || 0;
      if(sum <= 0){ toast('\u26A0\uFE0F Введи сумму', '#BA7517'); return; }
      var fin = {
        type: selType.value, cat: selCat.value, sum: sum,
        date: iDate.value, num: iNum.value.trim(), comment: iCmt.value.trim(),
        opId: opId
      };
      var same = qLoad().filter(function(x){
        return x.type === fin.type && x.cat === fin.cat &&
          Number(x.sum) === Number(fin.sum) && String(x.num || '') === String(fin.num || '');
      });
      if(same.length && !confirm('Похожая операция (' + fin.type + ' ' + fm0(fin.sum) + ') уже ждёт отправки в очереди. Всё равно записать новую?')){
        return;
      }
      // Optimistic: модалка закрывается и запись сразу попадает в список,
      // запрос — в фоне. Офлайн — тихий откат в очередь (строка не видна,
      // ровно как раньше, "не вводи повторно"). Отказ сервера — откат с
      // явной ошибкой; заново открывать модалку с введёнными данными не
      // пытаемся — редкий путь, цена ниже, чем постоянно блокировать
      // кнопку в обычном (сетевом) случае.
      document.body.removeChild(bg);
      var rec = { id: 'tmp' + Date.now(), date: fin.date, type: fin.type, cat: fin.cat, sum: fin.sum, num: fin.num, comment: fin.comment };
      FIN.unshift(rec);
      if(fin.type==='Приход' && fin.cat==='Доплата' && fin.num){
        for(var i=0;i<ORDERS.length;i++){ if(String(ORDERS[i].num)===String(fin.num)){ ORDERS[i].paid = (Number(ORDERS[i].paid)||0) + fin.sum; break; } }
      }
      renderAll();
      toast('OK ' + fin.type + ' ' + fm0(fin.sum) + ' записан', '#1a5252');

      function rollbackAdd(){
        FIN = FIN.filter(function(x){ return x.id !== rec.id; });
        if(fin.type==='Приход' && fin.cat==='Доплата' && fin.num){
          for(var i=0;i<ORDERS.length;i++){ if(String(ORDERS[i].num)===String(fin.num)){ ORDERS[i].paid = Math.max(0,(Number(ORDERS[i].paid)||0) - fin.sum); break; } }
        }
        renderAll();
      }

      post({ action:'addFin', fin: fin }, function(res){
        if(res && res.dup){
          rollbackAdd();
          toast('Эта операция уже записана раньше — дубль не создан', '#1a5252');
          return;
        }
        if(res && res.id) rec.id = res.id;
      }, function(err, isNet){
        rollbackAdd();
        if(isNet){
          qAdd(fin);
          toast('\u23F3 Нет связи — операция в очереди, уйдёт сама. Повторно не вводи', '#854F0B');
          return;
        }
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
    var iCost = inp('', 'number'); iCost.placeholder = 'если знаешь';
    var today = new Date();
    var iDate = inp(today.getFullYear()+'-'+('0'+(today.getMonth()+1)).slice(-2)+'-'+('0'+today.getDate()).slice(-2), 'date');
    var iDesc = inp(''); iDesc.placeholder = 'Что добавили или убрали';

    var r1 = document.createElement('div'); r1.className='crm-2col';
    r1.appendChild(field('Тип', selDir)); r1.appendChild(field('Сумма, \u20B8', iSum));
    b.appendChild(r1);
    b.appendChild(field('Себестоимость, \u20B8', iCost));
    var cnote = document.createElement('div'); cnote.className='crm-fin-note';
    cnote.style.marginTop = '0';
    cnote.textContent = 'Во сколько это обошлось тебе (материал + работа). Можно не заполнять \u2014 тогда отчёт маржи по этому изменению честно предупредит, что данных нет. Знак ставится сам по типу.';
    b.appendChild(cnote);
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
      var costRaw = String(iCost.value).trim();
      var signedCost = '';
      if(costRaw !== ''){
        var c = Math.round(parseFloat(costRaw) || 0);
        if(c < 0){ toast('\u26A0\uFE0F Себестоимость вводится положительной — знак поставится сам', '#BA7517'); return; }
        if(c > sum){ toast('\u26A0\uFE0F Себестоимость больше суммы изменения — проверь цифры', '#BA7517'); return; }
        signedCost = selDir.value === 'minus' ? -c : c;
      }
      bSave.disabled = true; bSave.textContent = 'Записываю...';
      post({ action:'addChange', change:{ num:String(o.num), desc:desc, sum:signed, cost:signedCost, date:iDate.value } }, function(res){
        CH.push({ id:(res && res.id) || String(Date.now()), num:String(o.num), date:iDate.value, desc:desc, sum:signed, cost:signedCost });
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
    var repHint = document.createElement('div');
    repHint.style.cssText = 'display:none;font-size:11px;color:#1a5252;margin:2px 0 6px';
    b.appendChild(repHint);
    iPhone.addEventListener('input', function(){
      var found = ordersByPhone(iPhone.value);
      if(!found.length){ repHint.style.display = 'none'; repHint.textContent = ''; return; }
      var nums = found.slice(0, 5).map(function(oo){ return '\u2116' + oo.num; }).join(', ');
      repHint.textContent = '\u2B50 Этот телефон уже есть в заказах: ' + nums + (found.length > 5 ? '\u2026' : '') + ' \u2014 повторный клиент!';
      repHint.style.display = 'block';
      if(found[0] && found[0].client && !iClient.value.trim()) iClient.value = found[0].client;
    });
    var r2 = document.createElement('div'); r2.className='crm-2col';
    r2.appendChild(field('Город', iCity)); r2.appendChild(field('Тип мебели', iFurn));
    b.appendChild(r2);
    var selSource = document.createElement('select');
    var srcOpt0 = document.createElement('option'); srcOpt0.value = ''; srcOpt0.textContent = '\u2014 не указан \u2014';
    selSource.appendChild(srcOpt0);
    LEAD_SOURCES.forEach(function(src){ var op = document.createElement('option'); op.value = src; op.textContent = src; selSource.appendChild(op); });
    b.appendChild(field('Источник', selSource));
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
        note: iNote.value.trim(),
        source: selSource.value
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
          city: order.city, furn: order.furn, obj: order.obj, note: order.note, source: order.source,
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
    var strip0 = document.createElement('div'); strip0.className='crm-modal-strip';
    strip0.style.background = ST_COLOR[o.status] || '#ccc';
    m.appendChild(strip0);
    var h = document.createElement('div'); h.className='crm-m-h';
    var hava = document.createElement('div'); hava.className='crm-hava';
    hava.textContent = initialsOf(o.client) || ('\u2116' + o.num);
    var hcol = document.createElement('div'); hcol.style.minWidth='0';
    var title = document.createElement('div'); title.className='crm-h-t';
    title.textContent = (o.client ? o.client + ' \u00B7 ' : '') + '\u2116' + o.num;
    var hsub = document.createElement('div'); hsub.className='crm-h-s';
    hsub.textContent = (o.city||'') + (o.furn ? ((o.city?' \u00B7 ':'')) + o.furn : '');
    hcol.appendChild(title); hcol.appendChild(hsub);
    var x = document.createElement('button'); x.className='crm-m-x'; x.textContent='\u00D7';
    x.addEventListener('click', function(){ document.body.removeChild(bg); });
    h.appendChild(hava); h.appendChild(hcol); h.appendChild(x);
    var b = document.createElement('div'); b.className='crm-m-b';

    var selSt = document.createElement('select');
    STATUSES.forEach(function(s){ var op=document.createElement('option'); op.value=s; op.textContent=s; selSt.appendChild(op); });
    if(STATUSES.indexOf(o.status)>=0) selSt.value=o.status;
    var iClient = inp(o.client), iPhone = inp(o.phone), iCity = inp(o.city);
    var iFurn = inp(o.furn), iObj = inp(o.obj);
    var iSource = document.createElement('select');
    var srcOpt0c = document.createElement('option'); srcOpt0c.value = ''; srcOpt0c.textContent = '\u2014 не указан \u2014';
    iSource.appendChild(srcOpt0c);
    LEAD_SOURCES.forEach(function(src){ var op = document.createElement('option'); op.value = src; op.textContent = src; iSource.appendChild(op); });
    iSource.value = o.source || '';
    var iNote = document.createElement('textarea'); iNote.rows=2; iNote.value=o.note||'';
    var iMount = inp(o.mountDate ? String(new Date(o.mountDate).getFullYear())+'-'+('0'+(new Date(o.mountDate).getMonth()+1)).slice(-2)+'-'+('0'+new Date(o.mountDate).getDate()).slice(-2) : '', 'date');
    var payWrap = document.createElement('div');
    payWrap.style.cssText = 'display:flex;gap:6px;align-items:center';
    var iPaid = inp(o.paid || 0, 'number');
    iPaid.readOnly = true;
    iPaid.style.cssText = 'flex:1;background:var(--bg);color:#777';
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
    var slWrap = document.createElement('div');
    function renderSlog(){
      slWrap.innerHTML = '';
      if(!SL_LOADED) return;
      var items = slogOf(o.num);
      if(!items.length) return;
      var parts = [];
      for(var si = 0; si < items.length; si++){
        parts.push(items[si].status + ' ' + fmtDate(items[si].date));
      }
      var lastD = new Date(items[items.length - 1].date);
      var inDays = isNaN(lastD.getTime()) ? null : Math.floor((Date.now() - lastD.getTime()) / 86400000);
      var line = document.createElement('div');
      line.style.cssText = 'font-size:11px;color:#999;margin:2px 0 6px;line-height:1.6';
      line.textContent = '\u23F1 ' + parts.join(' \u2192 ') + (inDays !== null && inDays > 0 ? ' \u00B7 на этапе ' + inDays + ' дн.' : '');
      slWrap.appendChild(line);
    }
    renderSlog();
    if(!SL_LOADED){
      fetchStatusLog(function(err){ if(!err) renderSlog(); });
    }
    b.appendChild(slWrap);
    var r1 = document.createElement('div'); r1.className='crm-2col';
    r1.appendChild(field('Клиент', iClient));
    var phoneWrap = document.createElement('div');
    phoneWrap.style.display='flex'; phoneWrap.style.gap='6px'; phoneWrap.style.alignItems='center';
    iPhone.style.flex='1';
    phoneWrap.appendChild(iPhone);
    var telBtn = document.createElement('a');
    telBtn.textContent = '\uD83D\uDCDE';
    telBtn.style.cssText = 'text-decoration:none;font-size:16px;border:1px solid var(--bd);border-radius:8px;padding:5px 8px';
    telBtn.href = o.phone ? 'tel:' + String(o.phone).replace(/[^+\d]/g,'') : '#';
    if(!o.phone) telBtn.style.opacity = '.35';
    phoneWrap.appendChild(telBtn);
    var waBtn = document.createElement('a');
    waBtn.textContent = '\uD83D\uDCAC';
    waBtn.title = 'Написать в WhatsApp \u2014 текст под статус уже подставлен, поправь и отправь';
    waBtn.style.cssText = 'text-decoration:none;font-size:16px;border:1px solid var(--bd);border-radius:8px;padding:5px 8px';
    var waP = waPhone(o.phone);
    if(waP){
      waBtn.href = 'https://wa.me/' + waP + '?text=' + encodeURIComponent(waText(o));
      waBtn.target = '_blank';
      waBtn.rel = 'noopener';
    } else {
      waBtn.href = '#';
      waBtn.style.opacity = '.35';
      waBtn.addEventListener('click', function(e){ e.preventDefault(); });
    }
    phoneWrap.appendChild(waBtn);
    r1.appendChild(field('Телефон', phoneWrap));
    var secCli = document.createElement('div'); secCli.className='crm-sec';
    secCli.appendChild(secHead('ti-user', 'Клиент'));
    secCli.appendChild(r1);
    b.appendChild(secCli);
    var sameCli = ordersByPhone(o.phone, o.num);
    if(sameCli.length){
      var rep = document.createElement('div');
      rep.style.cssText = 'font-size:11px;color:#1a5252;margin:2px 0 6px';
      var repT = document.createElement('span');
      repT.textContent = '\u2B50 Повторный клиент \u2014 другие заказы: ';
      rep.appendChild(repT);
      sameCli.slice(0, 6).forEach(function(oo){
        var lnk = document.createElement('a');
        lnk.href = '#';
        lnk.textContent = '\u2116' + oo.num + ' (' + (oo.status || '') + ')';
        lnk.style.cssText = 'color:#1a5252;font-weight:700;margin-right:8px';
        lnk.addEventListener('click', function(e){
          e.preventDefault();
          document.body.removeChild(bg);
          openCard(oo.num);
        });
        rep.appendChild(lnk);
      });
      if(sameCli.length > 6){
        var repMore = document.createElement('span');
        repMore.style.color = '#999';
        repMore.textContent = '\u2026и ещё ' + (sameCli.length - 6);
        rep.appendChild(repMore);
      }
      secCli.appendChild(rep);
    }
    var secObj = document.createElement('div'); secObj.className='crm-sec';
    secObj.appendChild(secHead('ti-map-pin', 'Объект'));
    var r2 = document.createElement('div'); r2.className='crm-2col';
    r2.appendChild(field('Город', iCity)); r2.appendChild(field('Тип мебели', iFurn));
    secObj.appendChild(r2);
    secObj.appendChild(field('Адрес / объект', iObj));
    secObj.appendChild(field('Примечание', iNote));
    var r3 = document.createElement('div'); r3.className='crm-2col';
    r3.appendChild(field('Дата установки', iMount)); r3.appendChild(field('Источник', iSource));
    secObj.appendChild(r3);
    b.appendChild(secObj);

    // ── v4.11: Задачи по этой сделке — компактный блок, отмеченные
    // остаются видны зачёркнутыми (история по сделке, в отличие от
    // сквозной вкладки «Задачи», где готовое сворачивается сразу). ──
    var secTasks = document.createElement('div'); secTasks.className='crm-sec';
    secTasks.appendChild(secHead('ti-clock', 'Задачи'));
    var taskListWrap = document.createElement('div');
    secTasks.appendChild(taskListWrap);
    var taskAddRow = document.createElement('div');
    taskAddRow.style.cssText = 'display:flex;gap:6px;margin-top:6px';
    var cText = inp(''); cText.placeholder = 'Что сделать\u2026'; cText.style.flex = '1';
    var cDeadline = inp('', 'date'); cDeadline.style.width = '140px';
    var cSave = document.createElement('button'); cSave.className='crm-vbtn new'; cSave.textContent='+';
    function renderCardTasks(){
      taskListWrap.innerHTML = '';
      if(!TASKS_LOADED){
        var ldT = document.createElement('div'); ldT.style.cssText='font-size:11px;color:#999'; ldT.textContent = 'Загружаю задачи...';
        taskListWrap.appendChild(ldT);
        return;
      }
      var mine = TASKS.filter(function(t){ return String(t.num) === String(o.num); }).sort(function(ta, tb){
        var da = ta.deadline ? new Date(ta.deadline).getTime() : Infinity;
        var db = tb.deadline ? new Date(tb.deadline).getTime() : Infinity;
        return da - db;
      });
      if(!mine.length){
        var eT = document.createElement('div'); eT.style.cssText='font-size:11px;color:#999'; eT.textContent = 'Задач по этой сделке пока нет.';
        taskListWrap.appendChild(eT);
        return;
      }
      mine.forEach(function(t){ taskListWrap.appendChild(taskRowEl(t, true)); });
    }
    cSave.addEventListener('click', function(){
      var text = cText.value.trim();
      var deadline = cDeadline.value;
      if(!text){ toast('\u26A0\uFE0F Опиши задачу', '#BA7517'); return; }
      if(!deadline){ toast('\u26A0\uFE0F Укажи дедлайн', '#BA7517'); return; }
      var rec = { id: 'tmp' + Date.now(), num: String(o.num), text: text, deadline: deadline, done: false };
      TASKS.unshift(rec);
      cText.value = ''; cDeadline.value = '';
      renderCardTasks();
      post({ action:'addTask', task: { num: String(o.num), text: text, deadline: deadline } }, function(res){
        if(res && res.id) rec.id = res.id;
      }, function(err){
        TASKS = TASKS.filter(function(x){ return x.id !== rec.id; });
        renderCardTasks();
        toast('\u26A0\uFE0F Не сохранилось: ' + err, '#BA7517');
      });
    });
    taskAddRow.appendChild(cText); taskAddRow.appendChild(cDeadline); taskAddRow.appendChild(cSave);
    secTasks.appendChild(taskAddRow);
    renderCardTasks();
    if(!TASKS_LOADED) fetchTasks(function(err){ if(!err) renderCardTasks(); });
    b.appendChild(secTasks);

    var payFld = field('Оплачено дополнительно, \u20B8', payWrap);

    var moneyWrap = document.createElement('div'); moneyWrap.className='crm-sec';
    function renderMoney(){
      moneyWrap.innerHTML = '';
      var hasContract = (Number(o.sogl)||0) > 0;
      var mat = materialOf(o);

      // ── Верхняя карточка: цена + ярлык материала (инлайн-стили — своего
      // styles.css класса под это нет, чтобы не зависеть от файла, который
      // сюда не прикладывается) ─────────────────────────────────────────
      var top = document.createElement('div');
      top.style.cssText = 'margin-bottom:8px';
      var topHead = document.createElement('div');
      topHead.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px';
      var topLbl = document.createElement('span'); topLbl.style.cssText='font-size:12px;color:#888';
      topLbl.textContent = hasContract ? 'Итоговая по договору' : 'Предв. цена';
      var matBadge = document.createElement('span');
      matBadge.style.cssText = 'font-size:11px;font-weight:700;color:#854F0B;background:#FAEEDA;border-radius:20px;padding:2px 10px';
      matBadge.textContent = materialLabel(mat);
      topHead.appendChild(topLbl); topHead.appendChild(matBadge);
      top.appendChild(topHead);
      var chs = CH_LOADED ? changesOf(o.num) : [];
      var chSum = 0;
      chs.forEach(function(c){ chSum += Number(c.sum)||0; });
      var topPrice = document.createElement('div');
      topPrice.style.cssText = 'font-size:24px;font-weight:700;color:#232323;margin-top:2px';
      topPrice.textContent = hasContract ? fm0(o.sogl) : fm0(materialTotal(o, mat));
      top.appendChild(topPrice);
      if(chs.length){
        var chLine = document.createElement('div'); chLine.style.cssText='font-size:11px;color:#999;margin-top:2px';
        chLine.textContent = 'Цена по договору ' + fm0((Number(o.sogl)||0) - chSum) + ', изменения (' + chs.length + ') ' + (chSum>=0?'+':'\u2212') + fm0(Math.abs(chSum));
        top.appendChild(chLine);
      }
      moneyWrap.appendChild(top);

      // ── Аванс / Долг ───────────────────────────────────────
      var payGrid = document.createElement('div');
      payGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px';
      function payTile(k, v, warn){
        var t = document.createElement('div');
        t.style.cssText = 'border-radius:8px;padding:6px 10px;background:' + (warn ? '#FAEEDA' : '#fff');
        var kk = document.createElement('div'); kk.style.cssText = 'font-size:11px;color:' + (warn ? '#854F0B' : '#888');
        kk.textContent = k;
        var vv = document.createElement('div'); vv.style.cssText = 'font-size:15px;font-weight:700;color:' + (warn ? '#854F0B' : '#232323');
        vv.textContent = v;
        t.appendChild(kk); t.appendChild(vv); payGrid.appendChild(t);
      }
      payTile('Аванс', o.avans ? fm0(o.avans) : '\u2014');
      var debt = debtOf(o);
      if(debt < 0) payTile('Переплата', fm0(-debt), false);
      else payTile('Долг', fm0(debt), debt > 0);
      moneyWrap.appendChild(payGrid);
      moneyWrap.appendChild(payFld);

      // ── Варианты материала: до договора кликабельны, после — только показ ──
      var matWrap = document.createElement('div'); matWrap.style.cssText = 'margin-bottom:8px';
      var matHint = document.createElement('div'); matHint.style.cssText = 'font-size:11px;color:#888;margin-bottom:6px';
      matHint.textContent = 'Варианты материала';
      matWrap.appendChild(matHint);
      ['L','P','K'].forEach(function(m){
        var t = materialTotal(o, m);
        if(!(t > 0)) return;
        var row = document.createElement('div');
        var isSel = m === mat;
        var rowBorder = isSel ? 'border:1.5px solid #1a5252' : 'border:1px solid #e5e5e0';
        row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;border-radius:8px;padding:7px 10px;margin-bottom:4px;background:#fff;' + rowBorder;
        if(!hasContract){ row.style.cursor = 'pointer'; }
        var lbl = document.createElement('span');
        lbl.style.cssText = 'font-size:13px;' + (isSel ? 'font-weight:700;color:#1a5252' : 'color:' + (hasContract ? '#999' : '#555'));
        lbl.textContent = (isSel ? '\u2713 ' : '') + materialLabel(m);
        if(materialIsBareCarcass(o, m)) lbl.textContent += ' \u00B7 только корпус';
        var val = document.createElement('span');
        val.style.cssText = 'font-size:13px;' + (isSel ? 'font-weight:700;color:#232323' : 'color:#999');
        val.textContent = fm0(t);
        row.appendChild(lbl); row.appendChild(val);
        if(!hasContract){
          row.addEventListener('click', function(){
            if(m === o.material) return;
            var prevMaterial = o.material;
            o.material = m;
            renderMoney();
            post({ action:'updateOrder', order:{ num:String(o.num), material:m } }, function(){
              toast('OK Материал: ' + materialLabel(m), '#1a5252');
            }, function(err){
              o.material = prevMaterial;
              renderMoney();
              toast('\u26A0\uFE0F Не сохранилось: '+err, '#BA7517');
            });
          });
        }
        matWrap.appendChild(row);
      });
      moneyWrap.appendChild(matWrap);

      // ── Для тебя: себестоимость / маржа / рентабельность ────
      var marg = hasContract ? marginOf(o) : materialMargin(o, mat);
      var priceForCost = hasContract ? (Number(o.sogl)||0) : materialTotal(o, mat);
      if(marg > 0 && priceForCost > 0){
        var costWrap = document.createElement('div');
        costWrap.style.cssText = 'border-top:1px solid #e5e5e0;padding-top:8px;margin-bottom:4px';
        var costHint = document.createElement('div'); costHint.style.cssText = 'font-size:11px;color:#888;margin-bottom:4px';
        costHint.textContent = 'Для тебя (клиент не видит)';
        costWrap.appendChild(costHint);
        var cost = priceForCost - marg;
        var pct = Math.round(marg / priceForCost * 100);
        function costRow(k, v, cls){
          var r = document.createElement('div'); r.style.cssText = 'display:flex;justify-content:space-between;font-size:13px;padding:2px 0';
          var kk = document.createElement('span'); kk.style.color = '#888'; kk.textContent = k;
          var vv = document.createElement('span'); vv.textContent = v; if(cls) vv.className = cls;
          r.appendChild(kk); r.appendChild(vv); costWrap.appendChild(r);
        }
        costRow('Себестоимость', fm0(cost));
        costRow('Маржа', fm0(marg), 'crm-margin');
        costRow('Рентабельность', pct + '%');
        // v4.13.1: корректировка меряет ТОЛЬКО материальную часть (закупка
        // по flatItems), а «Себестоимость» строкой выше — договорная
        // (цена − маржа, включает работу мастера и экстры). Это разные
        // базы, поэтому факт корректировки нельзя подписывать
        // «Себестоимость по факту» — цифры не бьются с ценой договора и
        // выглядят враньём. Подписываем честно: «Материалы план → факт».
        // А вот «Маржа по факту» = маржа − отклонение — формула ВЕРНАЯ
        // при любой базе: отклонение это реальное изменение затрат.
        if(o.costFact !== null && o.costFact !== undefined){
          var factDelta = (o.costDelta !== null && o.costDelta !== undefined) ? Number(o.costDelta) : null;
          if(o.costPlan !== null && o.costPlan !== undefined){
            costRow('Материалы: план', fm0(o.costPlan));
          }
          costRow('Материалы: факт', fm0(o.costFact));
          if(factDelta !== null && factDelta !== 0){
            costRow(factDelta < 0 ? 'Сэкономлено на материалах' : 'Перерасход материалов', (factDelta < 0 ? '\u2212' : '+') + fm0(Math.abs(factDelta)));
            costRow('Маржа по факту', fm0(marg - factDelta), 'crm-margin');
          }
        }
        moneyWrap.appendChild(costWrap);
      }

      var dogLine = document.createElement('div'); dogLine.style.cssText = 'font-size:11px;color:#999';
      dogLine.textContent = 'Договор от ' + (o.dogDate ? fmtDate(o.dogDate) : '\u2014');
      moneyWrap.appendChild(dogLine);

      if(hasContract){
        var box = document.createElement('div'); box.className='crm-ch-box';
        var bh = document.createElement('div'); bh.className='crm-ch-h';
        var bt = document.createElement('b'); bt.textContent = 'Изменения к договору';
        bh.appendChild(secIcon('ti-file-pencil'));
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

    // ── Бригада: основной мастер + помощник ─────────────────
    var selMaster = null, selHelper = null, iHelperPay = null;
    var brigWrap = document.createElement('div');
    function renderBrig(){
      brigWrap.innerHTML = '';
      selMaster = null; selHelper = null; iHelperPay = null;
      var box = document.createElement('div'); box.className='crm-ch-box';
      var bh = document.createElement('div'); bh.className='crm-ch-h';
      var bt = document.createElement('b'); bt.textContent = 'Бригада';
      bh.appendChild(secIcon('ti-users'));
      bh.appendChild(bt); box.appendChild(bh);
      if(!EMP_LOADED){
        var ld = document.createElement('div'); ld.className='crm-ch-row'; ld.textContent = 'Загружаю сотрудников...';
        box.appendChild(ld); brigWrap.appendChild(box); return;
      }
      var ms = EMP.filter(function(e){ return e.role === 'Мастер'; });
      if(!ms.length){
        var em = document.createElement('div'); em.className='crm-ch-row'; em.style.color='#999';
        em.textContent = 'Мастеров пока нет \u2014 добавь их в Финансы \u2192 Зарплаты, тогда сможешь назначать бригаду.';
        box.appendChild(em); brigWrap.appendChild(box); return;
      }
      selMaster = document.createElement('select');
      var opNoM = document.createElement('option'); opNoM.value=''; opNoM.textContent='\u2014 не выбран \u2014'; selMaster.appendChild(opNoM);
      selHelper = document.createElement('select');
      var opNoH = document.createElement('option'); opNoH.value=''; opNoH.textContent='\u2014 без помощника \u2014'; selHelper.appendChild(opNoH);
      ms.forEach(function(e){
        var o1=document.createElement('option'); o1.value=e.id; o1.textContent=e.name; selMaster.appendChild(o1);
        var o2=document.createElement('option'); o2.value=e.id; o2.textContent=e.name; selHelper.appendChild(o2);
      });
      selMaster.value = o.masterId || '';
      selHelper.value = o.helperId || '';
      iHelperPay = inp(o.helperPay || '', 'number'); iHelperPay.placeholder='0';
      selHelper.addEventListener('change', function(){
        if(selHelper.value && !(Number(iHelperPay.value) > 0)){
          var hr = 0;
          for(var i=0;i<EMP.length;i++){ if(String(EMP[i].id)===String(selHelper.value)){ hr = Number(EMP[i].helperRate)||0; break; } }
          if(hr > 0) iHelperPay.value = hr;
        }
      });
      var body = document.createElement('div'); body.style.cssText='padding:8px 0';
      var rowA = document.createElement('div'); rowA.className='crm-2col';
      rowA.appendChild(field('Основной мастер', selMaster));
      rowA.appendChild(field('Помощник', selHelper));
      body.appendChild(rowA);
      body.appendChild(field('Помощнику за заказ, \u20B8', iHelperPay));
      var hint = document.createElement('div'); hint.style.cssText='font-size:10px;color:#999;margin-top:2px';
      hint.textContent = 'Процент с заказа идёт основному мастеру за вычетом суммы помощнику. Сохраняется кнопкой «Сохранить» внизу.';
      body.appendChild(hint);
      box.appendChild(body);
      brigWrap.appendChild(box);
    }
    renderBrig();
    if(!EMP_LOADED){ fetchEmp(function(err){ if(!err){ renderBrig(); renderDop(); } }); }
    b.appendChild(brigWrap);

    // ── Доп. работы: разовые выплаты исполнителям по заказу ──
    var dopWrap = document.createElement('div');
    function renderDop(){
      dopWrap.innerHTML = '';
      var box = document.createElement('div'); box.className='crm-ch-box';
      var bh = document.createElement('div'); bh.className='crm-ch-h';
      var bt = document.createElement('b'); bt.textContent = 'Доп. работы';
      bh.appendChild(secIcon('ti-tool'));
      var add = document.createElement('button'); add.className='crm-vbtn new'; add.textContent='+ Доп.работа';
      add.addEventListener('click', function(){
        if(!EMP_LOADED){ toast('\u26A0\uFE0F Сотрудники ещё грузятся \u2014 подожди пару секунд', '#BA7517'); return; }
        openDopModal(o, function(){ renderDop(); });
      });
      bh.appendChild(bt); bh.appendChild(add); box.appendChild(bh);
      if(!DOP_LOADED){
        var ld = document.createElement('div'); ld.className='crm-ch-row'; ld.textContent='Загружаю...';
        box.appendChild(ld);
      } else {
        var items = dopOf(o.num);
        if(!items.length){
          var em = document.createElement('div'); em.className='crm-ch-row'; em.style.color='#999';
          em.textContent = 'Разовые работы сверх процента (доставка, врезка, мелкий ремонт). Сумма \u2014 что получает сотрудник. Если за это платит клиент \u2014 добавь ещё \u00B1 Изменение к договору.';
          box.appendChild(em);
        } else {
          items.forEach(function(d){
            var r = document.createElement('div'); r.className='crm-ch-row';
            var dt = document.createElement('span'); dt.className='dt'; dt.textContent = fmtDate(d.date);
            var ds = document.createElement('span'); ds.className='ds'; ds.textContent = empName(d.empId) + (d.desc ? ' \u2014 ' + d.desc : '');
            var sm = document.createElement('span'); sm.className='sm out'; sm.textContent = fm0(Number(d.sum)||0);
            var del = document.createElement('button'); del.className='del'; del.textContent='\u2715';
            del.title = 'Удалить доп. работу';
            del.addEventListener('click', function(){
              if(!confirm('Удалить доп. работу \u00AB'+(d.desc||empName(d.empId))+'\u00BB на '+fm0(Number(d.sum)||0)+'?')) return;
              post({ action:'delDop', id:d.id }, function(){
                DOP = DOP.filter(function(x){ return x.id !== d.id; });
                renderDop();
                toast('OK Доп. работа удалена', '#1a5252');
              }, function(err){ toast('\u26A0\uFE0F Не удалилось: '+err, '#BA7517'); });
            });
            r.appendChild(dt); r.appendChild(ds); r.appendChild(sm); r.appendChild(del);
            box.appendChild(r);
          });
        }
      }
      dopWrap.appendChild(box);
    }
    renderDop();
    if(!DOP_LOADED){ fetchDop(function(err){ if(!err) renderDop(); }); }
    b.appendChild(dopWrap);

    // ── Фото и заметки ──────────────────────────────────────
    var attWrap = document.createElement('div');
    function renderAttach(){
      attWrap.innerHTML = '';
      var box = document.createElement('div'); box.className='crm-ch-box';
      var bh = document.createElement('div'); bh.className='crm-ch-h';
      var bt = document.createElement('b'); bt.textContent = 'Фото и заметки';
      bh.appendChild(secIcon('ti-photo'));
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
          files.forEach(function(a, aIdx){
            var cell = document.createElement('div');
            cell.style.cssText = 'position:relative;width:86px';
            var lnk = document.createElement('a');
            lnk.href = 'https://drive.google.com/file/d/' + a.fileId + '/view';
            lnk.target = '_blank'; lnk.rel = 'noopener';
            lnk.title = 'Открыть увеличенное фото';
            lnk.addEventListener('click', function(e){
              e.preventDefault();
              openLightbox(files, aIdx);
            });
            var im = document.createElement('img');
            im.src = 'https://drive.google.com/thumbnail?id=' + a.fileId + '&sz=w400';
            im.alt = a.name || 'фото';
            im.loading = 'lazy';
            im.style.cssText = 'width:86px;height:86px;object-fit:cover;border-radius:8px;border:1px solid #e5e5e0;display:block;background:var(--bg)';
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
            var eye = document.createElement('button');
            eye.textContent = '\uD83D\uDC41';
            eye.title = a.pub ? 'Видно клиенту на странице статуса \u2014 нажми, чтобы скрыть' : 'Скрыто от клиента \u2014 нажми, чтобы показать на странице статуса (вместе с подписью)';
            eye.style.cssText = 'position:absolute;top:2px;left:2px;width:22px;height:20px;border:none;border-radius:6px;cursor:pointer;font-size:11px;line-height:1;padding:0;' + (a.pub ? 'background:#1a5252;color:#fff' : 'background:rgba(20,20,20,.45);color:#fff;opacity:.75');
            eye.addEventListener('click', function(){
              var next = !a.pub;
              eye.disabled = true;
              post({ action:'pubAttach', id: a.id, pub: next }, function(){
                a.pub = next;
                renderAttach();
                toast(next ? 'OK Фото видно клиенту на странице статуса' : 'OK Фото скрыто с клиентской страницы', '#1a5252');
              }, function(err){
                eye.disabled = false;
                toast('\u26A0\uFE0F Не сохранилось: ' + err, '#BA7517');
              });
            });
            cell.appendChild(eye);
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
          ATT.push({ id: res.id, num: String(o.num), kind: 'коммент', name: '', fileId: '', comment: txt, created: new Date().toISOString(), pub: false });
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
              ATT.push({ id: res.id, num: String(o.num), kind: 'файл', name: nm, fileId: res.fileId, comment: cap, created: new Date().toISOString(), pub: false });
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

    // ── Рекламации (v4.6): гарантийные обращения по этому заказу.
    // Блок показывается только после договора — до него жаловаться
    // ещё не на что. Статус самого заказа рекламация НЕ меняет.
    var reclWrap = document.createElement('div');
    function renderRecl(){
      reclWrap.innerHTML = '';
      if(!o.dogDate) return;
      var box = document.createElement('div');
      box.className = RECL_LOADED && reclOf(o.num).length ? 'crm-ch-box recl' : 'crm-ch-box';
      var bh = document.createElement('div'); bh.className='crm-ch-h';
      var bt = document.createElement('b'); bt.textContent = 'Рекламации';
      bh.appendChild(secIcon('ti-alert-triangle'));
      bh.appendChild(bt);
      box.appendChild(bh);
      if(!RECL_LOADED){
        var ld = document.createElement('div'); ld.className='crm-ch-row';
        ld.textContent = 'Загружаю...';
        box.appendChild(ld);
      } else {
        var mine = reclOf(o.num);
        mine.sort(function(a,b){ return new Date(b.date||0).getTime() - new Date(a.date||0).getTime(); });
        mine.forEach(function(rc){
          var r = document.createElement('div'); r.className='crm-ch-row';
          var dt = document.createElement('span'); dt.className='dt'; dt.textContent = fmtDate(rc.date);
          var bd = document.createElement('span'); bd.className='crm-badge';
          bd.style.background = RECL_COLOR[rc.stage] || '#999';
          bd.textContent = rc.stage;
          var ds = document.createElement('span'); ds.className='ds'; ds.textContent = rc.desc;
          var del = document.createElement('button'); del.className='del'; del.textContent='\u2715';
          del.title = 'Удалить рекламацию';
          del.addEventListener('click', function(){
            if(!confirm('Удалить рекламацию \u00AB' + rc.desc + '\u00BB?')) return;
            post({ action:'delRecl', id: rc.id }, function(){
              RECL = RECL.filter(function(x){ return x.id !== rc.id; });
              renderRecl();
              toast('OK Рекламация удалена', '#1a5252');
            }, function(err){
              toast('\u26A0\uFE0F Не удалилось: ' + err, '#BA7517');
            });
          });
          r.appendChild(dt); r.appendChild(bd); r.appendChild(ds); r.appendChild(del);
          box.appendChild(r);
        });
        if(!mine.length){
          var em = document.createElement('div'); em.className='crm-ch-row';
          em.style.color = '#999';
          em.textContent = 'Рекламаций нет. Если клиент обратился по гарантии \u2014 заведи её здесь, статус заказа не изменится.';
          box.appendChild(em);
        }
      }
      var addRow = document.createElement('div');
      addRow.style.cssText = 'display:flex;gap:6px;align-items:center;padding:8px 12px;flex-wrap:wrap';
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.placeholder = 'На что жалуется клиент...';
      inp.style.cssText = 'flex:1;min-width:140px';
      var bAdd = document.createElement('button'); bAdd.className='crm-vbtn new';
      bAdd.textContent = '+ Рекламация';
      bAdd.addEventListener('click', function(){
        var desc = String(inp.value || '').trim();
        if(!desc){ toast('\u26A0\uFE0F Опиши, на что жалуется клиент', '#BA7517'); return; }
        bAdd.disabled = true;
        post({ action:'addRecl', recl:{ num:String(o.num), desc:desc } }, function(res){
          RECL.push({ id:res.id, num:String(o.num), date:new Date().toISOString(), stage:res.stage, desc:desc });
          inp.value = '';
          bAdd.disabled = false;
          renderRecl();
          toast('OK Рекламация принята', '#1a5252');
        }, function(err){
          bAdd.disabled = false;
          toast('\u26A0\uFE0F Не сохранилось: ' + err, '#BA7517');
        });
      });
      addRow.appendChild(inp); addRow.appendChild(bAdd);
      box.appendChild(addRow);
      reclWrap.appendChild(box);
    }
    renderRecl();
    if(!RECL_LOADED && o.dogDate){
      fetchRecl(function(err){ if(!err) renderRecl(); });
    }
    b.appendChild(reclWrap);

    // ── Лента событий (v4.4): статусы + фото/заметки + платежи +
    // изменения к договору — одной хронологией. Собирается из уже
    // загруженных SL/ATT/FIN/CH, новых запросов к серверу не требует
    // (эти массивы и так нужны другим блокам карточки). Кнопка
    // «Обновить» просто перерисовывает ленту из текущего состояния
    // массивов — если фото/платёж добавили выше по карточке, лента
    // подхватит это по клику, без автосинхронизации между блоками.
    var feedWrap = document.createElement('div');
    function renderFeed(){
      feedWrap.innerHTML = '';
      var box = document.createElement('div'); box.className='crm-ch-box';
      var bh = document.createElement('div'); bh.className='crm-ch-h';
      var bt = document.createElement('b'); bt.textContent = 'Лента событий';
      bh.appendChild(secIcon('ti-clock'));
      var bRefresh = document.createElement('button'); bRefresh.className='crm-vbtn';
      bRefresh.textContent = '\u21BB'; bRefresh.title = 'Обновить ленту';
      bRefresh.style.cssText = 'padding:2px 8px';
      bRefresh.addEventListener('click', function(){ renderFeed(); });
      bh.appendChild(bt); bh.appendChild(bRefresh);
      box.appendChild(bh);

      var loading = !(SL_LOADED && ATT_LOADED && FIN_LOADED && CH_LOADED);
      if(loading){
        var ld = document.createElement('div'); ld.className='crm-ch-row';
        ld.textContent = 'Загружаю...';
        box.appendChild(ld);
      } else {
        var ev = [];
        slogOf(o.num).forEach(function(s){
          ev.push({ date: s.date, icon: '\u21C4', text: 'Статус: ' + s.status });
        });
        attachOf(o.num).forEach(function(a){
          if(a.kind === '\u0444\u0430\u0439\u043B') ev.push({ date: a.created, icon: '\uD83D\uDCF7', text: 'Фото' + (a.comment ? ': ' + a.comment : '') });
          else ev.push({ date: a.created, icon: '\uD83D\uDCDD', text: a.comment });
        });
        FIN.forEach(function(f){
          if(String(f.num) !== String(o.num)) return;
          var sign = f.type === 'Приход' ? '+' : '\u2212';
          ev.push({ date: f.date, icon: '\uD83D\uDCB0', text: (f.type === 'Приход' ? 'Оплата' : 'Расход') + ' \u00AB' + f.cat + '\u00BB: ' + sign + fm0(Math.abs(Number(f.sum)||0)) });
        });
        changesOf(o.num).forEach(function(c){
          var plus = Number(c.sum) >= 0;
          ev.push({ date: c.date, icon: '\u270E', text: 'Изменение \u00AB' + c.desc + '\u00BB: ' + (plus?'+':'\u2212') + fm0(Math.abs(Number(c.sum)||0)) });
        });
        ev.sort(function(a,b){ return new Date(a.date) - new Date(b.date); });
        if(!ev.length){
          var em = document.createElement('div'); em.className='crm-ch-row';
          em.style.color = '#999';
          em.textContent = 'Событий пока нет \u2014 смена статуса, фото, платежи и изменения к договору появятся здесь по хронологии.';
          box.appendChild(em);
        } else {
          ev.forEach(function(e){
            var r = document.createElement('div'); r.className='crm-ch-row';
            var fdot = document.createElement('span'); fdot.className='crm-feed-dot';
            var dt = document.createElement('span'); dt.className='dt'; dt.textContent = fmtDate(e.date);
            var ds = document.createElement('span'); ds.className='ds'; ds.textContent = e.icon + ' ' + e.text;
            r.appendChild(fdot); r.appendChild(dt); r.appendChild(ds);
            box.appendChild(r);
          });
        }
      }
      feedWrap.appendChild(box);
    }
    renderFeed();
    if(!SL_LOADED) fetchStatusLog(function(err){ if(!err) renderFeed(); });
    if(!FIN_LOADED) fetchFin(function(err){ if(!err) renderFeed(); });
    if(!CH_LOADED) fetchChanges(function(err){ if(!err) renderFeed(); });
    b.appendChild(feedWrap);

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
    var bLink = document.createElement('button'); bLink.className='crm-m-btn'; bLink.textContent='\uD83D\uDD17 Ссылка клиенту';
    bLink.title = 'Страница статуса для клиента: только статус и даты, без цен, телефонов и адресов';
    bLink.addEventListener('click', function(){
      bLink.disabled = true;
      post({ action:'clientLink', num: String(o.num) }, function(res){
        bLink.disabled = false;
        if(!res || !res.key){ toast('\u26A0\uFE0F Таблица не вернула ключ', '#BA7517'); return; }
        var base = location.origin + location.pathname.replace(/[^\/]*$/, '');
        var url = base + 'status.html?o=' + encodeURIComponent(String(o.num)) + '&k=' + encodeURIComponent(res.key);
        function fallbackShow(){ prompt('Скопируй ссылку для клиента:', url); }
        if(navigator.clipboard && navigator.clipboard.writeText){
          navigator.clipboard.writeText(url).then(function(){
            toast('OK Ссылка скопирована \u2014 отправь клиенту, например в WhatsApp', '#1a5252');
          }, fallbackShow);
        } else {
          fallbackShow();
        }
      }, function(err){
        bLink.disabled = false;
        toast('\u26A0\uFE0F Не получилось: ' + err, '#BA7517');
      });
    });
    btns.appendChild(bLink);
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
        mountDate: iMount.value,
        source: iSource.value
      };
      // Бригада: шлём только если селекты построены (сотрудники загрузились
      // и есть хоть один мастер). Пустая строка мастера/помощника = снять.
      if(selMaster){
        upd.masterId = selMaster.value;
        upd.helperId = selHelper.value;
        upd.helperPay = selHelper.value ? Math.round(parseFloat(iHelperPay.value)||0) : 0;
      }
      post({ action:'updateOrder', order: upd }, function(){
        o.status=upd.status; o.client=upd.client; o.obj=upd.obj; o.phone=upd.phone;
        o.city=upd.city; o.furn=upd.furn; o.note=upd.note; o.mountDate=upd.mountDate; o.source=upd.source;
        if(upd.masterId !== undefined){ o.masterId=upd.masterId; o.helperId=upd.helperId; o.helperPay=upd.helperPay; }
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

    // ── v4.13.1: вкладки карточки ─────────────────────────────
    // Девять секций одной простынёй не читались (жалоба Дали). Секции
    // построены выше как раньше — здесь мы их только ПЕРЕПАРЕНЧИВАЕМ в
    // четыре вкладки. Ни одна точка сборки секций не тронута: слушатели
    // событий и замыкания (renderMoney, renderSlog и т.д.) продолжают
    // работать, appendChild просто перемещает узел.
    // Обзор — 90% открытий; Деньги/Производство/История — по клику.
    // Статус, кнопки действий и панель статусов остаются вне вкладок:
    // статус меняют с любой вкладки, кнопки — общие для всего заказа.
    (function(){
      var TABS = [
        { id:'obzor',  label:'Обзор',        secs:[secCli, secObj, secTasks] },
        { id:'dengi',  label:'Деньги',       secs:[moneyWrap] },
        { id:'proizv', label:'Производство', secs:[brigWrap, dopWrap, attWrap, reclWrap] },
        { id:'ist',    label:'История',      secs:[feedWrap] }
      ];
      var bar = document.createElement('div');
      bar.style.cssText = 'display:flex;gap:2px;margin:0 0 10px;border-bottom:1px solid #e5e5e0;overflow-x:auto';
      var panes = {};
      var btnsMap = {};
      function show(id){
        TABS.forEach(function(t){
          panes[t.id].style.display = t.id === id ? 'block' : 'none';
          btnsMap[t.id].style.cssText = 'flex:0 0 auto;padding:7px 12px;font-size:12px;background:none;border:none;cursor:pointer;white-space:nowrap;border-bottom:2px solid ' +
            (t.id === id ? '#1a5252;color:#1a5252;font-weight:700' : 'transparent;color:#888');
        });
      }
      TABS.forEach(function(t){
        var tb = document.createElement('button');
        tb.textContent = t.label;
        tb.addEventListener('click', function(){ show(t.id); });
        bar.appendChild(tb);
        btnsMap[t.id] = tb;
        var pane = document.createElement('div');
        t.secs.forEach(function(sec){ if(sec) pane.appendChild(sec); });
        panes[t.id] = pane;
      });
      // Вкладки встают после статуса/панели статусов, до кнопок действий:
      // b сейчас: [Статус, slWrap, ...перемещённые секции исчезли..., btns]
      b.insertBefore(bar, btns);
      TABS.forEach(function(t){ b.insertBefore(panes[t.id], btns); });
      show('obzor');
    })();

    m.appendChild(h); m.appendChild(b);
    bg.appendChild(m);
    document.body.appendChild(bg);
  }

  // ── Модалка добавления доп. работы (выплата исполнителю) ──
  function openDopModal(o, done){
    var bg = document.createElement('div'); bg.className='crm-modal-bg';
    bg.addEventListener('click', function(e){ if(e.target===bg) document.body.removeChild(bg); });
    var m = document.createElement('div'); m.className='crm-modal';
    var h = document.createElement('div'); h.className='crm-m-h';
    var title = document.createElement('b'); title.textContent = 'Доп. работа \u2014 заказ \u2116' + o.num;
    var x = document.createElement('button'); x.className='crm-m-x'; x.textContent='\u00D7';
    x.addEventListener('click', function(){ document.body.removeChild(bg); });
    h.appendChild(title); h.appendChild(x);
    var b = document.createElement('div'); b.className='crm-m-b';

    var selEmp = document.createElement('select');
    var ms = EMP.filter(function(e){ return e.role === 'Мастер'; });
    ms.forEach(function(e){
      var op = document.createElement('option'); op.value = e.id;
      var tag = '';
      if(String(e.id) === String(o.masterId)) tag = ' (основной)';
      else if(String(e.id) === String(o.helperId)) tag = ' (помощник)';
      op.textContent = e.name + tag; selEmp.appendChild(op);
    });
    if(o.masterId) selEmp.value = o.masterId;

    var tplWrap = document.createElement('div');
    var selTpl = document.createElement('select');
    var iDesc = inp(''); iDesc.placeholder = 'Что за работа (напр. доставка, врезка мойки)';
    function renderTplSelect(){
      selTpl.innerHTML = '';
      var op0 = document.createElement('option'); op0.value=''; op0.textContent = DOPT_LOADED ? '\u2014 выбрать из шаблонов \u2014' : 'Загружаю шаблоны...';
      selTpl.appendChild(op0);
      DOPT.forEach(function(t){ var op=document.createElement('option'); op.value=t.name; op.textContent=t.name; selTpl.appendChild(op); });
    }
    renderTplSelect();
    if(!DOPT_LOADED){ fetchDopTemplates(function(err){ if(!err) renderTplSelect(); }); }
    selTpl.addEventListener('change', function(){
      if(selTpl.value) iDesc.value = selTpl.value;
      selTpl.value = '';
    });
    var tplSaveBtn = document.createElement('button'); tplSaveBtn.className='crm-vbtn'; tplSaveBtn.style.cssText='margin-top:4px;font-size:11px;padding:3px 8px';
    tplSaveBtn.textContent = '+ Сохранить это описание как шаблон';
    tplSaveBtn.addEventListener('click', function(){
      var txt = iDesc.value.trim();
      if(!txt){ toast('\u26A0\uFE0F Сначала впиши описание', '#BA7517'); return; }
      var exists = DOPT.some(function(t){ return t.name === txt; });
      if(exists){ toast('\u26A0\uFE0F Такой шаблон уже есть', '#BA7517'); return; }
      tplSaveBtn.disabled = true;
      post({ action:'saveDopTemplate', tpl:{ name: txt } }, function(res){
        DOPT.push({ id: res.id, name: txt });
        renderTplSelect();
        tplSaveBtn.disabled = false;
        toast('OK Шаблон добавлен', '#1a5252');
      }, function(err){
        tplSaveBtn.disabled = false;
        toast('\u26A0\uFE0F Не сохранилось: '+err, '#BA7517');
      });
    });
    tplWrap.appendChild(selTpl); tplWrap.appendChild(tplSaveBtn);

    var iSum = inp('', 'number'); iSum.placeholder = '0';
    var td = new Date();
    var iDate = inp(td.getFullYear()+'-'+('0'+(td.getMonth()+1)).slice(-2)+'-'+('0'+td.getDate()).slice(-2), 'date');

    b.appendChild(field('Кому выплата', selEmp));
    b.appendChild(field('Шаблон', tplWrap));
    b.appendChild(field('Описание', iDesc));
    var rr = document.createElement('div'); rr.className='crm-2col';
    rr.appendChild(field('Сумма сотруднику, \u20B8', iSum));
    rr.appendChild(field('Дата', iDate));
    b.appendChild(rr);
    var note = document.createElement('div'); note.className='crm-fin-note';
    note.textContent = 'Это выплата исполнителю (попадёт в его Зарплату за месяц даты). Если за доп. работу платит клиент \u2014 добавь ещё \u00B1 Изменение к договору, оно двигает цену и долг.';
    b.appendChild(note);

    var btns = document.createElement('div'); btns.className='crm-m-btns';
    var bSave = document.createElement('button'); bSave.className='crm-m-btn save'; bSave.textContent='Добавить';
    bSave.addEventListener('click', function(){
      if(!selEmp.value){ toast('\u26A0\uFE0F Выбери сотрудника', '#BA7517'); return; }
      var sum = Math.round(parseFloat(iSum.value)||0);
      if(!(sum > 0)){ toast('\u26A0\uFE0F Сумма должна быть больше нуля', '#BA7517'); return; }
      bSave.disabled = true; bSave.textContent = 'Добавляю...';
      var dwork = { num:String(o.num), empId:selEmp.value, desc:iDesc.value.trim(), sum:sum, date:iDate.value };
      post({ action:'addDop', dop:dwork }, function(res){
        DOP.push({ id:res.id, num:String(o.num), empId:selEmp.value, desc:iDesc.value.trim(), sum:sum, date:iDate.value });
        document.body.removeChild(bg);
        if(typeof done === 'function') done();
        toast('OK Доп. работа добавлена', '#1a5252');
      }, function(err){
        bSave.disabled=false; bSave.textContent='Добавить';
        toast('\u26A0\uFE0F Не сохранилось: '+err, '#BA7517');
      });
    });
    btns.appendChild(bSave);
    b.appendChild(btns);
    m.appendChild(h); m.appendChild(b);
    bg.appendChild(m);
    document.body.appendChild(bg);
    setTimeout(function(){ try{ iDesc.focus(); }catch(e){} }, 50);
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

    var resvBox = document.createElement('div');
    resvBox.style.cssText = 'padding:2px 0 4px';
    var bResv = document.createElement('button'); bResv.className = 'crm-vbtn';
    bResv.textContent = '\uD83D\uDCE6 Посчитать резерв др. заказов';
    bResv.title = 'Сколько остатка уже обещано другим активным заказам (тянет их снимки)';
    var reserved = null;
    bResv.addEventListener('click', function(){
      bResv.disabled = true; bResv.textContent = 'Считаю...';
      computeReserved(o.num, function(err, map){
        bResv.disabled = false;
        if(err === '__no_key__'){ toast('\u26A0\uFE0F Введи ключ доступа', '#BA7517'); return; }
        if(err){ toast('\u26A0\uFE0F Резерв не посчитался: ' + err, '#BA7517'); bResv.textContent = '\uD83D\uDCE6 Посчитать резерв др. заказов'; return; }
        reserved = map;
        resvBox.innerHTML = '';
        paintTable();
      });
    });
    resvBox.appendChild(bResv);
    b.appendChild(resvBox);

    var fmt = function(n){ n = Number(n) || 0; return Number.isInteger(n) ? String(n) : n.toFixed(2); };

    var tblWrap = document.createElement('div');
    b.appendChild(tblWrap);
    function paintTable(){
      tblWrap.innerHTML = '';
      if(!tracked.length) return;
      var t1 = document.createElement('b'); t1.textContent = 'Со складским учётом';
      t1.style.display = 'block'; t1.style.margin = '8px 0 4px';
      tblWrap.appendChild(t1);
      var tbl = document.createElement('table'); tbl.className = 'crm-ftbl';
      var thr = document.createElement('tr');
      var heads = reserved ? ['Наименование','Ед','Нужно','Есть','Резерв (др.)','Свободно','Докупить'] : ['Наименование','Ед','Нужно','Есть','Докупить'];
      heads.forEach(function(hh){ var th=document.createElement('th'); th.textContent=hh; thr.appendChild(th); });
      tbl.appendChild(thr);
      tracked.forEach(function(t){
        var tr = document.createElement('tr');
        var c1 = document.createElement('td'); c1.textContent = String(t.name || t.key); tr.appendChild(c1);
        var c2 = document.createElement('td'); c2.textContent = String(t.unit || ''); tr.appendChild(c2);
        var c3 = document.createElement('td'); c3.textContent = fmt(t.need); tr.appendChild(c3);
        var c4 = document.createElement('td'); c4.textContent = String(t.have); tr.appendChild(c4);
        var buy = t.buy;
        if(reserved){
          var rv = Math.round(reserved[t.key]) || 0;
          var free = t.have - rv;
          var c4b = document.createElement('td'); c4b.textContent = String(rv); c4b.style.color = '#999'; tr.appendChild(c4b);
          var c4c = document.createElement('td'); c4c.textContent = String(free);
          if(free < 0){ c4c.style.color = '#BA1B1B'; c4c.style.fontWeight = '600'; }
          tr.appendChild(c4c);
          // Докупить с учётом резерва: сколько физически свободно (за
          // вычетом чужих претензий), столько и хватит без покупки —
          // остальное нужно докупить. Та же формула округления, что и
          // в t.buy (лист — вверх, штуки — до целого).
          var freeHave = Math.max(0, free);
          buy = t.unit === '\u043b\u0438\u0441\u0442'
            ? Math.max(0, Math.ceil(t.need - 1e-9) - freeHave)
            : Math.max(0, Math.round(t.need) - freeHave);
        }
        var c5 = document.createElement('td'); c5.textContent = String(buy);
        if(buy > 0){ c5.style.color = '#A32D2D'; c5.style.fontWeight = '500'; }
        tr.appendChild(c5);
        tbl.appendChild(tr);
      });
      tblWrap.appendChild(tbl);
    }
    paintTable();

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

    var resvBox = document.createElement('div');
    resvBox.style.cssText = 'padding:2px 0 4px';
    var bResv = document.createElement('button'); bResv.className = 'crm-vbtn';
    bResv.textContent = '\uD83D\uDCE6 Посчитать резерв др. заказов';
    bResv.title = 'Сколько остатка уже обещано другим активным заказам (тянет их снимки)';
    var reserved = null;
    bResv.addEventListener('click', function(){
      bResv.disabled = true; bResv.textContent = 'Считаю...';
      computeReserved(o.num, function(err, map){
        bResv.disabled = false;
        if(err === '__no_key__'){ toast('\u26A0\uFE0F Введи ключ доступа', '#BA7517'); return; }
        if(err){ toast('\u26A0\uFE0F Резерв не посчитался: ' + err, '#BA7517'); bResv.textContent = '\uD83D\uDCE6 Посчитать резерв др. заказов'; return; }
        reserved = map;
        resvBox.innerHTML = '';
        paintTable();
      });
    });
    resvBox.appendChild(bResv);
    b.appendChild(resvBox);

    var rows = [];
    var tblWrap = document.createElement('div');
    b.appendChild(tblWrap);
    var warnBox = document.createElement('div');
    warnBox.style.cssText = 'font-size:11px;color:#A32D2D;padding-top:4px';
    b.appendChild(warnBox);
    function checkWarn(){
      if(!reserved) return;
      var over = rows.filter(function(r){ return r.free !== undefined && Number(r.input.value) > r.free; });
      warnBox.textContent = over.length
        ? '\u26A0\uFE0F Запрошено больше свободного остатка: ' + over.map(function(r){ return r.name; }).join(', ') + ' \u2014 часть уже обещана другим заказам.'
        : '';
    }
    function paintTable(){
      tblWrap.innerHTML = '';
      rows = [];
      if(!tracked.length){
        var e0 = document.createElement('div'); e0.className = 'crm-empty'; e0.textContent = 'В заказе нет позиций со складским учётом.';
        tblWrap.appendChild(e0);
        return;
      }
      var tbl = document.createElement('table'); tbl.className = 'crm-ftbl';
      var thr = document.createElement('tr');
      var heads = reserved ? ['Наименование','Ед','Нужно','Есть','Резерв (др.)','Свободно','Выдать'] : ['Наименование','Ед','Нужно','Есть','Выдать'];
      heads.forEach(function(hh){ var th=document.createElement('th'); th.textContent=hh; thr.appendChild(th); });
      tbl.appendChild(thr);
      tracked.forEach(function(t){
        var need = Number(t.need) || 0;
        var def = t.unit === '\u043b\u0438\u0441\u0442' ? Math.ceil(need - 1e-9) : Math.round(need);
        var tr = document.createElement('tr');
        var c1 = document.createElement('td'); c1.textContent = String(t.name || t.key); tr.appendChild(c1);
        var c2 = document.createElement('td'); c2.textContent = String(t.unit || ''); tr.appendChild(c2);
        var c3 = document.createElement('td'); c3.textContent = Number.isInteger(need) ? String(need) : need.toFixed(2); tr.appendChild(c3);
        var c4 = document.createElement('td'); c4.textContent = String(t.have); tr.appendChild(c4);
        var free;
        if(reserved){
          var rv = Math.round(reserved[t.key]) || 0;
          free = t.have - rv;
          var c4b = document.createElement('td'); c4b.textContent = String(rv); c4b.style.color = '#999'; tr.appendChild(c4b);
          var c4c = document.createElement('td'); c4c.textContent = String(free);
          if(free < 0){ c4c.style.color = '#BA1B1B'; c4c.style.fontWeight = '600'; }
          tr.appendChild(c4c);
        }
        var c5 = document.createElement('td');
        var iq = document.createElement('input'); iq.type = 'number'; iq.min = '0'; iq.step = '1'; iq.value = String(def); iq.style.width = '58px';
        iq.addEventListener('input', checkWarn);
        c5.appendChild(iq); tr.appendChild(c5);
        tbl.appendChild(tr);
        rows.push({ key: t.key, name: t.name || t.key, unit: t.unit, have: t.have, free: free, input: iq });
      });
      tblWrap.appendChild(tbl);
      checkWarn();
    }
    paintTable();

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
        RESERVED_LOADED = false;
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

  // ── Резервирование материала под заказ (v4.6) ──────────────
  // Задача: не дать дважды пообещать один и тот же лист/штуку двум
  // заказам. Резерв ключа = сумма ЕЩЁ НЕ ВЫДАННОГО need по всем активным
  // заказам (после договора, кроме Готова/Отказ/Отложено), кроме того
  // заказа, для которого сейчас считаем (excludeNum) — иначе заказ
  // резервировал бы материал сам у себя.
  // Важно: need берётся из снимка КАЖДОГО заказа заново (та же формула
  // orderPurchase(), что и у сводной закупки/сроков поставки), а из
  // него вычитается уже выданное этому заказу количество (Расход по
  // ключу с этим №) — материал, который уже выдан, больше не «резерв»,
  // он и так вычтен из физического остатка складским движением. Без
  // этого вычета резерв задваивал бы списание.
  function fetchActiveRecs(excludeNum, cb){
    var skip = ['Готова','Отказ','Отложено'];
    var candidates = ORDERS.filter(function(o){
      return o.dogDate && skip.indexOf(o.status) === -1 && String(o.num) !== String(excludeNum || '');
    });
    if(!candidates.length){ cb([]); return; }
    var recs = [];
    var left = candidates.length;
    candidates.forEach(function(o){
      loadOrderRec(o.num, function(err, rec){
        if(!err) recs.push({ o: o, rec: rec });
        left--;
        if(left === 0) cb(recs);
      });
    });
  }

  function buildReservedMap(recs){
    var reserved = {};
    recs.forEach(function(item){
      var p = orderPurchase(item.rec.snap, DB, []);
      var trk = p.tracked || [];
      trk.forEach(function(t){
        if(!t.need) return;
        var issued = 0;
        STOCK_MOVES.forEach(function(m){
          if(m.type === 'Расход' && String(m.num) === String(item.o.num) && m.key === t.key){
            issued += Math.round(Number(m.qty) || 0);
          }
        });
        var remain = Math.max(0, t.need - issued);
        if(remain) reserved[t.key] = (reserved[t.key] || 0) + remain;
      });
    });
    return reserved;
  }

  // Свежие STOCK_MOVES (перевыдача могла случиться прямо сейчас) +
  // снимки активных заказов -> карта резерва. excludeNum исключает
  // текущий заказ из подсчёта (для модалок «Список закупщику»/«Выдать»).
  function computeReserved(excludeNum, cb){
    if(typeof orderPurchase !== 'function'){ cb('калькулятор ещё не загрузился — открой вкладку расчёта', null); return; }
    fetchStockMoves(function(merr){
      if(merr && merr !== '__no_key__'){ cb(merr, null); return; }
      if(merr === '__no_key__'){ cb(merr, null); return; }
      fetchActiveRecs(excludeNum, function(recs){ cb(null, buildReservedMap(recs)); });
    });
  }


  // Заказы: после договора (dogDate есть), кроме Готова/Отказ/Отложено.
  // Нужно суммируется по каждому заказу через orderPurchase() (поле
  // need — оно НЕ зависит от остатков склада), остаток вычитается ОДИН
  // РАЗ из общей суммы — иначе при делении по заказам дефицит считался
  // бы неверно (один и тот же остаток вычитался бы из каждого заказа).
  // v4.4: lead-time предупреждение по закупке. Для набора уже
  // загруженных снимков заказов (recs = [{o, rec}]) строит карту
  // "ключ материала -> какие заказы (и на какую дату монтажа) в нём
  // нуждаются" через orderPurchase() того же калькулятора, что уже
  // используется сводной закупкой (main.js не трогаем). Опирается на
  // необработанное need (без вычета остатков) — остатки проверяются
  // отдельно на вызывающей стороне через t.buy, чтобы не путать
  // "материала не хватит" с "материал есть, но приедет поздно".
  function buildKeyOrdersMap(recs){
    var keyOrders = {};
    recs.forEach(function(item){
      var p = orderPurchase(item.rec.snap, DB, []);
      var trk = p.tracked || [];
      trk.forEach(function(t){
        if(!t.need) return;
        if(!keyOrders[t.key]) keyOrders[t.key] = [];
        keyOrders[t.key].push({ num: item.o.num, client: item.o.client, mountDate: item.o.mountDate });
      });
    });
    return keyOrders;
  }

  // Срок поставки материала (SLEAD) vs дата монтажа самого срочного
  // заказа, которому он нужен. Возвращает null, если срок не задан,
  // заказ без даты монтажа, или времени с запасом хватает.
  function leadWarningFor(keyOrders, key){
    var lead = leadOf(key);
    if(!lead) return null;
    var list = keyOrders[key] || [];
    var best = null;
    list.forEach(function(x){
      if(!x.mountDate) return;
      var days = Math.ceil((new Date(x.mountDate) - new Date()) / 86400000);
      if(best === null || days < best.days) best = { num: x.num, client: x.client, days: days };
    });
    if(!best) return null;
    if(best.days > lead) return null;
    return { lead: lead, days: best.days, num: best.num, client: best.client };
  }

  // Отдельная от сводной закупки проверка — вкладка Склад/Дефицит,
  // по кнопке (тянет снимки заказов сама, туда их ещё не грузили).
  function checkLeadTimes(btn, box){
    if(typeof orderPurchase !== 'function'){
      toast('\u26A0\uFE0F Калькулятор ещё не загрузился \u2014 открой вкладку расчёта', '#BA7517');
      return;
    }
    var skip = ['Готова','Отказ','Отложено'];
    var candidates = ORDERS.filter(function(o){ return o.dogDate && o.mountDate && skip.indexOf(o.status) === -1; });
    box.innerHTML = '';
    if(!candidates.length){
      var e0 = document.createElement('div'); e0.className = 'crm-empty';
      e0.textContent = 'Нет заказов после договора с датой монтажа.';
      box.appendChild(e0);
      return;
    }
    btn.disabled = true; btn.textContent = 'Считаю...';
    var recs = [];
    var errs = [];
    var left = candidates.length;
    candidates.forEach(function(o){
      loadOrderRec(o.num, function(err, rec){
        if(err) errs.push('\u2116' + o.num);
        else recs.push({ o: o, rec: rec });
        left--;
        if(left === 0){
          btn.disabled = false; btn.textContent = '\u23F1 Сроки поставки';
          if(errs.length) toast('\u26A0\uFE0F Пропущено заказов (нет снимка): ' + errs.length, '#BA7517');
          var keyOrders = buildKeyOrdersMap(recs);
          var warns = [];
          Object.keys(keyOrders).forEach(function(k){
            var w = leadWarningFor(keyOrders, k);
            if(!w) return;
            var stockRow = STOCK.filter(function(s){ return s.key === k; })[0];
            warns.push({ name: stockRow ? stockRow.name : k, w: w });
          });
          box.innerHTML = '';
          if(!warns.length){
            var ok = document.createElement('div'); ok.className = 'crm-empty';
            ok.textContent = 'По срокам поставки всё в порядке \u2014 ничего не горит.';
            box.appendChild(ok);
            return;
          }
          warns.sort(function(a,c){ return a.w.days - c.w.days; });
          var tt = document.createElement('div'); tt.className = 'crm-sec-t';
          tt.textContent = '\u23F1 Пора заказывать';
          box.appendChild(tt);
          warns.forEach(function(x){
            var daysTxt = x.w.days < 0 ? 'монтаж уже наступил' : ('до монтажа ' + x.w.days + ' дн');
            var row = document.createElement('div');
            row.style.cssText = 'font-size:12px;padding:4px 0;border-bottom:1px solid #f0f0ea;color:#A32D2D';
            row.textContent = '\u26A0 ' + x.name + ' \u2014 \u2116' + x.w.num + (x.w.client ? ' (' + x.w.client + ')' : '') + ': обычно везут ' + x.w.lead + ' дн, ' + daysTxt;
            box.appendChild(row);
          });
        }
      });
    });
  }

  function openAggPurchaseModal(){
    if(typeof orderPurchase !== 'function' || typeof stockMap !== 'function' || typeof aggregatePurchase !== 'function'){
      toast('\u26A0\uFE0F Калькулятор ещё не загрузился \u2014 открой вкладку расчёта', '#BA7517');
      return;
    }
    var skip = ['Готова','Отказ','Отложено'];
    var all = ORDERS.slice();
    var candidates = all.filter(function(o){ return o.dogDate && skip.indexOf(o.status) === -1; });
    candidates.sort(function(a,c){ return String(a.num).localeCompare(String(c.num), 'ru', { numeric:true }); });

    var bg = document.createElement('div'); bg.className = 'crm-modal-bg';
    bg.addEventListener('click', function(e){ if(e.target===bg) document.body.removeChild(bg); });
    var m = document.createElement('div'); m.className = 'crm-modal';
    var h = document.createElement('div'); h.className = 'crm-m-h';
    var title = document.createElement('b'); title.textContent = 'Сводная закупка по заказам';
    var x = document.createElement('button'); x.className = 'crm-m-x'; x.textContent = '\u00D7';
    x.addEventListener('click', function(){ document.body.removeChild(bg); });
    h.appendChild(title); h.appendChild(x);
    var b = document.createElement('div'); b.className = 'crm-m-b';

    if(!candidates.length){
      var e0 = document.createElement('div'); e0.className = 'crm-empty';
      e0.textContent = 'Нет заказов после договора (кроме Готова/Отказ/Отложено).';
      b.appendChild(e0);
      m.appendChild(h); m.appendChild(b); bg.appendChild(m); document.body.appendChild(bg);
      return;
    }

    var lead = document.createElement('div'); lead.className = 'crm-empty';
    lead.style.textAlign = 'left'; lead.style.padding = '4px 0'; lead.style.fontSize = '11px';
    lead.textContent = 'Отмечены все заказы после договора. Сними лишние и нажми «Посчитать».';
    b.appendChild(lead);

    var checks = [];
    var listBox = document.createElement('div');
    listBox.style.cssText = 'max-height:180px;overflow:auto;border:1px solid var(--bd);border-radius:8px;padding:4px 8px;margin-bottom:8px';
    candidates.forEach(function(o){
      var row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px;cursor:pointer';
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true;
      var txt = document.createElement('span');
      txt.textContent = '\u2116' + o.num + (o.client ? ' \u2014 ' + o.client : '') + ' (' + (o.status || '') + ')';
      row.appendChild(cb); row.appendChild(txt);
      listBox.appendChild(row);
      checks.push({ o: o, cb: cb });
    });
    b.appendChild(listBox);

    var resultBox = document.createElement('div');
    b.appendChild(resultBox);

    var btns = document.createElement('div'); btns.className = 'crm-m-btns';
    var bCalc = document.createElement('button'); bCalc.className = 'crm-m-btn save'; bCalc.textContent = 'Посчитать';
    bCalc.addEventListener('click', function(){
      var chosen = [];
      checks.forEach(function(c){ if(c.cb.checked) chosen.push(c.o); });
      if(!chosen.length){ toast('\u26A0\uFE0F Отметь хотя бы один заказ', '#BA7517'); return; }
      bCalc.disabled = true; bCalc.textContent = 'Считаю...';
      resultBox.innerHTML = '';
      fetchStock(function(serr){
        if(serr==='__no_key__'){ bCalc.disabled=false; bCalc.textContent='Посчитать'; toast('\u26A0\uFE0F Введи ключ доступа', '#BA7517'); return; }
        if(serr){ bCalc.disabled=false; bCalc.textContent='Посчитать'; toast('\u26A0\uFE0F Остатки не загрузились: '+serr, '#BA7517'); return; }
        var recs = [];
        var errs = [];
        var left = chosen.length;
        chosen.forEach(function(o){
          loadOrderRec(o.num, function(err, rec){
            if(err) errs.push('\u2116' + o.num + ': ' + err);
            else recs.push({ o: o, rec: rec });
            left--;
            if(left === 0){
              bCalc.disabled = false; bCalc.textContent = 'Посчитать';
              paintAggResult(resultBox, recs);
              if(errs.length) toast('\u26A0\uFE0F Пропущено заказов (нет снимка): ' + errs.length, '#BA7517');
            }
          });
        });
      });
    });
    btns.appendChild(bCalc);
    b.appendChild(btns);

    m.appendChild(h); m.appendChild(b);
    bg.appendChild(m);
    document.body.appendChild(bg);
  }

  function paintAggResult(box, recs){
    box.innerHTML = '';
    var snaps = [];
    recs.forEach(function(item){ snaps.push(item.rec.snap); });
    var pur = aggregatePurchase(snaps, DB, STOCK);
    var tracked = pur.tracked || [];
    var untracked = pur.untracked || [];
    tracked.sort(function(a,c){ return (c.buy - a.buy) || String(a.name||a.key).localeCompare(String(c.name||c.key), 'ru'); });
    untracked.sort(function(a,c){ return String(a.n||'').localeCompare(String(c.n||''), 'ru'); });
    var keyOrders = buildKeyOrdersMap(recs); // v4.4: для строк ниже — предупреждение по сроку поставки

    var toBuy = 0;
    tracked.forEach(function(t){ if(t.buy > 0) toBuy++; });
    var lead = document.createElement('div'); lead.className = 'crm-empty';
    lead.style.textAlign = 'left'; lead.style.padding = '4px 0';
    lead.textContent = 'Заказов учтено: ' + recs.length + '. ' + (toBuy ? ('Докупить позиций: ' + toBuy) : 'Всё есть на складе \u2014 докупать нечего.');
    box.appendChild(lead);

    var fmt = function(n){ n = Number(n) || 0; return Number.isInteger(n) ? String(n) : n.toFixed(2); };

    if(tracked.length){
      var t1 = document.createElement('b'); t1.textContent = 'Со складским учётом';
      t1.style.display = 'block'; t1.style.margin = '8px 0 4px';
      box.appendChild(t1);
      var tbl = document.createElement('table'); tbl.className = 'crm-ftbl';
      var thr = document.createElement('tr');
      ['Наименование','Ед','Нужно','Есть','Докупить'].forEach(function(hh){ var th=document.createElement('th'); th.textContent=hh; thr.appendChild(th); });
      tbl.appendChild(thr);
      tracked.forEach(function(t){
        var tr = document.createElement('tr');
        var c1 = document.createElement('td'); c1.textContent = String(t.name || t.key);
        if(t.buy > 0){
          var w = leadWarningFor(keyOrders, t.key);
          if(w){
            var daysTxt = w.days < 0 ? 'монтаж уже наступил' : ('до монтажа ' + w.days + ' дн');
            var warnEl = document.createElement('div');
            warnEl.style.cssText = 'font-size:10px;color:#A32D2D;font-weight:500;margin-top:2px';
            warnEl.textContent = '\u26A0 \u2116' + w.num + (w.client ? ' \u2014 ' + w.client : '') + ': везут ' + w.lead + ' дн, ' + daysTxt;
            c1.appendChild(warnEl);
          }
        }
        tr.appendChild(c1);
        var c2 = document.createElement('td'); c2.textContent = String(t.unit || ''); tr.appendChild(c2);
        var c3 = document.createElement('td'); c3.textContent = fmt(t.need); tr.appendChild(c3);
        var c4 = document.createElement('td'); c4.textContent = String(t.have); tr.appendChild(c4);
        var c5 = document.createElement('td'); c5.textContent = String(t.buy);
        if(t.buy > 0){ c5.style.color = '#A32D2D'; c5.style.fontWeight = '500'; }
        tr.appendChild(c5);
        tbl.appendChild(tr);
      });
      box.appendChild(tbl);
    }

    if(untracked.length){
      var t2 = document.createElement('b'); t2.textContent = 'Без складского учёта';
      t2.style.display = 'block'; t2.style.margin = '12px 0 4px';
      box.appendChild(t2);
      var hint = document.createElement('div'); hint.className = 'crm-empty';
      hint.style.textAlign = 'left'; hint.style.fontSize = '11px'; hint.style.padding = '0 0 4px';
      hint.textContent = 'Нет артикула \u2014 проверь наличие вручную.';
      box.appendChild(hint);
      var tbl2 = document.createElement('table'); tbl2.className = 'crm-ftbl';
      var thr2 = document.createElement('tr');
      ['Наименование','Кол-во'].forEach(function(hh){ var th=document.createElement('th'); th.textContent=hh; thr2.appendChild(th); });
      tbl2.appendChild(thr2);
      untracked.forEach(function(u){
        var tr = document.createElement('tr');
        var c1 = document.createElement('td'); c1.textContent = String(u.n || ''); tr.appendChild(c1);
        var c2 = document.createElement('td'); c2.textContent = fmt(u.q); tr.appendChild(c2);
        tbl2.appendChild(tr);
      });
      box.appendChild(tbl2);
    }

    if(!tracked.length && !untracked.length){
      var e1 = document.createElement('div'); e1.className = 'crm-empty';
      e1.textContent = 'В отмеченных заказах нет складских позиций.';
      box.appendChild(e1);
    }

    var manualHost = document.createElement('div');
    box.appendChild(manualHost);
    paintAggManual(manualHost);
  }

  // Ручные позиции сводки: живут только в памяти вкладки (AGG_MANUAL),
  // не пишутся на сервер и не влияют на дефицит склада — это отдельный
  // список «что докупить руками сверху авто-расчёта».
  function paintAggManual(host){
    host.innerHTML = '';
    var t3 = document.createElement('b'); t3.textContent = 'Добавлено вручную';
    t3.style.display = 'block'; t3.style.margin = '12px 0 4px';
    host.appendChild(t3);
    if(AGG_MANUAL.length){
      var tbl3 = document.createElement('table'); tbl3.className = 'crm-ftbl';
      var thr3 = document.createElement('tr');
      ['Наименование','Ед','Кол-во',''].forEach(function(hh){ var th=document.createElement('th'); th.textContent=hh; thr3.appendChild(th); });
      tbl3.appendChild(thr3);
      AGG_MANUAL.forEach(function(mi, idx){
        var tr = document.createElement('tr');
        var c1 = document.createElement('td'); c1.textContent = mi.name; tr.appendChild(c1);
        var c2 = document.createElement('td'); c2.textContent = mi.unit; tr.appendChild(c2);
        var c3 = document.createElement('td'); c3.textContent = String(mi.qty); tr.appendChild(c3);
        var c4 = document.createElement('td');
        var bx = document.createElement('button'); bx.textContent = '\u00D7';
        bx.style.cssText = 'border:none;background:none;color:#A32D2D;cursor:pointer;font-weight:700;font-size:14px';
        bx.addEventListener('click', function(){ AGG_MANUAL.splice(idx, 1); paintAggManual(host); });
        c4.appendChild(bx); tr.appendChild(c4);
        tbl3.appendChild(tr);
      });
      host.appendChild(tbl3);
    } else {
      var e2 = document.createElement('div'); e2.className = 'crm-empty';
      e2.style.textAlign = 'left'; e2.style.fontSize = '11px'; e2.style.padding = '0 0 4px';
      e2.textContent = 'Пока пусто \u2014 добавь позицию, которую авто-список не считает.';
      host.appendChild(e2);
    }
    var addRow = document.createElement('div');
    addRow.style.cssText = 'display:flex;gap:6px;margin-top:6px;align-items:center;flex-wrap:wrap';
    var iName = document.createElement('input'); iName.placeholder = 'Наименование';
    iName.style.cssText = 'flex:1;min-width:110px';
    var iQty = document.createElement('input'); iQty.type = 'number'; iQty.placeholder = 'Кол-во'; iQty.min = '0';
    iQty.style.cssText = 'width:70px';
    var selU = document.createElement('select');
    [['шт','шт'],['лист','лист']].forEach(function(u){ var op=document.createElement('option'); op.value=u[0]; op.textContent=u[1]; selU.appendChild(op); });
    var bAdd = document.createElement('button'); bAdd.className = 'crm-vbtn'; bAdd.textContent = '+ Добавить';
    bAdd.addEventListener('click', function(){
      var nm = iName.value.trim();
      var qn = Number(iQty.value);
      if(!nm){ toast('\u26A0\uFE0F Укажи наименование', '#BA7517'); return; }
      if(!(qn > 0)){ toast('\u26A0\uFE0F Кол-во должно быть больше нуля', '#BA7517'); return; }
      AGG_MANUAL.push({ name: nm, unit: selU.value, qty: qn });
      paintAggManual(host);
    });
    addRow.appendChild(iName); addRow.appendChild(iQty); addRow.appendChild(selU); addRow.appendChild(bAdd);
    host.appendChild(addRow);
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
