

const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbxDa66S-OSeSR1B6B2EoS0h5R6X2jW22zccdJP8HtbiGwEh-IGzqf5BsmXNRTeTWN78/exec';

// Статус загрузки
function showStatus(msg, color) {
  let el = document.getElementById('db-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'db-status';
    el.style.cssText = 'position:fixed;top:48px;left:0;right:0;z-index:200;padding:8px 14px;font-size:12px;font-weight:500;text-align:center;transition:opacity .5s';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.background = color || '#1a5252';
  el.style.color = '#fff';
  el.style.opacity = '1';
}
function hideStatus() {
  const el = document.getElementById('db-status');
  if (el) { el.style.opacity = '0'; setTimeout(() => el.remove(), 500); }
}

async function loadFromSheets() {
  showStatus('Загружаю цены из базы...', '#1a5252');
  try {
    const res = await fetch(SHEETS_URL);
    const data = await res.json();
    if (data.ldsp && data.ldsp.length > 0) {
      DB.ldsp = data.ldsp;
      DB.hdf_p = data.hdf_p || 9000;
      DB.krom_p = data.krom_p || 200;
      DB.fas_plen = data.fas_plen;
      DB.fas_kr = data.fas_kr;
      DB.furn = data.furn;
      DB.kuh = data.kuh;
      DB.shk = data.shk || DB.shk;
      DB.acc = data.acc || DB.acc;
      DB.svet = data.svet;
      DB.works = data.works;
      DB.vit = data.vit;
      renderWorks();
      recalc();
      kpManagerLoadList();
      showStatus('OK: Цены загружены из Google Sheets', '#1D9E75');
      setTimeout(hideStatus, 2500);
    } else {
      showStatus('⚠️ Нет данных — работаю офлайн', '#BA7517');
      setTimeout(hideStatus, 3000);
    }
  } catch(e) {
    showStatus('⚠️ Нет интернета — работаю офлайн', '#BA7517');
    setTimeout(hideStatus, 3000);
  }
}

const DB={
  ldsp:[{n:"Бежевый",p:20000},{n:"Америка Орех",p:23000},{n:"Белый",p:19000},{n:"Белый Апельсин",p:20000},{n:"Белый Гладкий",p:20000},{n:"Белый Глянец",p:20000},{n:"Вотан",p:20000},{n:"Графит",p:20000},{n:"Дымчатый Зеленый",p:23000},{n:"Зеленый темный",p:23000},{n:"Кашемир",p:20000},{n:"ЛДСП",p:20000},{n:"Сатин",p:20000},{n:"Серый Камень",p:20000},{n:"Серый Светлый",p:20000},{n:"Слоновая кость",p:20000},{n:"Сонома",p:20000},{n:"Темный Дуб Вотан",p:23000},{n:"Фрост",p:23000},{n:"Цемент СВ",p:20000},{n:"Цемент Тем",p:20000},{n:"Черный",p:20000}],
  hdf_p:9000,krom_p:200,
  fas_plen:[{n:"МДФ 16-П",p:18000},{n:"МДФ 16-ПФ",p:20000},{n:"МДФ 18-ПФ",p:22000}],
  fas_kr:[{n:"МДФ 16-К",p:26000},{n:"МДФ 16-КФ",p:29000},{n:"МДФ 18-КФ",p:31000},{n:"МДФ 16-КИР",p:27000},{n:"МДФ 16-КВАД",p:29000}],
  furn:[{cat:"Петля",vid:"полувнешний",firm:"En-7",p:320},{cat:"Петля",vid:"полувнешний",firm:"Hefele",p:800},{cat:"Петля",vid:"полувнешний",firm:"GTV",p:670},{cat:"Петля",vid:"полувнешний",firm:"Blume",p:2200},{cat:"Петля",vid:"внутренний",firm:"En-7",p:320},{cat:"Петля",vid:"внутренний",firm:"Hefele",p:800},{cat:"Петля",vid:"внутренний",firm:"GTV",p:670},{cat:"Петля",vid:"внутренний",firm:"Blume",p:2200},{cat:"Петля",vid:"внешний",firm:"En-7",p:320},{cat:"Петля",vid:"внешний",firm:"Hefele",p:800},{cat:"Петля",vid:"внешний",firm:"GTV",p:670},{cat:"Петля",vid:"внешний",firm:"Blume",p:2200},{cat:"Петля",vid:"165°",firm:"En-7",p:320},{cat:"Петля",vid:"165°",firm:"Hefele",p:800},{cat:"Петля",vid:"165°",firm:"GTV",p:670},{cat:"Петля",vid:"165°",firm:"Blume",p:1200},{cat:"Петля",vid:"90°",firm:"En-7",p:320},{cat:"Петля",vid:"90°",firm:"Hefele",p:800},{cat:"Петля",vid:"90°",firm:"GTV",p:670},{cat:"Петля",vid:"90°",firm:"Blume",p:1200},{cat:"Петля",vid:"45°",firm:"En-7",p:320},{cat:"Петля",vid:"45°",firm:"Hefele",p:800},{cat:"Петля",vid:"45°",firm:"GTV",p:670},{cat:"Петля",vid:"45°",firm:"Blume",p:1200},{cat:"Телескоп",vid:"200мм",firm:"En-7",p:1800},{cat:"Телескоп",vid:"250мм",firm:"En-7",p:1670},{cat:"Телескоп",vid:"300мм",firm:"En-7",p:2100},{cat:"Телескоп",vid:"350мм",firm:"En-7",p:2130},{cat:"Телескоп",vid:"400мм",firm:"En-7",p:2270},{cat:"Телескоп",vid:"450мм",firm:"En-7",p:2400},{cat:"Телескоп",vid:"500мм",firm:"En-7",p:2500},{cat:"Телескоп",vid:"300мм",firm:"GTV",p:8000},{cat:"Телескоп",vid:"350мм",firm:"GTV",p:8000},{cat:"Телескоп",vid:"400мм",firm:"GTV",p:8000},{cat:"Телескоп",vid:"450мм",firm:"GTV",p:8000},{cat:"Телескоп",vid:"500мм",firm:"GTV",p:8000},{cat:"Телескоп",vid:"550мм",firm:"Blum",p:12000},{cat:"Телескоп",vid:"600мм",firm:"Blum",p:12000},{cat:"Телескоп-Д",vid:"500мм",firm:"—",p:2200},{cat:"Телескоп-Д",vid:"550мм",firm:"—",p:2700},{cat:"Телескоп-Д черный",vid:"250мм",firm:"—",p:1390},{cat:"Телескоп-Д черный",vid:"300мм",firm:"—",p:1750},{cat:"Телескоп-Д черный",vid:"350мм",firm:"—",p:1770},{cat:"Телескоп-Д черный",vid:"450мм",firm:"—",p:2000},{cat:"СМ-полный",vid:"450мм",firm:"En-7",p:3500},{cat:"СМ-полный",vid:"300мм",firm:"GTV",p:4850},{cat:"СМ-полный",vid:"350мм",firm:"GTV",p:5000},{cat:"СМ-полный",vid:"400мм",firm:"GTV",p:5200},{cat:"СМ-полный",vid:"450мм",firm:"GTV",p:5800},{cat:"СМ-полный",vid:"500мм",firm:"GTV",p:5950},{cat:"СМ-полный",vid:"250мм",firm:"Boyard",p:3950},{cat:"СМ-полный",vid:"300мм",firm:"Boyard",p:4200},{cat:"СМ-полный",vid:"400мм",firm:"Boyard",p:4900},{cat:"СМ-полный",vid:"450мм",firm:"Boyard",p:4950},{cat:"СМ-полный",vid:"500мм",firm:"Boyard",p:5090},{cat:"СМ-полный",vid:"550мм",firm:"Boyard",p:5800},{cat:"Push-open",vid:"300мм",firm:"Boyard",p:5780},{cat:"Push-open",vid:"350мм",firm:"Boyard",p:5250},{cat:"Push-open",vid:"550мм",firm:"Boyard",p:6300},{cat:"СМ-частичный",vid:"400мм",firm:"Boyard",p:3200},{cat:"СМ-частичный",vid:"450мм",firm:"Boyard",p:3580},{cat:"СМ-частичный",vid:"500мм",firm:"Boyard",p:3800},{cat:"Ножки",vid:"—",firm:"—",p:100},{cat:"Ножки",vid:"Хром",firm:"—",p:500},{cat:"Руч-Скрытая",vid:"96мм",firm:"—",p:450},{cat:"Руч-Скрытая",vid:"128мм",firm:"—",p:500},{cat:"Руч-Скрытая",vid:"192мм",firm:"—",p:600},{cat:"Руч-Скрытая",vid:"1000мм",firm:"—",p:1000},{cat:"Руч-Торцевая",vid:"96мм",firm:"—",p:450},{cat:"Руч-Торцевая",vid:"128мм",firm:"—",p:500},{cat:"Руч-Торцевая",vid:"192мм",firm:"—",p:600},{cat:"Руч-Торцевая",vid:"1000мм",firm:"—",p:1000},{cat:"Руч-Скоба",vid:"96мм",firm:"—",p:450},{cat:"Руч-Скоба",vid:"128мм",firm:"—",p:500},{cat:"Руч-Скоба",vid:"192мм",firm:"—",p:600},{cat:"Руч-Скоба",vid:"1000мм",firm:"—",p:1000},{cat:"Типон",vid:"—",firm:"—",p:500},{cat:"Газлифт",vid:"—",firm:"En-7",p:500},{cat:"Газлифт",vid:"—",firm:"Hefele",p:4500},{cat:"Газлифт Авентус",vid:"—",firm:"DTC",p:29000},{cat:"Гола.проф 6м",vid:"—",firm:"—",p:8200},{cat:"Крючки",vid:"—",firm:"—",p:600},{cat:"Крючки",vid:"1",firm:"—",p:600},{cat:"Крючки",vid:"2",firm:"—",p:600},{cat:"Крючки",vid:"3",firm:"—",p:600},{cat:"Штанга-Хром",vid:"—",firm:"—",p:2000},{cat:"Штанга",vid:"—",firm:"—",p:2000},{cat:"Турникет-Хром",vid:"250мм",firm:"—",p:480},{cat:"Турникет-Хром",vid:"350мм",firm:"—",p:670},{cat:"Турникет-Хром",vid:"400мм",firm:"—",p:700},{cat:"Турникет-Хром",vid:"450мм",firm:"—",p:770},{cat:"Турникет-Черный",vid:"300мм",firm:"—",p:900},{cat:"Турникет-Черный",vid:"350мм",firm:"—",p:980},{cat:"Турникет-Черный",vid:"400мм",firm:"—",p:1050},{cat:"Турникет-Черный",vid:"450мм",firm:"—",p:1150},{cat:"Турникет-Золото",vid:"300мм",firm:"—",p:900},{cat:"Турникет-Золото",vid:"350мм",firm:"—",p:980},{cat:"Турникет-Золото",vid:"400мм",firm:"—",p:1050},{cat:"Турникет-Золото",vid:"450мм",firm:"—",p:1150},{cat:"Пантограф",vid:"—",firm:"—",p:15000},{cat:"Пантограф",vid:"Серый",firm:"—",p:15000},{cat:"Пантограф",vid:"Черный",firm:"—",p:15000}],
  kuh:[{cat:"Плинтус",vid:"—",p:2000},{cat:"Плинтус",vid:"черный",p:2000},{cat:"Плинтус",vid:"серый",p:2000},{cat:"Плинтус",vid:"белый",p:2000},{cat:"Плинтус",vid:"Вотан",p:2000},{cat:"Столешница",vid:"стандарт",p:10000},{cat:"Столешница",vid:"28мм",p:10000},{cat:"Столешница",vid:"38мм",p:10000},{cat:"Столешница",vid:"38мм Вотан",p:10000},{cat:"Столешница",vid:"38мм Сонома",p:10000},{cat:"Камень",vid:"Grandex",p:120000},{cat:"Камень",vid:"Китай",p:80000},{cat:"Мойка",vid:"500мм",p:25000},{cat:"Мойка",vid:"600мм",p:26000},{cat:"Сушилка",vid:"500мм",p:5300},{cat:"Сушилка",vid:"600мм",p:5500},{cat:"Сушилка",vid:"700мм",p:6500},{cat:"Сушилка",vid:"800мм",p:7000},{cat:"Сушилка",vid:"900мм",p:8500},{cat:"Сушилка",vid:"1000мм",p:9100},{cat:"Сушилка Нерж",vid:"500мм",p:5300},{cat:"Сушилка Нерж",vid:"600мм",p:5500},{cat:"Сушилка Нерж",vid:"700мм",p:6500},{cat:"Сушилка Нерж",vid:"800мм",p:7000},{cat:"Сушилка Нерж",vid:"900мм",p:8500},{cat:"Сушилка Нерж",vid:"1000мм",p:9100},{cat:"Бутылочница",vid:"150мм",p:10000},{cat:"Бутылочница",vid:"200мм",p:13000},{cat:"Бутылочница",vid:"250мм",p:15000},{cat:"Бутылочница",vid:"300мм",p:25000},{cat:"Угл.соед",vid:"38мм",p:2000},{cat:"Угл.соед",vid:"26мм",p:1950},{cat:"Карго",vid:"400мм",p:15000},{cat:"Карго",vid:"500мм",p:20000},{cat:"Карго",vid:"600мм",p:30000}],
  shk:[{cat:"Штанга-Хром",vid:"—",p:2000},{cat:"Штанга",vid:"—",p:2000},{cat:"Крючки",vid:"—",p:600},{cat:"Крючки",vid:"1",p:600},{cat:"Крючки",vid:"2",p:600},{cat:"Крючки",vid:"3",p:600},{cat:"Турникет-Хром",vid:"250мм",p:480},{cat:"Турникет-Хром",vid:"350мм",p:670},{cat:"Турникет-Хром",vid:"400мм",p:700},{cat:"Турникет-Хром",vid:"450мм",p:770},{cat:"Турникет-Черный",vid:"300мм",p:900},{cat:"Турникет-Черный",vid:"350мм",p:980},{cat:"Турникет-Черный",vid:"400мм",p:1050},{cat:"Турникет-Черный",vid:"450мм",p:1150},{cat:"Турникет-Золото",vid:"300мм",p:900},{cat:"Турникет-Золото",vid:"350мм",p:980},{cat:"Турникет-Золото",vid:"400мм",p:1050},{cat:"Турникет-Золото",vid:"450мм",p:1150},{cat:"Пантограф",vid:"—",p:15000},{cat:"Пантограф",vid:"Серый",p:15000},{cat:"Пантограф",vid:"Черный",p:15000}],
  acc:[{cat:"Мойка",vid:"500мм",p:25000},{cat:"Мойка",vid:"600мм",p:30000},{cat:"Сушилка_двойная",vid:"600мм",p:40000},{cat:"Бутылочница",vid:"150мм",p:10000},{cat:"Бутылочница",vid:"200мм",p:13000},{cat:"Бутылочница",vid:"250мм",p:15000},{cat:"Бутылочница",vid:"300мм",p:25000},{cat:"Карго",vid:"400мм",p:15000},{cat:"Карго",vid:"500мм",p:20000},{cat:"Карго",vid:"600мм",p:30000}],
  svet:[{cat:"БлокП 12в",vid:"60вт",p:2200},{cat:"БлокП 12в",vid:"100вт",p:2430},{cat:"БлокП 12в",vid:"150вт",p:2970},{cat:"Вилка",vid:"—",p:200},{cat:"Вкл Круглый",vid:"—",p:250},{cat:"Вкл Кнопка",vid:"—",p:220},{cat:"Вкл Врезной",vid:"—",p:250},{cat:"Датчик 12в",vid:"ЛДСП",p:2800},{cat:"Датчик 12в",vid:"Касание",p:1500},{cat:"Датчик 12в",vid:"Махание",p:1760},{cat:"Датчик 12в",vid:"Откр-1-дверь",p:1960},{cat:"Датчик 12в",vid:"Откр-2-дверь",p:1960},{cat:"Датчик 12в",vid:"ДисУпр",p:4500},{cat:"Датчик 12в",vid:"ГолосУпр",p:4500},{cat:"Датчик 12в",vid:"ДляЗеркало",p:2500},{cat:"Датчик 220в",vid:"Касание",p:3400},{cat:"Датчик 220в",vid:"Махание",p:3400},{cat:"Датчик 220в",vid:"ЛДСП",p:4200},{cat:"Датчик 220в",vid:"ДисУпр",p:4500},{cat:"Лента 12в",vid:"Холодный",p:1760},{cat:"Лента 12в",vid:"Теплый",p:1760},{cat:"Лента 12в",vid:"Нейтральный",p:1760},{cat:"Лента 220в 1м",vid:"Холодный",p:410},{cat:"Лента 220в 5м",vid:"Холодный",p:1760},{cat:"Лента 220в 5м",vid:"Теплый",p:1760},{cat:"Лента 220в 5м",vid:"Нейтральный",p:1760},{cat:"Лента 220в 10м",vid:"Нейтральный",p:2700},{cat:"Лента Гибкий 12в",vid:"—",p:880},{cat:"Профиль.угл",vid:"алюминий",p:1620},{cat:"Профиль.угл",vid:"черный",p:1890},{cat:"Профиль.врез",vid:"черный",p:1890},{cat:"Профиль.врез",vid:"алюминий",p:1620},{cat:"Профиль.наклад",vid:"алюминий",p:1620},{cat:"Профиль.наклад",vid:"черный",p:1890},{cat:"Розетка",vid:"—",p:800},{cat:"Переходник",vid:"—",p:250},{cat:"Соед.лента",vid:"—",p:380}],
  vit:{steklo:{"Бронза":12000,"Графит":12000,"Матовый":14000,"Зеркало":12000,"Простое":6000,"Риф-Бронза":40000,"Риф-Графит":40000,"Риф-Простой":40000},profil_uzkiy:2000,profil_shirokiy:3000,ugolok_uzkiy:1500,ugolok_shirokiy:2000,navesh:1000,prisadka:1500,uplotnitel:400},
  works:[{n:"Установка мойки",p:0},{n:"Установка смесителя",p:0},{n:"Установка печки/духовки",p:0},{n:"Установка вытяжки",p:0},{n:"Установка посудомойки",p:0},{n:"Установка холодильника",p:0},{n:"Подключение электрики",p:0},{n:"Сборка мебели",p:0},{n:"Установка карго/сушилки",p:0},{n:"Установка витрины",p:0},{n:"Установка подсветки",p:0},{n:"Замер",p:0},{n:"Дизайн проект",p:0}]
};
const ST={ldsp:[],fldsp:[],fplen:[],fkr:[],furn:[],kuh:[],shk:[],svet:[],dop:[],vit:[]};
let C={};
const $=id=>document.getElementById(id);
const fm=n=>Math.round(n).toLocaleString("ru")+"₸";
const gn=id=>{const e=$(id);return e?(parseFloat(e.value)||0):0;};
const st=(id,v)=>{const e=$(id);if(e)e.textContent=fm(v);};
const sx=(id,v)=>{const e=$(id);if(e)e.textContent=v;};
function page(p){["calc","kp","hist","conf","kitchen"].forEach(n=>{$("pg-"+n)?.classList.toggle("on",n===p);const b=$("bbt-"+n);if(b)b.classList.toggle("on",n===p);});if(p==="hist")renderHist();if(p==="conf"){initConf();}if(p==="kitchen"){initKitchen();}}
function tab(t){["calc","coef","extra","vit","itog"].forEach(s=>$("scr-"+s).classList.toggle("on",s===t));document.querySelectorAll(".tb").forEach((b,i)=>b.classList.toggle("on",["calc","coef","extra","vit","itog"][i]===t));if(t==="itog")recalc();window.scrollTo(0,0);}
function tog(id){const b=$("cb-"+id),a=$("ar-"+id);if(!b)return;const op=b.classList.toggle("op");if(a)a.classList.toggle("op",op);}
function addLdsp(){
  const i=ST.ldsp.length;ST.ldsp.push(0);
  const c=$("ldsp-list");if(i===0)c.innerHTML="";
  const d=document.createElement("div");d.id="lr"+i;if(i>0)d.className="ib";d.style.marginTop="8px";
  const o=DB.ldsp.map((x,j)=>`<option value="${j}">${x.n} — ${x.p.toLocaleString("ru")}₸</option>`).join("");
  d.innerHTML=`<div class="fr"><select id="ls${i}" onchange="ST.ldsp[${i}]=+this.value;$('lp${i}').textContent=DB.ldsp[+this.value].p.toLocaleString('ru')+'₸/л';recalc()">${o}</select><button class="db" onclick="$('lr${i}').style.display='none';ST.ldsp[${i}]=null;recalc()">✕</button></div><div class="fr"><span class="lb">Кол-во</span><input class="qi" type="number" inputmode="decimal" id="lq${i}" placeholder="0" min="0" onchange="recalc()"><span class="fp" id="lp${i}">${DB.ldsp[0].p.toLocaleString("ru")}₸/л</span></div>`;
  c.appendChild(d);recalc();
}
function lC(){return ST.ldsp.reduce((s,x,i)=>{if(x===null||x===undefined)return s;return s+(DB.ldsp[x]?.p||0)*(gn("lq"+i));},0);}
function kC(){return lC()+DB.hdf_p*gn("hdf-qty")+DB.krom_p*gn("krom-qty");}
function addSimple(sec,arr,lid){
  const a=ST[sec];const i=a.length;a.push(0);
  const c=$(lid);if(i===0)c.innerHTML="";
  const d=document.createElement("div");d.id=sec+"r"+i;if(i>0)d.className="ib";d.style.marginTop="8px";
  const o=arr.map((x,j)=>`<option value="${j}">${x.n} — ${x.p.toLocaleString("ru")}₸</option>`).join("");
  d.innerHTML=`<div class="fr"><select id="${sec}s${i}" onchange="ST['${sec}'][${i}]=+this.value;$('${sec}p${i}').textContent=arr[+this.value].p.toLocaleString('ru')+'₸/л';recalc()">${o}</select><button class="db" onclick="$('${sec}r${i}').style.display='none';ST['${sec}'][${i}]=null;recalc()">✕</button></div><div class="fr"><span class="lb">Кол-во</span><input class="qi" type="number" inputmode="decimal" id="${sec}q${i}" placeholder="0" min="0" onchange="recalc()"><span class="fp" id="${sec}p${i}">${arr[0].p.toLocaleString("ru")}₸/л</span></div>`;
  c.appendChild(d);recalc();
}
function sC(sec,arr){return ST[sec].reduce((s,x,i)=>{if(x===null||x===undefined)return s;return s+(arr[x]?.p||0)*(gn(sec+"q"+i));},0);}
function sIt(sec,arr){return ST[sec].map((x,i)=>{if(x===null||x===undefined)return null;const q=gn(sec+"q"+i);if(!q)return null;return{n:arr[x]?.n,q};}).filter(Boolean);}
function gA(sec){return sec==="furn"?DB.furn:sec==="kuh"?DB.kuh:sec==="shk"?DB.shk:DB.svet;}
function addCat(sec,arr,lid){
  const a=ST[sec];const i=a.length;a.push({p:0});
  const c=$(lid);if(i===0)c.innerHTML="";
  const d=document.createElement("div");d.id=sec+"r"+i;if(i>0)d.className="ib";d.style.marginTop="8px";
  const cats=[...new Set(arr.map(x=>x.cat))];
  d.innerHTML=`<div class="fr"><select id="${sec}c${i}" onchange="uC('${sec}',${i})">${cats.map(c=>`<option value="${c}">${c}</option>`).join("")}</select><button class="db" onclick="$('${sec}r${i}').style.display='none';ST['${sec}'][${i}]=null;recalc()">✕</button></div><div class="fr" id="${sec}vf${i}"></div><div class="fr"><span class="lb">Кол-во</span><input class="qi" type="number" inputmode="decimal" id="${sec}q${i}" placeholder="0" min="0" onchange="recalc()"><span class="fp" id="${sec}pp${i}">0₸</span></div>`;
  c.appendChild(d);uC(sec,i);
}
function uC(sec,i){
  const arr=gA(sec);const cat=$(sec+"c"+i)?.value;
  const rows=arr.filter(x=>x.cat===cat);
  const vids=[...new Set(rows.map(x=>x.vid))];
  const firms=[...new Set(rows.map(x=>x.firm).filter(f=>f&&f!=="—"))];
  const vf=$(sec+"vf"+i);vf.innerHTML="";
  if(vids.length>1||(vids[0]&&vids[0]!=="—")){const s=document.createElement("select");s.id=sec+"v"+i;vids.forEach(v=>{const o=document.createElement("option");o.value=v;o.textContent=v;s.appendChild(o);});s.onchange=()=>uCP(sec,i);vf.appendChild(s);}
  if(firms.length>0){const s=document.createElement("select");s.id=sec+"f"+i;firms.forEach(f=>{const o=document.createElement("option");o.value=f;o.textContent=f;s.appendChild(o);});s.onchange=()=>uCP(sec,i);vf.appendChild(s);}
  uCP(sec,i);
}
function uCP(sec,i){
  const arr=gA(sec);const a=ST[sec];
  const cat=$(sec+"c"+i)?.value,vid=$(sec+"v"+i)?.value||"—",firm=$(sec+"f"+i)?.value||"—";
  const row=arr.find(x=>x.cat===cat&&(x.vid===vid||x.vid==="—")&&(x.firm===firm||x.firm==="—"||!x.firm));
  const p=row?.p||0;if(a[i])a[i]={p};
  const pr=$(sec+"pp"+i);if(pr)pr.textContent=p.toLocaleString("ru")+"₸";recalc();
}
function cC(sec){
  const arr=gA(sec);
  return ST[sec].reduce((s,item,i)=>{
    if(!item)return s;
    const cat=$(sec+"c"+i)?.value,vid=$(sec+"v"+i)?.value||"—",firm=$(sec+"f"+i)?.value||"—";
    const row=arr.find(x=>x.cat===cat&&(x.vid===vid||x.vid==="—")&&(x.firm===firm||x.firm==="—"||!x.firm));
    return s+(row?.p||0)*(gn(sec+"q"+i));
  },0);
}
function cIt(sec){
  const arr=gA(sec);
  return ST[sec].map((item,i)=>{
    if(!item)return null;
    const cat=$(sec+"c"+i)?.value||"",vid=$(sec+"v"+i)?.value||"—",firm=$(sec+"f"+i)?.value||"—";
    const row=arr.find(x=>x.cat===cat&&(x.vid===vid||x.vid==="—")&&(x.firm===firm||x.firm==="—"||!x.firm));
    const q=gn(sec+"q"+i);if(!q)return null;
    const parts=[cat];if(vid&&vid!=="—")parts.push(vid);if(firm&&firm!=="—")parts.push(firm);
    return{n:parts.join(" "),q};
  }).filter(Boolean);
}
function addDop(){
  const i=ST.dop.length;ST.dop.push(1);
  const c=$("dop-list");if(i===0)c.innerHTML="";
  const d=document.createElement("div");d.id="dr"+i;if(i>0)d.className="ib";d.style.marginTop="8px";
  d.innerHTML=`<div class="fr"><input style="font-size:12px;border:1px solid #ddd;border-radius:8px;padding:6px 8px;flex:1;min-width:0" type="text" id="dn${i}" placeholder="Название"><button class="db" onclick="$('dr${i}').style.display='none';ST.dop[${i}]=null;recalc()">✕</button></div><div class="fr"><span class="lb">Цена</span><input class="qi" type="number" inputmode="decimal" id="dp${i}" placeholder="0" onchange="recalc()"><span class="fp">₸/шт</span></div><div class="fr"><span class="lb">Кол-во</span><input class="qi" type="number" inputmode="decimal" id="dq${i}" placeholder="1" onchange="recalc()"><span class="fp">шт</span></div>`;
  c.appendChild(d);recalc();
}
function dC(){return ST.dop.reduce((s,x,i)=>x===null?s:s+(gn("dp"+i))*(gn("dq"+i)),0);}
function dIt(){return ST.dop.map((x,i)=>{if(x===null)return null;const p=gn("dp"+i),q=gn("dq"+i);if(!q||!p)return null;return{n:$("dn"+i)?.value||"Доп.",q};}).filter(Boolean);}
function renderWorks(){
  const wl=$("works-list");if(wl){wl.innerHTML="";DB.works.forEach((w,i)=>{const d=document.createElement("div");if(i>0)d.className="ib";d.style.marginTop="6px";d.innerHTML=`<div class="fr"><span style="font-size:11px;flex:1;min-width:0">${w.n}</span><input class="qi" type="number" inputmode="decimal" id="wq${i}" placeholder="0" min="0" onchange="recalc()" style="width:62px;min-width:62px;max-width:62px"><span class="fp">шт</span><span class="fp" style="min-width:48px;text-align:right">${w.p.toLocaleString("ru")}₸</span></div>`;wl.appendChild(d);});}
  const bl=$("base-works-list");if(bl){bl.innerHTML="";DB.works.forEach((w,i)=>{const d=document.createElement("div");if(i>0)d.className="ib";d.style.marginTop="6px";d.innerHTML=`<div class="fr"><span style="font-size:11px;flex:1;min-width:0">${w.n}</span><input class="qw" type="number" inputmode="decimal" id="bwp${i}" value="${w.p}" placeholder="0" onchange="DB.works[${i}].p=parseFloat(this.value)||0;renderWorks();recalc()"><span class="fp">₸</span></div>`;bl.appendChild(d);});}
}
function wC(){return DB.works.reduce((s,w,i)=>s+w.p*(gn("wq"+i)),0);}
function wIt(){return DB.works.map((w,i)=>{const q=gn("wq"+i);if(!q||!w.p)return null;return{n:w.n,q};}).filter(Boolean);}
function addVit(){
  const i=ST.vit.length;ST.vit.push(1);
  const c=$("vit-list");if(i===0)c.innerHTML="";
  const d=document.createElement("div");d.id="vr"+i;if(i>0)d.className="ib";d.style.marginTop="8px";
  const so=Object.keys(DB.vit.steklo).map(k=>`<option value="${k}">${k} — ${DB.vit.steklo[k].toLocaleString("ru")}₸</option>`).join("");
  d.innerHTML=`<div style="font-size:12px;color:#666;font-weight:500;margin-bottom:4px">Витрина ${i+1}</div>
    <div class="fr"><span class="lb">Ширина</span><input class="ql" type="number" inputmode="decimal" id="vw${i}" placeholder="0" onchange="cV(${i})"><span class="fp">мм</span></div>
    <div class="fr"><span class="lb">Высота</span><input class="ql" type="number" inputmode="decimal" id="vh${i}" placeholder="0" onchange="cV(${i})"><span class="fp">мм</span></div>
    <div class="fr"><span class="lb">Кол-во</span><input class="qi" type="number" inputmode="decimal" id="vn${i}" placeholder="1" onchange="cV(${i})"><span class="fp">шт</span></div>
    <div class="fr"><span class="lb">Стекло</span><select id="vst${i}" onchange="cV(${i})">${so}</select></div>
    <div class="fr"><span class="lb">Профиль</span><select id="vpr${i}" onchange="cV(${i})"><option value="uzkiy">Узкий — 2 000₸</option><option value="shirokiy">Широкий — 3 000₸</option></select></div>
    <div class="ss"><div class="stl">Доставка</div><div class="fr"><span class="lb">Сумма</span><input class="ql" type="number" inputmode="decimal" id="vdel${i}" placeholder="0" onchange="cV(${i})"><span class="fp">₸</span></div></div>
    <div class="ss"><div class="stl">Доход с установки</div><div class="fr"><span class="lb">Сумма</span><input class="ql" type="number" inputmode="decimal" id="vinc${i}" placeholder="0" onchange="cV(${i})"><span class="fp">₸</span></div></div>
    <div class="fr" style="margin-top:8px;padding-top:8px;border-top:1px solid #f0f0f0"><span class="lb">Итог</span><span style="font-size:13px;font-weight:600;margin-left:auto" id="vres${i}">0₸</span><button class="db" style="margin-left:8px" onclick="$('vr${i}').style.display='none';ST.vit[${i}]=null;recalc()">✕</button></div>`;
  c.appendChild(d);cV(i);
}
function gVD(i){
  const w=gn("vw"+i),h=gn("vh"+i),n=parseFloat($("vn"+i)?.value)||1;
  const st=$("vst"+i)?.value||"Бронза",pr=$("vpr"+i)?.value||"uzkiy";
  const del=gn("vdel"+i),inc=gn("vinc"+i);
  const V=DB.vit,steklo=(w*h/1e6)*V.steklo[st];
  const profP=pr==="shirokiy"?V.profil_shirokiy:V.profil_uzkiy;
  const profil=((w+h)*2/1000)*profP,uplot=((w+h)*2/1000)*V.uplotnitel;
  const ugolok=pr==="shirokiy"?V.ugolok_shirokiy:V.ugolok_uzkiy;
  const nav=h<=800?3:h<=2000?5:6,pris=h<=800?1:h<=2000?3:4;
  const mat=(steklo+profil+uplot+ugolok+V.navesh*nav+V.prisadka*pris)*n;
  return{mat,del,inc,tot:mat+del+inc,stName:st,n};
}
function cV(i){const d=gVD(i);const er=$("vres"+i);if(er)er.textContent=fm(d.tot);recalc();}
function vTot(){let mat=0,inc=0,tot=0;ST.vit.forEach((x,i)=>{if(x===null)return;const d=gVD(i);mat+=d.mat;inc+=d.inc;tot+=d.tot;});return{mat,inc,tot};}
function vIt(){return ST.vit.map((x,i)=>{if(x===null)return null;const d=gVD(i);if(!d.tot)return null;return{n:`Витрина стекло ${d.stName}`,q:d.n};}).filter(Boolean);}
function blk(fas,k,rm,sk,tax,cr,vK,shared,extras,eInc){
  const base=vK+fas+shared,aK=base*k,rabM=aK*rm,aSk=aK+sk,taxA=aSk*tax,tot=aSk+taxA+extras,credit=tot*(1+cr);
  return{base,aK,rabM,sk,taxA,aSk,tot,credit,inc:aSk-base-rabM+eInc};
}
function recalc(){
  const vK=kC(),vFL=sC("fldsp",DB.ldsp),vFP=sC("fplen",DB.fas_plen),vFK=sC("fkr",DB.fas_kr);
  const vFu=cC("furn"),vKu=cC("kuh"),vSh=cC("shk"),vDel=gn("d-sat")+gn("d-pdm");
  const vSM=cC("svet"),vSI=gn("svet-inc"),vDp=dC(),vWk=wC(),vVit=vTot();
  const dfi=$("del-fi");if(dfi)dfi.textContent=fm(vFu+vKu+vSh);
  const shared=vFu+vKu+vSh+vDel,extras=(vSM+vSI)+vVit.tot+vWk+vDp,eInc=vSI+vVit.inc+vWk;
  const kl=gn("c-kl")||1.8,rml=gn("c-rl")/100,skl=parseFloat($("c-sl")?.value)||0,taxl=gn("c-taxl")/100,crl=gn("c-crl")/100;
  const kp=gn("c-kp")||1.8,rmp=gn("c-rp")/100,skp=parseFloat($("c-sp")?.value)||0,taxp=gn("c-taxp")/100,crp=gn("c-crp")/100;
  const kk=gn("c-kk")||1.8,rmk=gn("c-rk")/100,skk=parseFloat($("c-sk")?.value)||0,taxk=gn("c-taxk")/100,crk=gn("c-crk")/100;
  const BL=blk(vFL,kl,rml,skl,taxl,crl,vK,shared,extras,eInc);
  const BP=blk(vFP,kp,rmp,skp,taxp,crp,vK,shared,extras,eInc);
  const BK=blk(vFK,kk,rmk,skk,taxk,crk,vK,shared,extras,eInc);
  C={BL,BP,BK,vK,vFL,vFP,vFK,vFu,vKu,vSh,vDel,vSM,vSI,vVit,vDp,vWk,
    ldspIt:ST.ldsp.map((x,i)=>{if(x===null||x===undefined)return null;const q=gn("lq"+i);if(!q)return null;return{n:DB.ldsp[x]?.n,q};}).filter(Boolean),
    hdfQ:gn("hdf-qty"),kromQ:gn("krom-qty"),
    fldspIt:sIt("fldsp",DB.ldsp),fplenIt:sIt("fplen",DB.fas_plen),fkrIt:sIt("fkr",DB.fas_kr),
    fuIt:cIt("furn"),kuIt:cIt("kuh"),shIt:cIt("shk"),
    svIt:cIt("svet"),dpIt:dIt(),wkIt:wIt(),vitIt:vIt()};
  sx("tl-p",fm(BL.tot));sx("tl-c",fm(BL.credit));sx("tl-i",fm(BL.inc));
  sx("tp-p",fm(BP.tot));sx("tp-c",fm(BP.credit));sx("tp-i",fm(BP.inc));
  sx("tk-p",fm(BK.tot));sx("tk-c",fm(BK.credit));sx("tk-i",fm(BK.inc));
  [["s-korp",vK],["s-fldsp",vFL],["s-fplen",vFP],["s-fkr",vFK],["s-furn",vFu],["s-kuh",vKu],["s-shk",vSh],["s-del",vDel],["s-svet",vSM+vSI],["s-dop",vDp],["s-works",vWk]].forEach(([id,v])=>st(id,v));
  const sv=$("s-vit");if(sv)sv.textContent=fm(vVit.tot);
  function fB(pfx,B){
    st(pfx+"-b",B.base);st(pfx+"-a",B.aK);st(pfx+"-r",B.rabM);
    const se=$(pfx+"-s");if(se){const s=B.sk;se.textContent=(s===0?"0₸":(s>0?"+":"")+Math.round(s).toLocaleString("ru")+"₸");se.style.color=s<0?"#E24B4A":s>0?"#1D9E75":"#aaa";}
    st(pfx+"-t",B.taxA);st(pfx+"-tot",B.tot);st(pfx+"-cr",B.credit);st(pfx+"-inc",B.inc);
  }
  fB("il",BL);fB("ip",BP);fB("ik",BK);
}

// ── Менеджер: сохранение и загрузка ──────────────────────────
function kpManagerSave() {
  var name = ($('kp-manager')||{}).value || '';
  if (!name.trim()) return;
  var list = JSON.parse(localStorage.getItem('moff_managers') || '[]');
  if (list.indexOf(name) < 0) {
    list.push(name);
    localStorage.setItem('moff_managers', JSON.stringify(list));
  }
  kpManagerLoadList();
  showStatus('\u041c\u0435\u043d\u0435\u0434\u0436\u0435\u0440 \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d', '#1a5252');
}
function kpManagerLoadList() {
  var dl = document.getElementById('kp-manager-list');
  if (!dl) return;
  var list = JSON.parse(localStorage.getItem('moff_managers') || '[]');
  if (list.length === 0) list = ['\u0414\u0430\u043b\u0438'];
  dl.innerHTML = list.map(function(n){ return '<option value="'+n+'">'; }).join('');
  var inp = $('kp-manager');
  if (inp && !inp.value && list.length > 0) inp.value = list[list.length - 1];
}

// ── Договор ───────────────────────────────────────────────────
function ruDateFmt(d) {
  var mn = ['\u044f\u043d\u0432\u0430\u0440\u044f','\u0444\u0435\u0432\u0440\u0430\u043b\u044f','\u043c\u0430\u0440\u0442\u0430','\u0430\u043f\u0440\u0435\u043b\u044f','\u043c\u0430\u044f','\u0438\u044e\u043d\u044f','\u0438\u044e\u043b\u044f','\u0430\u0432\u0433\u0443\u0441\u0442\u0430','\u0441\u0435\u043d\u0442\u044f\u0431\u0440\u044f','\u043e\u043a\u0442\u044f\u0431\u0440\u044f','\u043d\u043e\u044f\u0431\u0440\u044f','\u0434\u0435\u043a\u0430\u0431\u0440\u044f'];
  return '\u00ab' + String(d.getDate()).padStart(2,'0') + '\u00bb ' + mn[d.getMonth()] + ' ' + d.getFullYear() + ' \u0433.';
}

function openDogovor() {
  if (!C || !C.BL) { alert('\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u0437\u0430\u043f\u043e\u043b\u043d\u0438\u0442\u0435 \u043a\u0430\u043b\u044c\u043a\u0443\u043b\u044f\u0442\u043e\u0440'); return; }
  var cf = $('dog-client'); if (cf) cf.value = ($('kp-client')||{}).value || '';
  var gf = $('dog-object'); if (gf) gf.value = ($('kp-object')||{}).value || '';
  var hf = $('dog-num');    if (hf) hf.value = ($('kp-num')   ||{}).value || '001';
  var fp = $('dog-full-pay'); if (fp) fp.checked = false;
  var varSel = $('dog-variant');
  if (varSel) {
    varSel.innerHTML = '';
    if (C.BL && C.BL.tot > 0) varSel.innerHTML += '<option value="L">\u041b\u0414\u0421\u041f \u2014 ' + fm(C.BL.tot) + '</option>';
    if (C.BP && C.BP.tot > 0) varSel.innerHTML += '<option value="P">\u041c\u0414\u0424 \u041f\u043b\u0451\u043d\u043a\u0430 \u2014 ' + fm(C.BP.tot) + '</option>';
    if (C.BK && C.BK.tot > 0) varSel.innerHTML += '<option value="K">\u041c\u0414\u0424 \u041a\u0440\u0430\u0441\u043a\u0430 \u2014 ' + fm(C.BK.tot) + '</option>';
    dogVariantChange();
  }
  $('dogovor-modal').style.display = 'flex';
}

function dogVariantChange() {
  var sel = $('dog-variant');
  if (!sel || !C || !C.BL) return;
  var v = sel.value;
  var tot = v === 'P' ? C.BP.tot : (v === 'K' ? C.BK.tot : C.BL.tot);
  var ti = $('dog-total-input');
  if (ti) ti.value = Math.round(tot);
  var p1i = $('dog-pay1-input');
  if (p1i) p1i.value = Math.round(tot * 0.5);
  dogCalcPayments();
}

function dogSetAdvancePct(pct) {
  var ti = $('dog-total-input');
  var tot = ti ? (parseFloat(ti.value) || 0) : 0;
  var p1i = $('dog-pay1-input');
  if (p1i) p1i.value = Math.round(tot * pct / 100);
  dogCalcPayments();
}

function dogCalcPayments() {
  var ti  = $('dog-total-input');
  var p1i = $('dog-pay1-input');
  var tot  = ti  ? (parseFloat(ti.value)  || 0) : 0;
  var p1   = p1i ? (parseFloat(p1i.value) || 0) : 0;
  var fullPay = $('dog-full-pay') ? $('dog-full-pay').checked : false;
  var p3 = fullPay ? 0 : Math.round(tot * 0.10);
  var p2 = fullPay ? 0 : Math.max(0, tot - p1 - p3);
  var p2f = $('dog-pay2'); if (p2f) p2f.textContent = (!fullPay && tot > 0) ? fm(p2) : '';
  var p3f = $('dog-pay3'); if (p3f) p3f.textContent = (!fullPay && tot > 0) ? fm(p3) : '';
  var r2 = $('dog-pay2-row'); if (r2) r2.style.opacity = fullPay ? '0.35' : '1';
  var r3 = $('dog-pay3-row'); if (r3) r3.style.opacity = fullPay ? '0.35' : '1';
  if (fullPay && p1i) p1i.value = tot > 0 ? Math.round(tot) : '';
}

function closeDogovor() { $('dogovor-modal').style.display = 'none'; }

function generateDogovor() {
  var client  = ($('dog-client')    ||{}).value || '___________________________________';
  var iin     = ($('dog-iin')       ||{}).value || '_______________';
  var addr    = ($('dog-addr')      ||{}).value || '___________________________________';
  var phone   = ($('dog-phone')     ||{}).value || '_______________';
  var obj     = ($('dog-object')    ||{}).value || '___________________________________';
  var size    = ($('dog-size')      ||{}).value || '___________________________________';
  var numVal  = ($('dog-num')       ||{}).value || '001';
  var daysVal = ($('dog-days')      ||{}).value || '14';
  var mntDate = ($('dog-mount-date')||{}).value || '';
  var varV    = ($('dog-variant')   ||{}).value || 'L';
  var fullPay = $('dog-full-pay') ? $('dog-full-pay').checked : false;
  var totInput = parseFloat(($('dog-total-input') ||{}).value) || 0;
  var p1Input  = parseFloat(($('dog-pay1-input')  ||{}).value) || 0;
  var tot     = totInput > 0 ? totInput : (varV === 'P' ? C.BP.tot : (varV === 'K' ? C.BK.tot : C.BL.tot));
  var p1 = fullPay ? Math.round(tot) : (p1Input > 0 ? Math.round(p1Input) : Math.round(tot * 0.5));
  var p3 = fullPay ? 0 : Math.round(tot * 0.10);
  var p2 = fullPay ? 0 : Math.max(0, tot - p1 - p3);
  var advPct = tot > 0 ? Math.round(p1 / tot * 100) : 50;
  var today   = new Date();
  var todayRU = ruDateFmt(today);
  var mntRU   = '\u00ab____\u00bb ________________ 20___ \u0433.';
  if (mntDate) {
    var mp = mntDate.split('-');
    if (mp.length === 3) mntRU = ruDateFmt(new Date(+mp[0], +mp[1]-1, +mp[2]));
  }
  function rub(n) { return Math.round(n).toLocaleString('ru') + ' \u0442\u0435\u043d\u0433\u0435'; }

  // ── автоматически из C: материалы ──────────────────────────
  var corpRows = '';
  (C.ldspIt||[]).forEach(function(it) {
    corpRows += '<tr><td>\u041a\u043e\u0440\u043f\u0443\u0441 (\u041b\u0414\u0421\u041f)</td><td>' + it.n + '</td></tr>';
  });
  (C.fldspIt||[]).forEach(function(it) {
    corpRows += '<tr><td>\u0424\u0430\u0441\u0430\u0434 (\u041b\u0414\u0421\u041f)</td><td>' + it.n + '</td></tr>';
  });
  (C.fplenIt||[]).forEach(function(it) {
    corpRows += '<tr><td>\u0424\u0430\u0441\u0430\u0434 (\u041c\u0414\u0424 \u041f\u043b\u0451\u043d\u043a\u0430)</td><td>' + it.n + '</td></tr>';
  });
  (C.fkrIt||[]).forEach(function(it) {
    corpRows += '<tr><td>\u0424\u0430\u0441\u0430\u0434 (\u041c\u0414\u0424 \u041a\u0440\u0430\u0441\u043a\u0430)</td><td>' + it.n + '</td></tr>';
  });
  if (!corpRows) corpRows = '<tr><td>\u041a\u043e\u0440\u043f\u0443\u0441</td><td>&nbsp;</td></tr><tr><td>\u0424\u0430\u0441\u0430\u0434</td><td>&nbsp;</td></tr>';

  // ── автоматически из C: фурнитура ──────────────────────────
  var allFurn = (C.fuIt||[]).concat(C.kuIt||[]).concat(C.shIt||[]);
  function fRow(arr, fn) {
    return arr.filter(function(x){ return fn(x.n.toLowerCase()); })
              .map(function(x){ return x.n + ' \u00d7 ' + x.q + ' \u0448\u0442.'; }).join('; ') || '\u2014';
  }
  var petli  = fRow(allFurn, function(nm){ return nm.indexOf('\u043f\u0435\u0442\u043b') >= 0; });
  var naprav = fRow(allFurn, function(nm){ return nm.indexOf('\u043d\u0430\u043f\u0440\u0430\u0432') >= 0 || nm.indexOf('\u0442\u0435\u043b\u0435\u0441\u043a') >= 0 || nm.indexOf('\u0434\u043e\u0432\u043e\u0434\u0447') >= 0; });
  var ruchki = fRow(allFurn, function(nm){ return nm.indexOf('\u0440\u0443\u0447') >= 0; });
  var dFurn  = allFurn.filter(function(x){
    var nm = x.n.toLowerCase();
    return nm.indexOf('\u043f\u0435\u0442\u043b') < 0 && nm.indexOf('\u043d\u0430\u043f\u0440\u0430\u0432') < 0 &&
           nm.indexOf('\u0442\u0435\u043b\u0435\u0441\u043a') < 0 && nm.indexOf('\u0434\u043e\u0432\u043e\u0434\u0447') < 0 && nm.indexOf('\u0440\u0443\u0447') < 0;
  }).map(function(x){ return x.n + ' \u00d7 ' + x.q + ' \u0448\u0442.'; }).join('; ') || '\u2014';

  // ── автоматически из C: доп. работы / позиции ──────────────
  var dopRows = '';
  (C.svIt||[]).forEach(function(it){
    dopRows += '<tr><td>' + it.n + '</td><td>' + it.q + ' \u0448\u0442.</td><td>&nbsp;</td></tr>';
  });
  (C.dpIt||[]).forEach(function(it){
    dopRows += '<tr><td>' + it.n + '</td><td>' + it.q + ' \u0448\u0442.</td><td>&nbsp;</td></tr>';
  });
  (C.wkIt||[]).forEach(function(it){
    dopRows += '<tr><td>' + it.n + '</td><td>\u0440\u0430\u0431\u043e\u0442\u044b</td><td>&nbsp;</td></tr>';
  });
  (C.vitIt||[]).forEach(function(it){
    dopRows += '<tr><td>' + it.n + '</td><td>' + it.q + ' \u0448\u0442.</td><td>&nbsp;</td></tr>';
  });
  if (!dopRows) dopRows = '<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>';

  // ══ ГЕНЕРАЦИЯ HTML ═══════════════════════════════════════════
  var H = '';
  H += '<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">';
  H += '<title>\u0414\u043e\u0433\u043e\u0432\u043e\u0440 \u2116' + numVal + ' \u2014 MebelOFF.kz</title>';
  H += '<style>';
  H += 'body{font-family:"Times New Roman",Times,serif;font-size:12pt;color:#000;background:#fff;margin:0;line-height:1.5}';
  H += '.pg{max-width:210mm;margin:0 auto;padding:18mm 22mm 18mm 28mm;box-sizing:border-box}';
  H += 'h1{text-align:center;font-size:14pt;font-weight:bold;margin:0 0 2px;letter-spacing:1px}';
  H += 'h2{text-align:center;font-size:12pt;font-weight:normal;margin:0 0 2px}';
  H += '.c{text-align:center}';
  H += '.sec{font-weight:bold;font-size:12pt;margin:12pt 0 4pt;text-align:center}';
  H += 'p{margin:3pt 0;text-align:justify}';
  H += '.ind{text-indent:20pt}';
  H += '.sub{margin:2pt 0 2pt 18pt;text-align:justify}';
  H += 'table{width:100%;border-collapse:collapse;margin:5pt 0;font-size:11pt}';
  H += 'th,td{border:1px solid #000;padding:4px 7px;vertical-align:top}';
  H += 'th{background:#f0f0f0;font-weight:bold;text-align:center}';
  H += '.b{font-weight:bold}';
  H += '.hr{border:none;border-top:2px solid #C9A96E;margin:10pt 0}';
  H += '.sw{display:flex;gap:28px;margin-top:14pt}';
  H += '.sc{flex:1;font-size:11pt}';
  H += '.sl{display:block;border-top:1px solid #000;margin-top:26pt;padding-top:3pt}';
  H += '.pb{page-break-before:always}';
  H += '.btn{position:fixed;top:14px;right:14px;background:#C9A96E;color:#fff;border:none;padding:9px 20px;border-radius:8px;font-size:13px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.2);z-index:999}';
  H += '@media print{.btn{display:none!important}.pg{padding:14mm 20mm 14mm 24mm}}';
  H += '</style></head><body>';
  H += '<button class="btn" onclick="window.print()">\uD83D\uDDA8 \u041f\u0435\u0447\u0430\u0442\u044c / PDF</button>';
  H += '<div class="pg">';

  // ШАПКА
  H += '<h1>\u0414\u041e\u0413\u041e\u0412\u041e\u0420</h1>';
  H += '<h2>\u043d\u0430 \u0438\u0437\u0433\u043e\u0442\u043e\u0432\u043b\u0435\u043d\u0438\u0435 \u0438 \u043c\u043e\u043d\u0442\u0430\u0436 \u043a\u043e\u0440\u043f\u0443\u0441\u043d\u043e\u0439 \u043c\u0435\u0431\u0435\u043b\u0438</h2>';
  H += '<p class="c" style="margin-top:5pt">\u2116 <b>' + numVal + '</b> \u043e\u0442 ' + todayRU + '</p>';
  H += '<p class="c">\u0433. \u0421\u0430\u0442\u043f\u0430\u0435\u0432</p>';
  H += '<hr class="hr">';

  // ПРЕАМБУЛА
  H += '<p class="ind">\u0418\u043d\u0434\u0438\u0432\u0438\u0434\u0443\u0430\u043b\u044c\u043d\u044b\u0439 \u043f\u0440\u0435\u0434\u043f\u0440\u0438\u043d\u0438\u043c\u0430\u0442\u0435\u043b\u044c \u00abMebeloff.kz\u00bb (\u0411\u0418\u041d/\u0418\u0418\u041d 900328351393), \u0432 \u043b\u0438\u0446\u0435 \u041c\u0443\u0448\u0435\u043d\u043e\u0432\u0430 \u0422\u0438\u043b\u0435\u043a\u0430 \u0422\u043b\u0435\u0443\u0445\u0430\u043d\u043e\u0432\u0438\u0447\u0430, \u0434\u0435\u0439\u0441\u0442\u0432\u0443\u044e\u0449\u0435\u0433\u043e \u043d\u0430 \u043e\u0441\u043d\u043e\u0432\u0430\u043d\u0438\u0438 \u0421\u0432\u0438\u0434\u0435\u0442\u0435\u043b\u044c\u0441\u0442\u0432\u0430 \u043e \u0433\u043e\u0441\u0443\u0434\u0430\u0440\u0441\u0442\u0432\u0435\u043d\u043d\u043e\u0439 \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u0438 \u0418\u041f, \u0438\u043c\u0435\u043d\u0443\u0435\u043c\u044b\u0439 \u0432 \u0434\u0430\u043b\u044c\u043d\u0435\u0439\u0448\u0435\u043c \u00ab\u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u00bb, \u0441 \u043e\u0434\u043d\u043e\u0439 \u0441\u0442\u043e\u0440\u043e\u043d\u044b, \u0438</p>';
  H += '<p class="ind"><b>' + client + '</b> (\u0424\u0418\u041e \u0438\u043b\u0438 \u043d\u0430\u0438\u043c\u0435\u043d\u043e\u0432\u0430\u043d\u0438\u0435 \u043e\u0440\u0433\u0430\u043d\u0438\u0437\u0430\u0446\u0438\u0438, \u0418\u0418\u041d/\u0411\u0418\u041d: ' + iin + '), \u0438\u043c\u0435\u043d\u0443\u0435\u043c\u044b\u0439(-\u0430\u044f) \u0432 \u0434\u0430\u043b\u044c\u043d\u0435\u0439\u0448\u0435\u043c \u00ab\u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u00bb, \u0441 \u0434\u0440\u0443\u0433\u043e\u0439 \u0441\u0442\u043e\u0440\u043e\u043d\u044b, \u0441\u043e\u0432\u043c\u0435\u0441\u0442\u043d\u043e \u0438\u043c\u0435\u043d\u0443\u0435\u043c\u044b\u0435 \u00ab\u0421\u0442\u043e\u0440\u043e\u043d\u044b\u00bb,</p>';
  H += '<p class="ind">\u0437\u0430\u043a\u043b\u044e\u0447\u0438\u043b\u0438 \u043d\u0430\u0441\u0442\u043e\u044f\u0449\u0438\u0439 \u0414\u043e\u0433\u043e\u0432\u043e\u0440 (\u0434\u0430\u043b\u0435\u0435 \u2014 \u00ab\u0414\u043e\u0433\u043e\u0432\u043e\u0440\u00bb) \u043e \u043d\u0438\u0436\u0435\u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0435\u043c:</p>';

  // РАЗДЕЛ 1
  H += '<hr class="hr"><p class="sec">1. \u041f\u0420\u0415\u0414\u041c\u0415\u0422 \u0414\u041e\u0413\u041e\u0412\u041e\u0420\u0410</p>';
  H += '<p>1.1. \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c \u043e\u0431\u044f\u0437\u0443\u0435\u0442\u0441\u044f \u0438\u0437\u0433\u043e\u0442\u043e\u0432\u0438\u0442\u044c \u0438 \u043f\u0440\u043e\u0438\u0437\u0432\u0435\u0441\u0442\u0438 \u043c\u043e\u043d\u0442\u0430\u0436 \u043a\u043e\u0440\u043f\u0443\u0441\u043d\u043e\u0439 \u043c\u0435\u0431\u0435\u043b\u0438 (\u0434\u0430\u043b\u0435\u0435 \u2014 \u00ab\u0418\u0437\u0434\u0435\u043b\u0438\u0435\u00bb) \u0441\u043e\u0433\u043b\u0430\u0441\u043d\u043e \u0441\u043e\u0433\u043b\u0430\u0441\u043e\u0432\u0430\u043d\u043d\u044b\u043c \u0421\u0442\u043e\u0440\u043e\u043d\u0430\u043c\u0438 \u043f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u0430\u043c, \u0443\u043a\u0430\u0437\u0430\u043d\u043d\u044b\u043c \u0432 \u043d\u0430\u0441\u0442\u043e\u044f\u0449\u0435\u043c \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0435, \u0430 \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a \u043e\u0431\u044f\u0437\u0443\u0435\u0442\u0441\u044f \u043f\u0440\u0438\u043d\u044f\u0442\u044c \u0438 \u043e\u043f\u043b\u0430\u0442\u0438\u0442\u044c \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u043d\u044b\u0435 \u0440\u0430\u0431\u043e\u0442\u044b \u0432 \u043f\u043e\u0440\u044f\u0434\u043a\u0435 \u0438 \u0441\u0440\u043e\u043a\u0438, \u0443\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d\u043d\u044b\u0435 \u043d\u0430\u0441\u0442\u043e\u044f\u0449\u0438\u043c \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u043e\u043c.</p>';
  H += '<p>1.2. \u041d\u0430\u0438\u043c\u0435\u043d\u043e\u0432\u0430\u043d\u0438\u0435, \u0440\u0430\u0437\u043c\u0435\u0440\u044b \u0438 \u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0442\u0430\u0446\u0438\u044f \u0418\u0437\u0434\u0435\u043b\u0438\u044f:</p>';
  H += '<table><tr><td style="width:42%">\u041d\u0430\u0438\u043c\u0435\u043d\u043e\u0432\u0430\u043d\u0438\u0435 \u043c\u0435\u0431\u0435\u043b\u0438</td><td><b>' + obj + '</b></td></tr>';
  H += '<tr><td>\u0420\u0430\u0437\u043c\u0435\u0440\u044b (\u0428\u00d7\u0413\u00d7\u0412), \u043c\u043c</td><td>' + size + '</td></tr></table>';
  H += '<p>1.3. \u041c\u0430\u0442\u0435\u0440\u0438\u0430\u043b\u044b \u043a\u043e\u0440\u043f\u0443\u0441\u0430 \u0438 \u0444\u0430\u0441\u0430\u0434\u043e\u0432:</p>';
  H += '<table><thead><tr><th style="width:36%">\u042d\u043b\u0435\u043c\u0435\u043d\u0442</th><th>\u041c\u0430\u0442\u0435\u0440\u0438\u0430\u043b / \u041f\u0440\u043e\u0438\u0437\u0432\u043e\u0434\u0438\u0442\u0435\u043b\u044c</th></tr></thead><tbody>' + corpRows + '</tbody></table>';
  H += '<p>1.4. \u0424\u0443\u0440\u043d\u0438\u0442\u0443\u0440\u0430:</p>';
  H += '<table><thead><tr><th style="width:30%">\u0412\u0438\u0434 \u0444\u0443\u0440\u043d\u0438\u0442\u0443\u0440\u044b</th><th>\u041c\u0430\u0440\u043a\u0430 / \u041f\u0440\u043e\u0438\u0437\u0432\u043e\u0434\u0438\u0442\u0435\u043b\u044c</th><th style="width:22%">\u041a\u043e\u043b-\u0432\u043e / \u041f\u0440\u0438\u043c\u0435\u0447\u0430\u043d\u0438\u0435</th></tr></thead>';
  H += '<tbody><tr><td>\u041f\u0435\u0442\u043b\u0438</td><td colspan="2">' + petli + '</td></tr>';
  H += '<tr><td>\u041d\u0430\u043f\u0440\u0430\u0432\u043b\u044f\u044e\u0449\u0438\u0435 / \u0434\u043e\u0432\u043e\u0434\u0447\u0438\u043a\u0438</td><td colspan="2">' + naprav + '</td></tr>';
  H += '<tr><td>\u0420\u0443\u0447\u043a\u0438</td><td colspan="2">' + ruchki + '</td></tr>';
  H += '<tr><td>\u0414\u043e\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u0435</td><td colspan="2">' + dFurn + '</td></tr></tbody></table>';
  H += '<p>1.5. \u0414\u043e\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u043d\u044b\u0435 \u0440\u0430\u0431\u043e\u0442\u044b:</p>';
  H += '<table><thead><tr><th>\u041d\u0430\u0438\u043c\u0435\u043d\u043e\u0432\u0430\u043d\u0438\u0435 \u0440\u0430\u0431\u043e\u0442\u044b</th><th style="width:24%">\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435 / \u041c\u0430\u0440\u043a\u0430</th><th style="width:22%">\u0421\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u044c (\u0442\u0435\u043d\u0433\u0435)</th></tr></thead>';
  H += '<tbody>' + dopRows + '</tbody></table>';

  // РАЗДЕЛ 2
  H += '<hr class="hr"><p class="sec">2. \u0421\u0422\u041e\u0418\u041c\u041e\u0421\u0422\u042c \u0420\u0410\u0411\u041e\u0422 \u0418 \u041f\u041e\u0420\u042f\u0414\u041e\u041a \u041e\u041f\u041b\u0410\u0422\u042b</p>';
  H += '<table><tbody>';
  H += '<tr><td style="width:58%">\u041e\u0431\u0449\u0430\u044f \u0441\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u044c \u0440\u0430\u0431\u043e\u0442 (\u0442\u0435\u043d\u0433\u0435)</td><td class="b">' + rub(tot) + '</td></tr>';
  if (fullPay) {
    H += '<tr><td>\u041e\u043f\u043b\u0430\u0442\u0430 \u0435\u0434\u0438\u043d\u043e\u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e \u043f\u0440\u0438 \u043f\u043e\u0434\u043f\u0438\u0441\u0430\u043d\u0438\u0438 \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0430 (100%)</td><td class="b">' + rub(tot) + '</td></tr>';
  } else {
    H += '<tr><td>1-\u0439 \u043f\u043b\u0430\u0442\u0451\u0436: \u0410\u0432\u0430\u043d\u0441 (' + advPct + '%) \u2014 \u043f\u0440\u0438 \u043f\u043e\u0434\u043f\u0438\u0441\u0430\u043d\u0438\u0438</td><td class="b">' + rub(p1) + '</td></tr>';
    H += '<tr><td>2-\u0439 \u043f\u043b\u0430\u0442\u0451\u0436: \u0434\u043e 90% \u043e\u0442 \u0441\u0443\u043c\u043c\u044b \u2014 \u0437\u0430 3 \u0434\u043d\u044f \u0434\u043e \u043c\u043e\u043d\u0442\u0430\u0436\u0430</td><td class="b">' + rub(p2) + '</td></tr>';
    H += '<tr><td>3-\u0439 \u043f\u043b\u0430\u0442\u0451\u0436: \u043e\u0441\u0442\u0430\u0442\u043e\u043a 10% \u2014 \u043f\u043e\u0441\u043b\u0435 \u043c\u043e\u043d\u0442\u0430\u0436\u0430, \u0434\u043e \u043f\u043e\u0434\u043f\u0438\u0441\u0430\u043d\u0438\u044f \u0410\u043a\u0442\u0430</td><td class="b">' + rub(p3) + '</td></tr>';
  }
  H += '</tbody></table>';
  H += '<p>2.1. \u041e\u0431\u0449\u0430\u044f \u0441\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u044c \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0430 \u0432\u043a\u043b\u044e\u0447\u0430\u0435\u0442 \u0441\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u044c \u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b\u043e\u0432, \u0438\u0437\u0433\u043e\u0442\u043e\u0432\u043b\u0435\u043d\u0438\u044f \u0438 \u043c\u043e\u043d\u0442\u0430\u0436\u0430 \u0418\u0437\u0434\u0435\u043b\u0438\u044f \u0441\u043e\u0433\u043b\u0430\u0441\u043d\u043e \u0440\u0430\u0437\u0434\u0435\u043b\u0443 1 \u043d\u0430\u0441\u0442\u043e\u044f\u0449\u0435\u0433\u043e \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0430.</p>';
  if (fullPay) {
    H += '<p>2.2. \u041e\u043f\u043b\u0430\u0442\u0430 \u043f\u0440\u043e\u0438\u0437\u0432\u043e\u0434\u0438\u0442\u0441\u044f \u0435\u0434\u0438\u043d\u043e\u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e \u0432 \u043f\u043e\u043b\u043d\u043e\u043c \u043e\u0431\u044a\u0451\u043c\u0435 \u0432 \u043c\u043e\u043c\u0435\u043d\u0442 \u043f\u043e\u0434\u043f\u0438\u0441\u0430\u043d\u0438\u044f \u043d\u0430\u0441\u0442\u043e\u044f\u0449\u0435\u0433\u043e \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0430 (\u043f\u0440\u0435\u0434\u043e\u043f\u043b\u0430\u0442\u0430 100%). \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c \u043f\u0440\u0438\u0441\u0442\u0443\u043f\u0430\u0435\u0442 \u043a \u0438\u0437\u0433\u043e\u0442\u043e\u0432\u043b\u0435\u043d\u0438\u044e \u0438\u0437\u0434\u0435\u043b\u0438\u044f \u043f\u043e\u0441\u043b\u0435 \u043f\u043e\u0441\u0442\u0443\u043f\u043b\u0435\u043d\u0438\u044f \u043f\u043e\u043b\u043d\u043e\u0439 \u043e\u043f\u043b\u0430\u0442\u044b.</p>';
  } else {
    H += '<p>2.2. \u041f\u043e\u0440\u044f\u0434\u043e\u043a \u043e\u043f\u043b\u0430\u0442\u044b \u0441\u043e\u0441\u0442\u043e\u0438\u0442 \u0438\u0437 \u0442\u0440\u0451\u0445 \u044d\u0442\u0430\u043f\u043e\u0432:</p>';
    H += '<p class="sub">(1) \u0410\u0432\u0430\u043d\u0441\u043e\u0432\u044b\u0439 \u043f\u043b\u0430\u0442\u0451\u0436 (\u043f\u0440\u0435\u0434\u043e\u043f\u043b\u0430\u0442\u0430) \u0432 \u0440\u0430\u0437\u043c\u0435\u0440\u0435 \u043e\u0442 50% (\u043f\u044f\u0442\u0438\u0434\u0435\u0441\u044f\u0442\u0438) \u0434\u043e 70% (\u0441\u0435\u043c\u0438\u0434\u0435\u0441\u044f\u0442\u0438) \u043f\u0440\u043e\u0446\u0435\u043d\u0442\u043e\u0432 \u043e\u0442 \u043e\u0431\u0449\u0435\u0439 \u0441\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u0438 \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0430 \u0432\u043d\u043e\u0441\u0438\u0442\u0441\u044f \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u043e\u043c \u0432 \u043c\u043e\u043c\u0435\u043d\u0442 \u043f\u043e\u0434\u043f\u0438\u0441\u0430\u043d\u0438\u044f \u043d\u0430\u0441\u0442\u043e\u044f\u0449\u0435\u0433\u043e \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0430.</p>';
    H += '<p class="sub">(2) \u041f\u043b\u0430\u0442\u0451\u0436 \u0434\u043e \u043c\u043e\u043d\u0442\u0430\u0436\u0430 \u2014 \u043d\u0435 \u043f\u043e\u0437\u0434\u043d\u0435\u0435 \u0447\u0435\u043c \u0437\u0430 3 (\u0442\u0440\u0438) \u043a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u043d\u044b\u0445 \u0434\u043d\u044f \u0434\u043e \u0441\u043e\u0433\u043b\u0430\u0441\u043e\u0432\u0430\u043d\u043d\u043e\u0439 \u0434\u0430\u0442\u044b \u043c\u043e\u043d\u0442\u0430\u0436\u0430 \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a \u043f\u0440\u043e\u0438\u0437\u0432\u043e\u0434\u0438\u0442 \u043e\u043f\u043b\u0430\u0442\u0443, \u0434\u043e\u0432\u043e\u0434\u044f \u0441\u0443\u043c\u043c\u0430\u0440\u043d\u044b\u0439 \u0440\u0430\u0437\u043c\u0435\u0440 \u0432\u043d\u0435\u0441\u0451\u043d\u043d\u044b\u0445 \u043f\u043b\u0430\u0442\u0435\u0436\u0435\u0439 \u0434\u043e 90% (\u0434\u0435\u0432\u044f\u043d\u043e\u0441\u0442\u0430) \u043f\u0440\u043e\u0446\u0435\u043d\u0442\u043e\u0432 \u043e\u0442 \u043e\u0431\u0449\u0435\u0439 \u0441\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u0438 \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0430. \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c \u0432\u043f\u0440\u0430\u0432\u0435 \u043e\u0442\u043a\u0430\u0437\u0430\u0442\u044c \u0432 \u0432\u044b\u0435\u0437\u0434\u0435 \u043d\u0430 \u043c\u043e\u043d\u0442\u0430\u0436 \u0434\u043e \u0444\u0430\u043a\u0442\u0438\u0447\u0435\u0441\u043a\u043e\u0433\u043e \u043f\u043e\u0441\u0442\u0443\u043f\u043b\u0435\u043d\u0438\u044f \u0434\u0430\u043d\u043d\u043e\u0433\u043e \u043f\u043b\u0430\u0442\u0435\u0436\u0430.</p>';
    H += '<p class="sub">(3) \u041e\u043a\u043e\u043d\u0447\u0430\u0442\u0435\u043b\u044c\u043d\u044b\u0439 \u0440\u0430\u0441\u0447\u0451\u0442 \u2014 \u043e\u0441\u0442\u0430\u0432\u0448\u0438\u0435\u0441\u044f 10% (\u0434\u0435\u0441\u044f\u0442\u044c) \u043f\u0440\u043e\u0446\u0435\u043d\u0442\u043e\u0432 \u043e\u0442 \u043e\u0431\u0449\u0435\u0439 \u0441\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u0438 \u043e\u043f\u043b\u0430\u0447\u0438\u0432\u0430\u044e\u0442\u0441\u044f \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u043e\u043c \u043f\u043e\u0441\u043b\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u0438\u044f \u043c\u043e\u043d\u0442\u0430\u0436\u0430, \u0434\u043e \u043f\u043e\u0434\u043f\u0438\u0441\u0430\u043d\u0438\u044f \u0410\u043a\u0442\u0430 \u043f\u0440\u0438\u0451\u043c\u0430-\u043f\u0435\u0440\u0435\u0434\u0430\u0447\u0438. \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c \u0432\u043f\u0440\u0430\u0432\u0435 \u043d\u0435 \u043f\u043e\u0434\u043f\u0438\u0441\u044b\u0432\u0430\u0442\u044c \u0410\u043a\u0442 \u0434\u043e \u043f\u043e\u043b\u0443\u0447\u0435\u043d\u0438\u044f \u043e\u043a\u043e\u043d\u0447\u0430\u0442\u0435\u043b\u044c\u043d\u043e\u0433\u043e \u0440\u0430\u0441\u0447\u0451\u0442\u0430.</p>';
  }
  H += '<p>2.3. \u0412 \u0441\u043b\u0443\u0447\u0430\u0435 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u043e\u043c \u043f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u043e\u0432 \u0437\u0430\u043a\u0430\u0437\u0430 \u043f\u043e\u0441\u043b\u0435 \u0432\u043d\u0435\u0441\u0435\u043d\u0438\u044f \u043f\u0440\u0435\u0434\u043e\u043f\u043b\u0430\u0442\u044b \u0441\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u044c \u0440\u0430\u0431\u043e\u0442 \u043f\u0435\u0440\u0435\u0441\u043c\u0430\u0442\u0440\u0438\u0432\u0430\u0435\u0442\u0441\u044f \u0421\u0442\u043e\u0440\u043e\u043d\u0430\u043c\u0438 \u0438 \u0444\u0438\u043a\u0441\u0438\u0440\u0443\u0435\u0442\u0441\u044f \u0414\u043e\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u043d\u044b\u043c \u0441\u043e\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u0435\u043c. \u041f\u0440\u0438 \u0443\u0432\u0435\u043b\u0438\u0447\u0435\u043d\u0438\u0438 \u0441\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u0438 \u0440\u0430\u0437\u043d\u0438\u0446\u0430 \u043e\u043f\u043b\u0430\u0447\u0438\u0432\u0430\u0435\u0442\u0441\u044f \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u043e\u043c; \u043f\u0440\u0438 \u0443\u043c\u0435\u043d\u044c\u0448\u0435\u043d\u0438\u0438 \u2014 \u0432\u043e\u0437\u0432\u0440\u0430\u0442 \u043f\u0440\u043e\u0438\u0437\u0432\u043e\u0434\u0438\u0442\u0441\u044f \u0437\u0430 \u0432\u044b\u0447\u0435\u0442\u043e\u043c \u0444\u0430\u043a\u0442\u0438\u0447\u0435\u0441\u043a\u0438 \u043f\u043e\u043d\u0435\u0441\u0451\u043d\u043d\u044b\u0445 \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u0435\u043c \u0440\u0430\u0441\u0445\u043e\u0434\u043e\u0432.</p>';
  H += '<p>2.4. \u0412 \u0441\u043b\u0443\u0447\u0430\u0435 \u043e\u0434\u043d\u043e\u0441\u0442\u043e\u0440\u043e\u043d\u043d\u0435\u0433\u043e \u043e\u0442\u043a\u0430\u0437\u0430 \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u0430 \u043e\u0442 \u0438\u0441\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0430 \u043f\u043e\u0441\u043b\u0435 \u043d\u0430\u0447\u0430\u043b\u0430 \u043f\u0440\u043e\u0438\u0437\u0432\u043e\u0434\u0441\u0442\u0432\u0430 \u0443\u043f\u043b\u0430\u0447\u0435\u043d\u043d\u044b\u0439 \u0430\u0432\u0430\u043d\u0441 \u0432\u043e\u0437\u0432\u0440\u0430\u0442\u0443 \u043d\u0435 \u043f\u043e\u0434\u043b\u0435\u0436\u0438\u0442 \u0438 \u0443\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044f \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u0435\u043c \u0432 \u0441\u0447\u0451\u0442 \u0432\u043e\u0437\u043c\u0435\u0449\u0435\u043d\u0438\u044f \u0444\u0430\u043a\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0445 \u0440\u0430\u0441\u0445\u043e\u0434\u043e\u0432 (\u0437\u0430\u043a\u0443\u043f\u043a\u0430 \u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b\u043e\u0432, \u0440\u0430\u0441\u043a\u0440\u043e\u0439, \u043e\u043f\u043b\u0430\u0442\u0430 \u0442\u0440\u0443\u0434\u0430). \u0415\u0441\u043b\u0438 \u0444\u0430\u043a\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0435 \u0440\u0430\u0441\u0445\u043e\u0434\u044b \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044f \u043f\u0440\u0435\u0432\u044b\u0448\u0430\u044e\u0442 \u0441\u0443\u043c\u043c\u0443 \u0443\u0434\u0435\u0440\u0436\u0430\u043d\u043d\u043e\u0433\u043e \u0430\u0432\u0430\u043d\u0441\u0430, \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a \u043e\u0431\u044f\u0437\u0430\u043d \u0432\u043e\u0437\u043c\u0435\u0441\u0442\u0438\u0442\u044c \u0440\u0430\u0437\u043d\u0438\u0446\u0443 \u0432 \u0442\u0435\u0447\u0435\u043d\u0438\u0435 10 (\u0434\u0435\u0441\u044f\u0442\u0438) \u043a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u043d\u044b\u0445 \u0434\u043d\u0435\u0439 \u0441 \u043c\u043e\u043c\u0435\u043d\u0442\u0430 \u043f\u043e\u043b\u0443\u0447\u0435\u043d\u0438\u044f \u0441\u043e\u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0443\u044e\u0449\u0435\u0433\u043e \u0442\u0440\u0435\u0431\u043e\u0432\u0430\u043d\u0438\u044f.</p>';
  H += '<p>2.5. \u041e\u043f\u043b\u0430\u0442\u0430 \u043f\u0440\u043e\u0438\u0437\u0432\u043e\u0434\u0438\u0442\u0441\u044f \u043d\u0430\u043b\u0438\u0447\u043d\u044b\u043c\u0438 \u0434\u0435\u043d\u0435\u0436\u043d\u044b\u043c\u0438 \u0441\u0440\u0435\u0434\u0441\u0442\u0432\u0430\u043c\u0438 \u0438\u043b\u0438 \u0431\u0435\u0437\u043d\u0430\u043b\u0438\u0447\u043d\u044b\u043c \u043f\u0435\u0440\u0435\u0432\u043e\u0434\u043e\u043c \u043d\u0430 \u0440\u0435\u043a\u0432\u0438\u0437\u0438\u0442\u044b \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044f. \u0424\u0430\u043a\u0442 \u043e\u043f\u043b\u0430\u0442\u044b \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0430\u0435\u0442\u0441\u044f \u043a\u0430\u0441\u0441\u043e\u0432\u044b\u043c \u0447\u0435\u043a\u043e\u043c \u0438\u043b\u0438 \u043f\u043b\u0430\u0442\u0451\u0436\u043d\u044b\u043c \u043f\u043e\u0440\u0443\u0447\u0435\u043d\u0438\u0435\u043c \u0441 \u043e\u0442\u043c\u0435\u0442\u043a\u043e\u0439 \u0431\u0430\u043d\u043a\u0430.</p>';

  // РАЗДЕЛ 3
  H += '<hr class="hr"><p class="sec">3. \u0421\u0420\u041e\u041a\u0418 \u0418\u0421\u041f\u041e\u041b\u041d\u0415\u041d\u0418\u042f</p>';
  H += '<p>3.1. \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c \u043f\u0440\u0438\u0441\u0442\u0443\u043f\u0430\u0435\u0442 \u043a \u0438\u0437\u0433\u043e\u0442\u043e\u0432\u043b\u0435\u043d\u0438\u044e \u0418\u0437\u0434\u0435\u043b\u0438\u044f \u043f\u043e\u0441\u043b\u0435 \u043f\u043e\u0441\u0442\u0443\u043f\u043b\u0435\u043d\u0438\u044f \u0430\u0432\u0430\u043d\u0441\u043e\u0432\u043e\u0433\u043e \u043f\u043b\u0430\u0442\u0435\u0436\u0430 \u0432 \u043f\u043e\u043b\u043d\u043e\u043c \u043e\u0431\u044a\u0451\u043c\u0435.</p>';
  H += '<table><tbody>';
  H += '<tr><td style="width:58%">\u0421\u0440\u043e\u043a \u0438\u0437\u0433\u043e\u0442\u043e\u0432\u043b\u0435\u043d\u0438\u044f (\u0440\u0430\u0431\u043e\u0447\u0438\u0445 \u0434\u043d\u0435\u0439 \u0441 \u0434\u0430\u0442\u044b \u0430\u0432\u0430\u043d\u0441\u0430)</td><td class="b">' + daysVal + ' \u0440\u0430\u0431\u043e\u0447\u0438\u0445 \u0434\u043d\u0435\u0439</td></tr>';
  H += '<tr><td>\u041f\u043b\u0430\u043d\u0438\u0440\u0443\u0435\u043c\u0430\u044f \u0434\u0430\u0442\u0430 \u043c\u043e\u043d\u0442\u0430\u0436\u0430</td><td class="b">' + mntRU + '</td></tr>';
  H += '</tbody></table>';
  H += '<p>3.2. \u0421\u0440\u043e\u043a \u0438\u0441\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f \u043c\u043e\u0436\u0435\u0442 \u0431\u044b\u0442\u044c \u043f\u0440\u043e\u0434\u043b\u0451\u043d \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u0435\u043c \u0432 \u043e\u0434\u043d\u043e\u0441\u0442\u043e\u0440\u043e\u043d\u043d\u0435\u043c \u043f\u043e\u0440\u044f\u0434\u043a\u0435 \u0432 \u0441\u043b\u0443\u0447\u0430\u0435: \u043f\u0440\u043e\u0441\u0440\u043e\u0447\u043a\u0438 \u043b\u044e\u0431\u043e\u0433\u043e \u0438\u0437 \u043f\u043b\u0430\u0442\u0435\u0436\u0435\u0439 \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u043e\u043c (\u043d\u0430 \u0441\u043e\u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0443\u044e\u0449\u0435\u0435 \u043a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e \u0434\u043d\u0435\u0439 \u043f\u0440\u043e\u0441\u0440\u043e\u0447\u043a\u0438); \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f \u0437\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u043e\u043c \u043f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u043e\u0432 \u0437\u0430\u043a\u0430\u0437\u0430 \u043f\u043e\u0441\u043b\u0435 \u0437\u0430\u043f\u0443\u0441\u043a\u0430 \u0432 \u043f\u0440\u043e\u0438\u0437\u0432\u043e\u0434\u0441\u0442\u0432\u043e; \u043d\u0430\u0441\u0442\u0443\u043f\u043b\u0435\u043d\u0438\u044f \u043e\u0431\u0441\u0442\u043e\u044f\u0442\u0435\u043b\u044c\u0441\u0442\u0432 \u043d\u0435\u043f\u0440\u0435\u043e\u0434\u043e\u043b\u0438\u043c\u043e\u0439 \u0441\u0438\u043b\u044b (\u0444\u043e\u0440\u0441-\u043c\u0430\u0436\u043e\u0440).</p>';
  H += '<p>3.3. \u0412 \u0441\u043b\u0443\u0447\u0430\u0435 \u043e\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0438\u044f \u0434\u043e\u0441\u0442\u0443\u043f\u0430 \u043a \u043c\u0435\u0441\u0442\u0443 \u043c\u043e\u043d\u0442\u0430\u0436\u0430 \u043f\u043e \u0432\u0438\u043d\u0435 \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u0430 \u0432 \u0441\u043e\u0433\u043b\u0430\u0441\u043e\u0432\u0430\u043d\u043d\u0443\u044e \u0434\u0430\u0442\u0443 \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c \u0432\u043f\u0440\u0430\u0432\u0435 \u043f\u0435\u0440\u0435\u043d\u0435\u0441\u0442\u0438 \u043c\u043e\u043d\u0442\u0430\u0436 \u043d\u0430 \u0438\u043d\u0443\u044e \u0434\u0430\u0442\u0443 \u0431\u0435\u0437 \u0448\u0442\u0440\u0430\u0444\u043d\u044b\u0445 \u0441\u0430\u043d\u043a\u0446\u0438\u0439 \u0432 \u0441\u0432\u043e\u0439 \u0430\u0434\u0440\u0435\u0441. \u041f\u043e\u0432\u0442\u043e\u0440\u043d\u044b\u0439 \u0432\u044b\u0435\u0437\u0434 \u043e\u043f\u043b\u0430\u0447\u0438\u0432\u0430\u0435\u0442\u0441\u044f \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u043e\u043c \u0434\u043e\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u043d\u043e \u043f\u043e \u0434\u0435\u0439\u0441\u0442\u0432\u0443\u044e\u0449\u0438\u043c \u0442\u0430\u0440\u0438\u0444\u0430\u043c \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044f.</p>';

  // РАЗДЕЛ 4
  H += '<hr class="hr"><p class="sec">4. \u041f\u0420\u0410\u0412\u0410 \u0418 \u041e\u0411\u042f\u0417\u0410\u041d\u041d\u041e\u0421\u0422\u0418 \u0421\u0422\u041e\u0420\u041e\u041d</p>';
  H += '<p>4.1. \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c \u043e\u0431\u044f\u0437\u0443\u0435\u0442\u0441\u044f:</p>';
  H += '<p class="sub">4.1.1. \u0418\u0437\u0433\u043e\u0442\u043e\u0432\u0438\u0442\u044c \u0418\u0437\u0434\u0435\u043b\u0438\u0435 \u0432 \u0441\u043e\u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0438\u0438 \u0441 \u0441\u043e\u0433\u043b\u0430\u0441\u043e\u0432\u0430\u043d\u043d\u044b\u043c\u0438 \u043f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u0430\u043c\u0438, \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u044f \u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b\u044b \u043d\u0430\u0434\u043b\u0435\u0436\u0430\u0449\u0435\u0433\u043e \u043a\u0430\u0447\u0435\u0441\u0442\u0432\u0430.</p>';
  H += '<p class="sub">4.1.2. \u0412\u044b\u043f\u043e\u043b\u043d\u0438\u0442\u044c \u043c\u043e\u043d\u0442\u0430\u0436 \u0418\u0437\u0434\u0435\u043b\u0438\u044f \u0432 \u043c\u0435\u0441\u0442\u0435, \u0443\u043a\u0430\u0437\u0430\u043d\u043d\u043e\u043c \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u043e\u043c, \u043e\u0431\u0435\u0441\u043f\u0435\u0447\u0438\u0432 \u0440\u0430\u0431\u043e\u0442\u043e\u0441\u043f\u043e\u0441\u043e\u0431\u043d\u043e\u0441\u0442\u044c \u0432\u0441\u0435\u0445 \u043c\u0435\u0445\u0430\u043d\u0438\u0437\u043c\u043e\u0432 \u0438 \u043a\u043e\u043d\u0441\u0442\u0440\u0443\u043a\u0442\u0438\u0432\u043d\u044b\u0445 \u044d\u043b\u0435\u043c\u0435\u043d\u0442\u043e\u0432.</p>';
  H += '<p class="sub">4.1.3. \u0423\u0432\u0435\u0434\u043e\u043c\u0438\u0442\u044c \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u0430 \u043e \u0433\u043e\u0442\u043e\u0432\u043d\u043e\u0441\u0442\u0438 \u0418\u0437\u0434\u0435\u043b\u0438\u044f \u043a \u043c\u043e\u043d\u0442\u0430\u0436\u0443 \u043d\u0435 \u043c\u0435\u043d\u0435\u0435 \u0447\u0435\u043c \u0437\u0430 1 (\u043e\u0434\u0438\u043d) \u0440\u0430\u0431\u043e\u0447\u0438\u0439 \u0434\u0435\u043d\u044c.</p>';
  H += '<p class="sub">4.1.4. \u0423\u0441\u0442\u0440\u0430\u043d\u0438\u0442\u044c \u043d\u0435\u0434\u043e\u0441\u0442\u0430\u0442\u043a\u0438, \u0432\u044b\u044f\u0432\u043b\u0435\u043d\u043d\u044b\u0435 \u043f\u0440\u0438 \u043f\u0440\u0438\u0451\u043c\u043a\u0435 \u0438 \u0432\u043e\u0437\u043d\u0438\u043a\u0448\u0438\u0435 \u043f\u043e \u0432\u0438\u043d\u0435 \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044f, \u0432 \u0440\u0430\u0437\u0443\u043c\u043d\u044b\u0439 \u0441\u0440\u043e\u043a, \u043d\u043e \u043d\u0435 \u0431\u043e\u043b\u0435\u0435 14 (\u0447\u0435\u0442\u044b\u0440\u043d\u0430\u0434\u0446\u0430\u0442\u0438) \u0440\u0430\u0431\u043e\u0447\u0438\u0445 \u0434\u043d\u0435\u0439.</p>';
  H += '<p>4.2. \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c \u0432\u043f\u0440\u0430\u0432\u0435:</p>';
  H += '<p class="sub">4.2.1. \u041f\u0440\u0438\u0432\u043b\u0435\u043a\u0430\u0442\u044c \u0442\u0440\u0435\u0442\u044c\u0438\u0445 \u043b\u0438\u0446 \u0434\u043b\u044f \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f \u043e\u0442\u0434\u0435\u043b\u044c\u043d\u044b\u0445 \u0432\u0438\u0434\u043e\u0432 \u0440\u0430\u0431\u043e\u0442, \u043e\u0441\u0442\u0430\u0432\u0430\u044f\u0441\u044c \u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043d\u043d\u044b\u043c \u043f\u0435\u0440\u0435\u0434 \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u043e\u043c \u0437\u0430 \u043a\u043e\u043d\u0435\u0447\u043d\u044b\u0439 \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442.</p>';
  H += '<p class="sub">4.2.2. \u041f\u0440\u0438\u043e\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u044c \u0440\u0430\u0431\u043e\u0442\u044b \u043f\u0440\u0438 \u043f\u0440\u043e\u0441\u0440\u043e\u0447\u043a\u0435 \u043b\u044e\u0431\u043e\u0433\u043e \u0438\u0437 \u043f\u043b\u0430\u0442\u0435\u0436\u0435\u0439 \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u043e\u043c \u0431\u0435\u0437 \u0443\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u044f.</p>';
  H += '<p class="sub">4.2.3. \u041e\u0442\u043a\u0430\u0437\u0430\u0442\u044c\u0441\u044f \u043e\u0442 \u043f\u0440\u043e\u0432\u0435\u0434\u0435\u043d\u0438\u044f \u043c\u043e\u043d\u0442\u0430\u0436\u0430, \u0435\u0441\u043b\u0438 \u043f\u043e\u043c\u0435\u0449\u0435\u043d\u0438\u0435 \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u0430 \u043d\u0435 \u043f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043b\u0435\u043d\u043e (\u043d\u0435\u0440\u043e\u0432\u043d\u044b\u0435 \u0441\u0442\u0435\u043d\u044b/\u043f\u043e\u043b \u0441\u0432\u0435\u0440\u0445 \u0434\u043e\u043f\u0443\u0441\u043a\u0430, \u043e\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0438\u0435 \u044d\u043b\u0435\u043a\u0442\u0440\u043e\u043f\u0438\u0442\u0430\u043d\u0438\u044f, \u0441\u0442\u0440\u043e\u0438\u0442\u0435\u043b\u044c\u043d\u044b\u0439 \u043c\u0443\u0441\u043e\u0440) \u2014 \u0431\u0435\u0437 \u0432\u043e\u0437\u0432\u0440\u0430\u0442\u0430 \u0430\u0432\u0430\u043d\u0441\u0430, \u0443\u043f\u043b\u0430\u0447\u0435\u043d\u043d\u043e\u0433\u043e \u0437\u0430 \u0438\u0437\u0433\u043e\u0442\u043e\u0432\u043b\u0435\u043d\u0438\u0435.</p>';
  H += '<p>4.3. \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a \u043e\u0431\u044f\u0437\u0443\u0435\u0442\u0441\u044f:</p>';
  H += '<p class="sub">4.3.1. \u0412\u043d\u043e\u0441\u0438\u0442\u044c \u043f\u043b\u0430\u0442\u0435\u0436\u0438 \u0432 \u043f\u043e\u0440\u044f\u0434\u043a\u0435 \u0438 \u0441\u0440\u043e\u043a\u0438, \u043f\u0440\u0435\u0434\u0443\u0441\u043c\u043e\u0442\u0440\u0435\u043d\u043d\u044b\u0435 \u0440\u0430\u0437\u0434\u0435\u043b\u043e\u043c 2 \u043d\u0430\u0441\u0442\u043e\u044f\u0449\u0435\u0433\u043e \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0430.</p>';
  H += '<p class="sub">4.3.2. \u041e\u0431\u0435\u0441\u043f\u0435\u0447\u0438\u0442\u044c \u0441\u0432\u043e\u0431\u043e\u0434\u043d\u044b\u0439 \u0434\u043e\u0441\u0442\u0443\u043f \u043a \u043c\u0435\u0441\u0442\u0443 \u043c\u043e\u043d\u0442\u0430\u0436\u0430 \u0432 \u0441\u043e\u0433\u043b\u0430\u0441\u043e\u0432\u0430\u043d\u043d\u0443\u044e \u0434\u0430\u0442\u0443, \u043d\u0430\u043b\u0438\u0447\u0438\u0435 \u0440\u0430\u0431\u043e\u0447\u0435\u0433\u043e \u044d\u043b\u0435\u043a\u0442\u0440\u043e\u043f\u0438\u0442\u0430\u043d\u0438\u044f \u0438 \u0441\u0432\u043e\u0431\u043e\u0434\u043d\u043e\u0433\u043e \u043f\u0440\u043e\u0441\u0442\u0440\u0430\u043d\u0441\u0442\u0432\u0430, \u0434\u043e\u0441\u0442\u0430\u0442\u043e\u0447\u043d\u043e\u0433\u043e \u0434\u043b\u044f \u043f\u0440\u043e\u0432\u0435\u0434\u0435\u043d\u0438\u044f \u0440\u0430\u0431\u043e\u0442.</p>';
  H += '<p class="sub">4.3.3. \u041e\u0441\u043c\u043e\u0442\u0440\u0435\u0442\u044c \u0418\u0437\u0434\u0435\u043b\u0438\u0435 \u0438 \u043f\u0440\u043e\u0432\u0435\u0440\u0438\u0442\u044c \u0440\u0430\u0431\u043e\u0442\u0443 \u0432\u0441\u0435\u0445 \u043c\u0435\u0445\u0430\u043d\u0438\u0437\u043c\u043e\u0432 \u043d\u0435\u043f\u043e\u0441\u0440\u0435\u0434\u0441\u0442\u0432\u0435\u043d\u043d\u043e \u0432 \u0434\u0435\u043d\u044c \u043c\u043e\u043d\u0442\u0430\u0436\u0430, \u043f\u043e\u0441\u043b\u0435 \u0447\u0435\u0433\u043e \u043f\u043e\u0434\u043f\u0438\u0441\u0430\u0442\u044c \u0410\u043a\u0442 \u043f\u0440\u0438\u0451\u043c\u0430-\u043f\u0435\u0440\u0435\u0434\u0430\u0447\u0438.</p>';
  H += '<p class="sub">4.3.4. \u041d\u0435 \u0432\u043d\u043e\u0441\u0438\u0442\u044c \u0441\u0430\u043c\u043e\u0441\u0442\u043e\u044f\u0442\u0435\u043b\u044c\u043d\u043e \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f \u0432 \u043a\u043e\u043d\u0441\u0442\u0440\u0443\u043a\u0446\u0438\u044e \u0418\u0437\u0434\u0435\u043b\u0438\u044f \u0432 \u0442\u0435\u0447\u0435\u043d\u0438\u0435 \u0433\u0430\u0440\u0430\u043d\u0442\u0438\u0439\u043d\u043e\u0433\u043e \u0441\u0440\u043e\u043a\u0430 \u0431\u0435\u0437 \u043f\u0438\u0441\u044c\u043c\u0435\u043d\u043d\u043e\u0433\u043e \u0443\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u044f \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044f.</p>';
  H += '<p>4.4. \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a \u0432\u043f\u0440\u0430\u0432\u0435:</p>';
  H += '<p class="sub">4.4.1. \u0422\u0440\u0435\u0431\u043e\u0432\u0430\u0442\u044c \u0441\u043e\u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0438\u044f \u0418\u0437\u0434\u0435\u043b\u0438\u044f \u0441\u043e\u0433\u043b\u0430\u0441\u043e\u0432\u0430\u043d\u043d\u044b\u043c \u043f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u0430\u043c \u0438 \u043d\u0430\u0434\u043b\u0435\u0436\u0430\u0449\u0435\u0433\u043e \u043a\u0430\u0447\u0435\u0441\u0442\u0432\u0430 \u0440\u0430\u0431\u043e\u0442.</p>';
  H += '<p class="sub">4.4.2. \u041f\u0440\u0438 \u0437\u0430\u0434\u0435\u0440\u0436\u043a\u0435 \u043c\u043e\u043d\u0442\u0430\u0436\u0430 \u043f\u043e \u0432\u0438\u043d\u0435 \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044f \u0431\u043e\u043b\u0435\u0435 \u0447\u0435\u043c \u043d\u0430 14 (\u0447\u0435\u0442\u044b\u0440\u043d\u0430\u0434\u0446\u0430\u0442\u044c) \u0440\u0430\u0431\u043e\u0447\u0438\u0445 \u0434\u043d\u0435\u0439 \u0441\u0432\u0435\u0440\u0445 \u0441\u043e\u0433\u043b\u0430\u0441\u043e\u0432\u0430\u043d\u043d\u043e\u0439 \u0434\u0430\u0442\u044b \u2014 \u043f\u043e\u0442\u0440\u0435\u0431\u043e\u0432\u0430\u0442\u044c \u0432\u043e\u0437\u0432\u0440\u0430\u0442\u0430 \u0443\u043f\u043b\u0430\u0447\u0435\u043d\u043d\u044b\u0445 \u0434\u0435\u043d\u0435\u0436\u043d\u044b\u0445 \u0441\u0440\u0435\u0434\u0441\u0442\u0432 \u0437\u0430 \u0432\u044b\u0447\u0435\u0442\u043e\u043c \u0444\u0430\u043a\u0442\u0438\u0447\u0435\u0441\u043a\u0438 \u043f\u043e\u043d\u0435\u0441\u0451\u043d\u043d\u044b\u0445 \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u0435\u043c \u0440\u0430\u0441\u0445\u043e\u0434\u043e\u0432.</p>';

  // РАЗДЕЛ 5
  H += '<hr class="hr"><p class="sec">5. \u0417\u0410\u041c\u0415\u0420\u042b \u0418 \u041e\u0422\u0412\u0415\u0422\u0421\u0422\u0412\u0415\u041d\u041d\u041e\u0421\u0422\u042c \u0417\u0410 \u0422\u041e\u0427\u041d\u041e\u0421\u0422\u042c \u0420\u0410\u0417\u041c\u0415\u0420\u041e\u0412</p>';
  H += '<p>5.1. \u0417\u0430\u043c\u0435\u0440\u044b \u043f\u043e\u043c\u0435\u0449\u0435\u043d\u0438\u044f \u043f\u0440\u043e\u0438\u0437\u0432\u043e\u0434\u044f\u0442\u0441\u044f \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u0435\u043c. \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a \u043e\u0431\u044f\u0437\u0430\u043d \u043f\u0440\u0435\u0434\u043e\u0441\u0442\u0430\u0432\u0438\u0442\u044c \u0434\u043e\u0441\u0442\u0443\u043f \u043a \u043f\u043e\u043c\u0435\u0449\u0435\u043d\u0438\u044e \u0438 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c \u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u043e\u0441\u0442\u044c \u0437\u0430\u043c\u0435\u0440\u043e\u0432 \u043f\u043e\u0434\u043f\u0438\u0441\u044c\u044e \u043d\u0430 \u044d\u0441\u043a\u0438\u0437\u0435 \u0438\u043b\u0438 \u0441\u0445\u0435\u043c\u0435 \u0434\u043e \u0437\u0430\u043f\u0443\u0441\u043a\u0430 \u0418\u0437\u0434\u0435\u043b\u0438\u044f \u0432 \u043f\u0440\u043e\u0438\u0437\u0432\u043e\u0434\u0441\u0442\u0432\u043e.</p>';
  H += '<p>5.2. \u0415\u0441\u043b\u0438 \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a \u0441\u0430\u043c\u043e\u0441\u0442\u043e\u044f\u0442\u0435\u043b\u044c\u043d\u043e \u043f\u0440\u0435\u0434\u043e\u0441\u0442\u0430\u0432\u0438\u043b \u0440\u0430\u0437\u043c\u0435\u0440\u044b \u0431\u0435\u0437 \u0432\u044b\u0435\u0437\u0434\u0430 \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044f, \u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043d\u043d\u043e\u0441\u0442\u044c \u0437\u0430 \u0438\u0445 \u0442\u043e\u0447\u043d\u043e\u0441\u0442\u044c \u0438 \u0441\u043e\u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0438\u0435 \u0433\u043e\u0442\u043e\u0432\u043e\u0433\u043e \u0418\u0437\u0434\u0435\u043b\u0438\u044f \u043d\u0435\u0441\u0451\u0442 \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a.</p>';
  H += '<p>5.3. \u041b\u044e\u0431\u044b\u0435 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f \u0440\u0430\u0437\u043c\u0435\u0440\u043e\u0432 \u0438\u043b\u0438 \u043a\u043e\u043d\u0444\u0438\u0433\u0443\u0440\u0430\u0446\u0438\u0438 \u043f\u043e\u0441\u043b\u0435 \u043f\u043e\u0434\u043f\u0438\u0441\u0430\u043d\u0438\u044f \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0430 \u0444\u0438\u043a\u0441\u0438\u0440\u0443\u044e\u0442\u0441\u044f \u0414\u043e\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u043d\u044b\u043c \u0441\u043e\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u0435\u043c \u0438 \u043c\u043e\u0433\u0443\u0442 \u043f\u043e\u0432\u043b\u0435\u0447\u044c \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u0435 \u0441\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u0438 \u0438 \u0441\u0440\u043e\u043a\u0430 \u0438\u0441\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f.</p>';

  // РАЗДЕЛ 6
  H += '<hr class="hr"><p class="sec">6. \u041f\u0420\u0418\u0401\u041c\u041a\u0410 \u0418 \u041a\u0410\u0427\u0415\u0421\u0422\u0412\u041e</p>';
  H += '<p>6.1. \u041f\u0440\u0438\u0451\u043c\u043a\u0430 \u0418\u0437\u0434\u0435\u043b\u0438\u044f \u043f\u0440\u043e\u0438\u0437\u0432\u043e\u0434\u0438\u0442\u0441\u044f \u043f\u043e\u0441\u043b\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u0438\u044f \u043c\u043e\u043d\u0442\u0430\u0436\u0430 \u043f\u0443\u0442\u0451\u043c \u0441\u043e\u0432\u043c\u0435\u0441\u0442\u043d\u043e\u0433\u043e \u043f\u043e\u0434\u043f\u0438\u0441\u0430\u043d\u0438\u044f \u0410\u043a\u0442\u0430 \u043f\u0440\u0438\u0451\u043c\u0430-\u043f\u0435\u0440\u0435\u0434\u0430\u0447\u0438 \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u043d\u044b\u0445 \u0440\u0430\u0431\u043e\u0442. \u0421 \u043c\u043e\u043c\u0435\u043d\u0442\u0430 \u043f\u043e\u0434\u043f\u0438\u0441\u0430\u043d\u0438\u044f \u0410\u043a\u0442\u0430 \u0440\u0438\u0441\u043a \u0441\u043b\u0443\u0447\u0430\u0439\u043d\u043e\u0439 \u0433\u0438\u0431\u0435\u043b\u0438 \u0438\u043b\u0438 \u043f\u043e\u0432\u0440\u0435\u0436\u0434\u0435\u043d\u0438\u044f \u0418\u0437\u0434\u0435\u043b\u0438\u044f \u043f\u0435\u0440\u0435\u0445\u043e\u0434\u0438\u0442 \u043a \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u0443.</p>';
  H += '<p>6.2. \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a \u043e\u0431\u044f\u0437\u0430\u043d \u043e\u0441\u043c\u043e\u0442\u0440\u0435\u0442\u044c \u0418\u0437\u0434\u0435\u043b\u0438\u0435 \u0438 \u043f\u0440\u043e\u0432\u0435\u0440\u0438\u0442\u044c \u0440\u0430\u0431\u043e\u0442\u0443 \u0432\u0441\u0435\u0445 \u043c\u0435\u0445\u0430\u043d\u0438\u0437\u043c\u043e\u0432 \u0432 \u0434\u0435\u043d\u044c \u043c\u043e\u043d\u0442\u0430\u0436\u0430. \u0412\u0441\u0435 \u043f\u0440\u0435\u0442\u0435\u043d\u0437\u0438\u0438 \u043f\u043e \u0432\u0438\u0434\u0438\u043c\u044b\u043c \u043d\u0435\u0434\u043e\u0441\u0442\u0430\u0442\u043a\u0430\u043c (\u0446\u0430\u0440\u0430\u043f\u0438\u043d\u044b, \u0441\u043a\u043e\u043b\u044b, \u043d\u0435\u0441\u043e\u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0438\u0435 \u0446\u0432\u0435\u0442\u0430, \u0434\u0435\u043a\u043e\u0440\u0430) \u0434\u043e\u043b\u0436\u043d\u044b \u0431\u044b\u0442\u044c \u0437\u0430\u044f\u0432\u043b\u0435\u043d\u044b \u0432 \u044d\u0442\u043e\u0442 \u0436\u0435 \u0434\u0435\u043d\u044c \u0438 \u043e\u0442\u0440\u0430\u0436\u0435\u043d\u044b \u0432 \u0410\u043a\u0442\u0435. \u041f\u0440\u0435\u0442\u0435\u043d\u0437\u0438\u0438 \u043f\u043e \u0432\u0438\u0434\u0438\u043c\u044b\u043c \u043d\u0435\u0434\u043e\u0441\u0442\u0430\u0442\u043a\u0430\u043c, \u0437\u0430\u044f\u0432\u043b\u0435\u043d\u043d\u044b\u0435 \u043f\u043e\u0441\u043b\u0435 \u043f\u043e\u0434\u043f\u0438\u0441\u0430\u043d\u0438\u044f \u0410\u043a\u0442\u0430, \u043d\u0435 \u043f\u0440\u0438\u043d\u0438\u043c\u0430\u044e\u0442\u0441\u044f.</p>';
  H += '<p>6.3. \u041e\u0442\u043a\u043b\u043e\u043d\u0435\u043d\u0438\u044f \u0440\u0430\u0437\u043c\u0435\u0440\u043e\u0432 \u0432 \u043f\u0440\u0435\u0434\u0435\u043b\u0430\u0445 \xb15 (\u043f\u044f\u0442\u044c) \u043c\u043c, \u043e\u0431\u0443\u0441\u043b\u043e\u0432\u043b\u0435\u043d\u043d\u044b\u0435 \u0442\u0435\u0445\u043d\u043e\u043b\u043e\u0433\u0438\u0447\u0435\u0441\u043a\u0438\u043c\u0438 \u0434\u043e\u043f\u0443\u0441\u043a\u0430\u043c\u0438 \u043f\u0440\u043e\u0438\u0437\u0432\u043e\u0434\u0441\u0442\u0432\u0430 \u041b\u0414\u0421\u041f \u0438 \u0444\u0430\u043a\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u043c\u0438 \u043d\u0435\u0440\u043e\u0432\u043d\u043e\u0441\u0442\u044f\u043c\u0438 \u0441\u0442\u0435\u043d/\u043f\u043e\u043b\u0430, \u043d\u0435 \u044f\u0432\u043b\u044f\u044e\u0442\u0441\u044f \u043d\u0435\u0434\u043e\u0441\u0442\u0430\u0442\u043a\u043e\u043c \u0438 \u043d\u0435 \u043c\u043e\u0433\u0443\u0442 \u0441\u043b\u0443\u0436\u0438\u0442\u044c \u043e\u0441\u043d\u043e\u0432\u0430\u043d\u0438\u0435\u043c \u0434\u043b\u044f \u043e\u0442\u043a\u0430\u0437\u0430 \u043e\u0442 \u043f\u0440\u0438\u0451\u043c\u043a\u0438 \u0438\u043b\u0438 \u0443\u043c\u0435\u043d\u044c\u0448\u0435\u043d\u0438\u044f \u0446\u0435\u043d\u044b.</p>';
  H += '<p>6.4. \u0412 \u0441\u043b\u0443\u0447\u0430\u0435 \u043d\u0435\u043c\u043e\u0442\u0438\u0432\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u043e\u0433\u043e \u043e\u0442\u043a\u0430\u0437\u0430 \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u0430 \u043e\u0442 \u043f\u043e\u0434\u043f\u0438\u0441\u0430\u043d\u0438\u044f \u0410\u043a\u0442\u0430 \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c \u0432\u043f\u0440\u0430\u0432\u0435 \u0441\u043e\u0441\u0442\u0430\u0432\u0438\u0442\u044c \u043e\u0434\u043d\u043e\u0441\u0442\u043e\u0440\u043e\u043d\u043d\u0438\u0439 \u0410\u043a\u0442. \u0421 \u044d\u0442\u043e\u0433\u043e \u043c\u043e\u043c\u0435\u043d\u0442\u0430 \u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u0441\u0442\u0432\u0430 \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044f \u043f\u043e \u0438\u0437\u0433\u043e\u0442\u043e\u0432\u043b\u0435\u043d\u0438\u044e \u0438 \u043c\u043e\u043d\u0442\u0430\u0436\u0443 \u0441\u0447\u0438\u0442\u0430\u044e\u0442\u0441\u044f \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u043d\u044b\u043c\u0438, \u0430 \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a \u043e\u0431\u044f\u0437\u0430\u043d \u043f\u0440\u043e\u0438\u0437\u0432\u0435\u0441\u0442\u0438 \u043e\u043a\u043e\u043d\u0447\u0430\u0442\u0435\u043b\u044c\u043d\u044b\u0439 \u0440\u0430\u0441\u0447\u0451\u0442 \u0432 \u0442\u0435\u0447\u0435\u043d\u0438\u0435 3 (\u0442\u0440\u0451\u0445) \u043a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u043d\u044b\u0445 \u0434\u043d\u0435\u0439.</p>';

  // РАЗДЕЛ 7
  H += '<hr class="hr"><p class="sec">7. \u0413\u0410\u0420\u0410\u041d\u0422\u0418\u0419\u041d\u042b\u0415 \u041e\u0411\u042f\u0417\u0410\u0422\u0415\u041b\u042c\u0421\u0422\u0412\u0410</p>';
  H += '<p>7.1. \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c \u043f\u0440\u0435\u0434\u043e\u0441\u0442\u0430\u0432\u043b\u044f\u0435\u0442 \u0433\u0430\u0440\u0430\u043d\u0442\u0438\u044e \u043d\u0430 \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u043d\u044b\u0435 \u0440\u0430\u0431\u043e\u0442\u044b \u0441\u0440\u043e\u043a\u043e\u043c 12 (\u0434\u0432\u0435\u043d\u0430\u0434\u0446\u0430\u0442\u044c) \u043c\u0435\u0441\u044f\u0446\u0435\u0432 \u0441 \u0434\u0430\u0442\u044b \u043f\u043e\u0434\u043f\u0438\u0441\u0430\u043d\u0438\u044f \u0410\u043a\u0442\u0430 \u043f\u0440\u0438\u0451\u043c\u0430-\u043f\u0435\u0440\u0435\u0434\u0430\u0447\u0438.</p>';
  H += '<p>7.2. \u0413\u0430\u0440\u0430\u043d\u0442\u0438\u044f \u0440\u0430\u0441\u043f\u0440\u043e\u0441\u0442\u0440\u0430\u043d\u044f\u0435\u0442\u0441\u044f \u043d\u0430 \u043f\u0440\u043e\u0438\u0437\u0432\u043e\u0434\u0441\u0442\u0432\u0435\u043d\u043d\u044b\u0439 \u0431\u0440\u0430\u043a \u0438 \u0434\u0435\u0444\u0435\u043a\u0442\u044b \u043c\u043e\u043d\u0442\u0430\u0436\u0430, \u0432\u043e\u0437\u043d\u0438\u043a\u0448\u0438\u0435 \u043f\u043e \u0432\u0438\u043d\u0435 \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044f.</p>';
  H += '<p>7.3. \u0413\u0430\u0440\u0430\u043d\u0442\u0438\u044f \u043d\u0435 \u0440\u0430\u0441\u043f\u0440\u043e\u0441\u0442\u0440\u0430\u043d\u044f\u0435\u0442\u0441\u044f \u043d\u0430: \u043f\u043e\u0432\u0440\u0435\u0436\u0434\u0435\u043d\u0438\u044f \u043e\u0442 \u043c\u0435\u0445\u0430\u043d\u0438\u0447\u0435\u0441\u043a\u043e\u0433\u043e \u0432\u043e\u0437\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044f, \u043d\u0435\u043d\u0430\u0434\u043b\u0435\u0436\u0430\u0449\u0435\u0439 \u044d\u043a\u0441\u043f\u043b\u0443\u0430\u0442\u0430\u0446\u0438\u0438, \u0432\u043e\u0437\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044f \u0432\u043e\u0434\u044b/\u043f\u0430\u0440\u0430/\u0445\u0438\u043c\u0438\u0438 \u0441\u0432\u0435\u0440\u0445 \u043d\u043e\u0440\u043c\u044b; \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f, \u0432\u043d\u0435\u0441\u0451\u043d\u043d\u044b\u0435 \u0442\u0440\u0435\u0442\u044c\u0438\u043c\u0438 \u043b\u0438\u0446\u0430\u043c\u0438 \u0438\u043b\u0438 \u0441\u0430\u043c\u0438\u043c \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u043e\u043c; \u0435\u0441\u0442\u0435\u0441\u0442\u0432\u0435\u043d\u043d\u044b\u0439 \u0438\u0437\u043d\u043e\u0441 \u0440\u0430\u0441\u0445\u043e\u0434\u043d\u044b\u0445 \u044d\u043b\u0435\u043c\u0435\u043d\u0442\u043e\u0432; \u043f\u043e\u0432\u0440\u0435\u0436\u0434\u0435\u043d\u0438\u044f \u043e\u0442 \u043d\u0435\u0441\u043e\u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0438\u044f \u0443\u0441\u043b\u043e\u0432\u0438\u0439 \u044d\u043a\u0441\u043f\u043b\u0443\u0430\u0442\u0430\u0446\u0438\u0438 \u043d\u043e\u0440\u043c\u0430\u043c (\u0432\u043b\u0430\u0436\u043d\u043e\u0441\u0442\u044c, \u0442\u0435\u043c\u043f\u0435\u0440\u0430\u0442\u0443\u0440\u0430).</p>';
  H += '<p>7.4. \u0414\u043b\u044f \u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u044f \u043f\u043e \u0433\u0430\u0440\u0430\u043d\u0442\u0438\u0438 \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a \u043d\u0430\u043f\u0440\u0430\u0432\u043b\u044f\u0435\u0442 \u043f\u0438\u0441\u044c\u043c\u0435\u043d\u043d\u0443\u044e (\u0432 \u0442.\u0447. \u044d\u043b\u0435\u043a\u0442\u0440\u043e\u043d\u043d\u0443\u044e) \u0437\u0430\u044f\u0432\u043a\u0443 \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044e. \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c \u0440\u0430\u0441\u0441\u043c\u0430\u0442\u0440\u0438\u0432\u0430\u0435\u0442 \u0437\u0430\u044f\u0432\u043a\u0443 \u0438 \u0432\u044b\u0435\u0437\u0436\u0430\u0435\u0442 \u0434\u043b\u044f \u043e\u0441\u043c\u043e\u0442\u0440\u0430 \u0432 \u0442\u0435\u0447\u0435\u043d\u0438\u0435 10 (\u0434\u0435\u0441\u044f\u0442\u0438) \u0440\u0430\u0431\u043e\u0447\u0438\u0445 \u0434\u043d\u0435\u0439.</p>';

  // РАЗДЕЛ 8
  H += '<hr class="hr"><p class="sec">8. \u041e\u0422\u0412\u0415\u0422\u0421\u0422\u0412\u0415\u041d\u041d\u041e\u0421\u0422\u042c \u0421\u0422\u041e\u0420\u041e\u041d</p>';
  H += '<p>8.1. \u0417\u0430 \u043f\u0440\u043e\u0441\u0440\u043e\u0447\u043a\u0443 \u043b\u044e\u0431\u043e\u0433\u043e \u043f\u043b\u0430\u0442\u0435\u0436\u0430 \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u043e\u043c \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c \u0432\u043f\u0440\u0430\u0432\u0435 \u043d\u0430\u0447\u0438\u0441\u043b\u0438\u0442\u044c \u043d\u0435\u0443\u0441\u0442\u043e\u0439\u043a\u0443 \u0432 \u0440\u0430\u0437\u043c\u0435\u0440\u0435 0,1% \u043e\u0442 \u0441\u0443\u043c\u043c\u044b \u043f\u0440\u043e\u0441\u0440\u043e\u0447\u0435\u043d\u043d\u043e\u0433\u043e \u043f\u043b\u0430\u0442\u0435\u0436\u0430 \u0437\u0430 \u043a\u0430\u0436\u0434\u044b\u0439 \u043a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u043d\u044b\u0439 \u0434\u0435\u043d\u044c \u043f\u0440\u043e\u0441\u0440\u043e\u0447\u043a\u0438, \u043d\u043e \u043d\u0435 \u0431\u043e\u043b\u0435\u0435 10% \u043e\u0442 \u043e\u0431\u0449\u0435\u0439 \u0441\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u0438 \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0430.</p>';
  H += '<p>8.2. \u0417\u0430 \u043d\u0430\u0440\u0443\u0448\u0435\u043d\u0438\u0435 \u0441\u043e\u0433\u043b\u0430\u0441\u043e\u0432\u0430\u043d\u043d\u043e\u0433\u043e \u0441\u0440\u043e\u043a\u0430 \u043c\u043e\u043d\u0442\u0430\u0436\u0430 \u043f\u043e \u0432\u0438\u043d\u0435 \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044f \u0431\u043e\u043b\u0435\u0435 \u0447\u0435\u043c \u043d\u0430 14 (\u0447\u0435\u0442\u044b\u0440\u043d\u0430\u0434\u0446\u0430\u0442\u044c) \u0440\u0430\u0431\u043e\u0447\u0438\u0445 \u0434\u043d\u0435\u0439 \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a \u0432\u043f\u0440\u0430\u0432\u0435 \u043f\u043e\u0442\u0440\u0435\u0431\u043e\u0432\u0430\u0442\u044c \u043d\u0435\u0443\u0441\u0442\u043e\u0439\u043a\u0443 \u0432 \u0440\u0430\u0437\u043c\u0435\u0440\u0435 0,1% \u043e\u0442 \u043e\u0431\u0449\u0435\u0439 \u0441\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u0438 \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0430 \u0437\u0430 \u043a\u0430\u0436\u0434\u044b\u0439 \u043a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u043d\u044b\u0439 \u0434\u0435\u043d\u044c \u0441\u0432\u0435\u0440\u0445\u043d\u043e\u0440\u043c\u0430\u0442\u0438\u0432\u043d\u043e\u0439 \u043f\u0440\u043e\u0441\u0440\u043e\u0447\u043a\u0438, \u043d\u043e \u043d\u0435 \u0431\u043e\u043b\u0435\u0435 10% \u043e\u0442 \u043e\u0431\u0449\u0435\u0439 \u0441\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u0438.</p>';
  H += '<p>8.3. \u0421\u0442\u043e\u0440\u043e\u043d\u044b \u043e\u0441\u0432\u043e\u0431\u043e\u0436\u0434\u0430\u044e\u0442\u0441\u044f \u043e\u0442 \u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043d\u043d\u043e\u0441\u0442\u0438 \u043f\u0440\u0438 \u043d\u0430\u0441\u0442\u0443\u043f\u043b\u0435\u043d\u0438\u0438 \u043e\u0431\u0441\u0442\u043e\u044f\u0442\u0435\u043b\u044c\u0441\u0442\u0432 \u043d\u0435\u043f\u0440\u0435\u043e\u0434\u043e\u043b\u0438\u043c\u043e\u0439 \u0441\u0438\u043b\u044b (\u0444\u043e\u0440\u0441-\u043c\u0430\u0436\u043e\u0440): \u0441\u0442\u0438\u0445\u0438\u0439\u043d\u044b\u0435 \u0431\u0435\u0434\u0441\u0442\u0432\u0438\u044f, \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044f \u0433\u043e\u0441\u0443\u0434\u0430\u0440\u0441\u0442\u0432\u0435\u043d\u043d\u044b\u0445 \u043e\u0440\u0433\u0430\u043d\u043e\u0432, \u043a\u0430\u0440\u0430\u043d\u0442\u0438\u043d, \u0438\u043d\u044b\u0435 \u0441\u043e\u0431\u044b\u0442\u0438\u044f \u0432\u043d\u0435 \u0440\u0430\u0437\u0443\u043c\u043d\u043e\u0433\u043e \u043a\u043e\u043d\u0442\u0440\u043e\u043b\u044f \u0421\u0442\u043e\u0440\u043e\u043d. \u041f\u043e\u0441\u0442\u0440\u0430\u0434\u0430\u0432\u0448\u0430\u044f \u0421\u0442\u043e\u0440\u043e\u043d\u0430 \u043e\u0431\u044f\u0437\u0430\u043d\u0430 \u0443\u0432\u0435\u0434\u043e\u043c\u0438\u0442\u044c \u0434\u0440\u0443\u0433\u0443\u044e \u0421\u0442\u043e\u0440\u043e\u043d\u0443 \u0432 \u0442\u0435\u0447\u0435\u043d\u0438\u0435 3 (\u0442\u0440\u0451\u0445) \u0440\u0430\u0431\u043e\u0447\u0438\u0445 \u0434\u043d\u0435\u0439 \u0441 \u043c\u043e\u043c\u0435\u043d\u0442\u0430 \u043d\u0430\u0441\u0442\u0443\u043f\u043b\u0435\u043d\u0438\u044f \u0442\u0430\u043a\u0438\u0445 \u043e\u0431\u0441\u0442\u043e\u044f\u0442\u0435\u043b\u044c\u0441\u0442\u0432.</p>';
  H += '<p>8.4. \u0421\u043e\u0432\u043e\u043a\u0443\u043f\u043d\u0430\u044f \u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043d\u043d\u043e\u0441\u0442\u044c \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044f \u043f\u043e \u043d\u0430\u0441\u0442\u043e\u044f\u0449\u0435\u043c\u0443 \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0443 \u043e\u0433\u0440\u0430\u043d\u0438\u0447\u0435\u043d\u0430 \u043e\u0431\u0449\u0435\u0439 \u0441\u0443\u043c\u043c\u043e\u0439, \u0444\u0430\u043a\u0442\u0438\u0447\u0435\u0441\u043a\u0438 \u0443\u043f\u043b\u0430\u0447\u0435\u043d\u043d\u043e\u0439 \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u043e\u043c \u043f\u043e \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0443.</p>';

  // РАЗДЕЛ 9
  H += '<hr class="hr"><p class="sec">9. \u041a\u041e\u041d\u0424\u0418\u0414\u0415\u041d\u0426\u0418\u0410\u041b\u042c\u041d\u041e\u0421\u0422\u042c \u0418 \u041f\u0415\u0420\u0421\u041e\u041d\u0410\u041b\u042c\u041d\u042b\u0415 \u0414\u0410\u041d\u041d\u042b\u0415</p>';
  H += '<p>9.1. \u0421\u0442\u043e\u0440\u043e\u043d\u044b \u043e\u0431\u044f\u0437\u0443\u044e\u0442\u0441\u044f \u043d\u0435 \u0440\u0430\u0437\u0433\u043b\u0430\u0448\u0430\u0442\u044c \u0443\u0441\u043b\u043e\u0432\u0438\u044f \u043d\u0430\u0441\u0442\u043e\u044f\u0449\u0435\u0433\u043e \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0430 \u0442\u0440\u0435\u0442\u044c\u0438\u043c \u043b\u0438\u0446\u0430\u043c \u0431\u0435\u0437 \u043f\u0438\u0441\u044c\u043c\u0435\u043d\u043d\u043e\u0433\u043e \u0441\u043e\u0433\u043b\u0430\u0441\u0438\u044f \u0434\u0440\u0443\u0433\u043e\u0439 \u0421\u0442\u043e\u0440\u043e\u043d\u044b, \u043a\u0440\u043e\u043c\u0435 \u0441\u043b\u0443\u0447\u0430\u0435\u0432, \u043f\u0440\u044f\u043c\u043e \u043f\u0440\u0435\u0434\u0443\u0441\u043c\u043e\u0442\u0440\u0435\u043d\u043d\u044b\u0445 \u0437\u0430\u043a\u043e\u043d\u043e\u0434\u0430\u0442\u0435\u043b\u044c\u0441\u0442\u0432\u043e\u043c \u0420\u041a.</p>';
  H += '<p>9.2. \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a \u0434\u0430\u0451\u0442 \u0441\u043e\u0433\u043b\u0430\u0441\u0438\u0435 \u043d\u0430 \u043e\u0431\u0440\u0430\u0431\u043e\u0442\u043a\u0443 \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u0435\u043c \u0435\u0433\u043e \u043f\u0435\u0440\u0441\u043e\u043d\u0430\u043b\u044c\u043d\u044b\u0445 \u0434\u0430\u043d\u043d\u044b\u0445 (\u0424.\u0418.\u041e., \u043a\u043e\u043d\u0442\u0430\u043a\u0442\u043d\u044b\u0435 \u0434\u0430\u043d\u043d\u044b\u0435, \u0430\u0434\u0440\u0435\u0441) \u0438\u0441\u043a\u043b\u044e\u0447\u0438\u0442\u0435\u043b\u044c\u043d\u043e \u0434\u043b\u044f \u0446\u0435\u043b\u0435\u0439 \u0438\u0441\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f \u043d\u0430\u0441\u0442\u043e\u044f\u0449\u0435\u0433\u043e \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0430 \u0432 \u0441\u043e\u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0438\u0438 \u0441 \u0417\u0430\u043a\u043e\u043d\u043e\u043c \u0420\u041a \u00ab\u041e \u043f\u0435\u0440\u0441\u043e\u043d\u0430\u043b\u044c\u043d\u044b\u0445 \u0434\u0430\u043d\u043d\u044b\u0445 \u0438 \u0438\u0445 \u0437\u0430\u0449\u0438\u0442\u0435\u00bb \u043e\u0442 21 \u043c\u0430\u044f 2013 \u0433\u043e\u0434\u0430 \u2116 94-V.</p>';

  // РАЗДЕЛ 10
  H += '<hr class="hr"><p class="sec">10. \u0420\u0410\u0417\u0420\u0415\u0428\u0415\u041d\u0418\u0415 \u0421\u041f\u041e\u0420\u041e\u0412</p>';
  H += '<p>10.1. \u0412\u0441\u0435 \u0441\u043f\u043e\u0440\u044b \u0438 \u0440\u0430\u0437\u043d\u043e\u0433\u043b\u0430\u0441\u0438\u044f \u0421\u0442\u043e\u0440\u043e\u043d\u044b \u0441\u0442\u0440\u0435\u043c\u044f\u0442\u0441\u044f \u0443\u0440\u0435\u0433\u0443\u043b\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u043f\u0443\u0442\u0451\u043c \u043f\u0435\u0440\u0435\u0433\u043e\u0432\u043e\u0440\u043e\u0432 \u0432 \u0442\u0435\u0447\u0435\u043d\u0438\u0435 15 (\u043f\u044f\u0442\u043d\u0430\u0434\u0446\u0430\u0442\u0438) \u043a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u043d\u044b\u0445 \u0434\u043d\u0435\u0439 \u0441 \u043c\u043e\u043c\u0435\u043d\u0442\u0430 \u043f\u043e\u043b\u0443\u0447\u0435\u043d\u0438\u044f \u043f\u0438\u0441\u044c\u043c\u0435\u043d\u043d\u043e\u0439 \u043f\u0440\u0435\u0442\u0435\u043d\u0437\u0438\u0438.</p>';
  H += '<p>10.2. \u041f\u0440\u0438 \u043d\u0435\u0434\u043e\u0441\u0442\u0438\u0436\u0435\u043d\u0438\u0438 \u0441\u043e\u0433\u043b\u0430\u0441\u0438\u044f \u0441\u043f\u043e\u0440 \u043f\u0435\u0440\u0435\u0434\u0430\u0451\u0442\u0441\u044f \u043d\u0430 \u0440\u0430\u0441\u0441\u043c\u043e\u0442\u0440\u0435\u043d\u0438\u0435 \u0441\u0443\u0434\u0430 \u043f\u043e \u043c\u0435\u0441\u0442\u0443 \u043d\u0430\u0445\u043e\u0436\u0434\u0435\u043d\u0438\u044f \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044f (\u0433. \u0421\u0430\u0442\u043f\u0430\u0435\u0432) \u0432 \u0441\u043e\u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0438\u0438 \u0441 \u0437\u0430\u043a\u043e\u043d\u043e\u0434\u0430\u0442\u0435\u043b\u044c\u0441\u0442\u0432\u043e\u043c \u0420\u0435\u0441\u043f\u0443\u0431\u043b\u0438\u043a\u0438 \u041a\u0430\u0437\u0430\u0445\u0441\u0442\u0430\u043d.</p>';

  // РАЗДЕЛ 11
  H += '<hr class="hr"><p class="sec">11. \u0417\u0410\u041a\u041b\u042e\u0427\u0418\u0422\u0415\u041b\u042c\u041d\u042b\u0415 \u041f\u041e\u041b\u041e\u0416\u0415\u041d\u0418\u042f</p>';
  H += '<p>11.1. \u0414\u043e\u0433\u043e\u0432\u043e\u0440 \u0432\u0441\u0442\u0443\u043f\u0430\u0435\u0442 \u0432 \u0441\u0438\u043b\u0443 \u0441 \u043c\u043e\u043c\u0435\u043d\u0442\u0430 \u043f\u043e\u0434\u043f\u0438\u0441\u0430\u043d\u0438\u044f \u043e\u0431\u0435\u0438\u043c\u0438 \u0421\u0442\u043e\u0440\u043e\u043d\u0430\u043c\u0438 \u0438 \u0434\u0435\u0439\u0441\u0442\u0432\u0443\u0435\u0442 \u0434\u043e \u043f\u043e\u043b\u043d\u043e\u0433\u043e \u0438\u0441\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f \u0438\u043c\u0438 \u0441\u0432\u043e\u0438\u0445 \u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u0441\u0442\u0432.</p>';
  H += '<p>11.2. \u0412\u0441\u0435 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f \u0438 \u0434\u043e\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f \u043a \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0443 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0442\u0435\u043b\u044c\u043d\u044b \u0442\u043e\u043b\u044c\u043a\u043e \u043f\u0440\u0438 \u0438\u0445 \u043e\u0444\u043e\u0440\u043c\u043b\u0435\u043d\u0438\u0438 \u0432 \u043f\u0438\u0441\u044c\u043c\u0435\u043d\u043d\u043e\u043c \u0432\u0438\u0434\u0435 \u0438 \u043f\u043e\u0434\u043f\u0438\u0441\u0430\u043d\u0438\u0438 \u043e\u0431\u0435\u0438\u043c\u0438 \u0421\u0442\u043e\u0440\u043e\u043d\u0430\u043c\u0438.</p>';
  H += '<p>11.3. \u0414\u043e\u0433\u043e\u0432\u043e\u0440 \u0441\u043e\u0441\u0442\u0430\u0432\u043b\u0435\u043d \u0432 2 (\u0434\u0432\u0443\u0445) \u044d\u043a\u0437\u0435\u043c\u043f\u043b\u044f\u0440\u0430\u0445, \u0438\u043c\u0435\u044e\u0449\u0438\u0445 \u0440\u0430\u0432\u043d\u0443\u044e \u044e\u0440\u0438\u0434\u0438\u0447\u0435\u0441\u043a\u0443\u044e \u0441\u0438\u043b\u0443, \u2014 \u043f\u043e \u043e\u0434\u043d\u043e\u043c\u0443 \u0434\u043b\u044f \u043a\u0430\u0436\u0434\u043e\u0439 \u0438\u0437 \u0421\u0442\u043e\u0440\u043e\u043d.</p>';
  H += '<p>11.4. \u041d\u0430\u0441\u0442\u043e\u044f\u0449\u0438\u0439 \u0414\u043e\u0433\u043e\u0432\u043e\u0440 \u0440\u0435\u0433\u0443\u043b\u0438\u0440\u0443\u0435\u0442\u0441\u044f \u0437\u0430\u043a\u043e\u043d\u043e\u0434\u0430\u0442\u0435\u043b\u044c\u0441\u0442\u0432\u043e\u043c \u0420\u0435\u0441\u043f\u0443\u0431\u043b\u0438\u043a\u0438 \u041a\u0430\u0437\u0430\u0445\u0441\u0442\u0430\u043d, \u0432\u043a\u043b\u044e\u0447\u0430\u044f \u0413\u0440\u0430\u0436\u0434\u0430\u043d\u0441\u043a\u0438\u0439 \u043a\u043e\u0434\u0435\u043a\u0441 \u0420\u041a (\u041e\u0441\u043e\u0431\u0435\u043d\u043d\u0430\u044f \u0447\u0430\u0441\u0442\u044c), \u0417\u0430\u043a\u043e\u043d \u0420\u041a \u00ab\u041e \u0437\u0430\u0449\u0438\u0442\u0435 \u043f\u0440\u0430\u0432 \u043f\u043e\u0442\u0440\u0435\u0431\u0438\u0442\u0435\u043b\u0435\u0439\u00bb \u043e\u0442 4 \u043c\u0430\u044f 2010 \u0433\u043e\u0434\u0430 \u2116\u00a0274-IV, \u0417\u0430\u043a\u043e\u043d \u0420\u041a \u00ab\u041e \u043f\u0435\u0440\u0441\u043e\u043d\u0430\u043b\u044c\u043d\u044b\u0445 \u0434\u0430\u043d\u043d\u044b\u0445 \u0438 \u0438\u0445 \u0437\u0430\u0449\u0438\u0442\u0435\u00bb \u043e\u0442 21 \u043c\u0430\u044f 2013 \u0433\u043e\u0434\u0430 \u2116\u00a094-V.</p>';

  // РАЗДЕЛ 12 — РЕКВИЗИТЫ
  H += '<hr class="hr"><p class="sec">12. \u0420\u0415\u041a\u0412\u0418\u0417\u0418\u0422\u042b \u0418 \u041f\u041e\u0414\u041f\u0418\u0421\u0418 \u0421\u0422\u041e\u0420\u041e\u041d</p>';
  H += '<div class="sw"><div class="sc"><p class="b">\u0418\u0421\u041f\u041e\u041b\u041d\u0418\u0422\u0415\u041b\u042c</p>';
  H += '<p>\u0418\u041f \u00abMebeloff.kz\u00bb<br>\u0420\u0435\u0441\u043f\u0443\u0431\u043b\u0438\u043a\u0430 \u041a\u0430\u0437\u0430\u0445\u0441\u0442\u0430\u043d, \u0433. \u0421\u0430\u0442\u043f\u0430\u0435\u0432,<br>\u043f\u0440. \u0421\u0430\u0442\u043f\u0430\u0435\u0432\u0430 147/1<br>\u0411\u0418\u041d/\u0418\u0418\u041d: 900328351393<br>\u0422\u0435\u043b.: +7\u00a0707\u00a0540\u00a07626</p>';
  H += '<span class="sl">\u041f\u043e\u0434\u043f\u0438\u0441\u044c: __________ / \u041c\u0443\u0448\u0435\u043d\u043e\u0432 \u0422.\u0422.</span>';
  H += '<p style="margin-top:4pt">\u0414\u0430\u0442\u0430: ' + todayRU + '</p></div>';
  H += '<div class="sc"><p class="b">\u0417\u0410\u041a\u0410\u0417\u0427\u0418\u041a</p>';
  H += '<p>\u0424.\u0418.\u041e.: <b>' + client + '</b><br>\u0418\u0418\u041d/\u0411\u0418\u041d: ' + iin + '<br>\u0410\u0434\u0440\u0435\u0441: ' + addr + '<br>\u0422\u0435\u043b.: ' + phone + '</p>';
  H += '<span class="sl">\u041f\u043e\u0434\u043f\u0438\u0441\u044c: __________ / ______________</span>';
  H += '<p style="margin-top:4pt">\u0414\u0430\u0442\u0430: ' + todayRU + '</p></div></div>';

  // ПРИЛОЖЕНИЕ № 1 — АКТ
  H += '<div class="pb"></div>';
  H += '<hr class="hr" style="margin-top:0">';
  H += '<h1 style="margin-top:8pt">\u041f\u0420\u0418\u041b\u041e\u0416\u0415\u041d\u0418\u0415 \u2116\u00a01 \u043a \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0443 \u2116\u00a0' + numVal + '</h1>';
  H += '<h2>\u0410\u041a\u0422 \u041f\u0420\u0418\u0401\u041c\u0410-\u041f\u0415\u0420\u0415\u0414\u0410\u0427\u0418 \u0412\u042b\u041f\u041e\u041b\u041d\u0415\u041d\u041d\u042b\u0425 \u0420\u0410\u0411\u041e\u0422</h2>';
  H += '<p class="c" style="margin-top:5pt">\u0433. \u0421\u0430\u0442\u043f\u0430\u0435\u0432 &nbsp;&nbsp; \u00ab____\u00bb ________________ 20___ \u0433.</p>';
  H += '<p class="ind" style="margin-top:7pt">\u0418\u041f \u00abMebeloff.kz\u00bb (\u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c) \u0438 <b>' + client + '</b> (\u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a) \u0441\u043e\u0441\u0442\u0430\u0432\u0438\u043b\u0438 \u043d\u0430\u0441\u0442\u043e\u044f\u0449\u0438\u0439 \u0410\u043a\u0442 \u043e \u0442\u043e\u043c, \u0447\u0442\u043e \u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c \u0432\u044b\u043f\u043e\u043b\u043d\u0438\u043b, \u0430 \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a \u043f\u0440\u0438\u043d\u044f\u043b \u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0438\u0435 \u0440\u0430\u0431\u043e\u0442\u044b:</p>';
  H += '<table><tbody><tr><td style="width:40%">\u041d\u0430\u0438\u043c\u0435\u043d\u043e\u0432\u0430\u043d\u0438\u0435 \u0418\u0437\u0434\u0435\u043b\u0438\u044f</td><td><b>' + obj + '</b></td></tr>';
  H += '<tr><td>\u041c\u0435\u0441\u0442\u043e \u043c\u043e\u043d\u0442\u0430\u0436\u0430</td><td>' + (addr || '___________________') + '</td></tr>';
  H += '<tr><td>\u0414\u0430\u0442\u0430 \u043c\u043e\u043d\u0442\u0430\u0436\u0430</td><td>\u00ab____\u00bb ________________ 20___ \u0433.</td></tr>';
  H += '<tr><td>\u041e\u0441\u0442\u0430\u0442\u043e\u043a \u043a \u043e\u043f\u043b\u0430\u0442\u0435 \u043f\u043e\u0441\u043b\u0435 \u043c\u043e\u043d\u0442\u0430\u0436\u0430 (10%)</td><td class="b">' + (fullPay ? '\u2014' : rub(p3)) + '</td></tr>';
  H += '<tr><td>\u0418\u0442\u043e\u0433\u043e \u043e\u043f\u043b\u0430\u0447\u0435\u043d\u043e (\u0442\u0435\u043d\u0433\u0435)</td><td>___________________</td></tr></tbody></table>';
  H += '<p>\u0420\u0430\u0431\u043e\u0442\u044b \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u044b \u0432 \u0441\u043e\u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0438\u0438 \u0441 \u0443\u0441\u043b\u043e\u0432\u0438\u044f\u043c\u0438 \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u0430. \u041f\u0440\u0435\u0442\u0435\u043d\u0437\u0438\u0439 \u043f\u043e \u043e\u0431\u044a\u0451\u043c\u0443, \u043a\u0430\u0447\u0435\u0441\u0442\u0432\u0443 \u0438 \u0441\u0440\u043e\u043a\u0430\u043c \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a \u043d\u0435 \u0438\u043c\u0435\u0435\u0442.</p>';
  H += '<p>\u041e\u0441\u043e\u0431\u044b\u0435 \u043e\u0442\u043c\u0435\u0442\u043a\u0438 / \u043f\u0440\u0435\u0442\u0435\u043d\u0437\u0438\u0438 \u0417\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u0430: ___________________________________________</p>';
  H += '<div class="sw" style="margin-top:10pt"><div class="sc"><span class="sl">\u041f\u043e\u0434\u043f\u0438\u0441\u044c: __________________________</span>';
  H += '<p style="margin-top:4pt">\u0414\u0430\u0442\u0430: \u00ab____\u00bb ________________ 20___ \u0433.</p></div>';
  H += '<div class="sc"><span class="sl">\u041f\u043e\u0434\u043f\u0438\u0441\u044c: __________ / ______________</span>';
  H += '<p style="margin-top:4pt">\u0414\u0430\u0442\u0430: \u00ab____\u00bb ________________ 20___ \u0433.</p></div></div>';
  H += '</div></body></html>';

  var w = window.open('','_blank');
  if (w) { w.document.write(H); w.document.close(); }
  else { alert('\u0411\u0440\u0430\u0443\u0437\u0435\u0440 \u0437\u0430\u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0430\u043b \u043e\u043a\u043d\u043e. \u0420\u0430\u0437\u0440\u0435\u0448\u0438\u0442\u0435 \u0432\u0441\u043f\u043b\u044b\u0432\u0430\u044e\u0449\u0438\u0435 \u043e\u043a\u043d\u0430 \u0434\u043b\u044f \u044d\u0442\u043e\u0433\u043e \u0441\u0430\u0439\u0442\u0430.'); }
}


// ── Модальное окно выбора вариантов КП ───────────────────────
function openKpVarModal(){
  if(!C.BL){ alert('Сначала заполните калькулятор'); return; }
  document.getElementById('kp-var-modal').style.display='flex';
}
function kpVarClose(){
  document.getElementById('kp-var-modal').style.display='none';
}
function kpVarCheck(){
  // хотя бы один должен быть выбран
  const l=$('kpv-ldsp').checked, p=$('kpv-plen').checked, k=$('kpv-kr').checked;
  $('kpv-ok-btn').disabled = !l && !p && !k;
  $('kpv-ok-btn').style.opacity = (!l && !p && !k) ? '0.4' : '1';
}
function kpVarConfirm(){
  const showL = $('kpv-ldsp').checked;
  const showP = $('kpv-plen').checked;
  const showK = $('kpv-kr').checked;
  kpVarClose();
  showKP(showL, showP, showK);
}

let kpStyleModern = true; // текущий стиль
function kpToggleStyle(){
  kpStyleModern = !kpStyleModern;
  const pg = document.getElementById('pg-kp');
  const btn = document.getElementById('kp-style-toggle');
  if(pg){ pg.classList.toggle('kp-classic', !kpStyleModern); }
  if(btn){ btn.textContent = kpStyleModern ? '⬡ Modern' : '◈ Classic'; }
}

function showKP(showL=true, showP=true, showK=false){
  var client  = ($("kp-client")  ||{}).value||"—";
  var obj     = ($("kp-object")  ||{}).value||"—";
  var num     = ($("kp-num")     ||{}).value||"001";
  var manager = ($("kp-manager") ||{}).value||"Менеджер";
  var d = new Date();
  var today  = d.toLocaleDateString("ru-RU",{day:"2-digit",month:"2-digit",year:"numeric"});
  var expiry = new Date(d.getTime()+30*86400000).toLocaleDateString("ru-RU",{day:"2-digit",month:"2-digit",year:"numeric"});

  function fm(v){ return v>0 ? Math.round(v).toLocaleString("ru")+" ₸" : "—"; }

  // Активные варианты
  var vars = [];
  if(showL) vars.push({key:"L", name:"ЛДСП"});
  if(showP) vars.push({key:"P", name:"МДФ Плёнка"});
  if(showK) vars.push({key:"K", name:"МДФ Краска"});
  var nV = vars.length;
  var totals = {L: C.BL.tot, P: C.BP.tot, K: C.BK.tot};

  // Собираем строки таблицы
  var tableRows = "";
  var rowNum = 0;

  function addRow(name, desc, qty, priceL, priceP, priceK) {
    rowNum++;
    var numStr = rowNum < 10 ? "0"+rowNum : ""+rowNum;
    var priceCols = "<td style=\"text-align:center;padding:6px 8px;font-size:11px;color:#C9A96E;border-bottom:1px solid #EBEBEB;vertical-align:top\">&#10003;</td>";
    tableRows += "<tr>"
      + "<td style=\"padding:6px 8px;font-size:10px;color:#999;vertical-align:top;border-bottom:1px solid #EBEBEB\">"+numStr+"</td>"
      + "<td style=\"padding:6px 8px;vertical-align:top;border-bottom:1px solid #EBEBEB\">"
        + "<span style=\"font-weight:600;display:block;font-size:11px;color:#1C1C1E\">"+name+"</span>"
        + (desc ? "<span style=\"font-size:10px;color:#888\">"+desc+"</span>" : "")
      + "</td>"
      + "<td style=\"padding:6px 8px;font-size:11px;color:#1C1C1E;vertical-align:top;border-bottom:1px solid #EBEBEB;white-space:nowrap\">"+qty+"</td>"
      + priceCols
    + "</tr>";
  }

  // Корпус
  var ldspArr = C.ldspIt||[];
  if(ldspArr.length>0) addRow("Корпус", ldspArr[0].n, "", 0,0,0);
  // Фасад ЛДСП
  var fldspArr = C.fldspIt||[];
  fldspArr.forEach(function(it){ addRow("Фасад ЛДСП", it.n, "", 0,0,0); });
  // Фасад МДФ плёнка
  var fplenArr = C.fplenIt||[];
  fplenArr.forEach(function(it){ addRow("Фасад МДФ Плёнка", it.n, "", 0,0,0); });
  // Фасад МДФ краска
  var fkrArr = C.fkrIt||[];
  fkrArr.forEach(function(it){ addRow("Фасад МДФ Краска", it.n, "", 0,0,0); });
  // Фурнитура
  var fuArr = (C.fuIt||[]).concat(C.kuIt||[]).concat(C.shIt||[]);
  fuArr.forEach(function(it){
    var nm = it.n.toLowerCase();
    if(nm.indexOf("петл")>=0) addRow("Петли", it.n, "", 0,0,0);
    else if(nm.indexOf("ручк")>=0) addRow("Ручки", it.n, it.q+" шт", 0,0,0);
    else if(nm.indexOf("ножк")>=0||nm.indexOf("нога")>=0) addRow("Ножки", it.n, "", 0,0,0);
    else if(nm.indexOf("штанг")>=0) addRow("Штанга", it.n, "", 0,0,0);
    else addRow(it.n, "", it.q>1?it.q+" шт":"", 0,0,0);
  });
  // Освещение
  var svArr = C.svIt||[];
  svArr.forEach(function(it){ addRow(it.n,"",it.q+" шт",0,0,0); });
  // Доп. позиции
  var dpArr = C.dpIt||[];
  dpArr.forEach(function(it){ addRow(it.n,"",it.q+" шт",0,0,0); });
  // Работы
  var wkArr = C.wkIt||[];
  wkArr.forEach(function(it){ addRow(it.n,"Монтаж / работы","1",it.p||0,it.p||0,it.p||0); });
  // Витрины
  var vitKpArr = C.vitIt||[];
  vitKpArr.forEach(function(it){ addRow(it.n,"\u0414\u043e\u043f. \u043f\u043e\u0437\u0438\u0446\u0438\u044f",it.q+" \u0448\u0442.",0,0,0); });

  // Заголовки колонок цен
  var thPrices = "";
  if(nV > 1) {
    vars.forEach(function(v){
      thPrices += "<th style=\"text-align:right;padding:10px 12px;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#C9A96E;font-weight:600\">"+v.name+"</th>";
    });
  } else {
    thPrices = "<th style=\"text-align:right;padding:10px 12px;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#9A9087;font-weight:500;width:100px\">Цена</th>"
      + "<th style=\"text-align:right;padding:10px 12px;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#9A9087;font-weight:500;width:120px\">Сумма</th>";
  }

  // Заголовки вариантов над итоговыми строками + итоговые строки
  var credits = {L: C.BL.credit, P: C.BP.credit, K: C.BK.credit};
  var showCredit = vars.some(function(v){ return credits[v.key] > totals[v.key] + 1; });
  var varColors = {L: "#534AB7", P: "#1a5252", K: "#8B4513"};
  var headerRow = "";
  var totRow = "";
  var creditRow = "";
  var totCols = nV+2; // № + наименование + кол + варианты
  if(nV > 1) {
    var hdrCells = "";
    var totVarCells = "";
    var creditVarCells = "";
    vars.forEach(function(v){
      hdrCells += "<td style=\"text-align:right;padding:8px 12px 4px;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:"+varColors[v.key]+";font-weight:700;background:#F8F7F5\">"+v.name+"</td>";
      totVarCells += "<td style=\"text-align:right;padding:14px 12px;vertical-align:top;white-space:nowrap\">";
      totVarCells += "<span style=\"font-family:'Times New Roman',Times,serif;font-size:20px;font-weight:700;color:#1C1C1E\">"+fm(totals[v.key])+"</span></td>";
      if(showCredit){
        creditVarCells += "<td style=\"text-align:right;padding:8px 12px;vertical-align:top;white-space:nowrap\">";
        creditVarCells += "<span style=\"font-family:'Times New Roman',Times,serif;font-size:15px;font-weight:500;color:#9A9087\">"+fm(credits[v.key])+"</span></td>";
      }
    });
    headerRow = "<tr style=\"border-top:2px solid #1C1C1E\"><td colspan=\"3\" style=\"padding:8px 12px 4px;background:#F8F7F5\"></td>"+hdrCells+"</tr>";
    totRow = "<tr style=\"background:#F8F7F5\"><td colspan=\"3\" style=\"padding:14px 12px;font-size:14px;font-weight:700;color:#1C1C1E\">\u041a \u043e\u043f\u043b\u0430\u0442\u0435</td>"+totVarCells+"</tr>";
    if(showCredit) creditRow = "<tr style=\"background:#F2F1EE\"><td colspan=\"3\" style=\"padding:8px 12px;font-size:12px;color:#9A9087\">\uD83D\uDCB3 \u0412 \u043a\u0440\u0435\u0434\u0438\u0442</td>"+creditVarCells+"</tr>";
  } else {
    var v1 = vars[0]?vars[0].key:"L";
    headerRow = "<tr style=\"border-top:2px solid #1C1C1E\"><td colspan=\"3\" style=\"padding:8px 12px 4px;background:#F8F7F5\"></td><td colspan=\"2\" style=\"text-align:right;padding:8px 12px 4px;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:"+varColors[v1]+";font-weight:700;background:#F8F7F5\">"+(vars[0]?vars[0].name:"")+"</td></tr>";
    totRow = "<tr style=\"background:#F8F7F5\"><td colspan=\"3\" style=\"padding:14px 12px;font-size:14px;font-weight:700;color:#1C1C1E\">\u041a \u043e\u043f\u043b\u0430\u0442\u0435</td>"
      + "<td colspan=\"2\" style=\"text-align:right;padding:14px 12px;white-space:nowrap\"><span style=\"font-family:'Times New Roman',Times,serif;font-size:24px;font-weight:700;color:#1C1C1E\">"+fm(totals[v1])+"</span></td></tr>";
    if(showCredit) creditRow = "<tr style=\"background:#F2F1EE\"><td colspan=\"3\" style=\"padding:8px 12px;font-size:12px;color:#9A9087\">\uD83D\uDCB3 \u0412 \u043a\u0440\u0435\u0434\u0438\u0442</td>"
      + "<td colspan=\"2\" style=\"text-align:right;padding:8px 12px;white-space:nowrap\"><span style=\"font-family:'Times New Roman',Times,serif;font-size:18px;font-weight:500;color:#9A9087\">"+fm(credits[v1])+"</span></td></tr>";
  }

  // Золотой разделитель
  var rule = "<div style=\"height:2px;background:#C9A96E;margin:0 56px\"></div>";

  // Итоговый HTML
  var kpHtml = "";
  var S = {
    wrap:  "font-family:Inter,Arial,sans-serif;font-size:11px;color:#1C1C1E;background:#fff;max-width:780px;margin:0 auto;line-height:1.4",
    gold:  "color:#C9A96E",
    small: "font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#999;font-weight:600",
    sec:   "font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#C9A96E;margin-bottom:6px"
  };
  kpHtml += "<style>";
  kpHtml += "*{box-sizing:border-box;margin:0;padding:0}ul{list-style:none}";
  kpHtml += "@media print{@page{size:A4;margin:10mm 12mm}.no-print{display:none!important}.kp-wrap{font-size:10px}.kp-hdr{padding:8px 14px!important}.kp-row{padding:6px 14px!important}.kp-spec{padding:4px 14px!important}.kp-cond{padding:6px 14px!important}.kp-foot{padding:6px 14px!important}.kp-band{display:none!important}table td,table th{padding:4px 6px!important;font-size:9.5px!important}}";
  kpHtml += ".kp-hdr,.kp-cond,.kp-foot{page-break-inside:avoid}";
  kpHtml += "</style>";
  kpHtml += "<div class=\"kp-wrap\" style=\""+S.wrap+"\">";

  // ШАПКА
  kpHtml += "<div class=\"kp-hdr\" style=\"display:flex;justify-content:space-between;align-items:flex-end;padding:14px 20px 12px;border-bottom:2px solid #C9A96E\">";
  kpHtml += "<div>";
  kpHtml += "<div style=\"font-size:18px;font-weight:700;letter-spacing:0.5px;color:#1C1C1E\">MEBELOFF<span style=\""+S.gold+"\">.KZ</span></div>";
  kpHtml += "<div style=\""+S.small+";margin-top:3px\">Мебель на заказ &nbsp;&middot;&nbsp; Сатпаев</div>";
  kpHtml += "</div>";
  kpHtml += "<div style=\"text-align:right\">";
  kpHtml += "<div style=\"font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;border:1px solid #C9A96E;color:#C9A96E;padding:3px 10px;display:inline-block;margin-bottom:5px\">Коммерческое предложение</div>";
  kpHtml += "<div style=\"font-size:10px;color:#555;line-height:1.7\">№ <b style=\"color:#1C1C1E\">КП-"+num+"</b> &nbsp;|&nbsp; Дата: <b style=\"color:#1C1C1E\">"+today+"</b> &nbsp;|&nbsp; Действ. до: <b style=\"color:#1C1C1E\">"+expiry+"</b></div>";
  kpHtml += "</div></div>";

  // КЛИЕНТ
  kpHtml += "<div class=\"kp-row\" style=\"padding:8px 20px;border-bottom:1px solid #EBEBEB;display:flex;gap:24px;align-items:flex-start\">";
  kpHtml += "<div><div style=\""+S.small+"\">Клиент</div><div style=\"margin-top:2px;font-size:12px;font-weight:600\">"+client+"</div></div>";
  kpHtml += "<div><div style=\""+S.small+"\">Объект</div><div style=\"margin-top:2px;font-size:12px;font-weight:600\">"+obj+"</div></div>";
  kpHtml += "<div style=\"margin-left:auto;text-align:right\"><div style=\""+S.small+"\">Менеджер &nbsp;/&nbsp; Тел.</div><div style=\"margin-top:2px;font-size:11px\">"+manager+" &nbsp;&middot;&nbsp; +7 707 540 7626</div></div>";
  kpHtml += "</div>";

  // СПЕЦИФИКАЦИЯ
  kpHtml += "<div class=\"kp-spec\" style=\"padding:10px 20px 8px;border-bottom:1px solid #EBEBEB\">";
  kpHtml += "<div style=\""+S.sec+"\">Спецификация &nbsp;<span style=\"color:#999;font-weight:400\">"+rowNum+" позиций</span></div>";
  kpHtml += "<table style=\"width:100%;border-collapse:collapse\">";
  kpHtml += "<thead><tr>";
  kpHtml += "<th style=\"text-align:left;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#777;font-weight:600;padding:7px 8px;border-bottom:1.5px solid #1C1C1E;width:32px\">№</th>";
  kpHtml += "<th style=\"text-align:left;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#777;font-weight:600;padding:7px 8px;border-bottom:1.5px solid #1C1C1E\">Наименование</th>";
  kpHtml += "<th style=\"text-align:left;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#777;font-weight:600;padding:7px 8px;border-bottom:1.5px solid #1C1C1E;width:60px\">Кол.</th>";
  var vcolors = {L:"#534AB7", P:"#1a5252", K:"#8B4513"};
  if (nV > 1) {
    vars.forEach(function(v){
      kpHtml += "<th style=\"text-align:right;font-size:9px;letter-spacing:1.2px;text-transform:uppercase;color:"+vcolors[v.key]+";font-weight:700;padding:7px 8px;border-bottom:1.5px solid #1C1C1E\">"+v.name+"</th>";
    });
  } else {
    kpHtml += "<th style=\"text-align:right;font-size:9px;letter-spacing:1.2px;text-transform:uppercase;color:"+vcolors[vars[0]?vars[0].key:"L"]+";font-weight:700;padding:7px 8px;border-bottom:1.5px solid #1C1C1E\">"+(vars[0]?vars[0].name:"")+"</th>";
  }
  kpHtml += "</tr></thead>";
  kpHtml += "<tbody>"+tableRows+headerRow+totRow+creditRow+"</tbody>";
  kpHtml += "</table></div>";

  // УСЛОВИЯ + ПРИМЕЧАНИЯ
  kpHtml += "<div class=\"kp-cond\" style=\"padding:8px 20px;border-bottom:1px solid #EBEBEB;display:flex;gap:0\">";
  kpHtml += "<div style=\"flex:1;padding-right:16px;border-right:1px solid #EBEBEB\">";
  kpHtml += "<div style=\""+S.sec+"\">Условия</div>";
  kpHtml += "<div style=\"display:flex;gap:20px\">";
  kpHtml += "<div><div style=\""+S.small+"\">Срок</div><div style=\"font-size:11px;font-weight:600;margin-top:2px\">15–45 раб. дн.</div></div>";
  kpHtml += "<div><div style=\""+S.small+"\">Оплата</div><div style=\"font-size:11px;font-weight:600;margin-top:2px\">по договору</div></div>";
  kpHtml += "<div><div style=\""+S.small+"\">Гарантия</div><div style=\"font-size:11px;font-weight:600;margin-top:2px\">12 мес. на фурнитуру</div></div>";
  kpHtml += "</div></div>";
  kpHtml += "<div style=\"flex:1.4;padding-left:16px\">";
  kpHtml += "<div style=\""+S.sec+"\">Примечания</div>";
  kpHtml += "<div style=\"color:#555;font-size:10px;line-height:1.8\">";
  kpHtml += "&middot; КП действительно 7 дней. Стоимость фиксируется при подписании договора.<br>";
  kpHtml += "&middot; Замер и 3D-визуализация &mdash; бесплатно при заключении договора.<br>";
  kpHtml += "&middot; Изменение параметров возможно до подписания спецификации.";
  kpHtml += "</div></div>";
  kpHtml += "</div>";

  // ПОДВАЛ
  kpHtml += "<div class=\"kp-foot\" style=\"padding:8px 20px;background:#F8F6F2;display:flex;justify-content:space-between;align-items:center\">";
  kpHtml += "<div style=\"display:flex;gap:20px;font-size:10px;color:#555\">";
  kpHtml += "<span><span style=\""+S.gold+"\">&#128222;</span> +7 707 540 7626</span>";
  kpHtml += "<span><span style=\""+S.gold+"\">&#128248;</span> @mebeloff.kz</span>";
  kpHtml += "<span><span style=\""+S.gold+"\">&#128205;</span> Абая 68, БЦ каб. 4, Сатпаев</span>";
  kpHtml += "</div>";
  kpHtml += "<div style=\"text-align:right\">";
  kpHtml += "<div style=\""+S.small+";margin-bottom:18px\">Подпись менеджера</div>";
  kpHtml += "<div style=\"width:140px;height:1px;background:#1C1C1E;margin-left:auto;margin-bottom:4px\"></div>";
  kpHtml += "<div style=\"font-size:10px;color:#777\">"+manager+"</div>";
  kpHtml += "</div></div>";

  kpHtml += "</div>";

  $("kp-doc").innerHTML = kpHtml;
  page("kp");
  window.scrollTo(0,0);
}

// ════════════════════════════════════════════════════════════
// MebelOFF AI ПОМОЩНИК
// ════════════════════════════════════════════════════════════

// ── Состояние чата ───────────────────────────────────────────
const aiHistory = []; // {role:'user'|'assistant', content}
let aiLoading = false;

// ── API ключ и режим ─────────────────────────────────────────
let aiMode = 'local'; // 'local' | 'api'

function aiKeyLoad(){
  return localStorage.getItem('moff_ai_key')||'';
}

function aiSetMode(mode){
  aiMode = mode;
  const btnLocal = document.getElementById('ai-btn-local');
  const btnApi   = document.getElementById('ai-btn-api');
  const keyRow   = document.getElementById('ai-key-row');
  const status   = document.getElementById('ai-mode-status');
  const bar      = document.getElementById('ai-key-bar');
  if(btnLocal) btnLocal.className = 'ai-mode-btn' + (mode==='local'?' active-local':'');
  if(btnApi)   btnApi.className   = 'ai-mode-btn' + (mode==='api'?' active-api':'');
  if(keyRow)   keyRow.classList.toggle('show', mode==='api');
  if(bar){ bar.style.background = mode==='api'?'#fffbeb':'#f0fdf4'; bar.style.borderColor = mode==='api'?'#fde68a':'#bbf7d0'; }
  if(status){
    if(mode==='local') status.textContent = 'Авто-режим — работает без ключа';
    else {
      const k = aiKeyLoad();
      status.textContent = k ? 'Claude API: ключ подключён' : 'Введите API ключ ниже';
    }
  }
  // Если переключились на API и нет ключа — показываем поле
  if(mode==='api' && !aiKeyLoad()){
    setTimeout(()=>document.getElementById('ai-key-inp')?.focus(), 100);
  }
}
window.aiSetMode = aiSetMode;
function aiKeySave(){
  const inp = document.getElementById('ai-key-inp');
  const key = (inp?.value||'').trim();
  if(!key){ alert('Введите API ключ'); return; }
  if(!key.startsWith('sk-ant-')){
    alert('Ключ должен начинаться с sk-ant-'); return;
  }
  localStorage.setItem('moff_ai_key', key);
  aiSetMode('api');
  const box = document.getElementById('ai-messages');
  if(box){
    box.innerHTML = '';
    aiRenderMsg('ai', 'API ключ сохранён! Claude API подключён. Опишите задачу.');
  }
}
function aiKeyUpdateUI(key){
  const bar  = document.getElementById('ai-key-bar');
  const inp  = document.getElementById('ai-key-inp');
  const lbl  = document.getElementById('ai-key-lbl');
  const save = document.getElementById('ai-key-save');
  if(!bar) return;
  if(key){
    // Показываем маскированный ключ + кнопку изменить
    bar.innerHTML = `<span id="ai-key-lbl" style="font-size:10px;color:#065f46">OK API ключ подключён</span>
      <button id="ai-key-edit" onclick="aiKeyEdit()">Изменить</button>`;
    bar.style.background='#d1fae5';
    bar.style.borderBottom='1px solid #6ee7b7';
  }
}
function aiKeyEdit(){
  const bar = document.getElementById('ai-key-bar');
  if(!bar) return;
  bar.style.background='#fffbeb';
  bar.style.borderBottom='1px solid #fde68a';
  bar.innerHTML = `<span id="ai-key-lbl" style="font-size:10px;color:#92400e"> API ключ:</span>
    <input id="ai-key-inp" type="password" placeholder="sk-ant-api..." autocomplete="off"
      style="flex:1;font-size:11px;border:1px solid #fcd34d;border-radius:6px;padding:5px 8px;outline:none;background:#fff;font-family:monospace;color:#334155"
      onkeydown="if(event.key==='Enter')aiKeySave()">
    <button onclick="aiKeySave()" style="padding:5px 10px;background:#f59e0b;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer">Сохранить</button>`;
}

// ── Открыть/закрыть drawer ───────────────────────────────────
function aiOpen(){
  document.getElementById('ai-drawer').classList.add('open');
  document.getElementById('ai-drawer-overlay').classList.add('open');
  document.getElementById('ai-input').focus();
  document.getElementById('ai-fab').classList.add('has-ctx');
  // Инициализируем режим
  aiSetMode(aiMode);
}
function aiClose(){
  document.getElementById('ai-drawer').classList.remove('open');
  document.getElementById('ai-drawer-overlay').classList.remove('open');
}

// ── Получить контекст текущей страницы ───────────────────────
function aiGetContext(){
  const activePage = document.querySelector('.pg.on')?.id || 'pg-calc';
  let ctx = '';

  // Текущий расчёт
  if(C && C.BL){
    ctx += `\nТекущий расчёт: ЛДСП ${fm(C.BL.tot)}, МДФ Плёнка ${fm(C.BP.tot)}, МДФ Краска ${fm(C.BK.tot)}.`;
    ctx += `\nКорпус ЛДСП: ${C.ldspIt?.map(x=>x.n+'×'+x.q).join(', ')||'нет'}.`;
    ctx += `\nФурнитура: ${C.fuIt?.map(x=>x.n+'×'+x.q).join(', ')||'нет'}.`;
    ctx += `\nКухня: ${C.kuIt?.map(x=>x.n+'×'+x.q).join(', ')||'нет'}.`;
  }

  // Кухонный конфигуратор
  if(activePage === 'pg-kitchen' && typeof KitchenState !== 'undefined'){
    const lower = KitchenState.lower || [];
    const upper = KitchenState.upper || [];
    ctx += `\nКухня: ${lower.length} нижних (${lower.map(m=>m.width+'мм '+m.type).join(', ')}), ${upper.length} верхних.`;
    ctx += `\nГлубина кухни: ${document.getElementById('k-depth')?.value||501}мм, высота: ${document.getElementById('k-floor-h')?.value||850}мм.`;
  }

  // Шкафный конфигуратор
  if(activePage === 'pg-conf' && typeof sections !== 'undefined' && sections.length){
    ctx += `\nШкаф: ${sections.length} секций. `;
    ctx += sections.map((s,i)=>`Секция ${i+1}: ${s.width}×${s.height}мм, глубина ${s.depth}мм${s.hasRod?', штанга':''}${s.antresol?.enabled?', антресоль '+s.antresol.height+'мм':''}`).join('. ');
  }

  // База материалов
  if(DB && DB.ldsp?.length){
    ctx += `\nДоступные цвета ЛДСП: ${DB.ldsp.map(x=>x.n).join(', ')}.`;
  }
  if(DB && DB.furn?.length){
    const cats = [...new Set(DB.furn.map(x=>x.cat))];
    ctx += `\nКатегории фурнитуры: ${cats.join(', ')}.`;
  }
  if(DB && DB.kuh?.length){
    const kuhCats = [...new Set(DB.kuh.map(x=>x.cat))];
    ctx += `\nКухонные аксессуары: ${kuhCats.join(', ')}.`;
  }

  return ctx;
}

// ── Системный промт ──────────────────────────────────────────
function aiGetSystemPrompt(){
  const ctx = aiGetContext();
  return `Ты ИИ-помощник для мебельной компании MebelOFF (Сатпаев, Казахстан). Помогаешь менеджерам и клиентам быстро заполнять калькулятор мебели на заказ.

ТЕКУЩИЙ КОНТЕКСТ ПРИЛОЖЕНИЯ:${ctx}

СТАНДАРТЫ ПРОИЗВОДСТВА:
- Толщина плиты ЛДСП: 16мм
- Столешница кухни: 38мм
- Ножки: 100мм
- Стандартная глубина кухни: 501мм (внешняя)
- Высота кухонного корпуса: 712мм (100+712+38=850мм)
- Телескопы: 501мм корпус → 400мм направляющие
- Листы ЛДСП: 2750×1830 или 2800×2070мм

КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА ОТВЕТА:
1. Всегда отвечай на русском языке. Будь кратким — 2-4 предложения максимум.
2. ОБЯЗАТЕЛЬНО добавляй <actions> блок если запрос касается кухни, шкафа или настройки мебели.
3. НЕ пиши таблицы, списки планировок или Markdown — только краткий текст + actions.
4. <actions> блок ВСЕГДА в конце ответа, ВСЕГДА валидный JSON массив.

ПРИМЕР — запрос "кухня 3 метра белый фасад мойка":
Настраиваю кухню 3000мм с белым фасадом, мойкой и духовкой.
<actions>
[{"action":"navigateTo","page":"kitchen"},{"action":"clearKitchen"},{"action":"setKitchenGlobal","floorH":850,"depth":501},{"action":"addKitchenLower","width":600,"type":"drawers","facade":"door"},{"action":"addKitchenLower","width":600,"type":"shelves","facade":"door"},{"action":"addKitchenLower","width":600,"type":"sink","facade":"none"},{"action":"addKitchenLower","width":600,"type":"appliance","facade":"none"},{"action":"addKitchenLower","width":600,"type":"shelves","facade":"door"},{"action":"addKitchenUpper","width":600,"height":720,"facade":"door"},{"action":"addKitchenUpper","width":600,"height":720,"facade":"door"},{"action":"addKitchenUpper","width":600,"height":720,"facade":"door"}]
</actions>

ПРИМЕР — запрос "шкаф 2.4м 3 секции штанга":
Настраиваю шкаф-купе 2400мм, 3 секции со штангой.
<actions>
[{"action":"navigateTo","page":"conf"},{"action":"clearWardrobe"},{"action":"addWardobeSection","width":800,"height":2200,"depth":600,"hasRod":true,"shelves":2},{"action":"addWardobeSection","width":800,"height":2200,"depth":600,"hasRod":true,"shelves":2},{"action":"addWardobeSection","width":800,"height":2200,"depth":600,"hasRod":false,"shelves":3}]
</actions>

ДОСТУПНЫЕ ACTIONS:
- {"action":"navigateTo","page":"kitchen|conf|calc"} — перейти на страницу (ВСЕГДА первым)
- {"action":"clearKitchen"} — очистить кухню
- {"action":"clearWardrobe"} — очистить шкаф
- {"action":"setKitchenGlobal","floorH":850,"depth":501} — размеры кухни
- {"action":"addKitchenLower","width":600,"type":"shelves|drawers|sink|appliance","facade":"door|none"}
- {"action":"addKitchenUpper","width":600,"height":720,"facade":"door|none"}
- {"action":"addWardobeSection","width":800,"height":2200,"depth":600,"hasRod":true,"shelves":2}
- {"action":"addLdsp","colorName":"Белый Глянец","qty":3.5}
- {"action":"addFurn","cat":"Петля","qty":8}
- {"action":"setHdfQty","qty":2.5}
- {"action":"setKromQty","qty":45}
- {"action":"explain"} — только для вопросов о цене/экономии

ПРАВИЛА КУХНИ: ширина модулей кратна 100мм (400-900мм), sink и appliance всегда facade:"none".
ПРАВИЛА ШКАФА: ширина секции 600-1200мм, hasRod:true = штанга.
НЕ придумывай цены. Вопросы не о мебели — вежливо отклони.`;
}

// ── Отрисовка сообщений ──────────────────────────────────────
function aiRenderMsg(role, text, extra){
  const box = document.getElementById('ai-messages');
  const div = document.createElement('div');
  div.className = 'ai-msg ' + (role==='user'?'user':'ai') + (extra||'');
  // Форматирование: **bold**, `code`
  div.innerHTML = text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g,'<b>$1</b>')
    .replace(/`(.+?)`/g,'<code>$1</code>')
    .replace(/\n/g,'<br>');
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}

// ── Выполнение команд из ответа ─────────────────────────────
function aiExecuteActions(actionsJson){
  let applied = 0;
  let needKitchenRender = false;
  let needConfRender = false;
  let navigatePage = null;

  actionsJson.forEach(act => {
    try {
      switch(act.action){

        case 'clearKitchen':
          if(typeof KitchenState!=='undefined'){
            KitchenState.lower=[]; KitchenState.upper=[];
            KitchenState.lId=0; KitchenState.uId=0;
            needKitchenRender=true; applied++;
          }
          break;

        case 'setKitchenGlobal':{
          if(act.floorH){ const e=document.getElementById('k-floor-h'); if(e) e.value=act.floorH; }
          if(act.depth){ const e=document.getElementById('k-depth'); if(e) e.value=act.depth; }
          needKitchenRender=true; applied++;
          break;
        }

        case 'addKitchenLower':
          if(typeof KitchenState!=='undefined' && typeof kMkLower==='function'){
            const m=kMkLower(act.width||600);
            m.type=act.type||'shelves';
            m.facade=act.facade||'door';
            if(m.type==='sink'||m.type==='appliance') m.facade='none';
            KitchenState.lower.push(m);
            needKitchenRender=true; applied++;
          }
          break;

        case 'addKitchenUpper':
          if(typeof KitchenState!=='undefined' && typeof kMkUpper==='function'){
            const m=kMkUpper(act.width||600);
            m.height=act.height||720;
            m.facade=act.facade||'door';
            KitchenState.upper.push(m);
            needKitchenRender=true; applied++;
          }
          break;

        case 'clearWardrobe':{
          // Используем сеттер: sections=[] в module через defineProperty
          window._ai_sections = [];
          needConfRender=true; applied++;
          break;
        }
        case 'addWardobeSection':{
          const mkS = window._ai_mkSection;
          if(mkS){
            const s = mkS();
            s.width  = act.width  || 800;
            s.height = act.height || 2200;
            s.depth  = act.depth  || 600;
            s.hasRod = act.hasRod || false;
            if(act.shelves){
              const step = Math.round(s.height / (act.shelves + 1));
              s.shelves = Array.from({length: act.shelves}, (_, i) => ({id: s.shelfId++, height: step*(i+1)}));
            }
            window._ai_sections.push(s); // геттер даёт актуальный sections[]
            needConfRender = true; applied++;
          }
          break;
        }

        case 'addLdsp':{
          if(!DB.ldsp?.length) break;
          const idx=DB.ldsp.findIndex(x=>x.n.toLowerCase().includes((act.colorName||'').toLowerCase()));
          const di=idx>=0?idx:0;
          const i=ST.ldsp.length; ST.ldsp.push(di);
          const c=$('ldsp-list'); if(!c) break;
          if(i===0) c.innerHTML='';
          const d=document.createElement('div');
          d.id='lr'+i; if(i>0) d.className='ib'; d.style.marginTop='8px';
          const o=DB.ldsp.map((x,j)=>`<option value="${j}"${j===di?' selected':''}>${x.n} — ${x.p.toLocaleString('ru')}₸</option>`).join('');
          d.innerHTML=`<div class="fr"><select id="ls${i}" onchange="ST.ldsp[${i}]=+this.value;recalc()">${o}</select><button class="db" onclick="$('lr${i}').style.display='none';ST.ldsp[${i}]=null;recalc()">✕</button></div><div class="fr"><span class="lb">Кол-во</span><input class="qi" type="number" inputmode="decimal" id="lq${i}" value="${act.qty||1}" min="0" step="0.01" onchange="recalc()"><span class="fp">${DB.ldsp[di].p.toLocaleString('ru')}₸/л</span></div>`;
          c.appendChild(d); const cb=$('cb-korp'); if(cb&&!cb.classList.contains('op')) tog('korp');
          applied++; break;
        }

        case 'addFurn':
          if(typeof kAddFurnRow==='function' && act.cat){
            kAddFurnRow(act.cat, act.qty||1); applied++;
          }
          break;

        case 'setHdfQty':{
          const e=$('hdf-qty'); if(e){e.value=act.qty||0; applied++;}
          break;
        }
        case 'setKromQty':{
          const e=$('krom-qty'); if(e){e.value=act.qty||0; applied++;}
          break;
        }

        case 'navigateTo':
          navigatePage=act.page; break;
      }
    } catch(err){ console.warn('AI action error:', act.action, err); }
  });

  // Применяем рендеры
  if(needKitchenRender && typeof kRenderPanel==='function'){
    kRenderPanel();
    if(typeof kFillTopSelect==='function') kFillTopSelect();
    if(typeof kRender==='function') setTimeout(()=>kRender(), 50);
  }
  if(needConfRender){
    const doConfRender = () => {
      if(typeof window._ai_renderPanel==='function') window._ai_renderPanel();
      if(typeof window._ai_updateStats==='function') window._ai_updateStats();
      if(typeof window._ai_render3D==='function')    window._ai_render3D();
    };
    if(navigatePage==='conf'){
      page('conf'); // initConf внутри
      setTimeout(doConfRender, 200); // ждём init Three.js
      navigatePage = null;
    } else if(document.getElementById('pg-conf')?.classList.contains('on')){
      setTimeout(doConfRender, 50);
    } else {
      doConfRender();
    }
  }
  if(applied>0) recalc();
  if(navigatePage) { page(navigatePage); }

  return applied;
}

// ── Парсинг actions из ответа ────────────────────────────────
function aiParseActions(text){
  const m = text.match(/<actions>([\s\S]*?)<\/actions>/);
  if(!m) return null;
  try { return JSON.parse(m[1].trim()); }
  catch(e){ return null; }
}

// ── Очистить actions из текста ───────────────────────────────
function aiCleanText(text){
  return text.replace(/<actions>[\s\S]*?<\/actions>/g,'').trim();
}

// ── Локальный rule-based парсер (без API) ────────────────────
function aiLocalProcess(text){
  const t = text.toLowerCase();
  const actions = [];
  let reply = '';

  // Числа из текста
  function extractNum(str, patterns){
    for(const p of patterns){
      const m = str.match(p);
      if(m) return parseFloat(m[1].replace(',','.'));
    }
    return null;
  }

  // Размер в метрах или мм
  function extractSize(str){
    const mM = str.match(/(\d+[\.,]?\d*)\s*м/);
    if(mM) return Math.round(parseFloat(mM[1].replace(',','.'))*1000);
    const mm = str.match(/(\d{3,4})\s*мм/);
    if(mm) return parseInt(mm[1]);
    const bare = str.match(/(\d+[\.,]\d+)/);
    if(bare){ const v=parseFloat(bare[1].replace(',','.')); return v<10?Math.round(v*1000):Math.round(v); }
    return null;
  }

  // Кол-во секций/модулей
  function extractCount(str){
    const m = str.match(/(\d+)\s*(секц|модул|шкаф|штук|шт)/);
    if(m) return parseInt(m[1]);
    const words = {'один':1,'одну':1,'одна':1,'два':2,'две':2,'три':3,'четыре':4,'пять':5,'шесть':6};
    for(const [w,n] of Object.entries(words)) if(str.includes(w)) return n;
    return null;
  }

  // ── КУХНЯ ────────────────────────────────────────────────────
  if(t.includes('кухн') || t.includes('кухон')){
    actions.push({action:'navigateTo', page:'kitchen'});
    actions.push({action:'clearKitchen'});

    const totalW = extractSize(t) || 3000;
    const depth = t.includes('501') ? 501 : t.includes('600') ? 600 : 501;
    const floorH = t.includes('900') ? 900 : t.includes('950') ? 950 : 850;
    actions.push({action:'setKitchenGlobal', floorH, depth});

    // Разбиваем на модули
    const hasSink    = t.includes('мойк');
    const hasAppl    = t.includes('духовк') || t.includes('печ') || t.includes('техник') || t.includes('холодил');
    const hasDrawers = t.includes('ящик');

    // Стандартные ширины модулей
    const sinkW  = 600, applW = 600;
    let remaining = totalW;
    let modules = [];

    if(hasSink){
      modules.push({type:'sink', w:sinkW});
      remaining -= sinkW;
    }
    if(hasAppl){
      modules.push({type:'appliance', w:applW});
      remaining -= applW;
    }

    // Остаток делим на модули по 600мм
    const nReg = Math.max(1, Math.round(remaining / 600));
    const regW  = Math.round(remaining / nReg / 100) * 100;
    for(let i=0; i<nReg; i++){
      modules.push({type: hasDrawers ? 'drawers' : 'shelves', w: regW});
    }

    // Позиция мойки/техники
    const sinkRight  = t.includes('мойка справ') || t.includes('справа мойк');
    const applRight  = t.includes('духовк справ') || t.includes('справа духовк');
    const sinkLeft   = t.includes('мойка слев') || t.includes('слева мойк');
    const sinkCenter = t.includes('мойка в центр') || t.includes('по центру') || t.includes('в центр');

    // Пересортируем по позиции
    const sinkMod  = modules.find(m=>m.type==='sink');
    const applMod  = modules.find(m=>m.type==='appliance');
    const regMods  = modules.filter(m=>m.type!=='sink'&&m.type!=='appliance');
    const half     = Math.floor(regMods.length/2);

    let ordered = [];
    if(sinkCenter && sinkMod){
      ordered = [...regMods.slice(0,half), sinkMod, ...(applMod?[applMod]:[]), ...regMods.slice(half)];
    } else if(sinkRight && sinkMod){
      ordered = [...regMods, ...(applMod?[applMod]:[]), sinkMod];
    } else if(sinkLeft && sinkMod){
      ordered = [sinkMod, ...(applMod?[applMod]:[]), ...regMods];
    } else {
      ordered = modules;
    }

    ordered.forEach(m => actions.push({action:'addKitchenLower', width:m.w, type:m.type, facade: m.type==='sink'||m.type==='appliance' ? 'none' : 'door'}));

    // Верхние шкафы — половина нижних
    const upperCount = Math.max(1, Math.floor(ordered.length * 0.6));
    const upperW = Math.round(totalW / upperCount / 100) * 100;
    for(let i=0; i<upperCount; i++) actions.push({action:'addKitchenUpper', width:upperW, height:720, facade:'door'});

    // Цвет фасада
    const colorMap = {
      'бел':'Белый', 'глянц':'Белый Глянец', 'сонома':'Сонома', 'вотан':'Вотан',
      'сер':'Серый Светлый', 'черн':'Черный', 'зелен':'Зеленый темный',
      'крем':'Слоновая кость', 'беж':'Бежевый'
    };
    let colorName = '';
    for(const [k,v] of Object.entries(colorMap)){ if(t.includes(k)){ colorName=v; break; } }
    if(colorName) actions.push({action:'addLdsp', colorName, qty:0});

    const nLower = ordered.length;
    reply = 'Кухня настроена: ' + nLower + ' нижних модулей (' +
      ordered.map(m=>m.w+'мм '+m.type).join(', ') + '), ' +
      upperCount + ' верхних. Общая ширина ~' + totalW + 'мм.';
    if(colorName) reply += ' Цвет: ' + colorName + '.';
    reply += '\n\nПроверьте в 3D и при необходимости скорректируйте.';
  }

  // ── ШКАФ-КУПЕ ────────────────────────────────────────────────
  else if(t.includes('шкаф') || t.includes('купе') || t.includes('гардероб') || t.includes('секц')){
    actions.push({action:'navigateTo', page:'conf'});
    actions.push({action:'clearWardrobe'});

    const totalW  = extractSize(t) || 2400;
    const height  = extractNum(t, [/высот[аы]\s*(\d+)/,/(\d{4})\s*мм\s*высот/]) || 2200;
    const depth   = extractNum(t, [/глубин[аы]\s*(\d+)/,/(\d{3})\s*мм\s*глубин/]) || 600;
    const nSec    = extractCount(t) || Math.max(2, Math.round(totalW/800));
    const hasRod  = t.includes('штанг') || t.includes('плать') || t.includes('вешал');
    const nShelves= extractNum(t,[/(\d+)\s*пол/]) || (hasRod ? 2 : 3);

    const secW = Math.round(totalW / nSec / 10) * 10;
    for(let i=0; i<nSec; i++){
      actions.push({action:'addWardobeSection', width:secW, height:Math.round(height), depth:Math.round(depth), hasRod, shelves:Math.round(nShelves)});
    }

    reply = 'Шкаф настроен: ' + nSec + ' секций по ' + secW + 'мм, высота ' + height + 'мм' +
      (hasRod ? ', со штангой' : '') + ', ' + nShelves + ' полки в секции.' +
      '\n\nОбщая ширина: ' + totalW + 'мм. Проверьте в 3D.';
  }

  // ── ЦЕНА / РАСЧЁТ ────────────────────────────────────────────
  else if(t.includes('цен') || t.includes('стоим') || t.includes('почему') || t.includes('дорог') || t.includes('сколько')){
    if(C && C.BL && C.BL.tot > 0){
      const base  = Math.round(C.vK + C.vFu + C.vKu);
      const koef  = Math.round(C.BL.aK - C.BL.base);
      const extra = Math.round(C.BL.tot - C.BL.aK);
      reply = 'Расчёт стоимости (ЛДСП вариант):\n\n' +
        '**Материалы и фурнитура:** ' + base.toLocaleString('ru') + ' ₸\n' +
        '**Наценка (коэф.):** +' + koef.toLocaleString('ru') + ' ₸\n' +
        (extra > 0 ? '**Доп. услуги:** +' + extra.toLocaleString('ru') + ' ₸\n' : '') +
        '**Итого клиенту:** ' + C.BL.tot.toLocaleString('ru') + ' ₸\n' +
        '**В рассрочку:** ' + C.BL.credit.toLocaleString('ru') + ' ₸\n\n' +
        'МДФ Плёнка: ' + C.BP.tot.toLocaleString('ru') + ' ₸' +
        (C.BK.tot > 0 ? '\nМДФ Краска: ' + C.BK.tot.toLocaleString('ru') + ' ₸' : '');
    } else {
      reply = 'Расчёт пустой. Сначала добавьте материалы в калькулятор или настройте кухню/шкаф.';
    }
    actions.push({action:'explain'});
  }

  // ── СЭКОНОМИТЬ ───────────────────────────────────────────────
  else if(t.includes('сэконом') || t.includes('дешевл') || t.includes('снизит') || t.includes('уменьш')){
    reply = 'Способы снизить стоимость:\n\n' +
      '**1. ЛДСП вместо МДФ** — разница обычно 15-25%\n' +
      '**2. Меньше фасадов** — открытые полки вместо дверей\n' +
      '**3. Стандартные размеры** — 600мм модули оптимальны\n' +
      '**4. Без антресоли** — упрощает конструкцию\n' +
      '**5. Цокольные ящики вместо выдвижных** — дешевле на 30%\n\n' +
      'Хотите пересчитать с другими параметрами?';
    actions.push({action:'explain'});
  }

  // ── ПОМОЩЬ ───────────────────────────────────────────────────
  else {
    reply = 'Я понимаю запросы вида:\n\n' +
      '- "Кухня 3 метра, белый глянец, мойка и духовка"\n' +
      '- "Шкаф-купе 2.4м, 3 секции, штанга"\n' +
      '- "Почему такая цена?"\n' +
      '- "Как сэкономить?"\n\n' +
      'Или введите API ключ (console.anthropic.com) для полноценного ИИ.';
    actions.push({action:'explain'});
  }

  return {reply, actions};
}

// ── Отправить сообщение ──────────────────────────────────────
async function aiSend(){
  if(aiLoading) return;
  const input = document.getElementById('ai-input');
  const text  = (input.value||'').trim();
  if(!text) return;

  input.value='';
  input.style.height='36px';
  aiRenderMsg('user', text);
  aiHistory.push({role:'user', content:text});

  aiLoading=true;
  document.getElementById('ai-send-btn').disabled=true;

  const thinkDiv = aiRenderMsg('ai', '...', ' thinking');

  try {
    const apiKey = aiKeyLoad();

    if(aiMode === 'api' && apiKey){
      // ── Режим Claude API ──────────────────────────────────────
      const messages = [...aiHistory.slice(-8)];
      // Используем Cloudflare Worker прокси (решает CORS)
      const resp = await fetch('https://divine-union-9ecd.ashikbaevdali.workers.dev', {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json'
          // Ключ хранится в Cloudflare Variables, не передаём его
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          system: aiGetSystemPrompt(),
          messages: messages
        })
      });

      if(!resp.ok){
        const err = await resp.json().catch(()=>({}));
        if(resp.status===401||resp.status===403){
          aiKeyEdit();
          throw new Error('Неверный API ключ. Проверьте ключ выше.');
        }
        throw new Error(err?.error?.message || ('HTTP ' + resp.status));
      }

      const data = await resp.json();
      const rawText = data.content?.map(c=>c.text||'').join('') || '(нет ответа)';
      thinkDiv.remove();
      const actions  = aiParseActions(rawText);
      const cleanTxt = aiCleanText(rawText);
      const msgDiv   = aiRenderMsg('ai', cleanTxt||'Готово!');
      if(actions && actions.length){
        const n = aiExecuteActions(actions);
        if(n>0){
          const badge = document.createElement('div');
          badge.className='ai-applied-badge';
          badge.textContent = 'OK Применено ' + n + ' изменений';
          msgDiv.appendChild(badge);
        }
      }
      aiHistory.push({role:'assistant', content:rawText});

    } else {
      // ── Локальный режим (без API) ─────────────────────────────
      await new Promise(r=>setTimeout(r, 400)); // имитация задержки
      thinkDiv.remove();
      const result = aiLocalProcess(text);
      const msgDiv = aiRenderMsg('ai', result.reply);
      const realActions = result.actions.filter(a=>a.action!=='explain');
      if(realActions.length){
        const n = aiExecuteActions(realActions);
        if(n>0){
          const badge = document.createElement('div');
          badge.className='ai-applied-badge';
          badge.textContent = 'OK Применено ' + n + ' изменений';
          msgDiv.appendChild(badge);
        }
      }
      aiHistory.push({role:'assistant', content:result.reply});
    }

  } catch(err){
    thinkDiv.remove();
    var errMsg = err.message || String(err);
    if(errMsg.includes('fetch') || errMsg.includes('CORS') || errMsg.includes('Failed') || errMsg.includes('NetworkError')){
      // CORS или сетевая ошибка — переключаем на локальный режим
      aiSetMode('local');
      aiRenderMsg('ai', 'Claude API недоступен с GitHub Pages (CORS). Переключился на Авто-режим — повторите запрос.', ' error');
    } else {
      aiRenderMsg('ai', 'Ошибка: ' + errMsg, ' error');
    }
  }

  aiLoading=false;
  document.getElementById('ai-send-btn').disabled=false;
  document.getElementById('ai-input').focus();
}

function aiSendChip(text){
  document.getElementById('ai-input').value = text;
  aiSend();
}

function fullReset(){
  Object.keys(ST).forEach(k=>ST[k]=[]);
  ["ldsp-list","fldsp-list","fplen-list","fkr-list","furn-list","kuh-list","shk-list","svet-list","dop-list","vit-list"].forEach(id=>{const e=$(id);if(e)e.innerHTML='<p class="hint">Нет позиций</p>';});
  ["hdf-qty","krom-qty","d-sat","d-pdm","svet-inc","c-sl","c-sp","c-sk"].forEach(id=>{const e=$(id);if(e)e.value="0";});
  document.querySelectorAll("[id^=wq]").forEach(e=>e.value="");
  recalc();tab("calc");
}

// ===== МОСТ: 3D Конфигуратор → Калькулятор =====
let confInitialized = false;

function initConf() {
  // Активируем стили конфигуратора
  const styleEl = document.getElementById('conf-styles');
  if (styleEl) styleEl.removeAttribute('style');
  
  // Three.js нужно инициализировать только один раз
  if (!confInitialized) {
    confInitialized = true;
    // Запустим init конфигуратора после небольшой задержки
    setTimeout(() => {
      if (typeof window._confInit === 'function') window._confInit();
    }, 100);
  }
  // Перерисуем 3D если уже инициализирован
  if (typeof window.render3D === 'function') {
    setTimeout(() => window.render3D(), 50);
  }
}

function sendConfToCalc() {
  if (typeof window.calcAllCosts === 'undefined') {
    alert('Сначала перейдите во вкладку 3D и дождитесь загрузки'); return;
  }
  const d = window.calcAllCosts();
  const mc = window._getMatChoice ? window._getMatChoice() : {};


  const ldspEquiv    = Math.round((d.ldspEquiv    || 0) * 100) / 100;
  const hdfEquiv     = Math.round((d.hdfEquiv     || 0) * 100) / 100;
  const facLdspEquiv = Math.round((d.facLdspEquiv || 0) * 100) / 100;

  // Сбрасываем калькулятор
  Object.keys(ST).forEach(k => ST[k] = []);
  ['ldsp-list','fldsp-list','fplen-list','fkr-list','furn-list','kuh-list','shk-list','svet-list','dop-list','vit-list']
    .forEach(id => { const e = $(id); if(e) e.innerHTML = '<p class="hint">Нет позиций</p>'; });
  ['hdf-qty','krom-qty','d-sat','d-pdm','svet-inc','c-sl','c-sp','c-sk'].forEach(id => {
    const e = $(id); if(e) e.value = '0';
  });

  let imported = 0;

  // ── Хелпер: добавить строку в shk-list (Фурнитура шкаф) ───
  function addSHKRow(catName, qty) {
    if (!qty || qty <= 0) return;
    const arr = DB.furn;
    const idx = arr.findIndex(x => x.cat === catName);
    if (idx < 0) return;
    const si = ST.shk.length;
    ST.shk.push({ p: arr[idx].p });
    const sc = $('shk-list');
    if (!sc) return;
    if (si === 0) sc.innerHTML = '';
    const cats = [...new Set(arr.map(x => x.cat))];
    const fd = document.createElement('div');
    fd.id = 'shkr' + si;
    if (si > 0) fd.className = 'ib';
    fd.style.marginTop = '8px';
    fd.innerHTML = `<div class="fr">
      <select id="shkc${si}" onchange="uC('shk',${si})">${cats.map(c=>`<option value="${c}"${c===catName?' selected':''}>${c}</option>`).join('')}</select>
      <button class="db" onclick="$('shkr${si}').style.display='none';ST.shk[${si}]=null;recalc()">✕</button>
    </div>
    <div class="fr" id="shkvf${si}"></div>
    <div class="fr">
      <span class="lb">Кол-во</span>
      <input class="qi" type="number" inputmode="decimal" id="shkq${si}" placeholder="0" min="0" onchange="recalc()">
      <span class="fp" id="shkpp${si}">${arr[idx].p.toLocaleString('ru')}₸</span>
    </div>`;
    sc.appendChild(fd);
    uC('shk', si);
    const qEl = $('shkq' + si);
    if (qEl) qEl.value = qty;
    const cb = $('cb-shk');
    if (cb && !cb.classList.contains('op')) tog('shk');
    imported++;
  }

  // ── Хелпер: добавить строку фурнитуры в furn-list ──────────
  function addFurnRow(catName, qty) {
    if (!qty || qty <= 0) return;
    const arr = DB.furn;
    const idx = arr.findIndex(x => x.cat === catName);
    if (idx < 0) return; // нет такой категории в БД
    const fi = ST.furn.length;
    ST.furn.push({ p: arr[idx].p });
    const fc = $('furn-list');
    if (!fc) return;
    if (fi === 0) fc.innerHTML = '';
    const cats = [...new Set(arr.map(x => x.cat))];
    const fd = document.createElement('div');
    fd.id = 'furnr' + fi;
    if (fi > 0) fd.className = 'ib';
    fd.style.marginTop = '8px';
    fd.innerHTML = `<div class="fr">
      <select id="furnc${fi}" onchange="uC('furn',${fi})">${cats.map(c=>`<option value="${c}"${c===catName?' selected':''}>${c}</option>`).join('')}</select>
      <button class="db" onclick="$('furnr${fi}').style.display='none';ST.furn[${fi}]=null;recalc()">✕</button>
    </div>
    <div class="fr" id="furnvf${fi}"></div>
    <div class="fr">
      <span class="lb">Кол-во</span>
      <input class="qi" type="number" inputmode="decimal" id="furnq${fi}" placeholder="0" min="0" onchange="recalc()">
      <span class="fp" id="furnpp${fi}">${arr[idx].p.toLocaleString('ru')}₸</span>
    </div>`;
    fc.appendChild(fd);
    uC('furn', fi);
    const aQEl = $('furnq'+fi);
    if(aQEl) aQEl.value = qty;
    const aCb = $('cb-furn');
    if(aCb && !aCb.classList.contains('op')) tog('furn');
    imported++;
  }

  // ── ЛДСП корпус ────────────────────────────────────────────
  if (ldspEquiv > 0) {
    const ldspName = mc.ldspName || '';
    let ldspIdx = 0;
    if (ldspName) {
      const f = DB.ldsp.findIndex(x => x.n.toLowerCase().includes(ldspName.toLowerCase()) || ldspName.toLowerCase().includes(x.n.toLowerCase()));
      if (f >= 0) ldspIdx = f;
    }
    const i = ST.ldsp.length;
    ST.ldsp.push(ldspIdx);
    const c = $('ldsp-list');
    if (c) {
      if (i === 0) c.innerHTML = '';
      const d2 = document.createElement('div');
      d2.id = 'lr' + i; if (i > 0) d2.className = 'ib'; d2.style.marginTop = '8px';
      const o = DB.ldsp.map((x,j) => `<option value="${j}"${j===ldspIdx?' selected':''}>${x.n} — ${x.p.toLocaleString('ru')}₸</option>`).join('');
      d2.innerHTML = `<div class="fr"><select id="ls${i}" onchange="ST.ldsp[${i}]=+this.value;$('lp${i}').textContent=DB.ldsp[+this.value].p.toLocaleString('ru')+'₸/л';recalc()">${o}</select><button class="db" onclick="$('lr${i}').style.display='none';ST.ldsp[${i}]=null;recalc()">✕</button></div><div class="fr"><span class="lb">Кол-во</span><input class="qi" type="number" inputmode="decimal" id="lq${i}" placeholder="0" min="0" step="0.01" onchange="recalc()"><span class="fp" id="lp${i}">${DB.ldsp[ldspIdx].p.toLocaleString('ru')}₸/л</span></div>`;
      c.appendChild(d2);
      $('lq' + i).value = ldspEquiv;
      imported++;
    }
  }

  // ── ЛДСП фасад ─────────────────────────────────────────────
  if (facLdspEquiv > 0) {
    const ldspName = mc.ldspName || '';
    let ldspIdx = 0;
    if (ldspName) {
      const f = DB.ldsp.findIndex(x => x.n.toLowerCase().includes(ldspName.toLowerCase()) || ldspName.toLowerCase().includes(x.n.toLowerCase()));
      if (f >= 0) ldspIdx = f;
    }
    const sec = 'fldsp';
    const i = ST.fldsp.length; ST.fldsp.push(ldspIdx);
    const c = $('fldsp-list');
    if (c) {
      if (i === 0) c.innerHTML = '';
      const d2 = document.createElement('div');
      d2.id = sec+'r'+i; if(i>0) d2.className='ib'; d2.style.marginTop='8px';
      const o = DB.ldsp.map((x,j)=>`<option value="${j}"${j===ldspIdx?' selected':''}>${x.n} — ${x.p.toLocaleString('ru')}₸</option>`).join('');
      d2.innerHTML = `<div class="fr"><select id="${sec}s${i}" onchange="ST['${sec}'][${i}]=+this.value;$('${sec}p${i}').textContent=DB.ldsp[+this.value].p.toLocaleString('ru')+'₸/л';recalc()">${o}</select><button class="db" onclick="$('${sec}r${i}').style.display='none';ST['${sec}'][${i}]=null;recalc()">✕</button></div><div class="fr"><span class="lb">Кол-во</span><input class="qi" type="number" inputmode="decimal" id="${sec}q${i}" placeholder="0" min="0" step="0.01" onchange="recalc()"><span class="fp" id="${sec}p${i}">${DB.ldsp[ldspIdx].p.toLocaleString('ru')}₸/л</span></div>`;
      c.appendChild(d2); $('fldspq'+i).value = facLdspEquiv;
      const cb = $('cb-fldsp'); if(cb && !cb.classList.contains('op')) tog('fldsp');
      imported++;
    }
  }

  // ── ХДФ ────────────────────────────────────────────────────
  if (hdfEquiv > 0) {
    const e = $('hdf-qty'); if (e) { e.value = hdfEquiv; imported++; }
  }

  // ── Кромка ─────────────────────────────────────────────────
  const edgePm = Math.ceil((d.totalPm2 || 0) + (d.totalPm04 || 0));
  if (edgePm > 0) {
    const e = $('krom-qty'); if (e) { e.value = edgePm; imported++; }
  }

  // ── Фурнитура: Петли ───────────────────────────────────────
  if ((d.totalHinges || 0) > 0) {
    const arr = DB.furn;
    const catName = 'Петля';
    const hingeBrand = mc.hingeBrand || 'En-7';
    const fi = ST.furn.length;
    ST.furn.push({ p: 0 });
    const fc = $('furn-list');
    if (fc) {
      if (fi === 0) fc.innerHTML = '';
      const cats = [...new Set(arr.map(x => x.cat))];
      const fd = document.createElement('div');
      fd.id = 'furnr'+fi; if(fi>0) fd.className='ib'; fd.style.marginTop='8px';
      fd.innerHTML = `<div class="fr"><select id="furnc${fi}" onchange="uC('furn',${fi})">${cats.map(c=>`<option value="${c}"${c===catName?' selected':''}>${c}</option>`).join('')}</select><button class="db" onclick="$('furnr${fi}').style.display='none';ST.furn[${fi}]=null;recalc()">✕</button></div><div class="fr" id="furnvf${fi}"></div><div class="fr"><span class="lb">Кол-во</span><input class="qi" type="number" inputmode="decimal" id="furnq${fi}" placeholder="0" min="0" onchange="recalc()"><span class="fp" id="furnpp${fi}">0₸</span></div>`;
      fc.appendChild(fd);
      uC('furn', fi);
      // Синхронно выбираем бренд
      const hFirmSel = $('furnf'+fi);
      if(hFirmSel) { hFirmSel.value = hingeBrand; uCP('furn', fi); }
      const hQEl = $('furnq'+fi);
      if(hQEl) hQEl.value = d.totalHinges;
      const hCb = $('cb-furn');
      if(hCb && !hCb.classList.contains('op')) tog('furn');
      imported++;
    }
  }

  // ── Ручки (первая подходящая категория из Руч-*) ───────────
  if ((d.totalHandles || 0) > 0) {
    const ruchCat = ['Руч-Скоба','Руч-Скрытая','Руч-Торцевая'].find(c => DB.furn.some(x => x.cat === c)) || 'Руч-Скоба';
    addFurnRow(ruchCat, d.totalHandles);
  }

  // ── Телескопы (направляющие) ──────────────────────────────
  if (d.slideDetails && d.slideDetails.length > 0) {
    d.slideDetails.forEach(function(sl) {
      if (!sl.count) return;
      var catName = sl.type || 'Телескоп';
      var vidName = sl.length + 'мм';
      var brandName = sl.brand || '—';
      var arr = DB.furn;

      // Все категории для первого селекта
      var cats = [];
      var seen = {};
      arr.forEach(function(x){ if(!seen[x.cat]){ seen[x.cat]=1; cats.push(x.cat); } });

      // Все виды для данной категории
      var rows = arr.filter(function(x){ return x.cat===catName; });
      var vids = [...new Set(rows.map(function(x){ return x.vid; }))];

      // Все фирмы для данного вида
      var vidRows = rows.filter(function(x){ return x.vid===vidName; });
      var firms = [...new Set(vidRows.map(function(x){ return x.firm; }).filter(function(f){ return f && f!=='—'; }))];

      // Находим цену по cat+vid+brand
      var priceRow = arr.find(function(x){ return x.cat===catName && x.vid===vidName && x.firm===brandName; });
      if(!priceRow) priceRow = arr.find(function(x){ return x.cat===catName && x.vid===vidName; });
      if(!priceRow) priceRow = arr.find(function(x){ return x.cat===catName; });
      if(!priceRow) return;

      var fi = ST.furn.length;
      ST.furn.push({ p: priceRow.p });
      var fc = $('furn-list');
      if(!fc) return;
      if(fi===0) fc.innerHTML='';

      var fd = document.createElement('div');
      fd.id = 'furnr'+fi;
      if(fi>0) fd.className='ib';
      fd.style.marginTop='8px';

      // Строка 1: селект категории
      var row1 = document.createElement('div'); row1.className='fr';
      var catSel = document.createElement('select');
      catSel.id = 'furnc'+fi;
      catSel.setAttribute('onchange', "uC('furn',"+fi+")");
      cats.forEach(function(c){
        var o=document.createElement('option'); o.value=c; o.textContent=c;
        if(c===catName) o.selected=true;
        catSel.appendChild(o);
      });
      var delBtn = document.createElement('button');
      delBtn.className='db'; delBtn.textContent='✕';
      delBtn.setAttribute('onclick',"$('furnr"+fi+"').style.display='none';ST.furn["+fi+"]=null;recalc()");
      row1.appendChild(catSel); row1.appendChild(delBtn);

      // Строка 2: вид + фирма
      var vidFirmDiv = document.createElement('div'); vidFirmDiv.className='fr'; vidFirmDiv.id='furnvf'+fi;
      // Вид
      if(vids.length > 0){
        var vidSel = document.createElement('select');
        vidSel.id = 'furnv'+fi;
        vids.forEach(function(v){
          var o=document.createElement('option'); o.value=v; o.textContent=v;
          if(v===vidName) o.selected=true;
          vidSel.appendChild(o);
        });
        vidSel.setAttribute('onchange',"uCP('furn',"+fi+")");
        vidFirmDiv.appendChild(vidSel);
      }
      // Фирма
      if(firms.length > 0){
        var firmSel = document.createElement('select');
        firmSel.id = 'furnf'+fi;
        firms.forEach(function(f){
          var o=document.createElement('option'); o.value=f; o.textContent=f;
          if(f===brandName) o.selected=true;
          firmSel.appendChild(o);
        });
        firmSel.setAttribute('onchange',"uCP('furn',"+fi+")");
        vidFirmDiv.appendChild(firmSel);
      }

      // Строка 3: количество
      var row3 = document.createElement('div'); row3.className='fr';
      var lbl = document.createElement('span'); lbl.className='lb'; lbl.textContent='Кол-во';
      var qInp = document.createElement('input');
      qInp.className='qi'; qInp.type='number'; qInp.id='furnq'+fi;
      qInp.placeholder='0'; qInp.min='0'; qInp.value=sl.count;
      qInp.setAttribute('onchange','recalc()');
      var ppSpan = document.createElement('span');
      ppSpan.className='fp'; ppSpan.id='furnpp'+fi;
      ppSpan.textContent = priceRow.p.toLocaleString('ru')+'₸';
      row3.appendChild(lbl); row3.appendChild(qInp); row3.appendChild(ppSpan);

      fd.appendChild(row1); fd.appendChild(vidFirmDiv); fd.appendChild(row3);
      fc.appendChild(fd);

      var cb=$('cb-furn');
      if(cb && !cb.classList.contains('op')) tog('furn');
      imported++;
    });
    recalc();
  }

  // ── Штанга → Фурнитура шкаф ────────────────────────────────
  if ((d.totalRods || 0) > 0) {
    addSHKRow('Штанга', d.totalRods);
  }

  // ── Ножки → Фурнитура общая ─────────────────────────────────
  if ((d.totalLegs || 0) > 0) {
    addFurnRow('Ножки', d.totalLegs);
  }

  // ── Доп. аксессуары шкафа (confExtras → Фурнитура шкаф) ────
  const confExtras = window._confExtras ? window._confExtras() : [];
  if(confExtras.length){
    const shk = DB.shk||[];
    const sc = $('shk-list');
    if(sc){
      confExtras.forEach(function(item){
        const row = shk.find(function(x){ return x.cat===item.cat && x.vid===item.vid; });
        if(!row) return;
        const si = ST.shk.length;
        ST.shk.push({p: row.p});
        if(si===0) sc.innerHTML='';
        const cats = [...new Set(shk.map(function(x){ return x.cat; }))];
        const fd = document.createElement('div');
        fd.id = 'shkr'+si; if(si>0) fd.className='ib'; fd.style.marginTop='8px';
        fd.innerHTML =
          '<div class="fr">' +
          '<select id="shkc'+si+'" onchange="uC(\'shk\','+si+')">' +
            cats.map(function(c){ return '<option value="'+c+'"'+(c===item.cat?' selected':'')+'>'+c+'</option>'; }).join('') +
          '</select>' +
          '<button class="db" onclick="$(\'shkr'+si+'\').style.display=\'none\';ST.shk['+si+']=null;recalc()">✕</button>' +
          '</div>' +
          '<div class="fr" id="shkvf'+si+'"></div>' +
          '<div class="fr"><span class="lb">Кол-во</span>' +
          '<input class="qi" type="number" inputmode="decimal" id="shkq'+si+'" value="'+item.qty+'" min="0" onchange="recalc()">' +
          '<span class="fp" id="shkpp'+si+'">'+row.p.toLocaleString('ru')+'₸</span></div>';
        sc.appendChild(fd);
        uC('shk', si);
        const vSel = $('shkv'+si);
        if(vSel) vSel.value = item.vid;
        $('shkq'+si).value = item.qty;
        const cb = $('cb-shk');
        if(cb && !cb.classList.contains('op')) tog('shk');
        imported++;
      });
      recalc();
    }
  }

  // ── Клиент из проекта ──────────────────────────────────────
  const confClient = document.getElementById('proj-client-inp');
  const confName   = document.getElementById('proj-name-inp');
  if ($('kp-client') && confClient) $('kp-client').value = confClient.value;
  if ($('kp-object') && confName)   $('kp-object').value = confName.value;

  recalc();
  page('calc');
  tab('calc');
  const korpCb = $('cb-korp');
  if (korpCb && !korpCb.classList.contains('op')) tog('korp');

  showStatus(`OK Импортировано: ЛДСП ${ldspEquiv} л, ХДФ ${hdfEquiv} л, кромка ${edgePm} пм, петли ${d.totalHinges||0} шт, ручки ${d.totalHandles||0} шт, ножки ${d.totalLegs||0} шт`, '#1a5252');
  setTimeout(hideStatus, 5000);
}

// ===== КОНЕЦ МОСТА =====

// ===== ИСТОРИЯ КП =====
function getSnap(){
  const snap={};
  // Коэф и настройки
  ["c-kl","c-rl","c-sl","c-taxl","c-crl","c-kp","c-rp","c-sp","c-taxp","c-crp","c-kk","c-rk","c-sk","c-taxk","c-crk",
   "hdf-qty","krom-qty","d-sat","d-pdm","svet-inc","kp-client","kp-object","kp-num","kp-manager"].forEach(id=>{
    const e=$(id);if(e)snap[id]=e.value;
  });
  // Работы
  DB.works.forEach((_,i)=>{const e=$("wq"+i);if(e)snap["wq"+i]=e.value;});
  // Витрины
  ST.vit.forEach((x,i)=>{
    if(x===null)return;
    ["vw","vh","vn","vdel","vinc"].forEach(p=>{const e=$(p+i);if(e)snap[p+i]=e.value;});
    const vst=$("vst"+i);if(vst)snap["vst"+i]=vst.value;
    const vpr=$("vpr"+i);if(vpr)snap["vpr"+i]=vpr.value;
  });
  // Доп позиции
  ST.dop.forEach((x,i)=>{
    if(x===null)return;
    ["dn","dp","dq"].forEach(p=>{const e=$(p+i);if(e)snap[p+i]=e.value;});
  });
  // ЛДСП
  ST.ldsp.forEach((x,i)=>{
    if(x===null||x===undefined)return;
    const ls=$("ls"+i);if(ls)snap["ls"+i]=ls.value;
    const lq=$("lq"+i);if(lq)snap["lq"+i]=lq.value;
  });
  // Простые секции
  ["fldsp","fplen","fkr"].forEach(sec=>{
    ST[sec].forEach((x,i)=>{
      if(x===null||x===undefined)return;
      const s=$(sec+"s"+i);if(s)snap[sec+"s"+i]=s.value;
      const q=$(sec+"q"+i);if(q)snap[sec+"q"+i]=q.value;
    });
  });
  // Кат секции
  ["furn","kuh","shk","svet"].forEach(sec=>{
    ST[sec].forEach((item,i)=>{
      if(!item)return;
      const c=$(sec+"c"+i);if(c)snap[sec+"c"+i]=c.value;
      const v=$(sec+"v"+i);if(v)snap[sec+"v"+i]=v.value;
      const f=$(sec+"f"+i);if(f)snap[sec+"f"+i]=f.value;
      const q=$(sec+"q"+i);if(q)snap[sec+"q"+i]=q.value;
    });
  });
  return snap;
}
function saveCalc(){
  if(!C.BL){alert("Сначала добавьте позиции в расчёт");return;}
  const client=$("kp-client")?.value||"Клиент";
  const obj=$("kp-object")?.value||"";
  const num=$("kp-num")?.value||"001";
  const rec={
    id:Date.now(),
    date:new Date().toLocaleDateString("ru-RU",{day:"numeric",month:"short",year:"numeric"}),
    client,obj,num,
    totL:C.BL?.tot||0,totP:C.BP?.tot||0,totK:C.BK?.tot||0,
    ST:JSON.parse(JSON.stringify(ST)),
    snap:getSnap(),
    vitCount:ST.vit.filter(x=>x!==null).length,
    dopCount:ST.dop.filter(x=>x!==null).length
  };
  const hist=JSON.parse(localStorage.getItem("mebeloff_hist")||"[]");
  hist.unshift(rec);
  if(hist.length>50)hist.pop();
  localStorage.setItem("mebeloff_hist",JSON.stringify(hist));
  showStatus("OK Расчёт сохранён","#1D9E75");setTimeout(hideStatus,2000);
}
function renderHist(){
  const hist=JSON.parse(localStorage.getItem("mebeloff_hist")||"[]");
  const c=$("hist-list");
  if(!hist.length){c.innerHTML='<p class="hint" style="padding:30px 0">Нет сохранённых расчётов</p>';return;}
  c.innerHTML=hist.map(r=>`
    <div class="card" style="margin-bottom:10px">
      <div style="padding:10px 12px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--d)">${r.client}${r.obj?' — '+r.obj:''}</div>
            <div style="font-size:10px;color:var(--t3);margin-top:2px">КП #${r.num} · ${r.date}</div>
          </div>
          <button onclick="deleteHist(${r.id})" style="background:none;border:none;color:#ccc;font-size:18px;cursor:pointer;line-height:1;padding:0 4px">✕</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-bottom:8px">
          <div style="background:#f4f3ff;border-radius:6px;padding:6px 8px"><div style="font-size:8px;color:#534AB7;font-weight:700;text-transform:uppercase;margin-bottom:2px">ЛДСП</div><div style="font-size:12px;font-weight:700;color:#0a2e2e">${fm(r.totL)}</div></div>
          <div style="background:#f0faf7;border-radius:6px;padding:6px 8px"><div style="font-size:8px;color:#0F6E56;font-weight:700;text-transform:uppercase;margin-bottom:2px">Плёнка</div><div style="font-size:12px;font-weight:700;color:#0a2e2e">${fm(r.totP)}</div></div>
          <div style="background:#fdf5f0;border-radius:6px;padding:6px 8px"><div style="font-size:8px;color:#993C1D;font-weight:700;text-transform:uppercase;margin-bottom:2px">Краска</div><div style="font-size:12px;font-weight:700;color:#0a2e2e">${fm(r.totK)}</div></div>
        </div>
        <div style="display:flex;gap:6px">
          <button onclick="loadCalc(${r.id})" class="actn ad" style="flex:1;padding:8px;font-size:12px;margin:0">📂 Загрузить</button>
          <button onclick="loadAndKP(${r.id})" class="pb p" style="flex:1;font-size:12px">📄 КП</button>
        </div>
      </div>
    </div>
  `).join("");
}
function deleteHist(id){
  let hist=JSON.parse(localStorage.getItem("mebeloff_hist")||"[]");
  hist=hist.filter(r=>r.id!==id);
  localStorage.setItem("mebeloff_hist",JSON.stringify(hist));
  renderHist();
}
function clearHistory(){
  if(!confirm("Удалить всю историю?"))return;
  localStorage.removeItem("mebeloff_hist");
  renderHist();
}
async function loadCalc(id){
  const hist=JSON.parse(localStorage.getItem("mebeloff_hist")||"[]");
  const rec=hist.find(r=>r.id===id);
  if(!rec)return;
  // Сброс
  Object.keys(ST).forEach(k=>ST[k]=[]);
  ["ldsp-list","fldsp-list","fplen-list","fkr-list","furn-list","kuh-list","shk-list","svet-list","dop-list","vit-list"].forEach(id2=>{const e=$(id2);if(e)e.innerHTML='<p class="hint">Нет позиций</p>';});
  // Восстановить снэп полей (коэффициенты, клиент, и т.д.)
  const snap=rec.snap;
  // Простые инпуты
  ["c-kl","c-rl","c-sl","c-taxl","c-crl","c-kp","c-rp","c-sp","c-taxp","c-crp","c-kk","c-rk","c-sk","c-taxk","c-crk",
   "hdf-qty","krom-qty","d-sat","d-pdm","svet-inc","kp-client","kp-object","kp-num","kp-manager"].forEach(fid=>{
    const e=$(fid);if(e&&snap[fid]!==undefined)e.value=snap[fid];
  });
  // Работы qty
  DB.works.forEach((_,i)=>{const e=$("wq"+i);if(e&&snap["wq"+i]!==undefined)e.value=snap["wq"+i];});
  // Восстановить ЛДСП
  const ldspST=rec.ST.ldsp;
  for(let i=0;i<ldspST.length;i++){if(ldspST[i]===null||ldspST[i]===undefined)continue;ST.ldsp.push(ldspST[i]);const c=$("ldsp-list");if(i===0)c.innerHTML="";const d=document.createElement("div");d.id="lr"+i;if(i>0)d.className="ib";d.style.marginTop="8px";const o=DB.ldsp.map((x,j)=>`<option value="${j}">${x.n} — ${x.p.toLocaleString("ru")}₸</option>`).join("");d.innerHTML=`<div class="fr"><select id="ls${i}" onchange="ST.ldsp[${i}]=+this.value;$('lp${i}').textContent=DB.ldsp[+this.value].p.toLocaleString('ru')+'₸/л';recalc()">${o}</select><button class="db" onclick="$('lr${i}').style.display='none';ST.ldsp[${i}]=null;recalc()">✕</button></div><div class="fr"><span class="lb">Кол-во</span><input class="qi" type="number" inputmode="decimal" id="lq${i}" placeholder="0" min="0" onchange="recalc()"><span class="fp" id="lp${i}">${DB.ldsp[0].p.toLocaleString("ru")}₸/л</span></div>`;c.appendChild(d);if(snap["ls"+i]!==undefined){const s=$("ls"+i);if(s){s.value=snap["ls"+i];ST.ldsp[i]=+snap["ls"+i];}}if(snap["lq"+i]!==undefined){const q=$("lq"+i);if(q)q.value=snap["lq"+i];}}
  // Восстановить простые секции (фасады)
  ["fldsp","fplen","fkr"].forEach(sec=>{
    const arr=sec==="fldsp"?DB.ldsp:sec==="fplen"?DB.fas_plen:DB.fas_kr;
    const lid=sec+"-list";
    const secST=rec.ST[sec];
    for(let i=0;i<secST.length;i++){
      if(secST[i]===null||secST[i]===undefined)continue;
      ST[sec].push(secST[i]);
      const c=$(lid);if(i===0)c.innerHTML="";
      const d=document.createElement("div");d.id=sec+"r"+i;if(i>0)d.className="ib";d.style.marginTop="8px";
      const o=arr.map((x,j)=>`<option value="${j}">${x.n} — ${x.p.toLocaleString("ru")}₸</option>`).join("");
      d.innerHTML=`<div class="fr"><select id="${sec}s${i}" onchange="ST['${sec}'][${i}]=+this.value;recalc()">${o}</select><button class="db" onclick="$('${sec}r${i}').style.display='none';ST['${sec}'][${i}]=null;recalc()">✕</button></div><div class="fr"><span class="lb">Кол-во</span><input class="qi" type="number" inputmode="decimal" id="${sec}q${i}" placeholder="0" min="0" onchange="recalc()"><span class="fp" id="${sec}p${i}">${arr[0].p.toLocaleString("ru")}₸/л</span></div>`;
      c.appendChild(d);
      if(snap[sec+"s"+i]!==undefined){const s=$(sec+"s"+i);if(s)s.value=snap[sec+"s"+i];}
      if(snap[sec+"q"+i]!==undefined){const q=$(sec+"q"+i);if(q)q.value=snap[sec+"q"+i];}
    }
  });
  // Восстановить кат секции
  ["furn","kuh","shk","svet"].forEach(sec=>{
    const arr=gA(sec);const lid=sec+"-list";
    const secST=rec.ST[sec];
    for(let i=0;i<secST.length;i++){
      if(!secST[i])continue;
      ST[sec].push({p:0});
      const c=$(lid);if(i===0)c.innerHTML="";
      const d=document.createElement("div");d.id=sec+"r"+i;if(i>0)d.className="ib";d.style.marginTop="8px";
      const cats=[...new Set(arr.map(x=>x.cat))];
      d.innerHTML=`<div class="fr"><select id="${sec}c${i}" onchange="uC('${sec}',${i})">${cats.map(cat=>`<option value="${cat}">${cat}</option>`).join("")}</select><button class="db" onclick="$('${sec}r${i}').style.display='none';ST['${sec}'][${i}]=null;recalc()">✕</button></div><div class="fr" id="${sec}vf${i}"></div><div class="fr"><span class="lb">Кол-во</span><input class="qi" type="number" inputmode="decimal" id="${sec}q${i}" placeholder="0" min="0" onchange="recalc()"><span class="fp" id="${sec}pp${i}">0₸</span></div>`;
      c.appendChild(d);
      if(snap[sec+"c"+i]!==undefined){const s=$(sec+"c"+i);if(s)s.value=snap[sec+"c"+i];}
      uC(sec,i);
      if(snap[sec+"v"+i]!==undefined){const s=$(sec+"v"+i);if(s)s.value=snap[sec+"v"+i];}
      if(snap[sec+"f"+i]!==undefined){const s=$(sec+"f"+i);if(s)s.value=snap[sec+"f"+i];}
      uCP(sec,i);
      if(snap[sec+"q"+i]!==undefined){const q=$(sec+"q"+i);if(q)q.value=snap[sec+"q"+i];}
    }
  });
  // Доп позиции
  const dopST=rec.ST.dop;
  for(let i=0;i<dopST.length;i++){
    if(dopST[i]===null)continue;
    ST.dop.push(1);
    const c=$("dop-list");if(i===0)c.innerHTML="";
    const d=document.createElement("div");d.id="dr"+i;if(i>0)d.className="ib";d.style.marginTop="8px";
    d.innerHTML=`<div class="fr"><input style="font-size:12px;border:1px solid #ddd;border-radius:8px;padding:6px 8px;flex:1;min-width:0" type="text" id="dn${i}" placeholder="Название"><button class="db" onclick="$('dr${i}').style.display='none';ST.dop[${i}]=null;recalc()">✕</button></div><div class="fr"><span class="lb">Цена</span><input class="qi" type="number" inputmode="decimal" id="dp${i}" placeholder="0" onchange="recalc()"><span class="fp">₸/шт</span></div><div class="fr"><span class="lb">Кол-во</span><input class="qi" type="number" inputmode="decimal" id="dq${i}" placeholder="1" onchange="recalc()"><span class="fp">шт</span></div>`;
    c.appendChild(d);
    ["dn","dp","dq"].forEach(p=>{if(snap[p+i]!==undefined){const e=$(p+i);if(e)e.value=snap[p+i];}});
  }
  // Витрины
  const vitST=rec.ST.vit;
  for(let i=0;i<vitST.length;i++){
    if(vitST[i]===null)continue;
    addVit();
    ["vw","vh","vn","vdel","vinc"].forEach(p=>{if(snap[p+i]!==undefined){const e=$(p+i);if(e)e.value=snap[p+i];}});
    if(snap["vst"+i]!==undefined){const s=$("vst"+i);if(s)s.value=snap["vst"+i];}
    if(snap["vpr"+i]!==undefined){const s=$("vpr"+i);if(s)s.value=snap["vpr"+i];}
    cV(i);
  }
  renderWorks();recalc();
  page("calc");tab("calc");
  showStatus("OK Расчёт загружен","#1a5252");setTimeout(hideStatus,2000);
}
async function loadAndKP(id){
  await loadCalc(id);
  setTimeout(()=>{showKP();},100);
}
// ===== КОНЕЦ ИСТОРИИ =====

loadFromSheets();
