/* Двери: 3D одна отрисовка (ядро, не legacy-дубль) + UI зазоров в панели */
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
  EdgesGeometry: function (g) { return { type: 'edges', src: g }; }
};
var FB = mkStub();
win.__THREE__ = new Proxy({}, { get: function (t, k) { return (k in THREE_REAL) ? THREE_REAL[k] : FB; } });
win.__added__ = [];
win.eval(fs.readFileSync('wardrobe-core.js', 'utf8'));
var src = fs.readFileSync('wardrobe.js', 'utf8');
src = src.replace("import * as THREE from 'three';", 'const THREE = window.__THREE__;');
src += '\nrenderer={};camera={};scene={children:[],add:function(o){this.children.push(o);window.__added__.push(o);},remove:function(){}};ML={};ML2={};MH={};MR={};MFL={};MFM={};ME={};window._ai_renderPanel=renderPanel;\n';
win.eval(src);
var added = win.__added__;

// 3D: секция с 2 дверьми — фасады из ядра, РОВНО 2 (legacy-блок выключен)
var s = win._ai_mkSection();
s.width = 800; s.height = 2000; s.depth = 600;
s.facade.type = 'doors2';
win._ai_sections = [s];
added.length = 0;
win._ai_render3D();
var boxes = added.filter(function (o) { return o.geometry && o.geometry.type === 'box'; });
var doors = boxes.filter(function (o) { return o.geometry.d === 16 && o.geometry.h > 1900 && o.geometry.w > 300 && o.geometry.w < 500; });
eq(doors.length, 2, '3D: ровно 2 двери (нет legacy-дубля)');
if (doors.length === 2) {
  ok(doors[0].position.z < 30, 'дверь у передней плоскости: z=' + doors[0].position.z.toFixed(1));
  eq(Math.round(doors[0].geometry.w), 396, 'геом. ширина двери 396 (зона 800−6−2 / 2)');
}

// раскрой: зазоры секции реально меняют цифры дверей (A3 заказа 98)
var s2 = win._ai_mkSection();
s2.width = 502; s2.height = 542; s2.depth = 398;
s2.facade.type = 'full';
s2.fGapLeft = -3; s2.fGapRight = -2; s2.fGapTop = 4; s2.fGapBottom = 38;
win._ai_sections = [s2];
var r = win._calcParts();
var fas = r.facLdsp.find(function (p) { return p.name.indexOf('Фасад') >= 0; });
ok(!!fas, 'фасад в раскрое');
eq(fas.w, 505, 'раскрой: ширина 505 (A3 заказа 98 через зазоры)');
eq(fas.h, 498, 'раскрой: высота 498');

// дефолт: без настройки — старые цифры
var s3 = win._ai_mkSection();
s3.width = 800; s3.height = 2000; s3.depth = 600;
s3.facade.type = 'doors2';
win._ai_sections = [s3];
var r2 = win._calcParts();
var f2 = r2.facLdsp.filter(function (p) { return p.name.indexOf('Фасад') >= 0; });
eq(f2.length, 2, '2 фасада');
eq(f2[0].w, 394, 'дефолт: 394 как раньше');
eq(f2[0].h, 1992, 'дефолт: 1992 как раньше');

// UI: инпуты зазоров в DOM когда фасад есть, и нет — когда фасада нет
win._ai_renderPanel();
var html = win.document.getElementById('sections-container').innerHTML;
ok(html.indexOf('fGapLeft') >= 0 && html.indexOf('fGapMid') >= 0, 'UI: инпуты зазоров в DOM (фасад есть)');
s3.facade.type = 'none';
win._ai_renderPanel();
var html2 = win.document.getElementById('sections-container').innerHTML;
ok(html2.indexOf('fGapLeft') < 0, 'UI: зазоров нет когда фасад none');

// откат на legacy: двери снова по старой формуле, 3D рисует legacy-блок
win.setCoreEngine(false);
s3.facade.type = 'doors2';
win._ai_sections = [s3];
var r3 = win._calcParts();
var f3 = r3.facLdsp.filter(function (p) { return p.name.indexOf('Фасад') >= 0; });
eq(f3[0].w, 394, 'legacy: 394');
added.length = 0;
win._ai_render3D();
var boxes3 = added.filter(function (o) { return o.geometry && o.geometry.type === 'box'; });
var doors3 = boxes3.filter(function (o) { return o.geometry.d === 16 && o.geometry.h > 1900 && o.geometry.w > 300 && o.geometry.w < 500; });
eq(doors3.length, 2, 'legacy 3D: 2 двери рисуются legacy-блоком');
win.setCoreEngine(true);

console.log('Пройдено: ' + passed + ', провалено: ' + failed);
process.exit(failed > 0 ? 1 : 0);
