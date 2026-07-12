/* ============================================================
   MebelOFF — Wardrobe Core (ядро геометрии шкафа) v0.1
   ------------------------------------------------------------
   ЕДИНЫЙ ИСТОЧНИК ПРАВДЫ о деталях шкафа.
   Чистая логика, БЕЗ DOM, БЕЗ three.js — тестируется голым node.
   Из ЭТОГО списка деталей потом рисуются 3D, раскрой и чертёж,
   поэтому они не могут разойтись между собой.

   Этап 1: только КОРПУС (стойки, крыша, дно, задняя стенка).
   Наполнение (полки, ниши, штанги, перегородки, фасады) —
   следующими моментами, каждое со своим эталоном.

   Система координат (мм), правая тройка:
     X — ширина  (вправо +)
     Y — высота  (вверх +),  Y=0 — уровень пола (низ ножек)
     Z — глубина (от задней стенки вперёд +), Z=0 — задняя плоскость корпуса
   Каждая деталь: центр (cx,cy,cz) + габарит по осям (dx,dy,dz).
   Толщина детали лежит по одной из осей (16 мм панель / 3 мм ЗС).
============================================================ */
(function (root) {
  'use strict';

  // ── Значения по умолчанию (из эталона image 2/3/7) ──────────
  var DEFAULTS = {
    width: 800,          // Ширина (заданная)
    height: 2000,        // Высота (заданная, включая ножки)
    depth: 600,          // Глубина (заданная)
    legs: 100,           // Высота ножек (цоколь)
    panel: 16,           // Толщина панели ЛДСП
    back: 3,             // Толщина задней стенки (ХДФ)
    edge: 1,             // Кромка «1 мм с подрезкой»
    // Отступы (image 6):
    gapFront: 16,        // Отступ спереди (место под фасад)
    gapBack: 3,          // Отступ сзади (= толщина ЗС)
    gapLeft: 0,          // Отступ слева
    gapRight: 0,         // Отступ справа
    gapTop: 0,           // Отступ сверху
    gapBottom: 0         // Отступ снизу
  };

  function cfgWith(cfg) {
    var c = {};
    for (var k in DEFAULTS) c[k] = DEFAULTS[k];
    if (cfg) for (var k2 in cfg) if (cfg[k2] !== undefined && cfg[k2] !== null) c[k2] = cfg[k2];
    return c;
  }

  // ── Кромка детали ───────────────────────────────────────────
  // edges — какие стороны детали окромлены, по «часам» детали в её
  // собственной плоскости (length x width):
  //   { front, back, left, right }  — для крыши/дна (плоскость XZ)
  //   для стоек аналогично, стороны в плоскости детали.
  // Здесь фиксируем набор окромлённых сторон + длину каждой,
  // чтобы метраж кромки и «размер минус подрезка» брались из одного места.
  function mkPart(o) {
    return {
      name: o.name,
      kind: o.kind,            // 'side' | 'top' | 'bottom' | 'back'
      material: o.material,    // 'ldsp' | 'hdf'
      thick: o.thick,          // толщина детали (16 или 3)
      // габаритный размер детали в раскрое (то, что режется):
      cutL: Math.round(o.cutL),  // длина в раскрое
      cutW: Math.round(o.cutW),  // ширина в раскрое
      // окромлённые стороны с их ДЛИНОЙ (для метража ленты):
      edges: o.edges || [],    // [{side:'front', len: 798}, ...]
      // 3D-позиция: центр детали и габарит по осям сцены
      box: o.box               // {cx,cy,cz, dx,dy,dz}
    };
  }

  // Сумма длины кромки по всем сторонам детали (мм)
  function partEdgeLen(part) {
    var s = 0;
    for (var i = 0; i < part.edges.length; i++) s += part.edges[i].len;
    return s;
  }

  /* ============================================================
     buildCarcass — главная функция ядра.
     На вход: конфигурация шкафа (частичная — недостающее из DEFAULTS).
     На выход: {parts:[...], summary:{...}}
  ============================================================ */
  function buildCarcass(cfg) {
    var c = cfgWith(cfg);
    var edge = c.edge;

    // Производные размеры (правила, выверенные на эталоне) ────────
    // Корпус по высоте = Высота − ножки
    var corpusH = c.height - c.legs;                       // 1900
    // Реальная глубина = Глубина − отступ спереди − отступ сзади
    var depthReal = c.depth - c.gapFront - c.gapBack;      // 581
    // Ширина корпуса (по внешним краям стоек) = Ширина − отступы по бокам
    var corpusW = c.width - c.gapLeft - c.gapRight;        // 800

    // Глубина всех деталей корпуса = реальная − кромка переда (1)
    var partDepth = depthReal - edge;                      // 580

    // Стойка (боковина): стоит МЕЖДУ накладными крышей и дном.
    // Высота стойки = корпус − крыша − дно (обе панели)
    var sideH = corpusH - c.panel - c.panel;               // 1868
    // Крыша/дно: накладные, во всю ширину корпуса, минус подрезка
    // кромки с двух торцов по длине (перёд не по длине — по глубине).
    // Кромка крыши/дна: передний торец (по длине) + два боковых (по глубине).
    // Подрезка идёт по КАЖДОЙ окромлённой стороне:
    //   длина: два боковых торца (левый/правый по длине? нет — торцы по длине
    //   это лево/право детали). Разберём аккуратно ниже.
    // По эталону: крыша 798 x 580.
    //   798 = corpusW − 2*edge  (подрезка с левого и правого торца по длине)
    //   580 = partDepth
    var topLen = corpusW - 2 * edge;                       // 798
    var topDepth = partDepth;                              // 580

    var parts = [];

    // ── Стойки (2 шт: левая, правая) ────────────────────────────
    // Плоскость стойки — YZ (стоит вертикально, толщина по X).
    // Раскрой: длина = высота стойки (1868), ширина = глубина детали (580).
    // Кромка стойки: только передний вертикальный торец (длина = sideH).
    function sidePart(name, cx) {
      return mkPart({
        name: name, kind: 'side', material: 'ldsp', thick: c.panel,
        cutL: sideH, cutW: partDepth,
        edges: [{ side: 'front', len: sideH }],
        box: {
          cx: cx, cy: c.legs + c.panel + sideH / 2, cz: partDepth / 2,
          dx: c.panel, dy: sideH, dz: partDepth
        }
      });
    }
    // Левая стойка: внешний левый край корпуса на X = −corpusW/2
    var xL = -corpusW / 2 + c.panel / 2;
    var xR = corpusW / 2 - c.panel / 2;
    parts.push(sidePart('Стойка_левая', xL));
    parts.push(sidePart('Стойка_правая', xR));

    // ── Крыша и дно (накладные) ─────────────────────────────────
    // Плоскость — XZ (горизонтальна, толщина по Y).
    // Раскрой: длина = topLen (798), ширина = topDepth (580).
    // Кромка: передний торец (по длине, len=topLen) + два боковых
    // (по глубине, len=topDepth каждый).
    function horizPart(name, kind, cy) {
      return mkPart({
        name: name, kind: kind, material: 'ldsp', thick: c.panel,
        cutL: topLen, cutW: topDepth,
        edges: [
          { side: 'front', len: topLen },
          { side: 'left', len: topDepth },
          { side: 'right', len: topDepth }
        ],
        box: {
          cx: 0, cy: cy, cz: partDepth / 2,
          dx: corpusW, dy: c.panel, dz: partDepth
        }
      });
    }
    // Дно: низ корпуса, над ножками. Центр по Y = ножки + panel/2
    parts.push(horizPart('Дно', 'bottom', c.legs + c.panel / 2));
    // Крыша: верх корпуса. Центр по Y = ножки + corpusH − panel/2
    parts.push(horizPart('Крыша', 'top', c.legs + corpusH - c.panel / 2));

    // ── Задняя стенка (ХДФ) ─────────────────────────────────────
    // Вкладывается сзади, по внутреннему проёму корпуса.
    // Не кромится. Толщина back(3) по оси Z.
    // Внутренний проём: ширина = corpusW − 2*panel, высота = corpusH − 2*panel.
    var backW = corpusW - 2 * c.panel;
    var backH = corpusH - 2 * c.panel;
    parts.push(mkPart({
      name: 'Задняя стенка', kind: 'back', material: 'hdf', thick: c.back,
      cutL: backH, cutW: backW,
      edges: [],
      box: {
        cx: 0, cy: c.legs + corpusH / 2, cz: c.back / 2,
        dx: backW, dy: backH, dz: c.back
      }
    }));

    // ── Сводка ──────────────────────────────────────────────────
    var edgeTotal = 0, areaLdsp = 0, areaHdf = 0;
    for (var i = 0; i < parts.length; i++) {
      edgeTotal += partEdgeLen(parts[i]);
      var a = parts[i].cutL * parts[i].cutW / 1e6; // м²
      if (parts[i].material === 'hdf') areaHdf += a; else areaLdsp += a;
    }

    return {
      parts: parts,
      derived: {
        corpusH: corpusH, corpusW: corpusW,
        depthReal: depthReal, partDepth: partDepth,
        sideH: sideH, topLen: topLen
      },
      summary: {
        partCount: parts.length,
        edgeLenMm: Math.round(edgeTotal),
        edgeLenM: Math.round(edgeTotal) / 1000,
        areaLdspM2: Math.round(areaLdsp * 1000) / 1000,
        areaHdfM2: Math.round(areaHdf * 1000) / 1000
      }
    };
  }

  var API = {
    DEFAULTS: DEFAULTS,
    buildCarcass: buildCarcass,
    partEdgeLen: partEdgeLen
  };

  // Экспорт: и как модуль node, и как глобал для браузера
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.WardrobeCore = API;

})(typeof globalThis !== 'undefined' ? globalThis : this);
