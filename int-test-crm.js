/* Интеграционный тест CORE ENGINE в wardrobe.js (jsdom).
   Загружает реальный wardrobe.js со стабом THREE, гоняет calcParts
   через ядро и сверяет детали с эталонными формулами wardrobe-core,
   плюс проверяет откат setCoreEngine(false) на легаси-расчёт. */
var { JSDOM } = require('jsdom');
var fs = require('fs');

var passed = 0, failed = 0;
function ok(c, l) { if (c) passed++; else { failed++; console.log('  ✗ ' + l); } }
function eq(a, b, l) { if (a === b) passed++; else { failed++; console.log('  ✗ ' + l + ': ожидалось ' + JSON.stringify(b) + ', получено ' + JSON.stringify(a)); } }

var dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/'
});
var win = dom.window;

// Стаб THREE: любой конструктор/метод — заглушка
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
win.eval('window.__THREE__ = null;');
win.__THREE__ = mkStub();

// Ядро — как в браузере, обычным скриптом
win.eval(fs.readFileSync('/home/claude/int/wardrobe-core.js', 'utf8'));
ok(!!win.WardrobeCore, 'ядро загрузилось (window.WardrobeCore)');

// wardrobe.js: убираем import, THREE берём из стаба
var src = fs.readFileSync('/home/claude/int/wardrobe.js', 'utf8');
src = src.replace("import * as THREE from 'three';", 'const THREE = window.__THREE__;');
try {
  win.eval(src);
} catch (e) {
  console.log('Загрузка wardrobe.js упала:', e.message);
  process.exit(1);
}
ok(typeof win._calcParts === 'function', 'мост _calcParts есть');

console.log('── Интеграция: CORE ENGINE в calcParts ──');

// ── Секция 1: голый корпус 800×2200×600 ──
var s1 = win._ai_mkSection();
s1.width = 800; s1.height = 2200; s1.depth = 600;
win._ai_sections = [s1];
var r1 = win._calcParts();
// Ядро (legs 0, edge 1): стойка = 2200−32−1 = 2167 × pd 579;
// Крыша/Дно 798×579; ЗС 2198×798
var bl = r1.ldsp.find(function (p) { return p.name === 'С1 Бок лев'; });
ok(bl, 'Бок лев есть');
eq(bl.w, 579, 'Бок лев: глубина 579 (600−16−3−2 подрезка)');
eq(bl.h, 2167, 'Бок лев: высота 2167 (2200−32−1 подрезка)');
var kr = r1.ldsp.find(function (p) { return p.name === 'С1 Крыша'; });
eq(kr.w, 798, 'Крыша 798 (800−2 подрезка, накладная)');
eq(kr.h, 579, 'Крыша глубина 579');
var zs = r1.hdf.find(function (p) { return p.name === 'С1 Задняя'; });
ok(zs, 'Задняя в ХДФ');
eq(zs.w, 2198, 'ЗС высота 2198 (2200−2)');
eq(zs.h, 798, 'ЗС ширина 798');
eq(r1.ldsp.length, 4, 'корпус: 4 детали ЛДСП');
ok(r1.totalPm2 > 0, 'кромка 2мм посчитана');

// ── Секция 2: перегородка + полки по колонкам ──
var s2 = win._ai_mkSection();
s2.width = 800; s2.height = 2000; s2.depth = 600;
s2.dividers.push({ id: s2.divId++, pos: 392 });   // как getColumns: [16..392]+[408..784]
s2.shelves.push({ id: s2.shelfId++, height: 1000, col: 0 });
s2.shelves.push({ id: s2.shelfId++, height: 600, col: 1 });
s2.shelves.push({ id: s2.shelfId++, height: 1200, col: 1 });
win._ai_sections = [s2];
var r2 = win._calcParts();
var pg = r2.ldsp.find(function (p) { return p.name === 'С1 Перегор.1'; });
ok(pg, 'перегородка есть');
eq(pg.h, 1968, 'перегородка ровно в проём 2000−32 (эталон: Вертикальная без −1)');
var polki = r2.ldsp.filter(function (p) { return p.name.indexOf('Полка') >= 0; });
eq(polki.length, 3, 'три полки');
// колонка 0: ширина 392−16 = 376 → раскрой 376 (ядро режет в проём)
eq(polki[0].w, 376, 'полка колонки 0 в ширину проёма 376');
eq(polki[1].w, 376, 'полка колонки 1 (0..: 784−408=376)');

// ── Секция 3: ящики (overlay по эталону 2) ──
var s3 = win._ai_mkSection();
s3.width = 800; s3.height = 2000; s3.depth = 600;
s3.shelves.push({ id: s3.shelfId++, height: 800, col: 0 });
s3.drawerBlocks.push({ nicheIdx: 0, count: 2, brand: 'En-7' });
win._ai_sections = [s3];
var r3 = win._calcParts();
// проём 768 (без перегородок), короб = 768−26 = 742
var dfr = r3.ldsp.find(function (p) { return p.name.indexOf('пер') >= 0 && p.name.indexOf('Яш.') >= 0; });
ok(dfr, 'перед ящика есть');
eq(dfr.w, 710, 'перед ящика = 742−32 (эталон 2: без −1)');
var ddn = r3.hdf.find(function (p) { return p.name.indexOf('дно') >= 0; });
ok(ddn, 'дно ящика в ХДФ (по эталону 2, было ЛДСП)');
eq(ddn.w, 740, 'дно ящика 742−2');
var dfa = r3.facLdsp.find(function (p) { return p.name.indexOf('фас') >= 0; });
ok(dfa, 'фасад ящика в фасадном списке');
eq(dfa.w, 798, 'фасад ящика гео 768+32, раскрой 800−2 (перекрытие)');
var dbok = r3.ldsp.filter(function (p) { return p.name.indexOf('бок.') >= 0; });
eq(dbok.length, 4, '4 боковины на 2 ящика');
eq(dbok[0].w, 549, 'боковина 550−1');

// ── Секция 4: штанга ──
var s4 = win._ai_mkSection();
s4.width = 800; s4.height = 2200; s4.depth = 600;
s4.hasRod = true; s4.rodHeight = 1900;
win._ai_sections = [s4];
var r4 = win._calcParts();
eq(r4.ldsp.length, 4, 'штанга не попала в листовые детали');
var tree4 = win._buildCoreTree(s4);
eq(tree4.type, 'rod', 'дерево: штанга листом в корне');
eq(tree4.drop, 2200 - 16 - 1900, 'drop от верха проёма до rodHeight');

// ── Антресоль ──
var s5 = win._ai_mkSection();
s5.width = 800; s5.height = 2000; s5.depth = 600;
s5.antresol.enabled = true; s5.antresol.height = 400;
s5.antresol.shelves.push({ id: s5.antresol.shelfId++, height: 200 });
win._ai_sections = [s5];
var r5 = win._calcParts();
var abl = r5.ldsp.find(function (p) { return p.name === 'С1А Бок лев'; });
ok(abl, 'антресоль: бок есть');
eq(abl.h, 367, 'антресоль: бок 400−32−1');
var apl = r5.ldsp.find(function (p) { return p.name === 'С1А Полка 1'; });
ok(apl, 'антресоль: полка есть');
eq(apl.w, 768, 'антресоль: полка в проём 768');
ok(r5.hdf.some(function (p) { return p.name === 'С1А Задняя'; }), 'антресоль: своя ЗС');

// ── Фасады секции — старая формула CRM не тронута ──
var s6 = win._ai_mkSection();
s6.width = 800; s6.height = 2000; s6.depth = 600;
s6.facade.type = 'doors2';
win._ai_sections = [s6];
var r6 = win._calcParts();
var f6 = r6.facLdsp.filter(function (p) { return p.name.indexOf('Фасад') >= 0; });
eq(f6.length, 2, 'двери: 2 фасада');
eq(f6[0].w, Math.round((800 - 4 * 3) / 2), 'двери: старая формула W');
eq(f6[0].h, 2000 - 8, 'двери: старая формула H');

// ── Откат: setCoreEngine(false) → легаси-расчёт (старые цифры) ──
win.setCoreEngine(false);
win._ai_sections = [s1];
var rl = win._calcParts();
var lbl = rl.ldsp.find(function (p) { return p.name === 'С1 Бок лев'; });
eq(lbl.w, 581, 'легаси: бок 581 (без подрезки, как раньше)');
eq(lbl.h, 2168, 'легаси: бок 2168');
win.setCoreEngine(true);

console.log('');
console.log('Пройдено: ' + passed + ', провалено: ' + failed);
process.exit(failed > 0 ? 1 : 0);
