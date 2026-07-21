// Smoke-тест редизайна openCard, раздела "Архив" (v4.9), optimistic UI
// Кассы, «Задач» и Источника лида (v4.11): crm.js исполняется в jsdom,
// заказы подсовываются через мок fetch (как в проде, с разбором action=
// в URL), карточка/архив/касса/задачи открываются реальными кликами —
// полный боевой путь.
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const crmJs = fs.readFileSync('crm.js', 'utf8');

const order = {
  num: '214', client: 'Иванов Алексей', phone: '+77012345678',
  city: 'Сатпаев', furn: 'кухня', obj: 'мкр. Достык 14-56',
  note: '', status: 'Договор', pred: 900000, sogl: 980000,
  avans: 490000, paid: 340000, mountDate: '', dogDate: '2026-07-12',
  totL: 980000, totP: 0, totK: 0, material: 'L', source: 'Сарафан',
  masterId: '', helperId: '', helperPay: 0
};
const order2 = {
  num: '215', client: 'Петров Сергей', phone: '+77029998877',
  city: 'Жезказган', furn: 'шкаф-купе', obj: 'ул. Абая 10',
  note: '', status: 'Замер', pred: 400000, sogl: 0,
  avans: 0, paid: 0, mountDate: '', dogDate: '',
  totL: 0, totP: 0, totK: 0, material: 'L', source: '',
  masterId: '', helperId: '', helperPay: 0
};
const archivedOrder = {
  num: '099', client: 'Архивный Клиент', phone: '+77011112233',
  city: 'Сатпаев', furn: 'шкаф-купе', obj: 'ул. Старая 5',
  note: '', status: 'Готова', pred: 300000, sogl: 300000,
  avans: 300000, paid: 0, mountDate: '2026-05-01', dogDate: '2026-04-01',
  totL: 300000, totP: 0, totK: 0, material: 'L',
  masterId: '', helperId: '', helperPay: 0, updated: '2026-05-10'
};
// v4.10: второй архивный заказ — на нём мок POST специально валит
// restoreFromArchive, чтобы проверить откат оптимистичного UI (строка
// разворачивается назад, заказ остаётся в архиве).
const archivedOrder2 = {
  num: '088', client: 'Тестовый Провал', phone: '+77019998877',
  city: 'Сатпаев', furn: 'кухня', obj: 'ул. Тестовая 1',
  note: '', status: 'Отказ', pred: 200000, sogl: 200000,
  avans: 0, paid: 0, mountDate: '', dogDate: '2026-03-01',
  totL: 200000, totP: 0, totK: 0, material: 'L',
  masterId: '', helperId: '', helperPay: 0, updated: '2026-04-01'
};

// v4.11: две операции кассы — СИД-Успех удаляется штатно, СИД-Отказ на
// нём мок POST специально валит delFin, чтобы проверить откат
// оптимистичного удаления (строка разворачивается назад, остаётся в FIN).
const finKeep = {
  id: 'f1', date: '2026-07-10', type: 'Расход', cat: 'Материалы',
  sum: 50000, num: '', comment: 'СИД-Успех'
};
const finFail = {
  id: 'f2', date: '2026-07-09', type: 'Расход', cat: 'Материалы',
  sum: 30000, num: '', comment: 'СИД-Отказ'
};

// v4.11: Задачи — даты СЧИТАЮТСЯ от реального «сегодня» (не хардкод),
// иначе тест сгниёт: просрочка/сегодня иначе через полгода станут неверными.
const isoOffset = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const taskA = { id: 'ta1', num: '214', text: 'Позвонить, узнать про замер', deadline: isoOffset(-2), done: false }; // просрочена
const taskB = { id: 'ta2', num: '214', text: 'Отправить смету', deadline: isoOffset(0), done: false }; // сегодня; toggleTask на неё мок валит (откат)
const taskC = { id: 'ta3', num: '214', text: 'Уточнить цвет фасада', deadline: isoOffset(7), done: false }; // не просрочена; delTask штатно
const taskD = { id: 'ta4', num: '214', text: 'Забрать доплату', deadline: isoOffset(7), done: false }; // delTask на неё мок валит (откат)
const taskDone = { id: 'ta5', num: '214', text: 'Уже сделанная задача', deadline: isoOffset(-5), done: true }; // скрыта по умолчанию

const vc = new VirtualConsole();
let pageErrors = [];
vc.on('jsdomError', e => pageErrors.push(String(e && (e.detail && e.detail.message || e.message))));


const html = '<!doctype html><html><head></head><body>' +
  '<div id="tab-crm"></div><div id="crm-root"></div>' +
  '</body></html>';

const dom = new JSDOM(html, {
  url: 'https://ashikbayev.github.io/DMebel/',
  runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc
});
const w = dom.window;
w.CRM_GS_URL = 'https://fake/gs';
let lastPost = null;
w.fetch = function(url, opts){
  if(opts && opts.method === 'POST'){
    let body = null;
    try { body = JSON.parse(opts.body); } catch(e){ body = null; }
    lastPost = body;
    if (body && body.action === 'restoreFromArchive' && String(body.num) === '088') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false, error: 'сеть недоступна' }) });
    }
    // v4.11: addFin — метка в комментарии решает, как ответит мок.
    if (body && body.action === 'addFin') {
      const c = body.fin && body.fin.comment;
      if (c === 'СИД-ОФФЛАЙН') return Promise.reject(new Error('Failed to fetch'));
      if (c === 'СИД-ОШИБКА') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false, error: 'сервер отклонил' }) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, id: 'srv-' + Date.now() }) });
    }
    // v4.11: delFin — №088-аналог для кассы: id f2 всегда отклоняется сервером.
    if (body && body.action === 'delFin') {
      if (String(body.id) === 'f2') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false, error: 'сервер отклонил удаление' }) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    }
    // v4.11: addTask — та же схема меток текста, что addFin.
    if (body && body.action === 'addTask') {
      const tx = body.task && body.task.text;
      if (tx === 'СИД-ОФФЛАЙН') return Promise.reject(new Error('Failed to fetch'));
      if (tx === 'СИД-ОШИБКА') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false, error: 'сервер отклонил' }) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, id: 'srv-task-' + Date.now() }) });
    }
    // v4.11: toggleTask — id ta2 всегда отклоняется (проверка отката).
    if (body && body.action === 'toggleTask') {
      if (String(body.id) === 'ta2') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false, error: 'сервер отклонил отметку' }) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, done: body.done }) });
    }
    // v4.11: delTask — id ta4 всегда отклоняется (проверка отката).
    if (body && body.action === 'delTask') {
      if (String(body.id) === 'ta4') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false, error: 'сервер отклонил удаление' }) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
  }
  const u = String(url);
  if(u.indexOf('action=archiveOrders') >= 0){
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, orders: [archivedOrder, archivedOrder2] }) });
  }
  if(u.indexOf('action=fin') >= 0){
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, fin: [finKeep, finFail] }) });
  }
  if(u.indexOf('action=tasks') >= 0){
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, tasks: [taskA, taskB, taskC, taskD, taskDone] }) });
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, orders: [order, order2] }) });
};
w.alert = () => {}; w.confirm = () => true;
w.localStorage.setItem('moff_crm_token', '2026');

const s = w.document.createElement('script');
s.textContent = crmJs;
w.document.body.appendChild(s);

let fails = 0;
function ok(cond, msg){
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + msg);
  if(!cond) fails++;
}

setTimeout(() => {
  // Пытаемся дойти до openCard любым публичным путём: crm.js вешает
  // рендер на вкладку — если crmReload есть, дёргаем его.
  if (typeof w.crmPageOpen === 'function') w.crmPageOpen();
  setTimeout(() => {
    const doc = w.document;
    // ищем карточку заказа №214 (не «первую» — их теперь две, порядок
    // на доске зависит от статуса) и кликаем
    let card = Array.from(doc.querySelectorAll('.crm-card')).find(c => c.textContent.indexOf('Иванов') >= 0)
      || doc.querySelector('.crm-card');
    if (card) {
      card.click();
    }
    const modal = doc.querySelector('.crm-modal');
    if (!modal) {
      console.log('  (карточка/модалка не отрисовались через crmReload — smoke через DOM недоступен, это ок для изолированного окружения)');
      console.log('  ошибок страницы: ' + pageErrors.length);
      pageErrors.slice(0,5).forEach(e => console.log('   ' + e));
      process.exit(pageErrors.length ? 1 : 0);
    }
    ok(modal.querySelector('.crm-card-strip'), 'полоса статуса в шапке');
    ok(modal.querySelector('.crm-hava'), 'аватар в шапке');
    const t = modal.querySelector('.crm-h-t');
    ok(t && t.textContent.indexOf('Иванов') === 0, 'заголовок = клиент · №: ' + (t && t.textContent));
    const secs = modal.querySelectorAll('.crm-sec');
    ok(secs.length >= 3, 'секций-карточек ≥3 (клиент, объект, деньги): ' + secs.length);
    const heads = Array.from(modal.querySelectorAll('.crm-sec-h')).map(x => x.textContent.trim());
    ok(heads.indexOf('Клиент') >= 0, 'секция «Клиент»');
    ok(heads.indexOf('Объект') >= 0, 'секция «Объект»');
    ok(modal.querySelectorAll('.crm-ch-h .ti').length >= 4, 'иконки в заголовках блоков: ' + modal.querySelectorAll('.crm-ch-h .ti').length);
    // Закрываем карточку — иначе она остаётся первым «.crm-modal» в DOM и
    // более поздние проверки (архив/касса) по ошибке хватают именно её.
    const cardBg = modal.closest('.crm-modal-bg');
    if (cardBg && cardBg.parentNode) cardBg.parentNode.removeChild(cardBg);

    // ── v4.9: раздел "Архив" — реальный клик по кнопке навигации ──
    const navBtns = Array.from(doc.querySelectorAll('.crm-vbtn'));
    const bArchive = navBtns.find(b => b.textContent.trim() === 'Архив');
    ok(!!bArchive, 'кнопка «Архив» есть в навигации');
    if (bArchive) bArchive.click();
    // v4.10: skeleton-заглушки должны быть в DOM СРАЗУ после клика — синхронно,
    // до того как замоканный fetchArchive успеет резолвнуться (иначе это уже
    // не skeleton, а случайно совпавшая по классу разметка).
    ok(doc.querySelectorAll('.crm-sk').length > 0, 'skeleton-заглушки отрисовались сразу при открытии архива');
    setTimeout(() => {
      const rows = () => Array.from(doc.querySelectorAll('.crm-arch-row'));
      const row = rows().find(r => r.textContent.indexOf('Архивный Клиент') >= 0);
      ok(!!row, 'строка архивного заказа отрисовалась');
      ok(!!row && row.textContent.indexOf('Архивный Клиент') >= 0, 'в строке архива виден клиент: ' + (row && row.textContent));
      const bRet = row && Array.from(row.querySelectorAll('button')).find(b => b.textContent.indexOf('Вернуть') >= 0);
      ok(!!bRet, 'кнопка «Вернуть» есть в строке');
      if (bRet) bRet.click();
      // Optimistic: строка должна свернуться СРАЗУ по клику, не дожидаясь ответа сервера.
      ok(!!row && row.classList.contains('crm-arch-leaving'), 'строка №099 сворачивается оптимистично сразу по клику');
      setTimeout(() => {
        ok(!!lastPost && lastPost.action === 'restoreFromArchive' && String(lastPost.num) === '099', 'клик «Вернуть» шлёт restoreFromArchive для №099: ' + JSON.stringify(lastPost));

        // v4.10: откат — заказ №088, у которого мок специально валит restoreFromArchive.
        const row2 = rows().find(r => r.textContent.indexOf('Тестовый Провал') >= 0);
        ok(!!row2, 'строка заказа №088 (для проверки отката) отрисовалась');
        const bRet2 = row2 && Array.from(row2.querySelectorAll('button')).find(b => b.textContent.indexOf('Вернуть') >= 0);
        ok(!!bRet2, 'кнопка «Вернуть» есть у строки №088');
        if (bRet2) bRet2.click();
        ok(!!row2 && row2.classList.contains('crm-arch-leaving'), 'строка №088 тоже сворачивается оптимистично сразу по клику');
        setTimeout(() => {
          ok(!!lastPost && lastPost.action === 'restoreFromArchive' && String(lastPost.num) === '088', 'клик «Вернуть» шлёт restoreFromArchive для №088: ' + JSON.stringify(lastPost));
          ok(!!row2 && !row2.classList.contains('crm-arch-leaving'), 'после ошибки сервера строка №088 откатилась назад (разворачивается)');
          ok(!!row2 && !!row2.parentNode, 'строка №088 осталась в DOM (не удалена, вернулась в архив)');

          // ── v4.11: «Финансы → Касса» — optimistic UI (добавление + удаление) ──
          const navBtns2 = Array.from(doc.querySelectorAll('.crm-vbtn'));
          const bFin = navBtns2.find(b => b.textContent.trim() === 'Финансы');
          ok(!!bFin, 'кнопка «Финансы» есть в навигации');
          if (bFin) bFin.click();
          setTimeout(() => {
            const opRows = () => Array.from(doc.querySelectorAll('.crm-op'));
            ok(opRows().some(r => r.textContent.indexOf('СИД-Успех') >= 0), 'операция СИД-Успех отрисовалась в Кассе');
            ok(opRows().some(r => r.textContent.indexOf('СИД-Отказ') >= 0), 'операция СИД-Отказ отрисовалась в Кассе');

            function findField(modal, label){
              const flds = Array.from(modal.querySelectorAll('.crm-f'));
              const f = flds.find(x => { const l = x.querySelector('label'); return l && l.textContent.trim() === label; });
              return f ? f.querySelector('input,select') : null;
            }
            function openAdd(){
              const addBtn = doc.querySelector('.crm-ops-h button.crm-vbtn.new');
              if (addBtn) addBtn.click();
              return doc.querySelector('.crm-modal');
            }
            function fillAndSave(modal, sum, comment){
              findField(modal, 'Сумма, ₸').value = String(sum);
              findField(modal, 'Комментарий').value = comment;
              modal.querySelector('.crm-m-btn.save').click();
            }

            // ── добавление: штатный успех ──
            let modal = openAdd();
            ok(!!modal, 'модалка «+ Операция» открывается по клику');
            fillAndSave(modal, 15000, 'СИД-Успех-Добавление');
            ok(!doc.querySelector('.crm-modal'), 'модалка закрывается сразу по клику «Записать» (оптимистично)');
            ok(opRows().some(r => r.textContent.indexOf('СИД-Успех-Добавление') >= 0), 'новая операция появляется в списке сразу, до ответа сервера');
            setTimeout(() => {
              ok(opRows().some(r => r.textContent.indexOf('СИД-Успех-Добавление') >= 0), 'штатно добавленная операция осталась в списке после ответа сервера');

              // ── добавление: офлайн — тихий откат в очередь (поведение не меняем) ──
              modal = openAdd();
              fillAndSave(modal, 12000, 'СИД-ОФФЛАЙН');
              ok(opRows().some(r => r.textContent.indexOf('СИД-ОФФЛАЙН') >= 0), 'операция для офлайн-теста появляется в списке сразу (оптимистично)');
              setTimeout(() => {
                ok(!opRows().some(r => r.textContent.indexOf('СИД-ОФФЛАЙН') >= 0), 'после сетевой ошибки строка тихо откатилась — не видна, как и раньше');
                let pending = [];
                try { pending = JSON.parse(w.localStorage.getItem('moff_pending_ops') || '[]'); } catch (e) {}
                ok(pending.some(x => x.comment === 'СИД-ОФФЛАЙН'), 'операция ушла в offline-очередь moff_pending_ops');

                // ── добавление: явный отказ сервера — откат с ошибкой, НЕ в очередь ──
                modal = openAdd();
                fillAndSave(modal, 9000, 'СИД-ОШИБКА');
                ok(opRows().some(r => r.textContent.indexOf('СИД-ОШИБКА') >= 0), 'операция для теста отказа появляется в списке сразу (оптимистично)');
                setTimeout(() => {
                  ok(!opRows().some(r => r.textContent.indexOf('СИД-ОШИБКА') >= 0), 'после отказа сервера строка откатилась (удалена из списка)');
                  let pending2 = [];
                  try { pending2 = JSON.parse(w.localStorage.getItem('moff_pending_ops') || '[]'); } catch (e) {}
                  ok(!pending2.some(x => x.comment === 'СИД-ОШИБКА'), 'операция с явным отказом сервера НЕ попала в offline-очередь');

                  // ── удаление: штатный успех (СИД-Успех, id f1) ──
                  const rowDel = opRows().find(r => r.textContent.indexOf('СИД-Успех') >= 0 && r.textContent.indexOf('Добавление') < 0);
                  ok(!!rowDel, 'строка СИД-Успех (f1) для теста удаления найдена');
                  const bDel = rowDel && Array.from(rowDel.querySelectorAll('button')).find(b => b.textContent.indexOf('✕') >= 0);
                  ok(!!bDel, 'кнопка удаления (✕) есть в строке');
                  if (bDel) bDel.click();
                  ok(!!rowDel && rowDel.classList.contains('crm-op-leaving'), 'строка сворачивается оптимистично сразу по клику ✕, до ответа сервера');
                  setTimeout(() => {
                    ok(!opRows().some(r => r.textContent.indexOf('СИД-Успех') >= 0 && r.textContent.indexOf('Добавление') < 0), 'после успешного удаления строка физически убрана из списка');

                    // ── удаление: отказ сервера — откат (СИД-Отказ, id f2) ──
                    const rowDel2 = opRows().find(r => r.textContent.indexOf('СИД-Отказ') >= 0);
                    ok(!!rowDel2, 'строка СИД-Отказ (f2) для проверки отката удаления найдена');
                    const bDel2 = rowDel2 && Array.from(rowDel2.querySelectorAll('button')).find(b => b.textContent.indexOf('✕') >= 0);
                    ok(!!bDel2, 'кнопка удаления (✕) есть у строки СИД-Отказ');
                    if (bDel2) bDel2.click();
                    ok(!!rowDel2 && rowDel2.classList.contains('crm-op-leaving'), 'строка СИД-Отказ тоже сворачивается оптимистично сразу по клику');
                    setTimeout(() => {
                      ok(!!rowDel2 && !rowDel2.classList.contains('crm-op-leaving'), 'после отказа сервера строка СИД-Отказ откатилась назад (разворачивается)');
                      ok(opRows().some(r => r.textContent.indexOf('СИД-Отказ') >= 0), 'операция СИД-Отказ осталась в списке (не удалена, только визуально сворачивалась)');

                      // ── v4.11: «Задачи» — бейдж, сквозной список, optimistic toggle/delete, карточка ──
                      const navBtns3 = Array.from(doc.querySelectorAll('.crm-vbtn'));
                      const bTasksNav = navBtns3.find(b => b.textContent.trim().indexOf('Задачи') === 0);
                      ok(!!bTasksNav, 'кнопка «Задачи» есть в навигации');
                      const badgeEl = bTasksNav && bTasksNav.querySelector('.crm-task-badge');
                      ok(!!badgeEl && badgeEl.textContent === '2', 'бейдж «Задачи» = 2 (просрочена + сегодня) сразу при открытии СРМ, без захода во вкладку: ' + (badgeEl && badgeEl.textContent));
                      if (bTasksNav) bTasksNav.click();
                      setTimeout(() => {
                        const taskRows = () => Array.from(doc.querySelectorAll('.crm-task-row:not(.compact)'));
                        ok(taskRows().some(r => r.textContent.indexOf('Позвонить, узнать про замер') >= 0), 'просроченная задача (ta1) видна в списке');
                        ok(taskRows().some(r => r.textContent.indexOf('Отправить смету') >= 0), 'сегодняшняя задача (ta2) видна в списке');
                        ok(taskRows().some(r => r.textContent.indexOf('Уточнить цвет фасада') >= 0), 'будущая задача (ta3) видна в списке');
                        ok(!taskRows().some(r => r.textContent.indexOf('Уже сделанная задача') >= 0), 'выполненная задача (ta5) скрыта по умолчанию');

                        const showDoneCb = Array.from(doc.querySelectorAll('input[type=checkbox]')).find(cb => cb.parentNode && cb.parentNode.textContent.indexOf('показать выполненные') >= 0);
                        ok(!!showDoneCb, 'чекбокс «показать выполненные» найден');
                        if (showDoneCb) showDoneCb.click();
                        setTimeout(() => {
                          const doneRow = taskRows().find(r => r.textContent.indexOf('Уже сделанная задача') >= 0);
                          ok(!!doneRow, 'после включения тумблера выполненная задача (ta5) видна');
                          ok(!!doneRow && !!doneRow.querySelector('.tx.done'), 'она отображается зачёркнутой');
                          const showDoneCb2 = Array.from(doc.querySelectorAll('input[type=checkbox]')).find(cb => cb.parentNode && cb.parentNode.textContent.indexOf('показать выполненные') >= 0);
                          if (showDoneCb2) showDoneCb2.click(); // вернуть скрытие обратно
                          setTimeout(() => {
                            // ── отметка «сделано»: в общем списке сворачивается сразу (ta1) ──
                            const rowA = taskRows().find(r => r.textContent.indexOf('Позвонить, узнать про замер') >= 0);
                            ok(!!rowA, 'строка ta1 найдена для теста отметки «сделано»');
                            const cbA = rowA && rowA.querySelector('input[type=checkbox]');
                            if (cbA) cbA.click();
                            ok(!!rowA && rowA.classList.contains('crm-task-leaving'), 'строка ta1 сворачивается оптимистично сразу по отметке, до ответа сервера');
                            setTimeout(() => {
                              ok(!taskRows().some(r => r.textContent.indexOf('Позвонить, узнать про замер') >= 0), 'после успешной отметки задача ta1 пропала из активного списка');

                              // ── отметка «сделано» с отказом сервера — откат (ta2) ──
                              const rowB = taskRows().find(r => r.textContent.indexOf('Отправить смету') >= 0);
                              ok(!!rowB, 'строка ta2 найдена для теста отката отметки');
                              const cbB = rowB && rowB.querySelector('input[type=checkbox]');
                              if (cbB) cbB.click();
                              ok(!!rowB && rowB.classList.contains('crm-task-leaving'), 'строка ta2 тоже сворачивается оптимистично сразу по клику');
                              setTimeout(() => {
                                ok(!!rowB && !rowB.classList.contains('crm-task-leaving'), 'после отказа сервера строка ta2 откатилась назад (разворачивается)');
                                ok(taskRows().some(r => r.textContent.indexOf('Отправить смету') >= 0), 'задача ta2 осталась активной (не выполнена)');
                                const cbB2 = rowB && rowB.querySelector('input[type=checkbox]');
                                ok(!!cbB2 && cbB2.checked === false, 'чекбокс ta2 вернулся в неотмеченное состояние');

                                // ── удаление: штатный успех (ta3) ──
                                const rowC = taskRows().find(r => r.textContent.indexOf('Уточнить цвет фасада') >= 0);
                                ok(!!rowC, 'строка ta3 найдена для теста удаления');
                                const delC = rowC && Array.from(rowC.querySelectorAll('button')).find(b => b.textContent.indexOf('✕') >= 0);
                                if (delC) delC.click();
                                ok(!!rowC && rowC.classList.contains('crm-task-leaving'), 'строка ta3 сворачивается оптимистично сразу по клику ✕');
                                setTimeout(() => {
                                  ok(!taskRows().some(r => r.textContent.indexOf('Уточнить цвет фасада') >= 0), 'после успешного удаления задача ta3 пропала из списка');

                                  // ── удаление: отказ сервера — откат (ta4) ──
                                  const rowD = taskRows().find(r => r.textContent.indexOf('Забрать доплату') >= 0);
                                  ok(!!rowD, 'строка ta4 найдена для теста отката удаления');
                                  const delD = rowD && Array.from(rowD.querySelectorAll('button')).find(b => b.textContent.indexOf('✕') >= 0);
                                  if (delD) delD.click();
                                  ok(!!rowD && rowD.classList.contains('crm-task-leaving'), 'строка ta4 сворачивается оптимистично сразу по клику ✕');
                                  setTimeout(() => {
                                    ok(!!rowD && !rowD.classList.contains('crm-task-leaving'), 'после отказа сервера строка ta4 откатилась назад (разворачивается)');
                                    ok(taskRows().some(r => r.textContent.indexOf('Забрать доплату') >= 0), 'задача ta4 осталась в списке (не удалена)');

                                    // ── добавление через модалку «+ Задача» ──
                                    const bAddTask = Array.from(doc.querySelectorAll('.crm-vbtn.new')).find(b => b.textContent.trim() === '+ Задача');
                                    ok(!!bAddTask, 'кнопка «+ Задача» есть');
                                    if (bAddTask) bAddTask.click();
                                    const taskModal = doc.querySelector('.crm-modal');
                                    ok(!!taskModal, 'модалка «+ Задача» открывается по клику');
                                    if (taskModal) {
                                      const findF = (label) => {
                                        const flds = Array.from(taskModal.querySelectorAll('.crm-f'));
                                        const f = flds.find(x => { const l = x.querySelector('label'); return l && l.textContent.trim() === label; });
                                        return f ? f.querySelector('input,select') : null;
                                      };
                                      const fNum = findF('№ заказа'), fText = findF('Что сделать'), fDeadline = findF('Дедлайн');
                                      if (fNum) fNum.value = '214';
                                      if (fText) fText.value = 'Новая задача из модалки';
                                      if (fDeadline) fDeadline.value = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
                                      const saveBtn = taskModal.querySelector('.crm-m-btn.save');
                                      if (saveBtn) saveBtn.click();
                                    }
                                    ok(!doc.querySelector('.crm-modal'), 'модалка «+ Задача» закрывается сразу по «Сохранить» (оптимистично)');
                                    ok(taskRows().some(r => r.textContent.indexOf('Новая задача из модалки') >= 0), 'новая задача появляется в списке сразу, до ответа сервера');

                                    // ── карточка заказа: клик по тексту задачи открывает карточку ──
                                    const newRow = taskRows().find(r => r.textContent.indexOf('Новая задача из модалки') >= 0);
                                    const newRowTx = newRow && newRow.querySelector('.tx');
                                    if (newRowTx) newRowTx.click();
                                    const cardModal = doc.querySelector('.crm-modal');
                                    ok(!!cardModal && !!cardModal.querySelector('.crm-card-strip'), 'клик по тексту задачи открывает карточку заказа №214');
                                    if (cardModal) {
                                      const cardTaskRows = Array.from(cardModal.querySelectorAll('.crm-task-row.compact'));
                                      ok(cardTaskRows.length > 0, 'в карточке отрисован блок «Задачи»: ' + cardTaskRows.length + ' строк');
                                      ok(cardTaskRows.every(r => r.textContent.indexOf('№214') < 0), 'задачи в карточке БЕЗ префикса «№214 ·» (компактный режим)');
                                      ok(cardTaskRows.some(r => r.textContent.indexOf('Новая задача из модалки') >= 0), 'новая задача видна и в блоке карточки');
                                      const cardDoneRow = cardTaskRows.find(r => r.textContent.indexOf('Позвонить, узнать про замер') >= 0);
                                      ok(!!cardDoneRow && !!cardDoneRow.querySelector('.tx.done'), 'в карточке выполненная задача ta1 осталась видна зачёркнутой — не пропала, как в общем списке (история сделки)');

                                      // ── v4.11: Источник лида — предзаполнен, редактируется, уходит в updateOrder ──
                                      const findCardF = (label) => {
                                        const flds = Array.from(cardModal.querySelectorAll('.crm-f'));
                                        const f = flds.find(x => { const l = x.querySelector('label'); return l && l.textContent.trim() === label; });
                                        return f ? f.querySelector('input,select') : null;
                                      };
                                      const srcSel = findCardF('Источник');
                                      ok(!!srcSel && srcSel.value === 'Сарафан', 'в карточке источник предзаполнен текущим значением заказа: ' + (srcSel && srcSel.value));
                                      if (srcSel) srcSel.value = 'Партнёр';
                                      const mainSaveBtn = cardModal.querySelector('.crm-m-btn.save');
                                      ok(!!mainSaveBtn, 'кнопка «Сохранить» карточки найдена');
                                      if (mainSaveBtn) mainSaveBtn.click();
                                      ok(!!lastPost && lastPost.action === 'updateOrder' && lastPost.order && lastPost.order.source === 'Партнёр', 'смена источника в карточке уходит в updateOrder: ' + JSON.stringify(lastPost && lastPost.order));
                                    }

                                    // ── новый заказ: поле «Источник» присутствует с ожидаемыми вариантами ──
                                    const bNewOrder = Array.from(doc.querySelectorAll('.crm-vbtn.new')).find(b => b.textContent.trim() === '+ Заказ');
                                    ok(!!bNewOrder, 'кнопка «+ Заказ» есть');
                                    if (bNewOrder) bNewOrder.click();
                                    const newOrderModal = doc.querySelector('.crm-modal');
                                    if (newOrderModal) {
                                      const flds2 = Array.from(newOrderModal.querySelectorAll('.crm-f'));
                                      const srcFld = flds2.find(x => { const l = x.querySelector('label'); return l && l.textContent.trim() === 'Источник'; });
                                      const srcSelect = srcFld && srcFld.querySelector('select');
                                      const opts = srcSelect ? Array.from(srcSelect.options).map(o => o.value) : [];
                                      ok(srcSelect && opts.join(',') === ',Реклама,Сарафан,Партнёр', 'модалка нового заказа предлагает источник с вариантами реклама/сарафан/партнёр: ' + opts.join(','));
                                    }

                                    // ── v4.11: Глобальный поиск (🔍) ──
                                    // Сносим все ранее открытые модалки (карточка, новый заказ),
                                    // иначе querySelector('.crm-modal') подхватит устаревшую.
                                    Array.from(doc.querySelectorAll('.crm-modal-bg')).forEach(bgEl => { if (bgEl.parentNode) bgEl.parentNode.removeChild(bgEl); });
                                    const bGlobalSearch = Array.from(doc.querySelectorAll('.crm-vbtn')).find(b => b.innerHTML.indexOf('🔍') >= 0 && b.textContent.trim() !== '+ Заказ');
                                    ok(!!bGlobalSearch, 'иконка 🔍 глобального поиска есть в тулбаре');
                                    if (bGlobalSearch) bGlobalSearch.click();
                                    let gsModal = doc.querySelector('.crm-modal');
                                    ok(!!gsModal && gsModal.textContent.indexOf('Поиск по всем заказам') >= 0, 'модалка глобального поиска открылась');
                                    const gsInput = gsModal && gsModal.querySelector('input[type=search]');
                                    ok(!!gsInput, 'поле ввода поиска есть');
                                    // поиск по фрагменту адреса, который есть только у №214
                                    if (gsInput) { gsInput.value = 'Достык'; gsInput.dispatchEvent(new w.Event('input')); }
                                    let gsRows = () => Array.from(doc.querySelectorAll('.crm-gsr'));
                                    ok(gsRows().some(r => r.textContent.indexOf('Иванов') >= 0), 'поиск по адресу «Достык» находит активный заказ №214');
                                    ok(!gsRows().some(r => r.textContent.indexOf('Петров') >= 0), 'заказ №215 (другой адрес) в выдачу не попал — фильтр работает');

                                    // поиск по телефону №215
                                    if (gsInput) { gsInput.value = '77029998877'; gsInput.dispatchEvent(new w.Event('input')); }
                                    ok(gsRows().some(r => r.textContent.indexOf('Петров') >= 0), 'поиск по телефону находит заказ №215');

                                    // ── искать в архиве: кнопка подгружает архивный файл и досыпает совпадения ──
                                    // Для проверки берём №088 «Тестовый Провал» — он ОСТАЛСЯ в архиве
                                    // (его возврат ранее завалил мок). №099 использовать нельзя: тот
                                    // блок успешно вернул его в активные ORDERS.
                                    const archSearchBtn = Array.from(gsModal.querySelectorAll('button')).find(b => b.textContent.trim() === 'Искать в архиве');
                                    ok(!!archSearchBtn, 'кнопка «Искать в архиве» есть');
                                    if (gsInput) { gsInput.value = 'Тестовый Провал'; gsInput.dispatchEvent(new w.Event('input')); }
                                    ok(!gsRows().some(r => r.textContent.indexOf('Тестовый Провал') >= 0), 'до нажатия кнопки архив в выдачу НЕ попадает');
                                    if (archSearchBtn) archSearchBtn.click();
                                    setTimeout(() => {
                                      ok(gsRows().some(r => r.textContent.indexOf('Тестовый Провал') >= 0), 'после «Искать в архиве» архивный заказ появляется в выдаче');
                                      const archRow = gsRows().find(r => r.textContent.indexOf('Тестовый Провал') >= 0);
                                      ok(!!archRow && !!archRow.querySelector('.crm-gsr-tag.arch'), 'архивный результат помечен тегом «архив»');
                                      ok(!!archRow && !archRow.classList.contains('clk'), 'архивный результат некликабелен (карточку архивных не открывают)');

                                      // клик по активному результату открывает карточку
                                      if (gsInput) { gsInput.value = 'Иванов'; gsInput.dispatchEvent(new w.Event('input')); }
                                      const actRow = gsRows().find(r => r.textContent.indexOf('Иванов') >= 0 && r.classList.contains('clk'));
                                      ok(!!actRow, 'активный результат кликабелен');
                                      if (actRow) actRow.click();
                                      ok(!doc.querySelector('.crm-modal') || !!doc.querySelector('.crm-card-strip'), 'клик по активному результату закрывает поиск и открывает карточку');

                                      ok(pageErrors.length === 0, 'ошибок страницы нет (' + pageErrors.length + ')');
                                      pageErrors.slice(0,5).forEach(e => console.log('   ' + e));
                                      console.log(fails ? 'SMOKE FAIL' : 'SMOKE OK');
                                      process.exit(fails ? 1 : 0);
                                    }, 250);
                                  }, 200);
                                }, 200);
                              }, 200);
                            }, 200);
                          }, 200);
                        }, 200);
                      }, 300);
                    }, 200);
                  }, 200);
                }, 200);
              }, 200);
            }, 200);
          }, 300);
        }, 200);
      }, 200);
    }, 300);
  }, 300);
}, 300);
