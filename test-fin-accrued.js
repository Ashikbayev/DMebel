// Обратный сценарий к test-fin.js (v4.14): месяц НАЧИСЛЕН.
// Проверяет, что новая проверка обязательств не создаёт вечного
// предупреждения и не вычитает аренду/оклады повторно — иначе честный
// итог превратился бы в занижающий, а красную плашку перестали бы читать.
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
    earnMaster:0, earnDesigner:0, masterId:'', helperId:'', helperPay:0, updated:D }
];
const RECUR = [
  { id:'r1', name:'Аренда Офиса', cat:'Аренда', sum:100000, active:true },
  { id:'r2', name:'Аренда Цеха',  cat:'Аренда', sum:250000, active:true }
];
const EMP = [
  { id:'e1', name:'Дали',  role:'Дизайнер', salary:200000, active:true, helperRate:0 },
  { id:'e2', name:'Серик', role:'Мастер',   salary:150000, active:true, helperRate:0 }
];
// Приход 302 040 + ВСЕ обязательства проведены с теми же тегами, что
// проставляет accrueMonth_ в Code.gs: '[Постоянные ГГГГ-ММ #id] Имя'.
const FIN = [
  { id:'f1', date:D, type:'Приход', cat:'Аванс',   sum:151020, num:'46', comment:'Аванс по договору' },
  { id:'f2', date:D, type:'Приход', cat:'Доплата', sum:151020, num:'46', comment:'' },
  { id:'a1', date:D, type:'Расход', cat:'Аренда', sum:100000, num:'', comment:'[Постоянные ' + MONTH + ' #r1] Аренда Офиса' },
  { id:'a2', date:D, type:'Расход', cat:'Аренда', sum:250000, num:'', comment:'[Постоянные ' + MONTH + ' #r2] Аренда Цеха' },
  { id:'a3', date:D, type:'Расход', cat:'Оплата дизайнеру', sum:200000, num:'', comment:'[Оклад ' + MONTH + ' #e1] Дали' },
  { id:'a4', date:D, type:'Расход', cat:'Оплата мастеру',   sum:150000, num:'', comment:'[Оклад ' + MONTH + ' #e2] Серик' }
];

const vc = new VirtualConsole();
vc.on('jsdomError', e => console.log('  [ошибка страницы] ' + (e && e.message)));
const dom = new JSDOM(html, { url:'https://x.dev/', runScripts:'dangerously', pretendToBeVisual:true, virtualConsole:vc });
const w = dom.window;
w.alert = function(){}; w.confirm = function(){ return true; }; w.scrollTo = function(){};
w.localStorage.setItem('moff_crm_token', 'test');
w.localStorage.setItem('moff_crm_view', 'board');
function jr(o){ return Promise.resolve({ ok:true, json: () => Promise.resolve(o) }); }
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
function tile(label){
  let found = null;
  w.document.querySelectorAll('.crm-sum-t').forEach(t => {
    const k = t.querySelector('.k'), v = t.querySelector('.v');
    if (k && v && k.textContent.indexOf(label) >= 0 && found === null) found = v.textContent;
  });
  return found;
}
function num(s){
  if (s === null || s === undefined) return null;
  const neg = String(s).indexOf('\u2212') >= 0 || String(s).indexOf('-') >= 0;
  const t = String(s).replace(/[^0-9]/g, '');
  if (t === '') return null;
  return (neg ? -1 : 1) * parseInt(t, 10);
}
function crmText(){
  const r = w.document.getElementById('crm-root');
  return r ? (r.textContent || '').replace(/\u00A0/g, ' ') : '';
}

setTimeout(function(){
  w.eval('page("crm")');
  setTimeout(function(){
    const bFin = [...w.document.querySelectorAll('button')].find(b => b.textContent === 'Финансы');
    if (bFin) bFin.click();
    setTimeout(function(){
      const bK = [...w.document.querySelectorAll('button')].find(b => b.textContent === 'Касса');
      if (bK) bK.click();
      setTimeout(function(){
        const inc = num(tile('приход за месяц'));
        const exp = num(tile('расход за месяц'));
        const net = num(tile('чистый доход месяца'));
        const txt = crmText();

        ok(inc === 302040, 'приход за месяц = 302 040\u20B8');
        ok(exp === -700000, 'расход за месяц = 700 000\u20B8 (плитка печатает со знаком минус) — начисленные проводки видны');
        // 302 040 − 700 000 = −397 960. Ровно столько же, сколько в
        // test-fin.js БЕЗ начисления: честный итог не зависит от того,
        // нажата кнопка или нет. Это и есть смысл правки.
        ok(net === -397960, 'чистый доход = \u2212397 960\u20B8 — тот же, что и без начисления');
        ok(!/\u041d\u0435 \u043d\u0430\u0447\u0438\u0441\u043b\u0435\u043d\u043e \u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u0441\u0442\u0432/.test(txt),
          'предупреждение о недостаче НЕ показано — месяц полностью начислен');
        ok(!/\u043c\u0430\u0441\u0442\u0435\u0440\u0430\u043c \u0437\u0430 \u0437\u0430\u043a\u0430\u0437\u044b \u043c\u0435\u0441\u044f\u0446\u0430/.test(txt),
          'строки про процент мастеров нет — в этом месяце он нулевой');

        console.log('');
        console.log('\u0418\u0422\u041e\u0413 (\u043d\u0430\u0447\u0438\u0441\u043b\u0435\u043d\u043d\u044b\u0439 \u043c\u0435\u0441\u044f\u0446): ' + PASS + ' \u043f\u0440\u043e\u0448\u043b\u043e, ' + FAIL + ' \u0443\u043f\u0430\u043b\u043e');
        process.exit(FAIL ? 1 : 0);
      }, 600);
    }, 600);
  }, 700);
}, 900);
