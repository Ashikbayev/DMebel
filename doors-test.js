/* Двери секций через ядро (зонный режим buildFacades):
   1) дефолты 3/3/3/3/2 воспроизводят старую формулу CRM,
   2) зазорами достигаются точные цифры заказа 98,
   3) старый (per-slot) режим не сломан. */
var WC = require('./wardrobe-core.js');
var passed = 0, failed = 0;
function eq(a, b, l) { if (a === b) passed++; else { failed++; console.log('  ✗ ' + l + ': ожидалось ' + JSON.stringify(b) + ', получено ' + JSON.stringify(a)); } }
function ok(c, l) { if (c) passed++; else { failed++; console.log('  ✗ ' + l); } }
function facades(fc, W, H) {
  var parts = [];
  WC.buildFacades(fc, { width: W, height: H, edge: 1, panel: 16 }, 0, parts);
  return parts;
}

console.log('── Дефолты = старая формула CRM ──');
var d2 = facades({ count: 2, gapMid: 2, gapLeft: 3, gapRight: 3, gapTop: 3, gapBottom: 3 }, 800, 2000);
eq(d2.length, 2, '2 двери');
eq(d2[0].cutW, 394, '2 двери 800: ширина (800−12)/2=394 как legacy');
eq(d2[0].cutL, 1992, '2 двери 2000: высота 2000−8=1992 как legacy');
var d1 = facades({ count: 1, gapMid: 2, gapLeft: 3, gapRight: 3, gapTop: 3, gapBottom: 3 }, 800, 2000);
eq(d1[0].cutW, 792, '1 дверь 800: 800−8=792 как legacy');
var d3 = facades({ count: 3, gapMid: 2, gapLeft: 3, gapRight: 3, gapTop: 3, gapBottom: 3 }, 900, 2000);
eq(d3.length, 3, '3 двери');
var sum3 = d3[0].cutW + d3[1].cutW + d3[2].cutW;
eq(sum3, 900 - 6 - 4 - 6, '3 двери: суммарная ширина точная (распределение без потерь)');

console.log('── Заказ 98: точные цифры через зазоры оператора ──');
// A3: корпус 502×542, 1 дверь 505×498 (перекрытие по бокам, планка снизу)
var a3 = facades({ count: 1, gapMid: 2, gapLeft: -3, gapRight: -2, gapTop: 4, gapBottom: 38 }, 502, 542);
eq(a3[0].cutW, 505, 'A3: ширина 505 (зазоры −3/−2 = перекрытие)');
eq(a3[0].cutL, 498, 'A3: высота 498 (низ 38 — фасадная планка)');
// N1: корпус 502×1916, 1 дверь 1896×498
var n1 = facades({ count: 1, gapMid: 2, gapLeft: 1, gapRight: 1, gapTop: 4, gapBottom: 14 }, 502, 1916);
eq(n1[0].cutW, 498, 'N1: ширина 498 (стандартные 1/1)');
eq(n1[0].cutL, 1896, 'N1: высота 1896');
// A4: корпус 896×542, 2 двери 458 шириной (перекрытие на соседей)
var a4 = facades({ count: 2, gapMid: -4, gapLeft: -10, gapRight: -10, gapTop: 15, gapBottom: 19 }, 896, 542);
eq(a4[0].cutW, 458, 'A4: две двери по 458 (фасады шире корпуса — перекрытие)');
eq(a4[0].cutL, 506, 'A4: высота 506');

console.log('── Старый per-slot режим (без gapMid) не сломан ──');
var old = facades({ count: 2, gapTop: 2, gapBottom: 101, gapLeft: 1, gapRight: 1 }, 800, 2000);
eq(old[0].cutW, 396, 'per-slot: 800/2−1−1−2=396 (как тесты B3)');

console.log('');
console.log('Пройдено: ' + passed + ', провалено: ' + failed);
process.exit(failed > 0 ? 1 : 0);
