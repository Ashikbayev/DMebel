/* Мастер быстрого старта: 4 шага → построенные секции с наполнением. */
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
src += '\nrenderer={};camera={};scene={children:[],add:function(){},remove:function(){}};ML={};ML2={};MH={};MR={};MFL={};MFM={};ME={};window._ai_render3D2=render3D;\n';
win.eval(src);
win._ai_sections = [win._ai_mkSection()];
win._ai_render3D2();

// 1) Открытие: модалка создана, шаг 1
win.wizOpen();
var m = win.document.getElementById('w2dwiz');
ok(!!m, 'модалка мастера создана');
eq(m.style.display, 'block', 'мастер показан');
ok(m.innerHTML.indexOf('MEBELOFF') >= 0, 'брендинг в шапке');
ok(m.innerHTML.indexOf('Стена и размеры') >= 0, 'шаг 1');

// 2) Стена: 4000×3000×600, отступы 50/50/100
win.wizSet('len', '4000'); win.wizSet('hei', '3000'); win.wizSet('dep', '600');
win.wizSet('offL', '50'); win.wizSet('offR', '50'); win.wizSet('offT', '100');
var wz = win._ai_wiz();
eq(win._ai_wiz().len, 4000, 'длина 4000');
// авто-двери: W=3900 → round(3900/500)=8
eq(wz.doors, 8, 'авто: 8 дверей (3900/500)');

// 3) Шаг 2: двери 8, антресоль 600 → модули 2+2+2+2 (4 секции)
win.wizStep(1);
ok(m.innerHTML.indexOf('дв.') >= 0, 'шаг 2: модули показаны');
win.wizSet('antr', true); win.wizSet('antrH', '600');
var mods = [];
// проверяем разбивку через построение позже; здесь сумма ширин
// 4) Шаг 3: пресеты
win.wizStep(1);
ok(m.innerHTML.indexOf('Секция 1') >= 0 && m.innerHTML.indexOf('5 полок') >= 0, 'шаг 3: библиотека пресетов');
win.wizPreset(0, 'shelves5');
win.wizPreset(1, 'rod2shelf');
win.wizPreset(2, 'shDrawers');
win.wizPreset(3, 'rod');
eq(win._ai_wiz().presets.join(','), 'shelves5,rod2shelf,shDrawers,rod', 'пресеты выбраны');

// 5) Шаг 4: материал + построить
win.wizStep(1);
ok(m.innerHTML.indexOf('МДФ Краска') >= 0, 'шаг 4: материалы');
win.wizSet('mat', 'mdfKraska');
win.confirm = function(){ return true; };
win.wizBuild();

var S = win._ai_sections;
eq(S.length, 4, 'построено 4 секции (8 дверей по 2)');
var sumW = S.reduce(function (a, s) { return a + s.width; }, 0);
eq(sumW, 3900, 'сумма ширин = ширине шкафа 3900 (без потерь округления)');
eq(S[0].height, 2900 - 600, 'высота секции = H − антресоль (2300)');
ok(S.every(function (s) { return s.antresol.enabled && s.antresol.height === 600; }), 'антресоль 600 на всех');
ok(S.every(function (s) { return s.facade.type === 'doors2'; }), 'фасад doors2 на всех (по 2 двери)');
ok(S.every(function (s) { return s.facade.material === 'mdfKraska'; }), 'материал МДФ Краска');
eq(S[0].shelves.length, 5, 'пресет 5 полок применён');
ok(S[1].hasRod && S[1].shelves.length === 1, 'пресет штанга+полка');
eq(S[2].drawerBlocks.length, 1, 'пресет полки+ящики: блок ящиков');
eq(S[2].shelves.length, 2, 'пресет полки+ящики: 2 полки');
ok(S[3].hasRod && S[3].shelves.length === 0, 'пресет штанга');
eq(m.style.display, 'none', 'мастер закрылся после построения');

// 6) раскрой считается без ошибок
var r = win._calcParts();
ok(r.ldsp.length > 20, 'раскрой построился (' + r.ldsp.length + ' деталей ЛДСП)');
ok(r.facLdsp.length === 0, 'фасады не в ЛДСП-списке (МДФ Краска)');

// 7) нечётные двери: 5 → модули 2+3
win.wizOpen();
win.wizSet('len', '2500'); win.wizSet('offL', '0'); win.wizSet('offR', '0');
win.wizSet('doors', '5');
win.wizStep(1); win.wizStep(1); win.wizStep(1);
win.wizBuild();
var S2 = win._ai_sections;
eq(S2.length, 2, '5 дверей → 2 модуля');
eq(S2[0].facade.type, 'doors2', 'модуль 1: 2 двери');
eq(S2[1].facade.type, 'doors3', 'модуль 2: 3 двери');
eq(S2[0].width + S2[1].width, 2500, 'ширины без потерь');

console.log('Пройдено: ' + passed + ', провалено: ' + failed);
process.exit(failed > 0 ? 1 : 0);
