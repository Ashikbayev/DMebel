/* ============================================================
   MebelOFF — Wardrobe Core (ядро геометрии шкафа) v1.3
   ------------------------------------------------------------
   ЕДИНЫЙ ИСТОЧНИК ПРАВДЫ о деталях шкафа.
   Чистая логика, БЕЗ DOM, БЕЗ three.js — тестируется голым node.
   Из ЭТОГО списка деталей потом рисуются 3D, раскрой и чертёж,
   поэтому они не могут разойтись между собой.

   Готово: КОРПУС (стойки, крыша, дно, ЗС) + НАПОЛНЕНИЕ.
   Наполнение задаётся ЛИБО деревом секций (cfg.sections, рекурсия),
   ЛИБО легаси-плоскими cfg.shelfCount / cfg.partitionCount (совместимость).
   Дерево воспроизводит реальный эталон-стеллаж из ПО (см. buildSection).
   ФАСАДЫ: накладные створки (buildFacades), эталон 1895×396 ×2.
   ШТАНГА: лист дерева {type:'rod'} — ⚠ БЕЗ эталона ПО, допущения в buildRod.
   ЯЩИКИ: лист дерева {type:'drawers'} — ДВА ТИПА УСТАНОВКИ (mount):
     'inset' (внутренние, эталон 1: 46 дет, ЛДСП 7.8/ХДФ 2.2 м²) и
     'overlay' (НАКЛАДНЫЕ, эталон 2: без своих стоек, короб на всю
     ячейку «как полки», фасад перекрывает соседей, 178×406 точно).
     3D внутренних ИСПРАВЛЕНО по image 1/3: фасад утоплен в проём.
   ФАСАД НА ЯЧЕЙКУ (B3): лист дерева {type:'facade'} — ⚠ ПО СТАНДАРТУ
     (решение Дали: эталона ПО нет, допущения в buildCellFacade).
   ГРАНИЧНЫЕ ПОЛКИ (D): флаги bottomShelf/topShelf узла shelves —
     ⚠ ПО СТАНДАРТУ (решение Дали, image 5/7 нет), см. buildSection.
   Впереди: ниши, присадка, витрины.

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
    gapBottom: 0,        // Отступ снизу
    shelfCount: 0,       // Кол-во стационарных полок (0 = без полок) [легаси, плоский оверлей]
    partitionCount: 0,   // Кол-во вертикальных перегородок (0 = без перегородок) [легаси]
    // ── ПОПРАВКИ УРОВНЯ СЕКЦИИ (сверка заказа 98: стандарта нет,
    //    оператор задаёт вручную; дефолт 0 = прежнее поведение) ──
    shelfDepthOffset: 0, // Полка мельче корпуса по глубине, мм (98: 13/20)
    sideExtraLeft: 0,    // Напуск глубины ЛЕВОЙ стойки, мм (± под стену)
    sideExtraRight: 0,   // Напуск глубины ПРАВОЙ стойки, мм (98/A4: +3)
    // ── ДЕРЕВО СЕКЦИЙ (рекурсивное наполнение) ──────────────────
    // Если задано — заменяет плоские shelfCount/partitionCount.
    // Узел делит ОДНУ прямоугольную ячейку:
    //   { type:'shelves'|'panels', count:N, sizes:[...], children:[узел|null, ...] }
    //   'shelves' — N полок делят ВЫСОТУ ячейки на N+1 проёмов,
    //               каждая полка режется РОВНО в ширину ячейки;
    //               ⚠ ПО СТАНДАРТУ (этап D): флаги bottomShelf/topShelf —
    //               граничные полки на низ/под верх ячейки (см. buildSection).
    //   'panels'  — N перегородок делят ШИРИНУ ячейки на N+1 секций,
    //               каждая перегородка режется РОВНО в высоту ячейки.
    //   sizes     — опц. размеры долей (мм): число = фикс, null/нет = авто
    //               (равная часть остатка). Нет sizes → все доли равны.
    //   children  — длина N+1 (по под-ячейке слева-направо / снизу-вверх),
    //               элемент null = пустая ячейка (лист). Короче N+1 → хвост = null.
    //   ЛИСТ-СУЩНОСТЬ: вместо null в children можно положить штангу:
    //     { type:'rod', drop?, dia?, gap? } — труба + 2 держателя в ячейке.
    //     БЕЗ ЭТАЛОНА ИЗ ПО — допущения задокументированы в buildRod, сверить!
    //   ЛИСТ-СУЩНОСТЬ: секция с ящиками (ВЫВЕРЕНА по эталону ПО):
    //     { type:'drawers', count, heights?, secTop?, secBottom?, boxDepth?,
    //       topOffset?, bottomOffset?, bottomThick?, bottomInset?, clearance?,
    //       railFront?, railBack?, fGapTop?, fGapBottom?, fGapSide? }
    //     Свои стойки + 2 планки + на ящик: 2 боковины, перед/зад,
    //     дно ХДФ, фасад, направляющие (фурнитура). См. buildDrawers.
    //   ЛИСТ-СУЩНОСТЬ: фасад (створки) на ячейку — ⚠ ПО СТАНДАРТУ:
    //     { type:'facade', count?, sizes?, opening?, gapTop?, gapBottom?,
    //       gapLeft?, gapRight?, thick?, material? } — см. buildCellFacade.
    // Корень дерева = чистовой проём корпуса (innerW × clearH).
    sections: null,
    // ── НАКЛАДНЫЕ ФАСАДЫ (створки на фронт корпуса) ─────────────
    // Если задано — фронт закрывается count створками (см. buildFacades).
    //   { count:N, thick:16, gapTop, gapBottom, gapLeft, gapRight,
    //     sizes:[...], opening:['right'|'left', ...], material }
    // Зона фасадов = ЗАДАННЫЕ Высота×Ширина (не корпус). Делится по
    // ширине на N слотов (sizes или поровну); в каждом слоте створка
    // утоплена на gapLeft/gapRight, по высоте — на gapTop/gapBottom.
    // Раскрой створки = геометрия − 2·кромка (подрезка по кругу).
    // Эталон 800×2000, N=2 → Фасад 1895×396 ×2.
    facades: null
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
      // габаритный размер детали в раскрое (то, что режется).
      // Корпусные детали ПО режет в целые мм (109.4→109, 360.8→361),
      // фасады — с точностью 0.1 (146.4) → флаг o.fine (эталон image 2):
      cutL: o.fine ? Math.round(o.cutL * 10) / 10 : Math.round(o.cutL),
      cutW: o.fine ? Math.round(o.cutW * 10) / 10 : Math.round(o.cutW),
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

  /* ── splitSizes — размеры под-ячеек при делении ячейки ──────────
     Возвращает массив из (N+1) размеров долей (мм) вдоль оси деления.
       span — полный размер ячейки по оси (ширина для panels, высота для shelves)
       N    — число разделителей; slots = N+1 долей; каждая доля разделена панелью
       panel — толщина разделителя (съедает panel мм между долями)
       sizes — опц. массив пожеланий по долям:
                 число  → доля зафиксирована в этот размер,
                 null/нет → «авто»: добирает равную часть остатка.
       Остаток = span − N·panel − сумма(зафиксированных); делится поровну на «авто».
       Нет sizes (или все авто) → все доли равны — прежнее поведение (эталон). */
  function splitSizes(sizes, slots, span, N, panel) {
    var avail = span - N * panel;
    var arr = sizes || [], out = [], fixedSum = 0, autoCount = 0, i, v;
    for (i = 0; i < slots; i++) {
      v = arr[i];
      if (typeof v === 'number' && isFinite(v)) { out.push(v); fixedSum += v; }
      else { out.push(null); autoCount++; }
    }
    var autoSize = autoCount > 0 ? (avail - fixedSum) / autoCount : 0;
    for (i = 0; i < slots; i++) if (out[i] === null) out[i] = autoSize;
    return out;
  }

  /* ============================================================
     buildRod — ШТАНГА в ячейке дерева (лист-сущность).
     ⚠ ЭТАЛОНА ИЗ ПО НЕТ — все правила ниже ДОПУЩЕНИЯ, сверить позже:
       drop = 100 — от ВЕРХА ячейки до ОСИ трубы, мм (в ПО обычно 40–120);
       dia  = 25  — диаметр круглой трубы (овал 30×15 добавим по эталону);
       gap  = 2   — зазор трубы до стенки с КАЖДОЙ стороны (посадка в
                    держатель): длина трубы = ширина ячейки − 2·gap;
       по глубине ось трубы = середина глубины детали (в ПО часто
                    фикс. отступ от переда — уточнить);
       держатели — фурнитура 2 шт (Штангодержатель), НЕ панель:
                    не попадают в раскрой и в м², идут в part.hardware.
     Деталь: kind='rod', material='metal' (исключён из м² ЛДСП/ХДФ),
     cutL = длина трубы (торцовка), cutW = dia, кромки нет.
  ============================================================ */
  function buildRod(node, cell, ctx, parts) {
    var drop = (typeof node.drop === 'number') ? node.drop : 100;
    var dia = (typeof node.dia === 'number') ? node.dia : 25;
    var gap = (typeof node.gap === 'number') ? node.gap : 2;
    var cellW = cell.x1 - cell.x0;
    var len = cellW - 2 * gap;
    ctx.counters.rod++;
    parts.push(mkPart({
      name: 'Штанга_' + ctx.counters.rod, kind: 'rod',
      material: 'metal', thick: dia,
      cutL: len, cutW: dia,
      edges: [],
      box: {
        cx: (cell.x0 + cell.x1) / 2, cy: cell.y1 - drop, cz: cell.z,
        dx: len, dy: dia, dz: dia
      }
    }));
    parts[parts.length - 1].hardware = [{ name: 'Штангодержатель', qty: 2 }];
  }

  /* ============================================================
     buildCellFacade — ФАСАД НА ЯЧЕЙКУ дерева (лист-сущность). Этап B3.
     ⚠ ЭТАЛОНА ИЗ ПО НЕТ — правила приняты «ПО СТАНДАРТУ» (решение
     Дали в сессии B3), сверить с раскроем ПО при первом же случае:
       створка стоит ПЕРЕД корпусом, как фасад ящика: задняя грань
         на переднем торце деталей (z = partDepth), толщина вперёд;
       геометрия = ПРОЁМ ячейки − зазоры; зазоры по умолчанию 2 мм
         со всех сторон (унифицировано с fGapSide/fGapBottom ящиков);
         створка НЕ перекрывает торцы соседних панелей — стиль ПО,
         виден на фасадах ящиков «Модерн»;
       count>1: ширина ячейки делится на слоты (sizes или поровну,
         БЕЗ панелей между); межстворочный зазор = gapRight+gapLeft (4);
       раскрой = геометрия − 2·edge, точность 0.1 (fine), кромка —
         все 4 стороны (как Фасад фронта и ЯщикФ);
       петли: «Петля накладная», кол-во от ВЫСОТЫ створки (стандарт
         мебельной практики, у ПО может отличаться):
           < 900 → 2, < 1600 → 3, < 2000 → 4, иначе → 5;
         идут в фурнитуру (part.hardware → summary), не в раскрой;
       opening — сторона ПЕТЕЛЬ: одиночная 'right'; несколько —
         крайние наружу ('left' … 'right'), середина чередуется.
     Узел: { type:'facade', count?(1), sizes?, opening?:['left'|'right'],
             gapTop?(2), gapBottom?(2), gapLeft?(2), gapRight?(2),
             thick?(=panel), material?('ldsp') }
     Деталь: kind='facade' (рендер в туле общий с buildFacades:
     2D-ручка по opening, чекбокс «Фасады» в 3D), имя 'Створка_N' —
     сквозная нумерация, не пересекается с 'Фасад_N' фронта.
  ============================================================ */
  function buildCellFacade(node, cell, ctx, parts) {
    function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
    var edge = num(ctx.edge, 1);
    var count = node.count > 0 ? (node.count | 0) : 1;
    var thick = num(node.thick, ctx.panel);
    var gT = num(node.gapTop, 2), gB = num(node.gapBottom, 2);
    var gL = num(node.gapLeft, 2), gR = num(node.gapRight, 2);
    var mat = node.material || 'ldsp';
    var opening = node.opening || [];

    var cellH = cell.y1 - cell.y0;
    var geomH = cellH - gT - gB;
    var cutH = geomH - 2 * edge;
    var cy = cell.y0 + gB + geomH / 2;
    // Петли по высоте створки — стандарт: <900→2, <1600→3, <2000→4, ≥2000→5
    var hinges = geomH < 900 ? 2 : geomH < 1600 ? 3 : geomH < 2000 ? 4 : 5;

    var slotW = splitSizes(node.sizes, count, cell.x1 - cell.x0, 0, 0);
    var xcur = cell.x0, i, sw, geomW, cutW, k;
    for (i = 0; i < count; i++) {
      sw = slotW[i];
      geomW = sw - gL - gR;
      cutW = geomW - 2 * edge;
      k = ++ctx.counters.cfacade;
      parts.push(mkPart({
        name: 'Створка_' + k, kind: 'facade',
        material: mat, thick: thick, fine: true,
        cutL: cutH, cutW: cutW,
        edges: [
          { side: 'top', len: cutW },
          { side: 'bottom', len: cutW },
          { side: 'left', len: cutH },
          { side: 'right', len: cutH }
        ],
        box: {
          cx: xcur + gL + geomW / 2, cy: cy, cz: ctx.partDepth + thick / 2,
          dx: geomW, dy: geomH, dz: thick
        }
      }));
      parts[parts.length - 1].opening = opening[i] ||
        (count === 1 ? 'right'
          : (i === 0 ? 'left'
            : (i === count - 1 ? 'right'
              : (i % 2 ? 'right' : 'left'))));
      parts[parts.length - 1].hardware = [{ name: 'Петля накладная', qty: hinges }];
      xcur += sw;
    }
  }

  /* ============================================================
     buildDrawers — СЕКЦИЯ С ЯЩИКАМИ в ячейке дерева (лист-сущность).
     ДВА ТИПА УСТАНОВКИ (mount), ОБА ВЫВЕРЕНЫ ПО ЭТАЛОНАМ ПО:
     ── mount:'inset' (ВНУТРЕННИЕ, по умолчанию) ──────────────────
     Эталон 1 (шкаф 800×2000×600, колонки 376, секция в проёме 360.8,
     ящиков 2, дно накладное 3/отступ 1, шариковые направляющие:
     глубина 550, отступ верх 50 / низ 20):
       ЯСтойка ×2       361 × 580   (=проём 360.8→361; 580 = pd + edge:
                        у стойки НЕТ задней подрезки — ПОДТВЕРЖДЕНО
                        эталоном 2, где без подрезки стойка = полка)
       ЯПланка перед    342 × 70    (=проём секции 344 − 2·edge)
       ЯПланка зад      342 × 68    (⚠ в эталоне 2 планки 69/71 —
                        ширины параметрические; какая перед — не видно)
       на ящик: бок ×2  549 × 109   (=550−edge × 180.4−50−20−edge)
                п/з ×2  285 × 109   (=короб 318 − 2·panel − 1)
                дно ХДФ 316 × 548   (=короб/глубина − 2·bottomInset)
                фасад 146.4 × 338   (=гео − 2·edge, fine 0.1)
     Правила inset: проём секции = ячейка − 2·panel (секция несёт СВОИ
       стойки + 2 планки); короб = проём − clearance (26); фасад В
       РАЗМЕР ПРОЁМА СЕКЦИИ минус fGap* (внутренний).
     3D inset (ИСПРАВЛЕНО по рендеру ПО, image 1/3 эталона 2): фасад
       УТОПЛЕН В ПРОЁМ (передняя грань заподлицо с фронтом деталей,
       cz = pd − panel/2), короб сдвинут назад на panel (за фасад).
     ── mount:'overlay' (НАКЛАДНЫЕ, эталон 2: image 1–8) ──────────
     Эталон 2 (та же геометрия, проект БЕЗ подрезки кромки; сверка
     по деталям, не зависящим от подрезки, сошлась точно):
       СВОИХ СТОЕК И ПЛАНОК НЕТ — короб на всю ширину ячейки,
       «по ширине как полки» (Дали):
         короб = ячейка − clearance      (376−26 = 350 ✓ ЯщикД 348)
         п/з   = короб − 2·panel, БЕЗ −1 (350−32 = 318 ✓ раскрой)
         дно   = короб/глубина − 2·bottomInset (348×548 ✓ точно)
       ФАСАД НАКЛАДНОЙ, перед корпусом (в зоне gapFront — «отступ
       спереди 16»), ПЕРЕКРЫВАЕТ соседние панели:
         гео W = ячейка + 2·fOverhang, fOverhang по умолч. = panel
                 (376+32 = 408 ✓ панель ПО, image 6/7)
         по высоте фасады заполняют зону слотов ЗАПОДЛИЦО с краями,
         межфасадный зазор fGapMid (0.8): 180+0.8+180 = 360.8 ✓
                 (⚠ разбивка 0.4/0.4 на фасад — из одного расчёта)
         раскрой = гео − 2·edge, fine: 178×406 ✓ ТОЧНО как в ПО
       fGapTop/fGapBottom/fGapSide в overlay НЕ участвуют.
       3D: короб передним краем заподлицо с корпусом (pd), фасад
       pd..pd+panel; у детали фасада поле mount='overlay' (для ручки).
     ── Общее ─────────────────────────────────────────────────────
       зона слотов = высота ячейки − secTop − secBottom; делится на
       count долей БЕЗ панелей между (splitSizes, panel=0), heights
       как sizes; слот 1 — НИЖНИЙ (как в ПО); эталоны: 360.8/2=180.4.
     ⚠ ДОПУЩЕНИЯ (осталось сверить):
       inset: fGapTop=30 / fGapBottom=2 — в раскрое видна только
         СУММА 32 (эталон 2 даёт сумму 30.4 при других настройках);
       планки: какая 70 (перед) / 68 (зад) — в ПО обе «Планка_верхняя»;
       overlay fGapMid=0.8 и его разбивка по фасадам.
     Фурнитура: «Направляющие шариковые {boxDepth} мм (компл.)» ×1 на
       ящик (комплект = 2 планки), висит на левой боковине → summary.
     Имена (маппинг на имена ПО — в даунстрим-отображении):
       ЯщикБЛ/ЯщикБП → «ЯщикБ», ЯщикП/ЯщикЗ → «ЯщикП»,
       ЯщикД → «ЯщикД», ЯщикФ → «Фасад_Модерн».
  ============================================================ */
  function buildDrawers(node, cell, ctx, parts) {
    function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
    var panel = ctx.panel, pd = ctx.partDepth;
    var edge = num(ctx.edge, 1);
    var count = node.count | 0;
    if (count <= 0) return;
    var mount = node.mount === 'overlay' ? 'overlay' : 'inset';
    var secTop = num(node.secTop, 0), secBottom = num(node.secBottom, 0);
    var boxDepth = num(node.boxDepth, 550);
    var topOffset = num(node.topOffset, 50), bottomOffset = num(node.bottomOffset, 20);
    var bottomThick = num(node.bottomThick, 3), bottomInset = num(node.bottomInset, 1);
    var clearance = num(node.clearance, 26);
    var railFront = num(node.railFront, 70), railBack = num(node.railBack, 68);
    var fGapTop = num(node.fGapTop, 30), fGapBottom = num(node.fGapBottom, 2);
    var fGapSide = num(node.fGapSide, 2);
    var fGapMid = num(node.fGapMid, 0.8);       // overlay: межфасадный зазор
    var fOverhang = num(node.fOverhang, panel); // overlay: перекрытие соседей

    var cellH = cell.y1 - cell.y0;
    var cellW = cell.x1 - cell.x0;
    var cx = (cell.x0 + cell.x1) / 2;
    // inset: проём между СВОИМИ стойками; overlay: вся ячейка (стоек нет)
    var opening = mount === 'inset' ? cellW - 2 * panel : cellW;
    var boxW = opening - clearance;             // короб по ширине
    // inset: короб утоплен за фасад (image 1/3); overlay: заподлицо с pd
    var boxFrontZ = mount === 'inset' ? pd - panel : pd;
    var s = ++ctx.counters.drawerSec;

    if (mount === 'inset') {
      // ── Стойки секции (2 шт), кромка — передний торец ──────────
      var post = function (name, pcx) {
        return mkPart({
          name: name, kind: 'dpost', material: 'ldsp', thick: panel,
          cutL: cellH, cutW: pd + edge,            // 580: нет задней подрезки
          edges: [{ side: 'front', len: cellH }],
          box: { cx: pcx, cy: (cell.y0 + cell.y1) / 2, cz: cell.z, dx: panel, dy: cellH, dz: pd }
        });
      };
      parts.push(post('ЯСтойка_левая_' + s, cell.x0 + panel / 2));
      parts.push(post('ЯСтойка_правая_' + s, cell.x1 - panel / 2));

      // ── Планки верхние (перед/зад), плашмя под верхом ячейки ───
      var rail = function (name, w, rcz) {
        return mkPart({
          name: name, kind: 'drail', material: 'ldsp', thick: panel,
          cutL: opening - 2 * edge, cutW: w,
          edges: [{ side: 'front', len: opening - 2 * edge }],
          box: { cx: cx, cy: cell.y1 - panel / 2, cz: rcz, dx: opening, dy: panel, dz: w }
        });
      };
      parts.push(rail('ЯПланка_перед_' + s, railFront, pd - railFront / 2));
      parts.push(rail('ЯПланка_зад_' + s, railBack, railBack / 2));
    }

    // ── Слоты (снизу вверх) и ящики ──────────────────────────────
    var zoneY0 = cell.y0 + secBottom, zoneY1 = cell.y1 - secTop;
    var slots = splitSizes(node.heights, count, zoneY1 - zoneY0, 0, 0);
    var ycur = zoneY0, i, slotH, k, bY0, bY1, bH, geomW, geomH, fY0, fY1;
    for (i = 0; i < count; i++) {
      slotH = slots[i];
      k = ++ctx.counters.drawer;
      bY0 = ycur + bottomOffset;                   // низ короба в слоте
      bY1 = ycur + slotH - topOffset;              // верх короба
      bH = bY1 - bY0;

      // Боковины ×2: длина = глубина короба − подрезка,
      // высота − подрезка под кромку (эталон 109.4 → раскрой 109)
      var side = function (name, scx) {
        return mkPart({
          name: name, kind: 'dside', material: 'ldsp', thick: panel,
          cutL: boxDepth - edge, cutW: bH - edge,
          edges: [{ side: 'top', len: boxDepth - edge }],
          box: { cx: scx, cy: (bY0 + bY1) / 2, cz: boxFrontZ - boxDepth / 2, dx: panel, dy: bH, dz: boxDepth }
        });
      };
      parts.push(side('ЯщикБЛ_' + k, cx - (boxW - panel) / 2));
      parts[parts.length - 1].hardware = [
        { name: 'Направляющие шариковые ' + boxDepth + ' мм (компл.)', qty: 1 }
      ];
      parts.push(side('ЯщикБП_' + k, cx + (boxW - panel) / 2));

      // Перед / Зад: между боковинами.
      // inset: −1 (посадка, эталон 1: 285); overlay: РОВНО (эталон 2: 318)
      // frontDrop: перед НИЖЕ зада на N мм (заказы 104/98: строго 20 на
      // 5 независимых ящиках; причина ⚠ не выяснена — дефолт 0).
      var fDrop = num(node.frontDrop, 0);
      var fbCut = boxW - 2 * panel - (mount === 'inset' ? edge : 0);
      var fb = function (name, fkind, fcz, drop) {
        return mkPart({
          name: name, kind: fkind, material: 'ldsp', thick: panel,
          cutL: fbCut, cutW: bH - edge - (drop || 0),
          edges: [{ side: 'top', len: fbCut }],
          box: { cx: cx, cy: (bY0 + bY1) / 2 - (drop || 0) / 2, cz: fcz, dx: boxW - 2 * panel, dy: bH - (drop || 0), dz: panel }
        });
      };
      parts.push(fb('ЯщикП_' + k, 'dfront', boxFrontZ - panel / 2, fDrop));
      parts.push(fb('ЯщикЗ_' + k, 'dback', boxFrontZ - boxDepth + panel / 2, 0));

      // Дно ХДФ: накладное снизу короба, отступ по краям bottomInset
      parts.push(mkPart({
        name: 'ЯщикД_' + k, kind: 'dbottom', material: 'hdf', thick: bottomThick,
        cutL: boxW - 2 * bottomInset, cutW: boxDepth - 2 * bottomInset,
        edges: [],
        box: {
          cx: cx, cy: bY0 - bottomThick / 2, cz: boxFrontZ - boxDepth / 2,
          dx: boxW - 2 * bottomInset, dy: bottomThick, dz: boxDepth - 2 * bottomInset
        }
      }));

      // Фасад: раскрой = гео − 2·edge, точность 0.1 (fine), кромка 4 ст.
      if (mount === 'inset') {
        // в размер ПРОЁМА СЕКЦИИ минус fGap*, УТОПЛЕН В ПРОЁМ:
        // передняя грань заподлицо с фронтом деталей (image 1/3)
        geomW = opening - 2 * fGapSide;
        geomH = slotH - fGapTop - fGapBottom;
        fY0 = ycur + fGapBottom;
      } else {
        // НАКЛАДНОЙ: перекрывает соседние панели по ширине; по высоте
        // фасады заполняют зону заподлицо, между ними fGapMid (эталон 2)
        geomW = cellW + 2 * fOverhang;
        fY0 = ycur + (i > 0 ? fGapMid / 2 : 0);
        fY1 = ycur + slotH - (i < count - 1 ? fGapMid / 2 : 0);
        geomH = fY1 - fY0;
      }
      parts.push(mkPart({
        name: 'ЯщикФ_' + k, kind: 'dfacade', material: 'ldsp', thick: panel, fine: true,
        cutL: geomH - 2 * edge, cutW: geomW - 2 * edge,
        edges: [
          { side: 'top', len: geomW - 2 * edge },
          { side: 'bottom', len: geomW - 2 * edge },
          { side: 'left', len: geomH - 2 * edge },
          { side: 'right', len: geomH - 2 * edge }
        ],
        box: {
          cx: cx, cy: fY0 + geomH / 2,
          cz: mount === 'inset' ? pd - panel / 2 : pd + panel / 2,
          dx: geomW, dy: geomH, dz: panel
        }
      }));
      parts[parts.length - 1].mount = mount;
      ycur += slotH;
    }
  }

  /* ============================================================
     buildSection — рекурсивный обход ДЕРЕВА СЕКЦИЙ.
     Делит одну ячейку cell и плодит детали наполнения в parts.

     cell — прямоугольная ячейка в осях сцены (Z фиксирован):
       { x0,x1, y0,y1, z }  — внутренние грани (проём) по X и Y.
     ctx — общий контекст: { panel, partDepth, counters:{shelf,panel} }
       counters дают сквозную нумерацию Полка_N / Перегородка_N в порядке обхода.

     Правила (выверены на реальном эталоне из ПО, шкаф-стеллаж 800×2000×600):
       panels: sub = (cellW − N·panel)/(N+1); перегородка режется в высоту ячейки.
       shelves: sub = (cellH − N·panel)/(N+1); полка режется в ширину ячейки.
     Эталон воспроизводится: корень panels(1)→376/376; лево shelves(2)→612×3
     (в средней 612-ячейке panels(1)→180/180 = короткая Вертикальная 612);
     право shelves(4)→360.8×5. Итог: Полка 376 ×6, Вертикальная 1868 ×1, 612 ×1.

     ⚠ ЭТАП D — ПО СТАНДАРТУ (решение Дали, эталона image 5/7 нет):
     у узла shelves флаги bottomShelf / topShelf добавляют ГРАНИЧНЫЕ
     полки: bottomShelf лежит НА низу ячейки, topShelf — ПОД верхом.
     Зона проёмов сжимается на panel за каждый флаг; число проёмов
     (count+1) и children НЕ меняются. Граничная полка — обычная
     Полка_N (та же ширина ячейки, кромка перёд, сквозной счётчик);
     порядок нумерации: нижняя → промежуточные снизу вверх → верхняя.
     Типовые случаи: полка над ящиками, антресольная, фальш-дно.
  ============================================================ */
  function buildSection(node, cell, ctx, parts) {
    if (!node) return;
    var panel = ctx.panel, pd = ctx.partDepth;
    var cellW = cell.x1 - cell.x0;
    var cellH = cell.y1 - cell.y0;
    var N = node.count;
    var children = node.children || [];
    var slots = N + 1, sizes, s, sc = [];

    if (node.type === 'rod') {
      // ЛИСТ-СУЩНОСТЬ: штанга занимает ячейку целиком, детей нет.
      buildRod(node, cell, ctx, parts);
      return;
    }
    if (node.type === 'drawers') {
      // ЛИСТ-СУЩНОСТЬ: секция с ящиками занимает ячейку целиком.
      buildDrawers(node, cell, ctx, parts);
      return;
    }
    if (node.type === 'facade') {
      // ЛИСТ-СУЩНОСТЬ: створки закрывают ячейку целиком, детей нет.
      buildCellFacade(node, cell, ctx, parts);
      return;
    }
    if (node.type === 'panels') {
      // N вертикальных перегородок делят ШИРИНУ на slots долей (sizes или поровну).
      // Каждая перегородка режется РОВНО в высоту ячейки.
      sizes = splitSizes(node.sizes, slots, cellW, N, panel);
      var xcur = cell.x0;
      for (s = 0; s < slots; s++) {
        var w = sizes[s];
        sc.push({ x0: xcur, x1: xcur + w, y0: cell.y0, y1: cell.y1, z: cell.z });
        xcur += w;
        if (s < N) {
          ctx.counters.panel++;
          parts.push(mkPart({
            name: 'Перегородка_' + ctx.counters.panel, kind: 'partition',
            material: 'ldsp', thick: panel,
            cutL: cellH, cutW: pd,
            edges: [{ side: 'front', len: cellH }],
            box: {
              cx: xcur + panel / 2, cy: (cell.y0 + cell.y1) / 2, cz: cell.z,
              dx: panel, dy: cellH, dz: pd
            }
          }));
          xcur += panel;
        }
      }
    } else if (node.type === 'shelves') {
      // N горизонтальных полок делят ВЫСОТУ на slots долей (sizes или поровну).
      // Каждая полка режется РОВНО в ширину ячейки. Доли снизу вверх.
      // mkShelf(yBottom) — полка с нижней гранью на yBottom (общая фабрика
      // для промежуточных и граничных полок этапа D).
      // Глубина полки = pd − shelfDepthOffset (сверка 98: полка мельче
      // корпуса; дефолт 0). Полка прижата к ЗАДНЕЙ стенке — отступ спереди.
      var shOff = ctx.shelfDepthOffset || 0;
      var shPd = pd - shOff;
      var mkShelf = function (yBottom) {
        ctx.counters.shelf++;
        parts.push(mkPart({
          name: 'Полка_' + ctx.counters.shelf, kind: 'shelf',
          material: 'ldsp', thick: panel,
          cutL: cellW, cutW: shPd,
          edges: [{ side: 'front', len: cellW }],
          box: {
            cx: (cell.x0 + cell.x1) / 2, cy: yBottom + panel / 2, cz: cell.z - shOff / 2,
            dx: cellW, dy: panel, dz: shPd
          }
        }));
      };
      // ⚠ ЭТАП D (по стандарту): граничные полки сжимают зону проёмов.
      var zy0 = cell.y0, zy1 = cell.y1;
      if (node.bottomShelf) { mkShelf(zy0); zy0 += panel; }
      if (node.topShelf) zy1 -= panel;
      sizes = splitSizes(node.sizes, slots, zy1 - zy0, N, panel);
      var ycur = zy0;
      for (s = 0; s < slots; s++) {
        var h = sizes[s];
        sc.push({ x0: cell.x0, x1: cell.x1, y0: ycur, y1: ycur + h, z: cell.z });
        ycur += h;
        if (s < N) {
          mkShelf(ycur);
          ycur += panel;
        }
      }
      if (node.topShelf) mkShelf(zy1);
    } else {
      return; // неизвестный тип — молча игнор (лист)
    }
    // Рекурсия в под-ячейки (по одной на дочерний узел; отсутствующий = null)
    for (s = 0; s < sc.length; s++) buildSection(children[s] || null, sc[s], ctx, parts);
  }

  /* ============================================================
     buildFacades — накладные фасады (створки) на фронт корпуса.
     Плодит детали 'facade' в parts. Не режет корпус — фасады лежат
     ПЕРЕД ним в зоне gapFront (накладные, перекрывают торцы).

     Зона фасадов берётся от ЗАДАННЫХ размеров шкафа (не корпуса):
       по X — полная ширина c.width, центр в 0 → [−W/2, +W/2];
       по Y — от gapBottom (над цоколем) до height−gapTop.
     Ширина делится на N слотов (fc.sizes или поровну, БЕЗ физического
     разделителя — зазор между створками = gapRight[i] + gapLeft[i+1]).
     В каждом слоте створка утоплена: geomW = slot−gapLeft−gapRight.
     Раскрой = геометрия − 2·edge (подрезка/кромка по периметру).
     Кромка — все 4 стороны (фасад окромлён по кругу).

     Проверено на эталоне (800×2000, N=2, gapTop2/gapBottom101/
     gapLeft1/gapRight1, edge1): geomH=1897→cut 1895; slot=400,
     geomW=398→cut 396. Итог: Фасад 1895×396 ×2.
     opening[i] ('right'|'left') хранится у детали — сторона петель/ручки.
  ============================================================ */
  function buildFacades(fc, c, cz, parts) {
    var N = fc.count | 0;
    if (N <= 0) return;
    var edge = c.edge;
    var thick = (typeof fc.thick === 'number') ? fc.thick : c.panel;
    var gT = fc.gapTop || 0, gB = fc.gapBottom || 0;
    var gL = fc.gapLeft || 0, gR = fc.gapRight || 0;
    var mat = fc.material || 'ldsp';
    var opening = fc.opening || [];

    var zoneW = c.width;                 // полная ширина шкафа (эталон 800)
    var zoneY0 = gB;                     // низ фасадной зоны (над цоколем)
    var zoneY1 = c.height - gT;          // верх фасадной зоны
    var geomH = zoneY1 - zoneY0;         // 1897
    var cutH = geomH - 2 * edge;         // 1895
    var cyF = (zoneY0 + zoneY1) / 2;     // центр по высоте

    // Ширины слотов (без панелей между: panel=0) — sizes или поровну
    var slotW = splitSizes(fc.sizes, N, zoneW, 0, 0);
    var xcur = -zoneW / 2, i, sw, geomW, cutW, gcx;
    for (i = 0; i < N; i++) {
      sw = slotW[i];
      geomW = sw - gL - gR;              // 398
      cutW = geomW - 2 * edge;           // 396
      gcx = xcur + gL + geomW / 2;       // центр створки в утопленном слоте
      parts.push(mkPart({
        name: 'Фасад_' + (i + 1), kind: 'facade',
        material: mat, thick: thick, fine: true,
        cutL: cutH, cutW: cutW,
        edges: [
          { side: 'top', len: cutW },
          { side: 'bottom', len: cutW },
          { side: 'left', len: cutH },
          { side: 'right', len: cutH }
        ],
        box: { cx: gcx, cy: cyF, cz: cz, dx: geomW, dy: geomH, dz: thick }
      }));
      // сторона петель/ручки для схемы и 3D (панель-геометрию не меняет)
      parts[parts.length - 1].opening = opening[i] || (i === 0 ? 'right' : 'left');
      xcur += sw;
    }
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

    // Глубина всех деталей корпуса. По РЕАЛЬНОМУ раскрою — 579 (не 580).
    // Правило: реальная − 2·кромка (подрезка спереди + сзади/зазор).
    //   581 − 2·1 = 579. (Раньше было −1·edge=580 — ошибка без раскроя.)
    var partDepth = depthReal - 2 * edge;                  // 579

    // Чистовая внутренняя высота проёма (между накладными крышей и дном).
    // Именно она делится полками/перегородками. = корпус − крыша − дно.
    var clearH = corpusH - c.panel - c.panel;              // 1868
    // Раскрой СТОЙКИ на 1 мм короче проёма (подрезка), тогда как внутренняя
    // перегородка режется РОВНО в проём (1868). Подтверждено раскроем:
    //   Стойка_левая/правая = 1867, Вертикальная = 1868.
    var sideCutH = clearH - edge;                          // 1867
    // Крыша/дно: накладные, во всю ширину, минус подрезка с двух торцов.
    //   798 = corpusW − 2·edge
    var topLen = corpusW - 2 * edge;                       // 798
    var topDepth = partDepth;                              // 579

    var parts = [];

    // ── Стойки (2 шт: левая, правая) ────────────────────────────
    // Плоскость стойки — YZ (толщина по X). Раскрой: 1867 x 579.
    // Кромка стойки: только передний вертикальный торец.
    // Раскрой (sideCutH=1867) на 1 мм меньше геометрического проёма
    // (clearH=1868) — подтверждено раскроем. В 3D деталь занимает весь проём.
    // extra — напуск глубины ПОД СТЕНУ (sideExtraLeft/Right, сверка 98):
    // только в раскрой (cutW), 3D-box не трогаем.
    function sidePart(name, cx, extra) {
      return mkPart({
        name: name, kind: 'side', material: 'ldsp', thick: c.panel,
        cutL: sideCutH, cutW: partDepth + (extra || 0),
        edges: [{ side: 'front', len: sideCutH }],
        box: {
          cx: cx, cy: c.legs + c.panel + clearH / 2, cz: partDepth / 2,
          dx: c.panel, dy: clearH, dz: partDepth
        }
      });
    }
    // Левая стойка: внешний левый край корпуса на X = −corpusW/2
    var xL = -corpusW / 2 + c.panel / 2;
    var xR = corpusW / 2 - c.panel / 2;
    parts.push(sidePart('Стойка_левая', xL, c.sideExtraLeft));
    parts.push(sidePart('Стойка_правая', xR, c.sideExtraRight));

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
    // НАКЛАДНАЯ: закрывает почти весь корпус сзади (не вкладывается
    // во внутренний проём). По раскрою ХДФ = 1898 × 798, где
    //   1898 = corpusH − 2·edge,  798 = corpusW − 2·edge
    // (1 мм зазора с каждой стороны). Не кромится. Толщина back(3) по Z.
    var backH = corpusH - 2 * edge;                        // 1898
    var backW = corpusW - 2 * edge;                        // 798
    parts.push(mkPart({
      name: 'Задняя стенка', kind: 'back', material: 'hdf', thick: c.back,
      cutL: backH, cutW: backW,
      edges: [],
      box: {
        cx: 0, cy: c.legs + corpusH / 2, cz: c.back / 2,
        dx: backW, dy: backH, dz: c.back
      }
    }));

    // ── НАПОЛНЕНИЕ: дерево секций ИЛИ легаси плоские полки/перегородки ──
    // innerW — чистовой проём между стойками (общий для обоих путей).
    var innerW = corpusW - 2 * c.panel;            // 768 — проём между стойками
    var shelfLen = innerW;                          // полка во всю ширину проёма
    var openingH = null;           // высота проёма (только легаси-полки)
    var partitionOpeningW = null;  // ширина секции (только легаси-перегородки)

    if (c.sections) {
      // ── Дерево секций (рекурсия) ──────────────────────────────
      // Корневая ячейка = чистовой проём корпуса:
      //   по X — между внутренними гранями стоек (±innerW/2),
      //   по Y — от верха дна до низа крыши (высота = clearH = 1868).
      var ctx = { panel: c.panel, partDepth: partDepth, edge: edge, shelfDepthOffset: c.shelfDepthOffset || 0, counters: { shelf: 0, panel: 0, rod: 0, drawerSec: 0, drawer: 0, cfacade: 0 } };
      var rootCell = {
        x0: -innerW / 2, x1: innerW / 2,
        y0: c.legs + c.panel,               // верх дна
        y1: c.legs + corpusH - c.panel,     // низ крыши (clearH выше дна)
        z: partDepth / 2
      };
      buildSection(c.sections, rootCell, ctx, parts);

    } else {
      // ── ЛЕГАСИ: плоские полки (во всю ширину) ─────────────────
      // N полок делят clearH на N+1 РАВНЫХ проёмов:
      //   высота проёма = (clearH − N·panel)/(N+1). N=4→360.8; N=2→612.
      // Полка режется РОВНО в проём между стойками (shelfLen=768),
      // кромка только передний торец. Эквивалентно корневому shelves-узлу.
      var shelfCount = c.shelfCount;
      if (shelfCount > 0) {
        var shOffL = c.shelfDepthOffset || 0;
        openingH = (clearH - shelfCount * c.panel) / (shelfCount + 1);
        var yCursor = c.legs + c.panel; // верх дна
        for (var si = 1; si <= shelfCount; si++) {
          yCursor += openingH;
          parts.push(mkPart({
            name: 'Полка_' + si, kind: 'shelf', material: 'ldsp', thick: c.panel,
            cutL: shelfLen, cutW: partDepth - shOffL,
            edges: [{ side: 'front', len: shelfLen }],
            box: {
              cx: 0, cy: yCursor + c.panel / 2, cz: (partDepth - shOffL) / 2,
              dx: shelfLen, dy: c.panel, dz: partDepth - shOffL
            }
          }));
          yCursor += c.panel;
        }
      }

      // ── ЛЕГАСИ: плоские перегородки (во всю высоту) ────────────
      // N перегородок делят innerW на N+1 РАВНЫХ секций:
      //   ширина секции = (innerW − N·panel)/(N+1). N=1→376.
      // Перегородка режется РОВНО в проём: cutL = clearH = 1868.
      // Эквивалентно корневому panels-узлу.
      var partitionCount = c.partitionCount;
      if (partitionCount > 0) {
        partitionOpeningW = (innerW - partitionCount * c.panel) / (partitionCount + 1);
        var xCursor = -innerW / 2;                   // внутренняя грань левой стойки
        for (var pi = 1; pi <= partitionCount; pi++) {
          xCursor += partitionOpeningW;
          parts.push(mkPart({
            name: 'Перегородка_' + pi, kind: 'partition', material: 'ldsp', thick: c.panel,
            cutL: clearH, cutW: partDepth,
            edges: [{ side: 'front', len: clearH }],
            box: {
              cx: xCursor + c.panel / 2, cy: c.legs + c.panel + clearH / 2, cz: partDepth / 2,
              dx: c.panel, dy: clearH, dz: partDepth
            }
          }));
          xCursor += c.panel;
        }
      }
    }

    // ── ФАСАДЫ (накладные створки) ──────────────────────────────
    // Кладём ПЕРЕД корпусом: задняя грань фасада у переднего торца
    // деталей корпуса (Z = partDepth), фасад занимает зону gapFront.
    if (c.facades) buildFacades(c.facades, c, partDepth + (typeof c.facades.thick === 'number' ? c.facades.thick : c.panel) / 2, parts);

    // ── Сводка ──────────────────────────────────────────────────
    var edgeTotal = 0, areaLdsp = 0, areaHdf = 0, hardware = {};
    for (var i = 0; i < parts.length; i++) {
      edgeTotal += partEdgeLen(parts[i]);
      if (parts[i].hardware) {
        for (var hi = 0; hi < parts[i].hardware.length; hi++) {
          var hw = parts[i].hardware[hi];
          hardware[hw.name] = (hardware[hw.name] || 0) + hw.qty;
        }
      }
      if (parts[i].material === 'metal') continue; // фурнитура/металл — не в м²
      var a = parts[i].cutL * parts[i].cutW / 1e6; // м²
      if (parts[i].material === 'hdf') areaHdf += a; else areaLdsp += a;
    }

    return {
      parts: parts,
      derived: {
        corpusH: corpusH, corpusW: corpusW,
        depthReal: depthReal, partDepth: partDepth,
        clearH: clearH, sideCutH: sideCutH, topLen: topLen,
        shelfLen: shelfLen, openingH: openingH,
        partitionOpeningW: partitionOpeningW
      },
      summary: {
        partCount: parts.length,
        edgeLenMm: Math.round(edgeTotal),
        edgeLenM: Math.round(edgeTotal) / 1000,
        areaLdspM2: Math.round(areaLdsp * 1000) / 1000,
        areaHdfM2: Math.round(areaHdf * 1000) / 1000,
        hardware: hardware
      }
    };
  }

  var API = {
    DEFAULTS: DEFAULTS,
    buildCarcass: buildCarcass,
    buildSection: buildSection,
    buildFacades: buildFacades,
    buildCellFacade: buildCellFacade,
    buildRod: buildRod,
    buildDrawers: buildDrawers,
    partEdgeLen: partEdgeLen,
    splitSizes: splitSizes
  };

  // Экспорт: и как модуль node, и как глобал для браузера
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.WardrobeCore = API;

})(typeof globalThis !== 'undefined' ? globalThis : this);
