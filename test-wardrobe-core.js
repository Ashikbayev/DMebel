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


// ── ШТАНГА: лист дерева (⚠ допущения — эталона из ПО нет) ──
console.log('── Штанга: лист дерева (допущения, сверить с ПО) ──');
// Шкаф 800×2000: корень panels(1) → две колонки 376; в правой штанга.
var rr = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sections: { type: 'panels', count: 1, children: [
    null,
    { type: 'rod' }
  ] }
});
var rod = byName(rr.parts, 'Штанга_1');
ok(rod, 'деталь Штанга_1 есть');
eq(rod.kind, 'rod', 'kind=rod');
eq(rod.material, 'metal', 'материал metal');
eq(rod.cutL, 372, 'длина трубы = ячейка 376 − 2·2 (gap по умолчанию)');
eq(rod.cutW, 25, 'диаметр по умолчанию 25');
eq(rod.edges.length, 0, 'труба не кромится');
// позиция: правая колонка [ +8 .. +384 ], центр +196; ось на 100 ниже верха ячейки
eq(rod.box.cx, 196, 'штанга по центру правой колонки (cx=196)');
eq(rod.box.cy, (100 + 16 + 1868) - 100, 'ось трубы = верх ячейки − drop(100)');
eq(rod.box.dz, 25, 'габарит по глубине = диаметр');
// фурнитура
eq(rod.hardware.length, 1, 'у штанги фурнитура');
eq(rod.hardware[0].qty, 2, 'держателей 2');
eq(rr.summary.hardware['Штангодержатель'], 2, 'сводка: 2 штангодержателя');
// металл не в м²: площадь как без штанги
var rr0 = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sections: { type: 'panels', count: 1, children: [null, null] }
});
eq(rr.summary.areaLdspM2, rr0.summary.areaLdspM2, 'металл не входит в м² ЛДСП');
eq(rr.parts.length, rr0.parts.length + 1, 'штанга = +1 деталь');

// Кастомные параметры + штанга в под-ячейке (над полками)
var rc = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sections: { type: 'shelves', count: 1, sizes: [null, 500], children: [
    null,
    { type: 'rod', drop: 60, dia: 30, gap: 5 }
  ] }
});
var rod2 = byName(rc.parts, 'Штанга_1');
eq(rod2.cutL, 768 - 10, 'кастом gap=5: труба = проём 768 − 2·5');
eq(rod2.cutW, 30, 'кастом диаметр 30');
// верхняя ячейка: y1 = верх проёма = 100+16+1868; ось = y1 − 60
eq(rod2.box.cy, 1984 - 60, 'кастом drop=60 от верха ВЕРХНЕЙ ячейки');
// без штанг фурнитуры в сводке нет
ok(!rr0.summary.hardware['Штангодержатель'], 'без штанги держателей в сводке нет');


// ── ЯЩИКИ: реальный эталон из ПО (шкаф image 1, раскрой image 2) ──
// Настройки ПО: секция с ящиками (2), дно накладное 3 мм / отступ 1,
// шариковые направляющие: глубина короба 550, отступ верх 50 / низ 20.
console.log('── Ящики: эталон 800×2000×600, 2 секции × 2 ящика ──');
// Колонки 376; в каждой shelves(4) → проёмы 360.8; во 2-м снизу — ящики.
var drTree = { type: 'panels', count: 1, children: [
  { type: 'shelves', count: 4, children: [null, { type: 'drawers', count: 2 }, null, null, null] },
  { type: 'shelves', count: 4, children: [null, { type: 'drawers', count: 2 }, null, null, null] }
] };
var rd = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3, sections: drTree
});
function cntIf(pred) { var n = 0; rd.parts.forEach(function (p) { if (pred(p)) n++; }); return n; }
function cutCnt(kind, L, W) {
  return cntIf(function (p) { return p.kind === kind && p.cutL === L && p.cutW === W; });
}
// «Общее количество деталей: 46» — как в ПО
eq(rd.parts.length, 46, 'всего деталей 46 (эталон ПО)');
// Корпус/полки не изменились: Полка 376×579 ×8
eq(cutCnt('shelf', 376, 579), 8, 'Полка 376×579 ×8');
// Стойки секций (в ПО «Стойка_левая/правая» 361×580 ×2+2)
eq(cutCnt('dpost', 361, 580), 4, 'ЯСтойка 361×580 ×4');
// Планки верхние: 342×70 ×2 (перед) и 342×68 ×2 (зад)
eq(cutCnt('drail', 342, 70), 2, 'ЯПланка перед 342×70 ×2');
eq(cutCnt('drail', 342, 68), 2, 'ЯПланка зад 342×68 ×2');
// Боковины (ПО «ЯщикБ» 549×109 ×8): 550−подрезка × 109.4→109
eq(cutCnt('dside', 549, 109), 8, 'ЯщикБ 549×109 ×8');
// Перед/зад (ПО «ЯщикП» 285×109 ×8): короб 318 − 32 − 1
eq(cntIf(function (p) {
  return (p.kind === 'dfront' || p.kind === 'dback') && p.cutL === 285 && p.cutW === 109;
}), 8, 'ЯщикП 285×109 ×8');
// Дно (ПО «ЯщикД» 316×548 ×4, лист ХДФ)
eq(cutCnt('dbottom', 316, 548), 4, 'ЯщикД 316×548 ×4');
var dd1 = byName(rd.parts, 'ЯщикД_1');
eq(dd1.material, 'hdf', 'дно ящика — ХДФ');
eq(dd1.thick, 3, 'дно 3 мм');
eq(dd1.edges.length, 0, 'дно не кромится');
// Фасады (ПО «Фасад_Модерн» 146.4×338 ×4) — точность 0.1 (fine)
eq(cutCnt('dfacade', 146.4, 338), 4, 'ЯщикФ 146.4×338 ×4');
// Сводка: площади сходятся с шапками раскроя ПО
eq(rd.summary.areaHdfM2, 2.207, 'ХДФ 2.207 м² (ПО: 2.2 кв.м)');
ok(Math.abs(rd.summary.areaLdspM2 - 7.8) < 0.05,
  'ЛДСП ≈ 7.8 м² (ПО: 7.8 кв.м), факт ' + rd.summary.areaLdspM2);
// Фурнитура: по комплекту направляющих на ящик
eq(rd.summary.hardware['Направляющие шариковые 550 мм (компл.)'], 4,
  'направляющие 550: 4 комплекта');
// Сквозная нумерация секций/ящиков
ok(byName(rd.parts, 'ЯСтойка_левая_2'), 'вторая секция пронумерована');
ok(byName(rd.parts, 'ЯщикФ_4'), 'четвёртый ящик пронумерован');
// Геометрия: короб и фасад на местах (⚠ 3D-допущения, раскрой не трогают)
var db1 = byName(rd.parts, 'ЯщикБЛ_1');
var df1 = byName(rd.parts, 'ЯщикФ_1');
var df2 = byName(rd.parts, 'ЯщикФ_2');
eq(db1.box.dz, 550, 'глубина короба в 3D = 550');
// ИСПРАВЛЕНО по рендеру ПО (эталон 2, image 1/3): внутренний фасад
// УТОПЛЕН В ПРОЁМ (передняя грань заподлицо с фронтом деталей),
// короб сдвинут за фасад. Было допущение cz = pd + 8 (перед корпусом).
eq(df1.box.cz, 579 - 8, 'фасад ящика (inset) утоплен в проём (cz = 571)');
eq(db1.box.cz, 579 - 16 - 275, 'короб (inset) утоплен за фасад');
ok(df1.box.cy < df2.box.cy, 'ящик 1 — НИЖНИЙ (как в ПО)');
// Металл/фурнитура не попали в м² и в детали: 46 — только панели
eq(cntIf(function (p) { return p.material === 'metal'; }), 0, 'металла в деталях нет');

// ── ЯЩИКИ: кастомная секция (heights, направляющие 500) ──
console.log('── Ящики: кастом (3 ящика, heights, глубина 500) ──');
var rd2 = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sections: { type: 'panels', count: 1, children: [
    null,
    { type: 'shelves', count: 1, sizes: [700, null], children: [
      { type: 'drawers', count: 3, heights: [200, 250, null],
        boxDepth: 500, topOffset: 40, bottomOffset: 10 },
      null
    ] }
  ] }
});
var cs1 = byName(rd2.parts, 'ЯщикБЛ_1');
eq(cs1.cutL, 499, 'кастом: боковина = 500 − подрезка');
eq(cs1.cutW, 149, 'кастом: высота боковины 200−40−10−1');
var cf1 = byName(rd2.parts, 'ЯщикФ_1');
eq(cf1.cutL, 166, 'кастом: фасад 200−30−2−2·кромка = 166');
eq(cf1.cutW, 338, 'кастом: ширина фасада от проёма секции');
var cd1 = byName(rd2.parts, 'ЯщикД_1');
eq(cd1.cutL, 316, 'кастом: дно по ширине короба − 2·1');
eq(cd1.cutW, 498, 'кастом: дно по глубине 500 − 2·1');
// авто-высота третьего слота: 700 − 200 − 250 = 250 → боковина 199
var cs3 = byName(rd2.parts, 'ЯщикБЛ_3');
eq(cs3.cutW, 199, 'кастом: авто-высота 3-го ящика (250−40−10−1)');
eq(rd2.summary.hardware['Направляющие шариковые 500 мм (компл.)'], 3,
  'кастом: 3 комплекта направляющих 500 мм');

/* ── B3: ФАСАД НА ЯЧЕЙКУ дерева — ⚠ ПО СТАНДАРТУ (эталона ПО нет) ──
   Правила: створка = проём ячейки − зазоры (2/2/2/2 по умолчанию),
   перед корпусом (z=pd..pd+thick), раскрой = гео − 2·edge (fine),
   кромка 4 стороны, петли по высоте (<900→2, <1600→3, <2000→4, ≥→5). */
console.log('── B3: фасады на ячейку (по стандарту, ⚠ сверить с ПО) ──');
var rf = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sections: { type: 'panels', count: 1, children: [
    { type: 'facade' },                                   // левая колонка: 1 створка
    { type: 'shelves', count: 1, sizes: [600], children: [
      { type: 'facade', count: 2 },                       // низ: двустворка
      { type: 'facade', opening: ['left'] }               // верх: петли слева
    ] }
  ] }
});
// 2 стойки + дно + крыша + ЗС + перегородка + полка + 4 створки = 11
eq(rf.parts.length, 11, 'B3: всего деталей 11');

// Створка_1 — левая колонка целиком (ячейка 376 × 1868)
var f1 = byName(rf.parts, 'Створка_1');
ok(f1, 'Створка_1 есть');
eq(f1.kind, 'facade', 'Створка_1 kind=facade (общий рендер)');
eq(f1.cutL, 1862, 'Створка_1 раскрой H = 1868−2−2−2·кромка');
eq(f1.cutW, 370, 'Створка_1 раскрой W = 376−2−2−2·кромка');
eq(f1.box.dx, 372, 'Створка_1 геометрия W (проём − зазоры)');
eq(f1.box.dy, 1864, 'Створка_1 геометрия H');
eq(f1.box.cx, -196, 'Створка_1 центр X (левая колонка)');
eq(f1.box.cy, 1050, 'Створка_1 центр Y');
eq(f1.box.cz, 587, 'Створка_1 центр Z = pd + thick/2 (перед корпусом)');
eq(f1.box.dz, 16, 'Створка_1 толщина по умолчанию = panel');
eq(f1.opening, 'right', 'Створка_1 одиночная → петли справа');
eq(WC.partEdgeLen(f1), 2 * (1862 + 370), 'Створка_1 кромка 4 стороны');
ok(f1.hardware && f1.hardware[0].name === 'Петля накладная' &&
  f1.hardware[0].qty === 4, 'Створка_1: 4 петли (1864 < 2000)');

// Двустворка в нижней ячейке (376 × 600), слоты по 188
var f2 = byName(rf.parts, 'Створка_2');
var f3 = byName(rf.parts, 'Створка_3');
ok(f2 && f3, 'двустворка: обе створки есть');
eq(f2.cutL, 594, 'Створка_2 раскрой H = 600−4−2·кромка');
eq(f2.cutW, 182, 'Створка_2 раскрой W = 188−4−2·кромка');
eq(f2.box.cx, 102, 'Створка_2 центр X (левый слот)');
eq(f3.box.cx, 290, 'Створка_3 центр X (правый слот)');
eq(f2.box.cy, 416, 'Створка_2 центр Y (нижняя ячейка)');
// межстворочный зазор = gapRight + gapLeft = 4
eq((f3.box.cx - f3.box.dx / 2) - (f2.box.cx + f2.box.dx / 2), 4,
  'зазор между створками 4 (2+2)');
eq(f2.opening, 'left', 'двустворка: левая — петли слева');
eq(f3.opening, 'right', 'двустворка: правая — петли справа');
ok(f2.hardware[0].qty === 2 && f3.hardware[0].qty === 2,
  'двустворка: по 2 петли (596 < 900)');

// Верхняя ячейка (376 × 1252), opening задан явно
var f4 = byName(rf.parts, 'Створка_4');
ok(f4, 'Створка_4 есть');
eq(f4.cutL, 1246, 'Створка_4 раскрой H = 1252−4−2·кромка');
eq(f4.cutW, 370, 'Створка_4 раскрой W');
eq(f4.box.cy, 1358, 'Створка_4 центр Y (верхняя ячейка)');
eq(f4.opening, 'left', 'Створка_4: opening из узла');
eq(f4.hardware[0].qty, 3, 'Створка_4: 3 петли (1248 < 1600)');

// Фурнитура в сводке: 4 + 2 + 2 + 3 = 11 петель
eq(rf.summary.hardware['Петля накладная'], 11, 'сводка: 11 петель');

// Кромка итого: корпус 9890 + створки 4464+2·1552+3232 = 20690
eq(rf.summary.edgeLenMm, 20690, 'B3: кромка итого 20690 мм');
eq(rf.summary.edgeLenM, 20.69, 'B3: кромка итого 20.69 м');
// Площади: ЛДСП 5.752 м² (корпус+перегородка+полка+4 створки), ХДФ 1.515
eq(rf.summary.areaLdspM2, 5.752, 'B3: ЛДСП 5.752 м²');
eq(rf.summary.areaHdfM2, 1.515, 'B3: ХДФ 1.515 м²');

// ── B3: створка на ВЕСЬ корневой проём (768 × 1868) ──
var rfr = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sections: { type: 'facade' }
});
eq(rfr.parts.length, 6, 'корневая створка: 6 деталей');
var fr = byName(rfr.parts, 'Створка_1');
eq(fr.cutW, 762, 'корневая створка W = 768−4−2·кромка');
eq(fr.cutL, 1862, 'корневая створка H');
eq(fr.hardware[0].qty, 4, 'корневая створка: 4 петли');

// ── B3: переопределения thick / material / зазоры + fine 0.1 ──
var rft = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sections: { type: 'facade', thick: 18, material: 'mdf',
    gapTop: 3, gapBottom: 3, gapLeft: 1.75, gapRight: 1.75 }
});
var ft = byName(rft.parts, 'Створка_1');
eq(ft.thick, 18, 'створка: thick переопределён (18)');
eq(ft.box.dz, 18, 'створка: толщина в 3D');
eq(ft.box.cz, 588, 'створка: cz = pd + 18/2');
eq(ft.material, 'mdf', 'створка: material переопределён');
eq(ft.cutW, 762.5, 'створка: fine 0.1 (768−3.5−2·кромка = 762.5)');
eq(ft.cutL, 1860, 'створка: H при зазорах 3/3');

// ── B3: границы петель (прямой вызов buildSection) ──
function hingeQty(cellH) {
  var ps = [], ctx = { panel: 16, partDepth: 579, edge: 1,
    counters: { shelf: 0, panel: 0, rod: 0, drawerSec: 0, drawer: 0, cfacade: 0 } };
  WC.buildSection({ type: 'facade' },
    { x0: 0, x1: 400, y0: 0, y1: cellH, z: 290 }, ctx, ps);
  return ps[0].hardware[0].qty;
}
eq(hingeQty(900), 2, 'петли: гео 896 < 900 → 2');
eq(hingeQty(904), 3, 'петли: гео 900 → 3');
eq(hingeQty(1604), 4, 'петли: гео 1600 → 4');
eq(hingeQty(2004), 5, 'петли: гео 2000 → 5');

// ── B3: совместимость с фасадами фронта (buildFacades) ──
var rfc = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sections: { type: 'panels', count: 1, children: [{ type: 'facade' }, null] },
  facades: { count: 2, gapTop: 2, gapBottom: 101, gapLeft: 1, gapRight: 1 }
});
ok(byName(rfc.parts, 'Фасад_1') && byName(rfc.parts, 'Фасад_2') &&
  byName(rfc.parts, 'Створка_1'), 'Фасад_N фронта и Створка_N сосуществуют');
eq(byName(rfc.parts, 'Фасад_1').cutL, 1895, 'фронт-фасад не сломан (эталон 1895)');

// ── B3: три створки — чередование петель у средней ──
var rf3 = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sections: { type: 'facade', count: 3 }
});
eq(byName(rf3.parts, 'Створка_1').opening, 'left', '3 створки: левая — слева');
eq(byName(rf3.parts, 'Створка_2').opening, 'right', '3 створки: средняя — чередование');
eq(byName(rf3.parts, 'Створка_3').opening, 'right', '3 створки: правая — справа');
eq(byName(rf3.parts, 'Створка_1').cutW, 250, '3 створки: раскрой W = 256−4−2·кромка');

/* ── D: ГРАНИЧНЫЕ ПОЛКИ bottomShelf/topShelf — ⚠ ПО СТАНДАРТУ ──
   (эталона image 5/7 нет). Флаги узла shelves добавляют полки на низ /
   под верх ячейки; зона проёмов −panel за флаг; children не меняются;
   нумерация: нижняя → промежуточные снизу вверх → верхняя. */
console.log('── D: граничные полки (по стандарту, ⚠ сверить с ПО) ──');
var rD = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sections: { type: 'shelves', count: 1, bottomShelf: true, topShelf: true,
    children: [{ type: 'facade' }, null] }
});
// 5 корпус + 3 полки (нижняя, промежуточная, верхняя) + створка = 9
eq(rD.parts.length, 9, 'D: всего деталей 9');
var pD1 = byName(rD.parts, 'Полка_1');
var pD2 = byName(rD.parts, 'Полка_2');
var pD3 = byName(rD.parts, 'Полка_3');
ok(pD1 && pD2 && pD3, 'D: три полки есть');
// Нижняя лежит НА низу ячейки (низ проёма 116, центр 124)
eq(pD1.box.cy, 124, 'D: нижняя полка на низу ячейки');
// Зона проёмов 1868−32=1836; проём = (1836−16)/2 = 910
// Промежуточная: 116+16+910=1042 → центр 1050
eq(pD2.box.cy, 1050, 'D: промежуточная полка между проёмами');
// Верхняя ПОД верхом ячейки (верх 1984, центр 1976)
eq(pD3.box.cy, 1976, 'D: верхняя полка под верхом ячейки');
// Все три — обычные полки: раскрой в ширину ячейки, кромка перёд
eq(pD1.cutL, 768, 'D: нижняя раскрой в ширину проёма');
eq(pD3.cutL, 768, 'D: верхняя раскрой в ширину проёма');
eq(WC.partEdgeLen(pD1), 768, 'D: нижняя кромка только перёд');
// Дочерняя ячейка сдвинута: створка в нижнем проёме y[132..1042]
var fD = byName(rD.parts, 'Створка_1');
ok(fD, 'D: створка в нижнем проёме есть');
eq(fD.box.dy, 906, 'D: створка гео H = проём 910 − 4');
eq(fD.cutL, 904, 'D: створка раскрой H');
eq(fD.cutW, 762, 'D: створка раскрой W');
eq(fD.box.cy, 587, 'D: створка центр Y (проём начат над нижней полкой)');
eq(fD.hardware[0].qty, 3, 'D: створка 3 петли (906 < 1600)');
// Сводка: кромка 7646 (корпус) + 3·768 + 2·(904+762) = 13282
eq(rD.summary.edgeLenMm, 13282, 'D: кромка итого 13282 мм');
eq(rD.summary.areaLdspM2, 5.109, 'D: ЛДСП 5.109 м²');

// ── D: только нижняя, count:0 (полка без деления проёма) ──
var rDb = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sections: { type: 'shelves', count: 0, bottomShelf: true }
});
eq(rDb.parts.length, 6, 'D: count 0 + нижняя = 6 деталей');
eq(byName(rDb.parts, 'Полка_1').box.cy, 124, 'D: одиночная нижняя на месте');

// ── D: только верхняя в под-ячейке (антресольная полка колонки) ──
var rDt = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sections: { type: 'panels', count: 1, children: [
    { type: 'shelves', count: 0, topShelf: true }, null ] }
});
var pDt = byName(rDt.parts, 'Полка_1');
ok(pDt, 'D: антресольная полка есть');
eq(pDt.cutL, 376, 'D: антресольная в ширину колонки');
eq(pDt.box.cy, 1976, 'D: антресольная под верхом колонки');
eq(pDt.box.cx, -196, 'D: антресольная в левой колонке');

// ── D: флаги + кастомные sizes (нижний проём фикс. 400) ──
var rDs = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sections: { type: 'shelves', count: 1, bottomShelf: true, sizes: [400, null] }
});
// зона 1868−16=1852; проёмы 400 и 1852−16−400=1436
var pDs2 = byName(rDs.parts, 'Полка_2');
eq(pDs2.box.cy, 116 + 16 + 400 + 8, 'D: полка над фикс. проёмом 400');
eq(rDs.parts.length, 7, 'D: sizes + нижняя = 7 деталей');

// ── D: без флагов поведение прежнее (Полка_1 = промежуточная) ──
var rD0 = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sections: { type: 'shelves', count: 2 }
});
eq(rD0.parts.length, 7, 'D: без флагов 2 полки как раньше');
// (1868 − 2·16)/3 = 612 → первая полка: 116+612=728 → центр 736
eq(byName(rD0.parts, 'Полка_1').box.cy, 736, 'D: без флагов позиции прежние');

/* ── ЯЩИКИ-2: НАКЛАДНЫЕ (mount:'overlay') — эталон 2 из ПО ──
   Шкаф 800×2000×600, колонка 376, секция в проёме 360.8, 2 ящика.
   Раскрой ПО (проект без подрезки; сверка по независимым деталям):
     стоек и планок НЕТ; короб = ячейка − 26 = 350;
     ЯщикП 318 (=350−32, БЕЗ −1); ЯщикД 348×548 (точно);
     Фасад гео 408×180 (=376+2·16 × 180.4−0.4), раскрой 178×406 (точно). */
console.log('── Ящики: НАКЛАДНЫЕ (mount overlay, эталон 2) ──');
var ro = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sections: { type: 'panels', count: 1, children: [
    { type: 'shelves', count: 4, children: [
      null, { type: 'drawers', count: 2, mount: 'overlay' }, null, null, null
    ] },
    null
  ] }
});
// Стоек и планок у накладной секции НЕТ
eq(ro.parts.filter(function (p) { return p.kind === 'dpost'; }).length, 0,
  'overlay: стоек секции нет');
eq(ro.parts.filter(function (p) { return p.kind === 'drail'; }).length, 0,
  'overlay: планок нет');
// Короб на всю ячейку: 376 − 26 = 350
var oP1 = byName(ro.parts, 'ЯщикП_1');
eq(oP1.cutL, 318, 'overlay: ЯщикП = 350 − 2·16, БЕЗ −1 (эталон 2)');
eq(oP1.box.dx, 318, 'overlay: П/З в 3D между боковинами');
var oD1 = byName(ro.parts, 'ЯщикД_1');
eq(oD1.cutL, 348, 'overlay: дно по ширине 350 − 2·1 (точно эталон 2)');
eq(oD1.cutW, 548, 'overlay: дно по глубине 550 − 2·1');
var oB1 = byName(ro.parts, 'ЯщикБЛ_1');
eq(oB1.cutL, 549, 'overlay: боковина − подрезка (наш режим с кромкой)');
eq(oB1.cutW, 109, 'overlay: высота боковины 180.4−50−20−1 → 109');
// Фасад накладной: гео 408×180, раскрой 178×406 — ТОЧНО как ПО
var oF1 = byName(ro.parts, 'ЯщикФ_1');
var oF2 = byName(ro.parts, 'ЯщикФ_2');
eq(oF1.box.dx, 408, 'overlay: фасад гео W = 376 + 2·16 (перекрытие)');
eq(Math.round(oF1.box.dy * 10) / 10, 180, 'overlay: фасад гео H = 180.4 − 0.4 (fGapMid/2)');
eq(oF1.cutW, 406, 'overlay: фасад раскрой W = 406 (точно эталон 2)');
eq(oF1.cutL, 178, 'overlay: фасад раскрой H = 178 (точно эталон 2)');
eq(oF2.box.dy, 180, 'overlay: верхний фасад тоже 180');
// Межфасадный зазор 0.8, крайние заподлицо с проёмом
eq(Math.round(((oF2.box.cy - oF2.box.dy / 2) - (oF1.box.cy + oF1.box.dy / 2)) * 10) / 10,
  0.8, 'overlay: межфасадный зазор 0.8');
var oSecY0 = null, oSecY1 = null;
// проём секции: 2-й снизу из 5 по 360.8: y0 = 116 + 360.8 + 16
oSecY0 = 116 + 360.8 + 16; oSecY1 = oSecY0 + 360.8;
eq(Math.round((oF1.box.cy - oF1.box.dy / 2) * 10) / 10, Math.round(oSecY0 * 10) / 10, 'overlay: нижний фасад заподлицо с низом проёма');
eq(oF2.box.cy + oF2.box.dy / 2, oSecY1, 'overlay: верхний фасад заподлицо с верхом проёма');
// Фасад перед корпусом («отступ спереди 16»), поле mount для рендера
eq(oF1.box.cz, 579 + 8, 'overlay: фасад перед корпусом (cz = 587)');
eq(oF1.mount, 'overlay', 'overlay: у фасада поле mount');
// Короб заподлицо с фронтом корпуса (в отличие от inset)
eq(oB1.box.cz, 579 - 275, 'overlay: короб передним краем на pd');
// Направляющие по-прежнему в фурнитуре
eq(ro.summary.hardware['Направляющие шариковые 550 мм (компл.)'], 2,
  'overlay: 2 комплекта направляющих');

// ── overlay: 3 фасада с heights — межзазор у среднего с двух сторон ──
var ro3 = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sections: { type: 'drawers', count: 3, mount: 'overlay', heights: [100, 100, null] }
});
// корневая ячейка 768×1868; слоты 100/100/1668; короб 768−26=742
var o3F1 = byName(ro3.parts, 'ЯщикФ_1');
var o3F2 = byName(ro3.parts, 'ЯщикФ_2');
var o3F3 = byName(ro3.parts, 'ЯщикФ_3');
eq(o3F1.box.dy, 99.6, 'overlay 3: нижний фасад 100 − 0.4');
eq(Math.round(o3F2.box.dy * 10) / 10, 99.2, 'overlay 3: средний фасад 100 − 0.8 (два соседства)');
eq(o3F3.box.dy, 1667.6, 'overlay 3: верхний фасад 1668 − 0.4');
eq(o3F1.cutL, 97.6, 'overlay 3: раскрой fine 0.1 (97.6)');
eq(o3F1.box.dx, 800, 'overlay 3: гео W = 768 + 32');
eq(byName(ro3.parts, 'ЯщикП_1').cutL, 742 - 32, 'overlay 3: П/З от короба 742');

// ── overlay: переопределение fOverhang и fGapMid ──
var ro4 = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sections: { type: 'drawers', count: 2, mount: 'overlay', fOverhang: 8, fGapMid: 3 }
});
var o4F1 = byName(ro4.parts, 'ЯщикФ_1');
eq(o4F1.box.dx, 768 + 16, 'overlay: fOverhang переопределён (8)');
eq(o4F1.box.dy, 934 - 1.5, 'overlay: fGapMid переопределён (3)');

// ── inset не изменился по раскрою (регрессия внутри этого блока) ──
var ri = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sections: { type: 'panels', count: 1, children: [
    { type: 'shelves', count: 4, children: [
      null, { type: 'drawers', count: 2 }, null, null, null ] },
    null ] }
});
eq(byName(ri.parts, 'ЯщикП_1').cutL, 285, 'inset: ЯщикП 285 как в эталоне 1');
eq(byName(ri.parts, 'ЯщикФ_1').cutL, 146.4, 'inset: фасад 146.4 как в эталоне 1');
eq(byName(ri.parts, 'ЯщикФ_1').mount, 'inset', 'inset: поле mount у фасада');

// ── Итог ──
console.log('');
console.log('Пройдено: ' + passed + ', провалено: ' + failed);
if (failed > 0) { process.exit(1); }
