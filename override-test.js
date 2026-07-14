/* Тесты override-полей уровня секции (сверка заказа 98-Булкышева):
   shelfDepthOffset, sideExtraLeft/Right, drawers frontDrop.
   Дефолты 0 = прежнее поведение (закрыто основным сьютом 313). */
var WC = require('./wardrobe-core.js');
var passed = 0, failed = 0;
function eq(a, b, l) { if (a === b) passed++; else { failed++; console.log('  ✗ ' + l + ': ожидалось ' + JSON.stringify(b) + ', получено ' + JSON.stringify(a)); } }
function ok(c, l) { if (c) passed++; else { failed++; console.log('  ✗ ' + l); } }
function find(r, pred) { return r.parts.find(pred); }

console.log('── Напуск стоек: заказ 98, модуль A4 (стойки 509×380, дно/крыша 894×377) ──');
var rA4 = WC.buildCarcass({
  width: 896, height: 542, depth: 398, legs: 0,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sideExtraLeft: 3, sideExtraRight: 3
});
var sl = find(rA4, function (p) { return p.name === 'Стойка_левая'; });
var sr = find(rA4, function (p) { return p.name === 'Стойка_правая'; });
var dn = find(rA4, function (p) { return p.name === 'Дно'; });
eq(sl.cutL, 509, 'A4 стойка лев: высота 509');
eq(sl.cutW, 380, 'A4 стойка лев: глубина 377+3 = 380 (как в ПО)');
eq(sr.cutW, 380, 'A4 стойка прав: глубина 380 (как в ПО)');
eq(dn.cutL, 894, 'A4 дно: длина 894 без изменений');
eq(dn.cutW, 377, 'A4 дно: глубина 377 без изменений (напуск только на стойках)');
eq(sl.box.dz, 377, 'A4 стойка 3D: глубина box НЕ растёт (напуск только в раскрой)');

console.log('── Асимметричный напуск: заказ 98, модуль A7 (лев 580 / прав 575) ──');
var rA7 = WC.buildCarcass({
  width: 503, height: 542, depth: 596, legs: 0,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sideExtraLeft: 5, sideExtraRight: 0
});
var sl7 = find(rA7, function (p) { return p.name === 'Стойка_левая'; });
var sr7 = find(rA7, function (p) { return p.name === 'Стойка_правая'; });
eq(sl7.cutW, 580, 'A7 стойка лев: 575+5 = 580 (как в ПО)');
eq(sr7.cutW, 575, 'A7 стойка прав: 575 без напуска (как в ПО)');

console.log('── Отступ полки по глубине: заказ 98, модуль N1 (стойка 582, полка 569) ──');
var rN1 = WC.buildCarcass({
  width: 502, height: 1916, depth: 603, legs: 0,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  shelfDepthOffset: 13,
  sections: { type: 'shelves', count: 4 }
});
var n1s = find(rN1, function (p) { return p.kind === 'side'; });
var n1p = rN1.parts.filter(function (p) { return p.kind === 'shelf'; });
eq(n1s.cutW, 582, 'N1 стойка: глубина 582');
eq(n1p.length, 4, 'N1: 4 полки');
eq(n1p[0].cutL, 470, 'N1 полка: ширина в проём 470 (как в ПО)');
eq(n1p[0].cutW, 569, 'N1 полка: глубина 582−13 = 569 (как в ПО)');
ok(Math.abs(n1p[0].box.cz - 569 / 2) < 1e-9, 'N1 полка 3D: прижата к задней (cz сдвинут вперёд-назад к ЗС)');

console.log('── Отступ полки в легаси-режиме (без дерева) ──');
var rL = WC.buildCarcass({
  width: 502, height: 1916, depth: 603, legs: 0,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  shelfDepthOffset: 13, shelfCount: 2
});
var lp = rL.parts.filter(function (p) { return p.kind === 'shelf'; });
eq(lp[0].cutW, 569, 'легаси полка: та же поправка 582−13');

console.log('── frontDrop ящиков: заказы 104/98 (перед на 20 ниже зада) ──');
var rD = WC.buildCarcass({
  width: 800, height: 2000, depth: 600, legs: 100,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3,
  sections: { type: 'drawers', count: 2, mount: 'overlay', frontDrop: 20 }
});
var df = rD.parts.filter(function (p) { return p.kind === 'dfront'; });
var db = rD.parts.filter(function (p) { return p.kind === 'dback'; });
eq(df.length, 2, '2 переда');
eq(db[0].cutW - df[0].cutW, 20, 'перед ровно на 20 ниже зада (как 5/5 ящиков в ПО)');
eq(db[0].cutL, df[0].cutL, 'длина перед=зад не изменилась');

console.log('── Дефолты: без полей — старые цифры (регрессия) ──');
var rDef = WC.buildCarcass({
  width: 800, height: 2200, depth: 600, legs: 0,
  panel: 16, back: 3, edge: 1, gapFront: 16, gapBack: 3
});
var sdef = find(rDef, function (p) { return p.kind === 'side'; });
eq(sdef.cutW, 579, 'без напуска: стойка 579 как раньше');

console.log('');
console.log('Пройдено: ' + passed + ', провалено: ' + failed);
process.exit(failed > 0 ? 1 : 0);
