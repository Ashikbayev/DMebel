/* 2б: массив штанг s.rods, миграция легаси, интерактив, UI, валидатор. */
var { JSDOM } = require('jsdom');
var fs = require('fs');
var passed = 0, failed = 0;
function ok(c, l) { if (c) passed++; else { failed++; console.log('  ✗ ' + l); } }
function eq(a, b, l) { if (a === b) passed++; else { failed++; console.log('  ✗ ' + l + ': ожидалось ' + JSON.stringify(b) + ', получено ' + JSON.stringify(a)); } }

var dom = new JSDOM('<!DOCTYPE html><html><body><div id="viewport"></div><div id="dim-overlay"></div><div id="stats-badge"></div><div id="sections-container"></div><canvas id="c3d"></canvas></body></html>',
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
src += '\nrenderer={};camera={};scene={children:[],add:function(){},remove:function(){}};ML={};ML2={};MH={};MR={};MFL={};MFM={};ME={};window._ai_renderPanel=renderPanel;window._ai_copySection=duplicateSection;window._ai_validateProject=validateProject;window._ai_w2dClick=w2dClick;window._ai_fillSummary=fillSummary;\n';
win.eval(src);

var S = win._ai_secRods;

console.log('── CRUD штанг через UI-функции ──');
var s = win._ai_mkSection(); s.width = 900; s.height = 2400; s.depth = 600;
win._ai_sections = [s];
ok(Array.isArray(s.rods) && s.rods.length === 0, 'новая секция: rods=[]');
win.toggleRod(s.id);
eq(s.rods.length, 1, 'toggleRod включает штангу');
eq(s.rods[0].height, 2280, 'дефолтная высота H-120 со snap');
win.addRod(s.id);
eq(s.rods.length, 2, 'addRod добавляет вторую');
eq(s.rods[1].height, 1380, 'вторая на 900 ниже');
win.updRod(s.id, 1, 'height', '1400');
eq(s.rods[1].height, 1400, 'updRod меняет высоту');
win.updRod(s.id, 1, 'height', '9999');
eq(s.rods[1].height, 2400 - 48, 'высота клампится к секции');
win.delRod(s.id, 0);
eq(s.rods.length, 1, 'delRod удаляет');
eq(s.rods[0].height, 2352, 'осталась именно вторая');
win.toggleRod(s.id);
eq(s.rods.length, 0, 'toggleRod с штангами очищает все');

console.log('── Клик в 2D-редакторе ──');
var s1 = win._ai_mkSection(); s1.width = 800; s1.height = 2200; s1.depth = 600;
win._ai_sections = [s1];
function clickAt(tool, ymm) {
  win.w2dSetTool(tool);
  win._ai_w2dClick(s1.id, { offsetX: 400, offsetY: (2200 - ymm), currentTarget: { dataset: { sc: '1' } } });
}
clickAt('rod', 2000);
eq(s1.rods.length, 1, 'клик добавляет штангу');
eq(s1.rods[0].height, 2000, 'на высоте клика со snap');
clickAt('rod', 2030);
eq(s1.rods.length, 1, 'клик рядом (±60) двигает, не добавляет');
eq(s1.rods[0].height, 2030, 'штанга сдвинулась');
clickAt('rod', 1100);
eq(s1.rods.length, 2, 'клик в свободном месте добавляет вторую');
clickAt('del', 1110);
eq(s1.rods.length, 1, 'del снимает ближайшую');
eq(s1.rods[0].height, 2030, 'верхняя осталась');

console.log('── Копирование и шаблоны ──');
var sc = win._ai_copySection ? null : null;
s1.rods = [{ height: 2080, col: null }, { height: 1180, col: null }];
win._ai_copySection(s1.id);
var copies = win._ai_sections;
eq(copies.length, 2, 'секция скопирована');
eq(copies[1].rods.length, 2, 'копия несёт обе штанги');
ok(copies[1].rods !== s1.rods && copies[1].rods[0] !== s1.rods[0], 'глубокая копия, не ссылка');

console.log('── Легаси-проект и AI-экшен (main.js пишет hasRod) ──');
var sl = win._ai_mkSection(); sl.width = 800; sl.height = 2200; sl.depth = 600;
sl.rods = undefined; sl.hasRod = true; sl.rodHeight = 1600; sl.rodCol = null; // как из старого сохранения / addWardobeSection
win._ai_sections = [sl];
win._ai_renderPanel();
eq(sl.rods.length, 1, 'рендер панели мигрирует легаси на лету');
eq(sl.rods[0].height, 1600, 'высота из легаси-поля');
ok(win._ai_fillSummary(sl).indexOf('штанга') >= 0, 'сводка видит мигрированную штангу');

console.log('── Валидатор ──');
var sv = win._ai_mkSection(); sv.width = 1400; sv.height = 2400; sv.depth = 300;
sv.rods = [{ height: 2280, col: null }, { height: 1300, col: null }];
win._ai_sections = [sv];
var msgs = win._ai_validateProject().map(function (m) { return m.msg; }).join(' | ');
eq((msgs.match(/длиннее/g) || []).length, 2, 'предупреждение о пролёте — на каждую штангу');
ok(msgs.indexOf('плечики не влезут') >= 0, 'глубина 300 со штангой — предупреждение');

console.log('── Панель: бейдж и строки ──');
var sp = win._ai_mkSection(); sp.width = 900; sp.height = 2400; sp.depth = 600;
sp.rods = [{ height: 2280, col: null }, { height: 1380, col: null }];
win._ai_sections = [sp];
win._ai_renderPanel();
var html = win.document.getElementById('sections-container').innerHTML;
ok(html.indexOf('2 шт') >= 0, 'бейдж «2 шт» при двух штангах');
ok((html.match(/updRod\(/g) || []).length >= 2, 'по строке на каждую штангу');
ok(html.indexOf('addRod(') >= 0, 'кнопка «+ штанга» есть');
ok(html.indexOf('delRod(') >= 0, 'кнопка удаления есть');

console.log('── Кламп при смене высоты (баг со скрина: штанга выше крыши) ──');
var sh = win._ai_mkSection(); sh.width = 800; sh.height = 2200; sh.depth = 600;
win._ai_sections = [sh];
win.applyFillType(sh.id, 'rodDouble');
eq(sh.rods.length, 2, 'двойная штанга при 2200 поставлена');
eq(sh.rods[0].height, 2080, 'верхняя 2080');
win.upd(sh.id, 'height', '2000');
ok(sh.rods[0].height <= 2000 - 48, 'после смены высоты на 2000 верхняя внутри секции: ' + sh.rods[0].height);
eq(sh.rods[0].height, 1952, 'верхняя прижата к 2000−48');
eq(sh.rods[1].height, 1180, 'нижняя не тронута (была внутри)');
win.upd(sh.id, 'height', '1200');
ok(sh.rods.every(function (r) { return r.height >= 48 && r.height <= 1200 - 48; }), 'обе внутри и при 1200');

console.log('── totalRods для КП ──');
var sa = win._ai_mkSection(); sa.width = 800; sa.height = 2400; sa.depth = 600;
sa.rods = [{ height: 2280, col: null }, { height: 1380, col: null }];
var sb = win._ai_mkSection(); sb.width = 800; sb.height = 2400; sb.depth = 600;
sb.rods = undefined; sb.hasRod = true; sb.rodHeight = 1600; // легаси вперемешку
win._ai_sections = [sa, sb];
var tot = win._ai_sections.reduce(function (a, x) { return a + S(x).length; }, 0);
eq(tot, 3, 'сумма штанг по секциям: 2 новых + 1 легаси = 3');

console.log('');
console.log('Пройдено: ' + passed + ', провалено: ' + failed);
process.exit(failed > 0 ? 1 : 0);
