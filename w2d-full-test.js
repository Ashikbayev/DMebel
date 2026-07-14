/* Полноэкранный 2D-режим: переключатель, отрисовка всех секций,
   инструменты (вкл. перегородку и антресоль), правка размеров через
   prompt, синхронизация с раскроем. */
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
src += '\nrenderer={};camera={};scene={children:[],add:function(){},remove:function(){}};ML={};ML2={};MH={};MR={};MFL={};MFM={};ME={};window._ai_renderPanel=renderPanel;window._ai_render3D2=render3D;\n';
win.eval(src);

var s = win._ai_mkSection();
s.width = 800; s.height = 2200; s.depth = 600;
win._ai_sections = [s];

// 1) render3D создаёт переключатель и оверлей
win._ai_render3D2();
ok(!!win.document.getElementById('w2d-switch'), 'переключатель 2D/3D создан');
ok(!!win.document.getElementById('view2d'), 'оверлей view2d создан');
eq(win.document.getElementById('view2d').style.display, 'none', 'по умолчанию 2D скрыт (режим 3D)');

// 2) переключение в 2D
win.w2dToggleMode('2d');
var ov = win.document.getElementById('view2d');
eq(ov.style.display, 'block', '2D показан');
ok(ov.innerHTML.indexOf('Секция 1') >= 0, 'секция нарисована');
ok(ov.innerHTML.indexOf('Ш 800') >= 0 && ov.innerHTML.indexOf('В 2200') >= 0 && ov.innerHTML.indexOf('Г 600') >= 0, 'размеры Ш/В/Г подписаны');
ok(ov.innerHTML.indexOf('Перегородка') >= 0 && ov.innerHTML.indexOf('Антресоль') >= 0 && ov.innerHTML.indexOf('Авто-полки') >= 0, 'все инструменты в тулбаре');

// хелпер клика через layout (мм → пиксели свг)
function clickMm(sid, xmm, ymm) {
  var lay = win._ai_w2dLayout().find(function (l) { return l.sid === sid; });
  var evt = {
    currentTarget: { getBoundingClientRect: function () { return { left: 0, top: 0 }; } },
    clientX: lay.x0 + xmm * lay.sc,
    clientY: lay.floorY - ymm * lay.sc
  };
  win.w2dFullClick(evt);
}

// 3) перегородка кликом
win.w2dSetTool2('part');
clickMm(s.id, 396, 1000);
eq(s.dividers.length, 1, 'перегородка добавлена');
eq(s.dividers[0].pos, 400, 'позиция 400 (snap 10)');

// 4) полки в обе колонки
win.w2dSetTool2('shelf');
clickMm(s.id, 200, 1000);
clickMm(s.id, 600, 700);
eq(s.shelves.length, 2, 'две полки');
eq(s.shelves.find(function (x) { return x.height === 1000; }).col, 0, 'полка 1000 в колонке 0');
eq(s.shelves.find(function (x) { return x.height === 700; }).col, 1, 'полка 700 в колонке 1');

// 5) антресоль кликом (вкл/выкл)
win.w2dSetTool2('antr');
clickMm(s.id, 400, 1500);
ok(s.antresol.enabled, 'антресоль включена');
eq(s.antresol.height, 400, 'высота по умолчанию 400');
ok(win.document.getElementById('view2d').innerHTML.indexOf('антресоль 400') >= 0, 'антресоль нарисована в 2D');

// 6) правка размеров через prompt (Ш 800 → 900)
win.prompt = function () { return '900'; };
win.w2dEditDim(s.id, 'width');
eq(s.width, 900, 'ширина изменена кликом по размеру');
win.prompt = function () { return '350'; };
win.w2dEditDim(s.id, 'antr');
eq(s.antresol.height, 350, 'высота антресоли изменена');

// 7) правка высоты полки
var sh = s.shelves.find(function (x) { return x.height === 700; });
win.prompt = function () { return '750'; };
win.w2dEditShelf(s.id, sh.id);
eq(sh.height, 750, 'высота полки изменена по клику на подпись');

// 8) удаление перегородки инструментом
win.w2dSetTool2('del');
clickMm(s.id, 405, 1200);
eq(s.dividers.length, 0, 'перегородка удалена кликом');

// 9) вторая секция: "+ Секция" (addSection) и раздельный layout
win.addSection();
win.w2dSyncView && win.w2dSyncView();
win._ai_render3D2();
eq(win._ai_w2dLayout().length, 2, 'layout содержит 2 секции');
ok(win.document.getElementById('view2d').innerHTML.indexOf('Секция 2') >= 0, 'вторая секция нарисована');

// 10) клики по второй секции идут в неё
var s2 = win._ai_sections[1];
win.w2dSetTool2('shelf');
clickMm(s2.id, 300, 1100);
eq(s2.shelves.length, 1, 'полка добавлена во 2-ю секцию');
eq(s._ai_probe === undefined && s2.shelves[0].height, 1100, 'высота 1100, 1-я секция не задета');

// 11) данные дошли до раскроя
var r = win._calcParts();
ok(r.ldsp.some(function (p) { return p.name.indexOf('С2 Полка') >= 0; }), 'полка 2-й секции в раскрое');

// 12) обратно в 3D
win.w2dToggleMode('3d');
eq(win.document.getElementById('view2d').style.display, 'none', 'возврат в 3D скрывает 2D');

console.log('Пройдено: ' + passed + ', провалено: ' + failed);
process.exit(failed > 0 ? 1 : 0);
