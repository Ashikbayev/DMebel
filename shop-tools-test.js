/* Инструменты цеха: валидатор, бирки, экспорт CSV, ведомость фурнитуры,
   селект открывания створок. */
var { JSDOM } = require('jsdom');
var fs = require('fs');
var passed = 0, failed = 0;
function ok(c, l) { if (c) passed++; else { failed++; console.log('  ✗ ' + l); } }
function eq(a, b, l) { if (a === b) passed++; else { failed++; console.log('  ✗ ' + l + ': ожидалось ' + JSON.stringify(b) + ', получено ' + JSON.stringify(a)); } }

var dom = new JSDOM('<!DOCTYPE html><html><body><div id="viewport"></div><div id="dim-overlay"></div><div id="stats-badge"></div><div id="sections-container"></div><div id="cut-content"></div><div id="cut-modal"></div></body></html>',
  { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/' });
var win = dom.window;
function mkStub() {
  return new Proxy(function () { return mkStub(); }, {
    get: function (t, k) { if (k === Symbol.toPrimitive || k === 'toString') return function () { return ''; }; return mkStub(); },
    construct: function () { return mkStub(); }, apply: function () { return mkStub(); }
  });
}
win.__THREE__ = mkStub();
win.eval(fs.readFileSync('wardrobe-core.js', 'utf8'));
var src = fs.readFileSync('wardrobe.js', 'utf8');
src = src.replace("import * as THREE from 'three';", 'const THREE = window.__THREE__;');
src += '\nrenderer={};camera={};scene={children:[],add:function(){},remove:function(){}};ML={};ML2={};MH={};MR={};MFL={};MFM={};ME={};window._ai_renderPanel=renderPanel;window._ai_cutAllParts=cutAllParts;window._ai_validationHtml=validationHtml;window._ai_hardwareHtml=hardwareHtml;\n';
win.eval(src);

console.log('── Кромка по сторонам в edgeRows (для бирок/CSV) ──');
var s = win._ai_mkSection();
s.width = 800; s.height = 2000; s.depth = 600;
s.shelves.push({ id: s.shelfId++, height: 1000, col: 0 });
win._ai_sections = [s];
var d = win._ai_cutAllParts();
ok(d.parts.length > 0, 'детали собраны (' + d.parts.length + ')');
var er = d.edgeRows.find(function (r) { return r.name.indexOf('Бок лев') >= 0; });
ok(!!er && !!er.sides, 'у боковины есть sides');
eq(er.sides.t, '2mm', 'бок: верх — лицевая кромка 1мм');
eq(er.sides.b, 'none', 'бок: низ — кромки нет (edgeBack=none)');
ok(d.parts.every(function (p) { return p.mat && p.w > 0 && p.h > 0; }), 'у всех деталей материал и размеры');

console.log('── Валидатор ──');
var clean = win.validateProject();
eq(clean.filter(function (x) { return x.lvl === 'err'; }).length, 0, 'нормальная секция: ошибок нет');

// полка 1200 без перегородки → 2 предупреждения (прогиб полки + пролёт секции)
var s2 = win._ai_mkSection();
s2.width = 1400; s2.height = 2000; s2.depth = 600;
s2.shelves.push({ id: s2.shelfId++, height: 1000, col: 0 });
win._ai_sections = [s2];
var v2 = win.validateProject();
ok(v2.some(function (x) { return x.msg.indexOf('прогнётся') >= 0; }), 'широкая полка → предупреждение о прогибе');
ok(v2.some(function (x) { return x.msg.indexOf('без перегородки') >= 0; }), 'секция 1400 без перегородки → предупреждение');

// деталь не влезает в лист
var s3 = win._ai_mkSection();
s3.width = 3000; s3.height = 2500; s3.depth = 600;
win._ai_sections = [s3];
var v3 = win.validateProject();
ok(v3.some(function (x) { return x.lvl === 'err' && x.msg.indexOf('не помещается в лист') >= 0; }), 'деталь больше листа → ОШИБКА');

// штанга длиннее 1000
var s4 = win._ai_mkSection();
s4.width = 1200; s4.height = 2000; s4.depth = 600;
s4.hasRod = true; s4.rodHeight = 1800;
win._ai_sections = [s4];
ok(win.validateProject().some(function (x) { return x.msg.indexOf('держатель') >= 0; }), 'штанга 1168 → нужен центральный держатель');

// глубина 350 со штангой → плечики не влезут
var s5 = win._ai_mkSection();
s5.width = 800; s5.height = 2000; s5.depth = 340;
s5.hasRod = true;
win._ai_sections = [s5];
ok(win.validateProject().some(function (x) { return x.msg.indexOf('плечики') >= 0; }), 'мелкая глубина со штангой → плечики');

// створка шире 600
var s6 = win._ai_mkSection();
s6.width = 1300; s6.height = 2000; s6.depth = 600;
s6.facade.type = 'doors2';
win._ai_sections = [s6];
ok(win.validateProject().some(function (x) { return x.msg.indexOf('провиснет') >= 0; }), 'створка 650 → провиснет');

// пустой проект
win._ai_sections = [];
var v0 = win.validateProject();
eq(v0.length, 1, 'пустой проект: одна претензия');
eq(v0[0].lvl, 'err', 'пустой проект — это ошибка');

console.log('── HTML валидатора ──');
win._ai_sections = [s];
ok(win._ai_validationHtml().indexOf('Проверка пройдена') >= 0, 'чистый проект → зелёная плашка');
win._ai_sections = [s3];
ok(win._ai_validationHtml().indexOf('ошибок') >= 0, 'проблемный проект → счётчик ошибок');

console.log('── Ведомость фурнитуры ──');
var s7 = win._ai_mkSection();
s7.width = 800; s7.height = 2000; s7.depth = 600;
s7.facade.type = 'doors2';
s7.shelves.push({ id: s7.shelfId++, height: 800, col: 0 });
s7.drawerBlocks.push({ nicheIdx: 0, count: 2, brand: 'En-7' });
s7.hasRod = true;
win._ai_sections = [s7];
var rows = win.hardwareRows();
ok(rows.length > 0, 'строки фурнитуры есть (' + rows.length + ')');
var hin = rows.find(function (r) { return r.name.indexOf('Петля') >= 0; });
ok(!!hin, 'петли в ведомости');
eq(hin.qty, 6, 'петли: 2 двери × 3 (высота 1992 > 1500)');
var hnd = rows.find(function (r) { return r.name.indexOf('Ручка') >= 0; });
eq(hnd.qty, 4, 'ручки: 2 двери + 2 ящика');
var leg = rows.find(function (r) { return r.name.indexOf('Ножка') >= 0; });
eq(leg.qty, 4, 'ножки: 4 на секцию');
var rod = rows.find(function (r) { return r.name.indexOf('Штанга') >= 0; });
eq(rod.qty, 1, 'штанга: 1');
ok(rows.every(function (r) { return r.sum === r.qty * r.price; }), 'сумма = кол-во × цена во всех строках');
var hh = win._ai_hardwareHtml();
ok(hh.indexOf('Итого фурнитуры') >= 0, 'HTML: строка итога');
ok(hh.indexOf('exportHardwareCsv') >= 0, 'HTML: кнопка выгрузки CSV');

console.log('── Экспорт CSV ──');
var dl = [];
win.URL.createObjectURL = function () { return 'blob:x'; };
win.URL.revokeObjectURL = function () { };
var origCreate = win.document.createElement.bind(win.document);
win.document.createElement = function (tag) {
  var el = origCreate(tag);
  if (tag === 'a') { el.click = function () { dl.push({ name: el.download }); }; }
  return el;
};
win.exportCutCsv();
eq(dl.length, 1, 'раскрой: файл отдан на скачивание');
ok(dl[0].name.indexOf('.csv') > 0, 'раскрой: имя с .csv (' + dl[0].name + ')');
win.exportHardwareCsv();
eq(dl.length, 2, 'фурнитура: файл отдан на скачивание');

console.log('── Бирки ──');
var opened = null;
win.open = function () {
  opened = { html: '', document: { write: function (h) { opened.html = h; }, close: function () { } } };
  return opened;
};
win.printLabels();
ok(!!opened, 'окно бирок открыто');
ok(opened.html.indexOf('Бирки деталей') >= 0, 'бирки: заголовок');
ok(opened.html.indexOf('size:A4') >= 0, 'бирки: формат A4');
ok(opened.html.indexOf('Кромка:') >= 0, 'бирки: строка кромки');
var cnt = opened.html.split('class="lb"').length - 1;
eq(cnt, win._ai_cutAllParts().parts.length, 'бирок ровно столько же, сколько деталей');

console.log('── Селект открывания ──');
var s8 = win._ai_mkSection();
eq(s8.facade.opening, 'auto', 'новая секция: opening=auto по умолчанию');
s8.facade.type = 'doors2';
win._ai_sections = [s8];
win._ai_renderPanel();
var html = win.document.getElementById('sections-container').innerHTML;
ok(html.indexOf('Открывание') >= 0, 'селект «Открывание» в панели');
ok(html.indexOf('value="auto" selected') >= 0, 'auto выбран по умолчанию');
win.updFacade(s8.id, 'opening', 'left');
eq(s8.facade.opening, 'left', 'updFacade пишет opening');

console.log('');
console.log('Пройдено: ' + passed + ', провалено: ' + failed);
process.exit(failed > 0 ? 1 : 0);
