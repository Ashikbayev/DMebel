// ============================================================
// MebelOFF — Code.gs v2 (цены + СРМ-заказы)
// ============================================================
// Что нового относительно v1:
//   • doPost — запись заказов с сайта (лист "Заказы", ключ — № заказа).
//     Лист создаётся автоматически при первом обращении.
//   • doGet?action=orders — список заказов (без снимков, быстрый).
//   • doGet?action=order&num=N — один заказ со снимком расчёта.
//   Обычный doGet (без action) работает КАК РАНЬШЕ — цены для сайта.
//
// ⚠️ После вставки этого кода — ОБЯЗАТЕЛЬНО новый деплой
//    (Развернуть → Управление развёртываниями → карандаш → Новая версия).
// ⚠️ CRM_TOKEN ниже должен совпадать с TOKEN в crm.js на сайте.
// ============================================================

var CRM_TOKEN = 'MebelOFF-2026';
var ORDERS_SHEET = 'Заказы';
// Колонки листа "Заказы" (порядок менять нельзя — код ссылается по номерам):
var ORDERS_HEADER = ['№','Статус','Город','Клиент','Телефон','Адрес/Объект','Тип мебели','Примечание',
  'Предв. цена','Согл. цена','Аванс','Оплачено','Долг','Дата договора','Дата установки',
  'Итог ЛДСП','Итог Плёнка','Итог Краска','Обновлён','Снимок1','Снимок2','Снимок3'];
// Индексы (1-based)
var COL = { num:1, status:2, city:3, client:4, phone:5, obj:6, furn:7, note:8,
  pred:9, sogl:10, avans:11, paid:12, debt:13, dogDate:14, mountDate:15,
  totL:16, totP:17, totK:18, updated:19, snap1:20, snap2:21, snap3:22 };

function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const callback = e && e.parameter && e.parameter.callback;
  const action = e && e.parameter && e.parameter.action;

  // ── СРМ: список заказов / один заказ ────────────────────────
  if (action === 'orders') return out_(ordersList_(ss), callback);
  if (action === 'order')  return out_(orderOne_(ss, e.parameter.num), callback);

  // ── Дальше — прежний код v1 без изменений ───────────────────
  function getSheet(name) {
    const sh = ss.getSheetByName(name);
    if (!sh) return [];
    return sh.getDataRange().getValues().slice(1);
  }

  const ldsp = getSheet('ЛДСП').map(r => ({n: r[0], p: r[1]}));
  const hdf_p = ss.getSheetByName('ЛДСП').getRange('D2').getValue();
  const krom_p = ss.getSheetByName('ЛДСП').getRange('E2').getValue();
  const fas_plen = getSheet('Фасад_Плёнка').map(r => ({n: r[0], p: r[1]}));
  const fas_kr = getSheet('Фасад_Краска').map(r => ({n: r[0], p: r[1]}));
  const furn = getSheet('Фурнитура').map(r => ({cat: r[0], vid: r[1], firm: r[2], p: r[3]}));
  const kuh = getSheet('Кухня').map(r => ({cat: r[0], vid: r[1], p: r[2]}));
  const svet = getSheet('Подсветка').map(r => ({cat: r[0], vid: r[1], p: r[2]}));
  const works = getSheet('Работы').map(r => ({n: r[0], p: r[1]}));

  const vit_sh = ss.getSheetByName('Витрина');
  const vit_rows = vit_sh.getDataRange().getValues().slice(1);
  const steklo = {};
  let profil_uzkiy=2000, profil_shirokiy=3000, ugolok_uzkiy=1500, ugolok_shirokiy=2000;
  let navesh=1000, prisadka=1500, uplotnitel=400;
  vit_rows.forEach(r => {
    const k = r[0], v = r[1];
    if (k.startsWith('Стекло ')) steklo[k.replace('Стекло ','')] = v;
    if (k === 'Профиль узкий') profil_uzkiy = v;
    if (k === 'Профиль широкий') profil_shirokiy = v;
    if (k === 'Уголок узкий') ugolok_uzkiy = v;
    if (k === 'Уголок широкий') ugolok_shirokiy = v;
    if (k === 'Навес') navesh = v;
    if (k === 'Присадка') prisadka = v;
    if (k === 'Уплотнитель') uplotnitel = v;
  });

  const moika = readMoika_(ss);

  const kStol      = readAccSheet_(ss, 'ДопКухня_Столешница', ['tip','cvet']);
  const kSushilka  = readAccSheet_(ss, 'ДопКухня_Сушилка',    ['tip','tip2','firma','cvet']);
  const kTelesk    = readAccSheet_(ss, 'ДопКухня_Телескоп',   ['tip','firma','razmer']);
  const kPetlya    = readAccSheet_(ss, 'ДопКухня_Петля',      ['tip','firma']);
  const kRuchka    = readAccSheet_(ss, 'ДопКухня_Ручка',      ['tip','firma','cvet','razmer']);
  const kNozhki    = readAccSheet_(ss, 'ДопКухня_Ножки',      ['tip','firma','cvet','razmer']);
  const kPodsvetka = readAccSheet_(ss, 'ДопКухня_Подсветка',  ['tip','tip2','cvet','razmer']);
  const kKargo     = readAccSheet_(ss, 'ДопКухня_Карго',      ['tip','firma','razmer']);

  const kPlintus   = readSimpleSheet_(ss, 'ДопКухня_Плинтус');
  const kVytyazhka = readSimpleSheet_(ss, 'ДопКухня_Вытяжка');

  const ldspW = ldsp.map(function(x){ return {name: x.n, price: x.p}; });
  const facadePlenka = fas_plen.map(function(x){ return {name: x.n, price: x.p}; });
  const facadeKraska = fas_kr.map(function(x){ return {name: x.n, price: x.p}; });
  const hdf = hdf_p;
  const edgeThin = krom_p;
  const hingeCatalog = buildHingeCatalog_(furn);
  const slideCatalog = buildSlideCatalog_(furn);

  const data = {
    ldsp, hdf_p, krom_p, fas_plen, fas_kr,
    furn, kuh, svet, works,
    vit: {steklo, profil_uzkiy, profil_shirokiy, ugolok_uzkiy, ugolok_shirokiy, navesh, prisadka, uplotnitel},
    moika,
    kStol, kSushilka, kTelesk, kPetlya, kRuchka, kNozhki, kPodsvetka, kKargo,
    kPlintus, kVytyazhka,
    ldspW, facadePlenka, facadeKraska, hdf, edgeThin, hingeCatalog, slideCatalog
  };

  return out_(data, callback);
}

// ── Единый вывод: JSON или JSONP ─────────────────────────────
function out_(obj, callback) {
  const json = JSON.stringify(obj);
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// СРМ: ЗАПИСЬ (doPost)
// ============================================================
// Сайт шлёт POST с телом-JSON: {token, action, order:{...}}
// Ответ: {ok:true, ...} либо {ok:false, error:'...'}
function doPost(e) {
  var res = { ok: false };
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // защита от одновременной записи двух запросов
    var req = JSON.parse(e.postData.contents);
    if (req.token !== CRM_TOKEN) { res.error = 'неверный токен'; return out_(res, null); }
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (req.action === 'saveOrder')        res = saveOrder_(ss, req.order || {});
    else if (req.action === 'updateOrder') res = updateOrder_(ss, req.order || {});
    else if (req.action === 'createOrder') res = createOrder_(ss, req.order || {});
    else res.error = 'неизвестное действие: ' + req.action;
  } catch (err) {
    res = { ok: false, error: String(err) };
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
  return out_(res, null);
}

// Новый заказ без расчёта (со звонка): № присваивается автоматически = макс. существующий + 1
function createOrder_(ss, o) {
  var sh = ordersSheet_(ss);
  var last = sh.getLastRow();
  var maxN = 0;
  if (last >= 2) {
    var nums = sh.getRange(2, COL.num, last - 1, 1).getValues();
    nums.forEach(function(r){
      var n = parseInt(String(r[0]).replace(/\D/g, ''), 10);
      if (n && n > maxN) maxN = n;
    });
  }
  var num = o.num ? String(o.num) : String(maxN + 1);
  if (findRowByNum_(sh, num) > 0) return { ok: false, error: 'заказ №' + num + ' уже существует' };
  var row = last + 1;
  sh.getRange(row, COL.num).setValue(num);
  sh.getRange(row, COL.status).setValue(o.status || 'Замер');
  if (o.client) sh.getRange(row, COL.client).setValue(o.client);
  if (o.phone)  sh.getRange(row, COL.phone).setValue(o.phone);
  if (o.city)   sh.getRange(row, COL.city).setValue(o.city);
  if (o.furn)   sh.getRange(row, COL.furn).setValue(o.furn);
  if (o.obj)    sh.getRange(row, COL.obj).setValue(o.obj);
  if (o.note)   sh.getRange(row, COL.note).setValue(o.note);
  sh.getRange(row, COL.updated).setValue(new Date());
  return { ok: true, num: num };
}

// Лист "Заказы": вернуть, создать при отсутствии
function ordersSheet_(ss) {
  var sh = ss.getSheetByName(ORDERS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(ORDERS_SHEET);
    sh.getRange(1, 1, 1, ORDERS_HEADER.length).setValues([ORDERS_HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.hideColumns(COL.snap1, 3);
  }
  return sh;
}

// Поиск строки по № (колонка 1). Возвращает номер строки или -1.
function findRowByNum_(sh, num) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var vals = sh.getRange(2, COL.num, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) === String(num)) return i + 2;
  }
  return -1;
}

// Сохранение расчёта: upsert по №.
// Новая строка: статус "Расчет", Предв. цена.
// Существующая: обновляем цены/снимок/клиента, НЕ трогаем статус,
// город, телефон, тип мебели, примечание, оплаты — их ведёшь руками.
function saveOrder_(ss, o) {
  if (!o.num) return { ok: false, error: 'нет № заказа' };
  var sh = ordersSheet_(ss);
  var row = findRowByNum_(sh, o.num);
  var isNew = row < 0;
  var prevClient = '';
  if (!isNew) prevClient = String(sh.getRange(row, COL.client).getValue() || '');
  if (isNew) {
    row = sh.getLastRow() + 1;
    sh.getRange(row, COL.num).setValue(String(o.num));
    sh.getRange(row, COL.status).setValue('Расчет');
    sh.getRange(row, COL.pred).setValue(o.predPrice || 0);
  }
  if (o.client) sh.getRange(row, COL.client).setValue(o.client);
  if (o.obj)    sh.getRange(row, COL.obj).setValue(o.obj);
  sh.getRange(row, COL.totL).setValue(o.totL || 0);
  sh.getRange(row, COL.totP).setValue(o.totP || 0);
  sh.getRange(row, COL.totK).setValue(o.totK || 0);
  sh.getRange(row, COL.updated).setValue(new Date());
  sh.getRange(row, COL.snap1).setValue(o.snap1 || '');
  sh.getRange(row, COL.snap2).setValue(o.snap2 || '');
  sh.getRange(row, COL.snap3).setValue(o.snap3 || '');
  var res = { ok: true, row: row, created: isNew };
  if (!isNew && prevClient && o.client && prevClient !== o.client) res.prevClient = prevClient;
  return res;
}

// Договор сформирован: статус, Согл. цена, Аванс, Дата договора.
// Если заказа с таким № нет (договор без сохранения расчёта) — создаём.
function updateOrder_(ss, o) {
  if (!o.num) return { ok: false, error: 'нет № заказа' };
  var sh = ordersSheet_(ss);
  var row = findRowByNum_(sh, o.num);
  var isNew = row < 0;
  if (isNew) {
    row = sh.getLastRow() + 1;
    sh.getRange(row, COL.num).setValue(String(o.num));
    if (o.client) sh.getRange(row, COL.client).setValue(o.client);
    if (o.obj)    sh.getRange(row, COL.obj).setValue(o.obj);
  }
  if (o.status)  sh.getRange(row, COL.status).setValue(o.status);
  if (o.client)  sh.getRange(row, COL.client).setValue(o.client);
  if (o.obj)     sh.getRange(row, COL.obj).setValue(o.obj);
  if (o.city !== undefined)      sh.getRange(row, COL.city).setValue(o.city);
  if (o.phone !== undefined)     sh.getRange(row, COL.phone).setValue(o.phone);
  if (o.furn !== undefined)      sh.getRange(row, COL.furn).setValue(o.furn);
  if (o.note !== undefined)      sh.getRange(row, COL.note).setValue(o.note);
  if (o.mountDate !== undefined) sh.getRange(row, COL.mountDate).setValue(o.mountDate);
  if (o.paid !== undefined)      sh.getRange(row, COL.paid).setValue(o.paid);
  if (o.soglPrice !== undefined) sh.getRange(row, COL.sogl).setValue(o.soglPrice);
  if (o.avans !== undefined)     sh.getRange(row, COL.avans).setValue(o.avans);
  var soglV = Number(sh.getRange(row, COL.sogl).getValue()) || 0;
  var avV   = Number(sh.getRange(row, COL.avans).getValue()) || 0;
  var paidV = Number(sh.getRange(row, COL.paid).getValue()) || 0;
  if (soglV > 0) sh.getRange(row, COL.debt).setValue(soglV - avV - paidV);
  if (o.status === 'Договор')    sh.getRange(row, COL.dogDate).setValue(new Date());
  sh.getRange(row, COL.updated).setValue(new Date());
  return { ok: true, row: row, created: isNew };
}

// ============================================================
// СРМ: ЧТЕНИЕ (для страницы СРМ — этап 2, деплоить заново не придётся)
// ============================================================
// Список заказов БЕЗ снимков — быстрый.
function ordersList_(ss) {
  var sh = ss.getSheetByName(ORDERS_SHEET);
  if (!sh || sh.getLastRow() < 2) return { ok: true, orders: [] };
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, COL.updated).getValues();
  var orders = vals.filter(function(r){ return r[COL.num - 1] !== ''; }).map(function(r){
    return {
      num: String(r[COL.num - 1]), status: r[COL.status - 1], city: r[COL.city - 1],
      client: r[COL.client - 1], phone: String(r[COL.phone - 1] || ''), obj: r[COL.obj - 1],
      furn: r[COL.furn - 1], note: r[COL.note - 1],
      pred: r[COL.pred - 1] || 0, sogl: r[COL.sogl - 1] || 0,
      avans: r[COL.avans - 1] || 0, paid: r[COL.paid - 1] || 0,
      dogDate: r[COL.dogDate - 1], mountDate: r[COL.mountDate - 1],
      totL: r[COL.totL - 1] || 0, totP: r[COL.totP - 1] || 0, totK: r[COL.totK - 1] || 0,
      updated: r[COL.updated - 1]
    };
  });
  return { ok: true, orders: orders };
}

// Один заказ СО снимком расчёта.
function orderOne_(ss, num) {
  var sh = ss.getSheetByName(ORDERS_SHEET);
  if (!sh) return { ok: false, error: 'листа "Заказы" ещё нет' };
  var row = findRowByNum_(sh, num);
  if (row < 0) return { ok: false, error: 'заказ №' + num + ' не найден' };
  var r = sh.getRange(row, 1, 1, ORDERS_HEADER.length).getValues()[0];
  var snap = String(r[COL.snap1 - 1] || '') + String(r[COL.snap2 - 1] || '') + String(r[COL.snap3 - 1] || '');
  return {
    ok: true,
    order: {
      num: String(r[COL.num - 1]), status: r[COL.status - 1], client: r[COL.client - 1],
      obj: r[COL.obj - 1], sogl: r[COL.sogl - 1] || 0, pred: r[COL.pred - 1] || 0,
      snapshot: snap
    }
  };
}

// ── Прежние функции v1 — без изменений ──────────────────────
function buildHingeCatalog_(furn){
  var seen = {};
  var out = [];
  furn.forEach(function(r){
    if (r.cat !== 'Петля') return;
    if (seen[r.firm]) return;
    seen[r.firm] = true;
    out.push({ brand: r.firm, price: r.p });
  });
  return out;
}

function buildSlideCatalog_(furn){
  var slideCats = ['Телескоп','Телескоп-Д','Телескоп-Д черный','СМ-полный','СМ-частичный','Push-open'];
  var out = [];
  furn.forEach(function(r){
    if (slideCats.indexOf(r.cat) < 0) return;
    var len = parseInt(String(r.vid).replace(/\D/g,''), 10) || 0;
    out.push({ brand: r.firm, type: r.cat, length: len, price: r.p });
  });
  return out;
}

function readMoika_(ss){
  var sh = ss.getSheetByName('ДопКухня_Мойка');
  if(!sh) return [];
  var rows = sh.getDataRange().getValues();
  rows.shift();
  return rows.filter(function(r){ return r[0]; }).map(function(r){
    return {
      tip: String(r[0]||''), razmer: String(r[1]||''), cvet: String(r[2]||''),
      base: Number(r[3])||0, work: Number(r[4])||0,
      des: Number(r[5])||0, our: Number(r[6])||0, disc: Number(r[7])||0
    };
  });
}

function readAccSheet_(ss, sheetName, attrs){
  var sh = ss.getSheetByName(sheetName);
  if(!sh) return [];
  var rows = sh.getDataRange().getValues();
  rows.shift();
  return rows.filter(function(r){ return r[0]; }).map(function(r){
    var obj = {};
    for (var i=0;i<attrs.length;i++){ obj[attrs[i]] = String(r[i]||''); }
    var b = attrs.length;
    obj.base = Number(r[b])||0;
    obj.work = Number(r[b+1])||0;
    obj.des  = Number(r[b+2])||0;
    obj.our  = Number(r[b+3])||0;
    obj.disc = Number(r[b+4])||0;
    return obj;
  });
}

function readSimpleSheet_(ss, sheetName){
  var sh = ss.getSheetByName(sheetName);
  if(!sh) return [];
  var rows = sh.getDataRange().getValues();
  rows.shift();
  return rows.filter(function(r){ return r[0]; }).map(function(r){
    return { tip: String(r[0]||''), p: Number(r[1])||0 };
  });
}
