/* Регрессия оси Z: задняя стенка ГЛУБЖЕ боковин, фасад ящика ВПЕРЕДИ */
var { JSDOM } = require('jsdom');
var fs = require('fs');
var passed = 0, failed = 0;
function ok(c, l) { if (c) passed++; else { failed++; console.log('  ✗ ' + l); } }

var dom = new JSDOM('<!DOCTYPE html><html><body><div id="viewport"></div><div id="dim-overlay"></div><div id="stats-badge"></div></body></html>', {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/'
});
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
    rotation: { x: 0, y: 0, z: 0 }, castShadow: false, receiveShadow: false, material: null };
}
var THREE_REAL = {
  Mesh: function (g, m) { var o = makeObj3D(); o.geometry = g; o.material = m; return o; },
  LineSegments: function (g, m) { var o = makeObj3D(); o.geometry = g; return o; },
  BoxGeometry: function (w, h, d) { return { type: 'box', w: w, h: h, d: d }; },
  CylinderGeometry: function (r1, r2, h) { return { type: 'cyl', h: h }; },
  EdgesGeometry: function (g) { return { type: 'edges', src: g }; }
};
var FB = mkStub();
win.__THREE__ = new Proxy({}, { get: function (t, k) { return (k in THREE_REAL) ? THREE_REAL[k] : FB; } });
win.__added__ = [];
win.eval(fs.readFileSync('wardrobe-core.js', 'utf8'));
var src = fs.readFileSync('wardrobe.js', 'utf8');
src = src.replace("import * as THREE from 'three';", 'const THREE = window.__THREE__;');
src += '\nrenderer={};camera={};scene={children:[],add:function(o){this.children.push(o);window.__added__.push(o);},remove:function(o){}};ML={};ML2={};MH={};MR={};MFL={};MFM={};ME={};\n';
win.eval(src);
var added = win.__added__;

var s = win._ai_mkSection();
s.width = 800; s.height = 2000; s.depth = 600;
s.shelves.push({ id: s.shelfId++, height: 800, col: 0 });
s.drawerBlocks.push({ nicheIdx: 0, count: 2, brand: 'En-7' });
win._ai_sections = [s];
added.length = 0;
win._ai_render3D();

// Меши по типу геометрии: box w/h/d; классифицируем по размерам
var boxes = added.filter(function (o) { return o.geometry && o.geometry.type === 'box' && o.material !== undefined && o.position; });
// задняя стенка: d=3 (ХДФ), большая
var back = boxes.find(function (o) { return o.geometry.d === 3 && o.geometry.w > 700; });
// боковина: w=16, высокая
var side = boxes.find(function (o) { return o.geometry.w === 16 && o.geometry.h > 1000; });
// фасад ящика: d=16, широкий и невысокий, НЕ дно/крыша (у тех d>500)
var dfac = boxes.filter(function (o) { return o.geometry.d === 16 && o.geometry.w > 500 && o.geometry.h < 600 && o.geometry.h > 100; });
ok(!!back, 'задняя стенка найдена');
ok(!!side, 'боковина найдена');
ok(dfac.length > 0, 'фасад ящика найден');
if (back && side) {
  ok(back.position.z > side.position.z, 'ЗС ГЛУБЖЕ центра боковины (z больше): ЗС=' + back.position.z.toFixed(1) + ' > бок=' + side.position.z.toFixed(1));
  ok(Math.abs(back.position.z - (16 + (600 - 16 - 3))) < 6, 'ЗС у дальней плоскости (~z=597): ' + back.position.z.toFixed(1));
}
if (dfac.length && side) {
  ok(dfac[0].position.z < side.position.z, 'фасад ящика ВПЕРЕДИ центра боковины: фасад=' + dfac[0].position.z.toFixed(1) + ' < бок=' + side.position.z.toFixed(1));
  ok(dfac[0].position.z < 40, 'фасад ящика у передней плоскости корпуса (z<40, конвенция ядра — заподлицо): ' + dfac[0].position.z.toFixed(1));
}
console.log('Пройдено: ' + passed + ', провалено: ' + failed);
process.exit(failed > 0 ? 1 : 0);
