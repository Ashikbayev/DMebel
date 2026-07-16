/* Сборочный чертёж: листы, позиции, деталировка, фурнитура, штамп, фасады. */
var { JSDOM } = require('jsdom');
var fs = require('fs');
var passed = 0, failed = 0;
function ok(c, l) { if (c) passed++; else { failed++; console.log('  ✗ ' + l); } }
function eq(a, b, l) { if (a === b) passed++; else { failed++; console.log('  ✗ ' + l + ': ожидалось ' + JSON.stringify(b) + ', получено ' + JSON.stringify(a)); } }

var dom = new JSDOM('<!DOCTYPE html><html><body><div id="viewport"></div><div id="dim-overlay"></div><div id="stats-badge"></div><div id="sections-container"></div>' +
  '<input id="proj-name-inp" value="Шкаф у стены"><input id="proj-client-inp" value="Хамит"><input id="proj-phone-inp" value="87008006600"></body></html>',
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
src += '\nrenderer={};camera={};scene={children:[],add:function(){},remove:function(){}};ML={};ML2={};MH={};MR={};MFL={};MFM={};ME={};\n';
win.eval(src);

var opened = null;
win.open = function () {
  opened = { html: '', document: { write: function (h) { opened.html = h; }, close: function () { } } };
  return opened;
};

// секция: 2 двери, полка, ящики, штанга, антресоль
var s = win._ai_mkSection();
s.width = 900; s.height = 2000; s.depth = 600;
s.facade.type = 'doors2';
s.facade.frez = 'venecia';
s.shelves.push({ id: s.shelfId++, height: 800, col: 0 });
s.drawerBlocks.push({ nicheIdx: 0, count: 2, brand: 'En-7' });
s.hasRod = true;
var s2 = win._ai_mkSection();
s2.width = 600; s2.height = 2000; s2.depth = 600;
win._ai_sections = [s, s2];

console.log('── Генерация ──');
win.showAssemblyDrawing();
ok(!!opened, 'окно чертежа открыто');
var h = opened.html;
ok(h.indexOf('Сборочный чертёж') >= 0, 'заголовок');
ok(h.indexOf('A4 landscape') >= 0, 'A4 альбомный');
eq((h.match(/class="page"/g) || []).length, 5, 'обложка + 2 секции × 2 = 5 листов');
ok(h.indexOf('Лист 1 / 5') >= 0 && h.indexOf('Лист 5 / 5') >= 0, 'нумерация листов сквозная');

console.log('── Штамп ──');
ok(h.indexOf('MEBELOFF') >= 0, 'бренд в штампе');
ok(h.indexOf('Хамит') >= 0, 'клиент из полей проекта');
ok(h.indexOf('87008006600') >= 0, 'телефон');
ok(h.indexOf('Шкаф у стены') >= 0, 'название проекта');
ok(h.indexOf('900×2000×600') >= 0, 'габариты модуля 1');
ok(h.indexOf('600×2000×600') >= 0, 'габариты модуля 2');
ok(h.indexOf('Модуль №1') >= 0 && h.indexOf('Модуль №2') >= 0, 'номера модулей');

console.log('── Деталировка ──');
ok(h.indexOf('Деталировка') >= 0, 'таблица деталировки');
ok(h.indexOf('Стойка') >= 0 && h.indexOf('Крыша') >= 0 && h.indexOf('Дно') >= 0, 'корпусные детали по-русски');
ok(h.indexOf('Полка') >= 0, 'полка');
ok(h.indexOf('ЛДСП 16') >= 0 && h.indexOf('ХДФ 3') >= 0, 'материалы деталей');

console.log('── Свод одинаковых позиций ──');
var res = win.WardrobeCore.buildCarcass(win._ai_coreCfgFor(s));
var carcass = res.parts.filter(function (p) { return p.kind !== 'facade' && p.kind !== 'dfacade' && p.material !== 'metal'; });
var rows = win._ai_posTableFor(carcass);
ok(rows.length < carcass.length, 'одинаковые детали свёрнуты: ' + carcass.length + ' деталей → ' + rows.length + ' позиций');
ok(rows.every(function (r, i) { return r.pos === i + 1; }), 'позиции пронумерованы подряд');
var sides = rows.find(function (r) { return r.name === 'Стойка'; });
eq(sides.qty, 2, 'две стойки — одна позиция с кол-вом 2');
ok(rows.reduce(function (a, r) { return a + r.qty; }, 0) === carcass.length, 'сумма кол-в = числу деталей (ничего не потеряно)');

console.log('── Фурнитура по модулю ──');
var hw = win._ai_moduleHardware(s);
var hin = hw.find(function (r) { return r.n.indexOf('Петля') >= 0; });
eq(hin.q, 6, 'петли: 2 двери × 3 (высота > 1500)');
var hnd = hw.find(function (r) { return r.n === 'Ручка'; });
eq(hnd.q, 4, 'ручки: 2 двери + 2 ящика');
ok(hw.some(function (r) { return r.n.indexOf('Направляющая') >= 0 && r.q === 2; }), 'направляющие на 2 ящика');
ok(hw.some(function (r) { return r.n === 'Штанга' && r.q === 1; }), 'штанга 1');
ok(hw.some(function (r) { return r.n.indexOf('Ножка') >= 0 && r.q === 4; }), 'ножки 4');
// модуль без фурнитуры дверей
var hw2 = win._ai_moduleHardware(s2);
ok(!hw2.some(function (r) { return r.n.indexOf('Петля') >= 0; }), 'модуль без фасада — петель нет');

console.log('── Лист фасадов ──');
ok(h.indexOf('Фасады') >= 0, 'лист фасадов');
ok(h.indexOf('Фрезеровка: Венеция') >= 0, 'рисунок фрезеровки указан');
ok(h.indexOf('Открывание: зеркально') >= 0, 'сторона открывания указана');
ok(h.indexOf('Фасадов нет') >= 0, 'модуль 2 без фасадов — так и написано');

console.log('── Обложка ──');
ok(h.indexOf('Общий вид') >= 0, 'лист «Общий вид»');
ok(h.indexOf('Состав изделия') >= 0, 'таблица состава');
ok(h.indexOf('<polygon') >= 0, 'изометрия отрисована (полигоны)');
ok(h.indexOf('1500×2000×600') >= 0, 'общие габариты (900+600 × 2000 × 600)');

console.log('── Крепёж ──');
ok(h.indexOf('Конфирмат 7×50') >= 0, 'конфирматы в фурнитуре');
ok(h.indexOf('Заглушка конфирмата') >= 0, 'заглушки');
ok(h.indexOf('Штангодержатель') >= 0, 'штангодержатели');
var hwC = win._ai_moduleHardware(s);
var conf = hwC.find(function (r) { return r.n.indexOf('Конфирмат') >= 0; });
eq(conf.q, (1 + 0 + 2) * 4 + 2 * 8, 'конфирматы: (1 полка + крыша/дно)×4 + 2 ящика×8 = 28');
var rd = hwC.find(function (r) { return r.n === 'Штангодержатель'; });
eq(rd.q, 2, 'штангодержателей 2 на штангу');

console.log('── Створки на листе фасадов ──');
// у секции s фасад doors2 → на листе фасадов должны быть и двери, и ящичные фасады
var synth = win._ai_sectionFacadeSynth ? win._ai_sectionFacadeSynth(s, 0) : null;
if (synth) {
  eq(synth.length, 2, 'синтез: 2 створки секции');
  ok(synth.every(function (p) { return p.kind === 'facade' && p.box && p.cutL > 1900; }), 'створки: полная высота, box для SVG');
}

console.log('── Денег в чертеже нет ──');
ok(h.indexOf('₸') < 0, 'ни одного тенге в чертеже');

console.log('── SVG ──');
ok(h.indexOf('<svg') >= 0, 'SVG вида спереди');
ok(h.indexOf('<circle') >= 0, 'выноски позиций');
ok(h.indexOf('900</text>') >= 0, 'размерная линия ширины 900');

console.log('');
console.log('Пройдено: ' + passed + ', провалено: ' + failed);
process.exit(failed > 0 ? 1 : 0);
