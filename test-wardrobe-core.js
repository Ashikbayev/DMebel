/* ============================================================
   Тесты ядра геометрии шкафа. Прогон: node test-wardrobe-core.js

   ЭТАЛОН — реальный раскрой из ПО (шкаф-стеллаж 800x2000x600,
   ножки 100, панель 16, ЗС 3, кромка 1, отступы front16/back3):
     ЛДСП 16:
       Стойка_левая / Стойка_правая  1867 x 579
       Вертикальная (перегородка)    1868 x 579
       Дно / Крыша                    798 x 579
       Полка (в секции 376-шир)       376 x 579
     ХДФ 3:
       ЗС (накладная)                1898 x 798
   Короткая Вертикальная в раскрое = 612 = проём при 2 полках
     (1868 − 2·16)/3 — подтверждает рекурсию дерева секций.
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
function byName(parts, name) {
  for (var i = 0; i < parts.length; i++) if (parts[i].name === name) return parts[i];
  return null;
}

console.log('── Эталонный шкаф 800x2000x600 (реальный раскрой) ──');
var r = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3
});

// Производные
eq(r.derived.corpusH, 1900, 'корпус по высоте');
eq(r.derived.depthReal, 581, 'реальная глубина');
eq(r.derived.partDepth, 579, 'глубина детали (раскрой 579)');
eq(r.derived.clearH, 1868, 'чистовой проём по высоте (между дном и крышей)');
eq(r.derived.sideCutH, 1867, 'раскрой стойки = проём − кромка (1867)');
eq(r.derived.topLen, 798, 'длина крыши/дна');

// Дно / Крыша — раскрой 798 x 579
var dno = byName(r.parts, 'Дно');
ok(dno, 'деталь Дно есть');
eq(dno.cutL, 798, 'Дно длина');
eq(dno.cutW, 579, 'Дно ширина (579)');
eq(dno.material, 'ldsp', 'Дно материал');
eq(dno.thick, 16, 'Дно толщина');

var krysha = byName(r.parts, 'Крыша');
ok(krysha, 'деталь Крыша есть');
eq(krysha.cutL, 798, 'Крыша длина');
eq(krysha.cutW, 579, 'Крыша ширина (579)');

// Стойки — раскрой 1867 x 579
var sl = byName(r.parts, 'Стойка_левая');
var sp = byName(r.parts, 'Стойка_правая');
ok(sl && sp, 'обе стойки есть');
eq(sl.cutL, 1867, 'Стойка_л длина (раскрой 1867)');
eq(sl.cutW, 579, 'Стойка_л ширина (579)');
eq(sp.cutL, 1867, 'Стойка_п длина (раскрой 1867)');
eq(sp.cutW, 579, 'Стойка_п ширина (579)');
// В 3D стойка занимает весь проём (1868), раскрой на 1 мм меньше (подрезка)
eq(sl.box.dy, 1868, 'Стойка в 3D занимает проём 1868');

// Кромка деталей (метраж по честному периметру — правило Дали)
eq(WC.partEdgeLen(dno), 798 + 579 + 579, 'Дно кромка (перёд+2 бока)');
eq(WC.partEdgeLen(krysha), 798 + 579 + 579, 'Крыша кромка (перёд+2 бока)');
eq(WC.partEdgeLen(sl), 1867, 'Стойка_л кромка (только перёд, 1867)');
eq(WC.partEdgeLen(sp), 1867, 'Стойка_п кромка (только перёд, 1867)');

// Задняя стенка (ХДФ) — НАКЛАДНАЯ, раскрой 1898 x 798, не кромится
var back = byName(r.parts, 'Задняя стенка');
ok(back, 'задняя стенка есть');
eq(back.material, 'hdf', 'ЗС материал');
eq(back.thick, 3, 'ЗС толщина');
eq(back.cutW, 798, 'ЗС ширина = corpusW − 2·edge (798)');
eq(back.cutL, 1898, 'ЗС высота = corpusH − 2·edge (1898)');
eq(WC.partEdgeLen(back), 0, 'ЗС без кромки');

// Кол-во корпусных деталей: 2 стойки + крыша + дно + ЗС = 5
eq(r.summary.partCount, 5, 'кол-во деталей корпуса');

// ── Геометрия 3D: детали не пересекаются и стоят в габарит ──
console.log('── Проверки 3D-позиций ──');
ok(krysha.box.cy > dno.box.cy, 'крыша выше дна по Y');
eq(dno.box.cy - dno.box.dy / 2, 100, 'низ дна = уровень ножек (100)');
eq(krysha.box.cy + krysha.box.dy / 2, 2000, 'верх крыши = полная высота (2000)');
eq(Math.round(sl.box.cx + sp.box.cx), 0, 'стойки симметричны по X');
var outerL = sl.box.cx - sl.box.dx / 2;
var outerR = sp.box.cx + sp.box.dx / 2;
eq(Math.round(outerR - outerL), 800, 'внешняя ширина по стойкам = 800');
eq(sl.box.cy - sl.box.dy / 2, dno.box.cy + dno.box.dy / 2, 'низ стойки = верх дна');
eq(sl.box.cy + sl.box.dy / 2, krysha.box.cy - krysha.box.dy / 2, 'верх стойки = низ крыши');

// ── Другой шкаф: 1200 x 2400 x 500, ножки 80 ──
console.log('── Контрольный шкаф 1200x2400x500 ──');
var r2 = WC.buildCarcass({
  width: 1200, height: 2400, depth: 500, legs: 80,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3
});
eq(r2.derived.corpusH, 2320, 'к2 корпус высота (2400-80)');
eq(r2.derived.depthReal, 481, 'к2 реальная глубина (500-16-3)');
eq(r2.derived.partDepth, 479, 'к2 глубина детали (481-2)');
eq(r2.derived.clearH, 2288, 'к2 проём по высоте (2320-32)');
eq(r2.derived.sideCutH, 2287, 'к2 раскрой стойки (2288-1)');
eq(r2.derived.topLen, 1198, 'к2 длина крыши (1200-2)');
var d2 = byName(r2.parts, 'Дно');
eq(d2.cutL, 1198, 'к2 Дно длина');
eq(d2.cutW, 479, 'к2 Дно ширина');
var s2 = byName(r2.parts, 'Стойка_левая');
eq(s2.cutL, 2287, 'к2 Стойка длина (2287)');
var b2 = byName(r2.parts, 'Задняя стенка');
eq(b2.cutL, 2318, 'к2 ЗС высота (2320-2)');
eq(b2.cutW, 1198, 'к2 ЗС ширина (1200-2)');

// ── Полки: тот же шкаф 800x2000x600, 4 полки во всю ширину ──
console.log('── Полки: шкаф 800x2000x600, 4 шт ──');
var r3 = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  shelfCount: 4
});
eq(r3.derived.openingH, 360.8, 'проём между полками (360.8)');
eq(r3.summary.partCount, 9, 'кол-во деталей корпус+полки (5+4=9)');

var p1 = byName(r3.parts, 'Полка_1');
var p4 = byName(r3.parts, 'Полка_4');
ok(p1 && p4, 'полки Полка_1..Полка_4 есть');
eq(p1.cutL, 768, 'Полка длина = проём между стойками (768)');
eq(p1.cutW, 579, 'Полка глубина (579)');
eq(p4.cutL, 768, 'Полка_4 длина та же');
eq(WC.partEdgeLen(p1), 768, 'Полка кромка — только передний торец');

var r3dno = byName(r3.parts, 'Дно');
var r3krysha = byName(r3.parts, 'Крыша');
var dnoTop = r3dno.box.cy + r3dno.box.dy / 2;
var kryshaBottom = r3krysha.box.cy - r3krysha.box.dy / 2;
var p1Bottom = p1.box.cy - p1.box.dy / 2;
var p4Top = p4.box.cy + p4.box.dy / 2;
eq(Math.round((p1Bottom - dnoTop) * 10) / 10, 360.8, 'нижний проём (дно→Полка_1) = 360.8');
eq(Math.round((kryshaBottom - p4Top) * 10) / 10, 360.8, 'верхний проём (Полка_4→крыша) = 360.8');
eq(p1.box.cz, r3dno.box.cz, 'полка на той же глубине Z, что и дно');

// Рекурсия дерева: 2 полки → проём 612 (короткая Вертикальная из раскроя)
var r3b = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  shelfCount: 2
});
eq(r3b.derived.openingH, 612, 'проём при 2 полках = 612 (эталон короткой Вертикальной)');

// Без полок — обратная совместимость
var r4 = WC.buildCarcass({ width: 800, height: 2000, depth: 600, legs: 100 });
eq(r4.summary.partCount, 5, 'без shelfCount — деталей по-прежнему 5');
eq(r4.derived.openingH, null, 'openingH = null, если полок нет');

// ── Перегородки: шкаф 800x2000x600, 1 перегородка ──
// Скрин настроек (image 2): "Секция с панелями (1)", проёмы 376 / 376.
// Раскрой (image 3): Вертикальная 1868 x 579.
console.log('── Перегородки: шкаф 800x2000x600, 1 шт ──');
var r5 = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  partitionCount: 1
});
eq(r5.derived.partitionOpeningW, 376, 'ширина секции при 1 перегородке (376)');
eq(r5.summary.partCount, 6, 'кол-во деталей корпус+перегородка (5+1=6)');

var pg1 = byName(r5.parts, 'Перегородка_1');
ok(pg1, 'деталь Перегородка_1 есть');
eq(pg1.cutL, 1868, 'Перегородка длина = проём (1868, ровно, без подрезки)');
eq(pg1.cutW, 579, 'Перегородка глубина (579)');
eq(pg1.material, 'ldsp', 'Перегородка материал');
eq(pg1.thick, 16, 'Перегородка толщина');
eq(WC.partEdgeLen(pg1), 1868, 'Перегородка кромка — только передний торец (1868)');
eq(pg1.box.cx, 0, 'Перегородка_1 по центру X при 1 шт');

// Перегородка режется в размер проёма, стойка — на 1 мм меньше
eq(pg1.cutL - sl.cutL, 1, 'перегородка (1868) на 1 мм длиннее стойки (1867)');
var r5sl = byName(r5.parts, 'Стойка_левая');
eq(pg1.box.cy, r5sl.box.cy, 'перегородка на высоте стойки (cy совпадает)');
eq(pg1.box.cz, r5sl.box.cz, 'перегородка на той же глубине Z');
var r5dno = byName(r5.parts, 'Дно');
var r5krysha = byName(r5.parts, 'Крыша');
eq(pg1.box.cy - pg1.box.dy / 2, r5dno.box.cy + r5dno.box.dy / 2, 'низ перегородки = верх дна');
eq(pg1.box.cy + pg1.box.dy / 2, r5krysha.box.cy - r5krysha.box.dy / 2, 'верх перегородки = низ крыши');

// ── Две перегородки: три равные секции ──
console.log('── Перегородки: шкаф 800x2000x600, 2 шт ──');
var r6 = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  partitionCount: 2
});
eq(Math.round(r6.derived.partitionOpeningW * 100) / 100, 245.33, 'ширина секции при 2 перегородках (245.33)');
eq(r6.summary.partCount, 7, 'кол-во деталей корпус+2 перегородки (5+2=7)');
var pg2a = byName(r6.parts, 'Перегородка_1');
var pg2b = byName(r6.parts, 'Перегородка_2');
ok(pg2a && pg2b, 'обе перегородки есть');
eq(Math.round(pg2a.box.cx + pg2b.box.cx), 0, 'перегородки симметричны по X');
ok(pg2a.box.cx < pg2b.box.cx, 'Перегородка_1 левее Перегородки_2');
var innerHalf = (800 - 2 * 16) / 2; // 384
eq(Math.round((pg2a.box.cx - pg2a.box.dx / 2 - (-innerHalf)) * 100) / 100, 245.33, 'левая секция = 245.33');
eq(Math.round((innerHalf - (pg2b.box.cx + pg2b.box.dx / 2)) * 100) / 100, 245.33, 'правая секция = 245.33');
eq(Math.round(((pg2b.box.cx - pg2b.box.dx / 2) - (pg2a.box.cx + pg2a.box.dx / 2)) * 100) / 100, 245.33, 'средняя секция = 245.33');

// Без перегородок — обратная совместимость
var r7 = WC.buildCarcass({ width: 800, height: 2000, depth: 600, legs: 100 });
eq(r7.summary.partCount, 5, 'без partitionCount — деталей по-прежнему 5');
eq(r7.derived.partitionOpeningW, null, 'partitionOpeningW = null, если перегородок нет');

// Перегородки + полки одновременно не ломают счёт деталей
var r8 = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  shelfCount: 4, partitionCount: 1
});
eq(r8.summary.partCount, 10, 'корпус+4 полки+1 перегородка = 10 деталей');

function countKind(parts, kind) {
  var n = 0;
  for (var i = 0; i < parts.length; i++) if (parts[i].kind === kind) n++;
  return n;
}
function pickByCut(parts, kind, cutL) {
  var out = [];
  for (var i = 0; i < parts.length; i++)
    if (parts[i].kind === kind && parts[i].cutL === cutL) out.push(parts[i]);
  return out;
}

/* ============================================================
   ДЕРЕВО СЕКЦИЙ — воспроизведение реального эталона из ПО.
   Шкаф-стеллаж 800×2000×600, дерево (image 3–7):
     корень  panels(1)          → колонки 376 / 376
       лево  shelves(2)          → проёмы 612 / 612 / 612
         средняя 612 panels(1)   → 180 / 180 = короткая Вертикальная 612
       право shelves(4)          → проёмы 360.8 ×5
   Раскрой-эталон (image 2/8): Вертикальная 1868 ×1, Вертикальная 612 ×1,
   Полка 376 ×6, Дно/Крыша 798, Стойки 1867.
============================================================ */
console.log('── Дерево секций: реальный эталон 800×2000×600 ──');
var et = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sections: {
    type: 'panels', count: 1, children: [
      { type: 'shelves', count: 2, children: [
        null,
        { type: 'panels', count: 1, children: [null, null] },
        null
      ] },
      { type: 'shelves', count: 4, children: [null, null, null, null, null] }
    ]
  }
});

// Легаси-поля наполнения не заполняются в режиме дерева
eq(et.derived.openingH, null, 'дерево: openingH = null (не легаси)');
eq(et.derived.partitionOpeningW, null, 'дерево: partitionOpeningW = null');

// Счёт деталей: корпус 5 (2 стойки+дно+крыша+ЗС) + наполнение 8 = 13
eq(et.summary.partCount, 13, 'эталон-дерево: всего деталей 13 (корпус 5 + наполнение 8)');

// Полки: ровно 6, все 376 × 579, кромка только перёд (376)
eq(countKind(et.parts, 'shelf'), 6, 'эталон: 6 полок');
var shelves376 = pickByCut(et.parts, 'shelf', 376);
eq(shelves376.length, 6, 'все 6 полок имеют длину раскроя 376');
eq(shelves376[0].cutW, 579, 'полка глубина 579');
eq(WC.partEdgeLen(shelves376[0]), 376, 'полка кромка = передний торец 376');

// Перегородки: ровно 2 — одна 1868 (корень), одна 612 (короткая)
eq(countKind(et.parts, 'partition'), 2, 'эталон: 2 вертикали');
var vert1868 = pickByCut(et.parts, 'partition', 1868);
var vert612 = pickByCut(et.parts, 'partition', 612);
eq(vert1868.length, 1, 'одна Вертикальная 1868 (корневая, во всю высоту проёма)');
eq(vert612.length, 1, 'одна короткая Вертикальная 612');
eq(vert1868[0].cutW, 579, 'корневая вертикаль глубина 579');
eq(WC.partEdgeLen(vert612[0]), 612, 'короткая вертикаль кромка = 612');

// Корневая перегородка по центру X, режется ровно в проём (без подрезки)
eq(vert1868[0].box.cx, 0, 'корневая Вертикальная по центру X');
eq(vert1868[0].box.dy, 1868, 'корневая Вертикальная в 3D занимает весь проём 1868');

// Короткая вертикаль: в левой колонке, в средней 612-ячейке (проём 180/180).
// X-центр колонки = −(376+16)/2 = −196; вертикаль по центру колонки → cx=−196.
eq(vert612[0].box.cx, -196, 'короткая Вертикальная по центру левой колонки (−196)');
// Средняя ячейка левой колонки: y 744..1356 → центр 1050
eq(vert612[0].box.cy, 1050, 'короткая Вертикальная в средней 612-ячейке (cy=1050)');
eq(vert612[0].box.dy, 612, 'короткая Вертикальная высотой ровно 612');

// Полки левой/правой колонки лежат на глубине корпуса
var dnoEt = byName(et.parts, 'Дно');
eq(shelves376[0].box.cz, dnoEt.box.cz, 'полки на той же глубине Z, что и дно');

// Наполнение не выходит за проём по высоте (между дном и крышей)
var kryshaEt = byName(et.parts, 'Крыша');
var dnoTopEt = dnoEt.box.cy + dnoEt.box.dy / 2;          // 116
var kryshaBotEt = kryshaEt.box.cy - kryshaEt.box.dy / 2; // 1984
ok(vert1868[0].box.cy - vert1868[0].box.dy / 2 >= dnoTopEt - 0.001, 'низ вертикали ≥ верх дна');
ok(vert1868[0].box.cy + vert1868[0].box.dy / 2 <= kryshaBotEt + 0.001, 'верх вертикали ≤ низ крыши');

// ── Эквивалентность: корневой узел ≡ легаси-плоский ──────────
console.log('── Дерево ≡ легаси (эквивалентность корня) ──');
// shelves(4) в корне должно совпасть с shelfCount:4
var treeSh = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sections: { type: 'shelves', count: 4, children: [null, null, null, null, null] }
});
eq(treeSh.summary.partCount, 9, 'дерево shelves(4): 9 деталей (как shelfCount:4)');
eq(countKind(treeSh.parts, 'shelf'), 4, 'дерево shelves(4): 4 полки');
var treeShelf1 = byName(treeSh.parts, 'Полка_1');
eq(treeShelf1.cutL, 768, 'дерево: полка во всю ширину проёма 768');
eq(treeShelf1.cutW, 579, 'дерево: полка глубина 579');
// Позиция первой полки совпадает с легаси openingH=360.8 над дном
eq(Math.round((treeShelf1.box.cy - treeShelf1.box.dy / 2 - 116) * 10) / 10, 360.8,
   'дерево: первый проём (дно→Полка_1) = 360.8, как в легаси');

// panels(1) в корне должно совпасть с partitionCount:1
var treePn = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sections: { type: 'panels', count: 1, children: [null, null] }
});
eq(treePn.summary.partCount, 6, 'дерево panels(1): 6 деталей (как partitionCount:1)');
var treePart1 = byName(treePn.parts, 'Перегородка_1');
eq(treePart1.cutL, 1868, 'дерево: перегородка ровно в проём 1868');
eq(treePart1.box.cx, 0, 'дерево panels(1): перегородка по центру X');

// Сквозная нумерация полок в порядке обхода (лево→право по дереву)
var treeNames = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sections: { type: 'shelves', count: 2, children: [null, null, null] }
});
ok(byName(treeNames.parts, 'Полка_1') && byName(treeNames.parts, 'Полка_2'),
   'дерево: полки нумеруются сквозно Полка_1..N');

// ── Кастомные (неравные) проёмы через node.sizes ─────────────
console.log('── Дерево: кастомные размеры проёмов (sizes) ──');
// panels(1) с явными ширинами 300 / 452 (300+452+16 = 768)
var cs1 = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sections: { type: 'panels', count: 1, sizes: [300, 452], children: [null, null] }
});
var csV = pickByCut(cs1.parts, 'partition', 1868)[0];
ok(csV, 'кастом: перегородка есть');
// левая доля 300 → внутр. грань левой стойки −384; перегородка на −384+300 = −84, центр −84+8 = −76
eq(csV.box.cx, -76, 'кастом panels: перегородка сдвинута по 300/452 (cx=−76)');
eq(csV.cutL, 1868, 'кастом: перегородка всё равно в высоту проёма 1868');

// panels(1) с одной фикс-долей и одной авто: [300, null] → авто = 768−16−300 = 452
var cs2 = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sections: { type: 'panels', count: 1, sizes: [300], children: [null, null] }
});
eq(pickByCut(cs2.parts, 'partition', 1868)[0].box.cx, -76, 'кастом: авто-доля добрала остаток (та же cx=−76)');

// shelves(2) с неравными высотами: нижняя 500, остальные авто → (1868−32−500)/2 = 668
var cs3 = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sections: { type: 'shelves', count: 2, sizes: [500, null, null], children: [null, null, null] }
});
var cs3sh1 = byName(cs3.parts, 'Полка_1');
var cs3sh2 = byName(cs3.parts, 'Полка_2');
// Полка_1 над нижней долей 500: низ дна 116 + 500 = 616, центр полки 616+8 = 624
eq(cs3sh1.box.cy, 624, 'кастом shelves: 1-я полка над долей 500 (cy=624)');
// Полка_2 над долей 668: 616+16+668 = 1300, центр 1308
eq(cs3sh2.box.cy, 1308, 'кастом shelves: 2-я полка над авто-долей 668 (cy=1308)');
eq(cs3sh1.cutL, 768, 'кастом: полка всё равно в ширину проёма 768');

// Равные доли = частный случай: sizes отсутствует ⇒ как раньше (эталон уже это покрыл)
var cs4 = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sections: { type: 'panels', count: 1, children: [null, null] }
});
eq(pickByCut(cs4.parts, 'partition', 1868)[0].box.cx, 0, 'без sizes: доли равны, перегородка по центру (cx=0)');

// Кастомные доли + вложенность: левая широкая колонка со своими полками
var cs5 = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sections: { type: 'panels', count: 1, sizes: [500, 252], children: [
    { type: 'shelves', count: 2, children: [null, null, null] }, // в широкой 500-колонке
    null
  ] }
});
var cs5shelves = pickByCut(cs5.parts, 'shelf', 500);
eq(cs5shelves.length, 2, 'кастом+вложенность: 2 полки шириной 500 в широкой колонке');


// ── ФАСАДЫ: реальный эталон 800×2000, 2 створки → 1895×396 ×2 ──
console.log('── Фасады: эталон 800×2000, 2 створки (1895×396 ×2) ──');
var rf = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  facades: { count: 2, gapTop: 2, gapBottom: 101, gapLeft: 1, gapRight: 1, material: 'ldsp' }
});
var fac = rf.parts.filter(function (p) { return p.kind === 'facade'; });
eq(fac.length, 2, 'фасадов ровно 2');
eq(rf.parts.length, 7, 'всего 7 деталей (5 корпус + 2 фасада)');
var f1 = byName(rf.parts, 'Фасад_1');
ok(f1, 'деталь Фасад_1 есть');
eq(f1.cutL, 1895, 'Фасад_1 высота реза (2000−2−101−2·кромка)');
eq(f1.cutW, 396, 'Фасад_1 ширина реза (400−1−1−2·кромка)');
eq(f1.material, 'ldsp', 'Фасад_1 материал');
eq(f1.thick, 16, 'Фасад_1 толщина (по умолчанию = panel)');
eq(f1.edges.length, 4, 'Фасад_1 окромлён по кругу (4 стороны)');
var f2 = byName(rf.parts, 'Фасад_2');
eq(f2.cutW, 396, 'Фасад_2 ширина реза');
// геометрия/позиции
eq(f1.box.dy, 1897, 'Фасад геом. высота = 2000−2−101');
eq(f1.box.dx, 398, 'Фасад геом. ширина = 400−1−1');
eq(f1.box.cx, -200, 'Фасад_1 центр слева (cx=−200)');
eq(f2.box.cx, 200, 'Фасад_2 центр справа (cx=+200)');
eq(f1.box.cy, 1049.5, 'Фасад центр по высоте = (101+1998)/2');
eq(f1.opening, 'right', 'Фасад_1 открывание направо (по умолчанию)');
eq(f2.opening, 'left', 'Фасад_2 открывание налево');
// накладной: лежит ПЕРЕД корпусом (cz > передний торец стойки partDepth=579)
ok(f1.box.cz > rf.derived.partDepth, 'Фасад накладной — перед корпусом (cz > partDepth)');
eq(f1.box.cz, rf.derived.partDepth + 8, 'Фасад cz = partDepth + thick/2');

// Средний зазор между створками = gapRight(1)+gapLeft(1) = 2 мм
var f1right = f1.box.cx + f1.box.dx / 2;  // −1
var f2left = f2.box.cx - f2.box.dx / 2;   // +1
eq(f2left - f1right, 2, 'зазор между створками = 2 мм');
// Симметрия относительно центра корпуса
eq(f1.box.cx + f2.box.cx, 0, 'створки симметричны относительно 0');

// ── ФАСАД: одна створка на весь фронт ──
console.log('── Фасад: одна створка ──');
var r1 = WC.buildCarcass({
  width: 800, height: 2000, legs: 100, panel: 16, edge: 1,
  facades: { count: 1, gapTop: 2, gapBottom: 101, gapLeft: 3, gapRight: 3 }
});
var s1 = byName(r1.parts, 'Фасад_1');
eq(s1.cutW, 800 - 3 - 3 - 2, 'одна створка: ширина реза = 800−3−3−2 = 792');
eq(s1.box.cx, 0, 'одна створка по центру (cx=0)');
eq(r1.parts.filter(function (p) { return p.kind === 'facade'; }).length, 1, 'ровно 1 фасад');

// ── ФАСАДЫ: неравные ширины створок (sizes) ──
console.log('── Фасады: неравные ширины (sizes) ──');
var r3 = WC.buildCarcass({
  width: 900, height: 2000, legs: 100, panel: 16, edge: 1,
  facades: { count: 2, sizes: [600, 300], gapLeft: 1, gapRight: 1, gapTop: 0, gapBottom: 0 }
});
var g1 = byName(r3.parts, 'Фасад_1');
var g2 = byName(r3.parts, 'Фасад_2');
eq(g1.cutW, 600 - 1 - 1 - 2, 'широкая створка: рез 596');
eq(g2.cutW, 300 - 1 - 1 - 2, 'узкая створка: рез 296');
eq(g1.box.dx + g2.box.dx + 4, 900, 'суммы геом.ширин + зазоры (4) = зона 900 (проверка раскладки)');

// ── Без фасадов (обратная совместимость) ──
var r0 = WC.buildCarcass({ width: 800, height: 2000, legs: 100, panel: 16, edge: 1 });
eq(r0.parts.filter(function (p) { return p.kind === 'facade'; }).length, 0, 'без facades фасадов нет');
eq(r0.parts.length, 5, 'без наполнения и фасадов — 5 деталей корпуса');


// ── Итог ──
console.log('');
console.log('Пройдено: ' + passed + ', провалено: ' + failed);
if (failed > 0) { process.exit(1); }
