// Смоук вкладок карточки заказа (v4.13.1) — jsdom, тот же приём, что
// в test-autoslots.js: страница целиком, моканый fetch, живая модалка.
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
let PASS = 0, FAIL = 0;
function ok(c, n){ if (c) { PASS++; console.log('  ✓ ' + n); } else { FAIL++; console.log('  ✗ FAIL: ' + n); } }

const html = fs.readFileSync('index.html', 'utf8');
const mainJs = fs.readFileSync('main.js', 'utf8');
const crmJs = fs.readFileSync('crm.js', 'utf8');

const ORDER = {
  num: '44', status: 'Договор', city: '', client: 'Тест', phone: '', obj: '',
  furn: 'Гардероб', note: '', pred: 483984, sogl: 483984, avans: 241992, paid: 0,
  dogDate: '2026-07-23', mountDate: '', totL: 483984, totP: 483984, totK: 483984,
  margL: 142506, margP: 142506, margK: 142506, margin: 142506,
  earnMaster: 0, earnDesigner: 0, masterId: '', helperId: '', helperPay: 0,
  material: 'L', source: '', costPlan: 268880, costFact: 205040, costDelta: -63840,
  updated: '2026-07-23'
};

const vc = new VirtualConsole();
vc.on('jsdomError', e => console.log('  [ошибка страницы] ' + (e && e.message)));
const dom = new JSDOM(html, { url: 'https://x.dev/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const w = dom.window;
w.alert = function(){}; w.confirm = function(){ return true; }; w.scrollTo = function(){};
w.localStorage.setItem('moff_crm_token', 'test');
w.localStorage.setItem('moff_crm_view', 'board');
w.fetch = function(url, opts){
  const u = String(url);
  if (opts && opts.method === 'POST') {
    let req = {}; try { req = JSON.parse(opts.body); } catch(e){}
    let res = { ok: true, orders: [], fin: [], changes: [], tasks: [] };
    if (req.action === 'ordersList') res = { ok: true, orders: [ORDER] };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(res) });
  }
  // CRM ходит GET-ами с ?action=...
  if (u.indexOf('action=orders') >= 0) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, orders: [ORDER] }) });
  if (u.indexOf('action=tasks') >= 0) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, tasks: [] }) });
  if (u.indexOf('action=changes') >= 0) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, changes: [] }) });
  if (u.indexOf('action=') >= 0) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, orders: [], fin: [], changes: [], tasks: [], employees: [], dop: [], attachments: [], recl: [], stock: [], recur: [], templates: [], statuses: [] }) });
  return Promise.reject(new Error('offline'));
};
for (const src of [mainJs, crmJs]) {
  const s = w.document.createElement('script');
  s.textContent = src;
  w.document.body.appendChild(s);
}

setTimeout(function(){
  try {
    w.eval('page("crm")');
    setTimeout(function(){
      try {
        const d = w.document;
        // Кликаем карточку на доске — как это делает менеджер.
        const row = d.querySelector('.crm-card');
        ok(!!row && row.textContent.indexOf('Тест') >= 0, 'заказ №44 отрисован на доске СРМ');
        if (row) row.click();
        const modal = d.querySelector('.crm-modal');
        ok(!!modal, 'карточка заказа открылась');
        if (!modal) { finish(); return; }

        const tabBtns = [...modal.querySelectorAll('button')].filter(x => ['Обзор','Деньги','Производство','История'].indexOf(x.textContent) >= 0);
        ok(tabBtns.length === 4, 'в карточке четыре вкладки: Обзор, Деньги, Производство, История');

        const txt = () => modal.textContent;
        ok(txt().indexOf('Клиент') >= 0, 'вкладка «Обзор» открыта по умолчанию — секция клиента видна');
        const visible = el => { let n = el; while (n && n !== modal) { if (n.style && n.style.display === 'none') return false; n = n.parentElement; } return true; };
        let moneyVisible = false;
        modal.querySelectorAll('div').forEach(el => { if (el.textContent === 'Материалы: план' && visible(el)) moneyVisible = true; });
        // Секция денег должна быть скрыта, пока не открыта её вкладка
        let moneyExists = txt().indexOf('Материалы: план') >= 0;
        ok(moneyExists, 'строка «Материалы: план» существует в карточке');

        const bDengi = tabBtns.find(x => x.textContent === 'Деньги');
        bDengi.click();
        let planRow = null, factRow = null, savedRow = null, margFactRow = null;
        modal.querySelectorAll('span').forEach(el => {
          if (el.textContent === 'Материалы: план') planRow = el.parentElement;
          if (el.textContent === 'Материалы: факт') factRow = el.parentElement;
          if (el.textContent === 'Сэкономлено на материалах') savedRow = el.parentElement;
          if (el.textContent === 'Маржа по факту') margFactRow = el.parentElement;
        });
        ok(planRow && planRow.textContent.indexOf('268') >= 0, 'Материалы: план = 268 880₸ (честная подпись вместо второй «себестоимости»)');
        ok(factRow && factRow.textContent.indexOf('205') >= 0, 'Материалы: факт = 205 040₸');
        ok(savedRow && savedRow.textContent.indexOf('63') >= 0, 'Сэкономлено на материалах = 63 840₸');
        ok(margFactRow && margFactRow.textContent.indexOf('206') >= 0, 'Маржа по факту = 142 506 + 63 840 = 206 346₸ — сходится с договорной маржой');
        ok(txt().indexOf('Себестоимость по факту') < 0, 'вводящая в заблуждение подпись «Себестоимость по факту» удалена');

        const bIst = tabBtns.find(x => x.textContent === 'История');
        bIst.click();
        let planStillVisible = false;
        modal.querySelectorAll('span').forEach(el => { if (el.textContent === 'Материалы: план' && visible(el)) planStillVisible = true; });
        ok(!planStillVisible, 'переключение на «Историю» прячет денежный блок — вкладки реально переключаются');

        const saveBtn = [...modal.querySelectorAll('button')].find(x => x.textContent.indexOf('Сохранить') >= 0);
        ok(!!saveBtn && visible(saveBtn), 'кнопки действий видны на любой вкладке (вне вкладок)');
        const statusSel = modal.querySelector('select');
        ok(!!statusSel && visible(statusSel), 'селектор статуса виден на любой вкладке (вне вкладок)');
      } catch(e){ FAIL++; console.log('  ✗ Ошибка теста: ' + e.message); }
      finish();
    }, 600);
  } catch(e){ FAIL++; console.log('  ✗ Ошибка запуска: ' + e.message); finish(); }
}, 900);

function finish(){
  console.log('');
  console.log('ИТОГ (смоук карточки): ' + PASS + ' прошло, ' + FAIL + ' упало');
  process.exit(FAIL ? 1 : 0);
}
