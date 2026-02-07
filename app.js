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
  ]);
}
async function createSkuFromForm(form){
  const v = (n)=> form.querySelector(`[name="${n}"]`)?.value?.trim();
  const sku = {
    id: uid(),
    brand: v("brand") || "Other",
    line: v("line") || "",
    material: v("material") || "Other",
    color: v("color") || "",
    finish: v("finish") || "Standard",
    additives: v("additives") || "None",
    diameter: Number(v("diameter") || 1.75),
    weight_g: Number(v("weight_g") || 1000),
    notes: v("notes") || "",
  };
  sku.search = normalizeSearch(sku);
  const t = tx(["filamentSkus"],"readwrite");
  await put(store(t,"filamentSkus"), sku);
  await new Promise((res)=> t.oncomplete = res);
  toast("SKU saved.");
  await renderAll();
}

async function toggleWatch(skuId, on){
  const t = tx(["watchlist"],"readwrite");
  const s = store(t,"watchlist");
  if(on) await put(s, {filamentSkuId: skuId, addedAt: nowIso()});
  else await del(s, skuId);
  await new Promise((res)=> t.oncomplete = res);
  await renderAll();
}

/** ---------- Price Snapshots ---------- **/
document.getElementById("addSnapshotBtn").addEventListener("click", async ()=>{
  const skuId = document.getElementById("trendSkuSelect").value;
  if(!skuId) return toast("Pick a SKU first.");
  const vendors = await loadSetting("vendors", VENDORS_DEFAULT);

  const form = el("div",{},[
    labelSelect("Vendor", "vendor", vendors),
    labelInput("Listing URL or ASIN", "ref"),
    labelInput("Base price", "basePrice", "", "number"),
    labelInput("Shipping", "shipping", "0", "number"),
    labelInput("Coupon/discount (subtract)", "discount", "0", "number"),
    labelInput("Spool weight (g) override (optional)", "weight_g", "", "number"),
    el("hr"),
    el("div",{class:"row gap"},[
      el("button",{class:"btn", onclick: async ()=>{ await saveSnapshot(skuId, form); hideModal(); }}, "Save Snapshot"),
      el("button",{class:"btn subtle", onclick: ()=>hideModal()}, "Cancel"),
    ])
  ]);
  showModal("Add Price Snapshot", form);
});

async function getOrCreateListing(skuId, vendor, ref){
  const t = tx(["vendorListings"], "readwrite");
  const st = store(t,"vendorListings");
  const listings = await getAllFrom(st, "by_sku", skuId);
  let found = listings.find(l => l.vendor === vendor && (l.ref||"") === (ref||""));
  if(!found){
    found = { id: uid(), filamentSkuId: skuId, vendor, ref: ref||"", createdAt: nowIso() };
    await put(st, found);
  }
  await new Promise((res)=> t.oncomplete = res);
  return found;
}

async function saveSnapshot(skuId, form){
  const v = (n)=> form.querySelector(`[name="${n}"]`)?.value?.trim();
  const vendor = v("vendor") || "Other";
  const ref = v("ref") || "";
  const basePrice = Number(v("basePrice") || 0);
  const shipping = Number(v("shipping") || 0);
  const discount = Number(v("discount") || 0);
  const weightOverride = v("weight_g") ? Number(v("weight_g")) : null;
  const finalPrice = Math.max(0, basePrice + shipping - discount);

  const listing = await getOrCreateListing(skuId, vendor, ref);

  const t = tx(["priceSnapshots","filamentSkus"],"readwrite");
  const sku = await new Promise((resolve)=>{
    const req = store(t,"filamentSkus").get(skuId);
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> resolve(null);
  });

  const weightG = weightOverride ?? (sku?.weight_g ?? 1000);
  const snapshot = {
    id: uid(),
    filamentSkuId: skuId,
    listingId: listing.id,
    timestamp: nowIso(),
    basePrice, shipping, discount,
    finalPrice,
    weight_g: weightG,
    perKg: perKg(finalPrice, weightG),
  };
  await put(store(t,"priceSnapshots"), snapshot);
  await new Promise((res)=> t.oncomplete = res);
  toast("Snapshot saved.");
  await renderAll();
}

/** ---------- Purchases & Spools ---------- **/
document.getElementById("addPurchaseBtn").addEventListener("click", async ()=>{
  const form = el("div",{},[
    labelInput("Vendor (free text)", "vendor", "Amazon"),
    labelInput("Order ID (optional)", "orderId"),
    labelInput("Tax", "tax", "0", "number"),
    labelInput("Shipping", "shipping", "0", "number"),
    labelInput("Notes", "notes"),
    el("hr"),
    el("div",{class:"row gap"},[
      el("button",{class:"btn", onclick: async ()=>{ await savePurchase(form); hideModal(); }}, "Save Purchase"),
      el("button",{class:"btn subtle", onclick: ()=>hideModal()}, "Cancel"),
    ])
  ]);
  showModal("Add Purchase", form);
});

async function savePurchase(form){
  const v = (n)=> form.querySelector(`[name="${n}"]`)?.value?.trim();
  const purchase = {
    id: uid(),
    timestamp: nowIso(),
    vendor: v("vendor") || "Other",
    orderId: v("orderId") || "",
    tax: Number(v("tax") || 0),
    shipping: Number(v("shipping") || 0),
    notes: v("notes") || ""
  };
  const t = tx(["purchases"],"readwrite");
  await put(store(t,"purchases"), purchase);
  await new Promise((res)=> t.oncomplete = res);
  toast("Purchase saved.");
  await renderAll();
}

document.getElementById("addSpoolBtn").addEventListener("click", async ()=>{
  const skus = await loadSkusFiltered();
  if(!skus.length) return toast("Add at least one SKU first.");

  const select = el("select",{class:"input", name:"filamentSkuId"});
  skus.forEach(s=> select.appendChild(el("option",{value:s.id}, skuLabel(s))));
  const form = el("div",{},[
    el("label",{},"Filament SKU"),
    select,
    labelInput("Starting weight (g)", "startingWeight_g", "1000", "number"),
    labelSelect("Status", "status", ["sealed","opened","low","empty"]),
    el("hr"),
    el("div",{class:"row gap"},[
      el("button",{class:"btn", onclick: async ()=>{ await saveSpool(form); hideModal(); }}, "Save Spool"),
      el("button",{class:"btn subtle", onclick: ()=>hideModal()}, "Cancel"),
    ])
  ]);
  showModal("Add Spool", form);
});

async function saveSpool(form){
  const v = (n)=> form.querySelector(`[name="${n}"]`)?.value?.trim();
  const spool = {
    id: uid(),
    filamentSkuId: v("filamentSkuId"),
    startingWeight_g: Number(v("startingWeight_g") || 1000),
    currentEstimatedWeight_g: Number(v("startingWeight_g") || 1000),
    status: v("status") || "sealed",
    createdAt: nowIso(),
  };
  const t = tx(["spools"],"readwrite");
  await put(store(t,"spools"), spool);
  await new Promise((res)=> t.oncomplete = res);
  toast("Spool added.");
  await renderAll();
}

/** ---------- Print Jobs ---------- **/
document.getElementById("addPrintJobBtn").addEventListener("click", async ()=>{
  const skus = await loadSkusFiltered();
  const spools = await loadAll("spools");

  const skuSel = el("select",{class:"input", name:"filamentSkuId"});
  skuSel.appendChild(el("option",{value:""},"(Select)"));
  skus.forEach(s=> skuSel.appendChild(el("option",{value:s.id}, skuLabel(s))));

  const spoolSel = el("select",{class:"input", name:"spoolId"});
  spoolSel.appendChild(el("option",{value:""},"(Optional) choose spool"));
  spools.forEach(sp=> {
    const s = skus.find(x=>x.id===sp.filamentSkuId);
    spoolSel.appendChild(el("option",{value:sp.id}, `${sp.id.slice(0,8)} • ${s?skuLabel(s):sp.filamentSkuId} • ${Math.round(sp.currentEstimatedWeight_g)}g left`));
  });

  const form = el("div",{},[
    el("label",{},"Spool (optional but recommended)"),
    spoolSel,
    el("label",{},"Filament SKU (required if spool not selected)"),
    skuSel,
    labelInput("Grams used", "gramsUsed", "", "number"),
    labelSelect("Outcome", "outcome", ["success","fail","partial"]),
    labelInput("Scrap grams (optional)", "scrap_g", "0", "number"),
    labelInput("Notes", "notes"),
    el("hr"),
    el("div",{class:"row gap"},[
      el("button",{class:"btn", onclick: async ()=>{ await savePrintJob(form); hideModal(); }}, "Save Print Job"),
      el("button",{class:"btn subtle", onclick: ()=>hideModal()}, "Cancel"),
    ])
  ]);
  showModal("Log Print Job", form);
});

async function savePrintJob(form){
  const v = (n)=> form.querySelector(`[name="${n}"]`)?.value?.trim();
  const spoolId = v("spoolId") || "";
  let skuId = v("filamentSkuId") || "";
  const gramsUsed = Number(v("gramsUsed") || 0);
  const scrap_g = Number(v("scrap_g") || 0);

  if(!spoolId && !skuId) return toast("Choose a spool or a SKU.");
  if(gramsUsed <= 0) return toast("Enter grams used.");

  const t = tx(["printJobs","spools"],"readwrite");

  if(spoolId){
    const spool = await new Promise((resolve)=>{
      const req = store(t,"spools").get(spoolId);
      req.onsuccess = ()=> resolve(req.result);
      req.onerror = ()=> resolve(null);
    });
    if(spool && !skuId) skuId = spool.filamentSkuId;
    if(spool){
      const newWeight = Math.max(0, Number(spool.currentEstimatedWeight_g||0) - gramsUsed);
      spool.currentEstimatedWeight_g = newWeight;
      if(newWeight === 0) spool.status = "empty";
      else if(newWeight < 150) spool.status = "low";
      else if(spool.status === "sealed") spool.status = "opened";
      await put(store(t,"spools"), spool);
    }
  }

  const job = {
    id: uid(),
    timestamp: nowIso(),
    printer: "Bambu P2S",
    ams: "AMS 2 Pro",
    filamentSkuId: skuId,
    spoolId: spoolId || "",
    gramsUsed,
    outcome: v("outcome") || "success",
    scrap_g,
    notes: v("notes") || ""
  };
  await put(store(t,"printJobs"), job);
  await new Promise((res)=> t.oncomplete = res);
  toast("Print job logged.");
  await renderAll();
}

/** ---------- Backup ---------- **/
document.getElementById("exportJsonBtn").addEventListener("click", async ()=>{
  const data = await exportAll();
  downloadBlob(JSON.stringify(data, null, 2), `filament-tracker-backup-${new Date().toISOString().slice(0,10)}.json`, "application/json");
});

document.getElementById("exportCsvBtn").addEventListener("click", async ()=>{
  const data = await exportAll();
  const csv = toCsv(data);
  downloadBlob(csv, `filament-tracker-export-${new Date().toISOString().slice(0,10)}.csv`, "text/csv");
});

document.getElementById("importFile").addEventListener("change", async (e)=>{
  const file = e.target.files?.[0];
  if(!file) return;
  const text = await file.text();
  const json = JSON.parse(text);
  await importAll(json);
  toast("Import complete.");
  await renderAll();
  e.target.value = "";
});

document.getElementById("resetBtn").addEventListener("click", async ()=>{
  if(!confirm("Wipe ALL local data?")) return;
  await new Promise((resolve, reject)=>{
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = ()=>resolve();
    req.onerror = ()=>reject(req.error);
  });
  db = await openDB();
  toast("Database wiped.");
  await renderAll();
});

async function exportAll(){
  const stores = ["settings","filamentSkus","vendorListings","priceSnapshots","watchlist","purchases","spools","printJobs"];
  const out = { exportedAt: nowIso(), version: DB_VER, data:{} };
  for(const stName of stores){
    out.data[stName] = await loadAll(stName);
  }
  return out;
}

async function importAll(json){
  const stores = Object.keys(json.data || {});
  const t = tx(stores, "readwrite");
  for(const stName of stores){
    const st = store(t, stName);
    await new Promise((resolve, reject)=>{
      const req = st.clear();
      req.onsuccess = ()=>resolve();
      req.onerror = ()=>reject(req.error);
    });
    for(const row of (json.data[stName] || [])){
      await put(st, row);
    }
  }
  await new Promise((res)=> t.oncomplete = res);
}

function downloadBlob(text, filename, type){
  const blob = new Blob([text], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toCsv(exportJson){
  const lines = [];
  lines.push(["type","timestamp","brand","line","material","color","finish","additives","vendor","ref","basePrice","shipping","discount","finalPrice","weight_g","perKg","gramsUsed","outcome","scrap_g","notes"].join(","));
  const skuMap = new Map((exportJson.data.filamentSkus||[]).map(s=>[s.id,s]));
  const listingMap = new Map((exportJson.data.vendorListings||[]).map(l=>[l.id,l]));
  for(const ps of (exportJson.data.priceSnapshots||[])){
    const sku = skuMap.get(ps.filamentSkuId) || {};
    const listing = listingMap.get(ps.listingId) || {};
    lines.push([
      "priceSnapshot", ps.timestamp,
      sku.brand, sku.line, sku.material, sku.color, sku.finish, sku.additives,
      listing.vendor, listing.ref,
      ps.basePrice, ps.shipping, ps.discount, ps.finalPrice, ps.weight_g, ps.perKg,
      "", "", "", ""
    ].map(csvEscape).join(","));
  }
  for(const j of (exportJson.data.printJobs||[])){
    const sku = skuMap.get(j.filamentSkuId) || {};
    lines.push([
      "printJob", j.timestamp,
      sku.brand, sku.line, sku.material, sku.color, sku.finish, sku.additives,
      "", "",
      "", "", "", "", "", "",
      j.gramsUsed, j.outcome, j.scrap_g, j.notes
    ].map(csvEscape).join(","));
  }
  return lines.join("\n");
}
function csvEscape(v){
  if(v==null) return "";
  const s = String(v);
  if(/[,"\n]/.test(s)) return `"${s.replaceAll('"','""')}"`;
  return s;
}

/** ---------- Rendering ---------- **/
const skuListEl = document.getElementById("skuList");
const skuSearchEl = document.getElementById("skuSearch");
const materialFilterEl = document.getElementById("materialFilter");
const brandFilterEl = document.getElementById("brandFilter");
const trendSkuSelectEl = document.getElementById("trendSkuSelect");
const snapshotListEl = document.getElementById("snapshotList");
const watchListEl = document.getElementById("watchList");
const spoolListEl = document.getElementById("spoolList");
const purchaseListEl = document.getElementById("purchaseList");
const printJobListEl = document.getElementById("printJobList");
const usage30El = document.getElementById("usage30");
const wasteHotspotsEl = document.getElementById("wasteHotspots");
const dealRadarEl = document.getElementById("dealRadar");

skuSearchEl.addEventListener("input", ()=>renderCatalog());
materialFilterEl.addEventListener("change", ()=>renderCatalog());
brandFilterEl.addEventListener("change", ()=>renderCatalog());

async function loadAll(storeName){
  const t = tx([storeName],"readonly");
  const st = store(t, storeName);
  const rows = await getAllFrom(st);
  await new Promise((res)=> t.oncomplete = res);
  return rows;
}

function skuLabel(s){
  const line = s.line ? ` ${s.line}` : "";
  const color = s.color ? ` • ${s.color}` : "";
  const fin = s.finish && s.finish !== "Standard" ? ` • ${s.finish}` : "";
  const add = s.additives && s.additives !== "None" ? ` • ${s.additives}` : "";
  return `${s.brand}${line} • ${s.material}${color}${fin}${add} • ${s.weight_g||1000}g`;
}

async function loadSkusFiltered(){
  const skus = await loadAll("filamentSkus");
  return skus.sort((a,b)=> skuLabel(a).localeCompare(skuLabel(b)));
}

async function renderAll(){
  await renderFilters();
  await renderCatalog();
  await renderTrendSkuSelect();
  await renderTrends();
  await renderOps();
  await renderPrintLog();
  await renderInsights();
}

async function renderFilters(){
  const materials = await loadSetting("materials", MATERIALS_DEFAULT);
  const brands = await loadSetting("brands", BRANDS_DEFAULT);
  setOptions(materialFilterEl, materials, "All materials");
  setOptions(brandFilterEl, brands, "All brands");
}

async function renderCatalog(){
  const q = skuSearchEl.value.trim().toLowerCase();
  const m = materialFilterEl.value;
  const b = brandFilterEl.value;

  const skus = await loadSkusFiltered();
  const watch = new Set((await loadAll("watchlist")).map(w=>w.filamentSkuId));

  const filtered = skus.filter(s=>{
    if(m && s.material !== m) return false;
    if(b && s.brand !== b) return false;
    if(q && !(s.search||"").includes(q)) return false;
    return true;
  });

  skuListEl.innerHTML = "";
  if(!filtered.length){
    skuListEl.appendChild(el("div",{class:"muted small"},"No SKUs yet. Tap “Seed materials & colors” then “Add SKU”."));
    return;
  }

  filtered.slice(0, 200).forEach(s=>{
    const isWatched = watch.has(s.id);
    const node = el("div",{class:"item"},[
      el("div",{},[
        el("div",{}, skuLabel(s)),
        el("div",{class:"meta"}, s.notes || "—"),
      ]),
      el("div",{class:"actions"},[
        el("button",{class:"btn subtle", onclick: ()=>toggleWatch(s.id, !isWatched)}, isWatched ? "Unwatch" : "Watch"),
      ])
    ]);
    skuListEl.appendChild(node);
  });
  if(filtered.length > 200){
    skuListEl.appendChild(el("div",{class:"muted small"},`Showing first 200 of ${filtered.length}. Refine search/filters.`));
  }
}

async function renderTrendSkuSelect(){
  const watch = await loadAll("watchlist");
  const skus = await loadSkusFiltered();
  const watchedIds = new Set(watch.map(w=>w.filamentSkuId));
  const watchedSkus = skus.filter(s=>watchedIds.has(s.id));
  const list = watchedSkus.length ? watchedSkus : skus.slice(0,50);

  trendSkuSelectEl.innerHTML = "";
  trendSkuSelectEl.appendChild(el("option",{value:""},"Select a SKU (watchlist first)"));
  list.forEach(s=> trendSkuSelectEl.appendChild(el("option",{value:s.id}, skuLabel(s))));
  trendSkuSelectEl.onchange = ()=>renderTrends();
}

async function renderTrends(){
  const skuId = trendSkuSelectEl.value;
  snapshotListEl.innerHTML = "";
  if(!skuId){
    snapshotListEl.appendChild(el("div",{class:"muted small"},"Pick a SKU to view snapshots."));
    return;
  }
  const snapshots = (await loadAll("priceSnapshots"))
    .filter(p=>p.filamentSkuId===skuId)
    .sort((a,b)=> (b.timestamp||"").localeCompare(a.timestamp||""));

  if(!snapshots.length){
    snapshotListEl.appendChild(el("div",{class:"muted small"},"No snapshots yet. Tap “Add Price Snapshot”."));
    return;
  }

  const latest = snapshots[0];
  const oldest = snapshots[snapshots.length-1];
  const change = (latest.perKg!=null && oldest.perKg!=null && oldest.perKg!==0) ? ((latest.perKg-oldest.perKg)/oldest.perKg*100) : null;

  snapshotListEl.appendChild(el("div",{class:"card"},[
    el("div",{}, `Latest $/kg: ${latest.perKg==null?"-":fmtMoney(latest.perKg)}`),
    el("div",{class:"muted small"}, `Snapshots: ${snapshots.length} • Change vs oldest: ${change==null?"-":change.toFixed(1)+"%"}`)
  ]));

  snapshots.slice(0, 100).forEach(p=>{
    snapshotListEl.appendChild(el("div",{class:"item"},[
      el("div",{},[
        el("div",{}, `${new Date(p.timestamp).toLocaleString()} • Final: ${fmtMoney(p.finalPrice)} • ${fmtMoney(p.perKg)}/kg`),
        el("div",{class:"meta"}, `Base ${fmtMoney(p.basePrice)} + ship ${fmtMoney(p.shipping)} - disc ${fmtMoney(p.discount)} • weight ${p.weight_g}g`),
      ])
    ]));
  });
}

async function renderOps(){
  const watch = await loadAll("watchlist");
  const skus = await loadSkusFiltered();
  const skuMap = new Map(skus.map(s=>[s.id,s]));

  watchListEl.innerHTML = "";
  if(!watch.length){
    watchListEl.appendChild(el("div",{class:"muted small"},"Watch SKUs from Catalog to track trends + ops."));
  } else {
    watch.sort((a,b)=>(b.addedAt||"").localeCompare(a.addedAt||"")).forEach(w=>{
      const s = skuMap.get(w.filamentSkuId);
      if(!s) return;
      watchListEl.appendChild(el("div",{class:"item"},[
        el("div",{},[
          el("div",{}, skuLabel(s)),
          el("div",{class:"meta"}, `Added ${new Date(w.addedAt).toLocaleDateString()}`),
        ]),
        el("div",{class:"actions"},[
          el("button",{class:"btn subtle", onclick: ()=>toggleWatch(s.id, false)}, "Remove")
        ])
      ]));
    });
  }

  const spools = (await loadAll("spools")).sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||""));
  spoolListEl.innerHTML = "";
  if(!spools.length){
    spoolListEl.appendChild(el("div",{class:"muted small"},"Add spools to track depletion and usage."));
  } else {
    spools.slice(0,100).forEach(sp=>{
      const s = skuMap.get(sp.filamentSkuId);
      spoolListEl.appendChild(el("div",{class:"item"},[
        el("div",{},[
          el("div",{}, `${sp.id.slice(0,8)} • ${s?skuLabel(s):sp.filamentSkuId}`),
          el("div",{class:"meta"}, `${Math.round(sp.currentEstimatedWeight_g)}g left • status ${sp.status}`),
        ])
      ]));
    });
  }

  const purchases = (await loadAll("purchases")).sort((a,b)=>(b.timestamp||"").localeCompare(a.timestamp||""));
  purchaseListEl.innerHTML = "";
  if(!purchases.length){
    purchaseListEl.appendChild(el("div",{class:"muted small"},"Add purchases for your records."));
  } else {
    purchases.slice(0,50).forEach(p=>{
      purchaseListEl.appendChild(el("div",{class:"item"},[
        el("div",{},[
          el("div",{}, `${new Date(p.timestamp).toLocaleString()} • ${p.vendor} ${p.orderId?("• "+p.orderId):""}`),
          el("div",{class:"meta"}, `Tax ${fmtMoney(p.tax)} • Ship ${fmtMoney(p.shipping)} • ${p.notes||"—"}`),
        ])
      ]));
    });
  }
}

async function renderPrintLog(){
  const jobs = (await loadAll("printJobs")).sort((a,b)=>(b.timestamp||"").localeCompare(a.timestamp||""));
  const skus = await loadSkusFiltered();
  const skuMap = new Map(skus.map(s=>[s.id,s]));

  printJobListEl.innerHTML = "";
  if(!jobs.length){
    printJobListEl.appendChild(el("div",{class:"muted small"},"Log print jobs to see usage + waste metrics."));
    return;
  }
  jobs.slice(0,150).forEach(j=>{
    const s = skuMap.get(j.filamentSkuId);
    printJobListEl.appendChild(el("div",{class:"item"},[
      el("div",{},[
        el("div",{}, `${new Date(j.timestamp).toLocaleString()} • ${j.outcome.toUpperCase()} • ${j.gramsUsed}g used • scrap ${j.scrap_g||0}g`),
        el("div",{class:"meta"}, `${s?skuLabel(s):j.filamentSkuId} ${j.spoolId?("• spool "+j.spoolId.slice(0,8)):""} • ${j.notes||"—"}`),
      ])
    ]));
  });
}

async function renderInsights(){
  const jobs = await loadAll("printJobs");
  const skus = await loadSkusFiltered();
  const skuMap = new Map(skus.map(s=>[s.id,s]));
  const snapshots = await loadAll("priceSnapshots");
  const watch = await loadAll("watchlist");
  const watchedIds = new Set(watch.map(w=>w.filamentSkuId));

  const cutoff = Date.now() - 30*24*60*60*1000;
  const usageBySku = new Map();
  const wasteBySku = new Map();

  jobs.forEach(j=>{
    const ts = Date.parse(j.timestamp||"");
    if(!isNaN(ts) && ts >= cutoff){
      usageBySku.set(j.filamentSkuId, (usageBySku.get(j.filamentSkuId)||0) + Number(j.gramsUsed||0));
      wasteBySku.set(j.filamentSkuId, (wasteBySku.get(j.filamentSkuId)||0) + Number(j.scrap_g||0));
    }
  });

  const usage30El = document.getElementById("usage30");
  usage30El.innerHTML = "";
  const usageRows = [...usageBySku.entries()]
    .map(([skuId, grams])=>({skuId, grams}))
    .sort((a,b)=>b.grams-a.grams)
    .slice(0,12);

  if(!usageRows.length){
    usage30El.appendChild(el("div",{class:"muted small"},"No print jobs in the last 30 days yet."));
  } else {
    usageRows.forEach(r=>{
      const s = skuMap.get(r.skuId);
      usage30El.appendChild(el("div",{class:"item"},[
        el("div",{},[
          el("div",{}, `${Math.round(r.grams)}g • ${s?skuLabel(s):r.skuId}`),
          el("div",{class:"meta"}, `~${(r.grams/1000).toFixed(2)}kg used`)
        ])
      ]));
    });
  }

  const wasteHotspotsEl = document.getElementById("wasteHotspots");
  wasteHotspotsEl.innerHTML = "";
  const wasteRows = [...wasteBySku.entries()].map(([skuId, scrap])=>{
    const used = usageBySku.get(skuId) || 0;
    const rate = used>0 ? (scrap/used*100) : 0;
    return {skuId, scrap, used, rate};
  }).filter(r=>r.used>0).sort((a,b)=>b.rate-a.rate).slice(0,12);

  if(!wasteRows.length){
    wasteHotspotsEl.appendChild(el("div",{class:"muted small"},"Add scrap grams when logging jobs to see waste hotspots."));
  } else {
    wasteRows.forEach(r=>{
      const s = skuMap.get(r.skuId);
      wasteHotspotsEl.appendChild(el("div",{class:"item"},[
        el("div",{},[
          el("div",{}, `${r.rate.toFixed(1)}% waste • scrap ${Math.round(r.scrap)}g / used ${Math.round(r.used)}g`),
          el("div",{class:"meta"}, s?skuLabel(s):r.skuId),
        ])
      ]));
    });
  }

  const dealRadarEl = document.getElementById("dealRadar");
  dealRadarEl.innerHTML = "";
  const latestBySku = new Map();
  snapshots.forEach(p=>{
    if(!watchedIds.has(p.filamentSkuId)) return;
    const cur = latestBySku.get(p.filamentSkuId);
    if(!cur || (p.timestamp||"") > (cur.timestamp||"")) latestBySku.set(p.filamentSkuId, p);
  });
  const deals = [...latestBySku.values()].filter(p=>p.perKg!=null).sort((a,b)=>a.perKg-b.perKg).slice(0,12);
  if(!deals.length){
    dealRadarEl.appendChild(el("div",{class:"muted small"},"Watch SKUs and add snapshots to populate deal radar."));
  } else {
    deals.forEach(p=>{
      const s = skuMap.get(p.filamentSkuId);
      dealRadarEl.appendChild(el("div",{class:"item"},[
        el("div",{},[
          el("div",{}, `${fmtMoney(p.perKg)}/kg • final ${fmtMoney(p.finalPrice)} • ${new Date(p.timestamp).toLocaleDateString()}`),
          el("div",{class:"meta"}, s?skuLabel(s):p.filamentSkuId),
          // --- Backup polish: custom file picker + confirm import + WIPE gate ---
(function backupPolish(){
  const importInput = document.getElementById("importFile");
  const pickBtn = document.getElementById("pickJsonBtn");
  const importBtn = document.getElementById("importConfirmBtn");
  const cancelBtn = document.getElementById("importCancelBtn");
  const fileNameEl = document.getElementById("importFileName");

  const wipeInput = document.getElementById("wipeConfirmInput");
  const resetBtn = document.getElementById("resetBtn");

  // If any elements are missing, don't crash
  if(!importInput || !pickBtn || !importBtn || !cancelBtn || !fileNameEl || !wipeInput || !resetBtn) return;

  let pendingFile = null;

  pickBtn.addEventListener("click", () => importInput.click());

  importInput.addEventListener("change", (e) => {
    const f = e.target.files?.[0] || null;
    pendingFile = f;

    if(f){
      fileNameEl.textContent = f.name;
      importBtn.disabled = false;
      cancelBtn.disabled = false;
    }else{
      fileNameEl.textContent = "No file selected";
      importBtn.disabled = true;
      cancelBtn.disabled = true;
    }
  });

  cancelBtn.addEventListener("click", () => {
    pendingFile = null;
    importInput.value = "";
    fileNameEl.textContent = "No file selected";
    importBtn.disabled = true;
    cancelBtn.disabled = true;
  });

  // Confirm import (uses the existing modal if present, otherwise confirm())
  importBtn.addEventListener("click", async () => {
    if(!pendingFile) return;

    const ok = await confirmBackupAction(
      "Import & Replace",
      `This will REPLACE local data on this device with:\n\n${pendingFile.name}\n\nProceed?`
    );

    if(!ok) return;

    // Trigger the app's existing JSON import flow by reusing the file input.
    // If your app already has an import listener on #importFile, it will run normally.
    // If not, we'll run a safe fallback import here.
    if (!hasImportListener(importInput)) {
      await fallbackJsonImport(pendingFile);
    } else {
      // Re-trigger change event path by ensuring input still holds the file
      // (most implementations already read from input.files in their handler)
      importInput.dispatchEvent(new Event("change"));
    }
  });

  // WIPE gate (enable reset only when WIPE typed)
  const setWipeEnabled = () => {
    const val = (wipeInput.value || "").trim().toUpperCase();
    resetBtn.disabled = (val !== "WIPE");
  };
  wipeInput.addEventListener("input", setWipeEnabled);
  setWipeEnabled();

  // If your app already has a click handler on #resetBtn, this just gates it.
  // If not, provide a fallback wipe confirm.
  resetBtn.addEventListener("click", async () => {
    const ok = await confirmBackupAction(
      "Wipe local database",
      "This will delete ALL local data on this device.\n\nProceed?"
    );
    if(!ok) return;

    // If existing reset handler exists, let it run; otherwise fallback.
    if (!hasClickListener(resetBtn)) {
      try {
        localStorage.clear();
        // IndexedDB wipe fallback (best effort)
        if (window.indexedDB?.databases) {
          const dbs = await indexedDB.databases();
          for (const d of dbs) {
            if (d?.name) indexedDB.deleteDatabase(d.name);
          }
        }
        location.reload();
      } catch (e) {
        console.error(e);
        alert("Wipe failed. Try clearing site storage in Chrome settings.");
      }
    }
  });

  function hasImportListener(el){
    // Best-effort: if your code attached a handler, it will still fire.
    // We can't reliably introspect listeners, so return true to avoid double-import
    // ONLY if there is a global marker you set. Otherwise false.
    return !!window.__FT_HAS_IMPORT_HANDLER__;
  }

  function hasClickListener(el){
    // Same approach: allow your app's existing handlers to run.
    return !!window.__FT_HAS_RESET_HANDLER__;
  }

  async function confirmBackupAction(title, message){
    const modal = document.getElementById("modal");
    const modalTitle = document.getElementById("modalTitle");
    const modalBody = document.getElementById("modalBody");
    const modalClose = document.getElementById("modalClose");

    if(!modal || !modalTitle || !modalBody || !modalClose){
      return window.confirm(message);
    }

    return new Promise((resolve) => {
      modalTitle.textContent = title;

      modalBody.innerHTML = `
        <div class="muted small" style="white-space:pre-wrap; line-height:1.35;">${escapeHtml(message)}</div>
        <div class="row gap" style="margin-top:14px; justify-content:flex-end;">
          <button class="btn subtle" id="__cancel">Cancel</button>
          <button class="btn danger" id="__ok">Proceed</button>
        </div>
      `;

      modal.classList.remove("hidden");

      const cleanup = () => {
        modal.classList.add("hidden");
        modalBody.innerHTML = "";
      };

      modalClose.onclick = () => { cleanup(); resolve(false); };
      modal.querySelector("#__cancel").onclick = () => { cleanup(); resolve(false); };
      modal.querySelector("#__ok").onclick = () => { cleanup(); resolve(true); };
    });
  }

  async function fallbackJsonImport(file){
    const text = await file.text();
    const data = JSON.parse(text);
    // If your app already has an import function, prefer that.
    if (typeof window.importBackupJson === "function") {
      await window.importBackupJson(data);
      return;
    }
    alert("Import handler not found. Your app needs the original JSON import code wired to #importFile.");
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, (c)=>({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }
})();
        ])
      ]));
    });
  }
}

/** ---------- Init ---------- **/
(async function init(){
  db = await openDB();
  await renderAll();
})();
