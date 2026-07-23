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
  domB.window.eval('tog("furn")');
  ok(dB.getElementById('cb-furn').classList.contains('op'), 'раздел фурнитуры открыт');
  domB.window.eval('tog("kuh")');
  ok(!dB.getElementById('cb-furn').classList.contains('op') && dB.getElementById('cb-kuh').classList.contains('op'), 'v4.12 аккордеон: открытие «Кухня» закрывает «Фурнитура» (один раздел за раз)');
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
        setValues: function(v){
          for(var i = 0; i < v.length; i++){
            var r = row - 2 + i;
            while(ordRows.length <= r) ordRows.push([]);
            for(var j = 0; j < v[i].length; j++) ordRows[r][col - 1 + j] = v[i][j];
          }
          return this;
        },
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
          setValues: function(v){
            for(var i = 0; i < v.length; i++){
              var r = row - 2 + i;
              while(rows.length <= r) rows.push([]);
              for(var j = 0; j < v[i].length; j++) rows[r][col - 1 + j] = v[i][j];
            }
            return this;
          },
          setFontWeight: function(){ return this; }
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

  // ─────────────────────────────────────────────────────────────
  // v4.11: Источник лида (реклама/сарафан/партнёр) — просто метка
  // канала, без комиссий и без блокировки договором (в отличие от
  // material выше).
  // ─────────────────────────────────────────────────────────────
  console.log('── v4.11: Источник лида ──');
  var us1 = att("updateOrder_(__ordSS, { num:'77', source:'Сарафан' })");
  ok(us1.ok === true, 'источник «Сарафан» записан в заказ');
  var osl1 = att("ordersList_(__ordSS)");
  var o77s1 = null; osl1.orders.forEach(function(x){ if(x.num === '77') o77s1 = x; });
  ok(o77s1 && o77s1.source === 'Сарафан', 'ordersList отдаёт source');
  var us2 = att("updateOrder_(__ordSS, { num:'77', source:'Инопланетяне' })");
  var osl2 = att("ordersList_(__ordSS)");
  var o77s2 = null; osl2.orders.forEach(function(x){ if(x.num === '77') o77s2 = x; });
  ok(us2.ok === true && o77s2.source === 'Сарафан', 'неизвестный источник не перезаписывает поле (белый список)');
  att("updateOrder_(__ordSS, { num:'77', source:'' })");
  var osl3 = att("ordersList_(__ordSS)");
  var o77s3 = null; osl3.orders.forEach(function(x){ if(x.num === '77') o77s3 = x; });
  ok(o77s3.source === '', 'источник можно снять (пустая строка)');
  var us3 = att("updateOrder_(__ordSS, { num:'77', status:'Договор', source:'Партнёр' })");
  var osl4 = att("ordersList_(__ordSS)");
  var o77s4 = null; osl4.orders.forEach(function(x){ if(x.num === '77') o77s4 = x; });
  ok(us3.ok === true && o77s4.source === 'Партнёр' && o77s4.status === 'Договор', 'источник редактируется свободно даже после договора (в отличие от материала)');

  var co1 = att("createOrder_(__ordSS, { client:'Новый С Рекламы', phone:'+77010001122', source:'Реклама' })");
  ok(co1.ok === true, 'новый заказ с источником создан');
  var osl5 = att("ordersList_(__ordSS)");
  var oNew = null; osl5.orders.forEach(function(x){ if(x.num === co1.num) oNew = x; });
  ok(oNew && oNew.source === 'Реклама', 'источник, заданный при создании, отдаётся в списке');
  var co2 = att("createOrder_(__ordSS, { client:'Без Источника', phone:'+77010001133' })");
  var osl6 = att("ordersList_(__ordSS)");
  var oNew2 = null; osl6.orders.forEach(function(x){ if(x.num === co2.num) oNew2 = x; });
  ok(co2.ok === true && oNew2 && oNew2.source === '', 'источник необязателен при создании (пустая строка по умолчанию)');

  // ─────────────────────────────────────────────────────────────
  // v4.13: saveOrder_ пишет себестоимость план/факт — это РЕАЛЬНЫЙ путь
  // из калькулятора (crmPushOrder → action 'saveOrder'), а не updateOrder_,
  // которую проверяли выше отдельно. Разные диапазоны записи — разная
  // функция, разный риск.
  // ─────────────────────────────────────────────────────────────
  console.log('── v4.13: saveOrder_ пишет себестоимость (реальный путь из калькулятора) ──');
  var so1 = att("saveOrder_(__ordSS, { num:'850', client:'Заказ Для Себестоимости', totL:600000, costPlan:336480, costFact:317240 })");
  ok(so1.ok === true, 'saveOrder_ с себестоимостью сохранён');
  var osl7 = att("ordersList_(__ordSS)");
  var o77s7 = null; osl7.orders.forEach(function(x){ if (x.num === '850') o77s7 = x; });
  ok(o77s7.costPlan === 336480 && o77s7.costFact === 317240, 'saveOrder_: план и факт долетели до ordersList_');
  ok(o77s7.costDelta === -19240, 'saveOrder_: отклонение посчиталось верно (минус 19 240₸)');
  ok(o77s7.source === '', 'saveOrder_ не задел источник лида — он вне диапазона 1-25/35-36 этой функции');

  // Повторное сохранение расчёта БЕЗ корректировки (costPlan/costFact не
  // переданы вовсе) не должно стирать то, что уже записано.
  att("saveOrder_(__ordSS, { num:'850', totL:610000 })");
  var osl8 = att("ordersList_(__ordSS)");
  var o77s8 = null; osl8.orders.forEach(function(x){ if (x.num === '850') o77s8 = x; });
  ok(o77s8.costPlan === 336480 && o77s8.costFact === 317240, 'повторное сохранение без cost-полей не стирает ранее записанную себестоимость');

  // Новый заказ, сохранённый сразу с себестоимостью (первое сохранение
  // расчёта из калькулятора — самый частый случай в реальности).
  var so2 = att("saveOrder_(__ordSS, { num:'901', client:'Новый С Расчётом', totL:400000, costPlan:200000, costFact:200000 })");
  ok(so2.ok === true && so2.created === true, 'новый заказ создан через saveOrder_ сразу с себестоимостью');
  var osl9 = att("ordersList_(__ordSS)");
  var o901 = null; osl9.orders.forEach(function(x){ if (x.num === '901') o901 = x; });
  ok(o901.costPlan === 200000 && o901.costFact === 200000 && o901.costDelta === 0, 'план=факт при первом сохранении — отклонения ещё нет, но оба поля на месте');

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
  var reclCascadeTaskRows = [];
  var reclCascadeTaskWSheet = mkWritable(reclCascadeTaskRows);
  gsCtx.__reclSS = {
    getSheetByName: function(n){
      if(n === 'Рекламации') return reclWSheet;
      if(n === 'Задачи') return reclCascadeTaskWSheet;
      if(n === 'Заказы') return ordSheet;
      return null;
    },
    insertSheet: function(n){
      if(n === 'Рекламации') return reclWSheet;
      if(n === 'Задачи') return reclCascadeTaskWSheet;
      return ordSheet;
    }
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

  // Удаление заказа каскадом уносит его рекламации И задачи
  var rcDel = att("addRecl_(__reclSS, { num:'78', desc:'Царапина' })");
  var tkDel = att("addTask_(__reclSS, { num:'78', text:'Перезвонить по гарантии', deadline:'2026-08-01' })");
  var rlBefore = att("reclList_(__reclSS)");
  var doDel = att("delOrder_(__reclSS, '78')");
  var rlAfter = att("reclList_(__reclSS)");
  var tlAfterDel = att("taskList_(__reclSS)");
  ok(rcDel.ok === true && rlBefore.recl.length === 2, 'рекламация по заказу 78 заведена');
  ok(tkDel.ok === true, 'задача по заказу 78 заведена (для проверки каскада)');
  ok(doDel.ok === true && doDel.removedRecl === 1, 'delOrder_ отчитался об удалённой рекламации');
  ok(doDel.ok === true && doDel.removedTasks === 1, 'delOrder_ отчитался об удалённой задаче');
  ok(rlAfter.recl.length === 1 && rlAfter.recl[0].num === '77', 'рекламации удалённого заказа ушли каскадом, чужие целы');
  ok(tlAfterDel.tasks.length === 0, 'задачи удалённого заказа ушли каскадом (сирот с несуществующим № не осталось)');

  // ─────────────────────────────────────────────────────────────
  // v4.11: Задачи (напоминания с дедлайном, привязанные к заказу,
  // без исполнителя — просто текст+дедлайн)
  // ─────────────────────────────────────────────────────────────
  console.log('── v4.11: Задачи ──');
  var taskRows = [];
  var taskWSheet = mkWritable(taskRows);
  gsCtx.__taskSS = {
    getSheetByName: function(n){
      if(n === 'Задачи') return taskWSheet;
      if(n === 'Заказы') return ordSheet;
      return null;
    },
    insertSheet: function(n){ return n === 'Задачи' ? taskWSheet : ordSheet; }
  };

  ok(att("addTask_(__taskSS, { num:'77', text:'', deadline:'2026-07-25' })").ok === false, 'задача без текста отклонена');
  ok(att("addTask_(__taskSS, { num:'77', text:'Позвонить клиенту' })").ok === false, 'задача без дедлайна отклонена');
  ok(att("addTask_(__taskSS, { num:'999', text:'Позвонить', deadline:'2026-07-25' })").ok === false, 'задача по несуществующему заказу отклонена');

  var t1 = att("addTask_(__taskSS, { num:'77', text:'Позвонить, уточнить замер', deadline:'2026-07-25' })");
  ok(t1.ok === true && !!t1.id, 'задача добавлена');
  var tl1 = att("taskList_(__taskSS)");
  ok(tl1.tasks.length === 1 && tl1.tasks[0].num === '77' && tl1.tasks[0].text === 'Позвонить, уточнить замер' && tl1.tasks[0].done === false, 'задача отдаётся в списке, по умолчанию не выполнена');

  var t2 = att("addTask_(__taskSS, { num:'77', text:'Отправить смету', deadline:'2026-07-28' })");
  var tl2 = att("taskList_(__taskSS)");
  ok(t2.ok === true && tl2.tasks.length === 2, 'по одному заказу заводятся две задачи');

  var tt1 = att("toggleTask_(__taskSS, '" + t1.id + "', true)");
  var tl3 = att("taskList_(__taskSS)");
  var got1 = tl3.tasks.filter(function(x){ return x.id === t1.id; })[0];
  ok(tt1.ok === true && got1 && got1.done === true, 'задача отмечается выполненной');
  var tt2 = att("toggleTask_(__taskSS, '" + t1.id + "', false)");
  var tl4 = att("taskList_(__taskSS)");
  var got2 = tl4.tasks.filter(function(x){ return x.id === t1.id; })[0];
  ok(tt2.ok === true && got2 && got2.done === false, 'снятие отметки выполнения работает (обратимо)');
  ok(att("toggleTask_(__taskSS, 'нет', true)").ok === false, 'отметка несуществующей задачи отклонена');

  var td1 = att("delTask_(__taskSS, '" + t2.id + "')");
  var tl5 = att("taskList_(__taskSS)");
  ok(td1.ok === true && tl5.tasks.length === 1 && tl5.tasks[0].id === t1.id, 'задача удаляется');
  ok(att("delTask_(__taskSS, 'нет')").ok === false, 'удаление несуществующей задачи отклонено');

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

  // ─────────────────────────────────────────────────────────────
  // v4.9: Батч-запись updateOrder_ (диапазоны 1-19 и 23-33) —
  // снимок расчёта (колонки 20-22, до 45к символов каждая) вне
  // обоих диапазонов и должен остаться байт-в-байт нетронутым.
  // ─────────────────────────────────────────────────────────────
  console.log('── v4.9: Батч-запись updateOrder_ + целостность снимка ──');
  var bigSnap1 = 'A'.repeat(45000);
  var bigSnap2 = 'B'.repeat(45000);
  var bigSnap3 = 'C'.repeat(12345);
  var so1 = att("saveOrder_(__ordSS, { num:'501', client:'Тест Снимок', obj:'ул. Тест 1', predPrice:100000, totL:100000, totP:0, totK:0, margL:20000, margP:0, margK:0, snap1:" + JSON.stringify(bigSnap1) + ", snap2:" + JSON.stringify(bigSnap2) + ", snap3:" + JSON.stringify(bigSnap3) + " })");
  ok(so1.ok === true, 'заказ с 45к-снимком сохранён (saveOrder_)');
  var oo1 = att("orderOne_(__ordSS, '501')");
  ok(oo1.ok === true && oo1.order.snapshot === (bigSnap1 + bigSnap2 + bigSnap3), 'снимок сразу после saveOrder_ цел');

  var uu1 = att("updateOrder_(__ordSS, { num:'501', status:'Договор', paid:5000, masterId:'e1' })");
  ok(uu1.ok === true, 'updateOrder_ (батч-запись, статус+оплата+бригада) прошёл');
  var oo2 = att("orderOne_(__ordSS, '501')");
  ok(oo2.ok === true && oo2.order.snapshot === (bigSnap1 + bigSnap2 + bigSnap3), 'снимок НЕ тронут после updateOrder_ (диапазон 20-22 вне батча)');

  // ── v4.11: Батч-запись saveOrder_ (тем же приёмом, что updateOrder_) ──
  // В отличие от updateOrder_, saveOrder_ ВСЕГДА пишет снимки — поэтому
  // у него один диапазон 1-25 (а не два), и повторный saveOrder_ поверх
  // заказа, уже помеченного updateOrder_ (статус/оплата/бригада), не
  // должен затереть эти поля.
  console.log('── v4.11: Батч-запись saveOrder_ ──');
  var so2 = att("saveOrder_(__ordSS, { num:'501', client:'Тест Снимок', obj:'ул. Тест 1 (пересчёт)', predPrice:110000, totL:110000, totP:0, totK:0, margL:22000, margP:0, margK:0, snap1:'x', snap2:'y', snap3:'z' })");
  ok(so2.ok === true, 'повторный saveOrder_ (пересчёт) поверх заказа с уже проставленным договором прошёл');
  var ol501b = att("ordersList_(__ordSS)");
  var o501b = null; ol501b.orders.forEach(function(x){ if(x.num === '501') o501b = x; });
  ok(o501b && o501b.status === 'Договор', 'повторный saveOrder_ НЕ затирает статус «Договор» (колонка 2, внутри батч-диапазона, но saveOrder_ её не пишет)');
  ok(o501b && o501b.paid === 5000, 'повторный saveOrder_ НЕ затирает Оплачено (колонка 12, внутри батч-диапазона, но saveOrder_ её не пишет)');
  ok(o501b && o501b.masterId === 'e1', 'повторный saveOrder_ НЕ затирает мастера (колонка 30 — вне батч-диапазона 1-25 в принципе)');
  ok(o501b && o501b.pred === 110000 && typeof o501b.pred === 'number', 'предв. цена обновилась и приезжает ЧИСЛОМ после батч-записи saveOrder_');
  ok(o501b && o501b.margL === 22000 && typeof o501b.margL === 'number', 'маржа ЛДСП обновилась и приезжает ЧИСЛОМ (колонка 23, конец батч-диапазона)');
  var oo3 = att("orderOne_(__ordSS, '501')");
  ok(oo3.ok === true && oo3.order.snapshot === 'xyz', 'снимок обновился повторным saveOrder_ (снимки теперь внутри единого батч-диапазона)');

  var so3 = att("saveOrder_(__ordSS, { num:'777', client:'Первый Клиент', obj:'ул. Новая 1', predPrice:50000, totL:50000 })");
  ok(so3.ok === true && so3.created === true, 'новый заказ через батч saveOrder_ создаётся (isNew, диапазон инициализирован пусто)');
  var so4 = att("saveOrder_(__ordSS, { num:'777', client:'Второй Клиент', obj:'ул. Новая 1', predPrice:60000, totL:60000 })");
  ok(so4.ok === true && so4.created === false && so4.prevClient === 'Первый Клиент', 'saveOrder_ детектит смену клиента (prevClient) из батч-прочитанного диапазона: ' + JSON.stringify(so4));

  var ol501 = att("ordersList_(__ordSS)");
  var o501 = null; ol501.orders.forEach(function(x){ if(x.num === '501') o501 = x; });
  ok(o501 && o501.status === 'Договор' && o501.paid === 5000 && o501.masterId === 'e1', 'ordersList отдаёт поля из обоих батч-диапазонов (A: статус/оплата, B: бригада)');

  var uu2 = att("updateOrder_(__ordSS, { num:'999', client:'Новый Клиент', status:'Договор', margin:15000 })");
  ok(uu2.ok === true && uu2.created === true, 'новый заказ через батч-запись создаётся (isNew, диапазоны инициализированы пусто)');
  var ol999 = att("ordersList_(__ordSS)");
  var o999 = null; ol999.orders.forEach(function(x){ if(x.num === '999') o999 = x; });
  ok(o999 && o999.client === 'Новый Клиент' && o999.status === 'Договор' && o999.margin === 15000, 'новый заказ: поля из обоих диапазонов (A и B) применились корректно');

  // ─────────────────────────────────────────────────────────────
  // v4.9: Архив заказов — перенос по возрасту (Готова/Отказ, 30 дней
  // по журналу "Статусы"), незакрытая рекламация блокирует перенос,
  // список архива, возврат из архива.
  // ─────────────────────────────────────────────────────────────
  console.log('── v4.9: Архив заказов ──');
  var arOrdRows = [];
  var arOrdSheet = mkWritable(arOrdRows);
  var arSlogRows = [];
  var arSlogSheet = mkWritable(arSlogRows);
  var arReclRows = [];
  var arReclSheet = mkWritable(arReclRows);
  gsCtx.__arSS = {
    getSheetByName: function(n){
      if(n === 'Заказы') return arOrdSheet;
      if(n === 'Статусы') return arSlogSheet;
      if(n === 'Рекламации') return arReclSheet;
      return null;
    },
    insertSheet: function(n){
      if(n === 'Статусы') return arSlogSheet;
      if(n === 'Рекламации') return arReclSheet;
      return arOrdSheet;
    }
  };
  var arArchRows = [];
  var arArchSheet = mkWritable(arArchRows);
  gsCtx.__arArchiveSS = {
    getSheetByName: function(n){ return n === 'Заказы' ? arArchSheet : null; },
    insertSheet: function(){ return arArchSheet; }
  };

  // 601: Готова 40 дней назад, без рекламаций → должен уехать.
  att("saveOrder_(__arSS, { num:'601', client:'Старый Клиент', obj:'ул. Архивная 1', predPrice:200000, totL:200000 })");
  att("updateOrder_(__arSS, { num:'601', status:'Готова' })");
  (function(){ arSlogRows[arSlogRows.length - 1][3] = new Date(Date.now() - 40*24*60*60*1000); })();

  // 602: Готова 40 дней назад, НО есть незакрытая рекламация → НЕ уезжает.
  att("saveOrder_(__arSS, { num:'602', client:'Рекламационный', obj:'ул. Архивная 2', predPrice:150000, totL:150000 })");
  att("updateOrder_(__arSS, { num:'602', status:'Готова' })");
  (function(){ arSlogRows[arSlogRows.length - 1][3] = new Date(Date.now() - 40*24*60*60*1000); })();
  att("addRecl_(__arSS, { num:'602', desc:'Скрипит петля' })");

  // 603: Готова только 5 дней назад → рано, НЕ уезжает.
  att("saveOrder_(__arSS, { num:'603', client:'Свежий', obj:'ул. Архивная 3', predPrice:90000, totL:90000 })");
  att("updateOrder_(__arSS, { num:'603', status:'Готова' })");
  (function(){ arSlogRows[arSlogRows.length - 1][3] = new Date(Date.now() - 5*24*60*60*1000); })();

  // 604: статус "Сборка" (не терминальный) → не кандидат вообще.
  att("saveOrder_(__arSS, { num:'604', client:'В работе', obj:'ул. Архивная 4', predPrice:80000, totL:80000 })");
  att("updateOrder_(__arSS, { num:'604', status:'Сборка' })");

  var arRun = att("archiveEligibleOrders_(__arSS, __arArchiveSS)");
  ok(arRun.ok === true && arRun.archived.indexOf('601') >= 0, '601 (Готова, 40 дней, без рекламаций) перенесён в архив');
  ok(arRun.archived.indexOf('602') < 0, '602 (Готова, 40 дней, НО открытая рекламация) остался в рабочем файле');
  ok(arRun.archived.indexOf('603') < 0, '603 (Готова, всего 5 дней) остался — рано');
  ok(arRun.archived.indexOf('604') < 0, '604 (статус «Сборка», не терминальный) не кандидат');
  ok(arRun.count === 1, 'ровно один заказ перенесён за этот прогон');

  var arWorkList = att("ordersList_(__arSS)");
  ok(!arWorkList.orders.some(function(x){ return x.num === '601'; }), '601 пропал из рабочего ordersList_');
  ok(arWorkList.orders.some(function(x){ return x.num === '602'; }), '602 остался в рабочем ordersList_');

  var arArchList = att("archiveOrdersList_(__arArchiveSS)");
  var arch601 = null; arArchList.orders.forEach(function(x){ if(x.num === '601') arch601 = x; });
  ok(!!arch601 && arch601.client === 'Старый Клиент' && arch601.status === 'Готова', 'архивный список отдаёт перенесённый заказ с теми же полями');

  var arRun2 = att("archiveEligibleOrders_(__arSS, __arArchiveSS)");
  ok(arRun2.ok === true && arRun2.count === 0, 'повторный прогон архивации идемпотентен (601 уже уехал, новых кандидатов нет)');

  var arRestoreBad = att("restoreFromArchive_(__arSS, __arArchiveSS, '999-нет')");
  ok(arRestoreBad.ok === false, 'возврат несуществующего в архиве номера отклонён');
  var arRestore = att("restoreFromArchive_(__arSS, __arArchiveSS, '601')");
  ok(arRestore.ok === true, '601 возвращён из архива');
  var arWorkList2 = att("ordersList_(__arSS)");
  ok(arWorkList2.orders.some(function(x){ return x.num === '601'; }), '601 снова виден в рабочем ordersList_ после возврата');
  var arArchList2 = att("archiveOrdersList_(__arArchiveSS)");
  ok(!arArchList2.orders.some(function(x){ return x.num === '601'; }), '601 пропал из архивного списка после возврата');
  var arRestoreDup = att("restoreFromArchive_(__arSS, __arArchiveSS, '601')");
  ok(arRestoreDup.ok === false, 'повторный возврат того же номера отклонён (его уже нет в архиве)');

  // ─────────────────────────────────────────────────────────────
  // v4.12: flatItems — плоский список позиций (ПЛАН) для корректировки.
  // Проверяем: цена за единицу, единица измерения, kind qty/money,
  // id-якорь на поле ввода и что пустые строки в список не лезут.
  // ─────────────────────────────────────────────────────────────
  console.log('── v4.12: flatItems (план для корректировки) ──');
  const domF = bootPage(null);
  await waitReady(domF);
  domF.window.eval('addLdsp()');
  const fLi = domF.window.eval('ST.ldsp.length') - 1;
  domF.window.eval('ST.ldsp[' + fLi + ']=0;document.getElementById("ls' + fLi + '").value="0";document.getElementById("lq' + fLi + '").value="3";recalc()');
  domF.window.eval('document.getElementById("hdf-qty").value="2";document.getElementById("krom-qty").value="10";recalc()');
  domF.window.eval('addCat("furn", DB.furn, "furn-list")');
  const fFi = domF.window.eval('ST.furn.length') - 1;
  domF.window.eval('document.getElementById("furnq' + fFi + '").value="4";uCP("furn",' + fFi + ')');
  domF.window.eval('document.getElementById("d-sat").value="15000";document.getElementById("d-pdm").value="0";recalc()');
  const FI = JSON.parse(domF.window.eval('JSON.stringify(flatItems())'));
  const fFind = function(n){ let r = null; FI.forEach(function(x){ if (x.n === n) r = x; }); return r; };

  const fLdsp = fFind('Эггер Дуб');
  ok(!!fLdsp, 'flatItems отдаёт строку ЛДСП');
  ok(fLdsp && fLdsp.q === 3 && fLdsp.u === 18500, 'ЛДСП: план 3 и цена за лист 18500 из прайса сервера');
  ok(fLdsp && fLdsp.unit === 'лист' && fLdsp.kind === 'qty', 'ЛДСП: единица «лист», правится количество');
  ok(fLdsp && fLdsp.id === 'lq' + fLi, 'ЛДСП: id-якорь совпадает с полем ввода количества');
  ok(fLdsp && fLdsp.grp === 'Корпус', 'ЛДСП попал в группу «Корпус»');

  const fHdf = fFind('ХДФ'), fKrom = fFind('Кромка');
  ok(fHdf && fHdf.q === 2 && fHdf.u === 9000 && fHdf.unit === 'лист', 'ХДФ: 2 листа по 9000');
  ok(fKrom && fKrom.q === 10 && fKrom.u === 200 && fKrom.unit === 'пм', 'Кромка считается в погонных метрах');

  const fPet = fFind('Петля полувнешний En-7');
  ok(!!fPet, 'фурнитура: имя собрано из категории, вида и фирмы');
  ok(fPet && fPet.q === 4 && fPet.u === 320 && fPet.unit === 'шт', 'фурнитура: 4 шт по 320');

  const fDel = fFind('Доставка');
  ok(fDel && fDel.kind === 'money' && fDel.u === 15000 && fDel.q === 1, 'доставка — строка типа money (правится сумма, не количество)');
  ok(fFind('ПДМ') === null, 'ПДМ с нулевой суммой в список не попадает');

  let fZero = true;
  FI.forEach(function(x){ if (!(x.q * x.u)) fZero = false; });
  ok(fZero, 'в плоском списке нет строк с нулевой стоимостью (авто-слоты без количества отфильтрованы)');

  let fFields = true;
  FI.forEach(function(x){ if (!x.id || !x.sec || !x.grp || !x.unit || !x.kind) fFields = false; });
  ok(fFields, 'у каждой строки заполнены id, раздел, группа, единица и тип');

  const fTot = domF.window.eval('flatPlanTotal()');
  ok(fTot === 3 * 18500 + 2 * 9000 + 10 * 200 + 4 * 320 + 15000, 'flatPlanTotal сходится с суммой строк (91 780₸)');

  const fTot2 = domF.window.eval('flatPlanTotal(flatItems())');
  ok(fTot2 === fTot, 'flatPlanTotal принимает готовый список и даёт тот же итог');

  // ─────────────────────────────────────────────────────────────
  // v4.12: корректировка (факт против плана). Главный инвариант —
  // она НЕ двигает цену клиенту и кредит: договор уже подписан.
  // ─────────────────────────────────────────────────────────────
  console.log('── v4.12: корректировка (факт против плана) ──');
  const kT0 = JSON.parse(domF.window.eval('JSON.stringify(korrTotals())'));
  ok(kT0.plan === fTot && kT0.fact === fTot, 'без правок факт равен плану');
  ok(kT0.delta === 0 && kT0.changed === 0, 'отклонения нет, изменённых строк нет');

  const dF = domF.window.document;
  const totBefore = norm(dF.getElementById('il-tot').textContent);
  const crBefore = norm(dF.getElementById('il-cr').textContent);

  domF.window.eval('korrSet("lq' + fLi + '", 2); recalc()');
  const kT1 = JSON.parse(domF.window.eval('JSON.stringify(korrTotals())'));
  ok(kT1.delta === -18500, 'списали 2 листа вместо 3 — отклонение минус 18 500₸ (экономия)');
  ok(kT1.fact === fTot - 18500 && kT1.plan === fTot, 'факт уменьшился, план остался нетронутым');
  ok(kT1.changed === 1, 'изменённой помечена ровно одна строка');
  ok(norm(dF.getElementById('il-tot').textContent) === totBefore, 'корректировка НЕ меняет цену клиенту');
  ok(norm(dF.getElementById('il-cr').textContent) === crBefore, 'корректировка НЕ меняет сумму в кредит');

  const kRow = JSON.parse(domF.window.eval('JSON.stringify(korrList())')).filter(function(r){ return r.id === 'lq' + fLi; })[0];
  ok(kRow && kRow.plan === 3 && kRow.fact === 2 && kRow.delta === -18500, 'строка отдаёт план 3, факт 2 и разницу в деньгах');

  domF.window.eval('korrSet("d-sat", 12000)');
  const kRowM = JSON.parse(domF.window.eval('JSON.stringify(korrList())')).filter(function(r){ return r.id === 'd-sat'; })[0];
  ok(kRowM && kRowM.kind === 'money' && kRowM.plan === 15000 && kRowM.fact === 12000 && kRowM.delta === -3000, 'money-строка правится суммой: доставка 15 000 → 12 000');

  domF.window.eval('korrSet("krom-qty", -5)');
  const kNeg = JSON.parse(domF.window.eval('JSON.stringify(korrList())')).filter(function(r){ return r.id === 'krom-qty'; })[0];
  ok(kNeg && kNeg.fact === 10 && kNeg.delta === 0, 'отрицательный факт отклонён, строка осталась на плане');

  domF.window.eval('korrSet("d-sat", "")');
  const kClr = JSON.parse(domF.window.eval('JSON.stringify(korrList())')).filter(function(r){ return r.id === 'd-sat'; })[0];
  ok(kClr && kClr.fact === 15000 && kClr.delta === 0, 'пустое значение снимает факт — строка возвращается к плану');

  domF.window.eval('korrAddItem("Уголок мебельный", 450, 20, "шт")');
  const kAdd = JSON.parse(domF.window.eval('JSON.stringify(korrList())')).filter(function(r){ return r.added === true; })[0];
  ok(kAdd && kAdd.plan === 0 && kAdd.factCost === 9000 && kAdd.delta === 9000, 'докупленная позиция: плана 0, отклонение плюс 9 000₸');
  const kT2 = JSON.parse(domF.window.eval('JSON.stringify(korrTotals())'));
  ok(kT2.delta === -18500 + 9000, 'свод складывает экономию и докупленное (минус 9 500₸)');

  // Круг снимка: факт и докупленное обязаны пережить сохранение/открытие.
  const recK = JSON.parse(domF.window.eval('JSON.stringify({ST:ST,snap:getSnap()})'));
  const domK = bootPage(null);
  await waitReady(domK);
  domK.window.eval('applySnap(' + JSON.stringify(recK) + ')');
  const kT3 = JSON.parse(domK.window.eval('JSON.stringify(korrTotals())'));
  ok(kT3.delta === kT2.delta && kT3.plan === kT2.plan, 'после круга снимка план и отклонение сошлись копейка в копейку');
  const kAdd3 = JSON.parse(domK.window.eval('JSON.stringify(korrList())')).filter(function(r){ return r.added === true; })[0];
  ok(kAdd3 && kAdd3.n === 'Уголок мебельный' && kAdd3.fact === 20, 'докупленная позиция пережила круг снимка');
  const kRow3 = JSON.parse(domK.window.eval('JSON.stringify(korrList())')).filter(function(r){ return r.id === 'lq' + fLi; })[0];
  ok(kRow3 && kRow3.fact === 2, 'факт по листам пережил круг снимка');

  domK.window.eval('korrRemoveItem(0)');
  const kAfterDel = JSON.parse(domK.window.eval('JSON.stringify(korrTotals())'));
  ok(kAfterDel.delta === -18500, 'удаление докупленной позиции убрало её из отклонения');

  // Заказ без корректировки не должен подхватывать чужой факт.
  const recClean = JSON.parse(domF.window.eval('JSON.stringify({ST:ST,snap:getSnap()})'));
  delete recClean.snap.korr;
  domK.window.eval('applySnap(' + JSON.stringify(recClean) + ')');
  const kT4 = JSON.parse(domK.window.eval('JSON.stringify(korrTotals())'));
  ok(kT4.delta === 0 && kT4.changed === 0, 'снимок без корректировки открывается чистым — факт прошлого заказа не протекает');

  // Экран корректировки: рендер поверх korrList.
  domF.window.eval('korrSet("lq' + fLi + '", 2); renderKorr()');
  const kBody = domF.window.document.getElementById('korr-body');
  ok(kBody && kBody.querySelectorAll('.krr').length > 0, 'экран корректировки строит строки');
  ok(kBody.querySelectorAll('.krr.changed').length >= 1, 'изменённые строки подсвечены классом changed');
  ok(kBody.querySelectorAll('.krg').length >= 2, 'строки сгруппированы по разделам');
  const kInp = domF.window.document.getElementById('kf-lq' + fLi);
  ok(kInp && kInp.value === '2', 'поле факта показывает введённое значение');
  ok(norm(domF.window.document.getElementById('korr-plan').textContent).indexOf('91 780') === 0, 'шапка экрана показывает план 91 780₸');
  const kNoteTxt = domF.window.document.getElementById('korr-note').textContent;
  ok(kNoteTxt.indexOf('Сэкономлено') === 0, 'подпись объясняет экономию человеческим языком');
  // Ввод в поле факта должен менять свод без перезагрузки.
  kInp.value = '1';
  kInp.onchange();
  const kT5 = JSON.parse(domF.window.eval('JSON.stringify(korrTotals())'));
  ok(kT5.delta === -18500 * 2 + 9000, 'правка прямо в поле пересчитала отклонение (с учётом докупленного уголка)');

  // ─────────────────────────────────────────────────────────────
  // v4.12: себестоимость план/факт в заказе (корректировка → финансы).
  // Ключевое: пустая себестоимость = "неизвестна", а НЕ ноль.
  // ─────────────────────────────────────────────────────────────
  console.log('── v4.12: себестоимость план/факт в заказе ──');
  var oc0 = att("ordersList_(__ordSS)");
  var o77c0 = null; oc0.orders.forEach(function(x){ if (x.num === '77') o77c0 = x; });
  ok(o77c0 && o77c0.costPlan === null && o77c0.costFact === null, 'заказ без корректировки: себестоимость неизвестна (null, не ноль)');
  ok(o77c0 && o77c0.costDelta === null, 'отклонение неизвестно, пока нет обеих половин');

  att("updateOrder_(__ordSS, { num:'77', costPlan:336480, costFact:317240 })");
  var oc1 = att("ordersList_(__ordSS)");
  var o77c1 = null; oc1.orders.forEach(function(x){ if (x.num === '77') o77c1 = x; });
  ok(o77c1.costPlan === 336480 && o77c1.costFact === 317240, 'план и факт себестоимости записались в заказ');
  ok(o77c1.costDelta === -19240, 'сервер отдаёт отклонение минус 19 240₸ (сэкономили)');

  att("updateOrder_(__ordSS, { num:'77', costFact:350000 })");
  var oc2 = att("ordersList_(__ordSS)");
  var o77c2 = null; oc2.orders.forEach(function(x){ if (x.num === '77') o77c2 = x; });
  ok(o77c2.costDelta === 350000 - 336480, 'перерасход считается тем же правилом (плюс 13 520₸)');

  var ocNeg = att("updateOrder_(__ordSS, { num:'77', costFact:-5 })");
  var oc3 = att("ordersList_(__ordSS)");
  var o77c3 = null; oc3.orders.forEach(function(x){ if (x.num === '77') o77c3 = x; });
  ok(ocNeg.ok === true && o77c3.costFact === 350000, 'отрицательная себестоимость отклонена, прежнее значение цело');

  att("updateOrder_(__ordSS, { num:'77', costFact:'' })");
  var oc4 = att("ordersList_(__ordSS)");
  var o77c4 = null; oc4.orders.forEach(function(x){ if (x.num === '77') o77c4 = x; });
  ok(o77c4.costFact === null && o77c4.costPlan === 336480, 'пустое значение снимает факт (снова «неизвестно»), план не тронут');
  ok(o77c4.costDelta === null, 'без факта отклонение опять неизвестно, а не равно минус плану');

  att("updateOrder_(__ordSS, { num:'77', costPlan:200000, costFact:0 })");
  var oc5 = att("ordersList_(__ordSS)");
  var o77c5 = null; oc5.orders.forEach(function(x){ if (x.num === '77') o77c5 = x; });
  ok(o77c5.costFact === 0 && o77c5.costDelta === -200000, 'явный ноль — это ноль, а не «неизвестно»');

  // Клиентская сторона: payload из корректировки.
  const kp = JSON.parse(domF.window.eval('JSON.stringify(korrPayload())'));
  const kpT = JSON.parse(domF.window.eval('JSON.stringify(korrTotals())'));
  ok(kp && kp.costPlan === Math.round(kpT.plan) && kp.costFact === Math.round(kpT.fact), 'korrPayload отдаёт план и факт себестоимости для карточки');
  ok(kp.delta === kp.costFact - kp.costPlan, 'отклонение в payload сходится с разницей план/факт');
  const domEmpty = bootPage(null);
  await waitReady(domEmpty);
  ok(domEmpty.window.eval('korrPayload()') === null, 'пустой расчёт не шлёт нулевую себестоимость — шлёт null');

  // ─────────────────────────────────────────────────────────────
  // v4.13: доход по факту на экране корректировки + пакет в rec (saveCalc).
  // ─────────────────────────────────────────────────────────────
  console.log('── v4.13: доход по факту + пакет для CRM ──');
  domF.window.eval('renderKorr()');
  const incL = domF.window.document.getElementById('korr-inc-l').textContent;
  const incExpectL = domF.window.eval('C.BL.inc') - kpT.delta;
  ok(norm(incL) === norm(domF.window.eval('fm(' + incExpectL + ')')), 'плитка «ЛДСП»: доход из панели Итог минус отклонение корректировки');
  const incP = domF.window.document.getElementById('korr-inc-p').textContent;
  const incExpectP = domF.window.eval('C.BP.inc') - kpT.delta;
  ok(norm(incP) === norm(domF.window.eval('fm(' + incExpectP + ')')), 'плитка «Плёнка» считается той же дельтой');
  const incK = domF.window.document.getElementById('korr-inc-k').textContent;
  const incExpectK = domF.window.eval('C.BK.inc') - kpT.delta;
  ok(norm(incK) === norm(domF.window.eval('fm(' + incExpectK + ')')), 'плитка «Краска» считается той же дельтой');

  // saveCalc: пакет korrPayload() прикладывается к rec.
  // doSaveCalc() — тело сохранения без гейта чек-листа (v4.14): здесь
  // проверяем именно передачу costPlan/costFact, чек-лист в этом сценарии
  // заведомо не заполнен и не является предметом теста.
  domF.window.eval('const rc=$("kp-client");if(rc)rc.value="Тест Клиент";doSaveCalc()');
  const histRec = JSON.parse(domF.window.eval('localStorage.getItem("mebeloff_hist")'))[0];
  ok(histRec.costPlan === kp.costPlan && histRec.costFact === kp.costFact && histRec.costDelta === kp.delta, 'saveCalc: costPlan/costFact/costDelta приложены к записи для CRM');

  // Без правок факта costPlan/costFact в rec всё равно присутствуют (план
  // известен с первой минуты) — но равны друг другу, отклонения нет.
  const domSaveEmpty = bootPage(null);
  await waitReady(domSaveEmpty);
  domSaveEmpty.window.eval('addLdsp();ST.ldsp[0]=0;document.getElementById("ls0").value="0";document.getElementById("lq0").value="2";recalc()');
  domSaveEmpty.window.eval('const rc2=$("kp-client");if(rc2)rc2.value="Без корректировки";doSaveCalc()');
  const histRec2 = JSON.parse(domSaveEmpty.window.eval('localStorage.getItem("mebeloff_hist")'))[0];
  ok(histRec2.costPlan === histRec2.costFact && histRec2.costDelta === 0, 'без правок факт равен плану — отклонение 0, поля присутствуют');

  // А вот на ПУСТОМ расчёте (ни одной позиции) полей нет вовсе — тут
  // saveCalc() в принципе заблокирован через alert, так что косвенно
  // проверяем это через сам korrPayload().
  ok(domSaveEmpty.window.eval('ST.ldsp=[];recalc();korrPayload()') === null, 'если убрать все позиции — korrPayload снова null');

  // ─────────────────────────────────────────────────────────────
  // v4.12: обязательные позиции (чек-лист) + тип заказа.
  // ─────────────────────────────────────────────────────────────
  console.log('── v4.12: обязательные позиции ──');
  const domR2 = bootPage(null, { failFetch: true });
  await waitReady(domR2);
  const rs0 = JSON.parse(domR2.window.eval('JSON.stringify(requiredStatus())'));
  ok(rs0.missing === rs0.total && rs0.total === 10, 'пустой расчёт без типа заказа: 10 универсальных пунктов, все не заполнены');
  const freshBanner = domR2.window.document.getElementById('req-banner');
  ok(freshBanner && freshBanner.querySelector('.req-pill'), 'банер виден сразу на чистой загрузке — без единого клика (recalc() ещё не вызывался)');
  ok(rs0.items.some(function(d){ return d.n === 'Штанга'; }) === false, 'без выбранного типа «Штанга» не проверяется вовсе');
  ok(rs0.items.some(function(d){ return d.n === 'Столешница'; }) === false, 'без выбранного типа кухонная тройка не проверяется вовсе');

  domR2.window.eval('addLdsp();ST.ldsp[0]=0;document.getElementById("ls0").value="0";document.getElementById("lq0").value="6";');
  domR2.window.eval('document.getElementById("hdf-qty").value="3";document.getElementById("krom-qty").value="85";');
  domR2.window.eval('addSimple("fldsp",DB.ldsp,"fldsp-list");document.getElementById("fldsps0").value="0";document.getElementById("fldspq0").value="4";');
  domR2.window.eval('document.getElementById("d-sat").value="15000";document.getElementById("d-pdm").value="5000";recalc()');
  const rs1 = JSON.parse(domR2.window.eval('JSON.stringify(requiredStatus())'));
  ok(rs1.missing === 4, 'корпус/фасад/доставка закрыты — осталось 4 (фурнитура)');
  ok(rs1.items.every(function(d){ return d.grp === 'Фурнитура'; }), 'все оставшиеся пункты из группы «Фурнитура»');

  domR2.window.eval('addCat("furn", DB.furn, "furn-list")');
  domR2.window.eval('document.getElementById("furnc0").value="Петля";document.getElementById("furnq0").value="24";uCP("furn",0)');
  const rs2 = JSON.parse(domR2.window.eval('JSON.stringify(requiredStatus())'));
  ok(rs2.missing === 3 && !rs2.items.some(function(d){ return d.n === 'Петля'; }), 'добавили петлю — закрылась именно она');

  // Ручки: категория «Руч-Скрытая» должна засчитываться как «Ручки».
  domR2.window.eval('addCat("furn", DB.furn, "furn-list")');
  domR2.window.eval('document.getElementById("furnc1").value="Руч-Скрытая";document.getElementById("furnv1").value="96мм";uCP("furn",1);document.getElementById("furnq1").value="10";uCP("furn",1)');
  const rs3 = JSON.parse(domR2.window.eval('JSON.stringify(requiredStatus())'));
  ok(!rs3.items.some(function(d){ return d.n === 'Ручки'; }), 'категория «Руч-Скрытая» засчитана как «Ручки»');

  // Тип заказа переключает видимость групп.
  domR2.window.eval('ordSet("shk")');
  const rs4 = JSON.parse(domR2.window.eval('JSON.stringify(requiredStatus())'));
  ok(rs4.total === 11 && rs4.items.some(function(d){ return d.n === 'Штанга'; }), 'тип «Шкаф» добавляет пункт «Штанга» (итого 11 пунктов)');
  ok(!rs4.items.some(function(d){ return d.n === 'Столешница'; }), 'тип «Шкаф» не требует кухонную тройку');

  domR2.window.eval('ordSet("kuh")');
  const rs5 = JSON.parse(domR2.window.eval('JSON.stringify(requiredStatus())'));
  ok(!rs5.items.some(function(d){ return d.n === 'Штанга'; }), 'тип «Кухня» не требует штангу');
  ok(rs5.items.filter(function(d){ return d.grp === 'Кухня'; }).length === 3, 'тип «Кухня» добавляет все три кухонных пункта');

  // Дубль-прайс: столешница через «Кухня доп.» тоже засчитывается.
  domR2.window.eval('ST.kStol.push(0);recalc()');
  const rs6 = JSON.parse(domR2.window.eval('JSON.stringify(requiredStatus())'));
  ok(!rs6.items.some(function(d){ return d.n === 'Столешница'; }), 'столешница через «Кухня доп.» тоже закрывает требование (та же позиция, другая карточка)');

  domR2.window.eval('ordSet("both")');
  const rs7 = JSON.parse(domR2.window.eval('JSON.stringify(requiredStatus())'));
  ok(rs7.items.some(function(d){ return d.n === 'Штанга'; }) && rs7.items.some(function(d){ return d.n === 'Соединитель угловой'; }), 'тип «Шкаф+Кухня» требует и штангу, и кухонные пункты');

  // Банер: рендер и текст.
  const rBanner = domR2.window.document.getElementById('req-banner');
  ok(rBanner && rBanner.querySelector('.req-pill.warn'), 'банер показывает предупреждение, пока есть незаполненное');
  ok(rBanner.textContent.indexOf('Штанга') >= 0, 'банер перечисляет незаполненные пункты по именам');
  const onBtn = domR2.window.document.querySelector('.ordt-b.on');
  ok(onBtn && onBtn.getAttribute('data-t') === 'both', 'кнопка типа заказа подсвечена активной');

  // Круг снимка: тип заказа переживает сохранение/открытие.
  const recT = JSON.parse(domR2.window.eval('JSON.stringify({ST:ST,snap:getSnap()})'));
  const domT = bootPage(null, { failFetch: true });
  await waitReady(domT);
  domT.window.eval('applySnap(' + JSON.stringify(recT) + ')');
  ok(domT.window.eval('ORDT') === 'both', 'тип заказа пережил круг снимка');
  const rsT = JSON.parse(domT.window.eval('JSON.stringify(requiredStatus())'));
  ok(rsT.total === rs7.total && rsT.missing === rs7.missing, 'после круга снимка чек-лист пересчитался идентично');

  // fullReset обнуляет тип заказа.
  domR2.window.eval('fullReset()');
  ok(domR2.window.eval('ORDT') === '', 'fullReset сбрасывает тип заказа');
  const rs8 = JSON.parse(domR2.window.eval('JSON.stringify(requiredStatus())'));
  ok(rs8.total === 10, 'после fullReset чек-лист снова только универсальные 10 пунктов');

  // ─────────────────────────────────────────────────────────────
  // v4.14: блокировка сохранения неполного расчёта + модалка подтверждения.
  // ─────────────────────────────────────────────────────────────
  console.log('── v4.14: защита от сохранения неполного расчёта ──');

  // Сценарий А: чек-лист НЕ закрыт (заполнена только пара позиций) —
  // saveCalc() не должен писать в историю, вместо этого открывается модалка.
  const domSaveA = bootPage(null, { failFetch: true });
  await waitReady(domSaveA);
  domSaveA.window.eval('addLdsp();ST.ldsp[0]=0;document.getElementById("ls0").value="0";document.getElementById("lq0").value="2";recalc()');
  ok(JSON.parse(domSaveA.window.eval('JSON.stringify(requiredStatus())')).missing > 0, 'подготовка: чек-лист заведомо не закрыт');
  domSaveA.window.eval('const rcA=$("kp-client");if(rcA)rcA.value="Неполный";saveCalc()');
  ok(domSaveA.window.eval('localStorage.getItem("mebeloff_hist")') === null, 'saveCalc() с незакрытым чек-листом НЕ пишет в историю');
  const modalA = domSaveA.window.document.getElementById('req-save-modal');
  ok(modalA && modalA.style.display === 'flex', 'вместо сохранения открылась модалка подтверждения');
  const listA = domSaveA.window.document.getElementById('req-save-list');
  ok(listA && listA.textContent.indexOf('Ножки') >= 0 && listA.textContent.indexOf('Телескоп') >= 0, 'модалка перечисляет незаполненные пункты по именам');
  const btnA = domSaveA.window.document.getElementById('req-save-btn');
  ok(btnA && btnA.disabled === true, 'кнопка «Сохранить всё равно» заблокирована, пока не отмечена галочка');

  // Отмечаем галочку — кнопка разблокируется.
  domSaveA.window.eval('const chA=$("req-save-check");chA.checked=true;reqSaveToggle()');
  ok(btnA.disabled === false, 'галочка «Понимаю, сохраняю как есть» разблокирует кнопку');

  // Жмём «Сохранить всё равно» — теперь запись должна появиться в истории,
  // несмотря на незакрытый чек-лист, и модалка закрывается.
  domSaveA.window.eval('reqSaveForce()');
  const histA = JSON.parse(domSaveA.window.eval('localStorage.getItem("mebeloff_hist")'));
  ok(Array.isArray(histA) && histA.length === 1 && histA[0].client === 'Неполный', 'принудительное сохранение записало неполный расчёт в историю');
  ok(modalA.style.display === 'none', 'после принудительного сохранения модалка закрылась');

  // «Вернуться и заполнить» — просто закрывает модалку, ничего не сохраняя.
  domSaveA.window.eval('addLdsp();ST.ldsp[1]=0;document.getElementById("ls1").value="0";document.getElementById("lq1").value="1";recalc();saveCalc()');
  ok(domSaveA.window.document.getElementById('req-save-modal').style.display === 'flex', 'повторное сохранение неполного расчёта снова открывает модалку');
  domSaveA.window.eval('closeReqSaveModal()');
  ok(domSaveA.window.document.getElementById('req-save-modal').style.display === 'none', '«Вернуться и заполнить» закрывает модалку без сохранения');
  const histA2 = JSON.parse(domSaveA.window.eval('localStorage.getItem("mebeloff_hist")'));
  ok(histA2.length === 1, 'отмена в модалке не добавила вторую запись в историю');

  // Сценарий Б: чек-лист полностью закрыт (универсальные 10 пунктов, тип
  // заказа не выбран) — saveCalc() сохраняет сразу, без модалки.
  const domSaveB = bootPage(null, { failFetch: true });
  await waitReady(domSaveB);
  domSaveB.window.eval('addLdsp();ST.ldsp[0]=0;document.getElementById("ls0").value="0";document.getElementById("lq0").value="6";');
  domSaveB.window.eval('document.getElementById("hdf-qty").value="3";document.getElementById("krom-qty").value="85";');
  domSaveB.window.eval('addSimple("fldsp",DB.ldsp,"fldsp-list");document.getElementById("fldsps0").value="0";document.getElementById("fldspq0").value="4";');
  domSaveB.window.eval('document.getElementById("d-sat").value="15000";document.getElementById("d-pdm").value="5000";');
  domSaveB.window.eval('addCat("furn",DB.furn,"furn-list");document.getElementById("furnc0").value="Петля";document.getElementById("furnq0").value="24";uCP("furn",0)');
  domSaveB.window.eval('addCat("furn",DB.furn,"furn-list");document.getElementById("furnc1").value="Ножки";document.getElementById("furnq1").value="4";uCP("furn",1)');
  domSaveB.window.eval('addCat("furn",DB.furn,"furn-list");document.getElementById("furnc2").value="Руч-Скрытая";document.getElementById("furnv2").value="96мм";uCP("furn",2);document.getElementById("furnq2").value="10";uCP("furn",2)');
  domSaveB.window.eval('addCat("furn",DB.furn,"furn-list");document.getElementById("furnc3").value="Телескоп";document.getElementById("furnq3").value="10";uCP("furn",3);recalc()');
  const rsB = JSON.parse(domSaveB.window.eval('JSON.stringify(requiredStatus())'));
  ok(rsB.missing === 0, 'подготовка: чек-лист закрыт полностью (все 10 универсальных пунктов)');
  domSaveB.window.eval('const rcB=$("kp-client");if(rcB)rcB.value="Полный";saveCalc()');
  ok(domSaveB.window.document.getElementById('req-save-modal').style.display !== 'flex', 'при закрытом чек-листе модалка не открывается');
  const histB = JSON.parse(domSaveB.window.eval('localStorage.getItem("mebeloff_hist")'));
  ok(Array.isArray(histB) && histB.length === 1 && histB[0].client === 'Полный', 'saveCalc() с закрытым чек-листом сохраняет сразу, без подтверждения');

  console.log('');
  console.log('ИТОГ: ' + PASS + ' прошло, ' + FAIL + ' упало');
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.log('✗ Тест упал: ' + e.message); process.exit(1); });
