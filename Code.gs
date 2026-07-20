// ============================================================
// MebelOFF — Code.gs v2.3 (цены + СРМ-заказы + авто-слоты + автобэкап + SKU)
// ============================================================
// Что нового относительно v2.2:
//   • v3.4 SKU: колонка "Артикул" в листах Фурнитура (F), Кухня (E),
//     Шкаф (F) → поле sku. Колонка В КОНЦЕ листа, заполнять не
//     обязательно (пусто → sku=''). Стабильный идентификатор позиции
//     для снимков заказов и будущего Склада v4.
// Что нового относительно v2.1:
//   • dailyBackup() — суточная копия всей таблицы в папку Диска
//     "MebelOFF Бэкапы", хранятся последние 14 копий. Запускается
//     триггером по времени (см. инструкцию), деплой для этого НЕ нужен.
// Что нового относительно v2:
//   • Лист "Шкаф" (Категория|Вид|Фирма|Цена|Авто) — фурнитура шкафа
//     теперь идёт с таблицы, а не из запасного списка в main.js.
//     Пустые строки листа отфильтровываются.
//   • Колонка "Авто" в листах Фурнитура (E), Кухня (D), Шкаф (E):
//     число = сколько слотов этой позиции стоит в разделе автоматом.
//     Отдаётся полем auto (0, если пусто).
// Что нового относительно v1:
//   • doPost — запись заказов с сайта (лист "Заказы", ключ — № заказа).
//     Лист создаётся автоматически при первом обращении.
//   • doGet?action=orders — список заказов (без снимков, быстрый).
//   • doGet?action=order&num=N — один заказ со снимком расчёта.
//   • Лист "Изменения" — доп. соглашения к договору:
//     doGet?action=changes, doPost addChange/delChange (±сумма двигает
//     Согл. цену и Долг; Аванс и Оплачено не трогаются).
//   Обычный doGet (без action) работает КАК РАНЬШЕ — цены для сайта.
//
// ⚠️ После вставки этого кода — ОБЯЗАТЕЛЬНО новый деплой
//    (Развернуть → Управление развёртываниями → карандаш → Новая версия).
// ⚠️ CRM_TOKEN ниже должен совпадать с TOKEN в crm.js на сайте.
// ============================================================

var CRM_TOKEN = '2026';
var ORDERS_SHEET = 'Заказы';
// Колонки листа "Заказы" (порядок менять нельзя — код ссылается по номерам):
// Маржа (margL/P/K чернового расчёта + margin договора) добавлена В КОНЦЕ,
// ПОСЛЕ снимка — иначе сдвинулись бы snap1/2/3 и hideColumns(snap1,3).
// v4.1: masterId/helperId/helperPay добавлены В КОНЦЕ, после clientKey —
// снова ничего не сдвигают (snap1-3, hideColumns, earn* остаются на местах).
// ⚠️ Если лист старый — заголовки 30-32 («Мастер», «Помощник», «Помощнику ₸»)
// дописать руками (или один раз стереть строку заголовка — сервер её пересоздаст).
// v4.1.1: material (33) — выбор материала ДО договора ('L'/'P'/'K'), делается
// в карточке заказа (три плашки). После договора берётся по факту (какой из
// totL/P/K совпал с sogl), это поле НЕ трогается сохранением договора.
var ORDERS_HEADER = ['№','Статус','Город','Клиент','Телефон','Адрес/Объект','Тип мебели','Примечание',
  'Предв. цена','Согл. цена','Аванс','Оплачено','Долг','Дата договора','Дата установки',
  'Итог ЛДСП','Итог Плёнка','Итог Краска','Обновлён','Снимок1','Снимок2','Снимок3',
  'Маржа ЛДСП','Маржа Плёнка','Маржа Краска','Маржа договора','Заработок мастера','Заработок дизайнера','Ключ клиента',
  'Мастер','Помощник','Помощнику ₸','Материал','Источник'];
// Индексы (1-based)
var COL = { num:1, status:2, city:3, client:4, phone:5, obj:6, furn:7, note:8,
  pred:9, sogl:10, avans:11, paid:12, debt:13, dogDate:14, mountDate:15,
  totL:16, totP:17, totK:18, updated:19, snap1:20, snap2:21, snap3:22,
  margL:23, margP:24, margK:25, margin:26, earnMaster:27, earnDesigner:28, clientKey:29,
  masterId:30, helperId:31, helperPay:32, material:33, source:34 };
// v4.11: Источник лида — фиксированный набор (реклама/сарафан/партнёр),
// без суб-полей (какой именно партнёр и т.п.) — Дали сознательно сузил
// до «просто знать, откуда идёт поток», без будущей комиссии.
var LEAD_SOURCES = ['Реклама', 'Сарафан', 'Партнёр'];

// ── Лист "Финансы": каждый приход/расход отдельной строкой ──
var FIN_SHEET = 'Финансы';
var FIN_HEADER = ['id','Дата','Тип','Категория','Сумма','№ заказа','Комментарий','Создан','op_id'];
var FCOL = { id:1, date:2, type:3, cat:4, sum:5, num:6, comment:7, created:8, opid:9 };
// v4.8: op_id — токен идемпотентности от клиента. У старого листа заголовок
// 9-й колонки допиши руками (или сотри строку заголовка — сервер пересоздаст);
// данные пишутся в колонку и без заголовка — как с колонками 30-32 «Заказов».

// ── Лист "Изменения": доп. соглашения к договору ──
// Сумма со знаком: +добавили / −убрали. Каждое изменение сдвигает
// "Согл. цена" заказа (она всегда = актуальная итоговая цена) и
// пересчитывает Долг. Аванс и "Оплачено" НЕ трогаем: изменение цены —
// это изменение обязательства, а не движение денег.
var CH_SHEET = 'Изменения';
// v4.6: колонка "Себестоимость" добавлена В КОНЦЕ (после "Создан") —
// прежние колонки не сдвигаются, старые листы читаются как раньше.
// Пустая ячейка означает «себестоимость неизвестна» и это НЕ то же
// самое, что 0 («изменение — чистая прибыль»): по неизвестным отчёт
// маржи показывает предупреждение, а не считает их бесплатными.
var CH_HEADER = ['id','№ заказа','Дата','Описание','Сумма','Создан','Себестоимость'];
var CHCOL = { id:1, num:2, date:3, desc:4, sum:5, created:6, cost:7 };

// ── Лист "Склад" (v3.6): движения остатков журналом (в стиле "Финансы") ──
// Остаток отдельно НЕ хранится — вычисляется из строк (stockAgg_).
// Кол-во ВСЕГДА целое положительное; знак движения задаёт Тип
// (Приход +, Расход −). Дробный "стоимостный" лист на склад не
// попадает — поэтому остаток всегда целый (проблема "4,75" снята).
// Ключ: SKU (фурнитура/кухня/шкаф) ИЛИ имя материала (ЛДСП/фасады).
var STOCK_SHEET = 'Склад';
var STOCK_HEADER = ['id','Дата','Тип','Ключ','Наименование','Ед','Кол-во','№ заказа','Комментарий','Создан'];
var SCOL = { id:1, date:2, type:3, key:4, name:5, unit:6, qty:7, num:8, comment:9, created:10 };

// ── Лист "Постоянные" (v3.9): шаблоны ежемесячных расходов ──
// Строка = постоянный расход (Аренда офиса, Аренда цеха, оклад из
// "Сотрудников" и т.п.). Начисление за месяц (accrueMonth_) создаёт
// по каждой активной строке проводку "Расход" в листе "Финансы" с
// пометкой месяца — повторное начисление того же месяца не дублирует.
// Оклады сотрудников В ЭТОТ ЛИСТ НЕ дублируются — они начисляются из
// листа "Сотрудники". Здесь — только не-зарплатные постоянные расходы.
var RECUR_SHEET = 'Постоянные';
var RECUR_HEADER = ['id','Название','Категория','Сумма','Активна','Создан'];
var RCOL = { id:1, name:2, cat:3, sum:4, active:5, created:6 };

// ── Лист "Сотрудники" (v3.9): оклады пофамильно ──
// Строка = сотрудник (Имя, Роль: Мастер/Дизайнер, Оклад, Активен).
// Оклад начисляется как постоянный расход (accrueMonth_). Процент с
// заказов НЕ хранится тут — он считается из заработка заказов
// (earnMaster/earnDesigner в листе "Заказы") на стороне сайта.
// v4.1: колонка "Ставка помощника" (helperRate) добавлена В КОНЦЕ листа —
// дефолт суммы, которую сотрудник получает, когда он ПОМОЩНИК в заказе.
// В самом заказе сумму можно переопределить (поле helperPay заказа).
// ⚠️ Старый лист — 7-й заголовок «Ставка помощника» дописать руками.
var EMP_SHEET = 'Сотрудники';
var EMP_HEADER = ['id','Имя','Роль','Оклад','Активен','Создан','Ставка помощника'];
var ECOL = { id:1, name:2, role:3, salary:4, active:5, created:6, helperRate:7 };

// ── Лист "ДопРаботы" (v4.1): разовые доп. работы по заказу ──
// Строка = выплата конкретному сотруднику за доп. работу (сверх процента
// с заказа и оклада). empId — кому платим; сумма — что сотрудник получает.
// Если за доп. работу платит КЛИЕНТ — это отдельно, через лист "Изменения"
// (± Изменение двигает согл. цену и долг). Здесь — только выплата исполнителю.
var DOP_SHEET = 'ДопРаботы';
var DOP_HEADER = ['id','№ заказа','empId','Описание','Сумма','Дата','Создан'];
var DCOL = { id:1, num:2, empId:3, desc:4, sum:5, date:6, created:7 };

// ── Лист "ШаблоныДопРабот" (v4.1.1): типовые названия доп. работ ──
// Простой список названий (доставка, врезка мойки, демонтаж и т.п.) —
// подставляется в поле "Описание" при добавлении доп. работы, чтобы не
// набирать текст руками каждый раз. Общий на все устройства.
var DOPT_SHEET = 'ШаблоныДопРабот';
var DOPT_HEADER = ['id','Название','Создан'];
var DTCOL = { id:1, name:2, created:3 };

// ── Лист "Вложения" (v4.0): фото и заметки к заказам ──
// Файлы НЕ хранятся в таблице (лимит ячейки ~50 тыс. символов) —
// они уходят на Google Диск в папку "MebelOFF Вложения/Заказ №N",
// а в лист пишется только FileId. Тип: 'файл' (есть FileId) или
// 'коммент' (только текст). Удаление строки отправляет файл в
// корзину Диска. v1 принимает только фото (image/*), видео позже.
var ATT_SHEET = 'Вложения';
var ATT_HEADER = ['id','№ заказа','Тип','Имя','FileId','Комментарий','Создан','Клиенту'];
var ACOL = { id:1, num:2, kind:3, name:4, fileId:5, comment:6, created:7, pub:8 };
var ATT_FOLDER = 'MebelOFF Вложения';

// ── Лист "Статусы" (v4.0): журнал переходов заказа по этапам ──
// Строка пишется при КАЖДОЙ смене статуса (создание заказа, сохранение
// расчёта, правка карточки). Подряд одинаковые статусы не дублируются,
// но возврат на прежний этап (А→Б→А) логируется честно. Данные копятся
// с момента деплоя — у старых заказов истории не будет, это нормально.
var SLOG_SHEET = 'Статусы';
var SLOG_HEADER = ['id','№ заказа','Статус','Дата'];
var SLCOL = { id:1, num:2, status:3, date:4 };

// ── Лист "СкладМин" (v4.0): минимальные остатки по позициям ──
// Строка = позиция склада с заданным минимумом. Остаток ниже минимума
// подсвечивается в СРМ и попадает в «Пора докупить». Минимум 0 = снят
// (строка удаляется). Ключ — тот же, что в листе "Склад" (SKU/материал).
// v4.4: колонка "СрокПоставки" (дней) — используется в lead-time
// предупреждении закупки (сравнивается с датой монтажа заказа).
var SMIN_SHEET = 'СкладМин';
var SMIN_HEADER = ['Ключ','Минимум','Обновлён','СрокПоставки'];
var SMINCOL = { key:1, min:2, updated:3, lead:4 };

// ── Лист "Рекламации" (v4.6): гарантийные обращения по сданным заказам ──
// Рекламация — САМОСТОЯТЕЛЬНАЯ сущность, привязанная к заказу по №.
// Заказ при этом НЕ меняет статус и остаётся «Готова»: иначе терялся бы
// факт сдачи, ломалась конверсия и Ø Договор→Установка, а по одному
// заказу нельзя было бы вести две рекламации (через год петля, потом
// столешница). Стадии: Принята → Устраняем → Закрыта.
// Стоимость устранения тут НЕ хранится намеренно — расход пишется
// операцией в лист "Финансы" с № заказа (одна цифра в одном месте).
var RECL_SHEET = 'Рекламации';
var RECL_HEADER = ['id','№ заказа','Дата','Стадия','Описание','Создан'];
var RECLCOL = { id:1, num:2, date:3, stage:4, desc:5, created:6 };
var RECL_STAGES = ['Принята','Устраняем','Закрыта'];

// ── Лист "Задачи" (v4.11): напоминания с дедлайном, привязанные к
// заказу. Без исполнителя (просто текст+дедлайн) и без email —
// «напоминание» пока только бейдж просроченных/сегодняшних в СРМ.
var TASK_SHEET = 'Задачи';
var TASK_HEADER = ['id','№ заказа','Текст','Дедлайн','Выполнена','Создан'];
var TASKCOL = { id:1, num:2, text:3, deadline:4, done:5, created:6 };

function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const callback = e && e.parameter && e.parameter.callback;
  const action = e && e.parameter && e.parameter.action;

  // ── Клиентская страница статуса: работает БЕЗ общего токена СРМ,
  //    по личному ключу конкретного заказа (status.html?o=№&k=ключ).
  //    Отдаёт только безопасный срез: статус, тип мебели, даты.
  if (action === 'clientStatus') {
    return out_(clientStatus_(ss, e.parameter.o, e.parameter.k), callback);
  }

  // ── СРМ: список заказов / один заказ ────────────────────────
  // ⚠️ Чтение заказов защищено токеном: имена, телефоны и суммы клиентов
  //    не должны быть видны любому, кто открыл сайт или знает URL скрипта.
  if (action === 'orders' || action === 'order' || action === 'fin' || action === 'changes' || action === 'stock' || action === 'stockMoves' || action === 'recur' || action === 'employees' || action === 'attach' || action === 'statusLog' || action === 'stockMin' || action === 'dopworks' || action === 'dopTemplates' || action === 'recl' || action === 'archiveOrders' || action === 'tasks') {
    if (String((e.parameter && e.parameter.token) || '') !== CRM_TOKEN) {
      return out_({ ok: false, error: 'нет доступа' }, callback);
    }
    if (action === 'orders')  return out_(ordersList_(ss), callback);
    if (action === 'fin')     return out_(finList_(ss), callback);
    if (action === 'changes') return out_(changesList_(ss), callback);
    if (action === 'stock')      return out_(stockSnapshot_(ss), callback);
    if (action === 'stockMoves') return out_(stockList_(ss), callback);
    if (action === 'recur')      return out_(recurList_(ss), callback);
    if (action === 'employees')  return out_(empList_(ss), callback);
    if (action === 'attach')     return out_(attachList_(ss), callback);
    if (action === 'statusLog')  return out_(statusLogList_(ss), callback);
    if (action === 'stockMin')   return out_(stockMinList_(ss), callback);
    if (action === 'dopworks')   return out_(dopList_(ss), callback);
    if (action === 'dopTemplates') return out_(dopTemplatesList_(ss), callback);
    if (action === 'recl')         return out_(reclList_(ss), callback);
    if (action === 'tasks')        return out_(taskList_(ss), callback);
    // Архив — ленивая загрузка ОТДЕЛЬНОГО файла, вкладка "Заказы" его не трогает.
    if (action === 'archiveOrders') return out_(archiveOrdersList_(getArchiveSpreadsheet_()), callback);
    return out_(orderOne_(ss, e.parameter.num), callback);
  }

  // ── Дальше — прежний код v1 без изменений ───────────────────
  function getSheet(name) {
    const sh = ss.getSheetByName(name);
    if (!sh) return [];
    return sh.getDataRange().getValues().slice(1);
  }

  const ldsp = getSheet('ЛДСП').map(r => ({n: r[0], p: r[1]}));
  const hdf_p = ss.getSheetByName('ЛДСП').getRange('D2').getValue();
  const krom_p = ss.getSheetByName('ЛДСП').getRange('E2').getValue();
  const fas_plen = getSheet('Фасад_Плёнка').map(r => ({n: r[0], p: r[1]}));
  const fas_kr = getSheet('Фасад_Краска').map(r => ({n: r[0], p: r[1]}));
  // v2.1: колонка E "Авто" → поле auto (сколько слотов позиции стоит в разделе автоматом)
  // v2.3: колонка "Артикул" (Фурнитура/Шкаф — F, Кухня — E) → поле sku.
  // Стабильный идентификатор позиции: переживает переименование Вида/Фирмы.
  // Колонка стоит В КОНЦЕ листа — чтение прежних колонок по индексам не сдвигается.
  // Пустая ячейка → sku = '' (позиция без артикула, работает как раньше).
  const furn = getSheet('Фурнитура').map(r => ({cat: r[0], vid: r[1], firm: r[2], p: r[3], auto: Number(r[4]) || 0, sku: String(r[5] == null ? '' : r[5]).trim()}));
  // v2.1: колонка D "Авто" (в Кухне нет колонки Фирма)
  const kuh = getSheet('Кухня').map(r => ({cat: r[0], vid: r[1], p: r[2], auto: Number(r[3]) || 0, sku: String(r[4] == null ? '' : r[4]).trim()}));
  // v2.1: новый лист "Шкаф" — та же схема, что у Фурнитуры (Категория|Вид|Фирма|Цена|Авто).
  // Пустые строки отбрасываем. Если листа ещё нет, getSheet вернёт [] —
  // main.js в этом случае оставит запасной список (проверка на length).
  const shk = getSheet('Шкаф').filter(r => r[0]).map(r => ({cat: r[0], vid: r[1], firm: r[2], p: r[3], auto: Number(r[4]) || 0, sku: String(r[5] == null ? '' : r[5]).trim()}));
  const svet = getSheet('Подсветка').map(r => ({cat: r[0], vid: r[1], p: r[2]}));
  const works = getSheet('Работы').map(r => ({n: r[0], p: r[1]}));

  const vit_sh = ss.getSheetByName('Витрина');
  const vit_rows = vit_sh.getDataRange().getValues().slice(1);
  const steklo = {};
  let profil_uzkiy=2000, profil_shirokiy=3000, ugolok_uzkiy=1500, ugolok_shirokiy=2000;
  let navesh=1000, prisadka=1500, uplotnitel=400;
  vit_rows.forEach(r => {
    const k = r[0], v = r[1];
    if (k.startsWith('Стекло ')) steklo[k.replace('Стекло ','')] = v;
    if (k === 'Профиль узкий') profil_uzkiy = v;
    if (k === 'Профиль широкий') profil_shirokiy = v;
    if (k === 'Уголок узкий') ugolok_uzkiy = v;
    if (k === 'Уголок широкий') ugolok_shirokiy = v;
    if (k === 'Навес') navesh = v;
    if (k === 'Присадка') prisadka = v;
    if (k === 'Уплотнитель') uplotnitel = v;
  });

  const moika = readMoika_(ss);

  const kStol      = readAccSheet_(ss, 'ДопКухня_Столешница', ['tip','cvet']);
  const kSushilka  = readAccSheet_(ss, 'ДопКухня_Сушилка',    ['tip','tip2','firma','cvet']);
  const kTelesk    = readAccSheet_(ss, 'ДопКухня_Телескоп',   ['tip','firma','razmer']);
  const kPetlya    = readAccSheet_(ss, 'ДопКухня_Петля',      ['tip','firma']);
  const kRuchka    = readAccSheet_(ss, 'ДопКухня_Ручка',      ['tip','firma','cvet','razmer']);
  const kNozhki    = readAccSheet_(ss, 'ДопКухня_Ножки',      ['tip','firma','cvet','razmer']);
  const kPodsvetka = readAccSheet_(ss, 'ДопКухня_Подсветка',  ['tip','tip2','cvet','razmer']);
  const kKargo     = readAccSheet_(ss, 'ДопКухня_Карго',      ['tip','firma','razmer']);

  const kPlintus   = readSimpleSheet_(ss, 'ДопКухня_Плинтус');
  const kVytyazhka = readSimpleSheet_(ss, 'ДопКухня_Вытяжка');

  const ldspW = ldsp.map(function(x){ return {name: x.n, price: x.p}; });
  const facadePlenka = fas_plen.map(function(x){ return {name: x.n, price: x.p}; });
  const facadeKraska = fas_kr.map(function(x){ return {name: x.n, price: x.p}; });
  const hdf = hdf_p;
  const edgeThin = krom_p;
  const hingeCatalog = buildHingeCatalog_(furn);
  const slideCatalog = buildSlideCatalog_(furn);

  const data = {
    ldsp, hdf_p, krom_p, fas_plen, fas_kr,
    furn, kuh, shk, svet, works,
    vit: {steklo, profil_uzkiy, profil_shirokiy, ugolok_uzkiy, ugolok_shirokiy, navesh, prisadka, uplotnitel},
    moika,
    kStol, kSushilka, kTelesk, kPetlya, kRuchka, kNozhki, kPodsvetka, kKargo,
    kPlintus, kVytyazhka,
    ldspW, facadePlenka, facadeKraska, hdf, edgeThin, hingeCatalog, slideCatalog
  };

  return out_(data, callback);
}

// ── Единый вывод: JSON или JSONP ─────────────────────────────
function out_(obj, callback) {
  const json = JSON.stringify(obj);
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// СРМ: ЗАПИСЬ (doPost)
// ============================================================
// Сайт шлёт POST с телом-JSON: {token, action, order:{...}}
// Ответ: {ok:true, ...} либо {ok:false, error:'...'}
function doPost(e) {
  var res = { ok: false };
  try {
    // Парсинг и токен — ВНЕ блокировки: им lock не нужен, а держать его
    // на время сетевого разбора запроса незачем (это и было частью очереди).
    var req = JSON.parse(e.postData.contents);
    if (req.token !== CRM_TOKEN) { res.error = 'неверный токен'; return out_(res, null); }
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // addAttach держит свой КОРОТКИЙ lock только вокруг записи строки:
    // тяжёлая загрузка фото на Диск (3-10 сек) идёт БЕЗ блокировки. Раньше
    // общий lock висел всю загрузку → каждое фото ставило в очередь все
    // прочие записи и висли цены/страницы клиентов. Теперь очереди нет.
    if (req.action === 'addAttach') { return out_(addAttach_(ss, req.attach || {}), null); }

    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(20000); // защита от одновременной записи двух запросов
      if (req.action === 'saveOrder')        res = saveOrder_(ss, req.order || {});
      else if (req.action === 'updateOrder') res = updateOrder_(ss, req.order || {});
      else if (req.action === 'createOrder') res = createOrder_(ss, req.order || {});
      else if (req.action === 'addFin')      res = addFin_(ss, req.fin || {});
      else if (req.action === 'delFin')      res = delFin_(ss, req.id);
      else if (req.action === 'addChange')   res = addChange_(ss, req.change || {});
      else if (req.action === 'delChange')   res = delChange_(ss, req.id);
      else if (req.action === 'stockMove')   res = stockMove_(ss, req.stock || {});
      else if (req.action === 'delStockMove') res = delStockMove_(ss, req.id);
      else if (req.action === 'saveStockMin') res = saveStockMin_(ss, req.smin || {});
      else if (req.action === 'delOrder')    res = delOrder_(ss, req.num);
      else if (req.action === 'restoreFromArchive') res = restoreFromArchive_(ss, getArchiveSpreadsheet_(), req.num);
      else if (req.action === 'saveRecur')   res = saveRecur_(ss, req.recur || {});
      else if (req.action === 'delRecur')    res = delRecur_(ss, req.id);
      else if (req.action === 'saveEmp')     res = saveEmp_(ss, req.emp || {});
      else if (req.action === 'delEmp')      res = delEmp_(ss, req.id);
      else if (req.action === 'delAttach')   res = delAttach_(ss, req.id);
      else if (req.action === 'pubAttach')   res = pubAttach_(ss, req.id, req.pub);
      else if (req.action === 'addDop')      res = addDop_(ss, req.dop || {});
      else if (req.action === 'delDop')      res = delDop_(ss, req.id);
      else if (req.action === 'saveDopTemplate') res = saveDopTemplate_(ss, req.tpl || {});
      else if (req.action === 'delDopTemplate')  res = delDopTemplate_(ss, req.id);
      else if (req.action === 'addRecl')      res = addRecl_(ss, req.recl || {});
      else if (req.action === 'updRecl')      res = updRecl_(ss, req.recl || {});
      else if (req.action === 'delRecl')      res = delRecl_(ss, req.id);
      else if (req.action === 'addTask')      res = addTask_(ss, req.task || {});
      else if (req.action === 'toggleTask')   res = toggleTask_(ss, req.id, req.done);
      else if (req.action === 'delTask')      res = delTask_(ss, req.id);
      else if (req.action === 'clientLink')  res = clientLink_(ss, req.num);
      else if (req.action === 'accrueMonth') res = accrueMonth_(ss, req.month);
      else res.error = 'неизвестное действие: ' + req.action;
    } finally {
      try { lock.releaseLock(); } catch (e2) {}
    }
  } catch (err) {
    res = { ok: false, error: String(err) };
  }
  return out_(res, null);
}

// Новый заказ без расчёта (со звонка): № присваивается автоматически = макс. существующий + 1
function createOrder_(ss, o) {
  var sh = ordersSheet_(ss);
  var last = sh.getLastRow();
  var maxN = 0;
  if (last >= 2) {
    var nums = sh.getRange(2, COL.num, last - 1, 1).getValues();
    nums.forEach(function(r){
      var n = parseInt(String(r[0]).replace(/\D/g, ''), 10);
      if (n && n > maxN) maxN = n;
    });
  }
  var num = o.num ? String(o.num) : String(maxN + 1);
  if (findRowByNum_(sh, num) > 0) return { ok: false, error: 'заказ №' + num + ' уже существует' };
  var row = last + 1;
  sh.getRange(row, COL.num).setValue(num);
  sh.getRange(row, COL.status).setValue(o.status || 'Замер');
  if (o.client) sh.getRange(row, COL.client).setValue(o.client);
  if (o.phone)  sh.getRange(row, COL.phone).setValue(o.phone);
  if (o.city)   sh.getRange(row, COL.city).setValue(o.city);
  if (o.furn)   sh.getRange(row, COL.furn).setValue(o.furn);
  if (o.obj)    sh.getRange(row, COL.obj).setValue(o.obj);
  if (o.note)   sh.getRange(row, COL.note).setValue(o.note);
  if (o.source) {
    var srcV0 = String(o.source || '');
    if (LEAD_SOURCES.indexOf(srcV0) >= 0) sh.getRange(row, COL.source).setValue(srcV0);
  }
  sh.getRange(row, COL.updated).setValue(new Date());
  logStatus_(ss, num, o.status || 'Замер');
  return { ok: true, num: num };
}

// ═══════════════ ФИНАНСЫ ═══════════════

function finSheet_(ss) {
  var sh = ss.getSheetByName(FIN_SHEET);
  if (!sh) {
    sh = ss.insertSheet(FIN_SHEET);
    sh.getRange(1, 1, 1, FIN_HEADER.length).setValues([FIN_HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function finList_(ss) {
  var sh = finSheet_(ss);
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, fin: [] };
  var rows = sh.getRange(2, 1, last - 1, FCOL.created).getValues();
  var fin = [];
  rows.forEach(function(r){
    if (r[FCOL.id - 1] === '' && r[FCOL.sum - 1] === '') return;
    fin.push({
      id: String(r[FCOL.id - 1]),
      date: r[FCOL.date - 1], type: String(r[FCOL.type - 1] || ''),
      cat: String(r[FCOL.cat - 1] || ''), sum: Number(r[FCOL.sum - 1]) || 0,
      num: String(r[FCOL.num - 1] || ''), comment: String(r[FCOL.comment - 1] || '')
    });
  });
  return { ok: true, fin: fin };
}

// Изменить "Оплачено" заказа на delta и пересчитать Долг
function bumpOrderPaid_(ss, num, delta) {
  if (!num) return;
  var sh = ordersSheet_(ss);
  var row = findRowByNum_(sh, num);
  if (row < 0) return;
  var paid = (Number(sh.getRange(row, COL.paid).getValue()) || 0) + delta;
  if (paid < 0) paid = 0;
  sh.getRange(row, COL.paid).setValue(paid);
  var sogl = Number(sh.getRange(row, COL.sogl).getValue()) || 0;
  var av   = Number(sh.getRange(row, COL.avans).getValue()) || 0;
  if (sogl > 0) sh.getRange(row, COL.debt).setValue(sogl - av - paid);
}

function addFin_(ss, o) {
  var sum = Number(o.sum) || 0;
  if (sum <= 0) return { ok: false, error: 'сумма должна быть больше нуля' };
  if (o.type !== 'Приход' && o.type !== 'Расход') return { ok: false, error: 'неверный тип операции' };
  var sh = finSheet_(ss);
  // v4.8: идемпотентность — повтор с тем же op_id не создаёт строку.
  // Ретрай из очереди несёт тот же токен — сервер отвечает dup:true без записи.
  var opId = o.opId ? String(o.opId) : '';
  if (opId) {
    var lastR = sh.getLastRow();
    if (lastR >= 2) {
      var ops = sh.getRange(2, FCOL.opid, lastR - 1, 1).getValues();
      for (var oi = 0; oi < ops.length; oi++) {
        if (String(ops[oi][0] || '') === opId) {
          return { ok: true, dup: true, id: String(sh.getRange(2 + oi, FCOL.id).getValue()) };
        }
      }
    }
  }
  var row = sh.getLastRow() + 1;
  var id = String(Date.now());
  sh.getRange(row, FCOL.id).setValue(id);
  sh.getRange(row, FCOL.date).setValue(o.date || new Date());
  sh.getRange(row, FCOL.type).setValue(o.type);
  sh.getRange(row, FCOL.cat).setValue(o.cat || '');
  sh.getRange(row, FCOL.sum).setValue(sum);
  sh.getRange(row, FCOL.num).setValue(o.num ? String(o.num) : '');
  sh.getRange(row, FCOL.comment).setValue(o.comment || '');
  sh.getRange(row, FCOL.created).setValue(new Date());
  if (opId) sh.getRange(row, FCOL.opid).setValue(opId);
  // Доплата по заказу увеличивает "Оплачено" и уменьшает Долг
  if (o.type === 'Приход' && o.cat === 'Доплата' && o.num) bumpOrderPaid_(ss, String(o.num), sum);
  return { ok: true, id: id };
}

function delFin_(ss, id) {
  if (!id) return { ok: false, error: 'нет id операции' };
  var sh = finSheet_(ss);
  var last = sh.getLastRow();
  for (var r = 2; r <= last; r++) {
    if (String(sh.getRange(r, FCOL.id).getValue()) === String(id)) {
      var type = String(sh.getRange(r, FCOL.type).getValue());
      var cat  = String(sh.getRange(r, FCOL.cat).getValue());
      var sum  = Number(sh.getRange(r, FCOL.sum).getValue()) || 0;
      var num  = String(sh.getRange(r, FCOL.num).getValue() || '');
      sh.deleteRow(r);
      if (type === 'Приход' && cat === 'Доплата' && num) bumpOrderPaid_(ss, num, -sum);
      return { ok: true };
    }
  }
  return { ok: false, error: 'операция не найдена (возможно, уже удалена)' };
}

// Аванс договора: одна запись на заказ — повторный договор обновляет её, не дублируя
function upsertAvansFin_(ss, num, sum) {
  var sh = finSheet_(ss);
  var last = sh.getLastRow();
  for (var r = 2; r <= last; r++) {
    if (String(sh.getRange(r, FCOL.cat).getValue()) === 'Аванс' &&
        String(sh.getRange(r, FCOL.num).getValue()) === String(num)) {
      sh.getRange(r, FCOL.sum).setValue(sum);
      sh.getRange(r, FCOL.date).setValue(new Date());
      return;
    }
  }
  var row = last + 1;
  sh.getRange(row, FCOL.id).setValue(String(Date.now()));
  sh.getRange(row, FCOL.date).setValue(new Date());
  sh.getRange(row, FCOL.type).setValue('Приход');
  sh.getRange(row, FCOL.cat).setValue('Аванс');
  sh.getRange(row, FCOL.sum).setValue(sum);
  sh.getRange(row, FCOL.num).setValue(String(num));
  sh.getRange(row, FCOL.comment).setValue('Аванс по договору');
  sh.getRange(row, FCOL.created).setValue(new Date());
}

// ═══════════════ ИЗМЕНЕНИЯ К ДОГОВОРУ (доп. соглашения) ═══════════════

function changesSheet_(ss) {
  var sh = ss.getSheetByName(CH_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CH_SHEET);
    sh.getRange(1, 1, 1, CH_HEADER.length).setValues([CH_HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else {
    // Лист создан до v4.6 — дописываем подпись "Себестоимость".
    // Данные и так пишутся/читаются по номеру колонки CHCOL.cost;
    // это косметика, в try/catch — не должна ронять запись изменения.
    try {
      if (!sh.getRange(1, CHCOL.cost).getValue()) {
        sh.getRange(1, CHCOL.cost).setValue(CH_HEADER[CHCOL.cost - 1]).setFontWeight('bold');
      }
    } catch (e) {}
  }
  return sh;
}

// Все изменения (клиент сам фильтрует по № заказа)
function changesList_(ss) {
  var sh = changesSheet_(ss);
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, changes: [] };
  var rows = sh.getRange(2, 1, last - 1, CHCOL.cost).getValues();
  var changes = [];
  rows.forEach(function(r){
    if (r[CHCOL.id - 1] === '' && r[CHCOL.sum - 1] === '') return;
    var rawCost = r[CHCOL.cost - 1];
    changes.push({
      id: String(r[CHCOL.id - 1]),
      num: String(r[CHCOL.num - 1] || ''),
      date: r[CHCOL.date - 1],
      desc: String(r[CHCOL.desc - 1] || ''),
      sum: Number(r[CHCOL.sum - 1]) || 0,
      // '' = себестоимость не заполнена (старая запись или не знали).
      // Отличать от 0 обязательно: 0 значит «чистая прибыль».
      cost: (rawCost === '' || rawCost === null || rawCost === undefined) ? '' : (Number(rawCost) || 0)
    });
  });
  return { ok: true, changes: changes };
}

// Сдвинуть "Согл. цена" заказа на delta и пересчитать Долг.
// Долг может стать отрицательным — это переплата (карточка покажет её отдельно).
function bumpOrderSogl_(ss, num, delta) {
  var sh = ordersSheet_(ss);
  var row = findRowByNum_(sh, num);
  if (row < 0) return { ok: false, error: 'заказ №' + num + ' не найден' };
  var sogl = Number(sh.getRange(row, COL.sogl).getValue()) || 0;
  if (sogl <= 0) return { ok: false, error: 'по заказу №' + num + ' ещё нет договора — сначала сформируй договор' };
  var next = sogl + delta;
  if (next <= 0) return { ok: false, error: 'итоговая цена не может стать нулевой или отрицательной (сейчас ' + sogl + ')' };
  sh.getRange(row, COL.sogl).setValue(next);
  var av   = Number(sh.getRange(row, COL.avans).getValue()) || 0;
  var paid = Number(sh.getRange(row, COL.paid).getValue()) || 0;
  sh.getRange(row, COL.debt).setValue(next - av - paid);
  sh.getRange(row, COL.updated).setValue(new Date());
  return { ok: true, sogl: next };
}

function addChange_(ss, o) {
  if (!o.num) return { ok: false, error: 'нет № заказа' };
  var sum = Math.round(Number(o.sum) || 0);
  if (!sum) return { ok: false, error: 'сумма изменения не может быть нулём' };
  var desc = String(o.desc || '').trim();
  if (!desc) return { ok: false, error: 'опиши изменение (что добавили или убрали)' };
  var bump = bumpOrderSogl_(ss, String(o.num), sum);
  if (!bump.ok) return bump;
  var sh = changesSheet_(ss);
  var row = sh.getLastRow() + 1;
  // id: время + строка — две записи никогда не получат одинаковый id,
  // даже созданные в одну миллисекунду (delChange удаляет по id).
  var id = String(Date.now()) + '-' + row;
  sh.getRange(row, CHCOL.id).setValue(id);
  sh.getRange(row, CHCOL.num).setValue(String(o.num));
  sh.getRange(row, CHCOL.date).setValue(o.date || new Date());
  sh.getRange(row, CHCOL.desc).setValue(desc);
  sh.getRange(row, CHCOL.sum).setValue(sum);
  sh.getRange(row, CHCOL.created).setValue(new Date());
  // Себестоимость необязательна. Пусто оставляем пустым (не 0!) —
  // отчёт маржи по таким изменениям честно скажет «не знаем».
  // Знак должен совпадать с суммой: убрали позицию за −50000 при
  // себестоимости 35000 → cost = −35000, и маржа падает на 15000.
  if (o.cost !== undefined && o.cost !== null && String(o.cost) !== '') {
    var cost = Math.round(Number(o.cost) || 0);
    if (cost && (cost > 0) !== (sum > 0)) return { ok: false, error: 'себестоимость должна быть того же знака, что и сумма' };
    if (Math.abs(cost) > Math.abs(sum)) return { ok: false, error: 'себестоимость больше суммы изменения — это убыток, проверь цифры' };
    sh.getRange(row, CHCOL.cost).setValue(cost);
  }
  return { ok: true, id: id, sogl: bump.sogl };
}

// Удаление изменения откатывает Согл. цену и Долг симметрично.
// Если откат невозможен (заказ удалён / цена ушла бы в минус) —
// строка НЕ удаляется, чтобы лист и карточка не разошлись.
function delChange_(ss, id) {
  if (!id) return { ok: false, error: 'нет id изменения' };
  var sh = changesSheet_(ss);
  var last = sh.getLastRow();
  for (var r = 2; r <= last; r++) {
    if (String(sh.getRange(r, CHCOL.id).getValue()) === String(id)) {
      var num = String(sh.getRange(r, CHCOL.num).getValue() || '');
      var sum = Number(sh.getRange(r, CHCOL.sum).getValue()) || 0;
      var bump = bumpOrderSogl_(ss, num, -sum);
      if (!bump.ok) return bump;
      sh.deleteRow(r);
      return { ok: true, sogl: bump.sogl };
    }
  }
  return { ok: false, error: 'изменение не найдено (возможно, уже удалено)' };
}

// ═══════════════ РЕКЛАМАЦИИ ═══════════════

function reclSheet_(ss) {
  var sh = ss.getSheetByName(RECL_SHEET);
  if (!sh) {
    sh = ss.insertSheet(RECL_SHEET);
    sh.getRange(1, 1, 1, RECL_HEADER.length).setValues([RECL_HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// Все рекламации (клиент сам фильтрует по № заказа)
function reclList_(ss) {
  var sh = reclSheet_(ss);
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, recl: [] };
  var rows = sh.getRange(2, 1, last - 1, RECLCOL.created).getValues();
  var recl = [];
  rows.forEach(function(r){
    if (r[RECLCOL.id - 1] === '' && r[RECLCOL.desc - 1] === '') return;
    recl.push({
      id: String(r[RECLCOL.id - 1]),
      num: String(r[RECLCOL.num - 1] || ''),
      date: r[RECLCOL.date - 1],
      stage: String(r[RECLCOL.stage - 1] || RECL_STAGES[0]),
      desc: String(r[RECLCOL.desc - 1] || '')
    });
  });
  return { ok: true, recl: recl };
}

// Новая рекламация. Заказ должен существовать, но его статус не трогаем.
function addRecl_(ss, o) {
  if (!o.num) return { ok: false, error: 'нет № заказа' };
  var desc = String(o.desc || '').trim();
  if (!desc) return { ok: false, error: 'опиши рекламацию (на что жалуется клиент)' };
  var oSh = ordersSheet_(ss);
  if (findRowByNum_(oSh, String(o.num)) < 0) return { ok: false, error: 'заказ №' + o.num + ' не найден' };
  var stage = String(o.stage || '').trim();
  if (RECL_STAGES.indexOf(stage) < 0) stage = RECL_STAGES[0];
  var sh = reclSheet_(ss);
  var row = sh.getLastRow() + 1;
  var id = String(Date.now()) + '-' + row;
  sh.getRange(row, RECLCOL.id).setValue(id);
  sh.getRange(row, RECLCOL.num).setValue(String(o.num));
  sh.getRange(row, RECLCOL.date).setValue(o.date || new Date());
  sh.getRange(row, RECLCOL.stage).setValue(stage);
  sh.getRange(row, RECLCOL.desc).setValue(desc);
  sh.getRange(row, RECLCOL.created).setValue(new Date());
  return { ok: true, id: id, stage: stage };
}

// Смена стадии рекламации (кнопка → или перетаскивание на доске).
function updRecl_(ss, o) {
  if (!o.id) return { ok: false, error: 'нет id рекламации' };
  var stage = String(o.stage || '').trim();
  if (RECL_STAGES.indexOf(stage) < 0) return { ok: false, error: 'неизвестная стадия: ' + stage };
  var sh = reclSheet_(ss);
  var last = sh.getLastRow();
  for (var r = 2; r <= last; r++) {
    if (String(sh.getRange(r, RECLCOL.id).getValue()) === String(o.id)) {
      sh.getRange(r, RECLCOL.stage).setValue(stage);
      return { ok: true, stage: stage };
    }
  }
  return { ok: false, error: 'рекламация не найдена (возможно, уже удалена)' };
}

function delRecl_(ss, id) {
  if (!id) return { ok: false, error: 'нет id рекламации' };
  var sh = reclSheet_(ss);
  var last = sh.getLastRow();
  for (var r = 2; r <= last; r++) {
    if (String(sh.getRange(r, RECLCOL.id).getValue()) === String(id)) {
      sh.deleteRow(r);
      return { ok: true };
    }
  }
  return { ok: false, error: 'рекламация не найдена (возможно, уже удалена)' };
}

// ═══════════════ ЗАДАЧИ ═══════════════
// Напоминания с дедлайном, привязанные к заказу. Без исполнителя —
// просто текст+дедлайн. Удаление заказа уносит его задачи каскадом
// (delOrder_) — как Рекламации: задача на несуществующий № была бы
// сиротой и ломала бы открытие карточки из вкладки «Задачи».

function tasksSheet_(ss) {
  var sh = ss.getSheetByName(TASK_SHEET);
  if (!sh) {
    sh = ss.insertSheet(TASK_SHEET);
    sh.getRange(1, 1, 1, TASK_HEADER.length).setValues([TASK_HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// Все задачи (сквозная вкладка + карточка заказа фильтрует по num сама).
function taskList_(ss) {
  var sh = tasksSheet_(ss);
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, tasks: [] };
  var rows = sh.getRange(2, 1, last - 1, TASKCOL.created).getValues();
  var tasks = [];
  rows.forEach(function(r){
    if (r[TASKCOL.id - 1] === '' && r[TASKCOL.text - 1] === '') return;
    tasks.push({
      id: String(r[TASKCOL.id - 1]),
      num: String(r[TASKCOL.num - 1] || ''),
      text: String(r[TASKCOL.text - 1] || ''),
      deadline: r[TASKCOL.deadline - 1],
      done: !!r[TASKCOL.done - 1]
    });
  });
  return { ok: true, tasks: tasks };
}

function addTask_(ss, o) {
  if (!o.num) return { ok: false, error: 'нет № заказа' };
  var text = String(o.text || '').trim();
  if (!text) return { ok: false, error: 'опиши задачу' };
  if (!o.deadline) return { ok: false, error: 'нет дедлайна' };
  var oSh = ordersSheet_(ss);
  if (findRowByNum_(oSh, String(o.num)) < 0) return { ok: false, error: 'заказ №' + o.num + ' не найден' };
  var sh = tasksSheet_(ss);
  var row = sh.getLastRow() + 1;
  var id = String(Date.now()) + '-' + row;
  sh.getRange(row, TASKCOL.id).setValue(id);
  sh.getRange(row, TASKCOL.num).setValue(String(o.num));
  sh.getRange(row, TASKCOL.text).setValue(text);
  sh.getRange(row, TASKCOL.deadline).setValue(o.deadline);
  sh.getRange(row, TASKCOL.done).setValue(false);
  sh.getRange(row, TASKCOL.created).setValue(new Date());
  return { ok: true, id: id };
}

// Отметка выполнена/не выполнена (чекбокс — обе стороны, снятие тоже нужно).
function toggleTask_(ss, id, done) {
  if (!id) return { ok: false, error: 'нет id задачи' };
  var sh = tasksSheet_(ss);
  var last = sh.getLastRow();
  for (var r = 2; r <= last; r++) {
    if (String(sh.getRange(r, TASKCOL.id).getValue()) === String(id)) {
      sh.getRange(r, TASKCOL.done).setValue(!!done);
      return { ok: true, done: !!done };
    }
  }
  return { ok: false, error: 'задача не найдена (возможно, уже удалена)' };
}

function delTask_(ss, id) {
  if (!id) return { ok: false, error: 'нет id задачи' };
  var sh = tasksSheet_(ss);
  var last = sh.getLastRow();
  for (var r = 2; r <= last; r++) {
    if (String(sh.getRange(r, TASKCOL.id).getValue()) === String(id)) {
      sh.deleteRow(r);
      return { ok: true };
    }
  }
  return { ok: false, error: 'задача не найдена (возможно, уже удалена)' };
}

// ═══════════════ УДАЛЕНИЕ ЗАКАЗА ═══════════════
// Удаляет строку "Заказы" (вместе со снимком) и КАСКАДОМ все его
// "Изменения" и "Рекламации" — без заказа они бессмысленны.
// Операции в "Финансах" ОСТАЮТСЯ (деньги реально двигались, касса
// должна сходиться с жизнью), но ОТВЯЗЫВАЮТСЯ от №: номер очищается,
// в комментарий дописывается пометка. Иначе createOrder_ выдаст этот
// № заново (max+1), и старые операции прилипнут к чужому заказу,
// а их позднее удаление уменьшит "Оплачено" уже у нового.
function delOrder_(ss, num) {
  if (!num) return { ok: false, error: 'нет № заказа' };
  var sh = ordersSheet_(ss);
  var row = findRowByNum_(sh, String(num));
  if (row < 0) return { ok: false, error: 'заказ №' + num + ' не найден (возможно, уже удалён)' };
  sh.deleteRow(row);
  var chSh = ss.getSheetByName(CH_SHEET);
  var removed = 0;
  if (chSh) {
    // снизу вверх — индексы строк не съезжают при удалении
    for (var r = chSh.getLastRow(); r >= 2; r--) {
      if (String(chSh.getRange(r, CHCOL.num).getValue()) === String(num)) {
        chSh.deleteRow(r);
        removed++;
      }
    }
  }
  var reclSh = ss.getSheetByName(RECL_SHEET);
  var removedRecl = 0;
  if (reclSh) {
    for (var r3 = reclSh.getLastRow(); r3 >= 2; r3--) {
      if (String(reclSh.getRange(r3, RECLCOL.num).getValue()) === String(num)) {
        reclSh.deleteRow(r3);
        removedRecl++;
      }
    }
  }
  var taskSh = ss.getSheetByName(TASK_SHEET);
  var removedTasks = 0;
  if (taskSh) {
    for (var r4 = taskSh.getLastRow(); r4 >= 2; r4--) {
      if (String(taskSh.getRange(r4, TASKCOL.num).getValue()) === String(num)) {
        taskSh.deleteRow(r4);
        removedTasks++;
      }
    }
  }
  var finSh = ss.getSheetByName(FIN_SHEET);
  var detached = 0;
  if (finSh) {
    for (var r2 = finSh.getLastRow(); r2 >= 2; r2--) {
      if (String(finSh.getRange(r2, FCOL.num).getValue()) === String(num)) {
        finSh.getRange(r2, FCOL.num).setValue('');
        var cmt = String(finSh.getRange(r2, FCOL.comment).getValue() || '');
        finSh.getRange(r2, FCOL.comment).setValue((cmt ? cmt + ' ' : '') + '(был заказ №' + num + ', удалён)');
        detached++;
      }
    }
  }
  return { ok: true, removedChanges: removed, removedRecl: removedRecl, removedTasks: removedTasks, detachedFin: detached };
}

// Лист "Заказы": вернуть, создать при отсутствии
function ordersSheet_(ss) {
  var sh = ss.getSheetByName(ORDERS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(ORDERS_SHEET);
    sh.getRange(1, 1, 1, ORDERS_HEADER.length).setValues([ORDERS_HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.hideColumns(COL.snap1, 3);
  }
  return sh;
}

// Поиск строки по № (колонка 1). Возвращает номер строки или -1.
function findRowByNum_(sh, num) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var vals = sh.getRange(2, COL.num, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) === String(num)) return i + 2;
  }
  return -1;
}

// Сохранение расчёта: upsert по №.
// Новая строка: статус "Расчет", Предв. цена.
// Существующая: обновляем цены/снимок/клиента, НЕ трогаем статус,
// город, телефон, тип мебели, примечание, оплаты — их ведёшь руками.
function saveOrder_(ss, o) {
  if (!o.num) return { ok: false, error: 'нет № заказа' };
  var sh = ordersSheet_(ss);
  var row = findRowByNum_(sh, o.num);
  var isNew = row < 0;

  // v4.11 БАТЧ-ЗАПИСЬ (тот же приём, что updateOrder_ в v4.9): один
  // read-modify-write диапазоном 1-25 вместо ~13 отдельных
  // getRange/setValue. В отличие от updateOrder_, снимки (20-22) тут
  // ВСЕГДА пишутся — поэтому не выносим их отдельным диапазоном, а
  // просто включаем в один: 1-19 (осн. поля) + 20-22 (снимки) +
  // 23-25 (маржа) идут подряд без разрыва. Колонки 26-33
  // (заработки/бригада/материал — договорные, из updateOrder_)
  // saveOrder_ никогда не трогает, поэтому вне диапазона.
  var LEN = 25;
  var a, prevClient = '';
  if (isNew) {
    row = sh.getLastRow() + 1;
    a = new Array(LEN).fill('');
    a[COL.num - 1] = String(o.num);
    a[COL.status - 1] = 'Расчет';
    logStatus_(ss, String(o.num), 'Расчет');
  } else {
    a = sh.getRange(row, 1, 1, LEN).getValues()[0];
    prevClient = String(a[COL.client - 1] || '');
  }
  if (o.client) a[COL.client - 1] = o.client;
  if (o.obj)    a[COL.obj - 1] = o.obj;
  a[COL.pred - 1]  = o.predPrice || 0;
  a[COL.totL - 1]  = o.totL || 0;
  a[COL.totP - 1]  = o.totP || 0;
  a[COL.totK - 1]  = o.totK || 0;
  a[COL.margL - 1] = o.margL || 0;
  a[COL.margP - 1] = o.margP || 0;
  a[COL.margK - 1] = o.margK || 0;
  a[COL.updated - 1] = new Date();
  a[COL.snap1 - 1] = o.snap1 || '';
  a[COL.snap2 - 1] = o.snap2 || '';
  a[COL.snap3 - 1] = o.snap3 || '';

  sh.getRange(row, 1, 1, LEN).setValues([a]);

  var res = { ok: true, row: row, created: isNew };
  if (!isNew && prevClient && o.client && prevClient !== o.client) res.prevClient = prevClient;
  return res;
}

// Договор сформирован: статус, Согл. цена, Аванс, Дата договора.
// Если заказа с таким № нет (договор без сохранения расчёта) — создаём.
function updateOrder_(ss, o) {
  if (!o.num) return { ok: false, error: 'нет № заказа' };
  var sh = ordersSheet_(ss);
  var row = findRowByNum_(sh, o.num);
  var isNew = row < 0;

  // v4.9 БАТЧ-ЗАПИСЬ: read-modify-write двумя диапазонами вместо ~20
  // отдельных getRange/setValue (было ×1 API-вызов на ячейку).
  // Диапазон A = колонки 1-19 (осн. поля + Долг/Обновлён).
  // Диапазон B = колонки 23-33 (маржа/заработки/бригада/материал).
  // Колонки 20-22 (Снимок1-3, до 45к символов) СОЗНАТЕЛЬНО вне обоих
  // диапазонов: updateOrder_ их никогда не меняет — не читаем и не
  // пишем, чтобы не гонять большие ячейки туда-обратно без нужды.
  var LEN_A = 19, START_B = 23, LEN_B = ORDERS_HEADER.length - START_B + 1;

  var a, existingDog, hasDog, prevStatus;
  if (isNew) {
    a = new Array(LEN_A).fill('');
    existingDog = '';
    hasDog = false;
    prevStatus = '';
  } else {
    a = sh.getRange(row, 1, 1, LEN_A).getValues()[0];
    existingDog = a[COL.dogDate - 1];
    hasDog = !!(existingDog && String(existingDog) !== '');
    prevStatus = String(a[COL.status - 1] || '');
  }

  // ПРЕДОХРАНИТЕЛЬ: повторная генерация договора (fromDogovor) при уже
  // существующей Дате договора НИЧЕГО не меняет в СРМ — ни цену, ни аванс,
  // ни статус, ни дату. Изменения после договора фиксируются только через
  // лист "Изменения" (карточка → "± Изменение"). Если договор нужно
  // пересоздать с нуля — очисти ячейку "Дата договора" в таблице руками.
  // (Диапазон B ещё не читан — на защищённом повторе экономим вызов.)
  if (o.fromDogovor && hasDog) {
    return { ok: true, protected: true, dogDate: existingDog };
  }

  var b = isNew ? new Array(LEN_B).fill('') : sh.getRange(row, START_B, 1, LEN_B).getValues()[0];

  if (isNew) {
    row = sh.getLastRow() + 1;
    a[COL.num - 1] = String(o.num);
    if (o.client) a[COL.client - 1] = o.client;
    if (o.obj)    a[COL.obj - 1] = o.obj;
  }
  if (o.status)  a[COL.status - 1] = o.status;
  if (o.status && String(o.status) !== prevStatus) logStatus_(ss, String(o.num), String(o.status));
  if (o.client)  a[COL.client - 1] = o.client;
  if (o.obj)     a[COL.obj - 1] = o.obj;
  if (o.city !== undefined)      a[COL.city - 1] = o.city;
  if (o.phone !== undefined)     a[COL.phone - 1] = o.phone;
  if (o.furn !== undefined)      a[COL.furn - 1] = o.furn;
  if (o.note !== undefined)      a[COL.note - 1] = o.note;
  if (o.mountDate !== undefined) a[COL.mountDate - 1] = o.mountDate;
  if (o.paid !== undefined)      a[COL.paid - 1] = o.paid;
  if (o.soglPrice !== undefined) a[COL.sogl - 1] = o.soglPrice;
  if (o.avans !== undefined)     a[COL.avans - 1] = o.avans;
  if (o.margin !== undefined)    b[COL.margin - START_B] = o.margin;
  if (o.earnMaster !== undefined)   b[COL.earnMaster - START_B] = o.earnMaster;
  if (o.earnDesigner !== undefined) b[COL.earnDesigner - START_B] = o.earnDesigner;
  if (o.masterId !== undefined)  b[COL.masterId - START_B] = String(o.masterId || '');
  if (o.helperId !== undefined)  b[COL.helperId - START_B] = String(o.helperId || '');
  if (o.helperPay !== undefined) b[COL.helperPay - START_B] = Math.round(Number(o.helperPay) || 0);
  // material: выбор ДО договора ('L'/'P'/'K'), после подписания карточка
  // больше его не шлёт (fromDogovor не трогает это поле).
  if (o.material !== undefined && !o.fromDogovor) {
    var mv = String(o.material || '');
    if (mv === 'L' || mv === 'P' || mv === 'K' || mv === '') b[COL.material - START_B] = mv;
  }
  // Источник лида — редактируется свободно в любой момент (в отличие от
  // material выше, которое договор блокирует): это просто метка канала,
  // а не расчётное поле.
  if (o.source !== undefined) {
    var srcV = String(o.source || '');
    if (srcV === '' || LEAD_SOURCES.indexOf(srcV) >= 0) b[COL.source - START_B] = srcV;
  }
  var soglV = Number(a[COL.sogl - 1]) || 0;
  var avV   = Number(a[COL.avans - 1]) || 0;
  var paidV = Number(a[COL.paid - 1]) || 0;
  if (soglV > 0) a[COL.debt - 1] = soglV - avV - paidV;
  if (o.status === 'Договор') {
    // Дату ставим ТОЛЬКО один раз: сохранение карточки в статусе "Договор"
    // не должно сбрасывать её на сегодня (иначе Продажи уедут в другой месяц).
    if (!hasDog) a[COL.dogDate - 1] = new Date();
    if ((Number(o.avans) || 0) > 0) upsertAvansFin_(ss, String(o.num), Number(o.avans) || 0);
  }
  a[COL.updated - 1] = new Date();

  sh.getRange(row, 1, 1, LEN_A).setValues([a]);
  sh.getRange(row, START_B, 1, LEN_B).setValues([b]);
  return { ok: true, row: row, created: isNew };
}

// ============================================================
// СРМ: ЧТЕНИЕ (для страницы СРМ — этап 2, деплоить заново не придётся)
// ============================================================
// Список заказов БЕЗ снимков — быстрый.
function ordersList_(ss) {
  var sh = ss.getSheetByName(ORDERS_SHEET);
  if (!sh || sh.getLastRow() < 2) return { ok: true, orders: [] };
  // Читаем до source (34): clientKey(29) в диапазон попадает, но в вывод
  // НЕ идёт — он секретный (личные ссылки клиентов).
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, COL.source).getValues();
  var orders = vals.filter(function(r){ return r[COL.num - 1] !== ''; }).map(function(r){
    return {
      num: String(r[COL.num - 1]), status: r[COL.status - 1], city: r[COL.city - 1],
      client: r[COL.client - 1], phone: String(r[COL.phone - 1] || ''), obj: r[COL.obj - 1],
      furn: r[COL.furn - 1], note: r[COL.note - 1],
      pred: r[COL.pred - 1] || 0, sogl: r[COL.sogl - 1] || 0,
      avans: r[COL.avans - 1] || 0, paid: r[COL.paid - 1] || 0,
      dogDate: r[COL.dogDate - 1], mountDate: r[COL.mountDate - 1],
      totL: r[COL.totL - 1] || 0, totP: r[COL.totP - 1] || 0, totK: r[COL.totK - 1] || 0,
      margL: r[COL.margL - 1] || 0, margP: r[COL.margP - 1] || 0, margK: r[COL.margK - 1] || 0,
      margin: r[COL.margin - 1] || 0,
      earnMaster: r[COL.earnMaster - 1] || 0, earnDesigner: r[COL.earnDesigner - 1] || 0,
      masterId: String(r[COL.masterId - 1] || ''), helperId: String(r[COL.helperId - 1] || ''),
      helperPay: Number(r[COL.helperPay - 1]) || 0,
      material: String(r[COL.material - 1] || ''),
      source: String(r[COL.source - 1] || ''),
      updated: r[COL.updated - 1]
    };
  });
  return { ok: true, orders: orders };
}

// Один заказ СО снимком расчёта.
function orderOne_(ss, num) {
  var sh = ss.getSheetByName(ORDERS_SHEET);
  if (!sh) return { ok: false, error: 'листа "Заказы" ещё нет' };
  var row = findRowByNum_(sh, num);
  if (row < 0) return { ok: false, error: 'заказ №' + num + ' не найден' };
  var r = sh.getRange(row, 1, 1, ORDERS_HEADER.length).getValues()[0];
  var snap = String(r[COL.snap1 - 1] || '') + String(r[COL.snap2 - 1] || '') + String(r[COL.snap3 - 1] || '');
  return {
    ok: true,
    order: {
      num: String(r[COL.num - 1]), status: r[COL.status - 1], client: r[COL.client - 1],
      obj: r[COL.obj - 1], sogl: r[COL.sogl - 1] || 0, pred: r[COL.pred - 1] || 0,
      snapshot: snap
    }
  };
}

// ============================================================
// АРХИВ ЗАКАЗОВ (v4.9)
// ============================================================
// Готовые/отказные заказы старше ARCHIVE_DAYS уезжают в ОТДЕЛЬНЫЙ файл
// таблицы (не лист) — рабочий "Заказы" не пухнет, ordersList_ остаётся
// быстрым. Финансы/Изменения/Рекламации/Вложения ОСТАЮТСЯ в рабочем
// файле и продолжают ссылаться на № как раньше — в отличие от
// delOrder_, здесь ничего не отвязывается и не удаляется, переезжает
// только сама строка "Заказы".
// Отсчёт "N дней с Готова/Отказ" — по журналу "Статусы" (SLOG),
// последний переход ИМЕННО В ЭТОТ статус. Не берём общую "Обновлён" —
// её сдвигает любая правка карточки уже после сдачи заказа.
// Не уезжает, пока по заказу есть незакрытая рекламация (стадия != Закрыта).
//
// Функции ниже принимают ss/archiveSs явными параметрами (как весь
// остальной код) — тестируются моками без реального PropertiesService/
// SpreadsheetApp.create. Реальное разрешение файла архива — в
// getArchiveSpreadsheet_() (см. конец файла), она в юнит-тестах не участвует.
var ARCHIVE_DAYS = 30;
var ARCHIVE_STATUSES = ['Готова', 'Отказ'];

// Дата последнего перехода заказа num В статус status по журналу "Статусы".
// null, если такого перехода в журнале нет (старый заказ до появления SLOG,
// либо статус выставлен напрямую в таблице руками, без сохранения через СРМ).
function lastStatusDate_(ss, num, status) {
  var sh = ss.getSheetByName(SLOG_SHEET);
  if (!sh) return null;
  var last = sh.getLastRow();
  if (last < 2) return null;
  var rows = sh.getRange(2, 1, last - 1, SLCOL.date).getValues();
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][SLCOL.num - 1]) === String(num) && String(rows[i][SLCOL.status - 1]) === String(status)) {
      return rows[i][SLCOL.date - 1];
    }
  }
  return null;
}

// Есть ли по заказу num незакрытая рекламация (стадия != "Закрыта")?
function hasOpenRecl_(ss, num) {
  var sh = ss.getSheetByName(RECL_SHEET);
  if (!sh) return false;
  var last = sh.getLastRow();
  if (last < 2) return false;
  var rows = sh.getRange(2, 1, last - 1, RECLCOL.created).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][RECLCOL.num - 1]) === String(num) && String(rows[i][RECLCOL.stage - 1]) !== 'Закрыта') return true;
  }
  return false;
}

// Переносит из ss в archiveSs все заказы Готова/Отказ старше ARCHIVE_DAYS
// дней (по журналу статусов), без незакрытых рекламаций. Идемпотентна —
// повторный вызов без новых кандидатов просто ничего не находит.
function archiveEligibleOrders_(ss, archiveSs) {
  var sh = ordersSheet_(ss);
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, archived: [], count: 0 };
  var cutoff = new Date(Date.now() - ARCHIVE_DAYS * 24 * 60 * 60 * 1000);
  var archived = [];
  // Снизу вверх — deleteRow не сдвигает ещё не проверенные строки выше.
  for (var r = last; r >= 2; r--) {
    var num = String(sh.getRange(r, COL.num).getValue() || '');
    if (!num) continue;
    var status = String(sh.getRange(r, COL.status).getValue() || '');
    if (ARCHIVE_STATUSES.indexOf(status) < 0) continue;
    var statusDate = lastStatusDate_(ss, num, status);
    if (!statusDate || new Date(statusDate) > cutoff) continue;
    if (hasOpenRecl_(ss, num)) continue;
    var rowVals = sh.getRange(r, 1, 1, ORDERS_HEADER.length).getValues()[0];
    var aSh = ordersSheet_(archiveSs);
    aSh.getRange(aSh.getLastRow() + 1, 1, 1, ORDERS_HEADER.length).setValues([rowVals]);
    sh.deleteRow(r);
    archived.push(num);
  }
  return { ok: true, archived: archived, count: archived.length };
}

// Список архивных заказов — та же форма, что ordersList_ (переиспользуем
// её же: archiveSs устроен как обычный рабочий файл, лист "Заказы" тот же).
function archiveOrdersList_(archiveSs) {
  return ordersList_(archiveSs);
}

// Возврат заказа num из архива в рабочий файл. Отклоняется, если номер
// уже (снова) занят в рабочем файле — например, createOrder_ выдал его
// заново, пока заказ лежал в архиве.
function restoreFromArchive_(ss, archiveSs, num) {
  if (!num) return { ok: false, error: 'нет № заказа' };
  var aSh = ordersSheet_(archiveSs);
  var aRow = findRowByNum_(aSh, String(num));
  if (aRow < 0) return { ok: false, error: 'заказ №' + num + ' не найден в архиве' };
  var sh = ordersSheet_(ss);
  if (findRowByNum_(sh, String(num)) >= 0) return { ok: false, error: 'заказ №' + num + ' уже есть в рабочем файле' };
  var rowVals = aSh.getRange(aRow, 1, 1, ORDERS_HEADER.length).getValues()[0];
  sh.getRange(sh.getLastRow() + 1, 1, 1, ORDERS_HEADER.length).setValues([rowVals]);
  aSh.deleteRow(aRow);
  return { ok: true, row: sh.getLastRow() };
}

// Реальное разрешение файла архива — создаётся автоматически при первом
// обращении, ID хранится в Свойствах скрипта, руками заводить не нужно.
// В юнит-тестах не участвует (PropertiesService/SpreadsheetApp.create не
// мокаются) — тестируются только archiveEligibleOrders_/archiveOrdersList_/
// restoreFromArchive_ выше, с обычными ss-моками.
function getArchiveSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('ARCHIVE_SS_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* файл удалили руками — создадим заново */ }
  }
  var ss = SpreadsheetApp.create('MebelOFF — Архив заказов');
  props.setProperty('ARCHIVE_SS_ID', ss.getId());
  return ss;
}

// Запуск: триггер по времени (как dailyBackup) на функцию dailyArchive.
// Первый запуск — руками (Выполнить → dailyArchive), дальше по триггеру
// раз в сутки. Отдельный lock — пишет в тот же лист "Заказы", что и doPost.
function dailyArchive() {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var archiveSs = getArchiveSpreadsheet_();
    var res = archiveEligibleOrders_(ss, archiveSs);
    Logger.log('dailyArchive: перенесено ' + res.count + ' заказ(ов): ' + res.archived.join(', '));
  } finally {
    lock.releaseLock();
  }
}

// ── Прежние функции v1 — без изменений ──────────────────────
function buildHingeCatalog_(furn){
  var seen = {};
  var out = [];
  furn.forEach(function(r){
    if (r.cat !== 'Петля') return;
    if (seen[r.firm]) return;
    seen[r.firm] = true;
    out.push({ brand: r.firm, price: r.p });
  });
  return out;
}

function buildSlideCatalog_(furn){
  var slideCats = ['Телескоп','Телескоп-Д','Телескоп-Д черный','СМ-полный','СМ-частичный','Push-open'];
  var out = [];
  furn.forEach(function(r){
    if (slideCats.indexOf(r.cat) < 0) return;
    var len = parseInt(String(r.vid).replace(/\D/g,''), 10) || 0;
    out.push({ brand: r.firm, type: r.cat, length: len, price: r.p });
  });
  return out;
}

function readMoika_(ss){
  var sh = ss.getSheetByName('ДопКухня_Мойка');
  if(!sh) return [];
  var rows = sh.getDataRange().getValues();
  rows.shift();
  return rows.filter(function(r){ return r[0]; }).map(function(r){
    return {
      tip: String(r[0]||''), razmer: String(r[1]||''), cvet: String(r[2]||''),
      base: Number(r[3])||0, work: Number(r[4])||0,
      des: Number(r[5])||0, our: Number(r[6])||0, disc: Number(r[7])||0
    };
  });
}

function readAccSheet_(ss, sheetName, attrs){
  var sh = ss.getSheetByName(sheetName);
  if(!sh) return [];
  var rows = sh.getDataRange().getValues();
  rows.shift();
  return rows.filter(function(r){ return r[0]; }).map(function(r){
    var obj = {};
    for (var i=0;i<attrs.length;i++){ obj[attrs[i]] = String(r[i]||''); }
    var b = attrs.length;
    obj.base = Number(r[b])||0;
    obj.work = Number(r[b+1])||0;
    obj.des  = Number(r[b+2])||0;
    obj.our  = Number(r[b+3])||0;
    obj.disc = Number(r[b+4])||0;
    return obj;
  });
}

function readSimpleSheet_(ss, sheetName){
  var sh = ss.getSheetByName(sheetName);
  if(!sh) return [];
  var rows = sh.getDataRange().getValues();
  rows.shift();
  return rows.filter(function(r){ return r[0]; }).map(function(r){
    return { tip: String(r[0]||''), p: Number(r[1])||0 };
  });
}

// ── Склад: лист-журнал, чтение, агрегация, запись ───────────

function stockSheet_(ss) {
  var sh = ss.getSheetByName(STOCK_SHEET);
  if (!sh) {
    sh = ss.insertSheet(STOCK_SHEET);
    sh.getRange(1, 1, 1, STOCK_HEADER.length).setValues([STOCK_HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// Прочитать все движения листа "Склад" в массив объектов
function stockRows_(ss) {
  var sh = stockSheet_(ss);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var rows = sh.getRange(2, 1, last - 1, SCOL.created).getValues();
  var out = [];
  rows.forEach(function(r){
    if (r[SCOL.id - 1] === '' && r[SCOL.key - 1] === '') return;
    out.push({
      id: String(r[SCOL.id - 1]),
      date: r[SCOL.date - 1],
      type: String(r[SCOL.type - 1] || ''),
      key: String(r[SCOL.key - 1] || ''),
      name: String(r[SCOL.name - 1] || ''),
      unit: String(r[SCOL.unit - 1] || ''),
      qty: Number(r[SCOL.qty - 1]) || 0,
      num: String(r[SCOL.num - 1] || ''),
      comment: String(r[SCOL.comment - 1] || '')
    });
  });
  return out;
}

// ЧИСТАЯ агрегация: движения -> остатки по Ключу.
// Приход +, Расход −. Кол-во целое -> остаток целый.
function stockAgg_(moves) {
  var acc = {};
  var arr = moves || [];
  arr.forEach(function(m){
    var key = String(m.key || '');
    if (!key) return;
    if (!acc[key]) acc[key] = { key: key, name: String(m.name || ''), unit: String(m.unit || ''), qty: 0 };
    if (m.name) acc[key].name = String(m.name); // последнее имя движения — актуальное
    if (m.unit) acc[key].unit = String(m.unit);
    var q = Math.round(Number(m.qty) || 0);
    if (m.type === 'Расход') acc[key].qty -= q;
    else acc[key].qty += q; // Приход (и всё прочее) — плюс
  });
  var stock = [];
  Object.keys(acc).forEach(function(k){ stock.push(acc[k]); });
  return { ok: true, stock: stock };
}

function stockSnapshot_(ss) { return stockAgg_(stockRows_(ss)); }

function stockList_(ss) { return { ok: true, moves: stockRows_(ss) }; }

// ЧИСТАЯ валидация одного движения. '' если ок, иначе текст ошибки.
function validateStockMove_(m) {
  if (!m || !String(m.key || '')) return 'нет ключа позиции';
  if (m.type !== 'Приход' && m.type !== 'Расход') return 'неверный тип движения';
  var q = Number(m.qty);
  if (!(q > 0)) return 'кол-во должно быть больше нуля';
  if (Math.round(q) !== q) return 'кол-во должно быть целым';
  if (m.unit !== 'шт' && m.unit !== 'лист') return 'неверная единица';
  return '';
}

// Батч-запись движений: o = {moves:[{type,key,name,unit,qty,num,comment,date}]}
// Всё-или-ничего по валидации: одна кривая строка — не пишем ничего.
function stockMove_(ss, o) {
  var moves = (o && o.moves) || [];
  if (!moves.length) return { ok: false, error: 'нет движений' };
  for (var i = 0; i < moves.length; i++) {
    var err = validateStockMove_(moves[i]);
    if (err) return { ok: false, error: 'строка ' + (i + 1) + ': ' + err };
  }
  var sh = stockSheet_(ss);
  var now = new Date();
  var ids = [];
  moves.forEach(function(m){
    var row = sh.getLastRow() + 1;
    var id = String(Date.now()) + '-' + row;
    sh.getRange(row, SCOL.id).setValue(id);
    sh.getRange(row, SCOL.date).setValue(m.date || now);
    sh.getRange(row, SCOL.type).setValue(m.type);
    sh.getRange(row, SCOL.key).setValue(String(m.key));
    sh.getRange(row, SCOL.name).setValue(m.name || '');
    sh.getRange(row, SCOL.unit).setValue(m.unit);
    sh.getRange(row, SCOL.qty).setValue(Math.round(Number(m.qty)));
    sh.getRange(row, SCOL.num).setValue(m.num ? String(m.num) : '');
    sh.getRange(row, SCOL.comment).setValue(m.comment || '');
    sh.getRange(row, SCOL.created).setValue(now);
    ids.push(id);
  });
  return { ok: true, ids: ids };
}


// Удаление ошибочного движения по id. Остаток пересчитается сам —
// он всегда вычисляется из оставшихся строк журнала (stockAgg_).
function delStockMove_(ss, id) {
  if (!id) return { ok: false, error: 'нет id движения' };
  var sh = stockSheet_(ss);
  var last = sh.getLastRow();
  for (var r = 2; r <= last; r++) {
    if (String(sh.getRange(r, SCOL.id).getValue()) === String(id)) {
      sh.deleteRow(r);
      return { ok: true };
    }
  }
  return { ok: false, error: 'движение не найдено (возможно, уже удалено)' };
}


// ═══════════════ МИНИМАЛЬНЫЕ ОСТАТКИ (СкладМин) ═══════════════

function stockMinSheet_(ss) {
  var sh = ss.getSheetByName(SMIN_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SMIN_SHEET);
    sh.getRange(1, 1, 1, SMIN_HEADER.length).setValues([SMIN_HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else {
    // Лист создан до v4.4 — на подписи заголовка это не сказывается
    // (данные и так пишутся/читаются по номеру колонки SMINCOL.lead),
    // но по возможности дописываем подпись "СрокПоставки" для порядка.
    // try/catch — это чисто косметика, не должна ронять сохранение.
    try {
      if (!sh.getRange(1, SMINCOL.lead).getValue()) {
        sh.getRange(1, SMINCOL.lead).setValue(SMIN_HEADER[SMINCOL.lead - 1]).setFontWeight('bold');
      }
    } catch (e) {}
  }
  return sh;
}

function stockMinList_(ss) {
  var sh = stockMinSheet_(ss);
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, mins: [] };
  var rows = sh.getRange(2, 1, last - 1, SMINCOL.lead).getValues();
  var mins = [];
  rows.forEach(function(r){
    var key = String(r[SMINCOL.key - 1] || '');
    if (!key) return;
    mins.push({
      key: key,
      min: Math.round(Number(r[SMINCOL.min - 1]) || 0),
      lead: Math.round(Number(r[SMINCOL.lead - 1]) || 0)
    });
  });
  return { ok: true, mins: mins };
}

// Upsert минимума и/или срока поставки по ключу. Оба поля независимы:
// еслиo.min не передан — старое значение минимума сохраняется, и
// наоборот для o.lead (так UI может менять их по отдельности одним
// кликом на своей колонке). min=0 и lead=0 одновременно — строка
// удаляется (обе настройки сняты).
function saveStockMin_(ss, o) {
  var key = String((o && o.key) || '').trim();
  if (!key) return { ok: false, error: 'нет ключа позиции' };
  var sh = stockMinSheet_(ss);
  var last = sh.getLastRow();
  var row = -1;
  for (var r = 2; r <= last; r++) {
    if (String(sh.getRange(r, SMINCOL.key).getValue()) === key) { row = r; break; }
  }
  var curMin = row > 0 ? Math.round(Number(sh.getRange(row, SMINCOL.min).getValue()) || 0) : 0;
  var curLead = row > 0 ? Math.round(Number(sh.getRange(row, SMINCOL.lead).getValue()) || 0) : 0;
  var min = (o.min === undefined || o.min === null) ? curMin : Math.round(Number(o.min));
  var lead = (o.lead === undefined || o.lead === null) ? curLead : Math.round(Number(o.lead));
  if (isNaN(min) || min < 0) return { ok: false, error: 'минимум должен быть целым числом не меньше нуля' };
  if (isNaN(lead) || lead < 0) return { ok: false, error: 'срок поставки должен быть целым числом не меньше нуля' };
  if (min === 0 && lead === 0) {
    if (row > 0) sh.deleteRow(row);
    return { ok: true, key: key, min: 0, lead: 0 };
  }
  if (row < 0) { row = last + 1; sh.getRange(row, SMINCOL.key).setValue(key); }
  sh.getRange(row, SMINCOL.min).setValue(min);
  sh.getRange(row, SMINCOL.lead).setValue(lead);
  sh.getRange(row, SMINCOL.updated).setValue(new Date());
  return { ok: true, key: key, min: min, lead: lead };
}


// ═══════════════ ПОСТОЯННЫЕ РАСХОДЫ (шаблоны) ═══════════════

function recurSheet_(ss) {
  var sh = ss.getSheetByName(RECUR_SHEET);
  if (!sh) {
    sh = ss.insertSheet(RECUR_SHEET);
    sh.getRange(1, 1, 1, RECUR_HEADER.length).setValues([RECUR_HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function recurList_(ss) {
  var sh = recurSheet_(ss);
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, recur: [] };
  var rows = sh.getRange(2, 1, last - 1, RCOL.created).getValues();
  var recur = [];
  rows.forEach(function(r){
    if (r[RCOL.id - 1] === '' && r[RCOL.name - 1] === '') return;
    recur.push({
      id: String(r[RCOL.id - 1]),
      name: String(r[RCOL.name - 1] || ''),
      cat: String(r[RCOL.cat - 1] || ''),
      sum: Number(r[RCOL.sum - 1]) || 0,
      active: r[RCOL.active - 1] !== false && String(r[RCOL.active - 1]) !== 'нет'
    });
  });
  return { ok: true, recur: recur };
}

// upsert по id (пусто → создать новую строку)
function saveRecur_(ss, o) {
  var name = String(o.name || '').trim();
  if (!name) return { ok: false, error: 'укажи название расхода' };
  var sum = Math.round(Number(o.sum) || 0);
  if (!(sum > 0)) return { ok: false, error: 'сумма должна быть больше нуля' };
  var sh = recurSheet_(ss);
  var row = -1;
  if (o.id) {
    var last = sh.getLastRow();
    for (var r = 2; r <= last; r++) {
      if (String(sh.getRange(r, RCOL.id).getValue()) === String(o.id)) { row = r; break; }
    }
  }
  var id = o.id ? String(o.id) : (String(Date.now()) + '-' + (sh.getLastRow() + 1));
  if (row < 0) { row = sh.getLastRow() + 1; sh.getRange(row, RCOL.id).setValue(id); sh.getRange(row, RCOL.created).setValue(new Date()); }
  sh.getRange(row, RCOL.name).setValue(name);
  sh.getRange(row, RCOL.cat).setValue(o.cat || 'Прочее');
  sh.getRange(row, RCOL.sum).setValue(sum);
  sh.getRange(row, RCOL.active).setValue(o.active === false ? false : true);
  return { ok: true, id: id };
}

function delRecur_(ss, id) {
  if (!id) return { ok: false, error: 'нет id' };
  var sh = recurSheet_(ss);
  var last = sh.getLastRow();
  for (var r = 2; r <= last; r++) {
    if (String(sh.getRange(r, RCOL.id).getValue()) === String(id)) { sh.deleteRow(r); return { ok: true }; }
  }
  return { ok: false, error: 'строка не найдена (возможно, уже удалена)' };
}


// ═══════════════ СОТРУДНИКИ (оклады) ═══════════════

function empSheet_(ss) {
  var sh = ss.getSheetByName(EMP_SHEET);
  if (!sh) {
    sh = ss.insertSheet(EMP_SHEET);
    sh.getRange(1, 1, 1, EMP_HEADER.length).setValues([EMP_HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function empList_(ss) {
  var sh = empSheet_(ss);
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, employees: [] };
  var rows = sh.getRange(2, 1, last - 1, ECOL.helperRate).getValues();
  var employees = [];
  rows.forEach(function(r){
    if (r[ECOL.id - 1] === '' && r[ECOL.name - 1] === '') return;
    employees.push({
      id: String(r[ECOL.id - 1]),
      name: String(r[ECOL.name - 1] || ''),
      role: String(r[ECOL.role - 1] || ''),
      salary: Number(r[ECOL.salary - 1]) || 0,
      active: r[ECOL.active - 1] !== false && String(r[ECOL.active - 1]) !== 'нет',
      helperRate: Number(r[ECOL.helperRate - 1]) || 0
    });
  });
  return { ok: true, employees: employees };
}

function saveEmp_(ss, o) {
  var name = String(o.name || '').trim();
  if (!name) return { ok: false, error: 'укажи имя сотрудника' };
  var role = String(o.role || '').trim();
  if (role !== 'Мастер' && role !== 'Дизайнер') return { ok: false, error: 'роль: Мастер или Дизайнер' };
  var salary = Math.round(Number(o.salary) || 0);
  if (salary < 0) return { ok: false, error: 'оклад не может быть отрицательным' };
  var sh = empSheet_(ss);
  var row = -1;
  if (o.id) {
    var last = sh.getLastRow();
    for (var r = 2; r <= last; r++) {
      if (String(sh.getRange(r, ECOL.id).getValue()) === String(o.id)) { row = r; break; }
    }
  }
  var id = o.id ? String(o.id) : (String(Date.now()) + '-' + (sh.getLastRow() + 1));
  if (row < 0) { row = sh.getLastRow() + 1; sh.getRange(row, ECOL.id).setValue(id); sh.getRange(row, ECOL.created).setValue(new Date()); }
  sh.getRange(row, ECOL.name).setValue(name);
  sh.getRange(row, ECOL.role).setValue(role);
  sh.getRange(row, ECOL.salary).setValue(salary);
  sh.getRange(row, ECOL.active).setValue(o.active === false ? false : true);
  sh.getRange(row, ECOL.helperRate).setValue(Math.round(Number(o.helperRate) || 0));
  return { ok: true, id: id };
}

function delEmp_(ss, id) {
  if (!id) return { ok: false, error: 'нет id' };
  var sh = empSheet_(ss);
  var last = sh.getLastRow();
  for (var r = 2; r <= last; r++) {
    if (String(sh.getRange(r, ECOL.id).getValue()) === String(id)) { sh.deleteRow(r); return { ok: true }; }
  }
  return { ok: false, error: 'строка не найдена (возможно, уже удалена)' };
}


// ═══════════════ ДОП. РАБОТЫ (разовые выплаты по заказу) ═══════════════

function dopSheet_(ss) {
  var sh = ss.getSheetByName(DOP_SHEET);
  if (!sh) {
    sh = ss.insertSheet(DOP_SHEET);
    sh.getRange(1, 1, 1, DOP_HEADER.length).setValues([DOP_HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// Все доп. работы (клиент СРМ сам фильтрует по № заказа и месяцу)
function dopList_(ss) {
  var sh = dopSheet_(ss);
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, dop: [] };
  var rows = sh.getRange(2, 1, last - 1, DCOL.created).getValues();
  var dop = [];
  rows.forEach(function(r){
    if (r[DCOL.id - 1] === '' && r[DCOL.num - 1] === '') return;
    dop.push({
      id: String(r[DCOL.id - 1]),
      num: String(r[DCOL.num - 1] || ''),
      empId: String(r[DCOL.empId - 1] || ''),
      desc: String(r[DCOL.desc - 1] || ''),
      sum: Number(r[DCOL.sum - 1]) || 0,
      date: r[DCOL.date - 1]
    });
  });
  return { ok: true, dop: dop };
}

// Добавить доп. работу. o = {num, empId, desc, sum, date}
function addDop_(ss, o) {
  var num = String(o.num || '').trim();
  if (!num) return { ok: false, error: 'нет № заказа' };
  var empId = String(o.empId || '').trim();
  if (!empId) return { ok: false, error: 'выбери сотрудника (кому выплата)' };
  var sum = Math.round(Number(o.sum) || 0);
  if (!(sum > 0)) return { ok: false, error: 'сумма должна быть больше нуля' };
  var desc = String(o.desc || '').trim();
  var sh = dopSheet_(ss);
  var row = sh.getLastRow() + 1;
  var id = String(Date.now()) + '-' + row;
  sh.getRange(row, DCOL.id).setValue(id);
  sh.getRange(row, DCOL.num).setValue(num);
  sh.getRange(row, DCOL.empId).setValue(empId);
  sh.getRange(row, DCOL.desc).setValue(desc);
  sh.getRange(row, DCOL.sum).setValue(sum);
  sh.getRange(row, DCOL.date).setValue(o.date || new Date());
  sh.getRange(row, DCOL.created).setValue(new Date());
  return { ok: true, id: id };
}

function delDop_(ss, id) {
  if (!id) return { ok: false, error: 'нет id доп. работы' };
  var sh = dopSheet_(ss);
  var last = sh.getLastRow();
  for (var r = 2; r <= last; r++) {
    if (String(sh.getRange(r, DCOL.id).getValue()) === String(id)) { sh.deleteRow(r); return { ok: true }; }
  }
  return { ok: false, error: 'доп. работа не найдена (возможно, уже удалена)' };
}


// ═══════════════ ШАБЛОНЫ ДОП. РАБОТ (типовые названия) ═══════════════

function dopTemplatesSheet_(ss) {
  var sh = ss.getSheetByName(DOPT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(DOPT_SHEET);
    sh.getRange(1, 1, 1, DOPT_HEADER.length).setValues([DOPT_HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function dopTemplatesList_(ss) {
  var sh = dopTemplatesSheet_(ss);
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, templates: [] };
  var rows = sh.getRange(2, 1, last - 1, DTCOL.created).getValues();
  var templates = [];
  rows.forEach(function(r){
    var name = String(r[DTCOL.name - 1] || '').trim();
    if (!name) return;
    templates.push({ id: String(r[DTCOL.id - 1]), name: name });
  });
  return { ok: true, templates: templates };
}

function saveDopTemplate_(ss, o) {
  var name = String((o && o.name) || '').trim();
  if (!name) return { ok: false, error: 'укажи название' };
  var sh = dopTemplatesSheet_(ss);
  var row = sh.getLastRow() + 1;
  var id = String(Date.now()) + '-' + row;
  sh.getRange(row, DTCOL.id).setValue(id);
  sh.getRange(row, DTCOL.name).setValue(name);
  sh.getRange(row, DTCOL.created).setValue(new Date());
  return { ok: true, id: id };
}

function delDopTemplate_(ss, id) {
  if (!id) return { ok: false, error: 'нет id шаблона' };
  var sh = dopTemplatesSheet_(ss);
  var last = sh.getLastRow();
  for (var r = 2; r <= last; r++) {
    if (String(sh.getRange(r, DTCOL.id).getValue()) === String(id)) { sh.deleteRow(r); return { ok: true }; }
  }
  return { ok: false, error: 'шаблон не найден (возможно, уже удалён)' };
}


// ═══════════════ ВЛОЖЕНИЯ (фото и заметки к заказам) ═══════════════

function attachSheet_(ss) {
  var sh = ss.getSheetByName(ATT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(ATT_SHEET);
    sh.getRange(1, 1, 1, ATT_HEADER.length).setValues([ATT_HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// Все вложения (клиент сам фильтрует по № заказа — как changesList_)
function attachList_(ss) {
  var sh = attachSheet_(ss);
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, attach: [] };
  var rows = sh.getRange(2, 1, last - 1, ACOL.pub).getValues();
  var attach = [];
  rows.forEach(function(r){
    if (r[ACOL.id - 1] === '' && r[ACOL.num - 1] === '') return;
    attach.push({
      id: String(r[ACOL.id - 1]),
      num: String(r[ACOL.num - 1] || ''),
      kind: String(r[ACOL.kind - 1] || ''),
      name: String(r[ACOL.name - 1] || ''),
      fileId: String(r[ACOL.fileId - 1] || ''),
      comment: String(r[ACOL.comment - 1] || ''),
      created: r[ACOL.created - 1],
      pub: r[ACOL.pub - 1] === true
    });
  });
  return { ok: true, attach: attach };
}

// Папка вложений на Диске: "MebelOFF Вложения" → подпапка "Заказ №N"
function attachFolder_(num) {
  var it = DriveApp.getFoldersByName(ATT_FOLDER);
  var root = it.hasNext() ? it.next() : DriveApp.createFolder(ATT_FOLDER);
  var sub = 'Заказ №' + num;
  var it2 = root.getFoldersByName(sub);
  return it2.hasNext() ? it2.next() : root.createFolder(sub);
}

// Добавить вложение. o = {num, kind:'файл'|'коммент', name, mime, dataB64, comment}
// Файл декодируется из base64, уходит на Диск и открывается "по ссылке"
// (иначе миниатюры не показать на других устройствах). В лист пишется
// только FileId — лимит ячейки не страдает.
function addAttach_(ss, o) {
  var num = String(o.num || '').trim();
  if (!num) return { ok: false, error: 'нет № заказа' };
  var kind = o.kind === 'файл' ? 'файл' : 'коммент';
  var comment = String(o.comment || '').trim();
  var fileId = '', name = '';
  if (kind === 'файл') {
    if (!o.dataB64) return { ok: false, error: 'нет данных файла' };
    if (String(o.dataB64).length > 8000000) return { ok: false, error: 'файл слишком большой даже после сжатия' };
    var mime = String(o.mime || 'image/jpeg');
    if (mime.indexOf('image/') !== 0) return { ok: false, error: 'в v1 принимаются только фото' };
    name = String(o.name || 'фото.jpg');
    var bytes;
    try { bytes = Utilities.base64Decode(o.dataB64); }
    catch (e) { return { ok: false, error: 'файл повреждён (base64 не читается)' }; }
    // ⚠️ Загрузка на Диск — САМАЯ долгая часть (3-10 сек). Делаем её ДО lock,
    // чтобы блокировка не висела всё это время и не копила очередь.
    var blob = Utilities.newBlob(bytes, mime, name);
    var file = attachFolder_(num).createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    fileId = file.getId();
  } else {
    if (!comment) return { ok: false, error: 'пустая заметка' };
  }
  // Короткий lock ТОЛЬКО вокруг записи строки: getLastRow+1 не должен
  // столкнуться с параллельной записью. Это миллисекунды, не секунды.
  var lock = LockService.getScriptLock();
  var id;
  try {
    lock.waitLock(20000);
    var sh = attachSheet_(ss);
    var row = sh.getLastRow() + 1;
    id = String(Date.now()) + '-' + row;
    sh.getRange(row, ACOL.id).setValue(id);
    sh.getRange(row, ACOL.num).setValue(num);
    sh.getRange(row, ACOL.kind).setValue(kind);
    sh.getRange(row, ACOL.name).setValue(name);
    sh.getRange(row, ACOL.fileId).setValue(fileId);
    sh.getRange(row, ACOL.comment).setValue(comment);
    sh.getRange(row, ACOL.created).setValue(new Date());
    sh.getRange(row, ACOL.pub).setValue(o.pub === true);
  } finally {
    try { lock.releaseLock(); } catch (e3) {}
  }
  return { ok: true, id: id, fileId: fileId };
}

// Показ фото на клиентской странице: переключить флаг «Клиенту».
// По умолчанию все вложения скрыты; владелец помечает нужные фото
// в карточке заказа (кнопка-глаз), и только они попадают в
// clientStatus_. Подпись к фото уходит клиенту вместе с фото.
function pubAttach_(ss, id, pub) {
  if (!id) return { ok: false, error: 'нет id вложения' };
  var sh = attachSheet_(ss);
  var last = sh.getLastRow();
  for (var r = 2; r <= last; r++) {
    if (String(sh.getRange(r, ACOL.id).getValue()) === String(id)) {
      sh.getRange(r, ACOL.pub).setValue(pub === true);
      return { ok: true, pub: pub === true };
    }
  }
  return { ok: false, error: 'вложение не найдено (возможно, уже удалено)' };
}

// Удаление: строка из листа + файл в корзину Диска (восстановим оттуда,
// если удалили случайно). Если файла уже нет — строку всё равно убираем.
function delAttach_(ss, id) {
  if (!id) return { ok: false, error: 'нет id вложения' };
  var sh = attachSheet_(ss);
  var last = sh.getLastRow();
  for (var r = 2; r <= last; r++) {
    if (String(sh.getRange(r, ACOL.id).getValue()) === String(id)) {
      var fileId = String(sh.getRange(r, ACOL.fileId).getValue() || '');
      if (fileId) {
        try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {}
      }
      sh.deleteRow(r);
      return { ok: true };
    }
  }
  return { ok: false, error: 'вложение не найдено (возможно, уже удалено)' };
}


// ═══════════════ ЖУРНАЛ СТАТУСОВ ═══════════════

function statusLogSheet_(ss) {
  var sh = ss.getSheetByName(SLOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SLOG_SHEET);
    sh.getRange(1, 1, 1, SLOG_HEADER.length).setValues([SLOG_HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// Записать переход: если ПОСЛЕДНИЙ логированный статус заказа тот же —
// не дублируем (повторные сохранения карточки не мусорят журнал).
function logStatus_(ss, num, status) {
  if (!num || !status) return;
  var sh = statusLogSheet_(ss);
  var last = sh.getLastRow();
  if (last >= 2) {
    var rows = sh.getRange(2, 1, last - 1, SLCOL.date).getValues();
    for (var i = rows.length - 1; i >= 0; i--) {
      if (String(rows[i][SLCOL.num - 1]) === String(num)) {
        if (String(rows[i][SLCOL.status - 1]) === String(status)) return;
        break;
      }
    }
  }
  var row = last + 1;
  sh.getRange(row, SLCOL.id).setValue(String(Date.now()) + '-' + row);
  sh.getRange(row, SLCOL.num).setValue(String(num));
  sh.getRange(row, SLCOL.status).setValue(String(status));
  sh.getRange(row, SLCOL.date).setValue(new Date());
}

// Весь журнал (клиент СРМ сам фильтрует по № заказа)
function statusLogList_(ss) {
  var sh = statusLogSheet_(ss);
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, slog: [] };
  var rows = sh.getRange(2, 1, last - 1, SLCOL.date).getValues();
  var slog = [];
  rows.forEach(function(r){
    if (r[SLCOL.id - 1] === '' && r[SLCOL.num - 1] === '') return;
    slog.push({
      id: String(r[SLCOL.id - 1]),
      num: String(r[SLCOL.num - 1] || ''),
      status: String(r[SLCOL.status - 1] || ''),
      date: r[SLCOL.date - 1]
    });
  });
  return { ok: true, slog: slog };
}


// ═══════════════ КЛИЕНТСКАЯ СТРАНИЦА СТАТУСА ═══════════════
// Личный ключ заказа — случайная строка в колонке "Ключ клиента"
// (В КОНЦЕ листа, ничего не сдвигает). Ссылка status.html?o=№&k=ключ
// работает без общего токена СРМ и отдаёт только статус, тип мебели
// и даты — без телефонов, адресов, денег и снимков. Ключ создаётся
// при первом нажатии «Ссылка клиенту» и дальше не меняется; чтобы
// отозвать ссылку — очисти ячейку ключа в таблице руками.

function randKey_() {
  var s = '';
  while (s.length < 20) s += Math.random().toString(36).slice(2);
  return s.slice(0, 20);
}

// Выдать (создать при первом запросе) ключ клиентской ссылки
function clientLink_(ss, num) {
  if (!num) return { ok: false, error: 'нет № заказа' };
  var sh = ordersSheet_(ss);
  var row = findRowByNum_(sh, String(num));
  if (row < 0) return { ok: false, error: 'заказ №' + num + ' не найден' };
  var key = String(sh.getRange(row, COL.clientKey).getValue() || '');
  if (!key) {
    key = randKey_();
    sh.getRange(row, COL.clientKey).setValue(key);
  }
  return { ok: true, num: String(num), key: key };
}

// Безопасный срез заказа по личному ключу (для status.html).
// Любая ошибка отвечает одинаково — «ссылка недействительна»,
// чтобы по ответам нельзя было перебирать номера заказов.
function clientStatus_(ss, num, key) {
  var bad = { ok: false, error: 'ссылка недействительна' };
  if (!num || !key) return bad;
  var sh = ss.getSheetByName(ORDERS_SHEET);
  if (!sh) return bad;
  var row = findRowByNum_(sh, String(num));
  if (row < 0) return bad;
  var stored = String(sh.getRange(row, COL.clientKey).getValue() || '');
  if (!stored || stored !== String(key)) return bad;
  // Фото, помеченные владельцем как «Клиенту» (только этого заказа)
  var photos = [];
  var att = attachList_(ss).attach || [];
  for (var i = 0; i < att.length; i++) {
    var a = att[i];
    if (String(a.num) === String(num) && a.kind === 'файл' && a.pub && a.fileId) {
      photos.push({ fileId: a.fileId, comment: a.comment });
    }
  }
  // История переходов этого заказа: последняя дата по каждому статусу.
  // Для старых заказов без журнала дата «Договора» берётся из карточки.
  var hist = {};
  var slSh = ss.getSheetByName(SLOG_SHEET);
  if (slSh && slSh.getLastRow() >= 2) {
    var slRows = slSh.getRange(2, 1, slSh.getLastRow() - 1, SLCOL.date).getValues();
    for (var j = 0; j < slRows.length; j++) {
      if (String(slRows[j][SLCOL.num - 1]) === String(num)) {
        hist[String(slRows[j][SLCOL.status - 1])] = slRows[j][SLCOL.date - 1];
      }
    }
  }
  var dogD = sh.getRange(row, COL.dogDate).getValue();
  if (!hist['Договор'] && dogD) hist['Договор'] = dogD;
  return {
    ok: true,
    order: {
      num: String(sh.getRange(row, COL.num).getValue()),
      status: String(sh.getRange(row, COL.status).getValue() || ''),
      furn: String(sh.getRange(row, COL.furn).getValue() || ''),
      dogDate: sh.getRange(row, COL.dogDate).getValue(),
      mountDate: sh.getRange(row, COL.mountDate).getValue(),
      photos: photos,
      history: hist
    }
  };
}


// ═══════════════ НАЧИСЛЕНИЕ ПОСТОЯННЫХ ЗА МЕСЯЦ ═══════════════
// month = 'YYYY-MM'. Создаёт в листе "Финансы" по одной проводке
// "Расход" на каждую активную строку "Постоянные" и каждый оклад
// активного сотрудника. Идемпотентно: каждая проводка помечается
// тегом [Постоянные YYYY-MM] / [Оклад YYYY-MM] в комментарии — если
// такой тег для месяца уже есть, повторное начисление её пропускает.
// Возвращает, сколько создано и сколько пропущено (уже было).
function accrueMonth_(ss, month) {
  var m = String(month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return { ok: false, error: 'месяц в формате ГГГГ-ММ' };
  var finSh = finSheet_(ss);
  // Собрать уже начисленные метки этого месяца (по комментарию)
  // v4.8: теги месяца привязаны к id записи — переименование строки
  // или сотрудника больше не рождает дубль при повторном начислении.
  // Старые проводки с тегом-по-имени тоже узнаются (legacyTag ниже).
  var cmtList = [];
  var last = finSh.getLastRow();
  if (last >= 2) {
    var cmts = finSh.getRange(2, FCOL.comment, last - 1, 1).getValues();
    for (var i = 0; i < cmts.length; i++) {
      var c = String(cmts[i][0] || '');
      if (c.indexOf('[') === 0) cmtList.push(c);
    }
  }
  function hasTag(t) {
    for (var j = 0; j < cmtList.length; j++) {
      if (cmtList[j].indexOf(t) === 0) return true;
    }
    return false;
  }
  var mp = m.split('-');
  var when = new Date(+mp[0], +mp[1] - 1, 1);
  var created = 0, skipped = 0;

  function addExpense(cat, sum, tagPrefix, legacyTag, name) {
    if (hasTag(tagPrefix) || hasTag(legacyTag)) { skipped++; return; }
    if (!(sum > 0)) return;
    var row = finSh.getLastRow() + 1;
    finSh.getRange(row, FCOL.id).setValue(String(Date.now()) + '-' + row);
    finSh.getRange(row, FCOL.date).setValue(when);
    finSh.getRange(row, FCOL.type).setValue('Расход');
    finSh.getRange(row, FCOL.cat).setValue(cat);
    finSh.getRange(row, FCOL.sum).setValue(Math.round(sum));
    finSh.getRange(row, FCOL.num).setValue('');
    finSh.getRange(row, FCOL.comment).setValue(tagPrefix + ' ' + name);
    finSh.getRange(row, FCOL.created).setValue(new Date());
    cmtList.push(tagPrefix + ' ' + name);
    created++;
  }

  // Постоянные (аренда и т.п.)
  var rec = recurList_(ss).recur || [];
  rec.forEach(function(x){
    if (!x.active || !(x.sum > 0)) return;
    addExpense(x.cat || 'Прочее', x.sum, '[Постоянные ' + m + ' #' + x.id + ']', '[Постоянные ' + m + '] ' + x.name, x.name);
  });
  // Оклады сотрудников
  var emp = empList_(ss).employees || [];
  emp.forEach(function(x){
    if (!x.active || !(x.salary > 0)) return;
    var cat = x.role === 'Дизайнер' ? 'Оплата дизайнеру' : 'Оплата мастеру';
    addExpense(cat, x.salary, '[Оклад ' + m + ' #' + x.id + ']', '[Оклад ' + m + '] ' + x.name, x.name);
  });

  return { ok: true, created: created, skipped: skipped, month: m };
}



// Раз в сутки копирует ВЕСЬ файл таблицы (заказы, финансы, снимки,
// прайсы) в папку Диска. Держит последние BACKUP_KEEP копий, старые —
// в корзину. Запуск: триггер по времени на функцию dailyBackup.
// Первый запуск сделай руками (Выполнить → dailyBackup) — Google
// спросит разрешение на Диск, это нормально, жми "Разрешить".
var BACKUP_FOLDER = 'MebelOFF Бэкапы';
var BACKUP_KEEP = 14;

function dailyBackup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var file = DriveApp.getFileById(ss.getId());
  var it = DriveApp.getFoldersByName(BACKUP_FOLDER);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(BACKUP_FOLDER);
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm');
  file.makeCopy('MebelOFF База — бэкап ' + stamp, folder);
  // ротация: свежие оставляем, лишние — в корзину
  var files = [];
  var fit = folder.getFiles();
  while (fit.hasNext()) {
    var f = fit.next();
    if (f.getName().indexOf('MebelOFF База — бэкап ') === 0) files.push(f);
  }
  files.sort(function(a, b) { return b.getDateCreated() - a.getDateCreated(); });
  for (var i = BACKUP_KEEP; i < files.length; i++) files[i].setTrashed(true);
}
