// Тесты финансового блока СРМ (v4.14) — jsdom, приём как в smoke-tabs.js:
// страница целиком, моканый fetch, живые вкладки Финансов.
//
// Данные подобраны так, чтобы воспроизвести реальную ситуацию со скриншотов:
//   №46 — настоящий договор на 302 040₸ (аванс + доплата получены)
//   №1  — заказ в статусе «Договор», но с датой договора и суммой 0₸
//         (данные заполнены не до конца — не должен считаться сделкой)
//   №7  — договор был, но клиент отказался (не должен считаться сделкой)
//   №9  — согласованная цена есть, дату договора забыли проставить
//         (деньги реальные — из выручки терять нельзя, но в помесячную
//          разбивку не попадёт, о чём должно быть сказано явно)
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
let PASS = 0, FAIL = 0;
function ok(c, n){ if (c) { PASS++; console.log('  \u2713 ' + n); } else { FAIL++; console.log('  \u2717 FAIL: ' + n); } }

const html = fs.readFileSync('index.html', 'utf8');
const mainJs = fs.readFileSync('main.js', 'utf8');
const crmJs = fs.readFileSync('crm.js', 'utf8');

const MONTH = new Date().toISOString().slice(0, 7);
const D = MONTH + '-15';

const ORDERS = [
  { num:'46', status:'Договор', client:'уцка', furn:'Кухня', sogl:302040, pred:302040,
    avans:151020, paid:151020, dogDate:D, mountDate:'', margin:88934,
    earnMaster:45306, earnDesigner:0, masterId:'', helperId:'', helperPay:0, updated:D },
  { num:'1', status:'Договор', client:'Иванов Иван', furn:'', sogl:0, pred:0,
    avans:30000, paid:0, dogDate:D, mountDate:'', margin:0,
    earnMaster:0, earnDesigner:0, masterId:'', helperId:'', helperPay:0, updated:D },
  { num:'7', status:'Отказ', client:'Отказник', furn:'', sogl:500000, pred:500000,
    avans:0, paid:0, dogDate:D, mountDate:'', margin:100000,
    earnMaster:0, earnDesigner:0, masterId:'', helperId:'', helperPay:0, updated:D },
  { num:'9', status:'Производство', client:'Без даты', furn:'Шкаф', sogl:200000, pred:200000,
    avans:50000, paid:0, dogDate:'', mountDate:'', margin:40000,
    earnMaster:0, earnDesigner:0, masterId:'', helperId:'', helperPay:0, updated:D }
];

// Касса: только приход по №46. Плюс одна битая строка с пустым типом —
// сейчас она молча считается расходом.
const FIN = [
  { id:'f1', date:D, type:'Приход', cat:'Аванс',   sum:151020, num:'46', comment:'Аванс по договору' },
  { id:'f2', date:D, type:'Приход', cat:'Доплата', sum:151020, num:'46', comment:'' },
  { id:'f3', date:D, type:'',       cat:'Прочее',  sum:9999,   num:'',   comment:'битый тип' }
];
// Постоянные и оклады существуют, но за месяц НЕ начислены.
const RECUR = [
  { id:'r1', name:'Аренда Офиса', cat:'Аренда', sum:100000, active:true },
  { id:'r2', name:'Аренда Цеха',  cat:'Аренда', sum:250000, active:true }
];
const EMP = [
  { id:'e1', name:'Дали',  role:'Дизайнер', salary:200000, active:true, helperRate:0 },
  { id:'e2', name:'Серик', role:'Мастер',   salary:150000, active:true, helperRate:0 }
];

const vc = new VirtualConsole();
vc.on('jsdomError', e => console.log('  [ошибка страницы] ' + (e && e.message)));
const dom = new JSDOM(html, { url:'https://x.dev/', runScripts:'dangerously', pretendToBeVisual:true, virtualConsole:vc });
const w = dom.window;
w.alert = function(){}; w.confirm = function(){ return true; }; w.scrollTo = function(){};
w.localStorage.setItem('moff_crm_token', 'test');
w.localStorage.setItem('moff_crm_view', 'board');

function jr(obj){ return Promise.resolve({ ok:true, json: () => Promise.resolve(obj) }); }
w.fetch = function(url, opts){
  const u = String(url);
  if (opts && opts.method === 'POST') return jr({ ok:true, orders:[], fin:[], changes:[], tasks:[] });
  if (u.indexOf('action=orders') >= 0)    return jr({ ok:true, orders:ORDERS });
  if (u.indexOf('action=fin') >= 0)       return jr({ ok:true, fin:FIN });
  if (u.indexOf('action=recur') >= 0)     return jr({ ok:true, recur:RECUR });
  if (u.indexOf('action=employees') >= 0) return jr({ ok:true, employees:EMP });
  if (u.indexOf('action=') >= 0) return jr({ ok:true, orders:[], fin:[], changes:[], tasks:[], employees:[], dop:[], attachments:[], recl:[], stock:[], recur:[], templates:[], statuses:[] });
  return Promise.reject(new Error('offline'));
};
for (const src of [mainJs, crmJs]) {
  const s = w.document.createElement('script');
  s.textContent = src;
  w.document.body.appendChild(s);
}

// Достаёт число из плитки с заданной подписью (.crm-sum-t: .v значение, .k подпись)
function tile(label){
  const d = w.document;
  let found = null;
  d.querySelectorAll('.crm-sum-t').forEach(t => {
    const k = t.querySelector('.k'), v = t.querySelector('.v');
    if (k && v && k.textContent.indexOf(label) >= 0 && found === null) found = v.textContent;
  });
  return found;
}
// Убирает пробелы-разделители и знак валюты -> число
function num(s){
  if (s === null || s === undefined) return null;
  // crm.js печатает минус как U+2212, а не ASCII '-' — иначе знак теряется
  const neg = String(s).indexOf('\u2212') >= 0 || String(s).indexOf('-') >= 0;
  const t = String(s).replace(/[^0-9]/g, '');
  if (t === '') return null;
  return (neg ? -1 : 1) * parseInt(t, 10);
}
// ВАЖНО: только контейнер СРМ. document.body включает скрытую страницу
// калькулятора, и поиск по ней даёт ложные совпадения.
function bodyText(){
  const r = w.document.getElementById('crm-root');
  // toLocaleString('ru-RU') разделяет разряды НЕРАЗРЫВНЫМ пробелом U+00A0 —
  // поиск по обычному пробелу не нашёл бы ничего никогда.
  return r ? (r.textContent || '').replace(/\u00A0/g, ' ') : '';
}

function openFin(sub, cb){
  w.eval('page("crm")');
  setTimeout(function(){
    const btns = [...w.document.querySelectorAll('button')];
    const bFin = btns.find(b => b.textContent === 'Финансы');
    if (!bFin) { console.log('  [!] кнопка «Финансы» не найдена'); cb(); return; }
    bFin.click();
    setTimeout(function(){
      const sb = [...w.document.querySelectorAll('button')].find(b => b.textContent === sub);
      if (sb) sb.click();
      setTimeout(cb, 500);
    }, 500);
  }, 700);
}

setTimeout(function(){
  console.log('\u2500\u2500 Финансы: средний чек должен быть одинаковым на всех вкладках \u2500\u2500');
  openFin('Продажи', function(){
    const salesAvg  = num(tile('средний чек'));
    const salesRev  = num(tile('выручка по договорам'));
    const salesRecv = num(tile('получено'));
    const salesTxt  = bodyText();

    openFin('Аналитика', function(){
      const anaAvg = num(tile('средний чек'));
      const anaCnt = num(tile('договоров всего'));

      // № 46 — единственная настоящая сделка: 302 040₸.
      // №1 (0₸), №7 (Отказ) и №9 (без даты договора) в средний чек по
      // месяцу попадать не должны ни на одной из вкладок.
      ok(salesAvg === anaAvg,
        'средний чек совпадает на «Продажах» и «Аналитике» (было 302040 против 151020)');
      ok(anaCnt === 1,
        '«Аналитика»: заказ на 0\u20B8 и отказ не считаются договорами (договоров = 1)');
      ok(salesAvg === 302040,
        'средний чек = 302 040\u20B8 — по одной реальной сделке месяца');

      // №7 — Отказ на 500 000₸: не должен попадать в выручку нигде.
      ok(salesRev !== null && salesRev !== 1002040,
        'отказной договор на 500 000\u20B8 не попал в выручку');
      // №9 — согласованная цена есть, даты договора нет: деньги не теряем.
      ok(salesRev === 502040,
        'выручка = 502 040\u20B8 — заказ без даты договора не потерян (302 040 + 200 000)');
      ok(salesTxt.indexOf('без даты договора') >= 0,
        'заказ с ценой, но без даты договора показан явно, а не пропал молча');
      // Предоплата 50 000₸ по №9 — реальные деньги, прятать нельзя.
      ok(salesRecv === 352040,
        'получено = 352 040\u20B8 — по сделкам, без 30 000 по заказу с несогласованной ценой');
      ok(salesTxt.indexOf('30 000') >= 0 || salesTxt.indexOf('30000') >= 0,
        'предоплата 30 000\u20B8 вне договора показана отдельно, а не потеряна');

      console.log('');
      console.log('\u2500\u2500 Касса: итог месяца не должен врать на неначисленные обязательства \u2500\u2500');
      openFin('Касса', function(){
        const txt = bodyText();
        const net = num(tile('чистый доход месяца'));
        const exp = num(tile('расход за месяц'));

        // Приход 302 040. Обязательства месяца: аренда 350 000 + оклады
        // 350 000 = 700 000, ничего не начислено. Честный итог -397 960,
        // а не +302 040.
        ok(net === -397960,
          'чистый доход месяца = \u2212397 960\u20B8 с учётом неначисленных аренды и окладов');
        ok(txt.indexOf('700 000') >= 0 || txt.indexOf('700000') >= 0,
          'на экране видно, что не начислено обязательств на 700 000\u20B8');
        ok(txt.indexOf('45 306') >= 0 || txt.indexOf('45306') >= 0,
          'процент мастеров за месяц (45 306\u20B8) показан как отдельная неначисленная сумма');

        // Битая строка с пустым типом не должна тихо уходить в расход.
        ok(/неопознанн|неизвестн|битый тип операции/i.test(txt),
          'операция с неопознанным типом помечена как проблема данных');
        ok(exp === 0,
          'битая операция на 9 999\u20B8 не утекла молча в расход месяца');

        console.log('');
        console.log('\u0418\u0422\u041e\u0413 (\u0444\u0438\u043d\u0430\u043d\u0441\u044b): ' + PASS + ' \u043f\u0440\u043e\u0448\u043b\u043e, ' + FAIL + ' \u0443\u043f\u0430\u043b\u043e');
        process.exit(FAIL ? 1 : 0);
      });
    });
  });
}, 900);
