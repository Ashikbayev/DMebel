/* Smoke: renderPanel реально выполняется с новым блоком Поправок,
   инпуты попадают в DOM, upd() пишет поле и оно доходит до раскроя. */
var { JSDOM } = require('jsdom');
var fs = require('fs');
var passed = 0, failed = 0;
function ok(c, l) { if (c) passed++; else { failed++; console.log('  ✗ ' + l); } }
function eq(a, b, l) { if (a === b) passed++; else { failed++; console.log('  ✗ ' + l + ': ожидалось ' + JSON.stringify(b) + ', получено ' + JSON.stringify(a)); } }

var dom = new JSDOM('<!DOCTYPE html><html><body>' +
  '<div id="viewport"></div><div id="dim-overlay"></div><div id="stats-badge"></div>' +
  '<div id="sections-container"></div>' +
  '</body></html>', { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/' });
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
src += '\nrenderer={};camera={};scene={children:[],add:function(){},remove:function(){}};ML={};ML2={};MH={};MR={};MFL={};MFM={};ME={};\n';
src += 'window._ai_renderPanel=renderPanel;\n';
win.eval(src);

var s = win._ai_mkSection();
s.width = 896; s.height = 542; s.depth = 398;
s.shelves.push({ id: s.shelfId++, height: 300, col: 0 });
win._ai_sections = [s];

// 1) renderPanel не падает и рисует блок Поправок
try { win._ai_renderPanel(); ok(true, 'renderPanel выполнился'); }
catch (e) { ok(false, 'renderPanel упал: ' + e.message); }
var html = win.document.getElementById('sections-container').innerHTML;
ok(html.indexOf('Поправки') >= 0, 'блок «Поправки» в DOM');
ok(html.indexOf('shelfDepthOffset') >= 0, 'инпут shelfDepthOffset в DOM');
ok(html.indexOf('sideExtraLeft') >= 0 && html.indexOf('sideExtraRight') >= 0, 'инпуты напусков в DOM');
ok(html.indexOf('drawerFrontDrop') >= 0, 'инпут frontDrop в DOM');

// 2) upd пишет поле (в т.ч. отрицательное) и раскрой его видит
win.upd(s.id, 'sideExtraLeft', '3');
win.upd(s.id, 'sideExtraRight', '3');
eq(s.sideExtraLeft, 3, 'upd: sideExtraLeft=3');
var r = win._calcParts();
var bl = r.ldsp.find(function (p) { return p.name === 'С1 Бок лев'; });
eq(bl.w, 380, 'раскрой: бок 377+3=380 (A4 из заказа 98)');
win.upd(s.id, 'sideExtraLeft', '-2');
eq(s.sideExtraLeft, -2, 'upd: отрицательное значение проходит (подрезка)');
var r2 = win._calcParts();
var bl2 = r2.ldsp.find(function (p) { return p.name === 'С1 Бок лев'; });
eq(bl2.w, 375, 'раскрой: бок 377−2=375');

// 3) отступ полки виден и в раскрое
win.upd(s.id, 'sideExtraLeft', '0'); win.upd(s.id, 'sideExtraRight', '0');
win.upd(s.id, 'shelfDepthOffset', '13');
var r3 = win._calcParts();
var pol = r3.ldsp.find(function (p) { return p.name.indexOf('Полка') >= 0; });
eq(pol.h, 364, 'раскрой: полка глубина 377−13=364');

// 4) badge активных поправок
win._ai_renderPanel();
var html2 = win.document.getElementById('sections-container').innerHTML;
ok(html2.indexOf('1 акт.') >= 0, 'badge «1 акт.» при одной активной поправке');

// 5) frontDrop доходит до ящиков
var s3 = win._ai_mkSection();
s3.width = 800; s3.height = 2000; s3.depth = 600;
s3.shelves.push({ id: s3.shelfId++, height: 800, col: 0 });
s3.drawerBlocks.push({ nicheIdx: 0, count: 2, brand: 'En-7' });
s3.drawerFrontDrop = 20;
win._ai_sections = [s3];
var r4 = win._calcParts();
var per = r4.ldsp.find(function (p) { return p.name.indexOf('пер') >= 0 && p.name.indexOf('Яш.') >= 0; });
var zad = r4.ldsp.find(function (p) { return p.name.indexOf('зад') >= 0 && p.name.indexOf('Яш.') >= 0; });
ok(per && zad, 'перед и зад ящика найдены');
eq(zad.h - per.h, 20, 'перед на 20 ниже зада (как в 104/98)');

console.log('Пройдено: ' + passed + ', провалено: ' + failed);
process.exit(failed > 0 ? 1 : 0);
