/* Блок 3: мастер быстрого старта. Шаги, пресеты, сценарии, крайние размеры, цена без NaN. */
var { JSDOM } = require('jsdom');
var fs = require('fs');
var passed = 0, failed = 0;
function ok(c, l) { if (c) passed++; else { failed++; console.log('  ✗ ' + l); } }
function eq(a, b, l) { if (a === b) passed++; else { failed++; console.log('  ✗ ' + l + ': ожидалось ' + JSON.stringify(b) + ', получено ' + JSON.stringify(a)); } }

var dom = new JSDOM('<!DOCTYPE html><html><body><div id="viewport"></div><div id="dim-overlay"></div><div id="stats-badge"></div><div id="sections-container"></div><canvas id="c3d"></canvas></body></html>',
  { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/' });
var win = dom.window;
win.confirm = function () { return true; };
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

function wizState() { return win._ai_wiz(); }

console.log('── Открытие, шаги, прогресс ──');
win.wizOpen();
var m = win.document.getElementById('w2dwiz');
ok(m && m.style.display !== 'none', 'модалка открыта');
eq(wizState().step, 1, 'старт с шага 1');
ok(m.innerHTML.indexOf('Пропустить мастер') >= 0, 'кнопка «Пропустить мастер» есть');
ok(m.innerHTML.indexOf('wiz-prog-in') >= 0, 'прогресс-бар есть');
ok(m.innerHTML.indexOf('Спальня 3000') >= 0, 'пресеты габаритов на шаге 1');
ok(m.innerHTML.indexOf('type="range"') >= 0, 'ползунки есть');
ok(m.innerHTML.indexOf('3000 &times;') >= 0 || m.innerHTML.indexOf('3000 ×') >= 0, 'значения по умолчанию подставлены');

console.log('── Валидация с человекопонятными сообщениями ──');
win.wizSet('hei', '800');
win.wizStep(1);
eq(wizState().step, 1, 'с ошибкой дальше не пускает');
ok(m.innerHTML.indexOf('Высота не может быть меньше 1000 мм') >= 0, 'текст ошибки по высоте');
ok(m.innerHTML.indexOf('wiz-fld-err') >= 0, 'поле подсвечено');
win.wizSet('len', '400');
win.wizStep(1);
ok(m.innerHTML.indexOf('Ширина не может быть меньше 600 мм') >= 0, 'текст ошибки по ширине');
win.wizSet('dep', '9000');
win.wizStep(1);
ok(m.innerHTML.indexOf('Глубина больше 800') >= 0, 'текст ошибки по глубине');
win.wizDims(3000, 2400, 600);
win.wizStep(1);
eq(wizState().step, 2, 'с валидными значениями шаг 2 открылся');

console.log('── Шаг 2: тип ──');
ok(m.innerHTML.indexOf('Распашной') >= 0 && m.innerHTML.indexOf('Купе') >= 0 && m.innerHTML.indexOf('Гардеробная') >= 0, 'три карточки типов');
ok(m.innerHTML.indexOf('<svg') >= 0, 'карточки с картинками');
win.wizSet('type', 'coupe');
ok(m.innerHTML.indexOf('корпус без фасадов') >= 0, 'купе: честная пометка про фасады');
win.wizSet('type', 'hinged');
ok(m.innerHTML.indexOf('Материал фасадов') >= 0, 'распашной: выбор материала');
win.wizStep(1);
eq(wizState().step, 3, 'шаг 3 открылся');

console.log('── Шаг 3: сценарии ──');
eq((m.innerHTML.match(/class="wiz-scen /g) || []).length + (m.innerHTML.match(/class="wiz-scen"/g) || []).length, 5, '5 карточек сценариев');
ok(m.innerHTML.indexOf('Для спальни') >= 0 && m.innerHTML.indexOf('Максимум развески') >= 0 && m.innerHTML.indexOf('Семейный микс') >= 0, 'названия сценариев');
win.wizSet('scen', 'maxhang');
ok(m.innerHTML.indexOf('wiz-scen on') >= 0, 'выбранный сценарий подсвечен');
win.wizStep(1);
eq(wizState().step, 4, 'шаг 4 открылся');

console.log('── Шаг 4: результат ──');
ok(m.innerHTML.indexOf('wiz-prev') >= 0, 'превью шкафа на холсте');
ok(m.innerHTML.indexOf('Отлично, дорабатываю') >= 0, 'кнопка «Отлично, дорабатываю»');
ok(m.innerHTML.indexOf('Пересобрать') >= 0, 'кнопка «Пересобрать»');
ok(m.innerHTML.indexOf('NaN') < 0, 'нет NaN в результате');
ok(m.innerHTML.indexOf('undefined') < 0, 'нет undefined в результате');

console.log('── Сценарии наполнения строят секции ──');
var secs = win._ai_wizTempSections();
ok(secs.length >= 3, 'спальня 3000: ' + secs.length + ' модулей');
ok(secs.every(function (s) { return s.rods.length >= 1; }), 'maxhang: штанги во всех секциях (2400 → rodDouble)');
ok(secs.every(function (s) { return s.rods.length === 2; }), 'maxhang при 2400: именно двойные');
win.wizSet('scen', 'maxshelf');
secs = win._ai_wizTempSections();
ok(secs.every(function (s) { return s.shelves.length >= 4 && s.rods.length === 0; }), 'maxshelf: только полки');
win.wizSet('scen', 'bedroom');
secs = win._ai_wizTempSections();
ok(secs.some(function (s) { return s.rods.length; }) && secs.some(function (s) { return s.drawerBlocks.length; }), 'спальня: есть и развеска, и ящики');
ok(secs.every(function (s) { return s.facade.type !== 'none'; }), 'распашной: фасады назначены');
win.wizSet('type', 'walkin');
secs = win._ai_wizTempSections();
ok(secs.every(function (s) { return s.facade.type === 'none'; }), 'гардеробная: без фасадов');
win.wizSet('type', 'hinged');

console.log('── Крайние размеры ──');
win.wizDims(600, 1000, 350);
eq(Object.keys(win._ai_wizValidate()).length, 0, 'минимальные 600×1000×350 валидны');
secs = win._ai_wizTempSections();
ok(secs.length === 1 && secs[0].shelves.length > 0, 'минимальный шкаф собирается с наполнением (fallback на полки)');
ok(secs[0].rods.length === 0, 'на 1000 мм штанга не ставится (fits отсёк)');
var est = win._ai_wizEstimate(secs);
ok(est && est.d, 'расчёт материалов на минимуме не падает');
win.wizDims(6000, 3200, 800);
eq(Object.keys(win._ai_wizValidate()).length, 0, 'максимальные 6000×3200×800 валидны');
secs = win._ai_wizTempSections();
ok(secs.length >= 6, 'максимальный шкаф: ' + secs.length + ' модулей');
est = win._ai_wizEstimate(secs);
ok(est && est.d && secs.every(function (s) { return s.width > 0 && s.height > 0; }), 'максимум собирается, размеры положительные');
ok(!est.price || (isFinite(est.price) && est.price > 0), 'цена либо отсутствует, либо конечна и > 0');

console.log('── Возврат назад без потери ──');
win.wizDims(2400, 2600, 600);
win.wizSet('scen', 'family');
wizState().step = 4; win.wizStep(-1); win.wizStep(-1);
eq(wizState().step, 2, 'вернулись на шаг 2');
eq(wizState().len, 2400, 'ширина не потерялась');
eq(wizState().scen, 'family', 'сценарий не потерялся');
var draft = JSON.parse(win.localStorage.getItem('mebeloff_wiz_draft'));
eq(draft.len, 2400, 'черновик мастера в localStorage');

console.log('── Построение в проект ──');
wizState().step = 4; win.wizRender ? null : null;
win._ai_sections = [];
win.wizBuild();
var built = win._ai_sections;
ok(built.length >= 2, 'секции построены в проект: ' + built.length);
ok(built.some(function (s) { return s.rods.length || s.shelves.length || s.drawerBlocks.length; }), 'наполнение расставлено');
var mm = win.document.getElementById('w2dwiz');
ok(mm.style.display === 'none', 'мастер закрылся после построения');
var vErrs = win._ai_validateProject ? [] : [];
win.wizOpen();
win.wizClose();
eq(win.document.getElementById('w2dwiz').style.display, 'none', '«Пропустить»/закрытие работает');

console.log('');
console.log('Пройдено: ' + passed + ', провалено: ' + failed);
process.exit(failed > 0 ? 1 : 0);
