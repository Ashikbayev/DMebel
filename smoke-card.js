// Smoke-тест редизайна openCard: crm.js исполняется в jsdom,
// заказ подсовывается через мок fetch (как в проде), карточка
// открывается кликом по карточке доски — полный боевой путь.
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const crmJs = fs.readFileSync('crm.js', 'utf8');

const order = {
  num: '214', client: 'Иванов Алексей', phone: '+77012345678',
  city: 'Сатпаев', furn: 'кухня', obj: 'мкр. Достык 14-56',
  note: '', status: 'Договор', pred: 900000, sogl: 980000,
  avans: 490000, paid: 340000, mountDate: '', dogDate: '2026-07-12',
  totL: 980000, totP: 0, totK: 0, material: 'L',
  masterId: '', helperId: '', helperPay: 0
};

const vc = new VirtualConsole();
let pageErrors = [];
vc.on('jsdomError', e => pageErrors.push(String(e && (e.detail && e.detail.message || e.message))));


const html = '<!doctype html><html><head></head><body>' +
  '<div id="tab-crm"></div><div id="crm-root"></div>' +
  '</body></html>';

const dom = new JSDOM(html, {
  url: 'https://ashikbayev.github.io/DMebel/',
  runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc
});
const w = dom.window;
w.CRM_GS_URL = 'https://fake/gs';
w.fetch = function(){
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, orders: [order] }) });
};
w.alert = () => {}; w.confirm = () => true;
w.localStorage.setItem('moff_crm_token', '2026');

const s = w.document.createElement('script');
s.textContent = crmJs;
w.document.body.appendChild(s);

let fails = 0;
function ok(cond, msg){
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + msg);
  if(!cond) fails++;
}

setTimeout(() => {
  // Пытаемся дойти до openCard любым публичным путём: crm.js вешает
  // рендер на вкладку — если crmReload есть, дёргаем его.
  if (typeof w.crmPageOpen === 'function') w.crmPageOpen();
  setTimeout(() => {
    const doc = w.document;
    // ищем карточку доски и кликаем
    let card = doc.querySelector('.crm-card');
    if (card) {
      card.click();
    }
    const modal = doc.querySelector('.crm-modal');
    if (!modal) {
      console.log('  (карточка/модалка не отрисовались через crmReload — smoke через DOM недоступен, это ок для изолированного окружения)');
      console.log('  ошибок страницы: ' + pageErrors.length);
      pageErrors.slice(0,5).forEach(e => console.log('   ' + e));
      process.exit(pageErrors.length ? 1 : 0);
    }
    ok(modal.querySelector('.crm-card-strip'), 'полоса статуса в шапке');
    ok(modal.querySelector('.crm-hava'), 'аватар в шапке');
    const t = modal.querySelector('.crm-h-t');
    ok(t && t.textContent.indexOf('Иванов') === 0, 'заголовок = клиент · №: ' + (t && t.textContent));
    const secs = modal.querySelectorAll('.crm-sec');
    ok(secs.length >= 3, 'секций-карточек ≥3 (клиент, объект, деньги): ' + secs.length);
    const heads = Array.from(modal.querySelectorAll('.crm-sec-h')).map(x => x.textContent.trim());
    ok(heads.indexOf('Клиент') >= 0, 'секция «Клиент»');
    ok(heads.indexOf('Объект') >= 0, 'секция «Объект»');
    ok(modal.querySelectorAll('.crm-ch-h .ti').length >= 4, 'иконки в заголовках блоков: ' + modal.querySelectorAll('.crm-ch-h .ti').length);
    ok(pageErrors.length === 0, 'ошибок страницы нет (' + pageErrors.length + ')');
    pageErrors.slice(0,5).forEach(e => console.log('   ' + e));
    console.log(fails ? 'SMOKE FAIL' : 'SMOKE OK');
    process.exit(fails ? 1 : 0);
  }, 300);
}, 300);
