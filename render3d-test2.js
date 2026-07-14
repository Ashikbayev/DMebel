var { JSDOM } = require('jsdom');
var fs = require('fs');

var passed = 0, failed = 0;
function ok(c, l) { if (c) passed++; else { failed++; console.log('  ✗ ' + l); } }
function eq(a, b, l) { if (a === b) passed++; else { failed++; console.log('  ✗ ' + l + ': ожидалось ' + JSON.stringify(b) + ', получено ' + JSON.stringify(a)); } }

var dom = new JSDOM('<!DOCTYPE html><html><body><div id="viewport"></div><div id="dim-overlay"></div><div id="stats-badge"></div></body></html>', {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/'
});
var win = dom.window;

function mkStub() {
  return new Proxy(function () { return mkStub(); }, {
    get: function (t, k) {
      if (k === Symbol.toPrimitive || k === 'toString') return function () { return ''; };
      return mkStub();
    },
    construct: function () { return mkStub(); },
    apply: function () { return mkStub(); }
  });
}
function makeObj3D() {
  return {
    userData: {},
    position: {
      x: 0, y: 0, z: 0,
      set: function (x, y, z) { this.x = x; this.y = y; this.z = z; },
      copy: function (p) { this.x = p.x; this.y = p.y; this.z = p.z; }
    },
    rotation: { x: 0, y: 0, z: 0 },
    castShadow: false, receiveShadow: false, material: null
  };
}
var THREE_REAL = {
  Mesh: function (g, m) { var o = makeObj3D(); o.geometry = g; o.material = m; o.isMesh = true; return o; },
  LineSegments: function (g, m) { var o = makeObj3D(); o.geometry = g; o.material = m; o.isLine = true; return o; },
  BoxGeometry: function (w, h, d) { return { type: 'box', w: w, h: h, d: d }; },
  CylinderGeometry: function (r1, r2, h, seg) { return { type: 'cyl', r1: r1, r2: r2, h: h }; },
  EdgesGeometry: function (g) { return { type: 'edges', src: g }; }
};
var THREE_STUB_FALLBACK = mkStub();
win.__THREE__ = new Proxy({}, {
  get: function (t, k) { return (k in THREE_REAL) ? THREE_REAL[k] : THREE_STUB_FALLBACK; },
  construct: function () { return mkStub(); }
});
win.__added__ = [];

win.eval(fs.readFileSync('wardrobe-core.js', 'utf8'));

var src = fs.readFileSync('wardrobe.js', 'utf8');
src = src.replace("import * as THREE from 'three';", 'const THREE = window.__THREE__;');
// стабы 3D-окружения — ДОБАВЛЯЕМ В ТОТ ЖЕ eval, чтобы попасть в ту же
// лексическую область, что и "let renderer,scene,camera;" внутри файла.
src += '\n' +
  'renderer = {};\n' +
  'camera = {};\n' +
  'scene = { children: [], add: function(o){ this.children.push(o); window.__added__.push(o); }, remove: function(o){ var i=this.children.indexOf(o); if(i>=0)this.children.splice(i,1); } };\n' +
  'ML={}; ML2={}; MH={}; MR={}; MFL={}; MFM={}; ME={};\n';
win.eval(src);

ok(typeof win._ai_render3D === 'function', 'render3D экспортирован');
ok(!!win.WardrobeCore, 'ядро загрузилось');

var added = win.__added__;

console.log('── render3D: голый корпус (без полок/ящиков) ──');
var s1 = win._ai_mkSection();
s1.width = 800; s1.height = 2200; s1.depth = 600;
win._ai_sections = [s1];
added.length = 0;
try {
  win._ai_render3D();
  ok(true, 'render3D не упал на голом корпусе');
} catch (e) {
  ok(false, 'render3D упал: ' + e.message + '\n' + e.stack);
}
eq(added.length, 18, 'голый корпус: 10 (5 досок x мешь+кромка) + 8 (4 ножки+4 колпачка)');

console.log('── render3D: полки + перегородка ──');
var s2 = win._ai_mkSection();
s2.width = 800; s2.height = 2000; s2.depth = 600;
s2.dividers.push({ id: s2.divId++, pos: 392 });
s2.shelves.push({ id: s2.shelfId++, height: 1000, col: 0 });
s2.shelves.push({ id: s2.shelfId++, height: 600, col: 1 });
s2.shelves.push({ id: s2.shelfId++, height: 1200, col: 1 });
win._ai_sections = [s2];
added.length = 0;
try {
  win._ai_render3D();
  ok(true, 'render3D не упал на секции с полками+перегородкой');
} catch (e) {
  ok(false, 'render3D упал: ' + e.message + '\n' + e.stack);
}
eq(added.length, 26, 'полки+перегородка: 10(корпус)+2(перегородка)+6(3 полки x меш+кромка)+8(ножки)');
var shelfMeshes = added.filter(function (o) { return o.userData && o.userData.drag; });
eq(shelfMeshes.length, 3, '3 полки с userData.drag');
var ids = shelfMeshes.map(function (o) { return o.userData.shelfId; }).sort();
var expected = [s2.shelves[0].id, s2.shelves[1].id, s2.shelves[2].id].sort();
eq(JSON.stringify(ids), JSON.stringify(expected), 'shelfId в userData совпадают с реальными id полок секции');
ok(shelfMeshes.every(function (o) { return o.userData.secId === s2.id; }), 'secId у всех полок верный');
ok(shelfMeshes.every(function (o) { return typeof o.userData.minY === 'number' && typeof o.userData.maxY === 'number' && typeof o.userData.sw === 'number' && typeof o.userData.sd === 'number'; }), 'minY/maxY/sw/sd на месте (нужны drag-обработчику)');

console.log('── render3D: ящики (drawerBlocks) через дерево ядра ──');
var s3 = win._ai_mkSection();
s3.width = 800; s3.height = 2000; s3.depth = 600;
s3.shelves.push({ id: s3.shelfId++, height: 800, col: 0 });
s3.drawerBlocks.push({ nicheIdx: 0, count: 2, brand: 'En-7' });
win._ai_sections = [s3];
added.length = 0;
try {
  win._ai_render3D();
  ok(true, 'render3D не упал на секции с ящиками');
} catch (e) {
  ok(false, 'render3D упал: ' + e.message + '\n' + e.stack);
}
ok(added.length > 5, 'ящики дали доп. меши (боковины/перед/зад/дно/фасад), итого ' + added.length);

console.log('── render3D: штанга (rod) — цилиндр по core box ──');
var s4 = win._ai_mkSection();
s4.width = 800; s4.height = 2200; s4.depth = 600;
s4.hasRod = true; s4.rodHeight = 1900;
win._ai_sections = [s4];
added.length = 0;
try {
  win._ai_render3D();
  ok(true, 'render3D не упал со штангой');
} catch (e) {
  ok(false, 'render3D упал: ' + e.message + '\n' + e.stack);
}
eq(added.length, 19, 'штанга: 10(корпус)+8(ножки)+1(штанга, без держателей — фурнитура, edges нет)');

console.log('── откат setCoreEngine(false) — 3D тоже уходит на legacy ──');
win.setCoreEngine(false);
win._ai_sections = [s1];
added.length = 0;
try {
  win._ai_render3D();
  ok(true, 'render3D (legacy) не упал');
} catch (e) {
  ok(false, 'render3D (legacy) упал: ' + e.message);
}
ok(added.length > 0, 'legacy-режим тоже что-то рисует (' + added.length + ' мешей)');
win.setCoreEngine(true);

console.log('');
console.log('Пройдено: ' + passed + ', провалено: ' + failed);
process.exit(failed > 0 ? 1 : 0);
