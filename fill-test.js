/* Каталог наполнения: 10 типов, fits/apply, карточки, миниатюры. */
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
src += '\nrenderer={};camera={};scene={children:[],add:function(){},remove:function(){}};ML={};ML2={};MH={};MR={};MFL={};MFM={};ME={};window._ai_renderPanel=renderPanel;\n';
win.eval(src);

var FT = win._ai_FILL_TYPES;

console.log('── Реестр ──');
eq(FT.length, 10, 'ровно 10 типов');
var ids = FT.map(function (t) { return t.id; });
eq(new Set(ids).size, 10, 'все id уникальны');
var readyIds = FT.filter(function (t) { return t.ready; }).map(function (t) { return t.id; }).sort().join(',');
eq(readyIds, 'drawerStack,rodDouble,rodDrawers,rodLong,shelfDrawer,shelves3,shelvesDense', '7 рабочих типов, 3 с механикой в след. шаге');
ok(FT.every(function (t) { return t.name && t.desc && typeof t.fits === 'function' && typeof t.thumb === 'function'; }), 'у каждого: имя, описание, fits, миниатюра');
ok(FT.every(function (t) { return !t.ready || typeof t.apply === 'function'; }), 'у каждого рабочего есть apply');

console.log('── fits: причины недоступности ──');
var sm = win._ai_mkSection(); sm.width = 800; sm.height = 1200; sm.depth = 600;
function ft(id) { return FT.find(function (t) { return t.id === id; }); }
ok(ft('rodDouble').fits(sm).indexOf('1900') >= 0, 'двойная штанга в 1200 → причина про высоту 1900');
ok(ft('pantograph').fits(sm).indexOf('2200') >= 0, 'пантограф в 1200 → причина про 2200');
ok(ft('rodLong').fits(sm) !== '', 'штанга под длинное в 1200 → недоступна');
eq(ft('shelves3').fits(sm), '', 'классика полок в 1200 → доступна');
var sd = win._ai_mkSection(); sd.width = 800; sd.height = 2000; sd.depth = 250;
ok(ft('drawerStack').fits(sd).indexOf('300') >= 0, 'ящики при глубине 250 → причина про глубину');
ok(ft('rodLong').fits(sd).indexOf('500') >= 0, 'штанга при глубине 250 → причина про плечики');
var sw = win._ai_mkSection(); sw.width = 1400; sw.height = 2400; sw.depth = 600;
ok(ft('pantograph').fits(sw).indexOf('450') >= 0, 'пантограф на ширину 1400 → причина про диапазон механизмов');

console.log('── apply: построение на примитивах ──');
var s = win._ai_mkSection(); s.width = 800; s.height = 2200; s.depth = 600;
win._ai_sections = [s];
ft('shelves3').apply(s);
eq(s.shelves.length, 3, 'классика: 3 полки');
ok(s.shelves.every(function (sh) { return sh.height > 100 && sh.height < 2100 && sh.height % 10 === 0; }), 'полки внутри секции, snap к 10');
ft('shelvesDense').apply(s);
eq(s.shelves.length, 5, 'плотные при 2200: 5 полок (замещение, не добавление)');
ft('shelfDrawer').apply(s);
eq(s.shelves.length, 2, 'полка+ящик: 2 полки');
eq(s.drawerBlocks.length, 1, 'полка+ящик: 1 блок ящиков');
eq(s.drawerBlocks[0].count, 1, 'полка+ящик: ящик один');
ok(s.shelves[0].height > s.height / 2, 'полки в верхней зоне');
ft('drawerStack').apply(s);
eq(s.shelves.length, 0, 'блок ящиков: полок нет');
eq(s.drawerBlocks[0].count, 4, 'блок ящиков при 2200: 4 ящика');
ft('rodLong').apply(s);
ok(s.rods.length === 1 && s.drawerBlocks.length === 0, 'штанга: только штанга');
eq(s.rods[0].height, 2080, 'штанга на H-120 со snap');
ft('rodDrawers').apply(s);
eq(s.rods.length, 1, 'штанга+ящики: штанга есть');
eq(s.drawerBlocks[0].count, 2, 'штанга+ящики: 2 ящика');

// низкая секция: плотных полок 4
var s2 = win._ai_mkSection(); s2.width = 800; s2.height = 1400; s2.depth = 600;
ft('shelvesDense').apply(s2);
eq(s2.shelves.length, 4, 'плотные при 1400: 4 полки');

// с перегородкой полки дублируются на обе колонки
var s3 = win._ai_mkSection(); s3.width = 1200; s3.height = 2000; s3.depth = 600;
s3.dividers.push({ id: s3.divId++, pos: 600 });
ft('shelves3').apply(s3);
eq(s3.shelves.length, 6, 'классика с перегородкой: 3 полки × 2 колонки');
eq(s3.shelves.filter(function (sh) { return sh.col === 1; }).length, 3, 'вторая колонка заполнена');

console.log('── Карточки в панели ──');
var s4 = win._ai_mkSection(); s4.width = 800; s4.height = 1200; s4.depth = 600;
win._ai_sections = [s4];
win._ai_renderPanel();
var html = win.document.getElementById('sections-container').innerHTML;
ok(html.indexOf('Наполнение — 10 типов') >= 0, 'аккордеон каталога в панели');
eq((html.match(/class="ft-card/g) || []).length, 10, '10 карточек в DOM');
ok(html.indexOf('ft-off') >= 0, 'недоступные карточки приглушены');
ok(html.indexOf('нужна высота от 1900') >= 0, 'причина недоступности показана на карточке');
ok(html.indexOf('механика — след. шаг') >= 0, 'нерабочие типы помечены честно');
ok((html.match(/onclick="applyFillType/g) || []).length >= 3, 'доступные карточки кликабельны');

console.log('── Клик применяет тип ──');
win.applyFillType(s4.id, 'shelves3');
eq(s4.shelves.length, 3, 'клик по «Классике» построил 3 полки');
var before = s4.shelves.length;
win.applyFillType(s4.id, 'pantograph');
eq(s4.shelves.length, before, 'клик по нерабочему типу ничего не ломает');
win.applyFillType(s4.id, 'rodLong');
eq(s4.rods.length, 0, 'недоступный по габаритам тип не применяется (1200 < 1400)');
win.applyFillType(s4.id, 'rodDouble');
eq(s4.rods.length, 0, 'двойная штанга в 1200 не применяется (нужно 1900)');

console.log('── Двойная штанга: механика ──');
var s5 = win._ai_mkSection(); s5.width = 900; s5.height = 2400; s5.depth = 600;
win._ai_sections = [s5];
ft('rodDouble').apply(s5);
eq(s5.rods.length, 2, 'двойная штанга: 2 штанги');
eq(s5.rods[0].height, 2280, 'верхняя на H-120 со snap');
eq(s5.rods[1].height, 1380, 'нижняя на 900 ниже верхней');
ok(s5.rods.every(function (r) { return r.col === null; }), 'обе на всю секцию');
var hw = win._ai_moduleHardware(s5);
function hwq(n) { var r = hw.find(function (x) { return x.n === n; }); return r ? r.q : 0; }
eq(hwq('Штанга'), 2, 'ведомость: 2 штанги');
eq(hwq('Штангодержатель'), 4, 'ведомость: 4 держателя');
win.applyFillType(s5.id, 'rodDouble');
eq(s5.rods.length, 2, 'клик по карточке строит 2 штанги');
ft('rodLong').apply(s5);
eq(s5.rods.length, 1, 'смена на одинарную замещает, а не добавляет');

console.log('── Миграция легаси hasRod → rods ──');
var s6 = win._ai_mkSection(); s6.width = 800; s6.height = 2200; s6.depth = 600;
s6.rods = undefined; s6.hasRod = true; s6.rodHeight = 1500; s6.rodCol = null;
var mig = win._ai_secRods(s6);
eq(mig.length, 1, 'легаси-секция мигрирует в 1 штангу');
eq(mig[0].height, 1500, 'высота легаси-штанги сохранена');
ok(!s6.hasRod, 'легаси-флаг снят после миграции');
eq(win._ai_secRods(s6).length, 1, 'повторный вызов идемпотентен');
var hw6 = win._ai_moduleHardware(s6);
eq(hw6.find(function (x) { return x.n === 'Штанга'; }).q, 1, 'легаси-штанга попадает в ведомость');

console.log('── Миниатюры различимы ──');
ok(ft('drawerStack').thumb().indexOf('stroke-linecap="round"') >= 0, 'у ящиков — ручки на фасадах');
ok(ft('rodLong').thumb().indexOf('<path') >= 0, 'у штанги — вешалки');
ok(ft('pantograph').thumb().split('<line').length > 3, 'у пантографа — рычаги механизма');
ok(ft('shoes').thumb().indexOf('y1="21"') >= 0 || /y1="(\d+)" x2="53" y2="(\d+)"/.test(ft('shoes').thumb()), 'у обувных полок — наклон');
var m = ft('shoes').thumb().match(/x1="7" y1="(\d+)" x2="53" y2="(\d+)"/);
ok(m && m[1] !== m[2], 'наклонная линия действительно наклонная');
ok(ft('trousers').thumb().indexOf('<rect x="10"') >= 0, 'у брючницы — лотки');
var allThumbs = FT.map(function (t) { return t.thumb(); });
eq(new Set(allThumbs).size, 10, 'все 10 миниатюр разные');

console.log('');
console.log('Пройдено: ' + passed + ', провалено: ' + failed);
process.exit(failed > 0 ? 1 : 0);
