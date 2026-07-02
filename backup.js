// ============================================================
// MebelOFF — Резервное копирование (экспорт/импорт всех данных)
// ============================================================
// ПОЛНОСТЬЮ ИЗОЛИРОВАННЫЙ МОДУЛЬ.
// Не импортирует и не вызывает ничего из main.js / wardrobe.js —
// работает напрямую с localStorage по известным ключам. main.js/
// wardrobe.js ничего не знают о существовании этого файла.
// Единственная точка контакта со страницей — кнопка, которую этот
// файл сам добавляет в футер (#panel-footer), либо плавающая
// кнопка, если футер не найден.
//
// ВСЕ данные приложения живут только в localStorage браузера —
// это резервная копия на случай очистки кэша/смены компьютера.
// Экспорт скачивает один .json файл, импорт восстанавливает всё
// обратно (перезаписывает текущие данные).
// ============================================================
(function(){
  'use strict';

  // Статические ключи приложения (main.js + wardrobe.js).
  // ВАЖНО: 'moff_ai_key' (API-ключ ИИ) сюда намеренно НЕ включён —
  // это чувствительные данные, в бэкап-файл не попадают.
  var STATIC_KEYS = [
    'mebeloff_hist',            // история расчётов
    'mebeloff_sec_templates',   // шаблоны наполнения секций шкафа
    'moff_managers',            // список менеджеров
    'wc_catalog',                // каталог/выбор материалов шкафа
    'wc_hw',                     // фурнитура (петли/направляющие) шкафа
    'wc_prices',                 // прайс-лист
    'wc_proj_index',             // индекс сохранённых проектов шкафа
    'k_proj_index'                // индекс сохранённых проектов кухни
  ];
  var WARDROBE_PROJ_PREFIX = 'wc_proj_';
  var KITCHEN_PROJ_PREFIX  = 'k_proj_';

  function safeParseArr(raw){
    try{ var v=JSON.parse(raw||'[]'); return Array.isArray(v)?v:[]; }
    catch(e){ return []; }
  }

  function collectAllData(){
    var data = {};
    STATIC_KEYS.forEach(function(k){
      var v = localStorage.getItem(k);
      if(v!==null) data[k]=v;
    });
    // Динамические ключи — по одному на каждый сохранённый проект
    safeParseArr(localStorage.getItem('wc_proj_index')).forEach(function(p){
      var key = WARDROBE_PROJ_PREFIX + p.id;
      var v = localStorage.getItem(key);
      if(v!==null) data[key]=v;
    });
    safeParseArr(localStorage.getItem('k_proj_index')).forEach(function(p){
      var key = KITCHEN_PROJ_PREFIX + p.id;
      var v = localStorage.getItem(key);
      if(v!==null) data[key]=v;
    });
    return data;
  }

  function summarize(data){
    var wCount = safeParseArr(data['wc_proj_index']).length;
    var kCount = safeParseArr(data['k_proj_index']).length;
    var histCount = safeParseArr(data['mebeloff_hist']).length;
    var tplCount = safeParseArr(data['mebeloff_sec_templates']).length;
    var mgrCount = safeParseArr(data['moff_managers']).length;
    return {
      wardrobeProjects: wCount,
      kitchenProjects: kCount,
      history: histCount,
      templates: tplCount,
      managers: mgrCount,
      hasPrices: !!data['wc_prices'],
      hasCatalog: !!data['wc_catalog']
    };
  }

  function pad2(n){ return n<10 ? '0'+n : ''+n; }

  function exportAll(){
    var data = collectAllData();
    var payload = {
      app: 'MebelOFF CRM',
      version: 1,
      exportedAt: new Date().toISOString(),
      keyCount: Object.keys(data).length,
      data: data
    };
    var json = JSON.stringify(payload, null, 2);
    var blob = new Blob([json], {type:'application/json'});
    var url = URL.createObjectURL(blob);
    var now = new Date();
    var fname = 'mebeloff-backup-' + now.getFullYear() + '-' + pad2(now.getMonth()+1) + '-' + pad2(now.getDate()) + '.json';
    var a = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
    return payload;
  }

  function importFromFile(file, onDone){
    if(!file){ onDone(false, 'Файл не выбран'); return; }
    var reader = new FileReader();
    reader.onload = function(){
      var parsed;
      try{ parsed = JSON.parse(reader.result); }
      catch(e){ onDone(false, 'Файл повреждён или это не JSON'); return; }
      if(!parsed || typeof parsed.data !== 'object' || !parsed.data){
        onDone(false, 'Это не похоже на файл резервной копии MebelOFF');
        return;
      }
      var keys = Object.keys(parsed.data);
      var written = 0;
      keys.forEach(function(k){
        try{ localStorage.setItem(k, parsed.data[k]); written++; }catch(e){}
      });
      onDone(true, written, summarize(parsed.data));
    };
    reader.onerror = function(){ onDone(false, 'Не удалось прочитать файл'); };
    reader.readAsText(file);
  }

  // ── UI ────────────────────────────────────────────────────
  function injectStyle(){
    if(document.getElementById('moff-bk-style')) return;
    var st = document.createElement('style');
    st.id = 'moff-bk-style';
    st.textContent =
      '.moff-bk-overlay{position:fixed;inset:0;background:rgba(20,20,20,.5);z-index:9999;display:none;align-items:center;justify-content:center}'+
      '.moff-bk-overlay.open{display:flex}'+
      '.moff-bk-box{background:#fff;border-radius:12px;max-width:440px;width:92%;max-height:85vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.3);font-family:inherit}'+
      '.moff-bk-hdr{padding:16px 18px;border-bottom:1px solid #eee;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;background:#fff}'+
      '.moff-bk-hdr b{font-size:15px;color:#222}'+
      '.moff-bk-x{background:none;border:none;font-size:20px;cursor:pointer;color:#999;line-height:1}'+
      '.moff-bk-body{padding:16px 18px}'+
      '.moff-bk-sec{margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid #f0f0f0}'+
      '.moff-bk-sec:last-child{border-bottom:none;margin-bottom:0;padding-bottom:0}'+
      '.moff-bk-sec h4{font-size:13px;color:#333;margin:0 0 6px}'+
      '.moff-bk-sec p{font-size:12px;color:#888;margin:0 0 10px;line-height:1.5}'+
      '.moff-bk-btn{display:block;width:100%;padding:10px;border-radius:8px;border:none;background:#1a5252;color:#fff;font-size:13px;font-weight:600;cursor:pointer;box-sizing:border-box}'+
      '.moff-bk-btn.warn{background:#e8896d}'+
      '.moff-bk-btn:disabled{opacity:.5;cursor:default}'+
      '.moff-bk-file{width:100%;font-size:12px;margin-bottom:8px;box-sizing:border-box}'+
      '.moff-bk-msg{font-size:12px;margin-top:8px;padding:8px 10px;border-radius:6px}'+
      '.moff-bk-msg.ok{background:#e8f5e9;color:#1b5e20}'+
      '.moff-bk-msg.err{background:#fdecea;color:#c0392b}'+
      '.moff-bk-summary{font-size:11px;color:#999;margin-top:10px;line-height:1.6}'+
      '.moff-bk-note{font-size:11px;color:#aaa;margin-top:10px;line-height:1.4}'+
      '.moff-bk-trigger{background:#1a5252 !important;color:#fff !important;border-color:#1a5252 !important}'+
      '.moff-bk-floating{position:fixed;bottom:16px;left:16px;z-index:9998;padding:10px 16px;border-radius:24px;background:#1a5252;color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.2);border:none;cursor:pointer;font-size:13px}';
    document.head.appendChild(st);
  }

  function ensureModal(){
    if(document.getElementById('moff-bk-overlay')) return;
    var ov = document.createElement('div');
    ov.id = 'moff-bk-overlay';
    ov.className = 'moff-bk-overlay';
    ov.innerHTML =
      '<div class="moff-bk-box">'+
        '<div class="moff-bk-hdr"><b>💾 Резервная копия</b>'+
        '<button class="moff-bk-x" id="moff-bk-close">×</button></div>'+
        '<div class="moff-bk-body" id="moff-bk-body"></div>'+
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function(e){ if(e.target===ov) closeModal(); });
    document.getElementById('moff-bk-close').addEventListener('click', closeModal);
  }

  function renderBody(){
    var body = document.getElementById('moff-bk-body');
    if(!body) return;
    var currentSummary = summarize(collectAllData());
    var summaryHtml =
      '<div class="moff-bk-summary">'+
        'Сейчас в браузере: проектов шкафа — '+currentSummary.wardrobeProjects+
        ', проектов кухни — '+currentSummary.kitchenProjects+
        ', в истории расчётов — '+currentSummary.history+
        ', шаблонов наполнения — '+currentSummary.templates+
        ', менеджеров — '+currentSummary.managers+
        (currentSummary.hasPrices ? ', прайс сохранён' : ', прайс не заполнен')+
      '.</div>';

    body.innerHTML =
      '<div class="moff-bk-sec">'+
        '<h4>Экспорт</h4>'+
        '<p>Скачает один .json файл со всеми проектами, историей, шаблонами, прайсом и списком менеджеров. API-ключ ИИ в файл не попадает.</p>'+
        '<button class="moff-bk-btn" id="moff-bk-export-btn">Скачать бэкап (.json)</button>'+
        summaryHtml+
      '</div>'+
      '<div class="moff-bk-sec">'+
        '<h4>Импорт</h4>'+
        '<p>Восстановит данные из ранее скачанного файла. <b>Перезапишет</b> то, что сейчас есть в этом браузере.</p>'+
        '<input type="file" accept=".json,application/json" class="moff-bk-file" id="moff-bk-file">'+
        '<button class="moff-bk-btn warn" id="moff-bk-import-btn" disabled>Восстановить из файла</button>'+
        '<div id="moff-bk-import-msg"></div>'+
      '</div>'+
      '<div class="moff-bk-note">Все данные приложения хранятся только в этом браузере (localStorage). Если очистить кэш браузера, переустановить систему или открыть сайт с другого устройства — данные не появятся сами собой. Регулярный экспорт — единственная страховка.</div>';

    var exportBtn = document.getElementById('moff-bk-export-btn');
    if(exportBtn) exportBtn.addEventListener('click', function(){
      exportAll();
    });

    var fileInp = document.getElementById('moff-bk-file');
    var importBtn = document.getElementById('moff-bk-import-btn');
    if(fileInp) fileInp.addEventListener('change', function(){
      importBtn.disabled = !fileInp.files || !fileInp.files.length;
    });
    if(importBtn) importBtn.addEventListener('click', function(){
      var f = fileInp.files && fileInp.files[0];
      if(!f) return;
      var sure = confirm('Импорт перезапишет текущие данные в этом браузере (проекты, историю, прайс, шаблоны). Продолжить?');
      if(!sure) return;
      importBtn.disabled = true;
      importBtn.textContent = 'Восстанавливаю...';
      importFromFile(f, function(ok, infoOrCount, sum){
        var msgEl = document.getElementById('moff-bk-import-msg');
        if(ok){
          var s = sum || {};
          msgEl.className = 'moff-bk-msg ok';
          msgEl.textContent = 'Готово: восстановлено '+infoOrCount+' ключей (шкаф — '+s.wardrobeProjects+', кухня — '+s.kitchenProjects+'). Страница сейчас перезагрузится.';
          setTimeout(function(){ location.reload(); }, 1500);
        } else {
          msgEl.className = 'moff-bk-msg err';
          msgEl.textContent = infoOrCount;
          importBtn.disabled = false;
          importBtn.textContent = 'Восстановить из файла';
        }
      });
    });
  }

  function openModal(){
    injectStyle();
    ensureModal();
    renderBody();
    document.getElementById('moff-bk-overlay').classList.add('open');
  }
  function closeModal(){
    var ov = document.getElementById('moff-bk-overlay');
    if(ov) ov.classList.remove('open');
  }

  window.showBackupManager = openModal;

  function injectTriggerButton(){
    if(document.getElementById('moff-bk-trigger-btn')) return;
    var footer = document.getElementById('panel-footer');
    var btn = document.createElement('button');
    btn.id = 'moff-bk-trigger-btn';
    btn.addEventListener('click', openModal);
    if(footer){
      btn.className = 'footer-btn moff-bk-trigger';
      btn.innerHTML = '<i class="ti ti-database-export"></i> Бэкап';
      footer.appendChild(btn);
    } else {
      btn.className = 'moff-bk-floating';
      btn.innerHTML = '💾 Бэкап';
      document.body.appendChild(btn);
    }
  }

  function init(){
    injectStyle();
    injectTriggerButton();
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
