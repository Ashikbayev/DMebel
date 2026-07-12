/* ============================================================
   Тесты ядра геометрии шкафа. Прогон: node test-wardrobe-core.js
   Эталон — шкаф с фото (image 2..5):
     Габариты 800 x 2000 x 600, ножки 100, отступы front16/back3.
     Раскрой корпуса: Дно 798x580, Крыша 798x580,
                      Стойка_л 1868x580, Стойка_п 1868x580.
============================================================ */
var WC = require('./wardrobe-core.js');

var passed = 0, failed = 0;
function eq(actual, expected, label) {
  if (actual === expected) { passed++; }
  else { failed++; console.log('  ✗ ' + label + ': ожидалось ' + expected + ', получено ' + actual); }
}
function ok(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.log('  ✗ ' + label); }
}

// Найти деталь по имени
function byName(parts, name) {
  for (var i = 0; i < parts.length; i++) if (parts[i].name === name) return parts[i];
  return null;
}

console.log('── Эталонный шкаф 800x2000x600 ──');
var r = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3
});

// Производные
eq(r.derived.corpusH, 1900, 'корпус по высоте');
eq(r.derived.depthReal, 581, 'реальная глубина');
eq(r.derived.partDepth, 580, 'глубина детали');
eq(r.derived.sideH, 1868, 'высота стойки');
eq(r.derived.topLen, 798, 'длина крыши/дна');

// Детали корпуса против эталона (Дл x Шир в раскрое)
var dno = byName(r.parts, 'Дно');
ok(dno, 'деталь Дно есть');
eq(dno.cutL, 798, 'Дно длина');
eq(dno.cutW, 580, 'Дно ширина');
eq(dno.material, 'ldsp', 'Дно материал');
eq(dno.thick, 16, 'Дно толщина');

var krysha = byName(r.parts, 'Крыша');
ok(krysha, 'деталь Крыша есть');
eq(krysha.cutL, 798, 'Крыша длина');
eq(krysha.cutW, 580, 'Крыша ширина');

var sl = byName(r.parts, 'Стойка_левая');
var sp = byName(r.parts, 'Стойка_правая');
ok(sl && sp, 'обе стойки есть');
eq(sl.cutL, 1868, 'Стойка_л длина');
eq(sl.cutW, 580, 'Стойка_л ширина');
eq(sp.cutL, 1868, 'Стойка_п длина');
eq(sp.cutW, 580, 'Стойка_п ширина');

// Кромка деталей
eq(WC.partEdgeLen(dno), 798 + 580 + 580, 'Дно кромка (перёд+2 бока)');
eq(WC.partEdgeLen(krysha), 798 + 580 + 580, 'Крыша кромка (перёд+2 бока)');
eq(WC.partEdgeLen(sl), 1868, 'Стойка_л кромка (только перёд)');
eq(WC.partEdgeLen(sp), 1868, 'Стойка_п кромка (только перёд)');

// Задняя стенка (ХДФ) — внутренний проём, не кромится
var back = byName(r.parts, 'Задняя стенка');
ok(back, 'задняя стенка есть');
eq(back.material, 'hdf', 'ЗС материал');
eq(back.thick, 3, 'ЗС толщина');
eq(back.cutW, 800 - 2 * 16, 'ЗС ширина = проём (768)');
eq(back.cutL, 1900 - 2 * 16, 'ЗС высота = проём (1868)');
eq(WC.partEdgeLen(back), 0, 'ЗС без кромки');

// Кол-во корпусных деталей: 2 стойки + крыша + дно + ЗС = 5
eq(r.summary.partCount, 5, 'кол-во деталей корпуса');

// ── Геометрия 3D: детали не пересекаются и стоят в габарит ──
console.log('── Проверки 3D-позиций ──');
// Крыша выше дна
ok(krysha.box.cy > dno.box.cy, 'крыша выше дна по Y');
// Дно опирается на ножки: низ дна = ножки
eq(dno.box.cy - dno.box.dy / 2, 100, 'низ дна = уровень ножек (100)');
// Верх крыши = ножки + корпус = 100 + 1900 = 2000
eq(krysha.box.cy + krysha.box.dy / 2, 2000, 'верх крыши = полная высота (2000)');
// Стойки по краям, симметрично
eq(Math.round(sl.box.cx + sp.box.cx), 0, 'стойки симметричны по X');
// Ширина между внешними краями стоек = corpusW = 800
var outerL = sl.box.cx - sl.box.dx / 2;
var outerR = sp.box.cx + sp.box.dx / 2;
eq(Math.round(outerR - outerL), 800, 'внешняя ширина по стойкам = 800');

// ── Другой шкаф: 1200 x 2400 x 500, ножки 80 ──
console.log('── Контрольный шкаф 1200x2400x500 ──');
var r2 = WC.buildCarcass({
  width: 1200, height: 2400, depth: 500, legs: 80,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3
});
eq(r2.derived.corpusH, 2320, 'к2 корпус высота (2400-80)');
eq(r2.derived.depthReal, 481, 'к2 реальная глубина (500-16-3)');
eq(r2.derived.partDepth, 480, 'к2 глубина детали');
eq(r2.derived.sideH, 2288, 'к2 высота стойки (2320-32)');
eq(r2.derived.topLen, 1198, 'к2 длина крыши (1200-2)');
var d2 = byName(r2.parts, 'Дно');
eq(d2.cutL, 1198, 'к2 Дно длина');
eq(d2.cutW, 480, 'к2 Дно ширина');

// ── Итог ──
console.log('');
console.log('Пройдено: ' + passed + ', провалено: ' + failed);
if (failed > 0) { process.exit(1); }
