/* 2D-редактор секции: SVG в панели, клики инструментами реально
   меняют данные секции (те же, что видят 3D и раскрой). */
var { JSDOM } = require('jsdom');
var fs = require('fs');
var passed = 0, failed = 0;
function ok(c, l) { if (c) passed++; else { failed++; console.log('  ✗ ' + l); } }
function eq(a, b, l) { if (a === b) passed++; else { failed++; console.log('  ✗ ' + l + ': ожидалось ' + JSON.stringify(b) + ', получено ' + JSON.stringify(a)); } }

var dom = new JSDOM('<!DOCTYPE html><html><body><div id="viewport"></div><div id="dim-overlay"></div><div id="stats-badge"></div><div id="sections-container"></div></body></html>',
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
src += '\nrenderer={};camera={};scene={children:[],add:function(){},remove:function(){}};ML={};ML2={};MH={};MR={};MFL={};MFM={};ME={};window._ai_renderPanel=renderPanel;\n';
win.eval(src);

var s = win._ai_mkSection();
s.width = 800; s.height = 2200; s.depth = 600;
win._ai_sections = [s];

// 1) SVG схемы в панели
win._ai_renderPanel();
var cont = win.document.getElementById('sections-container');
ok(cont.innerHTML.indexOf('2D схема') >= 0, 'аккордеон «2D схема» в панели');
var svg = cont.querySelector('svg[data-sc]');
ok(!!svg, 'SVG с data-sc в DOM');
var sc = parseFloat(svg.getAttribute('data-sc'));
ok(sc > 0 && sc < 1, 'масштаб адекватный: ' + sc);

// фейковое событие клика по мм-координате
function clickAt(xmm, ymm) {
  var evt = { currentTarget: { dataset: { sc: String(sc) } },
    offsetX: xmm * sc, offsetY: (s.height - ymm) * sc };
  win.w2dClick(s.id, evt);
}

// 2) инструмент «полка»: клик на высоте ~1005 → полка 1000 (snap 10)
win.w2dSetTool('shelf');
clickAt(200, 1005);
eq(s.shelves.length, 1, 'полка добавлена кликом');
eq(s.shelves[0].height, 1010, 'высота 1010 (snap к 10мм, 1005 округляется вверх)');
eq(s.shelves[0].col, 0, 'колонка 0');

// 3) полка во 2-ю колонку при перегородке
s.dividers.push({ id: s.divId++, pos: 392 });
win._ai_renderPanel();
clickAt(600, 500);
eq(s.shelves.length, 2, 'вторая полка добавлена');
var sh2 = s.shelves.find(function (x) { return x.height === 500; });
eq(sh2.col, 1, 'полка попала в колонку 1 (клик правее перегородки)');

// 4) инструмент «ящики»: клик в нижнюю нишу → блок count=2, повторный клик → 3
win.w2dSetTool('drawers');
clickAt(200, 200);
eq(s.drawerBlocks.length, 1, 'блок ящиков добавлен');
eq(s.drawerBlocks[0].count, 2, 'count=2');
eq(s.drawerBlocks[0].col, 0, 'в колонку 0 (перегородка есть)');
clickAt(200, 200);
eq(s.drawerBlocks[0].count, 3, 'повторный клик: count=3');

// 5) инструмент «штанга»
win.w2dSetTool('rod');
clickAt(600, 1804);
ok(s.hasRod, 'штанга включена');
eq(s.rodHeight, 1800, 'высота штанги 1800 (snap)');
eq(s.rodCol, 1, 'штанга в колонке 1');

// 6) инструмент «удалить»: полку, штангу, ящики
win.w2dSetTool('del');
clickAt(200, 1020);
eq(s.shelves.length, 1, 'полка 1010 удалена кликом рядом (радиус 40мм)');
clickAt(600, 1790);
ok(!s.hasRod, 'штанга удалена');
clickAt(200, 150);
eq(s.drawerBlocks.length, 0, 'блок ящиков удалён');

// 7) данные дошли до раскроя (полка 500 в колонке 1 осталась)
var r = win._calcParts();
ok(r.ldsp.some(function (p) { return p.name.indexOf('Полка') >= 0; }), '2D-полка попала в раскрой');
ok(r.ldsp.some(function (p) { return p.name.indexOf('Перегор') >= 0; }), 'перегородка в раскрое');

console.log('Пройдено: ' + passed + ', провалено: ' + failed);
process.exit(failed > 0 ? 1 : 0);
