/* DOM-тест визуального редактора дерева (этап E) через jsdom.
   Грузит реальный wardrobe-configurator.html в headless-DOM,
   кликает по SVG-ячейкам как пользователь, проверяет что JSON
   в textarea меняется корректно после каждого шага. */
var { JSDOM } = require('jsdom');
var fs = require('fs');

var html = fs.readFileSync('/home/claude/w/wardrobe-configurator.html', 'utf8');
var dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true });
var win = dom.window, doc = win.document;

var passed = 0, failed = 0;
function ok(cond, label) { if (cond) passed++; else { failed++; console.log('  ✗ ' + label); } }
function eq(a, b, label) { if (a === b) passed++; else { failed++; console.log('  ✗ ' + label + ': ожидалось ' + JSON.stringify(b) + ', получено ' + JSON.stringify(a)); } }

function tree() {
  var raw = doc.getElementById('treeJson').value.trim();
  return raw ? JSON.parse(raw) : null;
}
function click(idx) { win.teSelect(idx); }
function set(id, v) { var el = doc.getElementById(id); el.value = v; }
function check(id) { doc.getElementById(id).checked = true; }
function apply() { win.teApply(); }

// Ждём загрузки скриптов (jsdom выполняет их синхронно при парсинге,
// но requestAnimationFrame-петля three.js асинхронна — не мешает нам).
setTimeout(function () {
  console.log('── E: визуальный редактор дерева (jsdom, реальные клики) ──');

  // 1) Включаем режим дерева на пустом textarea → один пустой корень
  check('treeMode');
  win.recalc();
  eq(tree(), null, 'старт: пустое дерево (textarea пуст)');
  ok(doc.getElementById('treeEditorPanel').style.display !== 'none', 'панель редактора видна');
  eq(win.TE_ENTRIES.length, 1, 'один кликабельный элемент (корень)');
  eq(win.TE_ENTRIES[0].kind, 'leaf', 'корень — пустой лист');

  // 2) Кликаем по корню → выбираем, ставим тип "panels", count=1, Применить
  click(0);
  ok(doc.getElementById('treeEditForm').innerHTML.length > 0, 'форма отрисована после клика');
  set('teType', 'panels');
  win.teShowFields();
  set('teSplitCount', '1');
  apply();
  var t1 = tree();
  ok(t1 && t1.type === 'panels' && t1.count === 1, 'корень стал panels×1');
  eq(win.TE_ENTRIES.length, 3, 'после деления: 1 тег + 2 листа');

  // 3) Кликаем по левому дочернему листу → делаем "facade" count=2
  var leafIdx = win.TE_ENTRIES.findIndex(function (e) { return e.kind === 'leaf' && e.cell.x0 < 0; });
  ok(leafIdx >= 0, 'левый лист найден');
  click(leafIdx);
  set('teType', 'facade');
  win.teShowFields();
  set('teFaCount', '2');
  set('teFaGapTop', '3');
  apply();
  var t2 = tree();
  ok(t2.children[0] && t2.children[0].type === 'facade' && t2.children[0].count === 2,
    'левая ячейка стала facade count=2');
  eq(t2.children[0].gapTop, 3, 'gapTop применился (3)');
  ok(t2.children[1] === null || t2.children[1] === undefined, 'правая ячейка осталась пустой (не задета)');

  // 4) Кликаем по правому листу → штанга с явным drop
  var rightIdx = win.TE_ENTRIES.findIndex(function (e) { return e.kind === 'leaf' && e.cell.x0 > 0; });
  click(rightIdx);
  set('teType', 'rod');
  win.teShowFields();
  set('teRodDrop', '120');
  apply();
  var t3 = tree();
  eq(t3.children[1].type, 'rod', 'правая ячейка стала rod');
  eq(t3.children[1].drop, 120, 'drop применился (120)');

  // 5) Редактируем сам тег деления (меняем count panels 1→2), сохраняя
  //    что при смене count дети сбрасываются (документированное поведение)
  var tagIdx = win.TE_ENTRIES.findIndex(function (e) { return e.kind === 'tag'; });
  click(tagIdx);
  set('teSplitCount', '2');
  apply();
  var t4 = tree();
  eq(t4.count, 2, 'count тега panels изменён на 2');
  ok(!t4.children || t4.children.length === 0 || t4.children.every(function (c) { return c === undefined; }),
    'смена count сбросила детей (документированное поведение)');

  // 6) "Сделать пустой" на теге → полностью убирает деление
  click(tagIdx);
  win.teApplyEmpty();
  eq(tree(), null, 'корень снова пуст после «Сделать пустой» на теге');

  // 7) Проверка bottomShelf/topShelf через форму (этап D из редактора)
  click(0);
  set('teType', 'shelves');
  win.teShowFields();
  set('teSplitCount', '0');
  check('teBottomShelf');
  check('teTopShelf');
  apply();
  var t5 = tree();
  ok(t5.type === 'shelves' && t5.bottomShelf === true && t5.topShelf === true,
    'флаги bottomShelf/topShelf применились через форму');

  // 8) Пересборка ядром — дерево из редактора реально строится в детали
  var cfg = { width: 800, height: 2000, depth: 600, legs: 100, panel: 16, back: 3,
    edge: 1, gapFront: 16, gapBack: 3, sections: tree() };
  var result = win.WardrobeCore.buildCarcass(cfg);
  ok(result.parts.length > 0, 'дерево из редактора строится ядром без ошибок');
  var shelfCount = result.parts.filter(function (p) { return p.kind === 'shelf'; }).length;
  eq(shelfCount, 2, 'две граничные полки (низ+верх) от bottomShelf/topShelf, без среднего делителя');

  // 9) Кнопка примера B3 грузит валидное дерево, ядро его строит
  doc.getElementById('loadFacadeDemo').dispatchEvent(new win.Event('click'));
  var t6 = tree();
  ok(t6 && t6.type === 'panels', 'пример B3: дерево загружено');
  var cfg2 = { width: 800, height: 2000, depth: 600, legs: 100, panel: 16, back: 3,
    edge: 1, gapFront: 16, gapBack: 3, sections: t6 };
  var result2 = win.WardrobeCore.buildCarcass(cfg2);
  ok(result2.parts.filter(function (p) { return p.kind === 'facade'; }).length >= 3,
    'пример B3: створки построены (≥3)');

  // 10) Кнопка эталона (image 1) — регрессия: редактор не портит существующий сценарий
  doc.getElementById('loadEtalon').dispatchEvent(new win.Event('click'));
  var t7 = tree();
  var cfg3 = { width: 800, height: 2000, depth: 600, legs: 100, panel: 16, back: 3,
    edge: 1, gapFront: 16, gapBack: 3, sections: t7 };
  var result3 = win.WardrobeCore.buildCarcass(cfg3);
  eq(result3.summary.areaLdspM2, 7.766, 'эталон image 1: ЛДСП 7.766 м² не сломан редактором');
  eq(result3.summary.areaHdfM2, 2.207, 'эталон image 1: ХДФ 2.207 м² не сломан редактором');

  // 11) Ящики-2: назначаем НАКЛАДНЫЕ ящики через форму редактора
  click(0);
  set('teType', 'drawers');
  win.teShowFields();
  set('teDrCount', '2');
  doc.getElementById('teDrMount').value = 'overlay';
  apply();
  var t8 = tree();
  ok(t8 && t8.type === 'drawers' && t8.mount === 'overlay', 'редактор: mount=overlay применился');
  var cfgO = { width: 800, height: 2000, depth: 600, legs: 100, panel: 16, back: 3,
    edge: 1, gapFront: 16, gapBack: 3, sections: t8 };
  var rO = win.WardrobeCore.buildCarcass(cfgO);
  ok(rO.parts.filter(function (p) { return p.kind === 'dpost'; }).length === 0,
    'редактор: накладные — стоек нет');
  ok(rO.parts.filter(function (p) { return p.kind === 'dfacade' && p.mount === 'overlay'; }).length === 2,
    'редактор: 2 накладных фасада с полем mount');

  // 12) Кнопка «Эталон 2» — раскрой накладной секции точен (178×406)
  doc.getElementById('loadEtalon2').dispatchEvent(new win.Event('click'));
  var t9 = tree();
  ok(t9 && t9.children[1].children[1].mount === 'overlay', 'эталон 2: overlay в дереве');
  var cfgE2 = { width: 800, height: 2000, depth: 600, legs: 100, panel: 16, back: 3,
    edge: 1, gapFront: 16, gapBack: 3, sections: t9 };
  var rE2 = win.WardrobeCore.buildCarcass(cfgE2);
  var ovF = rE2.parts.filter(function (p) { return p.kind === 'dfacade' && p.mount === 'overlay'; });
  eq(ovF.length, 2, 'эталон 2: два накладных фасада');
  eq(ovF[0].cutL, 178, 'эталон 2: раскрой фасада H = 178 (точно как ПО)');
  eq(ovF[0].cutW, 406, 'эталон 2: раскрой фасада W = 406 (точно как ПО)');

  console.log('');
  console.log('Пройдено: ' + passed + ', провалено: ' + failed);
  process.exit(failed > 0 ? 1 : 0);
}, 300);
