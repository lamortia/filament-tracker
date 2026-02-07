/**
 * Filament Trends & Ops Tracker (Phase 1)
 * Local-first PWA using IndexedDB.
 */

const DB_NAME = "filament_tracker_db";
const DB_VER  = 1;

const MATERIALS_DEFAULT = [
  "PLA","PLA+","PETG","ABS","ASA","TPU","Silk PLA","PA/Nylon","PC","HIPS","PVA/BVOH",
  "PLA-CF","PETG-CF","ABS-CF","ASA-CF","Nylon-CF","PETG-GF","Nylon-GF","Wood-Fill","Metal-Fill","Other"
];

const BRANDS_DEFAULT = ["Bambu","Polymaker (PolyLite)","Elegoo","Bulk/Generic","Other"];
const VENDORS_DEFAULT = ["Bambu Store","Amazon","Temu","AliExpress","Other"];

const COLORS_DEFAULT = [
  "Black","White","Gray","Silver","Gold","Red","Orange","Yellow","Green","Blue","Purple","Pink","Brown","Beige","Clear/Transparent","Glow","Multicolor"
];

const FINISH_DEFAULT = ["Standard","Matte","Silk","Gloss","Glitter","Sparkle","Marble","Translucent"];
const ADDITIVES_DEFAULT = ["None","CF","GF","Wood","Metal","Sparkle","Glow","Other"];

let db;

/** ---------- IndexedDB Minimal Wrapper ---------- **/
function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;

      if(!d.objectStoreNames.contains("settings")){
        d.createObjectStore("settings", { keyPath: "key" });
      }

      if(!d.objectStoreNames.contains("filamentSkus")){
        const s = d.createObjectStore("filamentSkus", { keyPath: "id" });
        s.createIndex("by_material", "material", { unique:false });
        s.createIndex("by_brand", "brand", { unique:false });
        s.createIndex("by_search", "search", { unique:false });
      }

      if(!d.objectStoreNames.contains("vendorListings")){
        const s = d.createObjectStore("vendorListings", { keyPath: "id" });
        s.createIndex("by_sku", "filamentSkuId", { unique:false });
      }

      if(!d.objectStoreNames.contains("priceSnapshots")){
        const s = d.createObjectStore("priceSnapshots", { keyPath: "id" });
        s.createIndex("by_listing", "listingId", { unique:false });
        s.createIndex("by_sku", "filamentSkuId", { unique:false });
        s.createIndex("by_time", "timestamp", { unique:false });
      }

      if(!d.objectStoreNames.contains("watchlist")){
        d.createObjectStore("watchlist", { keyPath: "filamentSkuId" });
      }

      if(!d.objectStoreNames.contains("purchases")){
        const s = d.createObjectStore("purchases", { keyPath: "id" });
        s.createIndex("by_time","timestamp",{unique:false});
      }

      if(!d.objectStoreNames.contains("spools")){
        const s = d.createObjectStore("spools", { keyPath: "id" });
        s.createIndex("by_sku","filamentSkuId",{unique:false});
        s.createIndex("by_status","status",{unique:false});
      }

      if(!d.objectStoreNames.contains("printJobs")){
        const s = d.createObjectStore("printJobs", { keyPath: "id" });
        s.createIndex("by_time","timestamp",{unique:false});
        s.createIndex("by_sku","filamentSkuId",{unique:false});
        s.createIndex("by_spool","spoolId",{unique:false});
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(storeNames, mode="readonly"){
  return db.transaction(storeNames, mode);
}
function store(t, name){ return t.objectStore(name); }
function getAllFrom(storeObj, indexName=null, query=null){
  return new Promise((resolve, reject)=>{
    const req = indexName ? storeObj.index(indexName).getAll(query) : storeObj.getAll();
    req.onsuccess = ()=>resolve(req.result || []);
    req.onerror = ()=>reject(req.error);
  });
}
function put(storeObj, val){
  return new Promise((resolve, reject)=>{
    const req = storeObj.put(val);
    req.onsuccess = ()=>resolve(val);
    req.onerror = ()=>reject(req.error);
  });
}
function del(storeObj, key){
  return new Promise((resolve, reject)=>{
    const req = storeObj.delete(key);
    req.onsuccess = ()=>resolve();
    req.onerror = ()=>reject(req.error);
  });
}

/** ---------- Utils ---------- **/
const uid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const fmtMoney = (n) => (n==null || isNaN(n)) ? "-" : `$${Number(n).toFixed(2)}`;
const gramsToKg = (g) => Number(g)/1000;
const perKg = (finalPrice, weightG) => {
  const kg = gramsToKg(weightG || 1000);
  if(!kg || !finalPrice) return null;
  return finalPrice / kg;
};
function normalizeSearch(sku){
  const parts = [sku.brand, sku.line, sku.material, sku.color, sku.finish, sku.additives].filter(Boolean);
  return parts.join(" ").toLowerCase();
}
function el(tag, attrs={}, children=[]){
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v])=>{
    if(k==="class") e.className=v;
    else if(k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else if(v !== undefined && v !== null) e.setAttribute(k, v);
  });
  (Array.isArray(children)?children:[children]).forEach(c=>{
    if(c==null) return;
    if(typeof c === "string") e.appendChild(document.createTextNode(c));
    else e.appendChild(c);
  });
  return e;
}
function setOptions(selectEl, options, includeAllLabel){
  selectEl.innerHTML = "";
  if(includeAllLabel){
    selectEl.appendChild(el("option", {value:""}, includeAllLabel));
  }
  options.forEach(o=> selectEl.appendChild(el("option", {value:o}, o)));
}

/** ---------- Modal ---------- **/
const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
document.getElementById("modalClose").addEventListener("click", ()=>hideModal());

function showModal(title, bodyNode){
  modalTitle.textContent = title;
  modalBody.innerHTML = "";
  modalBody.appendChild(bodyNode);
  modal.classList.remove("hidden");
}
function hideModal(){ modal.classList.add("hidden"); }

/** ---------- Navigation ---------- **/
document.querySelectorAll(".tab").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    const view = btn.dataset.view;
    document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));
    document.getElementById("view-"+view).classList.remove("hidden");
    renderAll();
  });
});

/** ---------- PWA Install & SW ---------- **/
let deferredPrompt;
const installBtn = document.getElementById("installBtn");
window.addEventListener("beforeinstallprompt", (e)=>{
  e.preventDefault();
  deferredPrompt = e;
  installBtn.hidden = false;
});
installBtn.addEventListener("click", async ()=>{
  if(!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.hidden = true;
});
if("serviceWorker" in navigator){
  window.addEventListener("load", ()=> navigator.serviceWorker.register("./sw.js"));
}

/** ---------- Seed ---------- **/
document.getElementById("seedBtn").addEventListener("click", async ()=>{
  await saveSetting("materials", MATERIALS_DEFAULT);
  await saveSetting("brands", BRANDS_DEFAULT);
  await saveSetting("vendors", VENDORS_DEFAULT);
  await saveSetting("colors", COLORS_DEFAULT);
  await saveSetting("finishes", FINISH_DEFAULT);
  await saveSetting("additives", ADDITIVES_DEFAULT);
  toast("Seeded defaults.");
  await renderAll();
});

async function saveSetting(key, value){
  const t = tx(["settings"], "readwrite");
  await put(store(t,"settings"), {key, value});
  await new Promise((res)=> t.oncomplete = res);
}
async function loadSetting(key, fallback){
  const t = tx(["settings"], "readonly");
  const s = store(t,"settings");
  return new Promise((resolve)=>{
    const req = s.get(key);
    req.onsuccess = ()=> resolve(req.result?.value ?? fallback);
    req.onerror = ()=> resolve(fallback);
  });
}

/** ---------- Toast ---------- **/
let toastTimer;
function toast(msg){
  clearTimeout(toastTimer);
  let t = document.getElementById("toast");
  if(!t){
    t = el("div",{id:"toast", class:"pill", style:"position:fixed;bottom:14px;left:50%;transform:translateX(-50%);z-index:99"});
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = "1";
  toastTimer = setTimeout(()=> t.style.opacity="0", 1800);
}

/** ---------- Catalog CRUD ---------- **/
document.getElementById("addSkuBtn").addEventListener("click", async ()=>{
  const materials = await loadSetting("materials", MATERIALS_DEFAULT);
  const brands = await loadSetting("brands", BRANDS_DEFAULT);
  const colors = await loadSetting("colors", COLORS_DEFAULT);
  const finishes = await loadSetting("finishes", FINISH_DEFAULT);
  const additives = await loadSetting("additives", ADDITIVES_DEFAULT);

  const form = el("div",{},[
    labelSelect("Brand", "brand", brands),
    labelInput("Line (e.g., PolyLite, Basic)", "line"),
    labelSelect("Material", "material", materials),
    labelSelect("Color", "color", colors),
    labelSelect("Finish", "finish", finishes),
    labelSelect("Additives", "additives", additives),
    labelInput("Diameter (mm)", "diameter", "1.75", "number", "step='0.01'"),
    labelInput("Spool weight (g)", "weight_g", "1000", "number"),
    labelInput("Notes", "notes"),
    el("hr"),
    el("div",{class:"row gap"},[
      el("button",{class:"btn", onclick: async ()=>{ await createSkuFromForm(form); hideModal(); }}, "Save"),
      el("button",{class:"btn subtle", onclick: ()=>hideModal()}, "Cancel"),
    ])
  ]);
  showModal("Add Filament SKU", form);
});

function labelInput(labelText, name, value="", type="text", extraAttrs=""){
  const input = el("input",{class:"input", name, value, type});
  if(extraAttrs){
    extraAttrs.split(" ").forEach(pair=>{
      const m = pair.split("=");
      if(m.length===2){
        input.setAttribute(m[0], m[1].replaceAll("'","").replaceAll('"',""));
      }
    });
  }
  return el("div",{},[
    el("label",{},labelText),
    input
  ]);
}
function labelSelect(labelText, name, options){
  const sel = el("select",{class:"input", name});
  options.forEach(o=> sel.appendChild(el("option",{value:o},o)));
  return el("div",{},[
    el("label",{},labelText),
    sel
