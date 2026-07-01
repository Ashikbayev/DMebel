// ============================================================
// MebelOFF — Каталог производителей по городам
// ============================================================
// ПОЛНОСТЬЮ ИЗОЛИРОВАННЫЙ МОДУЛЬ.
// Не импортирует и не вызывает ничего из main.js / wardrobe.js,
// и наоборот — main.js/wardrobe.js ничего не знают об этом файле.
// Единственная точка контакта со страницей — кнопка, которую
// этот файл сам добавляет в футер (#panel-footer), либо
// плавающая кнопка, если футер не найден.
//
// Источник данных — отдельный Google Apps Script (JSONP),
// по тому же принципу, что и основной прайс-каталог в
// wardrobe.js (loadFromSheets), но с полностью независимым
// URL, кэшем и форматом данных — своя таблица, не пересекается
// с прайсами ЛДСП/фурнитуры.
//
// Пока реальная таблица не подключена — показывается demo-набор,
// явно помеченный как пример (не реальные компании).
// ============================================================
(function(){
  'use strict';

  var GS_URL_KEY   = 'moff_directory_gs_url';
  var CACHE_KEY     = 'moff_directory_cache';
  var CITY_KEY       = 'moff_directory_city';
  var CACHE_TTL_MS = 24*60*60*1000; // 24 часа

  var CITIES = [
    'Алматы','Астана','Шымкент','Караганда','Актобе','Тараз',
    'Павлодар','Усть-Каменогорск','Семей','Атырау','Костанай',
    'Кызылорда','Уральск','Петропавловск','Актау','Темиртау',
    'Туркестан','Кокшетау','Экибастуз','Рудный','Жезказган','Сатпаев'
  ];

  // Демо-данные — ПРИМЕР структуры, не реальные компании.
  // Реальный каталог подключается через свою Google-таблицу
  // (URL вводится прямо в модалке, см. injectStyle/renderList).
  var DEMO_DATA = {
    'Сатпаев': [
      {name:'Mebeloff.kz', phone:'+7 707 540 7626', addr:'пр. Сатпаева 147/1',
       note:'пример записи — подключите свой каталог через Google Sheets'}
    ]
  };

  var cache = null;         // {byCity, loadedAt}
  var selectedCity = '';
  try{ selectedCity = localStorage.getItem(CITY_KEY)||''; }catch(e){}

  function loadCacheFromStorage(){
    try{
      var raw = localStorage.getItem(CACHE_KEY);
      if(!raw) return null;
      var parsed = JSON.parse(raw);
      if(!parsed || !parsed.loadedAt) return null;
      if(Date.now()-parsed.loadedAt > CACHE_TTL_MS) return null;
      return parsed;
    }catch(e){ return null; }
  }

  function saveCacheToStorage(byCity){
    try{
      localStorage.setItem(CACHE_KEY, JSON.stringify({byCity:byCity, loadedAt:Date.now()}));
    }catch(e){}
  }

  function getGsUrl(){
    try{ return localStorage.getItem(GS_URL_KEY)||''; }catch(e){ return ''; }
  }
  function setGsUrl(url){
    try{ localStorage.setItem(GS_URL_KEY, url); }catch(e){}
  }

  // JSONP-загрузчик — независимая копия механизма из wardrobe.js
  // (там своя переменная prices.gsUrl, тут своя — специально не
  // переиспользуем их код/состояние, чтобы модуль оставался изолированным).
  function jsonpFetch(url, timeoutMs){
    timeoutMs = timeoutMs || 10000;
    return new Promise(function(resolve, reject){
      var cbName = '_moffdir_cb_'+Date.now();
      var script = document.createElement('script');
      var t = setTimeout(function(){ cleanup(); reject(new Error('timeout')); }, timeoutMs);
      function cleanup(){
        clearTimeout(t);
        delete window[cbName];
        if(script.parentNode) script.parentNode.removeChild(script);
      }
      window[cbName] = function(data){ cleanup(); resolve(data); };
      var sep = url.indexOf('?')>=0 ? '&' : '?';
      script.src = url+sep+'callback='+cbName;
      script.onerror = function(){ cleanup(); reject(new Error('script load error')); };
      document.head.appendChild(script);
    });
  }

  function loadDirectory(force){
    if(!force){
      var c = loadCacheFromStorage();
      if(c){ cache=c; return Promise.resolve(c.byCity); }
    }
    var url = getGsUrl();
    if(!url){ return Promise.resolve(DEMO_DATA); }
    return jsonpFetch(url).then(function(data){
      var byCity = (data && data.byCity) ? data.byCity : DEMO_DATA;
      saveCacheToStorage(byCity);
      cache = {byCity:byCity, loadedAt:Date.now()};
      return byCity;
    }).catch(function(){
      return DEMO_DATA;
    });
  }

  // ── UI ────────────────────────────────────────────────────
  function injectStyle(){
    if(document.getElementById('moff-dir-style')) return;
    var st = document.createElement('style');
    st.id = 'moff-dir-style';
    st.textContent =
      '.moff-dir-overlay{position:fixed;inset:0;background:rgba(20,20,20,.5);z-index:9999;display:none;align-items:center;justify-content:center}'+
      '.moff-dir-overlay.open{display:flex}'+
      '.moff-dir-box{background:#fff;border-radius:12px;max-width:480px;width:92%;max-height:80vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.3);font-family:inherit}'+
      '.moff-dir-hdr{padding:16px 18px;border-bottom:1px solid #eee;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;background:#fff}'+
      '.moff-dir-hdr b{font-size:15px;color:#222}'+
      '.moff-dir-x{background:none;border:none;font-size:20px;cursor:pointer;color:#999;line-height:1}'+
      '.moff-dir-body{padding:16px 18px}'+
      '.moff-dir-select{width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:8px;font-size:13px;margin-bottom:14px;box-sizing:border-box}'+
      '.moff-dir-item{padding:10px 12px;border:1px solid #eee;border-radius:8px;margin-bottom:8px}'+
      '.moff-dir-item b{display:block;font-size:13px;color:#222;margin-bottom:2px}'+
      '.moff-dir-item span{display:block;font-size:12px;color:#777;margin-top:2px}'+
      '.moff-dir-empty{font-size:12px;color:#999;text-align:center;padding:20px 0}'+
      '.moff-dir-note{font-size:11px;color:#aaa;margin-top:12px;line-height:1.4}'+
      '.moff-dir-cfg{margin-top:14px;padding-top:12px;border-top:1px dashed #eee}'+
      '.moff-dir-cfg input{width:100%;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:11px;box-sizing:border-box;margin-bottom:6px}'+
      '.moff-dir-cfg button{font-size:11px;padding:5px 10px;border-radius:6px;border:1px solid #ddd;background:#f7f7f7;cursor:pointer}'+
      '.moff-dir-trigger{background:#e8896d !important;color:#fff !important;border-color:#e8896d !important}'+
      '.moff-dir-floating{position:fixed;bottom:16px;right:16px;z-index:9998;padding:10px 16px;border-radius:24px;background:#e8896d;color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.2);border:none;cursor:pointer;font-size:13px}';
    document.head.appendChild(st);
  }

  function ensureModal(){
    if(document.getElementById('moff-dir-overlay')) return;
    var ov = document.createElement('div');
    ov.id = 'moff-dir-overlay';
    ov.className = 'moff-dir-overlay';
    ov.innerHTML =
      '<div class="moff-dir-box">'+
        '<div class="moff-dir-hdr"><b>🏭 Производители в вашем городе</b>'+
        '<button class="moff-dir-x" id="moff-dir-close">×</button></div>'+
        '<div class="moff-dir-body" id="moff-dir-body"></div>'+
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function(e){ if(e.target===ov) closeDirectory(); });
    document.getElementById('moff-dir-close').addEventListener('click', closeDirectory);
  }

  function cityOptionsHtml(selected){
    var html = '<option value="">— выберите город —</option>';
    CITIES.forEach(function(c){
      html += '<option value="'+c+'"'+(c===selected?' selected':'')+'>'+c+'</option>';
    });
    return html;
  }

  function escapeHtml(s){
    return String(s==null?'':s).replace(/[&<>"']/g, function(ch){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
    });
  }

  function renderList(byCity, city){
    var body = document.getElementById('moff-dir-body');
    if(!body) return;
    var list = (byCity && byCity[city]) ? byCity[city] : [];
    var html = '<select class="moff-dir-select" id="moff-dir-city-sel">'+cityOptionsHtml(city)+'</select>';
    if(!city){
      html += '<div class="moff-dir-empty">Выберите город, чтобы увидеть производителей рядом с вами</div>';
    } else if(!list.length){
      html += '<div class="moff-dir-empty">Пока нет производителей в базе для города «'+escapeHtml(city)+'»</div>';
    } else {
      list.forEach(function(m){
        html += '<div class="moff-dir-item"><b>'+escapeHtml(m.name)+'</b>'+
          (m.phone?('<span>📞 '+escapeHtml(m.phone)+'</span>'):'')+
          (m.addr?('<span>📍 '+escapeHtml(m.addr)+'</span>'):'')+
          (m.note?('<span style="color:#e8896d">'+escapeHtml(m.note)+'</span>'):'')+
          '</div>';
      });
    }
    html += '<div class="moff-dir-note">Каталог подключается через отдельную Google-таблицу '+
      '(независимо от прайса ЛДСП/фурнитуры). Пока таблица не указана — показан демо-пример.</div>';
    html += '<div class="moff-dir-cfg">'+
      '<div style="font-size:11px;color:#888;margin-bottom:4px">URL Google Apps Script с каталогом производителей</div>'+
      '<input type="text" id="moff-dir-url" placeholder="https://script.google.com/macros/..." value="'+escapeHtml(getGsUrl())+'">'+
      '<button id="moff-dir-save-url">Сохранить и обновить</button>'+
    '</div>';
    body.innerHTML = html;

    var sel = document.getElementById('moff-dir-city-sel');
    if(sel) sel.addEventListener('change', function(){
      selectedCity = sel.value;
      try{ localStorage.setItem(CITY_KEY, selectedCity); }catch(e){}
      renderList(cache?cache.byCity:DEMO_DATA, selectedCity);
    });
    var saveBtn = document.getElementById('moff-dir-save-url');
    if(saveBtn) saveBtn.addEventListener('click', function(){
      var urlInp = document.getElementById('moff-dir-url');
      setGsUrl((urlInp&&urlInp.value||'').trim());
      saveBtn.textContent = 'Загрузка...';
      loadDirectory(true).then(function(byCity){
        saveBtn.textContent = 'Сохранить и обновить';
        renderList(byCity, selectedCity);
      });
    });
  }

  function openDirectory(){
    injectStyle();
    ensureModal();
    document.getElementById('moff-dir-overlay').classList.add('open');
    renderList(cache?cache.byCity:DEMO_DATA, selectedCity); // мгновенный показ, пока грузится реальное
    loadDirectory(false).then(function(byCity){
      renderList(byCity, selectedCity);
    });
  }

  function closeDirectory(){
    var ov = document.getElementById('moff-dir-overlay');
    if(ov) ov.classList.remove('open');
  }

  window.showManufacturerDirectory = openDirectory;

  function injectTriggerButton(){
    if(document.getElementById('moff-dir-trigger-btn')) return;
    var footer = document.getElementById('panel-footer');
    var btn = document.createElement('button');
    btn.id = 'moff-dir-trigger-btn';
    btn.addEventListener('click', openDirectory);
    if(footer){
      btn.className = 'footer-btn moff-dir-trigger';
      btn.innerHTML = '<i class="ti ti-building-factory"></i> Производители';
      footer.appendChild(btn);
    } else {
      btn.className = 'moff-dir-floating';
      btn.innerHTML = '🏭 Производители';
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
