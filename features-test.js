/* Пакет фишек: прозрачность/скрытие фасадов, ручки в 3D,
   фрезеровка, новые пресеты мастера. */
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
function makeObj3D() {
  return { userData: {}, position: { x: 0, y: 0, z: 0,
      set: function (x, y, z) { this.x = x; this.y = y; this.z = z; },
      copy: function (p) { this.x = p.x; this.y = p.y; this.z = p.z; } },
    rotation: { x: 0, y: 0, z: 0 }, castShadow: false, material: null };
}
var THREE_REAL = {
  Mesh: function (g, m) { var o = makeObj3D(); o.geometry = g; o.material = m; return o; },
  LineSegments: function (g) { var o = makeObj3D(); o.geometry = g; return o; },
  BoxGeometry: function (w, h, d) { return { type: 'box', w: w, h: h, d: d }; },
  CylinderGeometry: function () { return { type: 'cyl' }; },
  EdgesGeometry: function (g) { return { type: 'edges', src: g }; },
  MeshStandardMaterial: function (p) { return Object.assign({ isMat: true }, p); }
};
var FB = mkStub();
win.__THREE__ = new Proxy({}, { get: function (t, k) { return (k in THREE_REAL) ? THREE_REAL[k] : FB; } });
win.__added__ = [];
win.eval(fs.readFileSync('wardrobe-core.js', 'utf8'));
var src = fs.readFileSync('wardrobe.js', 'utf8');
src = src.replace("import * as THREE from 'three';", 'const THREE = window.__THREE__;');
src += '\nrenderer={};camera={};scene={children:[],add:function(o){this.children.push(o);window.__added__.push(o);},remove:function(){}};ML={};ML2={};MH={};MR={};MFL={};MFM={};ME={};window._ai_render3D2=render3D;\n';
win.eval(src);
var added = win.__added__;

var s = win._ai_mkSection();
s.width = 800; s.height = 2000; s.depth = 600;
s.facade.type = 'doors2';
s.facade.handle = 'railing';
win._ai_sections = [s];

function countFacades() {
  return added.filter(function (o) { return o.geometry && o.geometry.type === 'box' && o.geometry.d === 16 && o.geometry.h > 1900; }).length;
}
function countHandles() {
  return added.filter(function (o) { return o.geometry && o.geometry.type === 'box' && o.geometry.w === 14 && o.geometry.h === 140; }).length;
}

// 1) ghost (дефолт): фасады есть, прозрачный материал, ручки есть
eq(win._ai_facadeMode(), 'ghost', 'дефолтный режим: прозрачные');
added.length = 0; win._ai_render3D2();
eq(countFacades(), 2, 'ghost: 2 фасада отрисованы');
var fac = added.filter(function (o) { return o.geometry && o.geometry.d === 16 && o.geometry.h > 1900; });
ok(fac[0].material && fac[0].material.transparent === true, 'ghost: материал прозрачный');
eq(countHandles(), 2, 'ручки: 2 рейлинга (по одному на дверь)');
// рейлинги на внутренних кромках (двери открываются от центра)
var hx = added.filter(function (o) { return o.geometry && o.geometry.w === 14 && o.geometry.h === 140; }).map(function (o) { return o.position.x; });
ok(hx[0] !== hx[1], 'ручки на разных дверях в разных местах');

// 2) solid: непрозрачные
win.w2dFacadeMode();
eq(win._ai_facadeMode(), 'solid', 'переключение → solid');
added.length = 0; win._ai_render3D2();
var fac2 = added.filter(function (o) { return o.geometry && o.geometry.d === 16 && o.geometry.h > 1900; });
eq(fac2.length, 2, 'solid: фасады есть');
ok(!fac2[0].material || fac2[0].material.transparent !== true, 'solid: материал непрозрачный');

// 3) hidden: фасадов и ручек нет
win.w2dFacadeMode();
eq(win._ai_facadeMode(), 'hidden', 'переключение → hidden');
added.length = 0; win._ai_render3D2();
eq(countFacades(), 0, 'hidden: фасадов нет');
eq(countHandles(), 0, 'hidden: ручек нет');
win.w2dFacadeMode(); // назад в ghost

// 4) типы ручек
s.facade.handle = 'knob';
added.length = 0; win._ai_render3D2();
var knobs = added.filter(function (o) { return o.geometry && o.geometry.w === 26 && o.geometry.h === 26; });
eq(knobs.length, 2, 'кнопки: 2 шт');
s.facade.handle = 'push';
added.length = 0; win._ai_render3D2();
eq(countHandles(), 0, 'push-to-open: ручек нет');
s.facade.handle = 'torec';
added.length = 0; win._ai_render3D2();
var tor = added.filter(function (o) { return o.geometry && o.geometry.h === 18 && o.geometry.w > 300; });
eq(tor.length, 2, 'торцевые профили: 2 шт, во всю ширину двери');

// 5) фрезеровка: селект в панели + значение в модели
win._ai_renderPanel = win._ai_renderPanel || null;
win.updFacade(s.id, 'frez', 'venecia');
eq(s.facade.frez, 'venecia', 'фрезеровка сохранилась (Венеция)');
win.updFacade(s.id, 'handle', 'leather');
eq(s.facade.handle, 'leather', 'ручка сохранилась (кожаная петля)');

// 6) мастер: новые пресеты строятся
win.wizOpen();
win.wizSet('len', '3200'); win.wizSet('offL', '0'); win.wizSet('offR', '0'); win.wizSet('offT', '0');
win.wizSet('hei', '2400'); win.wizSet('doors', '6');
win.wizStep(1); win.wizStep(1);
win.wizPreset(0, 'split2t5p');
win.wizPreset(1, 'rodDrawers');
win.wizPreset(2, 'penal7');
win.wizStep(1);
win.wizSet('frez', 'volna'); win.wizSet('handle', 'gola');
win.confirm = function () { return true; };
win.wizBuild();
var S = win._ai_sections;
eq(S.length, 3, '6 дверей → 3 модуля');
// split2t5p: перегородка + штанга col0 + 5 полок col1
eq(S[0].dividers.length, 1, 'split: перегородка есть');
ok(S[0].hasRod && S[0].rodCol === 0, 'split: штанга в колонке 0');
eq(S[0].shelves.filter(function (x) { return x.col === 1; }).length, 5, 'split: 5 полок в колонке 1');
// rodDrawers
ok(S[1].hasRod && S[1].drawerBlocks.length === 1 && S[1].shelves.length === 1, 'rodDrawers: штанга+полка+ящики');
// penal7
eq(S[2].shelves.length, 7, 'penal7: 7 полок');
ok(S.every(function (x) { return x.facade.frez === 'volna' && x.facade.handle === 'gola'; }), 'фрезеровка/ручки из мастера на всех секциях');
// раскрой не падает
var r = win._calcParts();
ok(r.ldsp.length > 25, 'раскрой построился (' + r.ldsp.length + ' деталей)');

console.log('Пройдено: ' + passed + ', провалено: ' + failed);
process.exit(failed > 0 ? 1 : 0);
