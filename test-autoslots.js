// ============================================================
// Интеграционный тест: Code.gs (реальный doGet, мок SpreadsheetApp)
//   → data → мок fetch → index.html + main.js в jsdom.
// Проверяем: авто-слоты из колонки «Авто», цены слотов, инертность
// пустых слотов, деньги при вводе кол-ва, сценарий перезагрузки
// (черновик: getSnap → чистый DOM → applySnap → сверка копейка в
// копейку), fullReset → шаблон заново, лимит 10 слотов.
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const DIR = __dirname;
let PASS = 0, FAIL = 0;
function ok(cond, name){ if(cond){PASS++;console.log('  ✓ '+name);} else {FAIL++;console.log('  ✗ FAIL: '+name);} }
// toLocaleString("ru") ставит неразрывный пробел (U+00A0/U+202F) — нормализуем перед сравнением
function norm(s){ return String(s).replace(/[\u00A0\u202F]/g,' '); }

// ─────────────────────────────────────────────────────────────
// 1) МОК SpreadsheetApp: листы «Базы Расчёта» с колонками «Авто»
// ─────────────────────────────────────────────────────────────
function MockSheet(rows){ this.rows = rows; }
MockSheet.prototype.getDataRange = function(){ const rs=this.rows; return { getValues: function(){ return rs.map(r=>r.slice()); } }; };
MockSheet.prototype.getRange = function(a1){
  // только адресация 'D2'/'E2' (ЛДСП) нужна для doGet
  const col = a1.charCodeAt(0) - 65, row = parseInt(a1.slice(1),10) - 1;
  const rs = this.rows;
  return { getValue: function(){ return (rs[row]||[])[col]; } };
};
function MockSS(sheets){ this.sheets = sheets; }
MockSS.prototype.getSheetByName = function(n){ return this.sheets[n] || null; };

const SHEETS = {
  'ЛДСП': new MockSheet([
    ['Название','Цена','', 'ХДФ','Кромка'],
    ['Эггер Дуб', 18500, '', 9000, 200],
    ['Ламарти Белый', 14200, '', '', ''],
  ]),
  'Фасад_Плёнка': new MockSheet([['Название','Цена'],['Плёнка мат', 32100]]),
  'Фасад_Краска': new MockSheet([['Название','Цена'],['Краска глянец', 41000]]),
  // Фурнитура: 5-я колонка «Авто», 6-я (v3.4) «Артикул» → sku.
  // Петля полувнешний En-7 → 2 слота, Телескоп 500мм En-7 → 1 слот.
  'Фурнитура': new MockSheet([
    ['Категория','Вид','Фирма','Цена','Авто','Артикул'],
    ['Петля','полувнешний','En-7', 320, 2, 'F-PET-EN7'],
    ['Петля','полувнешний','GTV', 670, ''],
    ['Петля','внутренний','En-7', 320, ''],
    ['Телескоп','500мм','En-7', 2500, 1, ''],
    ['Телескоп','500мм','GTV', 8000, '', 'F-TEL-GTV'],
    ['Газлифт','—','En-7', 500, ''],
  ]),
  // Кухня: 4-я колонка «Авто» (без Фирмы), 5-я (v3.4) «Артикул».
  'Кухня': new MockSheet([
    ['Категория','Вид','Цена','Авто','Артикул'],
    ['Плинтус','черный', 2000, 1, 'K-PLINT-B'],
    ['Плинтус','белый', 2000, ''],
    ['Сушилка','900мм', 8500, ''],
  ]),
  // Шкаф: НОВЫЙ лист, 5 колонок. Крючки → 1 слот; строка с Авто=99
  // проверяет лимит 10; пустая строка проверяет фильтр. Пантограф —
  // ловушка Дали: «—» ВЫШЕ Серого + числовой вид 123 (Таблица отдаёт числом).
  'Шкаф': new MockSheet([
    ['Категория','Вид','Фирма','Цена','Авто','Артикул'],
    ['Крючки','3','—', 600, 1],
    ['Штанга-Хром','—','—', 2000, ''],
    ['Турникет-Хром','250мм','—', 480, 99],
    ['Пантограф','—','—', 15000, ''],
    ['Пантограф','Серый','—', 25000, '', 'S-PANT-GREY'],
    ['Пантограф','Черный','—', 15000, ''],
    ['Пантограф', 123, '—', 123, ''],
    ['', '', '', '', ''],
  ]),
  'Подсветка': new MockSheet([['Категория','Вид','Цена'],['Лента','тёплая', 3000]]),
  'Работы': new MockSheet([['Наименование','Цена'],['Распил', 5000],['Сборка', 15000]]),
  'Витрина': new MockSheet([
    ['Ключ','Значение'],
    ['Стекло Бронза', 9000],['Профиль узкий', 2000],['Профиль широкий', 3000],
    ['Уголок узкий', 1500],['Уголок широкий', 2000],['Навес', 1000],['Присадка', 1500],['Уплотнитель', 400],
  ]),
};

// ─────────────────────────────────────────────────────────────
// 2) РЕАЛЬНЫЙ Code.gs в песочнице → data (как отдаёт сервер)
// ─────────────────────────────────────────────────────────────
let capturedJson = null;
const gsCtx = {
  SpreadsheetApp: { getActiveSpreadsheet: function(){ return new MockSS(SHEETS); } },
  ContentService: {
    MimeType: { JSON: 'json', JAVASCRIPT: 'js' },
    createTextOutput: function(txt){ capturedJson = txt; return { setMimeType: function(){ return {}; } }; }
  },
  LockService: { getScriptLock: function(){ return { waitLock:function(){}, releaseLock:function(){} }; } },
  console: console,
};
vm.createContext(gsCtx);
vm.runInContext(fs.readFileSync(path.join(DIR,'Code.gs'),'utf8'), gsCtx);
vm.runInContext('doGet({parameter:{}})', gsCtx);
const serverData = JSON.parse(capturedJson);

console.log('── Сервер (Code.gs v2.1) ──');
ok(Array.isArray(serverData.shk), 'data.shk присутствует');
ok(serverData.shk.length === 7, 'пустая строка листа Шкаф отфильтрована (7 позиций)');
ok(serverData.furn[0].auto === 2 && serverData.furn[1].auto === 0, 'furn.auto читается из колонки E');
ok(serverData.kuh[0].auto === 1 && serverData.kuh[1].auto === 0, 'kuh.auto читается из колонки D');
ok(serverData.shk[0].auto === 1 && serverData.shk[2].auto === 99, 'shk.auto читается из колонки E');
ok(typeof serverData.shk[6].vid === 'number', 'числовой вид приезжает с сервера ЧИСЛОМ (сценарий ловушки)');
ok(serverData.hingeCatalog.length === 2, 'hingeCatalog для 3D не сломан (En-7, GTV)');

// ─────────────────────────────────────────────────────────────
// 3) Загрузка страницы в jsdom с моком fetch на данных сервера
// ─────────────────────────────────────────────────────────────
const html = fs.readFileSync(path.join(DIR,'index.html'),'utf8');
const mainJs = fs.readFileSync(path.join(DIR,'main.js'),'utf8');

function bootPage(storage, opts){
  opts = opts || {};
  // ВАЖНО: main.js исполняется НАСТОЯЩИМ <script>-тегом, а не w.eval().
  // Верхнеуровневые let/const (DB, appReady…) из eval живут только внутри
  // самого eval и снаружи невидимы; из <script> они попадают в глобальную
  // лексическую среду окна — и последующие w.eval() их видят, как в браузере.
  const vc = new VirtualConsole();
  vc.on('jsdomError', function(e){
    const d = e && e.detail && e.detail.stack ? e.detail.stack.split('\n').slice(0,3).join(' | ') : (e && e.message);
    console.log('  [ошибка страницы] ' + d);
  });
  const dom = new JSDOM(html, {
    url: 'https://ashikbayev.github.io/DMebel/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const w = dom.window;
  // localStorage: переносим между «перезагрузками»
  if (storage) {
    for (const k of Object.keys(storage)) w.localStorage.setItem(k, storage[k]);
  }
  // мок fetch: любые запросы к Apps Script → данные реального Code.gs
  if (opts.failFetch) {
    w.fetch = function(){ return Promise.reject(new Error('offline')); };
  } else {
    w.fetch = function(){ return Promise.resolve({ ok: true, json: function(){ return Promise.resolve(serverData); } }); };
  }
  w.alert = function(){}; w.confirm = function(){ return true; }; w.print = function(){}; w.scrollTo = function(){};
  w.open = function(){ return { document: { write: function(){}, close: function(){} }, focus: function(){}, print: function(){} }; };
  const s = w.document.createElement('script');
  s.textContent = mainJs;
  w.document.body.appendChild(s);
  return dom;
}

function waitReady(dom, tries){
  return new Promise((resolve, reject) => {
    let n = 0;
    const t = setInterval(() => {
      n++;
      if (dom.window.eval('typeof appReady!=="undefined"&&appReady===true')) { clearInterval(t); resolve(); }
      else if (n > (tries||100)) { clearInterval(t); reject(new Error('appReady не наступил')); }
    }, 30);
  });
}

(async function(){
  // ── Сценарий А: чистый старт, черновика нет ──
  const domA = bootPage(null);
  await waitReady(domA);
  const dA = domA.window.document;
  const gv = (id) => { const e = dA.getElementById(id); return e ? e.value : undefined; };

  console.log('── v3.2: успешная загрузка — кэш и live ──');
  ok(domA.window.eval('pricesSource') === 'live', 'pricesSource = live при успешной загрузке');
  const cacheStrA = domA.window.localStorage.getItem('mebeloff_prices_cache');
  ok(!!cacheStrA, 'кэш цен записан в localStorage');
  const cacheObjA = JSON.parse(cacheStrA || '{}');
  ok(cacheObjA.ts > 0 && cacheObjA.data && cacheObjA.data.ldsp && cacheObjA.data.ldsp[0].n === 'Эггер Дуб', 'кэш содержит ts и данные сервера');
  ok(dA.getElementById('price-banner') === null, 'баннера на live нет');

  console.log('── Клиент: чистый старт — авто-слоты ──');
  const furnRows = dA.querySelectorAll('#furn-list select[id^="furnc"]').length;
  const kuhRows  = dA.querySelectorAll('#kuh-list select[id^="kuhc"]').length;
  const shkRows  = dA.querySelectorAll('#shk-list select[id^="shkc"]').length;
  ok(furnRows === 3, 'Фурнитура общая: 3 авто-слота (Петля×2 + Телескоп×1), факт ' + furnRows);
  ok(kuhRows === 1, 'Фурнитура кухня: 1 авто-слот (Плинтус), факт ' + kuhRows);
  ok(shkRows === 11, 'Шкаф: 1 + лимит 10 при Авто=99 → 11 слотов, факт ' + shkRows);
  ok(gv('furnc0') === 'Петля' && gv('furnc1') === 'Петля' && gv('furnc2') === 'Телескоп', 'категории слотов выставлены');
  ok(gv('furnv0') === 'полувнешний', 'вид слота Петли = полувнешний');
  ok(gv('furnf0') === 'En-7', 'фирма слота Петли = En-7');
  ok(gv('furnv2') === '500мм' && gv('furnf2') === 'En-7', 'Телескоп 500мм En-7');
  ok(dA.getElementById('furnpp0').textContent.indexOf('320') === 0, 'цена слота Петли 320₸');
  ok(gv('kuhc0') === 'Плинтус' && gv('kuhv0') === 'черный', 'Кухня: Плинтус черный');
  ok(gv('shkc0') === 'Крючки', 'Шкаф: слот Крючки с листа (не из запасного списка)');
  ok((gv('furnq0')||'') === '' && (gv('kuhq0')||'') === '', 'кол-во слотов пустое');
  ok(!dA.getElementById('cb-furn').classList.contains('op') && !dA.getElementById('cb-kuh').classList.contains('op') && !dA.getElementById('cb-shk').classList.contains('op'), 'разделы с авто-слотами СВЁРНУТЫ на чистом старте');

  // финансовая инертность: суммы разделов нулевые, слоты не в КП
  domA.window.eval('recalc()');
  const sFurn = dA.getElementById('s-furn').textContent;
  ok(sFurn === '0₸', 'сумма раздела при пустых слотах = 0₸, факт ' + sFurn);
  ok(domA.window.eval('cIt("furn").length') === 0, 'cIt: пустые слоты не попадают в КП');
  ok(dA.getElementById('s-furn').classList.contains('filled') === false, 'бейдж суммы не подсвечен');

  // деньги: Петля слот 0 → 21 шт × 320 = 6 720
  dA.getElementById('furnq0').value = '21';
  domA.window.eval('recalc()');
  ok(norm(dA.getElementById('s-furn').textContent) === '6 720₸', 'Петля 21×320 = 6 720₸ в шапке раздела');
  ok(domA.window.eval('cIt("furn").length') === 1, 'в КП попала ровно 1 позиция');
  ok(domA.window.eval('cIt("furn")[0].q') === 21, 'кол-во в КП = 21');
  ok(dA.getElementById('s-furn').classList.contains('filled') === true, 'бейдж суммы подсвечен (filled)');
  ok(dA.getElementById('furnr0').classList.contains('hl') === true, 'строка Петли с кол-вом ПОДСВЕЧЕНА (hl)');
  ok(dA.getElementById('furnr1').classList.contains('hl') === false, 'соседний пустой слот НЕ подсвечен');

  // Телескоп слот: 3 × 2500 = 7500; итого раздела 14 220
  dA.getElementById('furnq2').value = '3';
  domA.window.eval('recalc()');
  ok(norm(dA.getElementById('s-furn').textContent) === '14 220₸', '6 720 + 3×2 500 = 14 220₸');

  // Кухня: Плинтус 2 × 2000 = 4000
  dA.getElementById('kuhq0').value = '2';
  domA.window.eval('recalc()');
  ok(norm(dA.getElementById('s-kuh').textContent) === '4 000₸', 'Кухня: 2×2 000 = 4 000₸');

  // «+ Добавить» после шаблона: индексы продолжаются, не конфликтуют
  domA.window.eval('addCat("furn",DB.furn,"furn-list")');
  ok(dA.getElementById('furnc3') !== null, '«+ Добавить» создаёт слот с индексом 3 после шаблонных');

  // ── Сценарий Дали: Пантограф — джокер «—» и числовой вид ──
  console.log('── Клиент: цены Пантографа (баг Дали) ──');
  domA.window.eval('addCat("shk",DB.shk,"shk-list")');
  const pi = domA.window.eval('ST.shk.length-1');
  dA.getElementById('shkc'+pi).value = 'Пантограф';
  domA.window.eval('uC("shk",'+pi+')');
  dA.getElementById('shkv'+pi).value = 'Серый';
  domA.window.eval('uCP("shk",'+pi+')');
  ok(norm(dA.getElementById('shkpp'+pi).textContent) === '25 000₸', 'Пантограф Серый = 25 000₸ (джокер «—» не перехватил), факт ' + norm(dA.getElementById('shkpp'+pi).textContent));
  dA.getElementById('shkq'+pi).value = '1';
  domA.window.eval('recalc()');
  ok(domA.window.eval('ST.shk['+pi+'].p') === 25000, 'uCP записал 25 000 в состояние — именно отсюда берут деньги КП и расчёт');
  ok(norm(dA.getElementById('s-shk').textContent) === '25 000₸', 'сумма раздела Шкаф = 25 000₸ (1 шт), факт ' + norm(dA.getElementById('s-shk').textContent));
  ok(domA.window.eval('cIt("shk").find(x=>x.n.indexOf("Серый")>=0).q') === 1, 'позиция «Пантограф Серый» попала в КП');
  dA.getElementById('shkv'+pi).value = '123';
  domA.window.eval('uCP("shk",'+pi+')');
  ok(norm(dA.getElementById('shkpp'+pi).textContent) === '123₸', 'числовой вид 123 → цена 123₸, факт ' + norm(dA.getElementById('shkpp'+pi).textContent));
  dA.getElementById('shkv'+pi).value = '—';
  domA.window.eval('uCP("shk",'+pi+')');
  ok(norm(dA.getElementById('shkpp'+pi).textContent) === '15 000₸', 'выбран сам «—» → честные 15 000₸');
  // убрать тестовый слот, чтобы не влиять на сценарии дальше
  domA.window.eval('ST.shk['+pi+']=null');
  dA.getElementById('shkq'+pi).value = '';
  domA.window.eval('recalc()');

  // ── Сценарий Б: перезагрузка страницы с черновиком ──
  domA.window.eval('saveDraft()');
  const draftStr = domA.window.localStorage.getItem('mebeloff_draft');
  ok(!!draftStr, 'черновик сохранён');
  const totalBefore = domA.window.eval('JSON.stringify({f:$("s-furn").textContent,k:$("s-kuh").textContent,tot:$("il-tot").textContent})');

  console.log('── Клиент: перезагрузка (черновик) ──');
  const domB = bootPage({ 'mebeloff_draft': draftStr });
  await waitReady(domB);
  const dB = domB.window.document;
  domB.window.eval('recalc()');
  const totalAfter = domB.window.eval('JSON.stringify({f:$("s-furn").textContent,k:$("s-kuh").textContent,tot:$("il-tot").textContent})');
  ok(totalBefore === totalAfter, 'итоги после перезагрузки совпали копейка в копейку: ' + totalAfter);
  ok(dB.getElementById('furnq0').value === '21', 'кол-во Петли (21) пережило перезагрузку');
  ok(dB.getElementById('furnr0').classList.contains('hl') === true, 'подсветка строки пережила перезагрузку');
  const furnRowsB = dB.querySelectorAll('#furn-list select[id^="furnc"]').length;
  ok(furnRowsB === 4, 'после перезагрузки слоты не задвоились (4 = 3 шаблонных + 1 добавленный), факт ' + furnRowsB);

  // ── Сценарий В: fullReset → шаблон заново, деньги в ноль ──
  console.log('── Клиент: Новый расчёт ──');
  domB.window.eval('tog("furn");tog("kuh")');
  ok(dB.getElementById('cb-furn').classList.contains('op'), 'разделы открыты вручную перед сбросом');
  domB.window.eval('fullReset()');
  ok(!dB.getElementById('cb-furn').classList.contains('op') && !dB.getElementById('cb-kuh').classList.contains('op'), 'fullReset: разделы свёрнуты, стрелки сброшены: ' + !dB.getElementById('ar-furn').classList.contains('op'));
  const dRows = dB.querySelectorAll('#furn-list select[id^="furnc"]').length;
  ok(dRows === 3, 'fullReset: шаблон перерисован (3 слота), факт ' + dRows);
  ok(dB.getElementById('s-furn').textContent === '0₸', 'fullReset: сумма раздела 0₸');
  ok((dB.getElementById('furnq0').value||'') === '', 'fullReset: кол-во пустое');
  ok(dB.getElementById('furnr0').classList.contains('hl') === false, 'fullReset: подсветка погасла');

  // ── Сценарий Г: пустой data.shk не убивает раздел (защита length) ──
  console.log('── Клиент: защита от пустого листа Шкаф ──');
  const shkBackup = serverData.shk;
  serverData.shk = [];
  const domC = bootPage(null);
  await waitReady(domC);
  ok(domC.window.eval('DB.shk.length') > 0, 'data.shk=[] → остался запасной список (' + domC.window.eval('DB.shk.length') + ' поз.)');
  serverData.shk = shkBackup;

  // ── Сценарий Д (v3.2): отказ сети + кэш есть ──
  console.log('── v3.2: отказ сети, кэш ЕСТЬ ──');
  const domD = bootPage({ 'mebeloff_prices_cache': cacheStrA }, { failFetch: true });
  await waitReady(domD);
  const dD = domD.window.document;
  ok(domD.window.eval('pricesSource') === 'cache', 'pricesSource = cache');
  ok(domD.window.eval('DB.ldsp[0].n') === 'Эггер Дуб', 'цены взяты ИЗ КЭША: Эггер Дуб (в fallback его нет вообще)');
  ok(domD.window.eval('DB.ldsp[0].p') === 18500, 'конкретная цена из кэша 18 500 (fallback дал бы Бежевый 20 000)');
  const banD = dD.getElementById('price-banner');
  ok(!!banD, 'несмываемый баннер показан');
  ok(!!banD && banD.textContent.indexOf('из кэша') >= 0, 'баннер говорит «цены из кэша» с датой: ' + (banD ? banD.textContent.replace('Повторить','').trim() : ''));
  const btnD = banD ? banD.querySelector('button') : null;
  ok(!!btnD && btnD.textContent === 'Повторить', 'кнопка «Повторить» на месте');

  // защита денег: КП спрашивает confirm, отказ блокирует
  domD.window.eval('recalc()');
  let dConfirmCalls = 0, dConfirmAnswer = false;
  domD.window.confirm = function(){ dConfirmCalls++; return dConfirmAnswer; };
  domD.window.eval('showKP()');
  ok(dConfirmCalls === 1, 'формирование КП спросило confirm');
  ok(dD.getElementById('kp-doc').innerHTML === '', 'confirm=false: КП НЕ сформировано');
  dConfirmAnswer = true;
  domD.window.eval('showKP()');
  ok(dD.getElementById('kp-doc').innerHTML.length > 0, 'confirm=true: КП сформировано');

  // защита денег: договор при отказе не формируется (окно печати не открывается)
  let dOpened = 0;
  domD.window.open = function(){ dOpened++; return { document: { write: function(){}, close: function(){} }, focus: function(){}, print: function(){} }; };
  dConfirmAnswer = false;
  domD.window.eval('generateDogovor()');
  ok(dOpened === 0, 'confirm=false: договор НЕ формируется');

  // ── Сценарий Е (v3.2): отказ сети + кэша НЕТ ──
  console.log('── v3.2: отказ сети, кэша НЕТ ──');
  const domE = bootPage(null, { failFetch: true });
  await waitReady(domE);
  const dE = domE.window.document;
  ok(domE.window.eval('pricesSource') === 'fallback', 'pricesSource = fallback');
  ok(domE.window.eval('DB.ldsp[0].n') === 'Бежевый', 'работаем на зашитых резервных ценах');
  const banE = dE.getElementById('price-banner');
  ok(!!banE && banE.textContent.indexOf('РЕЗЕРВНЫЕ') >= 0, 'баннер предупреждает о РЕЗЕРВНЫХ ценах');
  const bgE = banE ? String(banE.style.background) : '';
  ok(bgE === '#C0392B' || bgE.indexOf('192, 57, 43') >= 0, 'баннер красный, факт ' + bgE);
  // на live-старте confirm не спрашивается: контрольная проверка на сценарии А
  let aConfirmCalls = 0;
  domA.window.confirm = function(){ aConfirmCalls++; return true; };
  domA.window.eval('showKP()');
  ok(aConfirmCalls === 0, 'на live КП формируется БЕЗ confirm');

  // ── Сценарий Ж (v3.3): дубли позиций в прайсе ──
  console.log('── v3.3: дубли в прайсе (оставить последнюю цену) ──');
  // контроль: на чистых данных (сценарий А) массив не тронут, тоста нет
  ok(domA.window.eval('DB.furn.length') === serverData.furn.length, 'без дублей: DB.furn не сокращён (' + serverData.furn.length + ' поз.)');
  ok(dA.getElementById('dupe-warn') === null, 'без дублей: предупреждения нет');

  // юнит: deduplicatePriceList напрямую
  const unitRes = domA.window.eval('JSON.stringify(deduplicatePriceList([' +
    '{cat:"Петля",vid:"полувнешний",firm:"En-7",p:320},' +
    '{cat:"Петля",vid:"внутренний",firm:"En-7",p:320},' +
    '{cat:"Петля",vid:"полувнешний",firm:"En-7",p:350}' +
    '], ["cat","vid","firm"]))');
  const unit = JSON.parse(unitRes);
  ok(unit.clean.length === 2, 'юнит: 3 строки с дублем → 2, факт ' + unit.clean.length);
  ok(unit.clean[0].p === 350, 'юнит: дубль замещён последней ценой 350 НА МЕСТЕ первой (порядок сохранён)');
  ok(unit.clean[1].vid === 'внутренний', 'юнит: соседняя строка не задета');
  ok(unit.dupes.length === 1 && unit.dupes[0].count === 2 && unit.dupes[0].keptPrice === 350, 'юнит: dupes = [{×2, keptPrice:350}]');

  // интеграция: сервер отдаёт дубль → клиент чистит и предупреждает
  const furnBackup = serverData.furn;
  serverData.furn = furnBackup.concat([{cat:'Телескоп', vid:'500мм', firm:'GTV', p:8500, auto:0}]);
  const domG = bootPage(null);
  await waitReady(domG);
  const dG = domG.window.document;
  ok(domG.window.eval('DB.furn.length') === furnBackup.length, 'дубль удалён из DB.furn: ' + domG.window.eval('DB.furn.length') + ' поз. вместо ' + serverData.furn.length);
  ok(domG.window.eval('fRow(DB.furn,"Телескоп","500мм","GTV").p') === 8500, 'fRow отдаёт ПОСЛЕДНЮЮ цену дубля: 8500 (не 8000)');
  const warnG = dG.getElementById('dupe-warn');
  ok(!!warnG, 'предупреждение о дублях показано');
  ok(!!warnG && warnG.textContent.indexOf('Дубли в прайсе') >= 0 && warnG.textContent.indexOf('Телескоп') >= 0, 'текст называет позицию: ' + (warnG ? warnG.textContent : ''));
  // авто-слоты не пострадали: Петля×2 + Телескоп×1 как раньше
  const furnRowsG = dG.querySelectorAll('#furn-list select[id^="furnc"]').length;
  ok(furnRowsG === 3, 'авто-слоты после дедупликации целы: 3, факт ' + furnRowsG);
  serverData.furn = furnBackup;

  // ── Сценарий З (v3.4): SKU/артикулы ──
  console.log('── v3.4: SKU/артикулы ──');
  // сервер: колонка «Артикул» → поле sku, пустая ячейка → ''
  ok(serverData.furn[0].sku === 'F-PET-EN7', 'furn.sku читается из колонки F');
  ok(serverData.furn[2].sku === '', 'пустой артикул → sku = "" (строка без колонки)');
  ok(serverData.kuh[0].sku === 'K-PLINT-B', 'kuh.sku читается из колонки E');
  ok(serverData.shk[4].sku === 'S-PANT-GREY', 'shk.sku читается из колонки F');
  // клиент: sku доехал до DB
  ok(domA.window.eval('sv(DB.furn[0].sku)') === 'F-PET-EN7', 'DB.furn несёт sku');

  // снимок: строка Пантограф/Серый (артикул задан) пишет sku в снимок
  const domS = bootPage(null);
  await waitReady(domS);
  domS.window.eval('addCat("shk", DB.shk, "shk-list")');
  const si = domS.window.eval('ST.shk.length') - 1;
  domS.window.eval('document.getElementById("shkc' + si + '").value="Пантограф";uC("shk",' + si + ')');
  domS.window.eval('document.getElementById("shkv' + si + '").value="Серый";uCP("shk",' + si + ')');
  domS.window.eval('document.getElementById("shkq' + si + '").value="2";recalc()');
  const recS = JSON.parse(domS.window.eval('JSON.stringify({ST:ST,snap:getSnap()})'));
  ok(recS.snap['shksku' + si] === 'S-PANT-GREY', 'getSnap пишет SKU позиции в снимок');
  ok(recS.snap['shkv' + si] === 'Серый', 'текстовые значения в снимке остались (обратная совместимость)');

  // переименование в таблице: Серый → Графит. Снимок с SKU восстанавливается
  // на НОВОЕ имя с ВЕРНОЙ ценой; снимок без SKU — по-старому (тихий промах).
  const shkBackup2 = serverData.shk;
  serverData.shk = shkBackup2.map(function(r){
    if (r.sku === 'S-PANT-GREY') return Object.assign({}, r, { vid: 'Графит' });
    return r;
  });
  const domR = bootPage(null);
  await waitReady(domR);
  domR.window.eval('applySnap(' + JSON.stringify(recS) + ')');
  const dR = domR.window.document;
  const gvR = function(id){ const e = dR.getElementById(id); return e ? e.value : undefined; };
  ok(gvR('shkc' + si) === 'Пантограф' && gvR('shkv' + si) === 'Графит', 'снимок с SKU пережил переименование: вид = Графит');
  ok(dR.getElementById('shkpp' + si).textContent.indexOf('25 000') === 0 || norm(dR.getElementById('shkpp' + si).textContent).indexOf('25 000') === 0, 'цена после переименования верная: 25 000₸');
  ok(gvR('shkq' + si) === '2', 'кол-во строки восстановлено');

  // тот же снимок БЕЗ sku на переименованном прайсе — текст «Серый» не найден,
  // select падает на первый вид. Документируем сегодняшнее поведение,
  // которое SKU и лечит (предупреждение — отдельный долг).
  const recOld = JSON.parse(JSON.stringify(recS));
  delete recOld.snap['shksku' + si];
  const domO = bootPage(null);
  await waitReady(domO);
  domO.window.eval('applySnap(' + JSON.stringify(recOld) + ')');
  const dO = domO.window.document;
  const vO = dO.getElementById('shkv' + si) ? dO.getElementById('shkv' + si).value : undefined;
  ok(vO !== 'Графит' && vO !== 'Серый', 'без SKU переименование НЕ переживается (select упал на первый вид: ' + vO + ')');
  serverData.shk = shkBackup2;

  // старый снимок без sku на НЕизменённом прайсе — работает как раньше
  const domC4 = bootPage(null);
  await waitReady(domC);
  domC4.window.eval('applySnap(' + JSON.stringify(recOld) + ')');
  const dC2 = domC4.window.document;
  ok(dC2.getElementById('shkv' + si) && dC2.getElementById('shkv' + si).value === 'Серый', 'старый снимок без SKU на прежних именах восстановился как раньше');

  // дубль артикула на двух РАЗНЫХ позициях → предупреждение (ничего не удаляется)
  serverData.shk = shkBackup2.concat([{cat:'Полка', vid:'доп', firm:'—', p: 100, auto: 0, sku: 'F-PET-EN7'}]);
  const domD4 = bootPage(null);
  await waitReady(domD);
  const dD4 = domD4.window.document;
  const warnD = dD4.getElementById('dupe-warn');
  ok(!!warnD && warnD.textContent.indexOf('Артикул задублирован') >= 0 && warnD.textContent.indexOf('F-PET-EN7') >= 0, 'дубль артикула: предупреждение показано и называет SKU');
  ok(domD4.window.eval('DB.shk.length') === serverData.shk.length, 'дубль артикула НЕ удаляет позиции (обе живы)');
  serverData.shk = shkBackup2;

  // ── Сценарий И (v3.6): Склад — агрегация, валидация, закупщик ──
  console.log('\u2500\u2500 v3.6: \u0421\u043a\u043b\u0430\u0434 (\u0430\u0433\u0440\u0435\u0433\u0430\u0446\u0438\u044f, \u0432\u0430\u043b\u0438\u0434\u0430\u0446\u0438\u044f, \u0441\u043f\u0438\u0441\u043e\u043a \u0437\u0430\u043a\u0443\u043f\u0449\u0438\u043a\u0443) \u2500\u2500');

  // (1) Code.gs stockAgg_ — чистая агрегация в песочнице сервера
  var st_moves = [
    {type:'\u041f\u0440\u0438\u0445\u043e\u0434', key:'F-PET-EN7', name:'\u041f\u0435\u0442\u043b\u044f', unit:'\u0448\u0442', qty:10},
    {type:'\u0420\u0430\u0441\u0445\u043e\u0434', key:'F-PET-EN7', name:'\u041f\u0435\u0442\u043b\u044f', unit:'\u0448\u0442', qty:3},
    {type:'\u041f\u0440\u0438\u0445\u043e\u0434', key:'\u0413\u0440\u0430\u0444\u0438\u0442', name:'\u0413\u0440\u0430\u0444\u0438\u0442', unit:'\u043b\u0438\u0441\u0442', qty:5},
    {type:'\u0420\u0430\u0441\u0445\u043e\u0434', key:'\u0413\u0440\u0430\u0444\u0438\u0442', name:'\u0413\u0440\u0430\u0444\u0438\u0442', unit:'\u043b\u0438\u0441\u0442', qty:2}
  ];
  var st_agg = JSON.parse(vm.runInContext('JSON.stringify(stockAgg_(' + JSON.stringify(st_moves) + '))', gsCtx));
  var st_find = function(res, key){ return res.stock.filter(function(x){ return x.key === key; })[0]; };
  ok(st_agg.ok === true, 'stockAgg_ вернул ok');
  ok(st_find(st_agg,'F-PET-EN7') && st_find(st_agg,'F-PET-EN7').qty === 7, 'Приход 10 − Расход 3 = 7 (штуки)');
  ok(st_find(st_agg,'\u0413\u0440\u0430\u0444\u0438\u0442') && st_find(st_agg,'\u0413\u0440\u0430\u0444\u0438\u0442').qty === 3, 'листы: 5 − 2 = 3');
  ok(Number.isInteger(st_find(st_agg,'\u0413\u0440\u0430\u0444\u0438\u0442').qty), 'остаток целый');

  // (2) Code.gs validateStockMove_ — правила движения
  var st_val = function(m){ return vm.runInContext('validateStockMove_(' + JSON.stringify(m) + ')', gsCtx); };
  ok(st_val({type:'\u041f\u0440\u0438\u0445\u043e\u0434', key:'X', unit:'\u0448\u0442', qty:3}) === '', 'валидное движение принято');
  ok(st_val({type:'\u041f\u0440\u0438\u0445\u043e\u0434', key:'X', unit:'\u0448\u0442', qty:1.5}) !== '', 'дробное кол-во отклонено');
  ok(st_val({type:'\u041f\u0440\u0438\u0445\u043e\u0434', key:'X', unit:'\u0448\u0442', qty:0}) !== '', 'нулевое кол-во отклонено');
  ok(st_val({type:'\u041a\u043e\u0440\u0440\u0435\u043a\u0446\u0438\u044f', key:'X', unit:'\u0448\u0442', qty:3}) !== '', 'неверный тип отклонён (только Приход/Расход)');
  ok(st_val({type:'\u0420\u0430\u0441\u0445\u043e\u0434', key:'', unit:'\u0448\u0442', qty:3}) !== '', 'пустой ключ отклонён');
  ok(st_val({type:'\u041f\u0440\u0438\u0445\u043e\u0434', key:'X', unit:'\u043c\u00b2', qty:3}) !== '', 'единица м² отклонена (только шт/лист)');

  // (3) Клиент orderPurchase — снимок + прайс + остатки → закупщику
  var st_snap = {
    furnc0:'\u041f\u0435\u0442\u043b\u044f', furnv0:'\u043f\u043e\u043b\u0443\u0432\u043d\u0435\u0448\u043d\u0438\u0439', furnf0:'En-7', furnq0:'10', furnsku0:'F-PET-EN7',
    furnc1:'\u0413\u0430\u0437\u043b\u0438\u0444\u0442', furnv1:'\u2014', furnf1:'En-7', furnq1:'3',
    furnc2:'\u0422\u0435\u043b\u0435\u0441\u043a\u043e\u043f', furnv2:'500\u043c\u043c', furnf2:'GTV', furnq2:'1', furnsku2:'F-TEL-GTV',
    svetc0:'\u041b\u0435\u043d\u0442\u0430', svetv0:'\u0442\u0451\u043f\u043b\u0430\u044f', svetf0:'\u2014', svetq0:'2',
    ls0:'0', lq0:'1.25',
    fldsps0:'0', fldspq0:'0.5'
  };
  var st_db = { ldsp:[{n:'\u0413\u0440\u0430\u0444\u0438\u0442', p:20000}], fas_plen:[{n:'\u041f\u043b\u0451\u043d\u043a\u0430 \u043c\u0430\u0442', p:32000}], fas_kr:[{n:'\u041a\u0440\u0430\u0441\u043a\u0430', p:40000}] };
  var st_stock = [
    {key:'F-PET-EN7', qty:4, unit:'\u0448\u0442', name:'\u041f\u0435\u0442\u043b\u044f'},
    {key:'F-TEL-GTV', qty:5, unit:'\u0448\u0442', name:'\u0422\u0435\u043b\u0435\u0441\u043a\u043e\u043f'},
    {key:'\u0413\u0440\u0430\u0444\u0438\u0442', qty:1, unit:'\u043b\u0438\u0441\u0442', name:'\u0413\u0440\u0430\u0444\u0438\u0442'}
  ];
  var st_call = 'JSON.stringify(orderPurchase(' + JSON.stringify(st_snap) + ',' + JSON.stringify(st_db) + ',' + JSON.stringify(st_stock) + '))';
  var st_pr = JSON.parse(domA.window.eval(st_call));
  var st_t = function(key){ return st_pr.tracked.filter(function(x){ return x.key === key; })[0]; };
  var st_uHas = function(sub){ return st_pr.untracked.some(function(u){ return String(u.n).indexOf(sub) >= 0; }); };

  var st_pet = st_t('F-PET-EN7');
  ok(st_pet && st_pet.need === 10 && st_pet.have === 4 && st_pet.buy === 6 && st_pet.unit === '\u0448\u0442', 'фурнитура с SKU: нужно 10, есть 4 → докупить 6');
  var st_tel = st_t('F-TEL-GTV');
  ok(st_tel && st_tel.need === 1 && st_tel.have === 5 && st_tel.buy === 0, 'есть с запасом → докупить 0 (не уходит в минус)');
  var st_mat = st_t('\u0413\u0440\u0430\u0444\u0438\u0442');
  ok(st_mat && Math.abs(st_mat.need - 1.75) < 1e-9 && st_mat.unit === '\u043b\u0438\u0441\u0442', 'материал (корпус+фасад): нужно 1.25 + 0.5 = 1.75 листа');
  ok(st_mat && st_mat.have === 1 && st_mat.buy === 1, 'листы: докупить = ceil(1.75)=2 − 1 = 1 (обрезки не учитываем)');
  ok(st_uHas('\u0413\u0430\u0437\u043b\u0438\u0444\u0442'), 'позиция без SKU → раздел «без учёта»');
  ok(st_uHas('\u041b\u0435\u043d\u0442\u0430'), 'свет (нет SKU) → раздел «без учёта»');
  ok(!st_pr.tracked.some(function(x){ return String(x.key).indexOf('\u0413\u0430\u0437\u043b\u0438\u0444\u0442') >= 0; }), 'позиция без SKU НЕ попала в складской учёт');

  // (4) stockMap — массив остатков сервера → карта по ключу
  var st_map = JSON.parse(domA.window.eval('JSON.stringify(stockMap(' + JSON.stringify(st_stock) + '))'));
  ok(st_map['F-PET-EN7'] && st_map['F-PET-EN7'].qty === 4, 'stockMap: остаток по ключу');
  ok(st_map['\u0413\u0440\u0430\u0444\u0438\u0442'] && st_map['\u0413\u0440\u0430\u0444\u0438\u0442'].unit === '\u043b\u0438\u0441\u0442', 'stockMap: единица сохранена');


  // ─────────────────────────────────────────────────────────────
  // v4.0: Вложения — addAttach_/delAttach_/attachList_ (Code.gs)
  // Диск и записываемый лист замоканы объектами Node, проброшенными
  // в песочницу через gsCtx: проверяем валидацию, запись строки,
  // расшаривание файла, подпапку заказа и корзину при удалении.
  // ─────────────────────────────────────────────────────────────
  console.log('── v4.0: Вложения (фото и заметки к заказам) ──');
  var attRows = [];
  var attSheet = {
    getLastRow: function(){ return attRows.length + 1; },
    setFrozenRows: function(){},
    deleteRow: function(row){ attRows.splice(row - 2, 1); },
    getRange: function(row, col, numRows, numCols){
      return {
        setValue: function(v){
          var r = row - 2;
          while(attRows.length <= r) attRows.push([]);
          attRows[r][col - 1] = v;
          return this;
        },
        getValue: function(){
          var r = attRows[row - 2] || [];
          return r[col - 1] === undefined ? '' : r[col - 1];
        },
        getValues: function(){
          var out = [];
          for(var i = 0; i < (numRows || 1); i++){
            var src = attRows[row - 2 + i] || [];
            var line = [];
            for(var j = 0; j < (numCols || 1); j++) line.push(src[col - 1 + j] === undefined ? '' : src[col - 1 + j]);
            out.push(line);
          }
          return out;
        },
        setValues: function(){ return this; },
        setFontWeight: function(){ return this; }
      };
    }
  };
  var attHasSheet = false;
  gsCtx.__attSS = {
    getSheetByName: function(){ return attHasSheet ? attSheet : null; },
    insertSheet: function(){ attHasSheet = true; return attSheet; }
  };
  var drive = { files: {}, trashed: [], shared: [], folders: {}, nextId: 1 };
  function mkFolder(name){
    return {
      getFoldersByName: function(sub){
        var f = drive.folders[name + '/' + sub];
        return { hasNext: function(){ return !!f; }, next: function(){ return f; } };
      },
      createFolder: function(sub){
        var nf = mkFolder(name + '/' + sub);
        drive.folders[name + '/' + sub] = nf;
        return nf;
      },
      createFile: function(blob){
        var id = 'FILE' + (drive.nextId++);
        drive.files[id] = { name: blob && blob.name };
        return {
          setSharing: function(){ drive.shared.push(id); },
          getId: function(){ return id; }
        };
      }
    };
  }
  gsCtx.DriveApp = {
    Access: { ANYONE_WITH_LINK: 'link' },
    Permission: { VIEW: 'view' },
    getFoldersByName: function(n){
      var f = drive.folders[n];
      return { hasNext: function(){ return !!f; }, next: function(){ return f; } };
    },
    createFolder: function(n){
      var f = mkFolder(n);
      drive.folders[n] = f;
      return f;
    },
    getFileById: function(id){
      if(!drive.files[id]) throw new Error('нет файла');
      return { setTrashed: function(){ drive.trashed.push(id); } };
    }
  };
  gsCtx.Utilities = {
    base64Decode: function(s){
      if(!/^[A-Za-z0-9+/=]+$/.test(String(s))) throw new Error('bad base64');
      return [1, 2, 3];
    },
    newBlob: function(bytes, mime, name){ return { bytes: bytes, mime: mime, name: name }; }
  };
  var att = function(expr){ return JSON.parse(vm.runInContext('JSON.stringify(' + expr + ')', gsCtx)); };

  var at1 = att("addAttach_(__attSS, { kind:'файл', dataB64:'aGVsbG8=' })");
  ok(at1.ok === false && String(at1.error).indexOf('\u2116') >= 0, 'вложение без № заказа отклонено');
  var at2 = att("addAttach_(__attSS, { num:'77', kind:'файл' })");
  ok(at2.ok === false, 'файл без данных отклонён');
  var at3 = att("addAttach_(__attSS, { num:'77', kind:'файл', mime:'video/mp4', dataB64:'aGVsbG8=' })");
  ok(at3.ok === false && String(at3.error).indexOf('фото') >= 0, 'видео отклонено (v1 — только фото)');
  var at4 = att("addAttach_(__attSS, { num:'77', kind:'файл', mime:'image/jpeg', dataB64:'@@@не base64@@@' })");
  ok(at4.ok === false && String(at4.error).indexOf('повреждён') >= 0, 'битый base64 отклонён');
  var at5 = att("addAttach_(__attSS, { num:'77', kind:'файл', mime:'image/jpeg', dataB64: new Array(8000002).join('A') })");
  ok(at5.ok === false && String(at5.error).indexOf('большой') >= 0, 'слишком большой файл отклонён (base64 > 8 млн символов)');

  var at6 = att("addAttach_(__attSS, { num:'77', kind:'файл', name:'замер.jpg', mime:'image/jpeg', dataB64:'aGVsbG8=', comment:'фото замера' })");
  ok(at6.ok === true && at6.fileId === 'FILE1', 'валидное фото сохранено, fileId вернулся');
  ok(drive.shared.indexOf('FILE1') >= 0, 'файл расшарен по ссылке (для миниатюр)');
  ok(!!drive.folders['MebelOFF Вложения/Заказ \u211677'], 'файл лёг в подпапку «Заказ №77»');

  var at7 = att("addAttach_(__attSS, { num:'77', kind:'коммент', comment:'' })");
  ok(at7.ok === false, 'пустая заметка отклонена');
  var at8 = att("addAttach_(__attSS, { num:'77', kind:'коммент', comment:'позвонить в среду' })");
  ok(at8.ok === true && at8.fileId === '', 'заметка сохранена без файла');

  var atList = att("attachList_(__attSS)");
  ok(atList.ok === true && atList.attach.length === 2, 'attachList_ вернул обе записи');
  ok(atList.attach[0].kind === 'файл' && atList.attach[0].fileId === 'FILE1' && atList.attach[0].comment === 'фото замера', 'запись файла: kind/fileId/подпись на месте');
  ok(atList.attach[1].kind === 'коммент' && atList.attach[1].num === '77', 'запись заметки: kind/№ на месте');

  var at9 = att("delAttach_(__attSS, '" + at6.id + "')");
  ok(at9.ok === true, 'удаление фото прошло');
  ok(drive.trashed.indexOf('FILE1') >= 0, 'файл ушёл в корзину Диска');
  var atList2 = att("attachList_(__attSS)");
  ok(atList2.attach.length === 1 && atList2.attach[0].kind === 'коммент', 'в листе осталась только заметка');
  var at10 = att("delAttach_(__attSS, 'нет-такого')");
  ok(at10.ok === false, 'удаление несуществующего id отклонено');

  // ─────────────────────────────────────────────────────────────
  // v4.0: Клиентская страница — clientLink_/clientStatus_ (Code.gs)
  // Проверяем: выдачу и стабильность ключа, доступ по верному ключу,
  // отказ по неверному/пустому и что срез НЕ содержит личных данных.
  // ─────────────────────────────────────────────────────────────
  console.log('── v4.0: Клиентская страница статуса ──');
  var ordRows = [
    ['77','Сборка','Сатпаев','Иван Иванов','87071234567','ул. Мира 1','Кухня','', 500000, 630000, 300000, 0, 330000, '2026-06-15', '2026-07-20'],
    ['78','Замер','Сатпаев','Пётр','87070000000','','Шкаф-купе','', 0, 0, 0, 0, 0, '', '']
  ];
  var ordSheet = {
    getLastRow: function(){ return ordRows.length + 1; },
    setFrozenRows: function(){},
    hideColumns: function(){},
    deleteRow: function(row){ ordRows.splice(row - 2, 1); },
    getRange: function(row, col, numRows, numCols){
      return {
        setValue: function(v){
          var r = row - 2;
          while(ordRows.length <= r) ordRows.push([]);
          ordRows[r][col - 1] = v;
          return this;
        },
        getValue: function(){
          var r = ordRows[row - 2] || [];
          return r[col - 1] === undefined ? '' : r[col - 1];
        },
        getValues: function(){
          var out = [];
          for(var i = 0; i < (numRows || 1); i++){
            var src = ordRows[row - 2 + i] || [];
            var line = [];
            for(var j = 0; j < (numCols || 1); j++) line.push(src[col - 1 + j] === undefined ? '' : src[col - 1 + j]);
            out.push(line);
          }
          return out;
        },
        setValues: function(){ return this; },
        setFontWeight: function(){ return this; }
      };
    }
  };
  var cliAttRows = [];
  var cliAttSheet = {
    getLastRow: function(){ return cliAttRows.length + 1; },
    setFrozenRows: function(){},
    deleteRow: function(row){ cliAttRows.splice(row - 2, 1); },
    getRange: function(row, col, numRows, numCols){
      return {
        setValue: function(v){ var r = row - 2; while(cliAttRows.length <= r) cliAttRows.push([]); cliAttRows[r][col - 1] = v; return this; },
        getValue: function(){ var r = cliAttRows[row - 2] || []; return r[col - 1] === undefined ? '' : r[col - 1]; },
        getValues: function(){ var out = []; for(var i = 0; i < (numRows || 1); i++){ var src = cliAttRows[row - 2 + i] || []; var line = []; for(var j = 0; j < (numCols || 1); j++) line.push(src[col - 1 + j] === undefined ? '' : src[col - 1 + j]); out.push(line); } return out; },
        setValues: function(){ return this; },
        setFontWeight: function(){ return this; }
      };
    }
  };
  var cliSlogRows = [];
  var cliSlogSheet = {
    getLastRow: function(){ return cliSlogRows.length + 1; },
    setFrozenRows: function(){},
    deleteRow: function(row){ cliSlogRows.splice(row - 2, 1); },
    getRange: function(row, col, numRows, numCols){
      return {
        setValue: function(v){ var r = row - 2; while(cliSlogRows.length <= r) cliSlogRows.push([]); cliSlogRows[r][col - 1] = v; return this; },
        getValue: function(){ var r = cliSlogRows[row - 2] || []; return r[col - 1] === undefined ? '' : r[col - 1]; },
        getValues: function(){ var out = []; for(var i = 0; i < (numRows || 1); i++){ var src = cliSlogRows[row - 2 + i] || []; var line = []; for(var j = 0; j < (numCols || 1); j++) line.push(src[col - 1 + j] === undefined ? '' : src[col - 1 + j]); out.push(line); } return out; },
        setValues: function(){ return this; },
        setFontWeight: function(){ return this; }
      };
    }
  };
  gsCtx.__ordSS = {
    getSheetByName: function(n){
      if(n === 'Заказы') return ordSheet;
      if(n === 'Вложения') return cliAttSheet;
      if(n === 'Статусы') return cliSlogSheet;
      return null;
    },
    insertSheet: function(n){
      if(n === 'Вложения') return cliAttSheet;
      if(n === 'Статусы') return cliSlogSheet;
      return ordSheet;
    }
  };

  var cl1 = att("clientLink_(__ordSS, '999')");
  ok(cl1.ok === false, 'ключ для несуществующего заказа не выдан');
  var cl2 = att("clientLink_(__ordSS, '77')");
  ok(cl2.ok === true && String(cl2.key).length === 20, 'ключ выдан (20 символов)');
  var cl3 = att("clientLink_(__ordSS, '77')");
  ok(cl3.ok === true && cl3.key === cl2.key, 'повторный запрос вернул ТОТ ЖЕ ключ (ссылка стабильна)');

  var cs1 = att("clientStatus_(__ordSS, '77', '" + cl2.key + "')");
  ok(cs1.ok === true && cs1.order.status === 'Сборка' && cs1.order.furn === 'Кухня', 'верный ключ: статус и тип мебели отдаются');
  var csKeys = Object.keys(cs1.order).sort().join(',');
  ok(csKeys === 'dogDate,furn,history,mountDate,num,photos,status', 'срез безопасен: только num/status/furn/даты/фото/история, без телефона, имени и денег');
  var cs2 = att("clientStatus_(__ordSS, '77', 'wrong-key')");
  ok(cs2.ok === false, 'неверный ключ отклонён');
  var cs3 = att("clientStatus_(__ordSS, '78', 'anything')");
  ok(cs3.ok === false, 'заказ без выданного ключа недоступен (пустой ключ не совпадает ни с чем)');

  // Фото на клиентской странице: флаг «Клиенту» (pubAttach_)
  var pA = att("addAttach_(__ordSS, { num:'77', kind:'файл', name:'zamer.jpg', mime:'image/jpeg', dataB64:'aGVsbG8=', comment:'Фото замера' })");
  var pB = att("addAttach_(__ordSS, { num:'77', kind:'файл', name:'work.jpg', mime:'image/jpeg', dataB64:'aGVsbG8=', comment:'внутреннее' })");
  var pC = att("addAttach_(__ordSS, { num:'78', kind:'файл', name:'other.jpg', mime:'image/jpeg', dataB64:'aGVsbG8=' })");
  var pl0 = att("attachList_(__ordSS)");
  ok(pl0.attach.length === 3 && pl0.attach[0].pub === false && pl0.attach[2].pub === false, 'новое фото по умолчанию скрыто от клиента');
  ok(att("pubAttach_(__ordSS, 'нет-такого', true)").ok === false, 'переключение флага по неверному id отклонено');
  var pt = att("pubAttach_(__ordSS, '" + pA.id + "', true)");
  var pl1 = att("attachList_(__ordSS)");
  ok(pt.ok === true && pl1.attach[0].pub === true && pl1.attach[1].pub === false, 'флаг «Клиенту» переключается и сохраняется');
  att("pubAttach_(__ordSS, '" + pC.id + "', true)");
  var cs4 = att("clientStatus_(__ordSS, '77', '" + cl2.key + "')");
  ok(cs4.ok === true && cs4.order.photos.length === 1 && cs4.order.photos[0].fileId === pA.fileId && cs4.order.photos[0].comment === 'Фото замера', 'клиент видит ТОЛЬКО помеченные фото СВОЕГО заказа (с подписью)');
  var pt2 = att("pubAttach_(__ordSS, '" + pA.id + "', false)");
  var cs5 = att("clientStatus_(__ordSS, '77', '" + cl2.key + "')");
  ok(pt2.ok === true && cs5.order.photos.length === 0, 'снятие флага убирает фото со страницы клиента');

  // Журнал статусов (logStatus_/statusLogList_ + интеграция updateOrder_)
  var run = function(expr){ vm.runInContext(expr, gsCtx); };
  run("logStatus_(__ordSS, '77', 'Сборка')");
  run("logStatus_(__ordSS, '77', 'Сборка')");
  var sl0 = att("statusLogList_(__ordSS)");
  ok(sl0.ok === true && sl0.slog.length === 1, 'повторный тот же статус НЕ дублируется в журнале');
  run("logStatus_(__ordSS, '77', 'Установка')");
  run("logStatus_(__ordSS, '77', 'Сборка')");
  var sl1 = att("statusLogList_(__ordSS)");
  ok(sl1.slog.length === 3 && sl1.slog[2].status === 'Сборка', 'возврат на прежний этап (А→Б→А) логируется честно');
  var uo = att("updateOrder_(__ordSS, { num:'77', status:'Доделки' })");
  var sl2 = att("statusLogList_(__ordSS)");
  ok(uo.ok === true && sl2.slog.length === 4 && sl2.slog[3].status === 'Доделки', 'updateOrder_ со сменой статуса пишет переход в журнал');
  att("updateOrder_(__ordSS, { num:'77', status:'Доделки' })");
  var sl3 = att("statusLogList_(__ordSS)");
  ok(sl3.slog.length === 4, 'updateOrder_ с тем же статусом журнал не мусорит');
  var cs6 = att("clientStatus_(__ordSS, '77', '" + cl2.key + "')");
  ok(cs6.ok === true && !!cs6.order.history && !!cs6.order.history['Доделки'], 'история переходов отдаётся клиентской странице');
  ok(cs6.order.history['Договор'] === '2026-06-15', 'дата Договора для старого заказа берётся из карточки (фолбэк)');

  // ─────────────────────────────────────────────────────────────
  // v4.0: Склад — stockMove_/delStockMove_/saveStockMin_ (Code.gs)
  // ─────────────────────────────────────────────────────────────
  console.log('── v4.0: Склад — движения, удаление, минимумы ──');
  var stRows = [];
  var stSheet = {
    getLastRow: function(){ return stRows.length + 1; },
    setFrozenRows: function(){},
    deleteRow: function(row){ stRows.splice(row - 2, 1); },
    getRange: function(row, col, numRows, numCols){
      return {
        setValue: function(v){ var r = row - 2; while(stRows.length <= r) stRows.push([]); stRows[r][col - 1] = v; return this; },
        getValue: function(){ var r = stRows[row - 2] || []; return r[col - 1] === undefined ? '' : r[col - 1]; },
        getValues: function(){ var out = []; for(var i = 0; i < (numRows || 1); i++){ var src = stRows[row - 2 + i] || []; var line = []; for(var j = 0; j < (numCols || 1); j++) line.push(src[col - 1 + j] === undefined ? '' : src[col - 1 + j]); out.push(line); } return out; },
        setValues: function(){ return this; },
        setFontWeight: function(){ return this; }
      };
    }
  };
  var smRows = [];
  var smSheet = {
    getLastRow: function(){ return smRows.length + 1; },
    setFrozenRows: function(){},
    deleteRow: function(row){ smRows.splice(row - 2, 1); },
    getRange: function(row, col, numRows, numCols){
      return {
        setValue: function(v){ var r = row - 2; while(smRows.length <= r) smRows.push([]); smRows[r][col - 1] = v; return this; },
        getValue: function(){ var r = smRows[row - 2] || []; return r[col - 1] === undefined ? '' : r[col - 1]; },
        getValues: function(){ var out = []; for(var i = 0; i < (numRows || 1); i++){ var src = smRows[row - 2 + i] || []; var line = []; for(var j = 0; j < (numCols || 1); j++) line.push(src[col - 1 + j] === undefined ? '' : src[col - 1 + j]); out.push(line); } return out; },
        setValues: function(){ return this; },
        setFontWeight: function(){ return this; }
      };
    }
  };
  gsCtx.__stSS = {
    getSheetByName: function(n){
      if(n === 'Склад') return stSheet;
      if(n === 'СкладМин') return smSheet;
      return null;
    },
    insertSheet: function(n){ return n === 'СкладМин' ? smSheet : stSheet; }
  };

  var sm1 = att("stockMove_(__stSS, { moves: [ { type:'Приход', key:'PET-01', name:'Петля Boyard', unit:'шт', qty:50 }, { type:'Расход', key:'PET-01', name:'Петля Boyard', unit:'шт', qty:10 } ] })");
  ok(sm1.ok === true && sm1.ids.length === 2, 'батч из двух движений записан');
  var snap1 = att("stockSnapshot_(__stSS)");
  ok(snap1.ok === true && snap1.stock.length === 1 && snap1.stock[0].qty === 40, 'остаток после прихода 50 и расхода 10 = 40');
  var dm1 = att("delStockMove_(__stSS, '" + sm1.ids[1] + "')");
  var snap2 = att("stockSnapshot_(__stSS)");
  ok(dm1.ok === true && snap2.stock[0].qty === 50, 'удаление расхода пересчитало остаток обратно в 50');
  ok(att("delStockMove_(__stSS, 'нет-такого')").ok === false, 'удаление несуществующего движения отклонено');

  ok(att("saveStockMin_(__stSS, { key:'', min:5 })").ok === false, 'минимум без ключа отклонён');
  ok(att("saveStockMin_(__stSS, { key:'PET-01', min:20 })").ok === true, 'минимум 20 сохранён');
  var ml1 = att("stockMinList_(__stSS)");
  ok(ml1.ok === true && ml1.mins.length === 1 && ml1.mins[0].key === 'PET-01' && ml1.mins[0].min === 20, 'список минимумов отдаётся');
  att("saveStockMin_(__stSS, { key:'PET-01', min:30 })");
  var ml2 = att("stockMinList_(__stSS)");
  ok(ml2.mins.length === 1 && ml2.mins[0].min === 30, 'минимум обновляется без дубля строки');
  att("saveStockMin_(__stSS, { key:'PET-01', min:0 })");
  var ml3 = att("stockMinList_(__stSS)");
  ok(ml3.mins.length === 0, 'нулевой минимум удаляет строку (минимум снят)');

  // ─────────────────────────────────────────────────────────────
  // v4.1: Мастера — helperRate, доп. работы, бригада заказа
  // ─────────────────────────────────────────────────────────────
  console.log('── v4.1: Мастер + помощник + доп. работы ──');
  function mkWritable(rows){
    return {
      getLastRow: function(){ return rows.length + 1; },
      setFrozenRows: function(){}, hideColumns: function(){},
      deleteRow: function(row){ rows.splice(row - 2, 1); },
      getRange: function(row, col, numRows, numCols){
        return {
          setValue: function(v){ var r = row - 2; while(rows.length <= r) rows.push([]); rows[r][col - 1] = v; return this; },
          getValue: function(){ var r = rows[row - 2] || []; return r[col - 1] === undefined ? '' : r[col - 1]; },
          getValues: function(){ var out = []; for(var i = 0; i < (numRows || 1); i++){ var src = rows[row - 2 + i] || []; var line = []; for(var j = 0; j < (numCols || 1); j++) line.push(src[col - 1 + j] === undefined ? '' : src[col - 1 + j]); out.push(line); } return out; },
          setValues: function(){ return this; }, setFontWeight: function(){ return this; }
        };
      }
    };
  }

  // Сотрудник со ставкой помощника (helperRate — колонка 7)
  var empRows = [];
  var empWSheet = mkWritable(empRows);
  gsCtx.__empSS = { getSheetByName: function(n){ return n === 'Сотрудники' ? empWSheet : null; }, insertSheet: function(){ return empWSheet; } };
  var e1 = att("saveEmp_(__empSS, { name:'Мастер1', role:'Мастер', salary:0, helperRate:15000 })");
  ok(e1.ok === true, 'сотрудник со ставкой помощника сохранён');
  var el1 = att("empList_(__empSS)");
  ok(el1.employees.length === 1 && el1.employees[0].helperRate === 15000, 'helperRate отдаётся в списке сотрудников');
  att("saveEmp_(__empSS, { id:'" + e1.id + "', name:'Мастер1', role:'Мастер', salary:0, helperRate:20000 })");
  var el2 = att("empList_(__empSS)");
  ok(el2.employees.length === 1 && el2.employees[0].helperRate === 20000, 'helperRate обновляется без дубля строки');

  // Доп. работы (лист ДопРаботы)
  var dopRows = [];
  var dopWSheet = mkWritable(dopRows);
  gsCtx.__dopSS = { getSheetByName: function(n){ return n === 'ДопРаботы' ? dopWSheet : null; }, insertSheet: function(){ return dopWSheet; } };
  ok(att("addDop_(__dopSS, { num:'77', empId:'', sum:5000 })").ok === false, 'доп. работа без сотрудника отклонена');
  ok(att("addDop_(__dopSS, { num:'77', empId:'e1', sum:0 })").ok === false, 'доп. работа с нулевой суммой отклонена');
  var d1 = att("addDop_(__dopSS, { num:'77', empId:'e1', desc:'Доставка', sum:5000, date:'2026-07-05' })");
  ok(d1.ok === true, 'доп. работа добавлена');
  var dl1 = att("dopList_(__dopSS)");
  ok(dl1.dop.length === 1 && dl1.dop[0].sum === 5000 && dl1.dop[0].empId === 'e1', 'доп. работа отдаётся в списке');
  var dd1 = att("delDop_(__dopSS, '" + d1.id + "')");
  var dl2 = att("dopList_(__dopSS)");
  ok(dd1.ok === true && dl2.dop.length === 0, 'доп. работа удаляется');
  ok(att("delDop_(__dopSS, 'нет')").ok === false, 'удаление несуществующей доп. работы отклонено');

  // Бригада заказа: updateOrder_ пишет колонки 30-32, ordersList_ их читает
  var ub = att("updateOrder_(__ordSS, { num:'77', masterId:'e1', helperId:'e2', helperPay:15000 })");
  ok(ub.ok === true, 'бригада записана в заказ');
  var ol = att("ordersList_(__ordSS)");
  var o77 = null; ol.orders.forEach(function(x){ if(x.num === '77') o77 = x; });
  ok(!!o77 && o77.masterId === 'e1' && o77.helperId === 'e2' && o77.helperPay === 15000, 'ordersList отдаёт masterId/helperId/helperPay');
  ok(o77 && o77.clientKey === undefined, 'ordersList НЕ отдаёт секретный clientKey');
  att("updateOrder_(__ordSS, { num:'77', helperId:'', helperPay:0 })");
  var ol2 = att("ordersList_(__ordSS)");
  var o77b = null; ol2.orders.forEach(function(x){ if(x.num === '77') o77b = x; });
  ok(o77b && o77b.helperId === '' && o77b.helperPay === 0, 'помощник снимается (пустой id и 0)');
  ok(o77b && o77b.masterId === 'e1', 'при снятии помощника основной мастер не затронут');

  // ─────────────────────────────────────────────────────────────
  // v4.1.1: Материал заказа (до/после договора) + шаблоны доп.работ
  // ─────────────────────────────────────────────────────────────
  console.log('── v4.1.1: Материал заказа + шаблоны доп.работ ──');
  var um1 = att("updateOrder_(__ordSS, { num:'77', material:'P' })");
  ok(um1.ok === true, 'материал \u00abP\u00bb записан в заказ');
  var oml = att("ordersList_(__ordSS)");
  var o77m = null; oml.orders.forEach(function(x){ if(x.num === '77') o77m = x; });
  ok(o77m && o77m.material === 'P', 'ordersList отдаёт material');
  var um2 = att("updateOrder_(__ordSS, { num:'77', material:'X' })");
  var oml2 = att("ordersList_(__ordSS)");
  var o77m2 = null; oml2.orders.forEach(function(x){ if(x.num === '77') o77m2 = x; });
  ok(um2.ok === true && o77m2.material === 'P', 'неверный код материала (не L/P/K/\'\') не перезаписывает поле');
  att("updateOrder_(__ordSS, { num:'77', material:'' })");
  var oml3 = att("ordersList_(__ordSS)");
  var o77m3 = null; oml3.orders.forEach(function(x){ if(x.num === '77') o77m3 = x; });
  ok(o77m3.material === '', 'материал можно снять (пустая строка)');
  var um3 = att("updateOrder_(__ordSS, { num:'77', material:'K', fromDogovor:true })");
  var oml4 = att("ordersList_(__ordSS)");
  var o77m4 = null; oml4.orders.forEach(function(x){ if(x.num === '77') o77m4 = x; });
  ok(um3.ok === true && o77m4.material === '', 'fromDogovor НЕ трогает материал (фиксация только через карточку до договора)');

  var dtRows = [];
  var dtWSheet = mkWritable(dtRows);
  gsCtx.__dtSS = { getSheetByName: function(n){ return n === 'ШаблоныДопРабот' ? dtWSheet : null; }, insertSheet: function(){ return dtWSheet; } };
  ok(att("saveDopTemplate_(__dtSS, { name:'' })").ok === false, 'шаблон без названия отклонён');
  var t1 = att("saveDopTemplate_(__dtSS, { name:'Доставка' })");
  ok(t1.ok === true, 'шаблон добавлен');
  att("saveDopTemplate_(__dtSS, { name:'Врезка мойки' })");
  var tl1 = att("dopTemplatesList_(__dtSS)");
  ok(tl1.templates.length === 2 && tl1.templates[0].name === 'Доставка', 'список шаблонов отдаётся по порядку добавления');
  var td1 = att("delDopTemplate_(__dtSS, '" + t1.id + "')");
  var tl2 = att("dopTemplatesList_(__dtSS)");
  ok(td1.ok === true && tl2.templates.length === 1 && tl2.templates[0].name === 'Врезка мойки', 'шаблон удаляется');
  ok(att("delDopTemplate_(__dtSS, 'нет')").ok === false, 'удаление несуществующего шаблона отклонено');

  // ─────────────────────────────────────────────────────────────
  // v4.6: Рекламации (гарантийные обращения по сданным заказам)
  // ─────────────────────────────────────────────────────────────
  console.log('── v4.6: Рекламации ──');
  var reclRows = [];
  var reclWSheet = mkWritable(reclRows);
  gsCtx.__reclSS = {
    getSheetByName: function(n){
      if(n === 'Рекламации') return reclWSheet;
      if(n === 'Заказы') return ordSheet;
      return null;
    },
    insertSheet: function(n){ return n === 'Рекламации' ? reclWSheet : ordSheet; }
  };

  ok(att("addRecl_(__reclSS, { num:'77', desc:'' })").ok === false, 'рекламация без описания отклонена');
  ok(att("addRecl_(__reclSS, { num:'999', desc:'Скрипит дверь' })").ok === false, 'рекламация по несуществующему заказу отклонена');

  // Ключевой инвариант: заказ остаётся в своём статусе (не уходит из «Готова»)
  var olB = att("ordersList_(__reclSS)");
  var stBefore = null; olB.orders.forEach(function(x){ if(x.num === '77') stBefore = x.status; });
  var rc1 = att("addRecl_(__reclSS, { num:'77', desc:'Скрипит петля', date:'2026-07-10' })");
  ok(rc1.ok === true && rc1.stage === 'Принята', 'рекламация добавлена, стадия по умолчанию «Принята»');
  var olA = att("ordersList_(__reclSS)");
  var stAfter = null; olA.orders.forEach(function(x){ if(x.num === '77') stAfter = x.status; });
  ok(stBefore !== null && stAfter === stBefore, 'заказ НЕ меняет статус при заведении рекламации');

  var rl1 = att("reclList_(__reclSS)");
  ok(rl1.recl.length === 1 && rl1.recl[0].num === '77' && rl1.recl[0].desc === 'Скрипит петля', 'рекламация отдаётся в списке');

  ok(att("updRecl_(__reclSS, { id:'" + rc1.id + "', stage:'Ремонтируем' })").ok === false, 'неизвестная стадия отклонена');
  var ru1 = att("updRecl_(__reclSS, { id:'" + rc1.id + "', stage:'Устраняем' })");
  var rl2 = att("reclList_(__reclSS)");
  ok(ru1.ok === true && rl2.recl[0].stage === 'Устраняем', 'стадия рекламации меняется');
  ok(att("updRecl_(__reclSS, { id:'нет', stage:'Закрыта' })").ok === false, 'смена стадии несуществующей рекламации отклонена');

  // По одному заказу можно вести несколько рекламаций (через год — новая)
  var rc2 = att("addRecl_(__reclSS, { num:'77', desc:'Отошла столешница', date:'2027-01-20' })");
  var rl3 = att("reclList_(__reclSS)");
  ok(rc2.ok === true && rl3.recl.length === 2, 'по одному заказу заводятся две рекламации');

  var rd1 = att("delRecl_(__reclSS, '" + rc1.id + "')");
  var rl4 = att("reclList_(__reclSS)");
  ok(rd1.ok === true && rl4.recl.length === 1 && rl4.recl[0].desc === 'Отошла столешница', 'рекламация удаляется');
  ok(att("delRecl_(__reclSS, 'нет')").ok === false, 'удаление несуществующей рекламации отклонено');

  // Удаление заказа каскадом уносит его рекламации
  var rcDel = att("addRecl_(__reclSS, { num:'78', desc:'Царапина' })");
  var rlBefore = att("reclList_(__reclSS)");
  var doDel = att("delOrder_(__reclSS, '78')");
  var rlAfter = att("reclList_(__reclSS)");
  ok(rcDel.ok === true && rlBefore.recl.length === 2, 'рекламация по заказу 78 заведена');
  ok(doDel.ok === true && doDel.removedRecl === 1, 'delOrder_ отчитался об удалённой рекламации');
  ok(rlAfter.recl.length === 1 && rlAfter.recl[0].num === '77', 'рекламации удалённого заказа ушли каскадом, чужие целы');

  // ─────────────────────────────────────────────────────────────
  // v4.6: Себестоимость изменения к договору (поправка маржи)
  // ─────────────────────────────────────────────────────────────
  console.log('── v4.6: Себестоимость изменений ──');
  var chRows = [];
  var chWSheet = mkWritable(chRows);
  gsCtx.__chSS = {
    getSheetByName: function(n){
      if(n === 'Изменения') return chWSheet;
      if(n === 'Заказы') return ordSheet;
      return null;
    },
    insertSheet: function(n){ return n === 'Изменения' ? chWSheet : ordSheet; }
  };

  var c1 = att("addChange_(__chSS, { num:'77', desc:'Шкафчик', sum:200000, cost:140000 })");
  ok(c1.ok === true, 'изменение с себестоимостью записано');
  var cl1 = att("changesList_(__chSS)");
  ok(cl1.changes.length === 1 && cl1.changes[0].cost === 140000, 'себестоимость отдаётся в списке');

  var c2 = att("addChange_(__chSS, { num:'77', desc:'Без себеса', sum:50000 })");
  var cl2 = att("changesList_(__chSS)");
  var noCost = null; cl2.changes.forEach(function(x){ if(x.desc === 'Без себеса') noCost = x; });
  ok(c2.ok === true && noCost && noCost.cost === '', 'без себестоимости cost = пусто, а НЕ ноль');

  var c3 = att("addChange_(__chSS, { num:'77', desc:'Чистая прибыль', sum:30000, cost:0 })");
  var cl3 = att("changesList_(__chSS)");
  var zeroCost = null; cl3.changes.forEach(function(x){ if(x.desc === 'Чистая прибыль') zeroCost = x; });
  ok(c3.ok === true && zeroCost && zeroCost.cost === 0, 'нулевая себестоимость сохраняется как 0 (отличима от пусто)');

  ok(att("addChange_(__chSS, { num:'77', desc:'Кривой знак', sum:100000, cost:-50000 })").ok === false, 'себестоимость с чужим знаком отклонена');
  ok(att("addChange_(__chSS, { num:'77', desc:'Убыток', sum:100000, cost:150000 })").ok === false, 'себестоимость больше суммы отклонена');

  var c4 = att("addChange_(__chSS, { num:'77', desc:'Убрали полку', sum:-50000, cost:-35000 })");
  var cl4 = att("changesList_(__chSS)");
  var neg = null; cl4.changes.forEach(function(x){ if(x.desc === 'Убрали полку') neg = x; });
  ok(c4.ok === true && neg && neg.sum === -50000 && neg.cost === -35000, 'отрицательное изменение с отрицательной себестоимостью записано');

  // ─────────────────────────────────────────────────────────────
  // v4.8: Касса — идемпотентность op_id + теги начисления по id
  // ─────────────────────────────────────────────────────────────
  console.log('── v4.8: op_id кассы + начисление по id ──');
  var finRows = [];
  var finWSheet = mkWritable(finRows);
  var recRows2 = [];
  var recWSheet2 = mkWritable(recRows2);
  var empRowsFin = [];
  var empWSheetFin = mkWritable(empRowsFin);
  gsCtx.__finSS = { getSheetByName: function(n){
    if(n === 'Финансы') return finWSheet;
    if(n === 'Постоянные') return recWSheet2;
    if(n === 'Сотрудники') return empWSheetFin;
    return null;
  }, insertSheet: function(){ return finWSheet; } };

  var f1 = att("addFin_(__finSS, { type:'Расход', cat:'Материалы', sum:5000, opId:'op-AAA' })");
  ok(f1.ok === true && !f1.dup && finRows.length === 1, 'операция с op_id записана');
  var f2 = att("addFin_(__finSS, { type:'Расход', cat:'Материалы', sum:5000, opId:'op-AAA' })");
  ok(f2.ok === true && f2.dup === true && finRows.length === 1, 'повтор того же op_id: dup, строка не создана');
  ok(String(f2.id) === String(f1.id), 'dup возвращает id исходной записи');
  var f3 = att("addFin_(__finSS, { type:'Расход', cat:'Материалы', sum:5000, opId:'op-BBB' })");
  ok(f3.ok === true && !f3.dup && finRows.length === 2, 'другой op_id: новая строка (две канистры бензина)');
  var f4 = att("addFin_(__finSS, { type:'Приход', cat:'Прочее', sum:700 })");
  ok(f4.ok === true && finRows.length === 3, 'старый клиент без op_id работает как раньше');

  var r1v = att("saveRecur_(__finSS, { name:'Аренда Офиса', cat:'Аренда', sum:100000 })");
  ok(r1v.ok === true, 'постоянный расход создан');
  var a1 = att("accrueMonth_(__finSS, '2026-07')");
  ok(a1.ok === true && a1.created === 1, 'начисление создало проводку');
  var beforeRen = finRows.length;
  att("saveRecur_(__finSS, { id:'" + r1v.id + "', name:'Аренда офиса (новое имя)', cat:'Аренда', sum:100000 })");
  var a2 = att("accrueMonth_(__finSS, '2026-07')");
  ok(a2.ok === true && a2.created === 0 && a2.skipped === 1 && finRows.length === beforeRen, 'переименование + повтор: дубля нет (тег по id)');

  var r2v = att("saveRecur_(__finSS, { name:'Аренда Цеха', cat:'Аренда', sum:250000 })");
  ok(r2v.ok === true, 'второй постоянный расход создан');
  finRows.push(['legacy-1', '2026-07-01', 'Расход', 'Аренда', 250000, '', '[Постоянные 2026-07] Аренда Цеха', '2026-07-01']);
  var legacyLen = finRows.length;
  var a3 = att("accrueMonth_(__finSS, '2026-07')");
  ok(a3.created === 0 && a3.skipped === 2 && finRows.length === legacyLen, 'старый тег по имени узнан — дубля нет');

  att("saveEmp_(__finSS, { name:'Серик', role:'Мастер', salary:150000 })");
  var a4 = att("accrueMonth_(__finSS, '2026-08')");
  ok(a4.created === 3, 'новый месяц: 2 постоянных + оклад начислены');

  console.log('');
  console.log('ИТОГ: ' + PASS + ' прошло, ' + FAIL + ' упало');
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.log('✗ Тест упал: ' + e.message); process.exit(1); });
