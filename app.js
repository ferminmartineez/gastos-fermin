"use strict";
const FB_VERSION = "10.12.2";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const pad = n => String(n).padStart(2, "0");
const MES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const MESC = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const DIAS = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
const COLORS = ["#5B8CFF","#E4F27A","#43D9A0","#FF9F5A","#B58CFF","#5AD1FF","#FF6FA8","#FFD35A","#8AA0C8","#7BE0C3"];

const dStr = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const todayStr = () => dStr(new Date());
const todayKey = () => todayStr().slice(0,7);
const shiftKey = (k, n) => { let [y,m] = k.split("-").map(Number); m += n; while (m>12){m-=12;y++} while(m<1){m+=12;y--} return `${y}-${pad(m)}`; };
const monthLabel = k => { const [y,m] = k.split("-").map(Number); return `${MES[m-1]} ${y}`; };
const daysIn = k => { const [y,m] = k.split("-").map(Number); return new Date(y, m, 0).getDate(); };
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2,8);

let nf;
try { nf = new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR",useGrouping:"always"}); nf.format(1000); }
catch(e){ nf = new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR"}); }
const r2 = v => Math.round(v*100)/100;
const eur = v => nf.format(r2(v));

function defaultCfg(){
  const cats = [
    ["alquiler","🏠","Alquiler",575],["comida","🛒","Alimentación",250],["casa","💡","Piso (luz, agua, wifi)",150],
    ["subs","📱","Suscripciones",60],["ocio","🍻","Ocio y salidas",80],["transporte","🚆","Transporte",40],
    ["academico","🎓","Académico",0],["otros","🧾","Otros",30],["invertir","📈","Inversión",50]
  ].map(([id,e,n,b],i) => ({id, e, n, b, c: COLORS[i % COLORS.length], inv: id === "invertir"}));
  const inc = [["padres","👨‍👩‍👦","Padres"],["webs","💻","Webs"],["nomina","💼","Nómina"],["otrosi","➕","Otros ingresos"]]
    .map(([id,e,n]) => ({id, e, n}));
  const cfg = {v:1, cats, inc, income:1250, log:{}};
  cfg.log[todayKey()] = snap(cfg);
  return cfg;
}
function snap(cfg){ const o = {_income: cfg.income}; cfg.cats.forEach(c => { if (!c.arch) o[c.id] = c.b; }); return o; }
function budgetsFor(key){
  const log = S.cfg.log || {}; const ks = Object.keys(log).sort(); let pick = null;
  for (const k of ks) if (k <= key) pick = k;
  if (!pick) pick = ks[0];
  return pick ? log[pick] : snap(S.cfg);
}

/* ---------- state ---------- */
const S = {
  F:null, auth:null, fs:null, user:null, screen:"loading",
  cfg:null, all:[], loaded:false, windowStart:shiftKey(todayKey(), -12),
  older:{}, olderLoading:{}, pending:false, cached:true, unsubs:[],
  view:todayKey(), tab:"inicio", filter:"all", deepLinkDone:false
};
const userPath = (...p) => ["users", S.user.uid, ...p];
const cfgRef = () => S.F.doc(S.fs, ...userPath("meta", "config"));
const txCol = () => S.F.collection(S.fs, ...userPath("tx"));
const txRef = id => S.F.doc(S.fs, ...userPath("tx", id));

function errToast(e){
  console.error(e);
  if (e && e.code === "permission-denied") toast("Sin permiso para guardar. Revisa las reglas de Firestore.");
  else toast("No se ha podido guardar. Vuelve a intentarlo.");
}

function txFor(key){
  if (key >= S.windowStart) return S.all.filter(t => t.m === key);
  if (S.older[key]) return S.older[key];
  loadOlder(key); return [];
}
async function loadOlder(key){
  if (S.olderLoading[key]) return; S.olderLoading[key] = true;
  try {
    const snap = await S.F.getDocs(S.F.query(txCol(), S.F.where("m", "==", key)));
    S.older[key] = snap.docs.map(d => d.data()); render();
  } catch(e){ S.olderLoading[key] = false; }
}
function patchOlder(tx, remove){
  for (const k of Object.keys(S.older)) S.older[k] = S.older[k].filter(t => t.id !== tx.id);
  if (!remove && tx.m < S.windowStart && S.older[tx.m]) S.older[tx.m].push(tx);
}
function putTx(tx){
  const p = S.F.setDoc(txRef(tx.id), tx); patchOlder(tx, false); render();
  p.catch(errToast); return p;
}
function removeTx(tx){
  const p = S.F.deleteDoc(txRef(tx.id)); patchOlder(tx, true); render();
  p.catch(errToast); return p;
}

let cfgTimer;
function saveCfg(){
  S.cfg.log = S.cfg.log || {};
  S.cfg.log[todayKey()] = snap(S.cfg);
  clearTimeout(cfgTimer);
  const c = clone(S.cfg);
  cfgTimer = setTimeout(() => { S.F.setDoc(cfgRef(), c).catch(errToast); }, 400);
}

function setSync(state){
  const el = $("#sync"); if (!el) return;
  el.className = "sync " + state;
  $("#syncTxt").textContent = {ok:"Sincronizado", pend:"Subiendo…", off:"Sin conexión", conn:"Conectando", err:"Error"}[state] || "";
}
function updateSync(){
  if (!navigator.onLine) return setSync("off");
  if (S.pending) return setSync("pend");
  if (S.cached) return setSync("conn");
  setSync("ok");
}
window.addEventListener("online", updateSync);
window.addEventListener("offline", updateSync);

/* ---------- data ---------- */
function startData(){
  stopData();
  S.loaded = false; S.all = []; S.older = {}; S.olderLoading = {}; S.cfg = null;
  const cutoff = S.windowStart + "-01";
  S.unsubs.push(S.F.onSnapshot(cfgRef(), snap => {
    if (snap.exists()){
      const inputFocused = S.tab === "ajustes" && document.activeElement && document.activeElement.tagName === "INPUT";
      if (!inputFocused || !S.cfg) S.cfg = clone(snap.data());
      render(); handleDeepLink();
    } else if (!snap.metadata.fromCache){
      S.cfg = defaultCfg(); S.F.setDoc(cfgRef(), clone(S.cfg)).catch(errToast); render(); handleDeepLink();
    }
  }, e => { console.error(e); setSync("err"); }));
  S.unsubs.push(S.F.onSnapshot(S.F.query(txCol(), S.F.where("d", ">=", cutoff)), {includeMetadataChanges:true}, snap => {
    const arr = []; snap.forEach(d => arr.push(d.data()));
    S.all = arr; S.loaded = true;
    S.pending = snap.metadata.hasPendingWrites; S.cached = snap.metadata.fromCache;
    updateSync(); render();
  }, e => { console.error(e); setSync("err"); if (e && e.code === "permission-denied") toast("Sin permiso para leer. Revisa las reglas de Firestore."); }));
}
function stopData(){ S.unsubs.forEach(u => { try { u(); } catch(e){} }); S.unsubs = []; }

/* ---------- calculations ---------- */
function stats(key){
  const tx = txFor(key); const b = budgetsFor(key);
  const spentBy = {}, incBy = {}; let spent = 0, inc = 0;
  for (const t of tx){
    if (t.t === "g"){ spentBy[t.cat] = (spentBy[t.cat] || 0) + t.amt; spent += t.amt; }
    else { incBy[t.cat] = (incBy[t.cat] || 0) + t.amt; inc += t.amt; }
  }
  const cats = S.cfg.cats.filter(c => !c.arch || spentBy[c.id] || b[c.id]);
  let budget = 0; cats.forEach(c => budget += (b[c.id] || 0));
  let invested = 0; cats.forEach(c => { if (c.inv) invested += (spentBy[c.id] || 0); });
  return {tx, b, spentBy, incBy, spent: r2(spent), inc: r2(inc), budget: r2(budget), cats, invested: r2(invested), expected: b._income ?? S.cfg.income};
}
const catById = id => S.cfg.cats.find(c => c.id === id) || S.cfg.inc.find(c => c.id === id) || {e:"❔", n:"Sin categoría", c:"#8AA0C8"};
const splitMoney = v => { const s = eur(Math.abs(v)); const i = s.lastIndexOf(","); return i < 0 ? [s, ""] : [s.slice(0,i), s.slice(i)]; };

/* ---------- screens ---------- */
function showScreen(name){
  S.screen = name;
  document.body.dataset.screen = name;
  render();
}

let raf = 0;
function render(){ cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); }
function draw(){
  const v = $("#view");
  if (S.screen === "setup"){ v.innerHTML = viewSetup(); return; }
  if (S.screen === "error"){ v.innerHTML = viewLoadError(); return; }
  if (S.screen === "login"){ if (!$("#loginForm")) v.innerHTML = viewLogin(); return; }
  if (S.screen === "loading" || !S.cfg || !S.loaded){ v.innerHTML = `<div class="empty" style="padding-top:30vh">Cargando tus cuentas…</div>`; return; }
  if (S.tab === "ajustes" && v.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("on", t.dataset.tab === S.tab));
  v.innerHTML = S.tab === "inicio" ? viewHome() : S.tab === "movs" ? viewMoves() : S.tab === "hist" ? viewHist() : viewSettings();
}

function viewSetup(){
  return `<div class="auth"><div class="hero"><p class="hero-lbl">Falta un paso</p><p class="hero-num" style="font-size:30px">Configura Firebase</p>
    <p style="margin:0;opacity:.9">Abre el archivo <b>config.js</b> y pega la configuración de tu proyecto de Firebase. Después sube el archivo de nuevo a GitHub.</p></div></div>`;
}
function viewLoadError(){
  return `<div class="auth"><div class="panel help"><b>No se ha podido cargar la app.</b><br>Necesita conexión la primera vez que se abre. Conéctate a internet y pulsa reintentar.
    <div><button class="btn" onclick="location.reload()">Reintentar</button></div></div></div>`;
}
function viewLogin(){
  return `<div class="auth">
    <div class="hero"><p class="hero-lbl">Mis cuentas</p><p class="hero-num" style="font-size:34px">Entra para ver tu mes</p>
      <div class="hero-bar"><i style="width:62%"></i></div></div>
    <form id="loginForm" class="panel" style="padding:16px;margin-top:16px" novalidate>
      <label class="flabel" for="email">Email</label>
      <input class="field" id="email" type="email" autocomplete="username" inputmode="email" required>
      <label class="flabel" for="pass">Contraseña</label>
      <input class="field" id="pass" type="password" autocomplete="current-password" required>
      <p class="ferr" id="loginErr" role="alert"></p>
      <button class="save" id="loginBtn" type="submit" style="width:100%">Entrar</button>
      <button class="linkbtn" type="button" id="resetBtn">He olvidado la contraseña</button>
    </form></div>`;
}

function monthNav(){
  const isNow = S.view === todayKey();
  return `<div class="mnav"><h1>${monthLabel(S.view)}</h1><div class="arrows">
    <button class="circ" data-act="prev" aria-label="Mes anterior"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m15 6-6 6 6 6"/></svg></button>
    <button class="circ" data-act="next" aria-label="Mes siguiente" ${isNow ? "disabled" : ""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg></button>
  </div></div>`;
}

function viewHome(){
  const st = stats(S.view);
  const left = r2(st.budget - st.spent);
  const over = left < 0;
  const pct = st.budget > 0 ? Math.min(100, st.spent / st.budget * 100) : (st.spent > 0 ? 100 : 0);
  const [a, c] = splitMoney(left);
  const tk = todayKey(); const isNow = S.view === tk; const isPast = S.view < tk;
  const result = r2(st.inc - st.spent);
  const incPct = st.expected > 0 ? Math.min(100, st.inc / st.expected * 100) : 0;

  let strip = "";
  if (isNow && !over && st.budget > 0){
    const rem = daysIn(S.view) - new Date().getDate() + 1;
    strip = `<div class="note-strip">Te quedan <b class="num">${eur(left / rem)} al día</b> durante los próximos ${rem} ${rem === 1 ? "día" : "días"}.</div>`;
  } else if (isPast && st.tx.length){
    const mname = MES[+S.view.slice(5)-1];
    strip = over
      ? `<div class="note-strip">${mname} cerrado <b class="neg num">${eur(-left)} por encima</b> del presupuesto.</div>`
      : `<div class="note-strip">${mname} cerrado <b class="pos num">${eur(left)} por debajo</b> del presupuesto.</div>`;
  }

  const rows = st.cats.map(cat => {
    const b = st.b[cat.id] || 0, s = st.spentBy[cat.id] || 0, d = r2(b - s);
    const w = b > 0 ? Math.min(100, s / b * 100) : (s > 0 ? 100 : 0);
    const isOver = d < 0;
    const txt = isOver ? `+${eur(-d)} por encima` : b > 0 ? (d === 0 ? "Justo en el límite" : `Quedan ${eur(d)}`) : "Sin presupuesto";
    const cls = isOver ? "over" : b > 0 ? "ok" : "none";
    return `<button class="cat-row ${b === 0 && s === 0 ? "dim" : ""}" data-cat="${esc(cat.id)}" style="--c:${esc(cat.c)}">
      <span class="ico">${esc(cat.e)}</span>
      <span class="cat-main">
        <span class="cat-top"><b>${esc(cat.n)}</b><span class="cat-left ${cls} num">${txt}</span></span>
        <span class="bar ${isOver ? "over" : ""}"><i style="width:${w}%"></i></span>
        <span class="cat-sub num">${eur(s)} de ${eur(b)}</span>
      </span></button>`;
  }).join("");

  const incRows = S.cfg.inc.filter(c => st.incBy[c.id]).map(c =>
    `<div class="lineitem"><span>${esc(c.e)} ${esc(c.n)}</span><b class="pos num">+${eur(st.incBy[c.id])}</b></div>`).join("");

  return `${monthNav()}
  <div class="hero ${over ? "over" : ""}">
    <div class="hero-top"><p class="hero-lbl">${over ? "Te has pasado" : "Te queda por gastar"}</p><span class="pill">${over ? "Por encima del presupuesto" : Math.round(pct) + "% usado"}</span></div>
    <p class="hero-num num">${over ? "−" : ""}${esc(a)}<span>${esc(c)}</span></p>
    <div class="hero-bar"><i style="width:${pct}%"></i></div>
    <div class="hero-foot num"><span>Gastado ${eur(st.spent)}</span><span>de ${eur(st.budget)}</span></div>
  </div>
  <div class="duo">
    <div class="mini"><p class="lbl">Ingresado</p><p class="val num">${eur(st.inc)}</p>
      <div class="bar" style="--c:var(--green)"><i style="width:${incPct}%"></i></div><p class="sub num">Previsto ${eur(st.expected)}</p></div>
    <div class="mini"><p class="lbl">${result >= 0 ? "Ahorro real" : "Déficit"}</p><p class="val num ${result >= 0 ? "pos" : "neg"}">${result >= 0 ? "+" : "−"}${eur(Math.abs(result))}</p>
      <div class="bar" style="--c:var(--lime)"><i style="width:${st.inc > 0 ? Math.max(0, Math.min(100, result / st.inc * 100)) : 0}%"></i></div>
      <p class="sub num">${st.invested > 0 ? `Invertido ${eur(st.invested)}` : "Ingresos menos gastos"}</p></div>
  </div>
  ${strip}
  <div class="sec"><div class="sec-h"><h2>Categorías</h2><button data-act="goSettings">Editar</button></div>
    <div class="panel">${rows || `<div class="empty">Añade categorías en Ajustes.</div>`}</div></div>
  ${incRows ? `<div class="sec"><div class="sec-h"><h2>Ingresos</h2></div><div class="panel">${incRows}</div></div>` : ""}
  ${!st.tx.length && isNow ? `<div class="empty"><b>Aún no hay movimientos este mes</b>Pulsa el botón + para apuntar el primero.</div>` : ""}`;
}

function dayLabel(ds){
  const t = todayStr(); const y = new Date(); y.setDate(y.getDate() - 1);
  const d = new Date(ds + "T12:00:00");
  const base = `${d.getDate()} ${MESC[d.getMonth()]}`;
  if (ds === t) return `Hoy, ${base}`;
  if (ds === dStr(y)) return `Ayer, ${base}`;
  const w = DIAS[d.getDay()]; return `${w[0].toUpperCase() + w.slice(1)} ${base}`;
}

function viewMoves(){
  const st = stats(S.view);
  const f = S.filter;
  const used = new Set(st.tx.map(t => t.cat));
  const chips = [["all","Todo"],["g","Gastos"],["i","Ingresos"]].map(([k,l]) => `<button class="chip ${f === k ? "on" : ""}" data-filter="${k}">${l}</button>`).join("")
    + [...S.cfg.cats, ...S.cfg.inc].filter(c => used.has(c.id)).map(c => `<button class="chip ${f === c.id ? "on" : ""}" data-filter="${esc(c.id)}">${esc(c.e)} ${esc(c.n)}</button>`).join("");
  const list = st.tx.filter(t => f === "all" || t.t === f || t.cat === f)
    .slice().sort((a,b) => a.d === b.d ? b.ts - a.ts : (a.d < b.d ? 1 : -1));
  let html = "", cur = null, group = [], sum = 0;
  const flush = () => {
    if (!cur) return;
    html += `<div class="day-h"><span>${dayLabel(cur)}</span><span class="num">${sum < 0 ? "−" : "+"}${eur(Math.abs(sum))}</span></div><div class="panel">${group.join("")}</div>`;
  };
  for (const t of list){
    if (t.d !== cur){ flush(); cur = t.d; group = []; sum = 0; }
    const c = catById(t.cat); sum += t.t === "g" ? -t.amt : t.amt;
    group.push(`<button class="mv" data-tx="${esc(t.id)}" style="--c:${esc(c.c || "#43D9A0")}">
      <span class="ico">${esc(c.e)}</span>
      <span class="mv-main"><b>${esc(t.note || c.n)}</b><small>${esc(c.n)}</small></span>
      <span class="amt num ${t.t === "g" ? "" : "pos"}">${t.t === "g" ? "−" : "+"}${eur(t.amt)}</span></button>`);
  }
  flush();
  return `${monthNav()}<div class="chips-row">${chips}</div>
    ${html || `<div class="empty"><b>Sin movimientos</b>${f === "all" ? "No hay nada apuntado en este mes." : "No hay movimientos con este filtro."}</div>`}`;
}

function viewHist(){
  const tk = todayKey();
  const keys = new Set(S.all.map(t => t.m)); keys.add(tk);
  const sorted = [...keys].filter(k => k <= tk).sort();
  const last = sorted.slice(-6);
  const data = last.map(k => ({k, ...stats(k)}));
  const max = Math.max(1, ...data.map(d => Math.max(d.budget, d.spent))) * 1.12;
  const W = 340, H = 170, top = 10, bottom = 24, ch = H - top - bottom;
  const colW = W / Math.max(data.length, 1);
  const bars = data.map((d, i) => {
    const x = i * colW + colW/2;
    const hs = d.spent / max * ch, hb = d.budget / max * ch;
    const over = d.spent > d.budget + 0.004;
    return `<rect x="${x-13}" y="${top + ch - hb}" width="26" height="${hb}" rx="8" fill="var(--surface2)"/>
      <rect x="${x-13}" y="${top + ch - hs}" width="26" height="${hs}" rx="8" fill="${over ? "var(--red)" : "var(--blue)"}"/>
      <line x1="${x-18}" x2="${x+18}" y1="${top + ch - hb}" y2="${top + ch - hb}" stroke="var(--lime)" stroke-width="2.5" stroke-linecap="round"/>
      <text x="${x}" y="${H-6}" text-anchor="middle" font-size="12" fill="var(--muted)">${MESC[+d.k.slice(5)-1]}</text>`;
  }).join("");

  const year = tk.slice(0,4);
  let yReal = 0, yUnder = 0;
  sorted.filter(k => k.startsWith(year) && k < tk).forEach(k => { const s = stats(k); yReal += s.inc - s.spent; yUnder += s.budget - s.spent; });

  const rows = sorted.slice().reverse().map(k => {
    const s = stats(k); const d = r2(s.budget - s.spent); const res = r2(s.inc - s.spent);
    const verdict = k === tk ? (d >= 0 ? "Quedan " + eur(d) : "Te pasas " + eur(-d)) : (d >= 0 ? "Ahorraste " + eur(d) : "Te pasaste " + eur(-d));
    return `<button class="hist-row" data-month="${k}"><span><b>${monthLabel(k)}</b><small class="num">Gastado ${eur(s.spent)} de ${eur(s.budget)}</small></span>
      <span class="r"><b class="num ${d >= 0 ? "pos" : "neg"}">${verdict}</b><small class="num">Resultado ${res >= 0 ? "+" : "−"}${eur(Math.abs(res))}</small></span></button>`;
  }).join("");

  return `<div class="mnav"><h1>Historial</h1></div>
  <div class="duo" style="margin-top:0">
    <div class="mini"><p class="lbl">Ahorro real ${year}</p><p class="val num ${yReal >= 0 ? "pos" : "neg"}">${yReal >= 0 ? "+" : "−"}${eur(Math.abs(yReal))}</p><p class="sub">Meses cerrados, ingresos menos gastos</p></div>
    <div class="mini"><p class="lbl">Frente al presupuesto</p><p class="val num ${yUnder >= 0 ? "pos" : "neg"}">${yUnder >= 0 ? "+" : "−"}${eur(Math.abs(yUnder))}</p><p class="sub">${yUnder >= 0 ? "Por debajo de lo previsto" : "Por encima de lo previsto"}</p></div>
  </div>
  <div class="sec"><div class="sec-h"><h2>Gasto por mes</h2><span style="color:var(--muted)">Línea: presupuesto</span></div>
    <div class="panel" style="padding:14px 10px 8px"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gasto frente a presupuesto por mes">${bars}</svg></div></div>
  <div class="sec"><div class="sec-h"><h2>Meses</h2><span style="color:var(--muted)">Toca uno para verlo</span></div><div class="panel">${rows}</div></div>`;
}

const xIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
function viewSettings(){
  const act = S.cfg.cats.filter(c => !c.arch);
  const total = act.reduce((a,c) => a + (+c.b || 0), 0);
  const diff = r2(S.cfg.income - total);
  const cats = act.map(c => `<div class="set-row" data-id="${esc(c.id)}">
      <input class="field emo" data-f="e" value="${esc(c.e)}" maxlength="4" aria-label="Icono">
      <input class="field" data-f="n" value="${esc(c.n)}" maxlength="30" aria-label="Nombre">
      <input class="field money num" data-f="b" value="${c.b}" inputmode="decimal" aria-label="Presupuesto mensual">
      <button class="x" data-del="${esc(c.id)}" aria-label="Eliminar categoría">${xIcon}</button></div>`).join("");
  const incs = S.cfg.inc.map(c => `<div class="set-row inc" data-inc="${esc(c.id)}">
      <input class="field emo" data-f="e" value="${esc(c.e)}" maxlength="4" aria-label="Icono">
      <input class="field" data-f="n" value="${esc(c.n)}" maxlength="30" aria-label="Nombre">
      <button class="x" data-delinc="${esc(c.id)}" aria-label="Eliminar fuente de ingreso">${xIcon}</button></div>`).join("");
  return `<div class="mnav"><h1>Ajustes</h1></div>
  <div class="sec" style="margin-top:0"><div class="sec-h"><h2>Presupuesto mensual</h2><button data-act="addCat">Añadir</button></div>
    <div class="panel">${cats}
      <div class="set-foot"><span>Total presupuestado</span><b class="num">${eur(total)}</b></div>
    </div></div>
  <div class="sec"><div class="sec-h"><h2>Ingresos</h2><button data-act="addInc">Añadir</button></div>
    <div class="panel">
      <div class="lineitem"><span>Ingreso previsto al mes</span><input class="field money num" id="incomeIn" value="${S.cfg.income}" inputmode="decimal"></div>
      <div class="set-foot" style="padding-top:4px"><span>${diff >= 0 ? "Sin asignar (ahorro previsto)" : "Presupuestas más de lo que ingresas"}</span><b class="num ${diff >= 0 ? "pos" : "neg"}">${diff >= 0 ? "" : "−"}${eur(Math.abs(diff))}</b></div>
      ${incs}
    </div></div>
  <div class="sec"><div class="sec-h"><h2>Copia de seguridad</h2></div>
    <div class="panel help">
      Tus datos se guardan en tu Firebase y se sincronizan entre dispositivos. Si apuntas algo sin conexión, se queda en el móvil y se sube solo al volver la red.
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn ghost" data-act="export">Exportar a CSV</button>
        <label class="btn ghost" style="cursor:pointer">Importar CSV<input type="file" id="importIn" accept=".csv,text/csv" hidden></label>
      </div>
    </div></div>
  <div class="sec"><div class="sec-h"><h2>Cuenta</h2></div>
    <div class="panel"><div class="lineitem"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(S.user && S.user.email)}</span><button class="btn ghost" style="margin:0" data-act="logout">Cerrar sesión</button></div></div></div>`;
}

/* ---------- sheet ---------- */
const E = {t:"g", amt:"", cat:null, d:todayStr(), editId:null, delArm:false};
const lastCat = t => { try { return localStorage.getItem("fm-last-" + t); } catch(e){ return null; } };
const setLastCat = (t, id) => { try { localStorage.setItem("fm-last-" + t, id); } catch(e){} };

function buildKeypad(){
  const keys = ["1","2","3","4","5","6","7","8","9",",","0","del"];
  $("#keypad").innerHTML = keys.map(k => `<button class="key" data-k="${k}" aria-label="${k === "del" ? "Borrar" : k}">${k === "del"
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7z"/><path d="m12 9 6 6M18 9l-6 6"/></svg>` : k}</button>`).join("");
}
function defaultCatFor(t){
  const list = t === "g" ? S.cfg.cats.filter(c => !c.arch) : S.cfg.inc;
  const lc = lastCat(t);
  return list.some(c => c.id === lc) ? lc : (list[0] && list[0].id);
}
function openSheet(t = "g", tx = null){
  if (!S.cfg) return;
  if (tx) Object.assign(E, {t: tx.t, amt: String(tx.amt).replace(".", ","), cat: tx.cat, d: tx.d, editId: tx.id});
  else Object.assign(E, {t, amt:"", cat: defaultCatFor(t), d: todayStr(), editId:null});
  E.delArm = false;
  $("#note").value = tx ? (tx.note || "") : "";
  paintSheet();
  $("#scrim").classList.add("on"); $("#sheet").classList.add("on");
}
function closeSheet(){ $("#scrim").classList.remove("on"); $("#sheet").classList.remove("on"); $("#note").blur(); }
const sheetOpen = () => $("#sheet").classList.contains("on");

function paintSheet(){
  document.querySelectorAll("#seg button").forEach(b => b.classList.toggle("on", b.dataset.t === E.t));
  paintAmt();
  const list = (E.t === "g" ? S.cfg.cats.filter(c => !c.arch) : S.cfg.inc).slice();
  if (E.cat && !list.some(c => c.id === E.cat) && E.editId) list.push({...catById(E.cat), id: E.cat});
  $("#cchips").innerHTML = list.map(c => `<button class="cchip ${c.id === E.cat ? "on" : ""}" data-cat="${esc(c.id)}"><span>${esc(c.e)}</span>${esc(c.n)}</button>`).join("");
  const t = todayStr(); const y = new Date(); y.setDate(y.getDate() - 1); const ys = dStr(y);
  document.querySelectorAll("#daterow button").forEach(b => b.classList.toggle("on", (b.dataset.d === "0" && E.d === t) || (b.dataset.d === "-1" && E.d === ys)));
  const other = E.d !== t && E.d !== ys;
  $("#datepick").classList.toggle("on", other);
  const dd = new Date(E.d + "T12:00:00");
  $("#dateLbl").textContent = other ? `${dd.getDate()} ${MESC[dd.getMonth()]} ${dd.getFullYear() !== new Date().getFullYear() ? dd.getFullYear() : ""}`.trim() : "Otra fecha";
  $("#dateIn").value = E.d; $("#dateIn").max = t;
  $("#delBtn").hidden = !E.editId;
  $("#delBtn").textContent = "Eliminar";
  $("#saveBtn").textContent = E.editId ? "Guardar cambios" : (E.t === "g" ? "Añadir gasto" : "Añadir ingreso");
}
function paintAmt(){
  $("#amount").className = `amount num ${E.t} ${E.amt ? "" : "zero"}`;
  $("#amtSign").textContent = E.t === "g" ? "−" : "+";
  $("#amtVal").textContent = E.amt || "0";
}
function press(k){
  let a = E.amt;
  if (k === "del") a = a.slice(0, -1);
  else if (k === ","){ if (!a.includes(",")) a = (a || "0") + ","; }
  else {
    const [i, dec] = a.split(",");
    if (dec !== undefined){ if (dec.length >= 2) return; a += k; }
    else { if (i.length >= 6) return; a = (a === "0") ? k : a + k; }
  }
  E.amt = a; paintAmt();
}
const amtNum = () => parseFloat((E.amt || "0").replace(",", ".")) || 0;
function shake(el){ el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake"); }

function saveTx(){
  const v = r2(amtNum());
  if (v <= 0){ shake($("#amount")); return; }
  if (!E.cat){ shake($("#cchips")); return; }
  const existing = E.editId ? [...S.all, ...Object.values(S.older).flat()].find(x => x.id === E.editId) : null;
  const tx = {id: E.editId || newId(), t: E.t, amt: v, cat: E.cat, note: ($("#note").value || "").trim(), d: E.d, m: E.d.slice(0,7), ts: existing ? existing.ts : Date.now()};
  setLastCat(E.t, E.cat);
  closeSheet();
  putTx(tx);
  const c = catById(tx.cat);
  const offline = !navigator.onLine ? " Se subirá al volver la conexión." : "";
  toast(E.editId ? "Cambios guardados." + offline : `${tx.t === "g" ? "−" : "+"}${eur(tx.amt)} en ${c.n}${tx.m !== S.view ? ` (${monthLabel(tx.m)})` : ""}.${offline}`);
}
function deleteTx(){
  if (!E.delArm){ E.delArm = true; $("#delBtn").textContent = "Pulsa para confirmar"; return; }
  const tx = [...S.all, ...Object.values(S.older).flat()].find(x => x.id === E.editId);
  closeSheet();
  if (tx){ removeTx(tx); toast("Movimiento eliminado."); }
}

let toastT;
function toast(msg){ const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2600); }

/* ---------- CSV ---------- */
async function exportCsv(){
  try {
    const snap = await S.F.getDocs(txCol());
    const all = snap.docs.map(d => d.data()).sort((a,b) => a.d < b.d ? -1 : a.d > b.d ? 1 : a.ts - b.ts);
    const lines = ["fecha;tipo;categoria;importe;nota"];
    all.forEach(t => { const c = catById(t.cat); lines.push([t.d, t.t === "g" ? "gasto" : "ingreso", c.n, String(t.amt).replace(".", ","), (t.note || "").replace(/[;\n]/g, ",")].join(";")); });
    const name = `cuentas-${todayStr()}.csv`;
    const blob = new Blob(["\ufeff" + lines.join("\n")], {type:"text/csv"});
    const file = new File([blob], name, {type:"text/csv"});
    if (navigator.canShare && navigator.canShare({files:[file]})) { await navigator.share({files:[file], title:name}); return; }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  } catch(e){ if (e && e.name !== "AbortError") toast("No se ha podido exportar. Revisa la conexión."); }
}
function hashStr(s){ let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
async function importCsv(file){
  const text = (await file.text()).replace(/^\ufeff/, "");
  const rows = text.split(/\r?\n/).filter(l => l.trim());
  const byName = (list, n) => list.find(c => c.n.toLowerCase() === n.toLowerCase());
  const txs = []; const seen = {};
  for (const line of rows.slice(1)){
    const [d, tipo, cat, imp, ...rest] = line.split(";");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "")) continue;
    const amt = r2(parseFloat(String(imp).replace(/\./g, "").replace(",", ".")));
    if (!(amt > 0)) continue;
    const t = /ingreso/i.test(tipo) ? "i" : "g";
    const list = t === "g" ? S.cfg.cats : S.cfg.inc;
    const c = byName(list, (cat || "").trim()) || byName(list, "Otros") || byName(list, "Otros ingresos") || list[list.length - 1];
    seen[line] = (seen[line] || 0) + 1;
    txs.push({id: "imp" + hashStr(line + "#" + seen[line]), t, amt, cat: c.id, note: rest.join(";").trim(), d, m: d.slice(0,7), ts: Date.now()});
  }
  if (!txs.length){ toast("No he encontrado movimientos en ese archivo."); return; }
  try {
    for (let i = 0; i < txs.length; i += 400){
      const b = S.F.writeBatch(S.fs);
      txs.slice(i, i + 400).forEach(tx => b.set(txRef(tx.id), tx));
      await b.commit();
    }
    toast(`${txs.length} movimientos importados.`);
  } catch(e){ errToast(e); }
}

/* ---------- events ---------- */
function goMonth(k){ S.view = k; S.filter = "all"; render(); window.scrollTo({top:0}); }

document.addEventListener("click", e => {
  const tab = e.target.closest("[data-tab]");
  if (tab){ S.tab = tab.dataset.tab; render(); window.scrollTo({top:0}); return; }
  const act = e.target.closest("[data-act]");
  if (act){
    const a = act.dataset.act;
    if (a === "prev") goMonth(shiftKey(S.view, -1));
    else if (a === "next" && S.view < todayKey()) goMonth(shiftKey(S.view, 1));
    else if (a === "goSettings"){ S.tab = "ajustes"; render(); window.scrollTo({top:0}); }
    else if (a === "addCat"){ S.cfg.cats.push({id: newId(), e:"✨", n:"Nueva categoría", b:0, c: COLORS[S.cfg.cats.length % COLORS.length]}); saveCfg(); render(); }
    else if (a === "addInc"){ S.cfg.inc.push({id: newId(), e:"💶", n:"Nuevo ingreso"}); saveCfg(); render(); }
    else if (a === "export") exportCsv();
    else if (a === "logout"){ S.F.signOut(S.auth); }
    return;
  }
  const del = e.target.closest("[data-del]");
  if (del){ const c = S.cfg.cats.find(x => x.id === del.dataset.del); if (c){ c.arch = true; saveCfg(); render(); toast(`${c.n} eliminada. Sus gastos pasados se conservan.`); } return; }
  const deli = e.target.closest("[data-delinc]");
  if (deli){ if (S.cfg.inc.length <= 1) return toast("Deja al menos una fuente de ingreso."); S.cfg.inc = S.cfg.inc.filter(x => x.id !== deli.dataset.delinc); saveCfg(); render(); return; }
  const flt = e.target.closest("[data-filter]");
  if (flt){ S.filter = flt.dataset.filter; render(); return; }
  const row = e.target.closest("#view [data-cat]");
  if (row){ S.tab = "movs"; S.filter = row.dataset.cat; render(); window.scrollTo({top:0}); return; }
  const mv = e.target.closest("[data-tx]");
  if (mv){ const t = txFor(S.view).find(x => x.id === mv.dataset.tx); if (t) openSheet(t.t, t); return; }
  const hm = e.target.closest("[data-month]");
  if (hm){ S.tab = "inicio"; goMonth(hm.dataset.month); return; }
  if (e.target.id === "resetBtn") resetPass();
});

document.addEventListener("submit", async e => {
  if (e.target.id !== "loginForm") return;
  e.preventDefault();
  const email = $("#email").value.trim(), pass = $("#pass").value;
  const err = $("#loginErr"); err.textContent = "";
  if (!email || !pass){ err.textContent = "Escribe tu email y tu contraseña."; return; }
  $("#loginBtn").disabled = true; $("#loginBtn").textContent = "Entrando…";
  try { await S.F.signInWithEmailAndPassword(S.auth, email, pass); }
  catch(ex){
    const c = ex && ex.code || "";
    err.textContent = c.includes("invalid") || c.includes("wrong-password") || c.includes("user-not-found") ? "Email o contraseña incorrectos."
      : c.includes("network") ? "Sin conexión. Conéctate a internet para entrar."
      : c.includes("too-many") ? "Demasiados intentos. Espera unos minutos."
      : "No se ha podido entrar (" + c + ").";
    $("#loginBtn").disabled = false; $("#loginBtn").textContent = "Entrar";
  }
});
async function resetPass(){
  const email = $("#email").value.trim(); const err = $("#loginErr");
  if (!email){ err.textContent = "Escribe tu email y vuelve a pulsar."; return; }
  try { await S.F.sendPasswordResetEmail(S.auth, email); err.textContent = "Te he enviado un email para cambiar la contraseña."; }
  catch(e){ err.textContent = "No se ha podido enviar el email. Revisa la dirección."; }
}

$("#fab").addEventListener("click", () => openSheet("g"));
$("#scrim").addEventListener("click", closeSheet);
$("#closeSheet").addEventListener("click", closeSheet);
$("#seg").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b || b.dataset.t === E.t) return;
  E.t = b.dataset.t; if (!E.editId) E.cat = defaultCatFor(E.t); else E.cat = defaultCatFor(E.t);
  paintSheet();
});
$("#cchips").addEventListener("click", e => { const b = e.target.closest("[data-cat]"); if (!b) return; E.cat = b.dataset.cat; paintSheet(); });
$("#daterow").addEventListener("click", e => {
  const b = e.target.closest("button[data-d]"); if (!b) return;
  const d = new Date(); d.setDate(d.getDate() + (+b.dataset.d)); E.d = dStr(d); paintSheet();
});
$("#dateIn").addEventListener("change", e => { if (e.target.value && e.target.value <= todayStr()){ E.d = e.target.value; paintSheet(); } });
$("#keypad").addEventListener("click", e => { const k = e.target.closest("[data-k]"); if (k) press(k.dataset.k); });
$("#saveBtn").addEventListener("click", saveTx);
$("#delBtn").addEventListener("click", deleteTx);
$("#note").addEventListener("keydown", e => { if (e.key === "Enter"){ e.preventDefault(); $("#note").blur(); } });
document.addEventListener("keydown", e => {
  if (!sheetOpen() || e.target.id === "note") return;
  if (/^[0-9]$/.test(e.key)) press(e.key);
  else if (e.key === "," || e.key === ".") press(",");
  else if (e.key === "Backspace") press("del");
  else if (e.key === "Enter") saveTx();
  else if (e.key === "Escape") closeSheet();
});

document.addEventListener("change", e => {
  const inp = e.target;
  if (inp.id === "importIn"){ if (inp.files[0]) importCsv(inp.files[0]); inp.value = ""; return; }
  if (inp.id === "incomeIn"){ const v = parseFloat(inp.value.replace(",", ".")); if (!isNaN(v) && v >= 0){ S.cfg.income = r2(v); saveCfg(); } return; }
  const row = inp.closest(".set-row"); if (!row) return;
  const f = inp.dataset.f;
  const item = row.dataset.id ? S.cfg.cats.find(c => c.id === row.dataset.id) : S.cfg.inc.find(c => c.id === row.dataset.inc);
  if (!item) return;
  if (f === "b"){ const v = parseFloat(inp.value.replace(",", ".")); item.b = isNaN(v) || v < 0 ? 0 : r2(v); }
  else if (f === "n"){ item.n = inp.value.trim() || item.n; }
  else if (f === "e"){ item.e = inp.value.trim() || item.e; }
  saveCfg();
});
document.addEventListener("focusout", e => {
  if (S.tab === "ajustes" && e.target.tagName === "INPUT")
    setTimeout(() => { if (!document.activeElement || document.activeElement.tagName !== "INPUT") render(); }, 60);
});
document.addEventListener("visibilitychange", () => { if (!document.hidden){ if (S.view < todayKey() && S.view === S._lastNow) S.view = todayKey(); S._lastNow = todayKey(); render(); } });

function handleDeepLink(){
  if (S.deepLinkDone || !S.cfg) return; S.deepLinkDone = true;
  const s = (location.hash + " " + location.search).toLowerCase();
  if (/ingreso/.test(s)) openSheet("i");
  else if (/gasto|nuevo/.test(s)) openSheet("g");
  if (s.trim()) history.replaceState(null, "", location.pathname);
}

/* ---------- boot ---------- */
async function boot(){
  buildKeypad();
  S._lastNow = todayKey();
  showScreen("loading");
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg || !cfg.apiKey || /PEGA/.test(cfg.apiKey)){ showScreen("setup"); return; }
  try {
    const [app, auth, fs] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-firestore.js`)
    ]);
    S.F = {...app, ...auth, ...fs};
  } catch(e){ console.error(e); showScreen("error"); return; }
  const F = S.F;
  const app = F.initializeApp(cfg);
  S.auth = F.getAuth(app);
  try { S.fs = F.initializeFirestore(app, {localCache: F.persistentLocalCache({tabManager: F.persistentMultipleTabManager()})}); }
  catch(e){ S.fs = F.getFirestore(app); }
  F.onAuthStateChanged(S.auth, u => {
    if (u){ S.user = u; showScreen("app"); startData(); }
    else { S.user = null; stopData(); S.cfg = null; closeSheet(); showScreen("login"); }
  });
}

if ("serviceWorker" in navigator && location.protocol === "https:"){
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
boot();
