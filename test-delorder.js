// Тесты удаления заказа (v4.14) — Code.gs выполняется на заглушке
// SpreadsheetApp. До этого серверный код не был покрыт вообще, а править
// delOrder_ вслепую опасно: он удаляет строки в шести листах.
//
// Заглушка реализует ровно то, чем пользуется delOrder_:
// getSheetByName, getLastRow, getRange().getValue()/setValue(), deleteRow.
const fs = require('fs');
let PASS = 0, FAIL = 0;
function ok(c, n){ if (c) { PASS++; console.log('  \u2713 ' + n); } else { FAIL++; console.log('  \u2717 FAIL: ' + n); } }

// ── Заглушка листа ───────────────────────────────────────────────
function Sheet(name, rows){
  this.name = name;
  this.rows = rows; // массив массивов, включая строку заголовка
}
Sheet.prototype.getLastRow = function(){ return this.rows.length; };
Sheet.prototype.getRange = function(r, c, nr, nc){
  const sh = this;
  return {
    getValue: function(){
      const row = sh.rows[r-1];
      return row ? (row[c-1] === undefined ? '' : row[c-1]) : '';
    },
    setValue: function(v){
      while(sh.rows.length < r) sh.rows.push([]);
      const row = sh.rows[r-1];
      while(row.length < c) row.push('');
      row[c-1] = v;
      return this;
    },
    getValues: function(){
      const out = [];
      for(let i = 0; i < (nr||1); i++){
        const row = sh.rows[r-1+i] || [];
        const cells = [];
        for(let j = 0; j < (nc||1); j++) cells.push(row[c-1+j] === undefined ? '' : row[c-1+j]);
        out.push(cells);
      }
      return out;
    },
    setValues: function(v){
      for(let i = 0; i < v.length; i++){
        while(sh.rows.length < r+i) sh.rows.push([]);
        const row = sh.rows[r-1+i];
        for(let j = 0; j < v[i].length; j++){ while(row.length < c+j) row.push(''); row[c-1+j] = v[i][j]; }
      }
      return { setFontWeight: function(){ return this; } };
    },
    setFontWeight: function(){ return this; },
    setNumberFormat: function(){ return this; },
    clearContent: function(){ return this; }
  };
};
Sheet.prototype.deleteRow = function(r){ this.rows.splice(r-1, 1); };
Sheet.prototype.setFrozenRows = function(){};
Sheet.prototype.hideColumns = function(){};
Sheet.prototype.insertSheet = function(){};

function Book(sheets){ this.sheets = sheets; }
Book.prototype.getSheetByName = function(n){ return this.sheets[n] || null; };
Book.prototype.insertSheet = function(n){ this.sheets[n] = new Sheet(n, [[]]); return this.sheets[n]; };

// Файлы на Диске, отправленные в корзину
const TRASHED = [];

// ── Загрузка Code.gs в песочницу ─────────────────────────────────
const src = fs.readFileSync('Code.gs', 'utf8');
const sandbox = {
  SpreadsheetApp: { getActiveSpreadsheet: function(){ return null; } },
  DriveApp: {
    getFileById: function(id){
      return { setTrashed: function(){ TRASHED.push(id); } };
    }
  },
  Utilities: { formatDate: function(d){ return String(d); } },
  Logger: { log: function(){} },
  PropertiesService: {
    getScriptProperties: function(){
      return { getProperty: function(){ return null; }, setProperty: function(){} };
    }
  },
  console: console
};
const vm = require('vm');
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

// ── Данные: заказ №46 наследил во ВСЕХ листах ────────────────────
function makeBook(){
  return new Book({
    'Заказы': new Sheet('Заказы', [
      ['№','Статус'],
      ['45','Договор'],
      ['46','Договор'],
      ['47','Замер']
    ]),
    'Изменения': new Sheet('Изменения', [
      ['id','№','дата','описание','сумма'],
      ['c1','46','2026-07-01','доп фасад',50000],
      ['c2','45','2026-07-01','другое',10000]
    ]),
    'Рекламации': new Sheet('Рекламации', [
      ['id','№','дата','этап'],
      ['r1','46','2026-07-01','Принята']
    ]),
    'Задачи': new Sheet('Задачи', [
      ['id','№','текст'],
      ['t1','46','позвонить'],
      ['t2','47','замерить']
    ]),
    'Финансы': new Sheet('Финансы', [
      ['id','дата','тип','кат','сумма','№','коммент'],
      ['f1','2026-07-01','Приход','Аванс',151020,'46','аванс по договору'],
      ['f2','2026-07-01','Приход','Аванс',50000,'45','чужой']
    ]),
    // ↓ эти четыре при удалении НЕ чистились
    'ДопРаботы': new Sheet('ДопРаботы', [
      ['id','№','empId','описание','сумма','дата'],
      ['d1','46','e2','сборка',15000,'2026-07-05'],
      ['d2','45','e2','другое',5000,'2026-07-05']
    ]),
    'Вложения': new Sheet('Вложения', [
      ['id','№','вид','имя','fileId'],
      ['a1','46','фото','кухня.jpg','FILE_46'],
      ['a2','45','фото','чужое.jpg','FILE_45']
    ]),
    'Статусы': new Sheet('Статусы', [
      ['id','№','статус','дата'],
      ['s1','46','Замер','2026-06-01'],
      ['s2','46','Договор','2026-07-01'],
      ['s3','47','Замер','2026-07-10']
    ]),
    'Склад': new Sheet('Склад', [
      ['id','дата','тип','ключ','имя','ед','кол','№','коммент'],
      ['k1','2026-07-01','Расход','ldsp','ЛДСП','лист',12,'46','на заказ'],
      ['k2','2026-07-01','Приход','ldsp','ЛДСП','лист',50,'','закупка']
    ])
  });
}

function numsIn(sheet, col){
  const out = [];
  for(let i = 1; i < sheet.rows.length; i++) out.push(String(sheet.rows[i][col-1]));
  return out;
}

console.log('\u2500\u2500 Удаление заказа \u211646: следов остаться не должно \u2500\u2500');
const book = makeBook();
const res = sandbox.delOrder_(book, '46');

ok(res && res.ok === true, 'delOrder_ отработал без ошибки');
ok(numsIn(book.sheets['Заказы'], 1).indexOf('46') < 0, 'Заказы: строка удалена');
ok(numsIn(book.sheets['Изменения'], 2).indexOf('46') < 0, 'Изменения: удалены');
ok(numsIn(book.sheets['Рекламации'], 2).indexOf('46') < 0, 'Рекламации: удалены');
ok(numsIn(book.sheets['Задачи'], 2).indexOf('46') < 0, 'Задачи: удалены');
ok(numsIn(book.sheets['Финансы'], 6).indexOf('46') < 0, 'Финансы: номер отвязан (деньги остаются в кассе)');
ok(book.sheets['Финансы'].rows.length === 3, 'Финансы: строки НЕ удалены — реальные деньги не пропали');

// Раньше эти четыре проверки падали — данные оставались
ok(numsIn(book.sheets['ДопРаботы'], 2).indexOf('46') < 0, 'ДопРаботы: удалены — иначе за удалённый заказ продолжают платить');
ok(numsIn(book.sheets['Вложения'], 2).indexOf('46') < 0, 'Вложения: удалены');
ok(TRASHED.indexOf('FILE_46') >= 0, 'Вложения: файл отправлен в корзину Диска, а не брошен');
ok(TRASHED.indexOf('FILE_45') < 0, 'Вложения: чужой файл не тронут');
ok(numsIn(book.sheets['Статусы'], 2).indexOf('46') < 0, 'Статусы: журнал удалён — иначе новый заказ наследует чужую историю');
ok(numsIn(book.sheets['Склад'], 8).indexOf('46') < 0, 'Склад: номер отвязан');
ok(book.sheets['Склад'].rows.length === 3, 'Склад: движения НЕ удалены — материал физически двигался, остатки не переписываем задним числом');

// Чужие заказы не задеты
ok(numsIn(book.sheets['Изменения'], 2).indexOf('45') >= 0, 'заказ №45 не задет: изменения на месте');
ok(numsIn(book.sheets['ДопРаботы'], 2).indexOf('45') >= 0, 'заказ №45 не задет: доп. работы на месте');
ok(numsIn(book.sheets['Статусы'], 2).indexOf('47') >= 0, 'заказ №47 не задет: журнал на месте');

console.log('');
console.log('\u2500\u2500 Выдача номеров \u2500\u2500');
// УДАЛЁННЫЙ номер переиспользовать МОЖНО: после полной дочистки выше
// наследовать нечего. Журнал статусов заказа тоже удалён, поэтому номер
// штатно освобождается — это ожидаемое поведение, а не баг.
const book2 = makeBook();
sandbox.delOrder_(book2, '47');   // 47 — самый большой
const cr2 = sandbox.createOrder_(book2, { client: 'Новый клиент' });
ok(cr2 && cr2.ok === true, 'createOrder_ отработал');
ok(String(cr2.num) === '47',
  'номер удалённого \u211647 переиспользуется — следов не осталось, это безопасно');

// АРХИВНЫЙ номер переиспользовать НЕЛЬЗЯ: строка заказа уехала в другой
// файл, но сам заказ жив. Если выдать его номер новому заказу, архивный
// станет невозвратимым — restoreFromArchive_ отклоняет занятый номер.
// Архивация журнал статусов не трогает, он и защищает номер.
const book3 = makeBook();
const shO = book3.sheets['Заказы'];
for (let r = shO.rows.length - 1; r >= 1; r--) {
  if (String(shO.rows[r][0]) === '47') shO.rows.splice(r, 1);  // как archiveEligibleOrders_
}
const cr3 = sandbox.createOrder_(book3, { client: 'После архивации' });
ok(cr3 && cr3.ok === true, 'createOrder_ отработал после архивации');
ok(String(cr3.num) !== '47',
  'номер архивного \u211647 НЕ выдан заново — иначе архивный заказ стал бы невозвратимым');
ok(String(cr3.num) === '48', 'следующий номер — 48, журнал статусов удержал планку');

console.log('');
console.log('\u0418\u0422\u041e\u0413 (\u0443\u0434\u0430\u043b\u0435\u043d\u0438\u0435 \u0437\u0430\u043a\u0430\u0437\u0430): ' + PASS + ' \u043f\u0440\u043e\u0448\u043b\u043e, ' + FAIL + ' \u0443\u043f\u0430\u043b\u043e');
process.exit(FAIL ? 1 : 0);
