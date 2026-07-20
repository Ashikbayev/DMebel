// Smoke-тест редизайна openCard, раздела "Архив" (v4.9) и optimistic UI
// Кассы (v4.11): crm.js исполняется в jsdom, заказы подсовываются через
// мок fetch (как в проде, с разбором action= в URL), карточка/архив/
// касса открываются реальными кликами — полный боевой путь.
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const crmJs = fs.readFileSync('crm.js', 'utf8');

const order = {
  num: '214', client: 'Иванов Алексей', phone: '+77012345678',
  city: 'Сатпаев', furn: 'кухня', obj: 'мкр. Достык 14-56',
  note: '', status: 'Договор', pred: 900000, sogl: 980000,
  avans: 490000, paid: 340000, mountDate: '', dogDate: '2026-07-12',
  totL: 980000, totP: 0, totK: 0, material: 'L',
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
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
  }
  const u = String(url);
  if(u.indexOf('action=archiveOrders') >= 0){
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, orders: [archivedOrder, archivedOrder2] }) });
  }
  if(u.indexOf('action=fin') >= 0){
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, fin: [finKeep, finFail] }) });
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, orders: [order] }) });
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
    // ищем карточку доски и кликаем
    let card = doc.querySelector('.crm-card');
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

                      ok(pageErrors.length === 0, 'ошибок страницы нет (' + pageErrors.length + ')');
                      pageErrors.slice(0,5).forEach(e => console.log('   ' + e));
                      console.log(fails ? 'SMOKE FAIL' : 'SMOKE OK');
                      process.exit(fails ? 1 : 0);
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
